/**
 * parser.js — 2-Layer 인텐트 분류기
 *
 * Layer 1: Rule-based (키워드 매칭, deterministic)
 * Layer 2: LLM (모호한 경우만 위임)
 * Layer 3: Sanity check (규칙 위반 감지)
 */

class IntentParser {
  /**
   * @param {Object} options
   * @param {number} options.llmThreshold - Layer 1 신뢰도가 이 값 이하면 LLM 호출 (0.0~1.0)
   * @param {boolean} options.enableLLM - LLM 레이어 활성화
   */
  constructor(options = {}) {
    this.llmThreshold = options.llmThreshold || 0.7;
    this.enableLLM = options.enableLLM !== undefined ? options.enableLLM : true;

    // Rule-based 키워드-인텐트 매핑 (priority가 높은 policy 순서와 일치)
    this.rules = [
      // bug (priority 100)
      {
        intents: ['bug', 'error', 'failure'],
        keywords: ['500', '에러', '고장', '안 돼', '안됨', '작동 안 함', 'crash', 'broken', 'bug fix', 'failed'],
        weight: 0.9
      },
      // feature (priority 90)
      {
        intents: ['feature', 'new', 'development'],
        keywords: ['만들어줘', '추가해줘', '구현', '개발', '개발해줘', '작성해줘', 'create', 'implement', 'build'],
        weight: 0.85
      },
      // review (priority 85)
      {
        intents: ['review', 'audit'],
        keywords: ['검토해줘', '리뷰', '확인해봐', '검토', '봐줘', 'review', 'check'],
        weight: 0.85
      },
      // analysis (priority 80)
      {
        intents: ['analysis', 'pdf', 'image', 'extraction'],
        keywords: ['분석해줘', 'pdf', '이미지', '분석', '정리해줘', 'summarize', 'analyze', 'extract'],
        weight: 0.85
      },
      // trading (priority 70)
      {
        intents: ['trading', 'finance', 'stock', 'investment'],
        keywords: ['트레이딩', '주식', '포트폴리오', '투자', 'stock', 'portfolio', 'trade', 'market'],
        weight: 0.8
      },
      // recording (priority 60)
      {
        intents: ['record', 'save', 'memory', 'store'],
        keywords: ['기록해둬', '저장', '기억', 'save', 'record', 'remember', '보관', '노션'],
        weight: 0.85
      },
      // strategy (priority 50)
      {
        intents: ['strategy', 'opinion', 'review'],
        keywords: ['어떤 것 같아', '검토해줘', '의견을', '전략', 'opinion', 'think'],
        weight: 0.75
      },
      // config (priority 40)
      {
        intents: ['config', 'environment', 'setup'],
        keywords: ['api 키', '환경변수', '설정', 'config', 'token', 'key', 'env'],
        weight: 0.8
      }
    ];

    // Sanity check 규칙: 모순되는 인텐트 조합
    this.conflictPairs = [
      [['bug'], ['feature', 'new']],
      [['analysis'], ['trading']],
      [['config'], ['trading']]
    ];
  }

  /**
   * Layer 1: Rule-based 인텐트 분류
   * @param {string} message
   * @returns {Object} { intents: string[], confidence: number, matchedRules: string[] }
   */
  classifyByRules(message) {
    const normalized = message.toLowerCase();
    const matchedIntents = new Map(); // intent → max weight

    for (const rule of this.rules) {
      for (const keyword of rule.keywords) {
        if (normalized.includes(keyword.toLowerCase())) {
          for (const intent of rule.intents) {
            const current = matchedIntents.get(intent) || 0;
            if (rule.weight > current) {
              matchedIntents.set(intent, rule.weight);
            }
          }
        }
      }
    }

    if (matchedIntents.size === 0) {
      return { intents: ['unknown'], confidence: 0, matchedRules: [] };
    }

    // 가장 높은 confidence의 인텐트 찾기
    let maxIntent = 'unknown';
    let maxWeight = 0;
    for (const [intent, weight] of matchedIntents) {
      if (weight > maxWeight) {
        maxWeight = weight;
        maxIntent = intent;
      }
    }

    return {
      intents: [maxIntent],
      confidence: maxWeight,
      matchedRules: Array.from(matchedIntents.keys())
    };
  }

