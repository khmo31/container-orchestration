/**
 * validator.js — 시작 설정 검증
 *
 * dispatcher 시작 시 registry.json과 policy.json의
 * 유효성을 검증. 오류 발견 시 fail fast.
 */

class ConfigValidator {
  /**
   * registry.json 검증
   * @param {Object} registryData
   * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
   */
  validateRegistry(registryData) {
    const errors = [];
    const warnings = [];

    if (!registryData) {
      return { valid: false, errors: ['registry_data_is_null'], warnings: [] };
    }

    if (!registryData.schema_version) {
      errors.push('missing_schema_version');
    }

    if (!registryData.agents || Object.keys(registryData.agents).length === 0) {
      errors.push('no_agents_defined');
      return { valid: false, errors, warnings };
    }

    for (const [agentId, agent] of Object.entries(registryData.agents)) {
      // 비활성 에이전트는 스킵 (등록만 되어있고 미사용)
      if (agent.enabled === false) continue;

      // 필수 필드 검증
      if (!agent.name) {
        errors.push(`${agentId}: missing_name`);
      }

      if (!agent.endpoint) {
        errors.push(`${agentId}: missing_endpoint`);
      } else {
        if (!agent.endpoint.type) {
          errors.push(`${agentId}: missing_endpoint_type`);
        }

        if (agent.endpoint.type === 'http') {
          if (!agent.endpoint.url) {
            errors.push(`${agentId}: http_endpoint_missing_url`);
          }
        } else if (agent.endpoint.type === 'docker_exec') {
          if (!agent.endpoint.container) {
            errors.push(`${agentId}: docker_exec_missing_container`);
          }
        } else {
          errors.push(`${agentId}: unknown_endpoint_type_${agent.endpoint.type}`);
        }
      }

      // capability 검증
      if (!agent.capabilities || agent.capabilities.length === 0) {
        warnings.push(`${agentId}: no_capabilities_defined`);
      }

      // retry 설정 검증
      if (agent.retry) {
        const validBackoff = ['exponential', 'linear', 'fixed'];
        if (agent.retry.backoff && !validBackoff.includes(agent.retry.backoff)) {
          warnings.push(`${agentId}: unknown_backoff_type_${agent.retry.backoff}`);
        }
      }

      // fallback 검증
      if (agent.fallback) {
        const validStrategies = ['skip_with_warning', 'notify_user', 'fallback_agent', 'retry_later'];
        if (!validStrategies.includes(agent.fallback.strategy)) {
          warnings.push(`${agentId}: unknown_fallback_strategy_${agent.fallback.strategy}`);
        }

        // fallback이 가리키는 에이전트가 존재하는지 확인
        if (agent.fallback.alternatives) {
          for (const alt of agent.fallback.alternatives) {
            if (alt !== 'direct' && !registryData.agents[alt]) {
              warnings.push(`${agentId}: fallback_alternative_${alt}_not_in_registry`);
            }
          }
        }
      }

      // timeout 검증
      if (agent.timeout_ms !== undefined && (typeof agent.timeout_ms !== 'number' || agent.timeout_ms <= 0)) {
        errors.push(`${agentId}: invalid_timeout_ms`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * policy.json 검증
   * @param {Object} policyData
   * @param {Object} registryData - registry.json 데이터 (에이전트 존재 확인용)
   * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
   */
  validatePolicy(policyData, registryData) {
    const errors = [];
    const warnings = [];

    if (!policyData) {
      return { valid: false, errors: ['policy_data_is_null'], warnings: [] };
    }

    if (!policyData.schema_version) {
      errors.push('missing_schema_version');
    }

    if (!policyData.policies || policyData.policies.length === 0) {
      errors.push('no_policies_defined');
      return { valid: false, errors, warnings };
    }

    const policyIds = new Set();
    const agentIds = registryData ? Object.keys(registryData.agents) : [];

    for (const policy of policyData.policies) {
      // 중복 ID 검증
      if (!policy.id) {
        errors.push('policy_missing_id');
        continue;
      }

      if (policyIds.has(policy.id)) {
        errors.push(`${policy.id}: duplicate_policy_id`);
      }
      policyIds.add(policy.id);

      // priority 검증
      if (policy.priority === undefined || typeof policy.priority !== 'number') {
        errors.push(`${policy.id}: missing_or_invalid_priority`);
      }

      // action 검증
      if (!policy.action) {
        errors.push(`${policy.id}: missing_action`);
        continue;
      }

      const validTypes = ['route', 'pipeline'];
      if (!validTypes.includes(policy.action.type)) {
        errors.push(`${policy.id}: unknown_action_type_${policy.action.type}`);
      }

      // route 타입 검증
      if (policy.action.type === 'route') {
        if (!policy.action.target) {
          errors.push(`${policy.id}: route_action_missing_target`);
        } else {
          if (policy.action.target.primary && policy.action.target.primary !== 'direct') {
            if (!agentIds.includes(policy.action.target.primary)) {
              errors.push(`${policy.id}: target_agent_${policy.action.target.primary}_not_in_registry`);
            }
          }
          if (policy.action.target.fallback && policy.action.target.fallback !== 'direct') {
            if (!agentIds.includes(policy.action.target.fallback)) {
              errors.push(`${policy.id}: fallback_agent_${policy.action.target.fallback}_not_in_registry`);
            }
          }
        }
      }

      // pipeline 타입 검증
      if (policy.action.type === 'pipeline') {
        if (!policy.action.steps || policy.action.steps.length === 0) {
          errors.push(`${policy.id}: pipeline_has_no_steps`);
        } else {
          const stepAgents = [];
          for (let i = 0; i < policy.action.steps.length; i++) {
            const step = policy.action.steps[i];
            if (!step.agent) {
              errors.push(`${policy.id}: step_${i}_missing_agent`);
            } else {
              stepAgents.push(step.agent);
              if (!agentIds.includes(step.agent)) {
                errors.push(`${policy.id}: step_${i}_agent_${step.agent}_not_in_registry`);
              }
            }
            if (!step.stage) {
              warnings.push(`${policy.id}: step_${i}_missing_stage`);
            }
          }

          // cyclic dependency 검증 (동일한 에이전트가 파이프라인 내 중복)
          const uniqueAgents = new Set(stepAgents);
          if (stepAgents.length !== uniqueAgents.size) {
            warnings.push(`${policy.id}: possible_cyclic_pipeline`);
          }
        }

        // pipeline 실패 처리 검증
        const validOnStepFail = ['stop_and_report', 'skip_and_continue', 'retry_step', 'fallback_pipeline'];
        if (policy.action.on_step_fail && !validOnStepFail.includes(policy.action.on_step_fail)) {
          warnings.push(`${policy.id}: unknown_on_step_fail_${policy.action.on_step_fail}`);
        }
      }

      // match 필드 검증
      if (policy.match) {
        if (policy.match.intent && !Array.isArray(policy.match.intent)) {
          errors.push(`${policy.id}: match.intent_must_be_array`);
        }
        if (policy.match.keywords && !Array.isArray(policy.match.keywords)) {
          errors.push(`${policy.id}: match.keywords_must_be_array`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 전체 설정 검증
   */
  validate(registryData, policyData) {
    const registryResult = this.validateRegistry(registryData);
    const policyResult = this.validatePolicy(policyData, registryData);

    const combined = {
      valid: registryResult.valid && policyResult.valid,
      registry: registryResult,
      policy: policyResult,
      all_errors: [...registryResult.errors, ...policyResult.errors],
      all_warnings: [...registryResult.warnings, ...policyResult.warnings]
    };

    if (!combined.valid) {
      console.error('[VALIDATOR] Configuration validation FAILED');
      combined.all_errors.forEach(e => console.error(`  ✗ ${e}`));
    } else {
      console.log('[VALIDATOR] Configuration validation PASSED');
    }

    if (combined.all_warnings.length > 0) {
      console.warn('[VALIDATOR] Warnings:');
      combined.all_warnings.forEach(w => console.warn(`  ⚠ ${w}`));
    }

    return combined;
  }
}

module.exports = ConfigValidator;
