#!/usr/bin/env node

/**
 * inject.js — Second Brain HTTP Inject Endpoint
 *
 * 가벼운 HTTP 서버. 웹/curl/에이전트에서 POST로 지식 주입 가능.
 * 자동으로 00_Raw 저장 + 템플릿 분류 + git commit/push.
 *
 * 사용법:
 *   node inject.js                    # 포트 4826에서 실행
 *   node inject.js --port 9999       # 커스텀 포트
 *   node inject.js --daemon          # 백그라운드 실행
 *
 * POST 예시:
 *   curl -X POST http://localhost:4826/inject \
 *     -H "Content-Type: application/json" \
 *     -d '{"title":"전략 노트","content":"내용...","tags":["ai","strategy"]}'
 *
 *   curl -X POST http://localhost:4826/inject \
 *     -H "Content-Type: application/json" \
 *     -d '{"title":"결정:DB선택","content":"PostgreSQL 선택","template":"decision"}'
 *
 * 템플릿: project, decision, skill, topic (생략 시 raw)
 */

const http = require('http');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SECOND_BRAIN = path.resolve('/home/khmo31/second_brain');
const RAW_DIR = path.join(SECOND_BRAIN, '00_Raw');
const DEFAULT_PORT = 4826;

// record.js 경로
const RECORD_JS = path.join(__dirname, 'record.js');

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function dateStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * POST /inject 핸들러
 */
function handleInject(body) {
  const { title, content, tags, template } = body;

  if (!title || !content) {
    return { error: 'title and content are required' };
  }

  const tagStr = tags && Array.isArray(tags) ? tags.join(', ') : '';
  const ts = timestamp();
  const today = dateStr();

  // 1. 00_Raw에 원본 저장
  ensureDir(RAW_DIR);
  const rawPath = path.join(RAW_DIR, `${today}.md`);
  const rawEntry = `## ${ts} — ${title}\n${tagStr ? `> Tags: ${tagStr}\n` : ''}\n${content}\n\n---\n\n`;
  fs.appendFileSync(rawPath, rawEntry);

  // 2. 템플릿이 지정되었으면 record.js --template 호출
  const allowedTemplates = ['project', 'decision', 'skill', 'topic'];
  if (template && allowedTemplates.includes(template)) {
    try {
      execSync(
        `node "${RECORD_JS}" --template ${template} "${title}" "${content.slice(0, 2000)}"`,
        { stdio: 'pipe', timeout: 10000 }
      );
    } catch (e) {
      // template은 secondary, 실패해도 raw 저장은 유지
    }
  }

  // 3. Git auto-sync
  try {
    const commitMsg = `📥 Inject: ${title} (${ts})`;
    execSync('git add -A', { cwd: SECOND_BRAIN, stdio: 'pipe' });
    try {
      execSync(`git commit -m "${commitMsg}"`, { cwd: SECOND_BRAIN, stdio: 'pipe' });
    } catch (e) {
      if (e.stderr && e.stderr.toString().includes('nothing to commit')) {
        // skip
      }
    }
    try {
      execSync('git push', { cwd: SECOND_BRAIN, stdio: 'pipe', timeout: 30000 });
    } catch (e) {
      // remote 없으면 skip
    }
  } catch (e) {
    // git 실패는 치명적이지 않음
  }

  return {
    success: true,
    title,
    saved_to: `00_Raw/${today}.md`,
    template: template || 'raw',
    timestamp: ts,
    chars: content.length
  };
}

/**
 * HTTP 서버
 */
function startServer(port) {
  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', port, uptime: process.uptime() }));
      return;
    }

    if (req.method === 'POST' && req.url === '/inject') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const result = handleInject(data);

          if (result.error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
          }
          res.end(JSON.stringify(result, null, 2));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON', detail: e.message }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use POST /inject or GET /health' }));
  });

  server.listen(port, () => {
    console.log(`🧠 inject.js running on http://localhost:${port}`);
    console.log(`   POST /inject  — 지식 주입`);
    console.log(`   GET  /health  — 상태 확인`);
    console.log(`   Second Brain: ${SECOND_BRAIN}`);
  });

  return server;
}

// --- CLI ---
const args = process.argv.slice(2);
let port = DEFAULT_PORT;
let daemon = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = parseInt(args[++i], 10) || DEFAULT_PORT;
  if (args[i] === '--daemon') daemon = true;
}

if (daemon) {
  // simple detach via fork
  const cp = require('child_process');
  const child = cp.spawn(process.execPath, [__filename, '--port', String(port)], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  console.log(`🧠 inject.js daemon started (PID: ${child.pid}) on port ${port}`);
  process.exit(0);
} else {
  startServer(port);
}
