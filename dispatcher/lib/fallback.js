/**
 * fallback.js — 장애 대응 전략
 *
 * 에이전트 호출 실패 시 실행되는 fallback 전략.
 * skip / fallback_agent / notify_user / retry_later 지원.
 */

class FallbackHandler {
  /**
   * @param {Object} registry - AgentRegistry 인스턴스
   * @param {Object} executor - AgentExecutor 인스턴스
   */
  constructor(registry, executor) {
    this.registry = registry;
    this.executor = executor;
  }

  /**
   * fallback 실행
   * @param {string} agentId - 실패한 에이전트
   * @param {Object} result - 실패 결과
   * @param {Object} params - 원래 요청 파라미터
   * @returns {Promise<Object>} fallback 실행 결과
   */
  async execute(agentId, result, params) {
    const agent = this.registry.getAgent(agentId);
    if (!agent) {
      return { success: false, fallback: 'none', message: 'Agent not found in registry' };
    }

    const strategy = agent.fallback?.strategy || 'notify_user';
    const alternatives = agent.fallback?.alternatives || [];

    switch (strategy) {
      case 'skip_with_warning':
        return this._skipWithWarning(agentId, result);

      case 'notify_user':
        return this._notifyUser(agentId, result);

      case 'fallback_agent':
        return this._fallbackToAgent(agentId, alternatives, result, params);

      case 'retry_later':
        return this._retryLater(agentId, result);

      default:
        return this._notifyUser(agentId, result);
    }
  }

  /**
   * 경고만 하고 skip
   */
  _skipWithWarning(agentId, result) {
    return {
      success: false,
      fallback: 'skip_with_warning',
      message: `${agentId} failed but was skipped (non-critical)`,
      original_error: result.error,
      circuit_open: result.circuitOpen || false
    };
  }

  /**
   * 사용자에게 알림
   */
  _notifyUser(agentId, result) {
    const reason = result.circuitOpen
      ? 'Circuit breaker is OPEN (too many failures)'
      : result.error || 'Unknown error';

    return {
      success: false,
      fallback: 'notify_user',
      message: `${agentId} is currently unavailable. ${reason}`,
      original_error: result.error,
      circuit_open: result.circuitOpen || false,
      user_message: `⚠️ ${agentId} 에이전트가 응답하지 않습니다. (${reason}) 직접 처리하거나 나중에 다시 시도해주세요.`
    };
  }

  /**
   * 대체 에이전트로 fallback
   */
  async _fallbackToAgent(agentId, alternatives, result, params) {
    if (!alternatives || alternatives.length === 0) {
      return this._notifyUser(agentId, result);
    }

    for (const altAgentId of alternatives) {
      if (altAgentId === agentId) continue;

      const altAgent = this.registry.getAgent(altAgentId);
      if (!altAgent || !altAgent.enabled) continue;

      console.log(`[FALLBACK] ${agentId} → ${altAgentId}`);
      const fallbackResult = await this.executor.execute(altAgentId, params);

      if (fallbackResult.success) {
        return {
          success: true,
          fallback: 'fallback_agent',
          original_agent: agentId,
          used_agent: altAgentId,
          data: fallbackResult.data,
          original_error: result.error
        };
      }
    }

    // 모든 대체 에이전트 실패
    return this._notifyUser(agentId, {
      ...result,
      error: `${result.error} (all fallbacks failed)`
    });
  }

  /**
   * 나중에 재시도 (큐에 저장)
   */
  async _retryLater(agentId, result) {
    // TODO: 추후 persistent queue 연동
    // 현재는 메모리에 기록만 하고 notify
    return {
      success: false,
      fallback: 'retry_later',
      message: `${agentId} failed. Will retry later (queued).`,
      original_error: result.error,
      requeued: true
    };
  }

  /**
   * policy의 fallback 체인 실행
   * @param {Object} policy - 매칭된 policy
   * @param {Object} result - 실패 결과
   * @param {Object} params - 요청 파라미터
   */
  async executePolicyFallback(policy, result, params) {
    const policyFallback = policy.action.target?.fallback;

    if (!policyFallback) {
      return this._notifyUser('policy', {
        error: `Policy ${policy.id} execution failed with no fallback`
      });
    }

    if (policyFallback === 'direct') {
      // 직접 처리 (Claw)
      return {
        success: true,
        fallback: 'direct',
        message: 'Falling back to direct handling',
        data: null
      };
    }

    // 특정 에이전트로 fallback
    return this._fallbackToAgent('policy_fallback', [policyFallback], result, params);
  }
}

module.exports = FallbackHandler;
