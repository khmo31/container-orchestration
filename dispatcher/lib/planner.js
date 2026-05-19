/**
 * planner.js — 선택적 태스크 플래너
 *
 * 복잡한 요청만 LLM을 통해 태스크 분해를 수행.
 * 분해된 태스크 그래프를 dispatcher로 라우팅.
 *
 * 언제 planner를 사용하는가:
 * 1. 메시지 길이가 threshold 이상 (기본: 200자)
 * 2. 인텐트 분류 confidence가 낮음 (< 0.5)
 * 3. 다중 인텐트 감지
 * 4. 명시적 planner 요청 ("계획해줘", "plan", "step by step")
 * 5. policy에 planner 우선 표시
 */

const logger = require('./observability');

class TaskPlanner {
  constructor(options = {}) {
    // Planner 활성화 조건 임계값
    this.minMessageLength = options.minMessageLength || 200;     // 메시지 길이
    this.minConfidence = options.minConfidence || 0.5;           // 최소 신뢰도
    this.alwaysPlanKeywords = options.alwaysPlanKeywords || [
      '계획', 'plan', 'step by step', '순서대로', '워크플로우',
      'workflow', 'pipeline', '파이프라인', '프로세스', 'process'
    ];

    // Planner API 엔드포인트 (Hermes 사용)
    this.plannerEndpoint = options.plannerEndpoint || 'http://localhost:8000/chat';
    this.plannerTimeout = options.plannerTimeout || 15000;

    // 사용 가능한 agent 목록 (컨텍스트 제공용)
    this.agentRegistry = options.agentRegistry || null;
  }

  /**
   * Planner 실행 필요 여부 확인
   * @param {Object} parseResult - parser.js 결과
   * @param {string} message - 원본 요청 메시지
   * @param {Object} context - 추가 컨텍스트
   * @returns {Object} { needsPlanner: boolean, reason: string }
   */
  shouldPlan(parseResult, message, context = {}) {
    const reasons = [];

    // 1. 명시적 planner 요청 키워드
    const normalized = message.toLowerCase();
    for (const kw of this.alwaysPlanKeywords) {
      if (normalized.includes(kw.toLowerCase())) {
        reasons.push(`explicit_planning_keyword: ${kw}`);
      }
    }

    // 2. 메시지 길이
    if (message.length >= this.minMessageLength) {
      reasons.push(`long_message: ${message.length} chars`);
    }

    // 3. 낮은 confidence
    if (parseResult.confidence < this.minConfidence) {
      reasons.push(`low_confidence: ${parseResult.confidence}`);
    }

    // 4. 다중 인텐트
    if (parseResult.intents && parseResult.intents.length > 1) {
      reasons.push(`multiple_intents: ${parseResult.intents.join(', ')}`);
    }

    // 5. policy가 planner 우선으로 표시된 경우
    if (context.policy?.action?.planner_priority) {
      reasons.push('policy_planner_priority');
    }

    return {
      needsPlanner: reasons.length > 0,
      reasons
    };
  }

  /**
   * LLM(Hermes) 호출하여 태스크 분해
   * @param {string} message - 원본 요청
   * @param {Object} context - 컨텍스트 정보
   * @returns {Promise<Object>} { success, taskGraph, error }
   */
  async plan(message, context = {}) {
    const plannerPrompt = `You are a task decomposition system. Decompose the following user request into a sequence of atomic executable steps.

CRITICAL RULE: Do NOT assign agents, do NOT choose execution paths, do NOT suggest fallbacks. Only output the task graph.
Agent selection and routing are handled by a separate system.

USER REQUEST:
"${message.substring(0, 2000)}"

Respond with ONLY this JSON object (no markdown, no code blocks, pure JSON):
{
  "task_graph": [
    { "step": 1, "description": "what to do in this step", "details": "detailed instructions" }
  ],
  "reasoning": "why this decomposition makes sense",
  "estimated_complexity": "low|medium|high"
}

Rules:
- Each step is a single atomic action with clear input/output
- Do NOT include "agent" field — agent assignment is NOT your job
- Steps should be independent when possible
- Complexity: low (<3 steps), medium (3-5 steps), high (>5 steps)`;

    try {
      const result = await this._callPlannerAPI(plannerPrompt);
      return this._parsePlannerResult(result, message);
    } catch (e) {
      logger.warn('planner_failed', { error: e.message });
      return {
        success: false,
        taskGraph: null,
        error: e.message,
        needsPlanner: true,
        fallback_type: 'no_decomposition'
      };
    }
  }

