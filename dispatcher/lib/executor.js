/**
 * executor.js — 에이전트 호출 추상화
 *
 * HTTP API 기반 에이전트와 docker exec 기반 에이전트를
 * 통일된 인터페이스로 실행. timeout/retry/circuit breaker와 연동.
 */

const http = require('http');
const { execSync, exec: execCb } = require('child_process');
const util = require('util');
const execPromise = util.promisify(execCb);
const adapterRegistry = require('./adapters');

class AgentExecutor {
  /**
   * @param {Object} registry - AgentRegistry 인스턴스
   * @param {Object} circuitBreaker - CircuitBreaker 인스턴스
   */
  constructor(registry, circuitBreaker) {
    this.registry = registry;
    this.circuitBreaker = circuitBreaker;
  }

  /**
   * 에이전트 호출 (통일 인터페이스)
   * @param {string} agentId
   * @param {Object} params - { message, requestId, context }
   * @returns {Promise<Object>} { success, data, durationMs, agentId }
   */
  async execute(agentId, params) {
    const agent = this.registry.getAgent(agentId);
    if (!agent) {
      return { success: false, error: `unknown_agent: ${agentId}` };
    }

    if (!agent.enabled) {
      return { success: false, error: `agent_disabled: ${agentId}` };
    }

    // Circuit breaker 확인
    if (!this.circuitBreaker.allowRequest(agentId)) {
      return { success: false, error: `circuit_open: ${agentId}`, circuitOpen: true };
    }

    // Knowledge base context hint: 에이전트가 회사 문서 참조 가능하면 프롬프트에 포함
    let enrichedMessage = params.message;
    if (agent.context_hint) {
      enrichedMessage = agent.context_hint + '\n\n' + enrichedMessage;
    }
    const enrichedParams = { ...params, message: enrichedMessage };

    const startTime = Date.now();
    const endpointType = agent.endpoint.type;
    let result;

    try {
      switch (endpointType) {
        case 'http':
          result = await this._executeHTTP(agent, enrichedParams);
          break;
        case 'docker_exec':
          result = await this._executeDocker(agent, enrichedParams);
          break;
        default:
          result = { success: false, error: `unsupported_endpoint_type: ${endpointType}` };
      }
    } catch (e) {
      result = { success: false, error: e.message };
    } finally {
      // Adapter 사용 시에도 circuit breaker 업데이트는 여기서
      if (result?.adapter_used) {
        // adapter가 자체적으로 결과를 반환함
      }
    }

    const durationMs = Date.now() - startTime;

    // Circuit breaker 상태 업데이트
    if (result.success) {
      this.circuitBreaker.recordSuccess(agentId);
    } else {
      this.circuitBreaker.recordFailure(agentId);
    }

    return {
      ...result,
      agentId,
      durationMs
    };
  }

  /**
   * HTTP 기반 에이전트 호출
   */
  _executeHTTP(agent, params) {
    return new Promise((resolve) => {
      const url = new URL(agent.endpoint.url);
      const payload = JSON.stringify({
        message: params.message,
        request_id: params.requestId,
        context: params.context || {}
      });

      const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: agent.endpoint.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Request-Id': params.requestId || ''
        },
        timeout: agent.timeout_ms || 30000
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          const success = res.statusCode >= 200 && res.statusCode < 300;
          let data = null;
          try { data = JSON.parse(body); } catch (e) { data = body; }
          resolve({ success, statusCode: res.statusCode, data });
        });
      });

      req.on('error', (e) => resolve({ success: false, error: `http_error: ${e.message}` }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: `timeout_${agent.timeout_ms}ms` });
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Docker exec 기반 에이전트 호출
   * 전용 adapter가 있으면 adapter 사용, 없으면 generic docker exec
   */
  async _executeDocker(agent, params) {
    const container = agent.endpoint.container;

    // 컨테이너 존재 확인
    try {
      const check = execSync(
        `docker ps --filter "name=${container}" --format "{{.Names}}"`,
        { timeout: 5000, encoding: 'utf-8' }
      ).trim();

      if (check !== container) {
        return { success: false, error: `container_not_running: ${container}` };
      }
    } catch (e) {
      return { success: false, error: `docker_check_failed: ${e.message}` };
    }

    // 전용 adapter 확인
    const adapter = adapterRegistry.getAdapter(agent.id || container, agent);
    if (adapter) {
      try {
        const result = await adapter.execute(params);
        result.adapter_used = true;
        return result;
      } catch (e) {
        return {
          success: false,
          error: `adapter_failed: ${e.message}`,
          adapter_used: true
        };
      }
    }

    // Generic docker exec (adapter 없는 경우)
    const shell = agent.endpoint.shell || '/bin/bash';
    const workdir = agent.endpoint.workdir || '/app';
    const escapedMessage = params.message
      .replace(/'/g, "'\\''")
      .replace(/"/g, '\\"');

    const cmd = `docker exec -i -w ${workdir} ${container} ${shell} -c '${escapedMessage}'`;

    try {
      const { stdout, stderr } = await execPromise(cmd, {
        timeout: agent.timeout_ms || 300000,
        maxBuffer: 10 * 1024 * 1024
      });

      return {
        success: true,
        data: {
          stdout: stdout.trim(),
          stderr: stderr.trim()
        }
      };
    } catch (e) {
      return {
        success: false,
        error: `execution_failed: ${e.message}`,
        stdout: e.stdout?.trim() || '',
        stderr: e.stderr?.trim() || ''
      };
    }
  }
}

module.exports = AgentExecutor;
