/**
 * observability.js — 로깅, 트레이싱, 메트릭
 *
 * 모든 dispatcher 동작은 이 모듈을 통해 기록됨.
 * request_id 기반으로 전체 요청 흐름 추적 가능.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// 로그 디렉토리 없으면 생성
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

class Logger {
  constructor() {
    this.sessionId = null;
  }

  setSessionId(id) {
    this.sessionId = id;
  }

  /**
   * 새 request_id 발급
   */
  generateRequestId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `req_${timestamp}_${random}`;
  }

  /**
   * 구조화된 로그 이벤트 기록 (JSON line)
   */
  log(level, event, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      session_id: this.sessionId,
      ...data
    };

    const line = JSON.stringify(entry);

    // stdout (실시간)
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${event}]`;
    const suffix = data.request_id ? ` [req:${data.request_id}]` : '';
    console.log(`${prefix}${suffix}`, JSON.stringify(data, null, 0));

    // 파일 기록
    const logFile = path.join(LOG_DIR, `dispatcher-${new Date().toISOString().slice(0, 10)}.jsonl`);
    try {
      fs.appendFileSync(logFile, line + '\n');
    } catch (e) {
      console.error(`[LOG ERROR] cannot write to ${logFile}: ${e.message}`);
    }
  }

  info(event, data) { this.log('info', event, data); }
  warn(event, data) { this.log('warn', event, data); }
  error(event, data) { this.log('error', event, data); }
  debug(event, data) { this.log('debug', event, data); }

  /**
   * 요청 시작 추적
   */
  startTrace(requestId, message, intent) {
    this.info('request_start', {
      request_id: requestId,
      message_preview: message.substring(0, 100),
      intent
    });
  }

  /**
   * 정책 매칭 결과 추적
   */
  traceMatch(requestId, policyId, confidence) {
    this.info('policy_match', { request_id: requestId, policy_id: policyId, confidence });
  }

  /**
   * 에이전트 호출 추적
   */
  traceAgentCall(requestId, agentId, durationMs, success) {
    this.info('agent_call', {
      request_id: requestId,
      agent_id: agentId,
      duration_ms: durationMs,
      success
    });
  }

  /**
   * 요청 완료 추적
   */
  endTrace(requestId, result) {
    this.info('request_end', {
      request_id: requestId,
      result: result ? 'success' : 'failed',
      total_duration_ms: result?.durationMs
    });
  }

  /**
   * 최근 로그 조회 (디버깅용)
   */
  getRecentLogs(lines = 50) {
    const logFile = path.join(LOG_DIR, `dispatcher-${new Date().toISOString().slice(0, 10)}.jsonl`);
    if (!fs.existsSync(logFile)) return [];
    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content.trim().split('\n').filter(Boolean);
    const recent = allLines.slice(-lines);
    return recent.map(l => JSON.parse(l));
  }
}

module.exports = new Logger();