  /**
   * Planner API 호출 (Hermes)
   */
  _callPlannerAPI(prompt) {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const url = new URL(this.plannerEndpoint);
      const payload = JSON.stringify({
        message: `[planner] ${prompt}`,
        mode: 'structured',
        response_format: 'json'
      });

      const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: this.plannerTimeout
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(body));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Planner API timeout'));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Planner 응답 파싱 — Hermes가 다양한 포맷으로 응답하는 경우 처리
   *
   * 지원 포맷:
   * 1. 순수 JSON: { "task_graph": [...] }
   * 2. Hermes 래퍼: { "reply": "```json\n{...}\n```" }
   * 3. Markdown code block: ```json\n{...}\n```
   */
  _parsePlannerResult(raw, originalMessage) {
    try {
      let content = typeof raw === 'string' ? raw : JSON.stringify(raw);

      // Step 1: Hermes 래퍼 ({ reply: "..." }) 처리
      try {
        const firstPass = JSON.parse(content);
        if (firstPass.reply && typeof firstPass.reply === 'string') {
          content = firstPass.reply;
        } else if (firstPass.task_graph) {
          // 이미 원하는 포맷
          return this._buildPlannerResponse(firstPass, originalMessage);
        }
      } catch (e) {
        // content가 JSON이 아니면 raw string 그대로 사용
      }

      // Step 2: Markdown code block 제거 (```json ... ```, ``` ... ```)
      content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      // Step 3: 순수 JSON 파싱
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        // Step 4: JSON 아닌 응답에서 task_graph 추출 시도
        const jsonMatch = content.match(/\{[\s\S]*"task_graph"[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No valid JSON found in planner response');
        }
      }

      return this._buildPlannerResponse(parsed, originalMessage);

    } catch (e) {
      return {
        success: false,
        taskGraph: null,
        error: `Failed to parse planner response: ${e.message}`,
        raw: typeof raw === 'string' ? raw.substring(0, 500) : JSON.stringify(raw).substring(0, 500)
      };
    }
  }

  /**
   * 파싱된 planner 결과를 표준 응답으로 변환
   */
  _buildPlannerResponse(parsed, originalMessage) {
    const taskGraph = parsed.task_graph;

    if (!taskGraph || !Array.isArray(taskGraph) || taskGraph.length === 0) {
      return {
        success: false,
        taskGraph: null,
        error: 'Planner returned empty task graph',
        raw: JSON.stringify(parsed).substring(0, 500)
      };
    }

    // 각 step 검증
    for (const step of taskGraph) {
      if (!step.description) step.description = `Step ${step.step || '?'}`;
      if (!step.details) step.details = step.description;
    }

    return {
      success: true,
      taskGraph,
      reasoning: parsed.reasoning || '',
      complexity: parsed.estimated_complexity || 'medium',
      original_message: originalMessage
    };
  }

  /**
   * (removed) _getAgentList — planner does NOT decide agent selection
   * Agent assignment is handled by dispatcher's parse→match pipeline.
   */

  /**
   * 태스크 그래프를 dispatcher 실행 형식으로 변환
   * @param {Object} planResult - plan() 결과
   * @returns {Object} dispatcher 호환 실행 계획
   */
  toDispatchSequence(planResult) {
    if (!planResult.success || !planResult.taskGraph) {
      return null;
    }

    return {
      type: 'planner_pipeline',
      steps: planResult.taskGraph.map((step, index) => ({
        index,
        agent: step.agent || 'direct',
        description: step.description || `Step ${index + 1}`,
        details: step.details || step.description,
        input: step.details || step.description
      })),
      complexity: planResult.complexity,
      reasoning: planResult.reasoning
    };
  }
}

module.exports = TaskPlanner;
