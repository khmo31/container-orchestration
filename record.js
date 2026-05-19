#!/usr/bin/env node

/**
 * record.js — Second Brain 기록 유틸리티 (v3)
 *
 * Claw가 직접 second_brain 디렉토리에 기록.
 * 템플릿은 _templates/ 디렉토리에서 읽어옴 (코드에서 분리됨).
 *
 * 사용법:
 *   node record.js --template <type> "제목" "내용"              ← 템플릿 기반 Wiki 페이지
 *   node record.js --template <type> "제목" "내용" --status "draft"  ← 상태 오버라이드
 *   node record.js --project "Projects/xxx" "내용"             ← 프로젝트 문서 (append)
 *   node record.js --decision "Decisions/xxx" "내용"           ← 결정 기록 (append)
 *   node record.js --raw "name" "내용"                         ← 원시 데이터
 *   node record.js --commit "내용"                              ← 기록 + 자동 git push
 *   node record.js "일일로그"                                   ← 일일 로그
 *
 * 템플릿 유형 (9종):
 *   project, decision, skill, topic     ← 기존 4종
 *   meeting, rfc, postmortem, release, guide  ← 신규 5종
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SECOND_BRAIN = path.resolve('/home/khmo31/second_brain');
const TEMPLATES_DIR = path.join(SECOND_BRAIN, '_templates');
const WIKI_PROJECTS = path.join(SECOND_BRAIN, '10_Wiki', 'Projects');
const WIKI_DECISIONS = path.join(SECOND_BRAIN, '10_Wiki', 'Decisions');
const WIKI_SKILLS = path.join(SECOND_BRAIN, '10_Wiki', 'Skills');
const WIKI_TOPICS = path.join(SECOND_BRAIN, '10_Wiki', 'Topics');
const WIKI_MEETINGS = path.join(SECOND_BRAIN, '10_Wiki', 'Meetings');
const WIKI_RFCS = path.join(SECOND_BRAIN, '10_Wiki', 'RFCs');
const WIKI_POSTMORTEMS = path.join(SECOND_BRAIN, '10_Wiki', 'Postmortems');
const WIKI_RELEASES = path.join(SECOND_BRAIN, '10_Wiki', 'Releases');
const WIKI_GUIDES = path.join(SECOND_BRAIN, '10_Wiki', 'Guides');
const RAW = path.join(SECOND_BRAIN, '00_Raw');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function dateStr() {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
}

/**
 * 템플릿 파일 목록 자동 탐색
 */
function discoverTemplates() {
  ensureDir(TEMPLATES_DIR);
  const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md'));
  const templateTypes = {};
  for (const file of files) {
    const type = file.replace(/\.md$/, '');
    templateTypes[type] = {
      path: path.join(TEMPLATES_DIR, file),
      dir: getDirForType(type),
      ext: '.md',
    };
  }
  return templateTypes;
}

/**
 * 템플릿 유형 → 저장 디렉토리 매핑
 */
function getDirForType(type) {
  const map = {
    project: WIKI_PROJECTS,
    decision: WIKI_DECISIONS,
    skill: WIKI_SKILLS,
    topic: WIKI_TOPICS,
    meeting: WIKI_MEETINGS,
    rfc: WIKI_RFCS,
    postmortem: WIKI_POSTMORTEMS,
    release: WIKI_RELEASES,
    guide: WIKI_GUIDES,
  };
  return map[type] || WIKI_PROJECTS;
}

/**
 * 템플릿 파일 읽고 {{variables}} 치환
 */
function renderTemplate(templatePath, vars) {
  if (!fs.existsSync(templatePath)) {
    console.error('❌ Template not found: ' + templatePath);
    process.exit(1);
  }
  let content = fs.readFileSync(templatePath, 'utf-8');
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp('\\{\\{' + key + '\\}\\}', 'g');
    content = content.replace(re, value || '');
  }
  // 남은 미치환 {{변수}}는 빈 문자열로 처리
  content = content.replace(/\{\{[^}]+\}\}/g, '');
  return content;
}

/**
 * Git auto-sync
 */
function gitSync(commitMsg) {
  try {
    if (!fs.existsSync(path.join(SECOND_BRAIN, '.git'))) {
      execSync('git init', { cwd: SECOND_BRAIN, stdio: 'pipe' });
    }
    execSync('git add -A', { cwd: SECOND_BRAIN, stdio: 'pipe' });
    try {
      execSync(`git commit -m "${commitMsg}"`, { cwd: SECOND_BRAIN, stdio: 'pipe' });
    } catch (e) {
      if (e.stderr && e.stderr.toString().includes('nothing to commit')) return;
      throw e;
    }
    try {
      execSync('git push', { cwd: SECOND_BRAIN, stdio: 'pipe', timeout: 30000 });
      console.log('  ☁️  Pushed to remote');
    } catch (e) {
      const msg = e.stderr ? e.stderr.toString() : e.message;
      if (!msg.includes('No remote repository')) {
        console.log(`  ⚠️  Push skipped: ${msg.slice(0, 120)}`);
      }
    }
  } catch (e) {
    console.log(`  ⚠️  Git sync: ${e.message.slice(0, 100)}`);
  }
}

