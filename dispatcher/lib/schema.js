/**
 * schema.js — 메시지 스키마 정의
 *
 * dispatcher의 모든 통신에 사용되는 데이터 구조 정의.
 * Pydantic 스타일의 JSON Schema 기반 validation.
 *
 * 각 스키마는 다음을 포함:
 * - 필드 정의 (타입, 필수 여부, 설명)
 * - validation 함수
 * - 기본값
 */

/**
 * 요청 메시지 스키마
 * khmo → dispatcher
 */
const DispatchRequestSchema = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      description: 'khmo의 요청 메시지',
      minLength: 1,
      maxLength: 10000
    },
    context: {
      type: 'object',
      description: '요청 컨텍스트 (채널, 세션 등)',
      properties: {
        sessionId: { type: 'string', description: '세션 ID' },
        channel: { type: 'string', description: '발신 채널 (discord, signal 등)' },
        senderId: { type: 'string', description: '발신자 ID' },
        timestamp: { type: 'string', format: 'date-time', description: '요청 시간' }
      },
      additionalProperties: true
    }
  },
  required: ['message']
};

/**
 * 인텐트 분류 결과 스키마
 * parser.js의 출력
 */
const IntentResultSchema = {
  type: 'object',
  properties: {
    intents: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['bug', 'feature', 'review', 'analysis', 'trading', 'record', 'strategy', 'config', 'unknown']
      },
      description: '분류된 인텐트 (priority 순)'
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: '분류 신뢰도'
    },
    llm_used: {
      type: 'boolean',
      description: 'LLM 레이어 사용 여부'
    },
    matched_rules: {
      type: 'array',
      items: { type: 'string' },
      description: '매칭된 룰 목록'
    }
  },
  required: ['intents', 'confidence']
};

/**
 * Policy 매칭 결과 스키마
 * matcher.js의 출력
 */
const PolicyMatchSchema = {
  type: 'object',
  properties: {
    policy_id: {
      type: 'string',
      description: '매칭된 policy ID'
    },
    priority: {
      type: 'number',
      description: 'policy 우선순위'
    },
    action_type: {
      type: 'string',
      enum: ['route', 'pipeline'],
      description: '실행 액션 타입'
    },
    match_source: {
      type: 'string',
      enum: ['full_match', 'intent_only', 'catch_all', 'default_action'],
      description: '매칭 소스'
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: '매칭 신뢰도'
    }
  },
  required: ['policy_id', 'priority']
};

/**
 * Agent 호출 요청 스키마
 * executor → adapter → agent
 */
const AgentCallRequestSchema = {
  type: 'object',
  properties: {
    agent_id: {
      type: 'string',
      description: '호출 대상 에이전트 ID'
    },
    message: {
      type: 'string',
      description: '에이전트에 전달할 메시지',
      maxLength: 50000
    },
    request_id: {
      type: 'string',
      description: '요청 추적 ID'
    },
    timeout_ms: {
      type: 'number',
      description: '타임아웃 (ms)',
      default: 30000
    },
    retry_count: {
      type: 'number',
      description: '현재 재시도 횟수',
      default: 0
    },
    context: {
      type: 'object',
      description: '추가 컨텍스트',
      properties: {
        pipeline_stage: { type: 'string', description: '파이프라인 단계' },
        workspace_dir: { type: 'string', description: '작업 디렉토리' }
      }
    }
  },
  required: ['agent_id', 'message', 'request_id']
};

/**
 * Agent 호출 응답 스키마
 * adapter의 출력
 */
const AgentCallResponseSchema = {
  type: 'object',
  properties: {
    success: {
      type: 'boolean',
      description: '호출 성공 여부'
    },
    data: {
      type: 'object',
      description: '에이전트 응답 데이터',
      properties: {
        reply: { type: 'string', description: '텍스트 응답' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '파일 경로' },
              content: { type: 'string', description: '파일 내용' }
            }
          },
          description: '생성된 파일 목록'
        },
        duration_ms: { type: 'number', description: '실행 시간' }
      }
    },
    error: {
      type: 'string',
      description: '에러 메시지 (실패 시)'
    },
    statusCode: {
      type: 'number',
      description: 'HTTP 상태 코드 (HTTP 타입만)'
    },
    circuitOpen: {
      type: 'boolean',
      description: 'Circuit breaker OPEN 상태'
    }
  },
  required: ['success']
};

/**
 * Dispatcher 최종 응답 스키마
 * dispatcher의 출력 (khmo에게 보고)
 */
