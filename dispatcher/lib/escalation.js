/**
 * escalation.js — 에스컬레이션 레이어
 *
 * dispatcher가 처리 불가능한 상황에서:
 * 1. 상황 분석 (no policy, low confidence, all agents failed, circuit open)
 * 2. GitHub 저장소 검색 (관련 repo 추천)
 * 3. 대체 접근법 제안
 * 4. 사용자에게 구조화된 보고
 */

const RepoSearch = require('./repo_search');
const logger = require('./observability');

class EscalationHandler {
  /**
   * @param {Object} options
   * @param {Object} options.registry - AgentRegistry 인스턴스
   * @param {Object} options.repoSearch - RepoSearch 인스턴스
   * @param {boolean} options.enableRepoSearch - GitHub 검색 활성화 여부
   */
  constructor(options = {}) {
    this.registry = options.registry || null;
    this.repoSearch = options.repoSearch || new RepoSearch();
    this.enableRepoSearch = options.enableRepoSearch !== undefined ? options.enableRepoSearch : true;

    // 에스컬레이션 조건 정의
    this.escalationTriggers = {
      no_matching_policy: {
        severity: 'high',
        description: 'No matching policy for request intent'
      },
      low_confidence: {
        severity: 'medium',
        description: 'Intent classification confidence below threshold'
      },
      all_agents_failed: {
        severity: 'high',
        description: 'All primary and fallback agents failed'
      },
      circuit_open: {
        severity: 'medium',
        description: 'Target agent circuit breaker is open'
      },
      execution_error: {
        severity: 'high',
        description: 'Dispatcher execution error'
      }
    };
  }

  /**
   * 에스컬레이션 실행
   * @param {Object} context - 에스컬레이션 컨텍스트
   * @param {string} context.reason - 트리거 이유
   * @param {string} context.message - 원본 요청 메시지
   * @param {Object} context.intents - 분류된 인텐트
   * @param {Object} context.error - 에러 정보
   * @param {Object} context.attempts - 시도 정보
   * @returns {Promise<Object>} 에스컬레이션 결과
   */
  async escalate(context) {
    const reason = context.reason || 'unknown';
    const trigger = this.escalationTriggers[reason] || { severity: 'medium', description: reason };
    const requestId = context.requestId || 'unknown';

    logger.warn('escalation_triggered', {
      request_id: requestId,
      reason,
      severity: trigger.severity,
      message_preview: (context.message || '').substring(0, 100)
    });

    // 1. 분석: 현재 상황 진단
    const diagnosis = this._diagnose(context);

    // 2. GitHub 저장소 검색
    let repoSuggestions = [];
    if (this.enableRepoSearch) {
      const intent = context.intents && context.intents.length > 0 ? context.intents[0] : 'unknown';
      const searchResult = await this.repoSearch.searchByIntent(intent, context.message);
      repoSuggestions = searchResult.repos || [];
      logger.info('escalation_repo_search', {
        request_id: requestId,
        intent,
        found_repos: repoSuggestions.length
      });
    }

    // 3. 대체 접근법 제안
    const alternatives = this._suggestAlternatives(context, diagnosis);

    // 4. 응답 구성
    const response = this._buildResponse({
      reason,
      severity: trigger.severity,
      diagnosis,
      repo_suggestions: repoSuggestions,
      alternatives,
      requestId
    });

    logger.info('escalation_completed', {
      request_id: requestId,
      severity: trigger.severity,
      alternatives_count: alternatives.length
    });

    return response;
  }

  /**
   * 상황 진단
   */
  _diagnose(context) {
    const diagnosis = {
      reason: context.reason,
      severity: this.escalationTriggers[context.reason]?.severity || 'medium',
      details: []
    };

    switch (context.reason) {
      case 'no_matching_policy':
        diagnosis.details.push('현재 등록된 policy로는 이 요청을 처리할 수 없습니다.');
        if (context.intents && context.intents.length > 0) {
          diagnosis.details.push(`분류된 인텐트: ${context.intents.join(', ')}`);
        }
        break;

      case 'low_confidence':
        diagnosis.details.push('인텐트 분류 신뢰도가 낮아 안정적인 처리가 어렵습니다.');
        diagnosis.details.push(`신뢰도: ${context.confidence || 'N/A'}`);
        break;

      case 'all_agents_failed': {
        const attempts = context.attempts || [];
        diagnosis.details.push(`모든 에이전트 시도 실패 (${attempts.length}회 시도)`);
        for (const attempt of attempts) {
          diagnosis.details.push(`  - ${attempt.agentId}: ${attempt.error || 'unknown error'}`);
        }
        break;
      }

      case 'circuit_open':
        diagnosis.details.push(`서킷 브레이커 OPEN: ${context.targetAgent || 'unknown'} 에이전트`);
        diagnosis.details.push('일정 시간 후 자동 복구를 시도합니다.');
        break;

      case 'execution_error':
        diagnosis.details.push(`실행 오류: ${context.error?.message || 'Unknown error'}`);
        break;

      default:
        diagnosis.details.push(`예상치 못한 상황: ${context.reason}`);
    }

    return diagnosis;
  }

