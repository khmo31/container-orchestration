/**
 * reflection.js — 실행 결과 기록 및 학습 모듈
 *
 * 모든 디스패치 결과를 기록하고, 성공/실패 패턴을 분석하여
 * policy 자동 개선을 제안.
 *
 * 데이터 구조:
 *   reflections/YYYY-MM-DD.jsonl — 일별 실행 로그
 *   reflections/patterns.json — 집계된 패턴 데이터
 *   reflections/policy_suggestions.json — policy 개선 제안
 */

const fs = require('fs');
const path = require('path');
const logger = require('./observability');

const REFLECTIONS_DIR = path.join(__dirname, '..', 'reflections');

// 디렉토리 없으면 생성
if (!fs.existsSync(REFLECTIONS_DIR)) {
  fs.mkdirSync(REFLECTIONS_DIR, { recursive: true });
}

class ReflectionEngine {
  constructor(options = {}) {
    this.reflectionsDir = options.reflectionsDir || REFLECTIONS_DIR;
    this.patternsPath = path.join(this.reflectionsDir, 'patterns.json');
    this.suggestionsPath = path.join(this.reflectionsDir, 'policy_suggestions.json');
    this.minSamplesForSuggestion = options.minSamplesForSuggestion || 5;
    this.failureRateThreshold = options.failureRateThreshold || 0.3; // 30% 이상 실패면 제안

    // Intent-Agent 적합도 매핑 (quality score 산출용)
    // 특정 intent에 가장 적합한 agent 정의
    this.intentAgentFit = {
      bug: { best: 'ejclaw', alt: 'hermes' },
      feature: { best: 'metagpt', alt: 'ejclaw' },
      review: { best: 'ejclaw', alt: 'hermes' },
      analysis: { best: 'hermes', alt: 'direct' },
      pdf: { best: 'hermes', alt: 'direct' },
      trading: { best: 'tradingagent', alt: 'hermes' },
      finance: { best: 'tradingagent', alt: 'hermes' },
      record: { best: 'hermes', alt: 'direct' },
      strategy: { best: 'direct', alt: 'hermes' },
      config: { best: 'direct', alt: null },
      planning: { best: 'metagpt', alt: 'direct' }
    };

    // Agent별 예상 timeout (ms) - duration quality score 산출용
    this.agentTimeoutMap = {
      hermes: 120000,
      metagpt: 300000,
      ejclaw: 300000,
      tradingagent: 600000
    };

    // 패턴 데이터 초기화
    this._initPatterns();
  }

  /**
   * 패턴 데이터 초기화 (파일 없으면 생성)
   */
  _initPatterns() {
    if (!fs.existsSync(this.patternsPath)) {
      this._writePatterns({
        last_updated: new Date().toISOString(),
        agents: {},
        policies: {},
        intents: {},
        time_analysis: {
          by_hour: {},
          by_day: {}
        },
        total_executions: 0,
        total_successes: 0,
        total_failures: 0
      });
    }

    if (!fs.existsSync(this.suggestionsPath)) {
      this._writeSuggestions([]);
    }
  }

  /**
   * 실행 결과 기록
   * @param {Object} result - dispatcher.dispatch() 결과
   */
  record(result) {
    if (!result) return;

    const entry = {
      timestamp: result.timestamp || new Date().toISOString(),
      request_id: result.request_id,
      policy_id: result.policy_id,
      intent: result.intent || [],
      confidence: result.confidence || 0,
      success: result.success || false,
      duration_ms: result.duration_ms || 0,
      fallback_used: result.fallback_used || false,
      error: result.error || null,
      escalation_triggered: result.escalation_triggered || false
    };

    // 에이전트 호출 정보 추출
    if (result.result) {
      if (result.result.agent_id) {
        entry.agent_id = result.result.agent_id;
      }
      if (result.result.attempts) {
        entry.attempts = result.result.attempts;
      }
      if (result.result.fallback_result) {
        entry.fallback_agent_id = result.result.fallback_result.agent_id;
      }
      if (result.result.completed_steps !== undefined) {
        entry.pipeline_steps = result.result.completed_steps;
        entry.pipeline_total = result.result.total_steps;
      }
    }