function printUsage() {
  const templateTypes = discoverTemplates();
  const types = Object.keys(templateTypes);
  console.log('Usage:');
  console.log('  node record.js --template <type> "제목" "내용" [--status "상태"]');
  console.log('  node record.js --project "name" "내용"');
  console.log('  node record.js --decision "name" "내용"');
  console.log('  node record.js --raw "name" "내용"');
  console.log('  node record.js --commit "내용"');
  console.log('  node record.js "내용"    (-> daily log)');
  console.log('');
  console.log('Templates (' + types.length + ' types): ' + types.join(', '));
  console.log('Example:');
  console.log('  node record.js --template rfc "새 API 설계" "제안 내용..." --status "review"');
  console.log('  node record.js --template meeting "스프린트 회의" "논의 내용..."');
  console.log('  node record.js --commit "오늘 한 일..."');
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
  }

  let mode = 'daily';
  let name = '';
  let content = '';
  let doCommit = false;
  let statusOverride = '';

  // 1차 패스: 플래그만 추출
  doCommit = args.includes('--commit');

  // status 오버라이드 추출
  const statusIdx = args.indexOf('--status');
  if (statusIdx >= 0 && statusIdx + 1 < args.length) {
    statusOverride = args[statusIdx + 1];
  }

  // 플래그 제거한 순수 인자
  const cleanArgs = args.filter(a => a !== '--commit');

  // 2차 패스: 모드 결정
  let idx = 0;
  while (idx < cleanArgs.length) {
    const arg = cleanArgs[idx];
    if (arg === '--project' || arg === '--decision' || arg === '--raw') {
      mode = arg.slice(2);
      name = cleanArgs[idx + 1];
      content = cleanArgs.slice(idx + 2).join(' ');
      idx = cleanArgs.length;
    } else if (arg === '--template') {
      mode = 'template';
      idx = cleanArgs.length;
    } else {
      // 첫 비플래그 인자 이후로 모두 content
      content = cleanArgs.slice(idx).join(' ');
      idx = cleanArgs.length;
    }
  }

  // --template 모드: template type, name, content 분리
  let templateType = '';
  if (mode === 'template') {
    const tIdx = cleanArgs.indexOf('--template');
    if (tIdx >= 0) {
      templateType = cleanArgs[tIdx + 1] || '';
      name = cleanArgs[tIdx + 2] || '';
      // --status 이후는 제외
      let rawContent = cleanArgs.slice(tIdx + 3).join(' ');
      if (statusOverride) {
        rawContent = rawContent.replace(`--status ${statusOverride}`, '').trim();
      }
      content = rawContent;
    }
  }

  const ts = timestamp();
  const today = dateStr();

  // 템플릿 모드
  if (mode === 'template') {
    const TEMPLATES = discoverTemplates();
    if (!templateType || !TEMPLATES[templateType]) {
      console.error('❌ Unknown template type: "' + templateType + '"');
      console.error('   Available: ' + Object.keys(TEMPLATES).join(', '));
      process.exit(1);
    }

    const tmpl = TEMPLATES[templateType];
    ensureDir(tmpl.dir);
    const filePath = path.join(tmpl.dir, sanitizeName(name) + '.md');

    // 상태 오버라이드가 있으면 frontmatter에 반영
    let rendered;
    if (statusOverride) {
      // 템플릿 먼저 렌더링 후 status 치환
      rendered = renderTemplate(tmpl.path, {
        title: name,
        date: today,
        content: content,
        status: statusOverride,
        owner: 'khmo',
        tags: '',
        // 기타 필드들은 빈값으로
      });
    } else {
      rendered = renderTemplate(tmpl.path, {
        title: name,
        date: today,
        content: content,
        owner: 'khmo',
        tags: '',
      });
    }

    fs.writeFileSync(filePath, rendered);
    console.log(`✅ [${templateType}] created: ${filePath}`);
    if (statusOverride) console.log(`   Status: ${statusOverride}`);
    if (doCommit) {
      gitSync(`📝 [${templateType}] ${name}`);
    }
    return;
  }

  // 레거시 모드 (--project / --decision / --raw / daily)
  switch (mode) {
    case 'project': {
      ensureDir(WIKI_PROJECTS);
      const filePath = path.join(WIKI_PROJECTS, `${sanitizeName(name)}.md`);
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
      const header = `# ${name}\n\n> Last updated: ${ts}\n\n`;
      if (existing && existing.length > 100) {
        const updated = existing.trimEnd() + `\n\n---\n\n## Update (${ts})\n\n${content}\n`;
        fs.writeFileSync(filePath, updated);
      } else {
        fs.writeFileSync(filePath, header + `## Overview\n\n${content}\n\n---\n`);
      }
      console.log(`✅ Project doc: ${filePath}`);
      break;
    }

    case 'decision': {
      ensureDir(WIKI_DECISIONS);
      const filePath = path.join(WIKI_DECISIONS, `${sanitizeName(name)}.md`);
      const entry = `\n\n## ${name} (${ts})\n\n${content}\n\n---\n`;
      fs.appendFileSync(filePath, entry);
      console.log(`✅ Decision appended: ${filePath}`);
      break;
    }

    case 'raw': {
      ensureDir(RAW);
      const filePath = path.join(RAW, `${sanitizeName(name)}.md`);
      fs.writeFileSync(filePath, `# ${name}\n\n> ${ts}\n\n${content}\n`);
      console.log(`✅ Raw file: ${filePath}`);
      break;
    }

    case 'daily':
    default: {
      ensureDir(RAW);
      const filePath = path.join(RAW, `${today}.md`);
      const entry = `## ${ts}\n\n${content}\n\n`;
      fs.appendFileSync(filePath, entry);
      console.log(`✅ Daily log: ${filePath}`);
      break;
    }
  }

  if (doCommit) {
    const msg = `📝 ${today} — ${content.slice(0, 60).trim()}...`;
    gitSync(msg);
  }
}

main();