const DispatchResponseSchema = {
  type: 'object',
  properties: {
    success: {
      type: 'boolean',
      description: '처리 성공 여부'
    },
    request_id: {
      type: 'string',
      description: '요청 추적 ID'
    },
    policy_id: {
      type: 'string',
      description: '적용된 policy ID'
    },
    intent: {
      type: 'array',
      items: { type: 'string' },
      description: '분류된 인텐트'
    },
    confidence: {
      type: 'number',
      description: '전체 처리 신뢰도'
    },
    duration_ms: {
      type: 'number',
      description: '총 처리 시간 (ms)'
    },
    fallback_used: {
      type: 'boolean',
      description: 'Fallback 사용 여부'
    },
    result: {
      type: 'object',
      description: '실행 결과 상세'
    },
    error: {
      type: 'string',
      description: '에러 메시지 (실패 시)'
    },
    timestamp: {
      type: 'string',
      format: 'date-time',
      description: '완료 시간'
    }
  },
  required: ['success', 'request_id']
};

/**
 * 에이전트 레지스트리 스키마
 * registry.json의 구조
 */
const AgentRegistrySchema = {
  type: 'object',
  properties: {
    schema_version: { type: 'string' },
    agents: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          enabled: { type: 'boolean' },
          endpoint: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['http', 'docker_exec'] },
              url: { type: 'string' },
              method: { type: 'string' },
              health_check: { type: 'string' },
              container: { type: 'string' },
              workdir: { type: 'string' },
              shell: { type: 'string' }
            },
            required: ['type']
          },
          capabilities: {
            type: 'array',
            items: { type: 'string' }
          },
          timeout_ms: { type: 'number' },
          retry: {
            type: 'object',
            properties: {
              max_attempts: { type: 'number' },
              backoff: { type: 'string', enum: ['exponential', 'linear', 'fixed'] },
              initial_delay_ms: { type: 'number' },
              max_delay_ms: { type: 'number' }
            }
          },
          circuit_breaker: {
            type: 'object',
            properties: {
              failure_threshold: { type: 'number' },
              cooldown_ms: { type: 'number' },
              half_open_max_requests: { type: 'number' }
            }
          },
          fallback: {
            type: 'object',
            properties: {
              strategy: { type: 'string', enum: ['skip_with_warning', 'notify_user', 'fallback_agent', 'retry_later'] },
              alternatives: { type: 'array', items: { type: 'string' } }
            }
          }
        },
        required: ['name', 'endpoint', 'capabilities']
      }
    },
    meta: { type: 'object' }
  },
  required: ['agents']
};

/**
 * Validation 함수
 */
class SchemaValidator {
  /**
   * 값이 스키마 정의를 따르는지 검증
   * @param {*} value - 검증할 값
   * @param {Object} schema - 스키마 정의
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate(value, schema) {
    const errors = [];

    // 타입 체크
    if (schema.type === 'object') {
      if (typeof value !== 'object' || value === null) {
        errors.push(`Expected object, got ${typeof value}`);
        return { valid: false, errors };
      }

      // 필수 필드 체크
      if (schema.required) {
        for (const field of schema.required) {
          if (value[field] === undefined || value[field] === null) {
            errors.push(`Missing required field: ${field}`);
          }
        }
      }

      // properties 체크
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (value[key] !== undefined) {
            const nested = this._validateField(value[key], propSchema, key);
            errors.push(...nested.errors);
          }
        }
      }
    }

    if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`Expected array, got ${typeof value}`);
        return { valid: false, errors };
      }
    }

    return { valid: errors.length === 0, errors };
  }

  _validateField(value, schema, path) {
    const errors = [];

    if (schema.type === 'string' && typeof value !== 'string') {
      errors.push(`${path}: Expected string, got ${typeof value}`);
    }
    if (schema.type === 'number' && typeof value !== 'number') {
      errors.push(`${path}: Expected number, got ${typeof value}`);
    }
    if (schema.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`${path}: Expected boolean, got ${typeof value}`);
    }

    // enum 체크
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path}: Expected one of [${schema.enum.join(', ')}], got ${value}`);
    }

    // minLength/maxLength
    if (typeof value === 'string') {
      if (schema.minLength && value.length < schema.minLength) {
        errors.push(`${path}: Min length ${schema.minLength}, got ${value.length}`);
      }
      if (schema.maxLength && value.length > schema.maxLength) {
        errors.push(`${path}: Max length ${schema.maxLength}, got ${value.length}`);
      }
    }

    return { errors };
  }

  /**
   * DispatchRequest 검증
   */
  validateRequest(req) {
    return this.validate(req, DispatchRequestSchema);
  }

  /**
   * DispatchResponse 검증
   */
  validateResponse(res) {
    return this.validate(res, DispatchResponseSchema);
  }

  /**
   * AgentCallRequest 검증
   */
  validateAgentCall(req) {
    return this.validate(req, AgentCallRequestSchema);
  }

  /**
   * Registry 검증
   */
  validateRegistry(registry) {
    return this.validate(registry, AgentRegistrySchema);
  }
}

module.exports = {
  schemas: {
    DispatchRequestSchema,
    IntentResultSchema,
    PolicyMatchSchema,
    AgentCallRequestSchema,
    AgentCallResponseSchema,
    DispatchResponseSchema,
    AgentRegistrySchema
  },
  SchemaValidator
};