    // 1. 일별 로그 파일에 기록
    this._appendLog(entry);

    // 1.5. 품질 점수 계산 (bias 방지)
    entry.quality_score = this._calculateQualityScore(entry);

    // 2. 패턴 업데이트 (quality-adjusted)
    this._updatePatterns(entry);
  }

  /**
   * 품질 점수 계산 — 단순 success/failure의 bias를 방지
   *
   * Base score:
   *   success = 1.0, failure = 0.0
   *
   * Penalties:
   *   - Fallback penalty: -0.3 if fallback was used even on success
   *     (primary agent 실패 후 대체 agent가 성공한 건 '운 좋은 성공')
   *   - Duration penalty: -0.1 if duration > 50% of agent's expected timeout
   *     (성공했어도 너무 오래 걸리면 비효율)
   *   - Agent-intent mismatch penalty: -0.2 if wrong agent was used
   *     (분석 작업을 ejclaw가 처리하면 품질 낮음)
   *   - Escalation penalty: -0.1 if escalation was triggered
   *
   * Bonus:
   *   - Low latency bonus: +0.1 if duration < 10% of timeout (빠른 처리)
   *
   * Final score is clamped to [0.0, 1.0]
   */
  _calculateQualityScore(entry) {
    // Base score
    let score = entry.success ? 1.0 : 0.0;

    // === PENALTIES ===

    // 1. Fallback penalty: fallback 성공은 'lucky success'
    if (entry.fallback_used && entry.success) {
      score -= 0.3;
    }

    // 2. Duration penalty: 너무 오래 걸린 성공
    if (entry.success && entry.duration_ms > 0) {
      const agentId = entry.agent_id || entry.fallback_agent_id || '';
      const expectedTimeout = this.agentTimeoutMap[agentId] || 120000;
      const durationRatio = entry.duration_ms / expectedTimeout;

      if (durationRatio > 0.5) {
        score -= 0.1; // 절반 이상 timeout 소모
      }
      if (durationRatio > 0.8) {
        score -= 0.1; // 80% 이상 소모
      }

      // Low latency bonus: 매우 빠르면 보너스
      if (durationRatio < 0.1 && entry.success) {
        score += 0.1;
      }
    }

    // 3. Agent-intent mismatch penalty
    if (entry.intent && entry.intent.length > 0 && entry.agent_id) {
      const primaryIntent = entry.intent[0];
      const usedAgent = entry.agent_id || entry.fallback_agent_id || '';
      const fit = this.intentAgentFit[primaryIntent];

      if (fit) {
        // Best agent가 아닌 agent로 성공 → 품질 낮음
        if (fit.best && usedAgent !== fit.best && usedAgent !== '' && usedAgent !== 'direct') {
          score -= 0.2;
        }
      }
    }

    // 4. Escalation penalty
    if (entry.escalation_triggered) {
      score -= 0.1;
    }

    // Clamp
    return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  }
  _appendLog(entry) {
    const today = entry.timestamp.slice(0, 10);
    const logFile = path.join(this.reflectionsDir, `${today}.jsonl`);
    try {
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    } catch (e) {
      logger.error('reflection_log_write_failed', { error: e.message, file: logFile });
    }
  }

