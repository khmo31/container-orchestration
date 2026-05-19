/**
 * retry.js — 재시도 전략 (exponential / linear backoff)
 *
 * registry.json에 정의된 retry 설정에 따라 동작.
 * request_id 기반으로 중복 실행 방지 (dedupe 연동).
 */

class RetryHandler {
  /**
   * @param {Object} retryConfig - registry.json의 retry 설정
   * @param {Object} dedupeTracker - DedupeTracker 인스턴스 (선택)
   */
  constructor(retryConfig = {}, dedupeTracker = null) {
    this.maxAttempts = retryConfig.max_attempts || 3;
    this.backoffType = retryConfig.backoff || 'exponential';
    this.initialDelayMs = retryConfig.initial_delay_ms || 1000;
    this.maxDelayMs = retryConfig.max_delay_ms || 60000;
    this.dedupe = dedupeTracker;
  }

  /**
   * 지연 시간 계산
   * @param {number} attempt - 0-based attempt number
   * @returns {number} 지연 시간 (ms)
   */
  getDelay(attempt) {
    let delay;

    switch (this.backoffType) {
      case 'exponential':
        delay = this.initialDelayMs * Math.pow(2, attempt);
        break;
      case 'linear':
        delay = this.initialDelayMs * (attempt + 1);
        break;
      case 'fixed':
        delay = this.initialDelayMs;
        break;
      default:
        delay = this.initialDelayMs * Math.pow(2, attempt);
    }

    // jitter 추가 (+-20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    delay = Math.round(delay + jitter);

    // 최대 지연 시간 제한
    return Math.min(delay, this.maxDelayMs);
  }

  /**
   * 재시도 가능 여부 확인
   */
  shouldRetry(attempt, error) {
    if (attempt >= this.maxAttempts) return false;

    // 특정 에러는 재시도 불필요
    const noRetryErrors = [
      'unknown_agent',
      'unknown_capability',
      'invalid_request',
      'policy_validation_failed'
    ];

    if (error && noRetryErrors.some(e => error.includes(e))) {
      return false;
    }

    return true;
  }

  /**
   * 재시도 지연 대기
   */
  async wait(attempt) {
    const delay = this.getDelay(attempt);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 재시도 가능 총 시간 (max theoretical time)
   */
  getMaxTotalTimeMs() {
    let total = 0;
    for (let i = 0; i < this.maxAttempts; i++) {
      total += this.getDelay(i);
    }
    return total;
  }
}

module.exports = RetryHandler;
