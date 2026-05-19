/**
 * dispatcher.test.js — Dispatcher 통합 테스트
 *
 * 각 모듈의 독립적 동작과 통합 시나리오 테스트.
 *
 * 실행: node test/dispatcher.test.js
 */

const path = require('path');
const fs = require('fs');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

function assertEqual(actual, expected, name) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
    failed++;
  }
}

function assertDeepEqual(actual, expected, name) {
  try {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}`);
      console.log(`    expected: ${JSON.stringify(expected)}`);
      console.log(`    actual:   ${JSON.stringify(actual)}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ ${name} (error: ${e.message})`);
    failed++;
  }
}

// =========================================================
// Test: ConfigValidator
// =========================================================
console.log('\n📋 ConfigValidator Tests');

const ConfigValidator = require('../lib/validator');
const validator = new ConfigValidator();

// Valid registry
const validRegistry = {
  schema_version: '1.0',
  agents: {
    hermes: {
      name: 'Hermes',
      enabled: true,
      endpoint: { type: 'http', url: 'http://localhost:8000/chat' },
      capabilities: ['analysis'],
      timeout_ms: 30000,
      fallback: { strategy: 'skip_with_warning', alternatives: ['direct'] }
    },
    ejclaw: {
      name: 'EJClaw',
      enabled: true,
      endpoint: { type: 'docker_exec', container: 'aifactory-ejclaw' },
      capabilities: ['bug_fix'],
      timeout_ms: 300000,
      fallback: { strategy: 'notify_user' }
    }
  }
};

const r1 = validator.validateRegistry(validRegistry);
assert(r1.valid, 'Valid registry passes');
assert(r1.errors.length === 0, 'Valid registry has no errors');

// Invalid registry: missing agents
const r2 = validator.validateRegistry({ schema_version: '1.0', agents: {} });
assert(!r2.valid, 'Empty agents fails');
assert(r2.errors.includes('no_agents_defined'), 'Reports no_agents_defined');

// Invalid registry: missing endpoint
const r3 = validator.validateRegistry({
  schema_version: '1.0',
  agents: { test: { name: 'Test', capabilities: ['x'], timeout_ms: 1000 } }
});
assert(!r3.valid, 'Missing endpoint fails');

// Valid policy
const validPolicy = {
  schema_version: '1.0',
  policies: [
    {
      id: 'test_bug',
      priority: 100,
      match: { intent: ['bug'], keywords: ['에러'] },
      action: { type: 'route', target: { primary: 'ejclaw', fallback: 'hermes' } }
    },
    {
      id: 'test_default',
      priority: 1,
      match: {},
      action: { type: 'route', target: { primary: 'direct' } }
    }
  ]
};

const p1 = validator.validatePolicy(validPolicy, validRegistry);
assert(p1.valid, 'Valid policy passes');

// Invalid policy: unknown target agent
const invalidPolicy = {
  schema_version: '1.0',
  policies: [
    { id: 'test', priority: 10, match: {}, action: { type: 'route', target: { primary: 'nonexistent_agent' } } }
  ]
};
const p2 = validator.validatePolicy(invalidPolicy, validRegistry);
assert(!p2.valid, 'Unknown target agent fails');

// =========================================================
// Test: DedupeTracker
// =========================================================
console.log('\n📋 DedupeTracker Tests');

const DedupeTracker = require('../lib/dedupe');
const dedupe = new DedupeTracker({ ttlMs: 5000 });

// New request
assert(dedupe.register('req_001', 'pending'), 'New request registers');
assert(!dedupe.register('req_001', 'pending'), 'Duplicate request rejected');
assertEqual(dedupe.getStatus('req_001'), 'pending', 'Status is pending');

// Update
dedupe.update('req_001', 'completed');
assertEqual(dedupe.getStatus('req_001'), 'completed', 'Status updated to completed');

// Unknown
assertEqual(dedupe.getStatus('req_unknown'), null, 'Unknown request returns null');

// =========================================================
// Test: RetryHandler
// =========================================================
console.log('\n📋 RetryHandler Tests');

const RetryHandler = require('../lib/retry');

const retry = new RetryHandler({ max_attempts: 3, backoff: 'exponential', initial_delay_ms: 1000 });
assertEqual(retry.maxAttempts, 3, 'Max attempts loaded');
assert(retry.getDelay(0) >= 800 && retry.getDelay(0) <= 1200, 'Delay 0 ~1000ms');
assert(retry.getDelay(1) >= 1600 && retry.getDelay(1) <= 2400, 'Delay 1 ~2000ms');
assert(retry.getDelay(2) >= 3200 && retry.getDelay(2) <= 4800, 'Delay 2 ~4000ms');
assert(!retry.shouldRetry(3, null), 'Exceeds max attempts');
assert(!retry.shouldRetry(0, 'unknown_agent'), 'Non-retryable error');

// =========================================================
// Test: CircuitBreaker
// =========================================================
console.log('\n📋 CircuitBreaker Tests');

const { CircuitBreaker, CircuitState } = require('../lib/circuit');
const cb = new CircuitBreaker();
cb.init('test_agent', { failureThreshold: 2, cooldownMs: 100, halfOpenMaxRequests: 2 });

// Initial state
assert(cb.allowRequest('test_agent'), 'CLOSED allows request');

// Failures
cb.recordFailure('test_agent');
assert(cb.allowRequest('test_agent'), 'After 1 failure, still allowed');
cb.recordFailure('test_agent');

// OPEN
assert(!cb.allowRequest('test_agent'), 'OPEN blocks request');
let state = cb.getState('test_agent');
assertEqual(state.state, CircuitState.OPEN, 'State is OPEN');
assertEqual(state.failures, 2, 'Failures recorded');

// Record more failures in OPEN state
cb.recordFailure('test_agent');
assert(!cb.allowRequest('test_agent'), 'Still OPEN after more failures');

// Reset
cb.reset('test_agent');
assert(cb.allowRequest('test_agent'), 'Reset allows requests again');
assertEqual(cb.getState('test_agent').state, CircuitState.CLOSED, 'Reset returns to CLOSED');

// =========================================================
// Test: IntentParser (Rule-based)
// =========================================================
console.log('\n📋 IntentParser Tests');

const IntentParser = require('../lib/parser');
const parser = new IntentParser({ enableLLM: false });

// Bug detection
let r = parser.classifyByRules('로그인 버튼 500 에러');
assert(r.intents.includes('bug'), `500 error → bug (got: ${r.intents})`);
assert(r.confidence >= 0.8, 'High confidence for bug');

// Feature detection
r = parser.classifyByRules('TODO 앱 만들어줘');
assert(r.intents.includes('feature'), `"만들어줘" → feature (got: ${r.intents})`);

// Analysis detection
r = parser.classifyByRules('이 PDF 분석해줘');
assert(r.intents.includes('analysis'), `"PDF 분석" → analysis (got: ${r.intents})`);

// Trading detection
r = parser.classifyByRules('주식 포트폴리오 점검');
assert(r.intents.includes('trading'), `"주식 포트폴리오" → trading (got: ${r.intents})`);

// Recording detection
r = parser.classifyByRules('이거 기록해둬');
assert(r.intents.includes('record'), `"기록해둬" → record (got: ${r.intents})`);

// Unknown (no matching keywords)
r = parser.classifyByRules('점심 뭐 먹지');
assert(r.intents.includes('unknown') || r.confidence < 0.5, `No keywords → unknown (got: ${r.intents}, conf: ${r.confidence})`);

// Sanity check
let s = parser.sanityCheck(['feature'], 'API 키 설정해줘');
assert(!s.valid, 'Config keywords in feature → invalid');
assertEqual(s.corrected[0], 'config', 'Corrected to config');

s = parser.sanityCheck(['strategy'], '500 에러');
assert(!s.valid, 'Error keywords in strategy → invalid');
assertEqual(s.corrected[0], 'bug', 'Corrected to bug');

// Valid sanity
s = parser.sanityCheck(['feature'], '새로운 기능 만들어줘');
assert(s.valid, 'Normal feature request → valid');

// =========================================================
// Test: PolicyMatcher
// =========================================================
console.log('\n📋 PolicyMatcher Tests');

const PolicyMatcher = require('../lib/matcher');
const matcher = new PolicyMatcher(validPolicy);

// Match by intent
r = matcher.match({ intents: ['bug'], confidence: 0.9, matched_rules: ['bug'] });
assertEqual(r.policy.id, 'test_bug', 'Bug intent matches bug policy');

// Default (catch-all)
r = matcher.match({ intents: ['unknown'], confidence: 0.2, matched_rules: [] });
assert(r.match_source === 'catch_all' || r.policy.id === 'test_default', 'Unknown intent falls to default');

// Priority (higher priority matched first)
const multiPolicy = {
  schema_version: '1.0',
  policies: [
    { id: 'low', priority: 10, match: { intent: ['bug'] }, action: { type: 'route', target: { primary: 'direct' } } },
    { id: 'high', priority: 100, match: { intent: ['bug'] }, action: { type: 'route', target: { primary: 'direct' } } }
  ]
};
const matcher2 = new PolicyMatcher(multiPolicy);
r = matcher2.match({ intents: ['bug'], confidence: 0.9, matched_rules: ['bug'] });
assertEqual(r.policy.id, 'high', 'Higher priority policy matches first');

// =========================================================
// Test: AgentRegistry
// =========================================================
console.log('\n📋 AgentRegistry Tests');

const AgentRegistry = require('../lib/registry');
// 임시 registry 파일 생성
const tmpRegPath = path.join(__dirname, '..', 'test_registry.json');
fs.writeFileSync(tmpRegPath, JSON.stringify(validRegistry));

const reg = new AgentRegistry(tmpRegPath);
reg.load();

// Get all agents
const all = reg.getAllAgents();
assertEqual(all.length, 2, '2 agents loaded');

// Get specific agent
const hermes = reg.getAgent('hermes');
assert(hermes !== null, 'Can get hermes agent');
assertEqual(hermes.name, 'Hermes', 'Agent name correct');

// Capability lookup
const analysts = reg.getAgentsByCapability('analysis');
assertEqual(analysts.length, 1, '1 agent with analysis capability');
assertEqual(analysts[0].id, 'hermes', 'Hermes has analysis capability');

// Enabled check
assert(reg.isEnabled('hermes'), 'Hermes is enabled');

// 정리
fs.unlinkSync(tmpRegPath);

// =========================================================
// Test: Dispatcher bootstrap
// =========================================================
console.log('\n📋 Dispatcher Bootstrap Test');

const Dispatcher = require('../dispatcher');

try {
  const d = new Dispatcher();
  assert(true, 'Dispatcher boots successfully');

  const status = d.getStatus();
  assert(status.status === 'ready', 'Dispatcher status is ready');
  assert(status.agents.length >= 3, `At least 3 agents loaded (got: ${status.agents.length})`);
  assert(status.policies.length >= 2, `At least 2 policies loaded (got: ${status.policies.length})`);
} catch (e) {
  assert(false, `Dispatcher boot failed: ${e.message}`);
}

// =========================================================
// Summary
// =========================================================
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log('='.repeat(50));

if (failed > 0) process.exit(1);