  /**
   * 패턴 데이터 업데이트 (quality-adjusted)
   */
  _updatePatterns(entry) {
    const patterns = this._readPatterns();
    const qs = entry.quality_score !== undefined ? entry.quality_score : (entry.success ? 1.0 : 0.0);

    patterns.total_executions++;
    if (entry.success) {
      patterns.total_successes++;
    } else {
      patterns.total_failures++;
    }
    patterns.last_updated = new Date().toISOString();

    // 누적 quality score (가중 평균용)
    if (patterns.total_quality === undefined) patterns.total_quality = 0;
    patterns.total_quality = ((patterns.total_quality || 0) * (patterns.total_executions - 1) + qs) / patterns.total_executions;

    // Policy별 집계 (quality-adjusted)
    const pid = entry.policy_id || 'unknown';
    if (!patterns.policies[pid]) {
      patterns.policies[pid] = {
        executions: 0, successes: 0, failures: 0,
        avg_duration_ms: 0, fallbacks: 0,
        quality_score: 0, quality_weight: 0  // 누적 quality
      };
    }
    const p = patterns.policies[pid];
    p.executions++;
    if (entry.success) p.successes++;
    else p.failures++;
    p.avg_duration_ms = (p.avg_duration_ms * (p.executions - 1) + entry.duration_ms) / p.executions;
    if (entry.fallback_used) p.fallbacks++;
    // Quality-weighted stats
    p.quality_score = (p.quality_score * p.quality_weight + qs) / (p.quality_weight + 1);
    p.quality_weight++;

    // Agent별 집계 (quality-adjusted)
    const agentsToTrack = [];
    if (entry.agent_id) agentsToTrack.push(entry.agent_id);
    if (entry.fallback_agent_id) agentsToTrack.push(entry.fallback_agent_id);

    for (const aid of agentsToTrack) {
      if (!patterns.agents[aid]) {
        patterns.agents[aid] = {
          executions: 0, successes: 0, failures: 0,
          avg_duration_ms: 0, quality_score: 0, quality_weight: 0
        };
      }
      const a = patterns.agents[aid];
      a.executions++;
      if (entry.success) a.successes++;
      else a.failures++;
      a.avg_duration_ms = (a.avg_duration_ms * (a.executions - 1) + entry.duration_ms) / a.executions;
      a.quality_score = (a.quality_score * a.quality_weight + qs) / (a.quality_weight + 1);
      a.quality_weight++;
    }

    // Intent별 집계 (quality-adjusted)
    for (const intent of entry.intent || []) {
      if (!patterns.intents[intent]) {
        patterns.intents[intent] = {
          executions: 0, successes: 0, failures: 0,
          quality_score: 0, quality_weight: 0
        };
      }
      const it = patterns.intents[intent];
      it.executions++;
      if (entry.success) it.successes++;
      else it.failures++;
      it.quality_score = (it.quality_score * it.quality_weight + qs) / (it.quality_weight + 1);
      it.quality_weight++;
    }

    // 시간대별 분석
    const hour = new Date(entry.timestamp).getHours();
    const day = new Date(entry.timestamp).toLocaleString('en-US', { weekday: 'short' });

    if (!patterns.time_analysis.by_hour[hour]) {
      patterns.time_analysis.by_hour[hour] = { executions: 0, successes: 0, failures: 0 };
    }
    patterns.time_analysis.by_hour[hour].executions++;
    if (entry.success) patterns.time_analysis.by_hour[hour].successes++;
    else patterns.time_analysis.by_hour[hour].failures++;

    if (!patterns.time_analysis.by_day[day]) {
      patterns.time_analysis.by_day[day] = { executions: 0, successes: 0, failures: 0 };
    }
    patterns.time_analysis.by_day[day].executions++;
    if (entry.success) patterns.time_analysis.by_day[day].successes++;
    else patterns.time_analysis.by_day[day].failures++;

    this._writePatterns(patterns);

    // Policy 개선 제안 생성
    this._generateSuggestions(patterns);
  }

