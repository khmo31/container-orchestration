/**
 * dedupe.js — request_id 기반 중복 요청 방지
 *
 * retry나 중복 전송 시 동일 요청이 여러 번 실행되는 것을 방지.
 * in-memory TTL 캐시로 최근 처리된/처리 중인 요청을 추적.
 */

class DedupeTracker {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || 5 * 60 * 1000; // 기본 5분
    this.maxEntries = options.maxEntries || 10000;
    this.store = new Map();
    this.cleanupInterval = null;

    // 주기적 cleanup (5분마다)
    this.cleanupInterval = setInterval(() => this._cleanup(), 60000);
    // Node.js 종료 시 인터벌 정리
    if (typeof process !== 'undefined' && process.on) {
      process.on('exit', () => {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
      });
    }
  }

  /**
   * 요청 등록
   * @param {string} requestId
   * @param {string} status - 'pending' | 'completed' | 'failed'
   * @returns {boolean} true=신규 등록, false=중복
   */
  register(requestId, status = 'pending') {
    if (this.store.has(requestId)) {
      return false; // 중복 요청
    }

    // LRU-like eviction: 오래된 항목 제거
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.entries().next().value;
      if (oldest) this.store.delete(oldest[0]);
    }

    this.store.set(requestId, {
      status,
      registeredAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs
    });

    return true;
  }

  /**
   * 요청 상태 업데이트
   */
  update(requestId, status) {
    if (!this.store.has(requestId)) return false;
    this.store.set(requestId, {
      ...this.store.get(requestId),
      status
    });
    return true;
  }

  /**
   * 요청 상태 조회
   */
  getStatus(requestId) {
    const entry = this.store.get(requestId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(requestId);
      return null;
    }
    return entry.status;
  }

  /**
   * 중복 확인만 (등록 없이)
   */
  isDuplicate(requestId) {
    return this.store.has(requestId);
  }

  /**
   * 만료된 항목 정리
   */
  _cleanup() {
    const now = Date.now();
    for (const [id, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(id);
      }
    }
  }

  /**
   * 현재 추적 중인 요청 수
   */
  get size() {
    return this.store.size;
  }

  /**
   * 전체 초기화
   */
  clear() {
    this.store.clear();
  }
}

module.exports = DedupeTracker;
