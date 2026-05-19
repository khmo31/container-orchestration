#!/usr/bin/env node

/**
 * dispatcher.js — Agent Dispatcher 실행 엔진
 *
 * khmo의 요청을 받아 intent 분류 → policy 매칭 → agent dispatch
 * → observability → fallback의 전체 파이프라인을 실행.
 *
 * 사용법:
 *   node dispatcher.js "요청 메시지"
 *   node dispatcher.js --registry-check
 *   node dispatcher.js --status
 */

const path = require('path');
const fs = require('fs');

// Core modules
const AgentRegistry = require('./lib/registry');
const IntentParser = require('./lib/parser');
const PolicyMatcher = require('./lib/matcher');
const AgentExecutor = require('./lib/executor');
const { CircuitBreaker } = require('./lib/circuit');
const RetryHandler = require('./lib/retry');
const DedupeTracker = require('./lib/dedupe');
const ConfigValidator = require('./lib/validator');
const FallbackHandler = require('./lib/fallback');
const logger = require('./lib/observability');

// NEW: Escalation + Reflection + Planner layers
const EscalationHandler = require('./lib/escalation');
const ReflectionEngine = require('./lib/reflection');
const TaskPlanner = require('./lib/planner');

class Dispatcher {
  constructor(options = {}) {
    this.registryPath = options.registryPath || path.join(__dirname, 'registry.json');
    this.policyPath = options.policyPath || path.join(__dirname, 'policy.json');

    // Core components
    this.registry = new AgentRegistry(this.registryPath);
    this.dedupe = new DedupeTracker();
    this.circuitBreaker = new CircuitBreaker();
    this.validator = new ConfigValidator();
    this.parser = new IntentParser(options.parser || {});

    // NEW: Escalation + Reflection + Planner layers
    this.reflection = new ReflectionEngine();
    this.planner = new TaskPlanner({
      agentRegistry: this.registry,
      minMessageLength: options.plannerMinLength || 200,
      minConfidence: options.plannerMinConfidence || 0.5
    });

    // Boot sequence
    this._boot();
  }

  /**
   * Boot sequence: config load → validate → init
   */
  _boot() {
    logger.info('dispatcher_boot', { phase: 'loading_config' });

    try {
      this.registryData = JSON.parse(fs.readFileSync(this.registryPath, 'utf-8'));
      this.policyData = JSON.parse(fs.readFileSync(this.policyPath, 'utf-8'));
    } catch (e) {
      logger.error('dispatcher_boot_failed', { error: e.message });
      throw new Error(`Failed to load config: ${e.message}`);
    }

    // Validate
    const validation = this.validator.validate(this.registryData, this.policyData);
    this.validation = validation;

    if (!validation.valid) {
      logger.error('dispatcher_boot_failed', {
        phase: 'validation',
        errors: validation.all_errors
      });
      throw new Error(`Configuration validation failed:\n  ${validation.all_errors.join('\n  ')}`);
    }

    // Init components
    this.matcher = new PolicyMatcher(this.policyData);
    this.executor = new AgentExecutor(this.registry, this.circuitBreaker);
    this.fallback = new FallbackHandler(this.registry, this.executor);

    // NEW: Init escalation layer (depends on registry, created after boot)
    this.escalation = new EscalationHandler({
      registry: this.registry
    });

    // Init circuit breaker for all agents
    for (const [agentId, agent] of Object.entries(this.registryData.agents)) {
      if (agent.circuit_breaker) {
        this.circuitBreaker.init(agentId, agent.circuit_breaker);
      }
    }

    logger.info('dispatcher_boot', {
      phase: 'ready',
      agents: Object.keys(this.registryData.agents).length,
      policies: this.policyData.policies.length
    });
  }