  /**
   * Policy 개선 제안 생성 (quality-adjusted)
   *
   * 단순 success/failure가 아닌 quality score 기반으로 판단:
   * - Quality score < 0.5 = 'low quality' (success여도 낮은 quality 가능)
   * - Fallback 성공은 'lucky success'로 처리 (bias 방지)
   * - Agent-intent mismatch 감지 (잘못된 agent가 작업을 처리함)
   */
  _generateSuggestions(patterns) {
    const suggestions = [];

    for (const [pid, stats] of Object.entries(patterns.policies)) {
      if (stats.executions < this.minSamplesForSuggestion) continue;

      const failureRate = stats.failures / stats.executions;
      const adjustedFailureRate = 1 - (stats.quality_score || 0);

      // Quality-adjusted 실패율 기반 제안
      if (adjustedFailureRate > this.failureRateThreshold || failureRate > this.failureRateThreshold) {
        const useAdjusted = adjustedFailureRate > failureRate;
        const effectiveRate = useAdjusted ? adjustedFailureRate : failureRate;
        const reason = useAdjusted
          ? `Policy "${pid}" quality-adjusted failure rate ${(effectiveRate * 100).toFixed(0)}% (quality: ${stats.quality_score?.toFixed(2) || 'N/A'}, raw: ${stats.failures}/${stats.executions})`
          : `Policy "${pid}" failure rate ${(effectiveRate * 100).toFixed(0)}% (${stats.failures}/${stats.executions})`;

        suggestions.push({
          type: 'policy_improvement',
          target: pid,
          priority: effectiveRate > 0.5 ? 'high' : 'medium',
          reason,
          suggestion: this._getPolicyImprovementSuggestion(pid, stats, effectiveRate),
          generated: new Date().toISOString(),
          applied: false
        });
      }

      // Fallback 과다 사용 감지 (quality-adjusted)
      const fallbackRate = stats.fallbacks / stats.executions;
      if (fallbackRate > 0.4) {
        suggestions.push({
          type: 'fallback_optimization',
          target: pid,
          priority: fallbackRate > 0.6 ? 'high' : 'medium',
          reason: `Policy "${pid}" fallback rate ${(fallbackRate * 100).toFixed(0)}% (${stats.fallbacks}/${stats.executions}), quality: ${(stats.quality_score || 0).toFixed(2)}`,
          suggestion: `Fallback 사용률이 높아 quality에 부정적 영향. primary agent 신뢰성 확인 또는 policy 우선순위 재조정 필요.`,
          generated: new Date().toISOString(),
          applied: false
        });
      }

      // Quality-low-but-success-high 감지 (bias 패턴)
      const successRate = stats.successes / stats.executions;
      if (successRate > 0.7 && (stats.quality_score || 0) < 0.5) {
        suggestions.push({
          type: 'quality_bias_warning',
          target: pid,
          priority: 'high',
          reason: `Policy "${pid}": success rate ${(successRate * 100).toFixed(0)}% but quality score ${(stats.quality_score || 0).toFixed(2)} — fallback/lucky successes inflating stats`,
          suggestion: `성공률은 높지만 품질 점수가 낮습니다. fallback 의존도가 높거나 부적합한 agent가 사용되고 있을 수 있습니다.`,
          generated: new Date().toISOString(),
          applied: false
        });
      }
    }

    // Agent별 제안 (quality-adjusted)
    for (const [aid, stats] of Object.entries(patterns.agents)) {
      if (stats.executions < this.minSamplesForSuggestion) continue;

      const failureRate = stats.failures / stats.executions;
      const adjustedFailureRate = 1 - (stats.quality_score || 0);
      const effectiveRate = Math.max(failureRate, adjustedFailureRate);

      if (effectiveRate > this.failureRateThreshold) {
        suggestions.push({
          type: 'agent_health',
          target: aid,
          priority: effectiveRate > 0.5 ? 'high' : 'medium',
          reason: `Agent "${aid}" quality-adjusted failure rate ${(effectiveRate * 100).toFixed(0)}% (quality: ${(stats.quality_score || 0).toFixed(2)})`,
          suggestion: `에이전트 ${aid}의 실패율 및 품질 점수를 고려해 circuit breaker 설정 검토 또는 fallback alternative 추가를 권장합니다.`,
          generated: new Date().toISOString(),
          applied: false
        });
      }

      // 지연 시간 이상 감지
      if (stats.avg_duration_ms > 60000 && stats.executions > 3) {
        suggestions.push({
          type: 'latency_warning',
          target: aid,
          priority: 'medium',
          reason: `Agent "${aid}" 평균 응답 시간 ${(stats.avg_duration_ms / 1000).toFixed(1)}초 (${stats.executions}회 기준, quality: ${(stats.quality_score || 0).toFixed(2)})`,
          suggestion: '에이전트 응답 시간이 길어 timeout 위험이 있습니다. timeout_ms 증가 또는 경량 모델 사용을 고려하세요.',
          generated: new Date().toISOString(),
          applied: false
        });
      }

      // Quality-failure-reality-gap 감지
      const agentSuccessRate = stats.successes / stats.executions;
      if (agentSuccessRate > 0.6 && (stats.quality_score || 0) < 0.4) {
        suggestions.push({
          type: 'agent_mismatch_warning',
          target: aid,
          priority: 'high',
          reason: `Agent "${aid}": success ${(agentSuccessRate * 100).toFixed(0)}% but quality ${(stats.quality_score || 0).toFixed(2)} — agent may be wrong for assigned tasks`,
          suggestion: `이 에이전트가 맡은 작업 유형과 적합도가 맞지 않을 수 있습니다. policy에서 이 에이전트를 사용하는 intent를 재검토하세요.`,
          generated: new Date().toISOString(),
          applied: false
        });
      }
    }

    // Intent 기반 제안 (quality-adjusted)
    for (const [intent, stats] of Object.entries(patterns.intents)) {
      if (stats.executions < this.minSamplesForSuggestion) continue;

      // Quality score가 낮은 intent 감지
      if ((stats.quality_score || 0) < 0.4 && stats.executions >= 3) {
        suggestions.push({
          type: 'intent_quality_warning',
          target: intent,
          priority: 'medium',
          reason: `Intent "${intent}" quality score ${(stats.quality_score || 0).toFixed(2)} (${stats.executions} executions, ${stats.successes} successes)`,
          suggestion: `"${intent}" 인텐트에 매칭되는 policy의 적합도를 재검토하세요. agent 할당이 부적절하거나 keywords가 정확하지 않을 수 있습니다.`,
          generated: new Date().toISOString(),
          applied: false
        });
      }

      // Intent-agent fit 확인: best agent가 아닌 agent가 많이 사용된 경우
      const fit = this.intentAgentFit[intent];
      if (fit && fit.best && stats.executions >= 3) {
        // 이 인텐트의 에이전트별 사용 비율은 patterns 에이전트 데이터에서 추론
        // 간단히 quality가 낮고 success가 높으면 mismatch 의심
        if ((stats.quality_score || 0) < 0.5 && stats.successes / stats.executions > 0.6) {
          suggestions.push({
            type: 'agent_mismatch_intent',
            target: intent,
            priority: 'medium',
            reason: `Intent "${intent}" best agent is "${fit.best}" but quality ${(stats.quality_score || 0).toFixed(2)} suggests mismatch`,
            suggestion: `"${intent}" 인텐트의 best agent는 ${fit.best}입니다. 현재 policy에서 다른 agent가 할당되고 있는지 확인하세요.`,
            generated: new Date().toISOString(),
            applied: false
          });
        }
      }
    }

    // Low-usage intent 경고 (기존 유지)
    const lowUsageIntents = Object.entries(patterns.intents)
      .filter(([, stats]) => stats.executions > 0 && stats.executions < 3);
    for (const [intent, stats] of lowUsageIntents) {
      if (stats.failures > 0) {
        suggestions.push({
          type: 'intent_config',
          target: intent,
          priority: 'low',
          reason: `Intent "${intent}" 사용 횟수 ${stats.executions}회 중 ${stats.failures}회 실패`,
          suggestion: `"${intent}" 인텐트에 대한 policy가 부적절할 수 있습니다. keywords 정확도 확인 또는 새 policy 등록을 권장합니다.`,
          generated: new Date().toISOString(),
          applied: false
        });
      }
    }

    this._writeSuggestions(suggestions);
  }

