/**
 * circuit.js — Circuit Breaker (CLOSED / OPEN / HALF_OPEN)
 *
 * 연속 실패 시 에이전트 호출을 차단하고, cooldown 후 재시도.
 * 모든 에이전트별로 독립된 상태 관리.
 */

const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
  constructor(options = {}) {
    // 기본값
    this.defaultConfig = {
      failureThreshold: options.failureThreshold || 5,
      cooldownMs: options.cooldownMs || 30000,
      halfOpenMaxRequests: options.halfOpenMaxRequests || 3
    };

    // agent_id → { state, failures, successSinceHalfOpen, lastFailureAt, openedAt, config }
    this.states = new Map();
  }

  /**
   * 에이전트의 Circuit Breaker 상태 초기화
   */
  init(agentId, config = {}) {
    if (this.states.has(agentId)) return;

    this.states.set(agentId, {
      state: CircuitState.CLOSED,
      failures: 0,
      successSinceHalfOpen: 0,
      lastFailureAt: null,
      openedAt: null,
      config: {
        failureThreshold: config.failureThreshold || this.defaultConfig.failureThreshold,
        cooldownMs: config.cooldownMs || this.defaultConfig.cooldownMs,
        halfOpenMaxRequests: config.halfOpenMaxRequests || this.defaultConfig.halfOpenMaxRequests
      }
    });
  }

  /**
   * 요청 허용 여부 확인
   * @param {string} agentId
   * @returns {boolean} true=허용, false=차단
   */
  allowRequest(agentId) {
    if (!this.states.has(agentId)) {
      this.init(agentId);
      return true;
    }

    const state = this.states.get(agentId);

    switch (state.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN: {
        // cooldown 경과 확인
        if (!state.openedAt) return false;
        const elapsed = Date.now() - state.openedAt;
        if (elapsed >= state.config.cooldownMs) {
          // HALF_OPEN으로 전환
          state.state = CircuitState.HALF_OPEN;
          state.successSinceHalfOpen = 0;
          console.log(`[CIRCUIT] ${agentId}: OPEN → HALF_OPEN (cooldown elapsed)`);
          return true;
        }
        return false;
      }

      case CircuitState.HALF_OPEN:
        // HALF_OPEN에서는 제한된 요청만 허용
        return state.successSinceHalfOpen < state.config.halfOpenMaxRequests;

      default:
        return true;
    }
  }

  /**
   * 성공 기록
   */
  recordSuccess(agentId) {
    if (!this.states.has(agentId)) return;

    const state = this.states.get(agentId);
    state.failures = 0;
    state.lastFailureAt = null;

    if (state.state === CircuitState.HALF_OPEN) {
      state.successSinceHalfOpen++;

      if (state.successSinceHalfOpen >= state.config.halfOpenMaxRequests) {
        state.state = CircuitState.CLOSED;
        state.openedAt = null;
        console.log(`[CIRCUIT] ${agentId}: HALF_OPEN → CLOSED (recovered)`);
      }
    }
  }

  /**
   * 실패 기록
   */
  recordFailure(agentId) {
    if (!this.states.has(agentId)) {
      this.init(agentId);
    }

    const state = this.states.get(agentId);
    state.failures++;
    state.lastFailureAt = Date.now();

    switch (state.state) {
      case CircuitState.CLOSED:
        if (state.failures >= state.config.failureThreshold) {
          state.state = CircuitState.OPEN;
          state.openedAt = Date.now();
          console.log(`[CIRCUIT] ${agentId}: CLOSED → OPEN (${state.failures} failures)`);
        }
        break;

      case CircuitState.HALF_OPEN:
        // HALF_OPEN에서 실패 → 즉시 OPEN
        state.state = CircuitState.OPEN;
        state.openedAt = Date.now();
        console.log(`[CIRCUIT] ${agentId}: HALF_OPEN → OPEN (failure during recovery)`);
        break;

      case CircuitState.OPEN:
        // 이미 OPEN, cooldown 갱신
        state.openedAt = Date.now();
        break;
    }
  }

  /**
   * 현재 상태 조회
   */
  getState(agentId) {
    if (!this.states.has(agentId)) return null;
    return { ...this.states.get(agentId) };
  }

  /**
   * 모든 에이전트 상태 조회
   */
  getAllStates() {
    const result = {};
    for (const [agentId, state] of this.states) {
      result[agentId] = {
        state: state.state,
        failures: state.failures,
        lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null
      };
    }
    return result;
  }

  /**
   * 에이전트 리셋 (CLOSED로 강제 전환)
   */
  reset(agentId) {
    if (this.states.has(agentId)) {
      this.states.delete(agentId);
    }
    this.init(agentId);
  }
}

module.exports = { CircuitBreaker, CircuitState };
