/**
 * matcher.js — Policy 매칭 엔진
 *
 * 요청의 인텐트를 기반으로 가장 적합한 policy를 찾음.
 * priority가 높은 policy가 먼저 매칭, fallback 체인 지원.
 */

class PolicyMatcher {
  /**
   * @param {Object} policyData - policy.json 파싱 결과
   */
  constructor(policyData) {
    this.policies = policyData.policies || [];
    this.defaultAction = policyData.default_action || null;

    // priority 기준으로 정렬 (높은 순)
    this.policies.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * 인텐트/키워드 기반 policy 매칭
   * @param {Object} parseResult - parser.js의 결과
   * @returns {Object} { policy: Object|null, confidence: number }
   */
  match(parseResult) {
    const { intents, confidence, matched_rules: matchedRules } = parseResult;

    for (const policy of this.policies) {
      const match = policy.match;
      if (!match || Object.keys(match).length === 0) {
        // match {} → catch-all (default)
        return { policy, confidence: 1.0, match_source: 'catch_all' };
      }

      // intent 매칭
      if (match.intent && match.intent.length > 0) {
        const intentMatch = intents.some(intent =>
          match.intent.some(mi => intent.includes(mi) || mi.includes(intent))
        );
        if (!intentMatch) continue;
      }

      // keywords 매칭 (선택적 - 있으면 confidence 보정)
      if (match.keywords && match.keywords.length > 0) {
        const hasKeyword = matchedRules && matchedRules.some(r =>
          match.keywords.some(k => r.includes(k))
        );
        // 키워드 조건이 있지만 매칭 안 되면 confidence 낮춤
        if (!hasKeyword) {
          return { policy, confidence: Math.min(confidence, 0.6), match_source: 'intent_only' };
        }
      }

      // 완전 매칭
      return { policy, confidence, match_source: 'full_match' };
    }

    // 매칭 실패 → default action
    if (this.defaultAction) {
      return {
        policy: {
          id: 'default_action',
          priority: 0,
          action: this.defaultAction,
          observability: { label: 'default_action' }
        },
        confidence: 0.5,
        match_source: 'default_action'
      };
    }

    return { policy: null, confidence: 0, match_source: 'no_match' };
  }

  /**
   * 특정 policy ID 조회
   */
  getPolicy(policyId) {
    return this.policies.find(p => p.id === policyId) || null;
  }

  /**
   * pipeline policy의 각 step 검증
   */
  validatePipelineSteps(policy) {
    if (policy.action.type !== 'pipeline') return { valid: true };
    if (!policy.action.steps || policy.action.steps.length === 0) {
      return { valid: false, reason: 'pipeline_has_no_steps' };
    }

    // 중복 에이전트 체크
    const agents = policy.action.steps.map(s => s.agent);
    if (new Set(agents).size !== agents.length) {
      return { valid: false, reason: 'pipeline_has_duplicate_agents' };
    }

    return { valid: true };
  }

  /**
   * 모든 policy 나열 (디버깅용)
   */
  listPolicies() {
    return this.policies.map(p => ({
      id: p.id,
      priority: p.priority,
      type: p.action.type,
      description: p.description || ''
    }));
  }
}

module.exports = PolicyMatcher;