  /**
   * Policy 개선 제안 텍스트 생성
   */
  _getPolicyImprovementSuggestion(pid, stats, failureRate) {
    const common = {
      bug_short_circuit: 'bug keywords 정확도 확인, fallback을 hermes가 아닌 ejclaw 재시도로 변경',
      new_feature: 'MetaGPT 컨테이너 상태 확인, pipeline step timeout 증가',
      code_review: 'EJClaw 컨테이너 상태 확인, fallback 순서 변경',
      complex_analysis: 'Hermes API 상태 확인, PDF 처리 타임아웃 증가',
      trading_finance: 'auto-trading 컨테이너 연결 확인, hermes fallback 우선순위 상향',
      recording: 'Hermes API 상태 확인, record_mode 파라미터 검증',
      strategy_review: '직접 처리 우선, 불필요한 policy fallback 제거',
      default_direct: '새 policy 등록 필요 (catch-all policy로는 부적합)'
    };

    return common[pid] || `Policy "${pid}"의 우선순위/매칭 조건 재검토 필요`;
  }

  /**
   * 패턴 데이터 읽기
   */
  _readPatterns() {
    try {
      return JSON.parse(fs.readFileSync(this.patternsPath, 'utf-8'));
    } catch (e) {
      return this._getEmptyPatterns();
    }
  }