  /**
   * 메인 디스패치 파이프라인
   * @param {string} message - khmo의 요청 메시지
   * @param {Object} context - 추가 컨텍스트 (선택)
   * @returns {Promise<Object>} 처리 결과
   */
  async dispatch(message, context = {}) {
    if (!message || typeof message !== 'string') {
      return { success: false, error: 'Message is required' };
    }

    // 0. Request ID 발급
    const requestId = logger.generateRequestId();
    logger.setSessionId(context.sessionId || requestId);

    // 1. 중복 확인
    if (!this.dedupe.register(requestId, 'pending')) {
      const status = this.dedupe.getStatus(requestId);
      logger.warn('duplicate_request', { request_id: requestId, status });
      return { success: false, error: `duplicate_request: ${status}` };
    }

    const startTime = Date.now();

    try {
      // 2. Intent 분류 (parser.js)
      logger.startTrace(requestId, message, null);
      const parseResult = await this.parser.parse(message);
      logger.info('intent_classified', {
        request_id: requestId,
        intents: parseResult.intents,
        confidence: parseResult.confidence,
        llm_used: parseResult.llm_used
      });

      // 3. Policy 매칭 (matcher.js)
      const matchResult = this.matcher.match(parseResult);

      // 3a. ESCALATION: 매칭 실패 시
      if (!matchResult.policy) {
        logger.warn('no_matching_policy', { request_id: requestId, intents: parseResult.intents });

        const escalationResult = await this.escalation.escalate({
          reason: 'no_matching_policy',
          requestId,
          message,
          intents: parseResult.intents,
          confidence: parseResult.confidence
        });

        const durationMs = Date.now() - startTime;
        const result = {
          success: false,
          error: 'no_matching_policy',
          intents: parseResult.intents,
          request_id: requestId,
          duration_ms: durationMs,
          escalation: escalationResult,
          timestamp: new Date().toISOString()
        };

        this.dedupe.update(requestId, 'failed');
        this.reflection.record(result);
        logger.endTrace(requestId, { durationMs });

        return result;
      }
      logger.traceMatch(requestId, matchResult.policy.id, matchResult.confidence);

      // 3b. PLANNER: 조건부 태스크 분해
      const policy = matchResult.policy;
      let executionResult;

      const planCheck = this.planner.shouldPlan(parseResult, message, { policy });

      if (planCheck.needsPlanner && policy.action.type !== 'pipeline') {
        logger.info('planner_triggered', {
          request_id: requestId,
          reasons: planCheck.reasons,
          policy_id: policy.id
        });

        const planResult = await this.planner.plan(message, { policy });

        if (planResult.success) {
          // 각 planner step을 정규 _executeRoute() 경로로 실행
          // executor.execute() 직접 호출 대신 retry+fallback+CB 통과
          executionResult = await this._executePlannerSteps(planResult, {
            message,
            requestId,
            context,
            originalPolicy: policy
          });

          executionResult.planner_used = true;
          executionResult.task_graph = planResult.taskGraph;
        } else {
          // Planner 실패 → 기존 policy로 fallback
          logger.warn('planner_fallback_to_policy', {
            request_id: requestId,
            policy_id: policy.id
          });
          executionResult = await this._executePolicy(policy, {
            message,
            requestId,
            context
          });
        }
      } else {
        // 4. 일반 Policy 실행
        executionResult = await this._executePolicy(policy, {
          message,
          requestId,
          context
        });
      }

      const durationMs = Date.now() - startTime;

      // 5. ESCALATION: 모든 시도 실패 시
      if (!executionResult.success && executionResult.fallback_used) {
        const attempts = [];
        if (executionResult.agent_id) {
          attempts.push({ agentId: executionResult.agent_id, error: executionResult.error });
        }
        if (executionResult.fallback_result?.agent_id) {
          attempts.push({ agentId: executionResult.fallback_result.agent_id, error: executionResult.fallback_result.error });
        }

        const escalationResult = await this.escalation.escalate({
          reason: 'all_agents_failed',
          requestId,
          message,
          intents: parseResult.intents,
          attempts,
          error: executionResult.error
        });

        executionResult.escalation = escalationResult;
      }

      // 5b. CIRCUIT_OPEN 감지 시 에스컬레이션
      if (executionResult.circuitOpen) {
        const escalationResult = await this.escalation.escalate({
          reason: 'circuit_open',
          requestId,
          message,
          intents: parseResult.intents,
          targetAgent: executionResult.agent_id
        });

        executionResult.escalation = escalationResult;
      }

      // 6. 결과 정리
      const result = {
        success: executionResult.success,
        request_id: requestId,
        policy_id: policy.id,
        intent: parseResult.intents,
        confidence: parseResult.confidence,
        duration_ms: durationMs,
        result: executionResult,
        fallback_used: executionResult.fallback_used || false,
        escalation_triggered: !!executionResult.escalation,
        timestamp: new Date().toISOString()
      };

      this.dedupe.update(requestId, executionResult.success ? 'completed' : 'failed');

      // REFLECTION: 모든 실행 결과 기록 (성공/실패 관계없이)
      this.reflection.record(result);

      logger.endTrace(requestId, { durationMs });

      return result;

    } catch (e) {
      const durationMs = Date.now() - startTime;
      logger.error('dispatch_failed', {
        request_id: requestId,
        error: e.message,
        duration_ms: durationMs
      });

      // ESCALATION: 실행 오류 발생 시
      let escalationResult = null;
      try {
        escalationResult = await this.escalation.escalate({
          reason: 'execution_error',
          requestId,
          message,
          intents: [],
          error: { message: e.message }
        });
      } catch (escErr) {
        logger.error('escalation_failed', { error: escErr.message });
      }

      this.dedupe.update(requestId, 'failed');

      const result = {
        success: false,
        request_id: requestId,
        error: e.message,
        duration_ms: durationMs,
        escalation: escalationResult,
        timestamp: new Date().toISOString()
      };

      // REFLECTION: 에러도 기록
      this.reflection.record(result);

      return result;
    }
  }

