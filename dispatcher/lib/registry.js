/**
 * registry.js — Agent Registry 조회 및 관리
 *
 * registry.json을 읽어 에이전트 정보를 제공.
 * 헬스체크, capability 기반 조회, 활성 상태 확인.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'registry.json');

class AgentRegistry {
  constructor(registryPath = DEFAULT_REGISTRY_PATH) {
    this.path = registryPath;
    this.data = null;
    this.healthCache = new Map(); // agent_id → { healthy, lastChecked }
  }

  /** registry.json 로드 */
  load() {
    const raw = fs.readFileSync(this.path, 'utf-8');
    this.data = JSON.parse(raw);
    return this.data;
  }

  /** 전체 에이전트 목록 조회 */
  getAllAgents() {
    if (!this.data) this.load();
    return Object.entries(this.data.agents).map(([id, info]) => ({ id, ...info }));
  }

  /** 특정 에이전트 조회 */
  getAgent(agentId) {
    if (!this.data) this.load();
    return this.data.agents[agentId] || null;
  }

  /** 특정 capability를 가진 에이전트 목록 조회 */
  getAgentsByCapability(capability) {
    if (!this.data) this.load();
    return Object.entries(this.data.agents)
      .filter(([, info]) => info.enabled && info.capabilities.includes(capability))
      .map(([id, info]) => ({ id, ...info }));
  }

  /** 활성화(enable)된 에이전트만 조회 */
  getEnabledAgents() {
    if (!this.data) this.load();
    return Object.entries(this.data.agents)
      .filter(([, info]) => info.enabled === true)
      .map(([id, info]) => ({ id, ...info }));
  }

  /** 에이전트 활성화 상태 확인 */
  isEnabled(agentId) {
    const agent = this.getAgent(agentId);
    return agent ? agent.enabled === true : false;
  }

  /**
   * 에이전트 헬스체크 (HTTP 기반 에이전트만)
   * docker_exec 타입은 컨테이너 존재 여부로 확인
   */
  async healthCheck(agentId) {
    const agent = this.getAgent(agentId);
    if (!agent) return { healthy: false, reason: 'unknown_agent' };

    const endpoint = agent.endpoint;

    if (endpoint.type === 'docker_exec') {
      // 컨테이너 존재 여부 확인
      try {
        const { execSync } = require('child_process');
        const result = execSync(
          `docker ps --filter "name=${endpoint.container}" --format "{{.Names}}"`,
          { timeout: 5000, encoding: 'utf-8' }
        ).trim();
        const healthy = result === endpoint.container;
        this._updateHealthCache(agentId, healthy);
        return { healthy, reason: healthy ? 'container_running' : 'container_not_found' };
      } catch (e) {
        this._updateHealthCache(agentId, false);
        return { healthy: false, reason: `docker_check_failed: ${e.message}` };
      }
    }

    if (endpoint.type === 'http' && endpoint.health_check) {
      try {
        const start = Date.now();
        const healthy = await this._httpHealthCheck(endpoint.health_check, agent.timeout_ms || 5000);
        const latency = Date.now() - start;
        this._updateHealthCache(agentId, healthy);
        return { healthy, latency_ms: latency, reason: healthy ? 'ok' : 'unreachable' };
      } catch (e) {
        this._updateHealthCache(agentId, false);
        return { healthy: false, reason: e.message };
      }
    }

    // 헬스체크 불가 타입
    return { healthy: true, reason: 'health_check_not_configured' };
  }

  /** 모든 에이전트 헬스체크 */
  async healthCheckAll() {
    const agents = this.getEnabledAgents();
    const results = {};
    for (const agent of agents) {
      results[agent.id] = await this.healthCheck(agent.id);
    }
    return results;
  }

  /** 캐시된 헬스 상태 조회 */
  getCachedHealth(agentId) {
    return this.healthCache.get(agentId) || null;
  }

  _updateHealthCache(agentId, healthy) {
    this.healthCache.set(agentId, { healthy, lastChecked: Date.now() });
  }

  _httpHealthCheck(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on('error', (e) => reject(`health_check_failed: ${e.message}`));
      req.on('timeout', () => { req.destroy(); reject('health_check_timeout'); });
    });
  }

  /** registry.json에 에이전트 추가 */
  addAgent(agentId, agentConfig) {
    if (!this.data) this.load();
    if (this.data.agents[agentId]) {
      return { success: false, reason: 'agent_already_exists' };
    }
    this.data.agents[agentId] = agentConfig;
    this.data.meta.last_updated = new Date().toISOString().slice(0, 10);
    this._save();
    return { success: true };
  }

  /** registry.json에 에이전트 업데이트 */
  updateAgent(agentId, updates) {
    if (!this.data) this.load();
    if (!this.data.agents[agentId]) {
      return { success: false, reason: 'agent_not_found' };
    }
    this.data.agents[agentId] = { ...this.data.agents[agentId], ...updates };
    this.data.meta.last_updated = new Date().toISOString().slice(0, 10);
    this._save();
    return { success: true };
  }

  _save() {
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
  }
}

module.exports = AgentRegistry;
