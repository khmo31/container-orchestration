#!/usr/bin/env node
/**
 * auditor.js — Claw 행동 감사 로그
 * 모든 라우팅 결정과 작업 처리를 기록한다.
 * 기록 파일: ~/.openclaw/workspace/audit_log.jsonl
 * 
 * 사용법:
 *   node auditor.js route "crewai-manager" "khmo: 코드 리뷰 요청"
 *   node auditor.js direct "status check" "khmo: 서버 상태 물어봄"
 *   node auditor.js report          → 최근 감사 요약
 *   node auditor.js tail            → 실시간 bypass 탐지
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'audit_log.jsonl');

function log(type, route, task, context = '') {
  const entry = {
    timestamp: new Date().toISOString(),
    type,        // 'route' or 'direct'
    route,       // 'crewai-manager', 'hermes', 'direct(bypass!)', 'direct(ok)'
    task: task.slice(0, 200),
    context: context.slice(0, 500)
  };
  
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  
  // If bypass detected → also write to a dedicated bypass log
  if (route.includes('bypass') || (type === 'direct' && !['status_check', 'info', 'chat'].includes(route))) {
    const bypassFile = path.join(__dirname, 'audit_bypasses.log');
    fs.appendFileSync(bypassFile, 
      `[${entry.timestamp}] ⚠️ BYPASS: ${route} | Task: ${entry.task}\n`);
  }
  
  return entry;
}

function report(lines = 20) {
  if (!fs.existsSync(LOG_FILE)) return 'No audit log yet.';
  
  const entries = fs.readFileSync(LOG_FILE, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
  
  const recent = entries.slice(-lines).reverse();
  const bypasses = entries.filter(e => 
    (e.type === 'direct' && !['status_check', 'info', 'chat'].includes(e.route))
    || e.route.includes('bypass')
  );
  
  const stats = {
    total: entries.length,
    routed: entries.filter(e => e.type === 'route').length,
    direct_ok: entries.filter(e => e.type === 'direct' && ['status_check', 'info', 'chat'].includes(e.route)).length,
    direct_bypass: entries.filter(e => e.type === 'direct' && !['status_check', 'info', 'chat'].includes(e.route)).length,
    bypass_rate: entries.length > 0 
      ? (entries.filter(e => e.type === 'direct' && !['status_check', 'info', 'chat'].includes(e.route)).length / entries.length * 100).toFixed(1)
      : '0'
  };
  
  return {
    stats,
    recent,
    bypasses,
    log: recent.map(e => 
      `[${e.timestamp.slice(11,19)}] ${e.type === 'route' ? '✅' : '⚠️'} ${e.route}: ${e.task.slice(0, 80)}`
    ).join('\n')
  };
}

// CLI
const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'route') {
  const result = log('route', 'crewai-manager', args.slice(1).join(' ') || 'unspecified');
  console.log(JSON.stringify(result));
} else if (cmd === 'direct') {
  const routeType = args[1] || 'direct';
  const task = args.slice(2).join(' ') || 'unspecified';
  const result = log('direct', routeType, task);
  console.log(JSON.stringify(result));
} else if (cmd === 'report') {
  const r = report(parseInt(args[1]) || 20);
  console.log(`=== Audit Report ===`);
  console.log(`Total: ${r.stats.total} | Routed: ${r.stats.routed} | Direct OK: ${r.stats.direct_ok} | Bypass: ${r.stats.direct_bypass} (${r.stats.bypass_rate}%)`);
  if (r.bypasses.length > 0) {
    console.log(`\n⚠️  Bypass Detected: ${r.bypasses.length}`);
    r.bypasses.slice(-5).forEach(e => 
      console.log(`  [${e.timestamp}] ${e.task.slice(0, 100)}`)
    );
  }
  console.log(`\nRecent:\n${r.log}`);
} else {
  console.log(`Usage:
  node auditor.js route <task>     → record routing to crewai-manager
  node auditor.js direct <type> <task>
    type: status_check|info|chat|bypass
  node auditor.js report [N]       → show last N entries
`);
}
