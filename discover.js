#!/usr/bin/env node
/**
 * discover.js — Container Auto-Discovery + 수동 승인
 *
 * 사용법:
 *   node discover.js scan        → 새 컨테이너 스캔 + khmo에게 보고
 *   node discover.js approve <id> → khmo 승인 후 manifest 등록
 *   node discover.js reject <id>  → 거절 (무시 목록에 추가)
 *   node discover.js list         → 현재 + pending 상태
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE = __dirname;
const PENDING_FILE = path.join(WORKSPACE, 'crewai-manager', 'pending_agents.json');
const IGNORE_FILE = path.join(WORKSPACE, 'crewai-manager', 'ignored_containers.json');
const MANIFEST_FILE = path.join(WORKSPACE, 'crewai-manager', 'crewai_service.py');
const AUDIT_LOG = path.join(WORKSPACE, 'audit_log.jsonl');

// 현재 crewai-manager에 등록된 에이전트
const BUILTIN_AGENTS = ['Hermes', 'MetaGPT', 'EJClaw', 'OpenCode', 'Auto-Trading'];

// 무시할 컨테이너 패턴
const IGNORE_PATTERNS = [
  /^docker/, /^kube/, /^registry/, /^mysql/, /^redis/,
  /^postgres/, /^minio/, /^traefik/, /^nginx/,
  /^magical_/, /^sleepy_/, /^loving_/, /^pedantic_/  // Docker random names
];

function log(msg) { console.log(`[discover] ${msg}`); }

function getRunningContainers() {
  const out = execSync('docker ps --format "{{.Names}}|{{.Image}}"', { timeout: 10000, encoding: 'utf-8' }).trim();
  return out ? out.split('\n').map(l => { const [name, image] = l.split('|'); return { name, image }; }) : [];
}

function getExistingAgentIds() {
  return new Set(BUILTIN_AGENTS.map(a => a.toLowerCase()));
}

function getIgnoredContainers() {
  try { return JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf-8')); } catch { return []; }
}

function getPendingApprovals() {
  try { return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8')); } catch { return []; }
}

function savePendingApprovals(pending) {
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
}

function saveIgnoredContainers(ignored) {
  fs.writeFileSync(IGNORE_FILE, JSON.stringify([...new Set(ignored)], null, 2));
}

function shouldIgnore(name, image) {
  if (IGNORE_PATTERNS.some(p => p.test(name))) return true;
  if (getIgnoredContainers().includes(name)) return true;
  if (getIgnoredContainers().includes(image)) return true;
  return false;
}

function parseCapabilitiesFromImage(image) {
  // 이미지 이름 기반 기본 capability 추론
  const img = image.toLowerCase();
  if (img.includes('meta') || img.includes('gpt')) return { name: 'MetaGPT-like', caps: ['planning', 'code_generation', 'design'], keywords: ['기획', '설계', '코드'] };
  if (img.includes('ejc') || img.includes('review')) return { name: 'Reviewer', caps: ['code_review', 'audit'], keywords: ['리뷰', '검토'] };
  if (img.includes('open') || img.includes('code')) return { name: 'Coding Agent', caps: ['bug_fixing', 'implementation'], keywords: ['버그', '수정', '구현'] };
  if (img.includes('trad') || img.includes('stock')) return { name: 'Trading Agent', caps: ['trading', 'portfolio'], keywords: ['주식', '트레이딩'] };
  if (img.includes('herm') || img.includes('anal')) return null; // 이미 등록됨
  return { name: image.split('/').pop() || image, caps: ['unknown'], keywords: [] };
}

async function analyzeWithHermes(containerName, imageName) {
  const http = require('http');
  return new Promise((resolve) => {
    const prompt = `Analyze this Docker container and infer its capabilities.
Container name: ${containerName}
Image: ${imageName}

Respond with ONLY valid JSON:
{
  "name": "Human-readable agent name",
  "description": "What this agent does (1 sentence)",
  "capabilities": ["array", "of", "strings"],
  "keywords": ["match", "keywords"]
}`;

    const payload = JSON.stringify({ message: prompt });
    const req = http.request({
      hostname: 'localhost', port: 8000, path: '/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 30000
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const text = parsed.reply || '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) resolve(JSON.parse(jsonMatch[0]));
        } catch {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

async function scan() {
  log('Scanning Docker containers...');
  const containers = getRunningContainers();
  log(`Found ${containers.length} containers`);

  const existingIds = getExistingAgentIds();
  const pending = getPendingApprovals();
  const pendingNames = new Set(pending.map(p => p.containerName));
  const newlyFound = [];

  for (const { name, image } of containers) {
    const agentId = name.replace(/^aifactory-/, '').toLowerCase();
    if (existingIds.has(agentId)) { log(`  → ${name}: already registered`); continue; }
    if (shouldIgnore(name, image)) { log(`  → ${name}: ignored`); continue; }
    if (pendingNames.has(name)) { log(`  → ${name}: pending approval`); continue; }
    newlyFound.push({ name, image, agentId });
  }

  if (newlyFound.length === 0) {
    log('No new containers found.');
    return [];
  }

  log(`\n🔍 New containers detected:`);
  for (const c of newlyFound) {
    log(`  • ${c.name} (${c.image})`);

    // Hermes 분석 시도
    const analysis = await analyzeWithHermes(c.name, c.image);
    const info = analysis || parseCapabilitiesFromImage(c.image);

    const entry = {
      containerName: c.name,
      image: c.image,
      agentId: c.agentId,
      suggestedName: info?.name || c.agentId,
      description: info?.description || 'Auto-discovered container',
      capabilities: info?.capabilities || ['unknown'],
      keywords: info?.keywords || [],
      discoveredAt: new Date().toISOString(),
      status: 'pending'
    };
    pending.push(entry);
    savePendingApprovals(pending);
    log(`    Suggested: ${entry.suggestedName}`);
    log(`    Capabilities: ${entry.capabilities.join(', ')}`);
  }

  return newlyFound;
}

function listPending() {
  const pending = getPendingApprovals();
  if (pending.length === 0) {
    console.log('No pending approvals.');
    return;
  }
  console.log(`\n=== Pending Approvals (${pending.length}) ===`);
  pending.forEach((p, i) => {
    console.log(`\n[${i + 1}] ${p.containerName} → ${p.suggestedName}`);
    console.log(`    Image: ${p.image}`);
    console.log(`    Description: ${p.description}`);
    console.log(`    Capabilities: ${p.capabilities.join(', ')}`);
    console.log(`    Discovered: ${p.discoveredAt}`);
    console.log(`    Approve: node discover.js approve ${p.agentId}`);
    console.log(`    Reject:  node discover.js reject ${p.containerName}`);
  });
}

function approve(agentId) {
  const pending = getPendingApprovals();
  const idx = pending.findIndex(p => p.agentId === agentId);
  if (idx < 0) { console.log(`No pending agent: ${agentId}`); return false; }

  const entry = pending[idx];

  // Generate AGENTS dict entry
  const agentKey = entry.suggestedName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const agentEntry = `
    "${agentKey}": {
        "endpoint": null,
        "shell": "/bin/bash",
        "container": "${entry.containerName}",
        "capabilities": ${JSON.stringify(entry.capabilities)},
        "keywords": ${JSON.stringify(entry.keywords)}
    },`;

  console.log(`\n=== Approving: ${entry.containerName} → ${agentKey} ===`);
  console.log(`\nAdd this to AGENTS dict in crewai_service.py:\n`);
  console.log(agentEntry);
  console.log(`\nOr run: node discover.js auto-register ${agentId} to auto-update`);

  // Remove from pending
  pending.splice(idx, 1);
  savePendingApprovals(pending);
  return true;
}

function reject(containerName) {
  const pending = getPendingApprovals();
  const idx = pending.findIndex(p => p.containerName === containerName);
  if (idx < 0) { console.log(`Not found: ${containerName}`); return; }

  const entry = pending[idx];
  pending.splice(idx, 1);
  savePendingApprovals(pending);

  // Add to ignore list
  const ignored = getIgnoredContainers();
  ignored.push(entry.containerName, entry.image);
  saveIgnoredContainers(ignored);

  console.log(`Rejected: ${containerName}. Added to ignore list.`);
}

async function autoRegister(agentId, doRestart = false) {
  const ONBOARD_SCRIPT = path.join(WORKSPACE, 'discord-onboard.sh');
  const pending = getPendingApprovals();
  const entry = pending.find(p => p.agentId === agentId);
  if (!entry) { console.log(`Not found: ${agentId}`); return; }

  const agentKey = entry.suggestedName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const agentEntry = `
    "${agentKey}": {
        "endpoint": null,
        "shell": "/bin/bash",
        "container": "${entry.containerName}",
        "capabilities": ${JSON.stringify(entry.capabilities)},
        "keywords": ${JSON.stringify(entry.keywords)}
    },`;

  // Read current crewai_service.py and insert before the last closing brace of AGENTS
  let code = fs.readFileSync(MANIFEST_FILE, 'utf-8');
  const insertPoint = code.lastIndexOf('}');
  if (insertPoint > 0) {
    code = code.slice(0, insertPoint) + agentEntry + code.slice(insertPoint);
    fs.writeFileSync(MANIFEST_FILE, code);
    console.log(`✅ Registered ${agentKey} in crewai_service.py`);
  }

  // Remove from pending
  const idx = pending.findIndex(p => p.agentId === agentId);
  if (idx >= 0) {
    pending.splice(idx, 1);
    savePendingApprovals(pending);
  }

  // Audit log
  const auditEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'discovery',
    route: 'auto-register',
    task: `Registered new agent: ${agentKey} (${entry.containerName})`,
    context: `capabilities: ${entry.capabilities.join(', ')}`
  }) + '\n';
  fs.appendFileSync(AUDIT_LOG, auditEntry);

  // ── Discord 온보딩 (채널 + 웹훅) ──
  log(`📡 Onboarding ${entry.suggestedName} to Discord...`);
  try {
    execSync(`bash "${ONBOARD_SCRIPT}" "${entry.agentId}" "${entry.suggestedName}" "${entry.containerName}"`, { timeout: 30000 });
    log('✅ Discord onboarding complete');
  } catch (e) {
    log(`⚠️ Discord onboarding skipped: ${e.message}`);
  }

  if (doRestart) {
    console.log('🔄 Restarting crewai-manager...');
    try {
      execSync('kill $(lsof -ti:8001) 2>/dev/null; sleep 2', { timeout: 5000 });
      const startCmd = 'cd /home/khmo31/.openclaw/workspace/crewai-manager && '
        + 'source /home/khmo31/crewai_env/bin/activate && '
        + 'python3 crewai_service.py &';
      execSync(startCmd, { timeout: 10000, shell: '/bin/bash' });
      console.log('✅ crewai-manager restarted');
    } catch (e) {
      console.log(`❌ Restart failed: ${e.message}`);
    }
  } else {
    console.log(`\n⚠️  Restart crewai-manager: node discover.js restart`);
  }
}

function restartCrewAI() {
  try {
    // Kill old process
    execSync('kill $(lsof -ti:8001) 2>/dev/null || true', { timeout: 5000 });
    // Start new one using spawn (detached, no wait)
    const { spawn } = require('child_process');
    const child = spawn('/bin/bash', ['-c',
      'cd /home/khmo31/.openclaw/workspace/crewai-manager && '
      + 'source /home/khmo31/crewai_env/bin/activate && '
      + 'python3 crewai_service.py'
    ], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CREWAI_PORT: '8001' }
    });
    child.unref();
    // Give it a moment
    const start = Date.now();
    while (Date.now() - start < 8000) {
      try {
        const http = require('http');
        const req = http.get('http://localhost:8001/health', (res) => {
          if (res.statusCode === 200) return; // success
        });
        req.on('error', () => {});
        req.end();
      } catch {}
      require('child_process').execSync('sleep 1', { timeout: 1000 });
    }
    return true;
  } catch (e) {
    console.error(`Restart error: ${e.message}`);
    return false;
  }
}

// ── CLI ──
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'scan':
      await scan();
      listPending();
      console.log('\n💡 To approve: node discover.js approve <agentId>');
      console.log('   To reject:  node discover.js reject <containerName>');
      break;
    case 'approve':
      approve(args[1]);
      break;
    case 'reject':
      reject(args.slice(1).join(' '));
      break;
    case 'list':
      listPending();
      break;
    case 'auto-register':
      autoRegister(args[1], true);
      console.log('✅ Registration complete. New agent is now live.');
      break;
    case 'restart':
      if (restartCrewAI()) console.log('✅ crewai-manager restarted');
      else console.log('❌ Restart failed');
      break;
    default:
      console.log(`Usage:
  scan              → scan Docker for new containers
  approve <id>      → approve pending registration
  reject <name>     → reject and ignore container
  list              → show pending approvals
  auto-register <id> → approve + update crewai_service.py + restart
  restart            → restart crewai-manager`);
  }
}

if (require.main === module) main().catch(e => console.error(e));