  /**
   * Policy 실행 (route / pipeline)
   */
  async _executePolicy(policy, params) {
    switch (policy.action.type) {
      case 'route':
        return this._executeRoute(policy, params);
      case 'pipeline':
        return this._executePipeline(policy, params);
      default:
        return { success: false, error: `unknown_action_type: ${policy.action.type}` };
    }
  }

  /**
   * Route 실행: 단일 에이전트 호출
   */
  async _executeRoute(policy, params) {
    const target = policy.action.target;
    const primaryAgentId = target.primary;

    // 'direct'는 Claw 직접 처리
    if (primaryAgentId === 'direct') {
      return {
        success: true,
        action: 'direct',
        message: 'Direct handling (Claw)',
        policy_id: policy.id
      };
    }

    // container 활성화 확인 필요
    if (policy.action.requires_active_container) {
      const agent = this.registry.getAgent(primaryAgentId);
      if (!agent || !agent.enabled) {
        return {
          success: false,
          action: 'route',
          error: `agent_not_active: ${primaryAgentId}`,
          fallback_used: true,
          fallback_result: await this._executePolicyFallback(policy, params)
        };
      }
    }

    // Primary agent 호출 (with retry)
    const agent = this.registry.getAgent(primaryAgentId);
    const retryConfig = agent?.retry || {};
    const retry = new RetryHandler(retryConfig, this.dedupe);

    let lastError = null;
    for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
      if (attempt > 0) {
        await retry.wait(attempt);
      }

      const callStart = Date.now();
      const result = await this.executor.execute(primaryAgentId, params);
      const durationMs = Date.now() - callStart;

      logger.traceAgentCall(params.requestId, primaryAgentId, durationMs, result.success);

      if (result.success) {
        return {
          success: true,
          action: 'route',
          agent_id: primaryAgentId,
          data: result.data,
          duration_ms: durationMs,
          request_id: params.requestId,
          attempts: attempt + 1
        };
      }

      lastError = result.error;

      if (!retry.shouldRetry(attempt, result.error)) {
        break;
      }
    }

