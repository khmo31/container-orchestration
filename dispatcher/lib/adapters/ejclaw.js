/**
 * adapters/ejclaw.js — EJClaw Adapter
 *
 * EJClaw (Discord tribunal multi-agent) 컨테이너와의 통신을 담당.
 * EJClaw는 Discord bot 프레임워크로, 직접 CLI 호출이 제한적.
 *
 * 접근 방식:
 * 1. 우선: Shared workspace volume (/workspace)에 task 파일 작성
 * 2. 대체: Hermes로 fallback
 *
 * docker-compose의 workspace-data volume을 통해 /workspace 공유.
 */

const { execSync } = require('child_process');

class EJClawAdapter {
  constructor() {
    this.container = 'aifactory-ejclaw';
  }

  /**
   * EJClaw 실행
   * 
   * Task를 shared workspace에 파일로 작성하고,
   * 가능하면 container 내부 runner를 호출.
   * 실패 시 Hermes fallback 권장.
   */
  async execute(params) {
    const startTime = Date.now();
    const taskId = `task_${params.requestId}`;

    // 1. Shared workspace에 task 파일 작성
    const writeResult = this._writeTaskFile(taskId, params);
    if (!writeResult.success) {
      return {
        success: false,
        error: `workspace_write_failed: ${writeResult.error}`,
        durationMs: Date.now() - startTime,
        adapter: 'ejclaw',
        fallback_suggested: 'hermes'
      };
    }

    // 2. Container 내 runner 호출 시도
    const runnerResult = await this._tryRunInContainer(params);
    if (runnerResult.success) {
      return {
        success: true,
        data: {
          reply: runnerResult.output,
          task_id: taskId,
          workspace_path: writeResult.path,
          type: 'ejclaw_exec'
        },
        durationMs: Date.now() - startTime
      };
    }

    // 3. Runner 실패 → workspace에 task만 기록하고 fallback 권장
    return {
      success: true,
      data: {
        reply: `Task written to workspace: ${writeResult.path}. EJClaw Discord bot will pick it up when running. For immediate response, use Hermes fallback.`,
        task_id: taskId,
        workspace_path: writeResult.path,
        type: 'ejclaw_workspace'
      },
      durationMs: Date.now() - startTime,
      requires_external: true,
      fallback_suggested: 'hermes'
    };
  }

  /**
   * Container 내부 shared workspace에 task 파일 작성
   * docker exec -i (stdin pipe) → cat 로 컨테이너 안에서 직접 처리
   * 호스트 디스크 권한 문제 회피 (컨테이너는 root로 실행)
   */
  _writeTaskFile(taskId, params) {
    try {
      const taskContent = JSON.stringify({
        task_id: taskId,
        request_id: params.requestId,
        message: params.message,
        created_at: new Date().toISOString(),
        source: 'dispatcher',
        context: params.context || {}
      });

      const taskFile = `/workspace/workspace/tasks/${taskId}.json`;

      // mkdir + write via docker exec stdin pipe
      const cmd = `docker exec -i ${this.container} sh -c 'mkdir -p /workspace/workspace/tasks && cat > "${taskFile}"'`;
      execSync(cmd, {
        input: taskContent,
        timeout: 10000,
        encoding: 'utf-8',
        maxBuffer: 1024 * 64
      });

      return { success: true, path: taskFile };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Container 내에서 runner 실행 시도
   * docker exec으로 bun runner를 직접 호출
   */
  async _tryRunInContainer(params) {
    try {
      // bun dist/index.js with args - check if entrypoint supports it
      const safeMessage = params.message.replace(/"/g, '\\"').replace(/'/g, "'\\''");
      const cmd = `docker exec -i ${this.container} bun /ejclaw/dist/index.js --task "${safeMessage}" 2>/dev/null`;
      
      const stdout = execSync(cmd, {
        timeout: 10000, // short timeout for probing
        encoding: 'utf-8',
        maxBuffer: 1024
      });

      return { success: true, output: stdout.trim() };
    } catch {
      // Runner not available - expected for Discord bot
      return { success: false };
    }
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

module.exports = EJClawAdapter;