  /**
   * 현재 상황에 맞는 대체 접근법 제안
   */
  _suggestAlternatives(context, diagnosis) {
    const alternatives = [];
    const intent = context.intents && context.intents.length > 0 ? context.intents[0] : null;

    // 1. 새로운 policy 제안
    switch (intent) {
      case 'planning':
        alternatives.push({
          type: 'new_policy',
          title: 'Planner Policy 추가',
          description: '새로운 planner 레이어가 필요합니다. dispatcher/lib/planner.js 구현 후 policy.json에 planner_policy 추가.',
          effort: 'medium'
        });
        break;

      case 'trading':
        alternatives.push({
          type: 'check_container',
          title: 'auto-trading 컨테이너 상태 확인',
          description: 'tradingagent 컨테이너가 실행 중인지 확인: docker ps | grep auto-trading',
          effort: 'low'
        });
        break;

      case 'analysis':
        alternatives.push({
          type: 'hermes_fallback',
          title: 'Hermes 직접 호출',
          description: 'Hermes API(http://localhost:8000/chat)를 직접 호출하여 분석 시도',
          effort: 'low'
        });
        break;
    }

    // 2. 일반적인 대안
    if (context.reason === 'no_matching_policy' || context.reason === 'low_confidence') {
      alternatives.push({
        type: 'clarify',
        title: '요청 명확화',
        description: '요청을 더 구체적으로 작성해주시면 정확한 처리가 가능합니다.',
        effort: 'low'
      });
    }

    // 3. 모든 에이전트 실패 시
    if (context.reason === 'all_agents_failed') {
      alternatives.push({
        type: 'service_check',
        title: '서비스 상태 확인',
        description: 'Docker 컨테이너 상태 확인: dispatcher --health',
        effort: 'low'
      });
      alternatives.push({
        type: 'manual_handling',
        title: '직접 처리 요청',
        description: 'Claw(나)가 직접 처리합니다. dispatcher 우회.',
        effort: 'low'
      });
    }

    // 4. circuit open 시
    if (context.reason === 'circuit_open') {
      alternatives.push({
        type: 'wait_and_retry',
        title: '잠시 후 재시도',
        description: '서킷 브레이커가 자동 복구될 때까지 기다린 후 재시도합니다.',
        effort: 'low'
      });
    }

    return alternatives;
  }

  /**
   * 최종 응답 메시지 빌드
   */
  _buildResponse(data) {
    const { reason, severity, diagnosis, repo_suggestions, alternatives } = data;

    // 사용자 메시지 (한국어)
    const userMessages = {
      no_matching_policy: '이 요청을 처리할 적절한 정책을 찾을 수 없습니다.',
      low_confidence: '요청 의도를 정확히 파악하기 어렵습니다.',
      all_agents_failed: '모든 에이전트가 요청 처리에 실패했습니다.',
      circuit_open: '대상 에이전트가 현재 복구 중입니다.',
      execution_error: '요청 처리 중 오류가 발생했습니다.',
      unknown: '알 수 없는 이유로 요청을 처리할 수 없습니다.'
    };

    return {
      escalation: true,
      reason,
      severity,
      summary: userMessages[reason] || userMessages.unknown,
      diagnosis: diagnosis.details,
      repo_suggestions: repo_suggestions.map(r => ({
        name: r.name,
        description: r.description,
        url: r.url,
        stars: r.stars,
        language: r.language
      })),
      alternatives: alternatives.map(a => ({
        type: a.type,
        title: a.title,
        description: a.description,
        effort: a.effort || 'medium'
      })),
      // 메타데이터
      timestamp: new Date().toISOString(),
      escalation_id: `esc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`
    };
  }

  /**
   * 에스컬레이션 조건 확인 퀵 체크
   * @param {Object} dispatchResult - dispatcher 결과
   * @returns {boolean} 에스컬레이션 필요 여부
   */
  needsEscalation(dispatchResult) {
    if (!dispatchResult) return false;

    // 명시적 에스컬레이션 필요 조건
    if (dispatchResult.error === 'no_matching_policy') return true;
    if (dispatchResult.circuit_open) return true;
    if (dispatchResult.error && dispatchResult.escalation_required) return true;

    // 모든 fallback 실패
    if (dispatchResult.fallback_used && !dispatchResult.success) return true;

    return false;
  }
}

module.exports = EscalationHandler;
