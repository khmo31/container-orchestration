/**
 * adapters/metagpt.js — MetaGPT Adapter
 *
 * MetaGPT 컨테이너와의 통신을 담당.
 * docker exec을 통해 MetaGPT의 CLI를 호출.
 *
 * 실행 명령어:
 *   docker exec -w /workspace aifactory-metagpt metagpt "<task>" --project-name "<name>" [--inc]
 */

const { execSync } = require('child_process');

class MetaGPTAdapter {
  constructor() {
    this.container = 'aifactory-metagpt';
  }

  /**
   * MetaGPT 실행
   * @param {Object} params - { message, requestId, context }
   * @returns {Promise<Object>} { success, data, durationMs }
   */
  async execute(params) {
    const startTime = Date.now();
    const cmd = this._buildCommand(params);

    try {
      const stdout = execSync(cmd, {
        timeout: params.timeout_ms || 300000,
        maxBuffer: 50 * 1024 * 1024,
        encoding: 'utf-8'
      });

      return {
        success: true,
        data: {
          reply: stdout.trim(),
          type: 'metagpt_exec',
          container: this.container
        },
        durationMs: Date.now() - startTime
      };
    } catch (e) {
      return {
        success: false,
        error: `metagpt_exec_failed: ${e.message}`,
        stdout: e.stdout?.trim() || '',
        stderr: e.stderr?.trim() || '',
        durationMs: Date.now() - startTime
      };
    }
  }

  /**
   * Docker exec 명령어 빌드
   * aifactory.sh의 `dc exec -T metagpt metagpt "$@"` 패턴과 동일
   */
  _buildCommand(params) {
    const message = params.message || '';
    const projectName = params.context?.project_name || 'auto-project';
    const stage = params.context?.pipeline_stage || '';

    // 메시지에서 쌍따옴표 이스케이프
    const safeMessage = message.replace(/"/g, '\\"');

    // 파이프라인 단계별 flags
    let flags = `--project-name "${projectName}" --inc`;
    if (stage === 'qa') {
      flags = `--project-name "${projectName}" --run-tests`;
    }

    return `docker exec -w /workspace ${this.container} metagpt "${safeMessage}" ${flags}`;
  }

  /**
   * 컨테이너 상태 확인
   */
  healthCheck() {
    try {
      const result = execSync(
        `docker ps --filter "name=${this.container}" --format "{{.Names}}"`,
        { timeout: 5000, encoding: 'utf-8' }
      ).trim();
      return result === this.container;
    } catch {
      return false;
    }
  }
}

module.exports = MetaGPTAdapter;