    // 모든 재시도 실패 → policy fallback
    logger.warn('primary_agent_failed', {
      request_id: params.requestId,
      agent_id: primaryAgentId,
      error: lastError
    });

    return {
      success: false,
      action: 'route',
      agent_id: primaryAgentId,
      error: lastError,
      fallback_used: true,
      fallback_result: await this._executePolicyFallback(policy, params, lastError)
    };
  }

  /**
   * Pipeline 실행: 여러 단계 순차 실행
   */
  async _executePipeline(policy, params) {
    const steps = policy.action.steps || [];
    const stepResults = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      logger.info('pipeline_step', {
        request_id: params.requestId,
        step_index: i,
        step_agent: step.agent,
        step_stage: step.stage
      });

      const stepParams = {
        ...params,
        message: `[${step.stage}] ${params.message}`,
        pipeline_step: i,
        pipeline_stage: step.stage
      };

      const result = await this.executor.execute(step.agent, stepParams);
      stepResults.push({
        index: i,
        agent: step.agent,
        stage: step.stage,
        success: result.success,
        duration_ms: result.durationMs,
        data: result.success ? result.data : null,
        error: result.success ? null : result.error
      });

      if (!result.success) {
        const onFail = policy.action.on_step_fail || 'stop_and_report';

        if (onFail === 'stop_and_report') {
          return {
            success: false,
            action: 'pipeline',
            completed_steps: i,
            total_steps: steps.length,
            failed_step: i,
            failed_agent: step.agent,
            error: `Pipeline failed at step ${i} (${step.agent}/${step.stage}): ${result.error}`,
            step_results: stepResults
          };
        }

        if (onFail === 'skip_and_continue') {
          logger.warn('pipeline_step_skipped', {
            request_id: params.requestId,
            step_index: i,
            step_agent: step.agent
          });
          continue;
        }
      }
    }

    return {
      success: stepResults.some(r => r.success),
      action: 'pipeline',
      completed_steps: stepResults.filter(r => r.success).length,
      total_steps: steps.length,
      step_results: stepResults,
      request_id: params.requestId
    };
  }

  /**
   * Planner 스텝 실행: 각 스텝을 parse → match → route 경로로 실행
   *
   * 🔒 절대 규칙: planner는 agent 선택하지 않음. 각 step은
   * 자체적으로 parser를 거쳐 intent 분류 → matcher가 agent 할당.
   *
   * dispatcher는 순수 router 역할 유지, planner는 decomposition만 담당.
   */
  async _executePlannerSteps(planResult, params) {
    const taskGraph = planResult.taskGraph;
    const stepResults = [];

    for (let i = 0; i < taskGraph.length; i++) {
      const step = taskGraph[i];

      logger.info('planner_step', {
        request_id: params.requestId,
        step_index: i,
        description: step.description
      });

      // Step 1: 이 step의 설명을 parser로 intent 분류
      const stepMessage = `[planner_step_${i}] ${step.details || step.description}`;
      const stepParse = await this.parser.parse(stepMessage);

      logger.info('planner_step_classified', {
        request_id: params.requestId,
        step_index: i,
        intents: stepParse.intents,
        confidence: stepParse.confidence
      });

      // Step 2: matcher로 최적 policy/agent 탐색
      const stepMatch = this.matcher.match(stepParse);

      if (stepMatch.policy && stepMatch.policy.id !== 'default_action') {
        // policy 매칭 성공 → 정규 route 경로 실행 (retry+fallback+CB 통과)
        const result = await this._executePolicy(stepMatch.policy, {
          ...params,
          message: stepMessage
        });

        const fallbackResult = result.fallback_result || {};
        const stepResult = {
          index: i,
          agent: result.agent_id || 'unknown',
          fallback_agent: fallbackResult.agent_id || null,
          policy: stepMatch.policy.id,
          description: step.description,
          success: result.success,
          duration_ms: result.duration_ms || result.durationMs || 0,
          data: result.success ? result.data : null,
          error: result.success ? null : result.error,
          fallback_used: result.fallback_used || false
        };

        stepResults.push(stepResult);

        if (!result.success) {
          logger.warn('planner_step_failed', {
            request_id: params.requestId,
            step_index: i,
            policy: stepMatch.policy.id,
            error: result.error,
            fallback_used: result.fallback_used
          });

          return {
            success: false,
            action: 'planner_pipeline',
            completed_steps: i,
            total_steps: taskGraph.length,
            failed_step: i,
            failed_agent: result.agent_id,
            error: `Planner step ${i} (${stepMatch.policy.id}) failed: ${result.error}`,
            step_results: stepResults,
            planner_used: true
          };
        }
      } else {
        // 매칭 실패 → Claw 직접 처리 (fallback)
        logger.info('planner_step_direct', {
          request_id: params.requestId,
          step_index: i,
          description: step.description
        });

        stepResults.push({
          index: i,
          agent: 'direct',
          policy: 'default_direct',
          description: step.description,
          success: true,
          duration_ms: 0,
          data: null
        });
      }
    }

    return {
      success: true,
      action: 'planner_pipeline',
      completed_steps: taskGraph.length,
      total_steps: taskGraph.length,
      step_results: stepResults,
      planner_used: true
    };
  }

  /**
   * Policy 레벨 fallback 실행
   */
  async _executePolicyFallback(policy, params, error = null) {
    const fallbackAgentId = policy.action.target?.fallback;

    if (!fallbackAgentId) {
      return { success: false, fallback: 'none', message: 'No fallback defined' };
    }

    if (fallbackAgentId === 'direct') {
      return {
        success: true,
        fallback: 'direct',
        message: 'Falling back to direct (Claw)'
      };
    }

    // Fallback 에이전트 호출
    const result = await this.executor.execute(fallbackAgentId, params);
    return {
      success: result.success,
      fallback: 'agent',
      agent_id: fallbackAgentId,
      data: result.data,
      error: result.success ? null : result.error
    };
  }

  /**
   * 상태 조회
   */
  getStatus() {
    const circuitStates = this.circuitBreaker.getAllStates();
    const reflectionSummary = this.reflection ? this.reflection.getSummary() : null;

    return {
      status: this.validation?.valid ? 'ready' : 'invalid_config',
      agents: Object.entries(this.registryData?.agents || {}).map(([id, agent]) => ({
        id,
        name: agent.name,
        enabled: agent.enabled,
        endpoint_type: agent.endpoint?.type,
        capabilities: agent.capabilities,
        circuit_state: circuitStates[id]?.state || 'UNKNOWN',
        circuit_failures: circuitStates[id]?.failures || 0
      })),
      policies: this.policyData?.policies?.map(p => ({
        id: p.id,
        priority: p.priority,
        type: p.action.type,
        description: p.description || ''
      })) || [],
      layers: {
        escalation: 'enabled',
        reflection: 'enabled',
        planner: 'enabled'
      },
      dedupe_tracking: this.dedupe.size,
      metrics: {
        circuit_breakers: Object.keys(circuitStates).length,
        reflection: reflectionSummary ? {
          total_executions: reflectionSummary.total_executions,
          success_rate: reflectionSummary.overall_success_rate,
          pending_suggestions: reflectionSummary.pending_suggestions
        } : null
      }
    };
  }

  /**
   * Registry 헬스체크 일괄 실행
   */
  async healthCheckAll() {
    return this.registry.healthCheckAll();
  }
}