  /**
   * Layer 2: LLM 기반 인텐트 분류 (Hermes 호출)
   * 모호한 케이스에서만 사용
   */
  async classifyByLLM(message) {
    if (!this.enableLLM) {
      return { intents: ['unknown'], confidence: 0.3, llm_used: false };
    }

    try {
      const http = require('http');
      const payload = JSON.stringify({
        message: `[classify] 다음 요청의 인텐트를 분류해줘. 가능한 인텐트: bug, feature, review, analysis, trading, record, strategy, config, unknown. 요청: "${message.substring(0, 500)}" 응답은 JSON만: {"intent": "...", "confidence": 0.0~1.0}`
      });

      const result = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: 8000,
          path: '/chat',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          timeout: 10000
        }, (res) => {
          let body = '';
          res.on('data', (chunk) => body += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              // Hermes 응답에서 intent 추출 시도
              const reply = parsed.reply || parsed.response || '';
              const jsonMatch = reply.match(/\{.*"intent".*\}/s);
              if (jsonMatch) {
                resolve(JSON.parse(jsonMatch[0]));
              } else {
                resolve({ intent: 'unknown', confidence: 0.3 });
              }
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(payload);
        req.end();
      });

      return {
        intents: [result.intent || 'unknown'],
        confidence: result.confidence || 0.5,
        llm_used: true
      };
    } catch (e) {
      return { intents: ['unknown'], confidence: 0.2, llm_used: true, error: e.message };
    }
  }

  /**
   * Layer 3: Sanity check
   * 인텐트와 메시지의 모순 검증
   */
  sanityCheck(intents, message) {
    const normalized = message.toLowerCase();

    // Config 요청을 Feature로 분류하는 모순
    if (intents.includes('feature') && (normalized.includes('api 키') || normalized.includes('환경변수'))) {
      return { valid: false, corrected: ['config'], reason: 'config_keywords_detected_in_feature_intent' };
    }

    // Bug 요청을 Strategy로 분류하는 모순
    if (intents.includes('strategy') && (normalized.includes('500') || normalized.includes('에러'))) {
      return { valid: false, corrected: ['bug'], reason: 'error_keywords_detected_in_strategy_intent' };
    }

    // Trading 요청을 Analysis로 분류하는 모순
    if (intents.includes('analysis') && (normalized.includes('주식') || normalized.includes('trading'))) {
      return { valid: false, corrected: ['trading'], reason: 'trading_keywords_detected_in_analysis_intent' };
    }

    return { valid: true, corrected: intents };
  }

  /**
   * 통합 분류 파이프라인
   * Rule-based → (필요시) LLM → Sanity check
   */
  async parse(message) {
    // Layer 1: Rule-based
    const ruleResult = this.classifyByRules(message);

    let finalIntents = ruleResult.intents;
    let finalConfidence = ruleResult.confidence;
    let llmUsed = false;

    // Layer 2: LLM (confidence 낮을 때만)
    if (finalConfidence < this.llmThreshold || finalIntents.includes('unknown')) {
      const llmResult = await this.classifyByLLM(message);
      llmUsed = true;

      // LLM confidence가 높으면 LLM 결과 우선
      if (llmResult.confidence > finalConfidence) {
        finalIntents = llmResult.intents;
        finalConfidence = llmResult.confidence;
      }
    }

    // Layer 3: Sanity check
    const sanityResult = this.sanityCheck(finalIntents, message);
    if (!sanityResult.valid) {
      finalIntents = sanityResult.corrected;
      finalConfidence = Math.max(0.5, finalConfidence - 0.1);
    }

    return {
      intents: finalIntents,
      confidence: finalConfidence,
      llm_used: llmUsed,
      rule_confidence: ruleResult.confidence,
      matched_rules: ruleResult.matchedRules
    };
  }
}

module.exports = IntentParser;
