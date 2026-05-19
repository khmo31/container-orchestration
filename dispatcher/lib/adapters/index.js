/**
 * adapters/index.js — Adapter Registry
 *
 * 모든 에이전트 어댑터를 통합 관리.
 * executor.js에서 호출됨.
 */

const MetaGPTAdapter = require('./metagpt');
const EJClawAdapter = require('./ejclaw');

// HTTP 기반 에이전트는 executor.js가 직접 처리
// docker_exec 기반 에이전트는 여기서 adapter 적용

const adapterMap = {
  'aifactory-metagpt': MetaGPTAdapter,
  'aifactory-ejclaw': EJClawAdapter
};

class AdapterRegistry {
  /**
   * 에이전트에 맞는 adapter 인스턴스 반환
   * @param {string} agentId - registry의 agent id
   * @param {Object} agentConfig - registry.json의 agent 설정
   * @returns {Object|null} adapter 인스턴스 또는 null (adapter 불필요)
   */
  getAdapter(agentId, agentConfig) {
    const containerName = agentConfig?.endpoint?.container;

    // container name 기반 adapter 매칭
    if (containerName && adapterMap[containerName]) {
      return new adapterMap[containerName]();
    }

    // agentId 기반 매칭
    if (adapterMap[agentId]) {
      return new adapterMap[agentId]();
    }

    return null;
  }

  /**
   * adapter 존재 여부 확인
   */
  hasAdapter(agentId, agentConfig) {
    return this.getAdapter(agentId, agentConfig) !== null;
  }

  /**
   * adapter 목록 조회
   */
  listAdapters() {
    return Object.keys(adapterMap);
  }
}

module.exports = new AdapterRegistry();