// CLI 인터페이스
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--registry-check') || args.includes('--health')) {
    const dispatcher = new Dispatcher();
    const health = await dispatcher.healthCheckAll();
    console.log('Agent Health:');
    for (const [agentId, status] of Object.entries(health)) {
      const icon = status.healthy ? '✅' : '❌';
      console.log(`  ${icon} ${agentId}: ${status.reason}${status.latency_ms ? ` (${status.latency_ms}ms)` : ''}`);
    }
    return;
  }

  if (args.includes('--status')) {
    const dispatcher = new Dispatcher();
    const status = dispatcher.getStatus();
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (args.includes('--logs')) {
    const count = 50;
    const logs = logger.getRecentLogs(count);
    console.log(`Recent ${logs.length} log entries:`);
    logs.forEach(l => {
      const time = l.timestamp ? l.timestamp.slice(11, 19) : '??';
      console.log(`[${time}] [${l.level?.toUpperCase()}] [${l.event}]${l.request_id ? ` [req:${l.request_id}]` : ''}`);
      if (l.intent) console.log(`  intent: ${l.intent}, confidence: ${l.confidence}`);
      if (l.agent_id && l.duration_ms) console.log(`  agent: ${l.agent_id}, ${l.duration_ms}ms, success: ${l.success}`);
      if (l.error) console.log(`  error: ${l.error}`);
    });
    return;
  }

  if (args.includes('--reflection') || args.includes('--summary')) {
    const dispatcher = new Dispatcher();
    const summary = dispatcher.reflection.getSummary();
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (args.includes('--suggestions')) {
    const dispatcher = new Dispatcher();
    const suggestions = dispatcher.reflection.getPendingSuggestions();
    console.log(JSON.stringify(suggestions, null, 2));
    return;
  }

  if (args.includes('--test-escalation')) {
    const dispatcher = new Dispatcher();
    const result = await dispatcher.escalation.escalate({
      reason: 'no_matching_policy',
      message: '이미지에서 텍스트 추출해서 번역해줘',
      intents: ['unknown'],
      requestId: 'test_esc_' + Date.now()
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.includes('--test-planner')) {
    const dispatcher = new Dispatcher();
    const msgIdx = args.indexOf('--test-planner');
    const testMessage = msgIdx >= 0 && args.length > msgIdx + 1
      ? args.slice(msgIdx + 1).join(' ')
      : '주식 포트폴리오 분석하고 매매 전략 수립해서 실행해줘';
    const planCheck = dispatcher.planner.shouldPlan(
      { intents: ['trading', 'analysis'], confidence: 0.4 },
      testMessage
    );
    console.log('Should plan:', JSON.stringify(planCheck, null, 2));
    if (planCheck.needsPlanner) {
      const planResult = await dispatcher.planner.plan(testMessage);
      console.log('Plan result:', JSON.stringify(planResult, null, 2));
    }
    return;
  }

  // Extract message from --dispatch or raw args
  let message;
  const dispatchIdx = args.indexOf('--dispatch');
  if (dispatchIdx >= 0) {
    message = args.slice(dispatchIdx + 1).join(' ');
  } else {
    message = args.join(' ');
  }

  if (!message) {
    console.error('Usage: node dispatcher.js --dispatch "<message>"');
    console.error('       node dispatcher.js --registry-check');
    console.error('       node dispatcher.js --status');
    console.error('       node dispatcher.js --logs');
    console.error('       node dispatcher.js --reflection    (execution summary)');
    console.error('       node dispatcher.js --suggestions   (policy improvement suggestions)');
    console.error('       node dispatcher.js --test-escalation');
    console.error('       node dispatcher.js --test-planner [message]');
    process.exit(1);
  }

  const dispatcher = new Dispatcher();
  const result = await dispatcher.dispatch(message);
  console.log(JSON.stringify(result, null, 2));
}

// 스크립트로 직접 실행 시
if (require.main === module) {
  main().catch(e => {
    console.error('Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = Dispatcher;