  /**
   * 패턴 데이터 쓰기
   */
  _writePatterns(data) {
    fs.writeFileSync(this.patternsPath, JSON.stringify(data, null, 2));
  }

  /**
   * 제안 데이터 읽기
   */
  _getSuggestions() {
    try {
      return JSON.parse(fs.readFileSync(this.suggestionsPath, 'utf-8'));
    } catch (e) {
      return [];
    }
  }

  /**
   * 제안 데이터 쓰기
   */
  _writeSuggestions(data) {
    fs.writeFileSync(this.suggestionsPath, JSON.stringify(data, null, 2));
  }

  /**
   * 빈 패턴 템플릿
   */
  _getEmptyPatterns() {
    return {
      last_updated: new Date().toISOString(),
      agents: {},
      policies: {},
      intents: {},
      time_analysis: { by_hour: {}, by_day: {} },
      total_executions: 0,
      total_successes: 0,
      total_failures: 0,
      total_quality: 0  // overall quality score (moving average)
    };
  }

  /**
   * 패턴 요약 조회
   */
  getSummary() {
    const patterns = this._readPatterns();
    const suggestions = this._getSuggestions();

    const agentSummary = Object.entries(patterns.agents).map(([id, stats]) => ({
      id,
      executions: stats.executions,
      success_rate: stats.executions > 0 ? (stats.successes / stats.executions * 100).toFixed(1) + '%' : 'N/A',
      quality_score: stats.quality_score !== undefined ? stats.quality_score.toFixed(2) : 'N/A',
      avg_duration_ms: Math.round(stats.avg_duration_ms)
    }));

    const policySummary = Object.entries(patterns.policies).map(([id, stats]) => ({
      id,
      executions: stats.executions,
      success_rate: stats.executions > 0 ? (stats.successes / stats.executions * 100).toFixed(1) + '%' : 'N/A',
      quality_score: stats.quality_score !== undefined ? stats.quality_score.toFixed(2) : 'N/A',
      fallback_rate: stats.executions > 0 ? (stats.fallbacks / stats.executions * 100).toFixed(1) + '%' : 'N/A'
    }));

    return {
      total_executions: patterns.total_executions,
      total_successes: patterns.total_successes,
      total_failures: patterns.total_failures,
      overall_success_rate: patterns.total_executions > 0
        ? (patterns.total_successes / patterns.total_executions * 100).toFixed(1) + '%'
        : 'N/A',
      overall_quality_score: patterns.total_quality !== undefined
        ? patterns.total_quality.toFixed(2)
        : 'N/A',
      agents: agentSummary,
      policies: policySummary,
      pending_suggestions: suggestions.filter(s => !s.applied).length,
      last_updated: patterns.last_updated
    };
  }

  /**
   * 적용되지 않은 제안 목록
   */
  getPendingSuggestions() {
    return this._getSuggestions().filter(s => !s.applied);
  }

  /**
   * 제안 적용 완료 표시
   */
  markSuggestionApplied(suggestionId) {
    const suggestions = this._getSuggestions();
    const idx = suggestions.findIndex(s => this._suggestionKey(s) === suggestionId);
    if (idx >= 0) {
      suggestions[idx].applied = true;
      suggestions[idx].applied_at = new Date().toISOString();
      this._writeSuggestions(suggestions);
      return true;
    }
    return false;
  }

  _suggestionKey(s) {
    return `${s.type}_${s.target}_${s.generated}`;
  }

  /**
   * 특정 날짜의 로그 조회
   */
  getLogs(dateStr, limit = 100) {
    const logFile = path.join(this.reflectionsDir, `${dateStr}.jsonl`);
    if (!fs.existsSync(logFile)) return [];
    const content = fs.readFileSync(logFile, 'utf-8');
    return content.trim().split('\n').filter(Boolean).slice(-limit).map(l => JSON.parse(l));
  }
}

module.exports = ReflectionEngine;
