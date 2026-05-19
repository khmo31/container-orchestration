#!/usr/bin/env node

/**
 * wiki_pipeline.js — 01_Parsed → 10_Wiki 변환 파이프라인
 *
 * OpenClaw cron으로 주기 실행.
 * 01_Parsed의 새 파일을 감지 → Hermes API로 요약/분류 → record.js로 10_Wiki 저장.
 *
 * 흐름:
 *   cron → Claw가 01_Parsed 스캔
 *     → 새 파일 발견 → Hermes API 호출 (요약 + 분류)
 *     → Hermes 응답 → record.js로 Projects/Decisions/Topics에 저장
 *     → 20_Meta/wiki_state.json 업데이트
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const SECOND_BRAIN = path.resolve('/home/khmo31/second_brain');
const PARSED_DIR = path.join(SECOND_BRAIN, '01_Parsed');
const WIKI_STATE = path.join(SECOND_BRAIN, '20_Meta', 'wiki_state.json');
const INGEST_STATE = path.join(SECOND_BRAIN, '20_Meta', 'ingest_state.json');
const RECORD_JS = path.resolve(__dirname, 'record.js');

const HERMES_URL = 'http://localhost:8000/chat';

class WikiPipeline {
  constructor() {
    this.state = this._loadState();
    this.ingestIndex = this._loadIngestIndex();
  }

  /**
   * 메인 실행
   */
  async run(options = {}) {
    const dryRun = options.dryRun || false;
    const forcePath = options.path || null; // 특정 파일만 처리

    console.log(`[WIKI] Starting pipeline (dryRun=${dryRun})`);
    console.log(`[WIKI] Parsed dir: ${PARSED_DIR}`);

    // 1. 01_Parsed에서 새 파일 검색
    const newFiles = forcePath
      ? [forcePath]
      : this._findNewFiles();

    if (newFiles.length === 0) {
      console.log('[WIKI] No new files to process');
      return { processed: 0, skipped: 0 };
    }

    console.log(`[WIKI] Found ${newFiles.length} new files`);

    let processed = 0;
    let skipped = 0;
    const errors = [];

    for (const filePath of newFiles) {
      try {
        const result = await this._processFile(filePath, dryRun);
        if (result.processed) {
          processed++;
          console.log(`[WIKI] ✅ ${path.basename(filePath)} → ${result.target}`);
        } else {
          skipped++;
          console.log(`[WIKI] ⏭️ ${path.basename(filePath)}: ${result.reason}`);
        }
      } catch (e) {
        errors.push({ file: filePath, error: e.message });
        console.error(`[WIKI] ❌ ${path.basename(filePath)}: ${e.message}`);
      }
    }

    // 상태 저장 (파일별)
    if (!dryRun) {
      this._saveState();
    }

    // 중복 탐지 (processed가 있을 때만)
    if (processed > 0 && !dryRun) {
      try {
        const { execFileSync } = require('child_process');
        console.log('[WIKI] Running dedupe check...');
        const dedupeResult = execFileSync('node', [
          path.join(SECOND_BRAIN, 'scripts', 'dedupe-check.js')
        ], { timeout: 15000, encoding: 'utf-8', stdio: 'pipe' });
        console.log(dedupeResult);
      } catch (e) {
        console.warn('[WIKI] Dedupe check failed (non-fatal):', e.message.slice(0, 100));
      }
    }

    console.log(`[WIKI] Done: ${processed} processed, ${skipped} skipped, ${errors.length} errors`);
    return { processed, skipped, errors };
  }

  /**
   * 01_Parsed에서 아직 처리되지 않은 파일 찾기
   */
  _findNewFiles() {
    if (!fs.existsSync(PARSED_DIR)) return [];

    const newFiles = [];
    const dates = fs.readdirSync(PARSED_DIR).sort();

    for (const dateDir of dates) {
      const datePath = path.join(PARSED_DIR, dateDir);
      if (!fs.statSync(datePath).isDirectory()) continue;

      const sources = fs.readdirSync(datePath);
      for (const sourceDir of sources) {
        const sourcePath = path.join(datePath, sourceDir);
        if (!fs.statSync(sourcePath).isDirectory()) continue;

        this._walkDir(sourcePath, (filePath) => {
          // Skip metadata.json files
          if (path.basename(filePath) === 'metadata.json') return;

          const relPath = path.relative(PARSED_DIR, filePath);
          // Check if already processed
          if (!this.state.processed[relPath]) {
            newFiles.push(filePath);
          }
        });
      }
    }

    return newFiles;
  }

  /**
   * 디렉토리 순회
   */
  _walkDir(dir, callback) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this._walkDir(fullPath, callback);
      } else if (entry.isFile()) {
        callback(fullPath);
      }
    }
  }

  /**
   * 단일 파일 처리: 읽기 → Hermes 요약 → record.js 저장
   */
  async _processFile(filePath, dryRun) {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const relPath = path.relative(PARSED_DIR, filePath);
    const fileName = path.basename(filePath, '.md');
    const fileExt = path.extname(filePath);

    // 빈 파일 스킵
    if (!content || content.length < 50) {
      return { processed: false, reason: 'empty_or_too_small' };
    }

    // 이미 10_Wiki에 있는 내용인지 확인 (중복 방지)
    if (content.includes('#') && relPath.includes('10_Wiki')) {
      return { processed: false, reason: 'already_wiki_content' };
    }

    if (dryRun) {
      console.log(`[WIKI] Would process: ${relPath} (${content.length} chars)`);
      return { processed: true, target: 'dry_run' };
    }

    // Hermes API 호출: 요약 + 분류
    const summary = await this._callHermes(content, fileName);

    if (!summary.success) {
      throw new Error(`Hermes API failed: ${summary.error}`);
    }

    const category = summary.category || 'topic';
    const title = summary.title || this._cleanFileName(fileName);
    const body = summary.summary || content.substring(0, 1000);

    // category에 따라 record.js 호출
    const targetDir = this._getTargetDir(category);

    const { execFileSync } = require('child_process');
    try {
      execFileSync('node', [
        RECORD_JS,
        '--template', targetDir,
        title,
        body
      ], { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
    } catch (e) {
      // record.js 실패 시 Topics에 직접 쓰기
      this._writeToTopics(title, body);
    }

    // 상태 업데이트
    this.state.processed[relPath] = {
      at: new Date().toISOString(),
      title,
      category,
      source_size: content.length,
      source_date: this._extractDate(relPath)
    };

    this._saveState();

    return {
      processed: true,
      target: `${targetDir}/${title}`,
      category,
      title
    };
  }

  /**
   * Hermes API: 컨텐츠 요약 + 분류
   */
  _callHermes(content, fileName) {
    return new Promise((resolve) => {
      const prompt = `You are a document curator. Analyze the following content and produce:

1. **title**: A concise, descriptive title for wiki storage (in Korean, max 50 chars)
2. **category**: One of "project" (기술/개발/시스템 관련), "decision" (의사결정/아키텍처 관련), "topic" (일반 지식/참고 자료), "skill" (설정/프롬프트/스킬), "meeting" (회의록/논의), "rfc" (제안서/RFC), "guide" (가이드/매뉴얼)
3. **summary**: A structured summary (Korean, max 500 chars) that captures key information

File source: ${fileName}

CONTENT:
${content.substring(0, 3000)}

Respond with ONLY a JSON object (no markdown):
{"title": "...", "category": "project|decision|topic|skill|meeting|rfc|guide", "summary": "..."}`;

      const payload = JSON.stringify({ message: `[wiki_pipeline] ${prompt}` });

      const req = http.request({
        hostname: 'localhost', port: 8000, path: '/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const reply = parsed.reply || parsed.response || '';
            // Extract JSON from reply (strip code blocks)
            let jsonStr = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            const jsonMatch = jsonStr.match(/\{[\s\S]*"title"[\s\S]*"summary"[\s\S]*\}/);
            if (jsonMatch) {
              const result = JSON.parse(jsonMatch[0]);
              const validCategories = ['project', 'decision', 'topic', 'skill', 'meeting', 'rfc', 'guide'];
              return resolve({
                success: true,
                title: result.title || this._cleanFileName(fileName),
                category: validCategories.includes(result.category) ? result.category : 'topic',
                summary: result.summary || content.substring(0, 500)
              });
            }
            // Fallback: extract from reply directly
            resolve({
              success: true,
              title: this._cleanFileName(fileName),
              category: 'topic',
              summary: reply.substring(0, 500)
            });
          } catch (e) {
            resolve({ success: false, error: `Parse failed: ${e.message}` });
          }
        });
      });

      req.on('error', e => resolve({ success: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
      req.write(payload);
      req.end();
    });
  }

  /**
   * 카테고리별 저장 경로 결정
   */
  _getTargetDir(category) {
    const cat = ['project', 'decision', 'skill', 'topic', 'meeting', 'rfc', 'guide'].includes(category) ? category : 'topic';
    return cat;
  }

  /**
   * Topics에 직접 쓰기 (record.js 실패 fallback)
   */
  _writeToTopics(title, content) {
    const topicsDir = path.join(SECOND_BRAIN, '10_Wiki', 'Topics');
    if (!fs.existsSync(topicsDir)) fs.mkdirSync(topicsDir, { recursive: true });

    const safeName = title.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    const filePath = path.join(topicsDir, `${safeName}.md`);
    const entry = `# ${title}\n\n> Auto-imported from 01_Parsed at ${new Date().toISOString()}\n\n${content}\n`;
    fs.writeFileSync(filePath, entry, 'utf-8');
  }

  /**
   * 파일명에서 날짜 추출
   */
  _extractDate(relPath) {
    const match = relPath.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }

  /**
   * 파일명 정리
   */
  _cleanFileName(fileName) {
    return fileName
      .replace(/^LOCAL_[a-f0-9]+_/, '')
      .replace(/^[a-f0-9]+-/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50);
  }

  /**
   * 상태 로드
   */
  _loadState() {
    if (fs.existsSync(WIKI_STATE)) {
      try {
        return JSON.parse(fs.readFileSync(WIKI_STATE, 'utf-8'));
      } catch (e) {
        console.warn('[WIKI] Corrupt state file, resetting');
      }
    }
    return {
      last_run: null,
      processed: {},
      total_processed: 0
    };
  }

  /**
   * ingest state에서 parsed_index 참조
   */
  _loadIngestIndex() {
    if (fs.existsSync(INGEST_STATE)) {
      try {
        const ingest = JSON.parse(fs.readFileSync(INGEST_STATE, 'utf-8'));
        return ingest.parsed_index || {};
      } catch (e) {
        return {};
      }
    }
    return {};
  }

  /**
   * 상태 저장
   */
  _saveState() {
    this.state.last_run = new Date().toISOString();
    this.state.total_processed = Object.keys(this.state.processed).length;
    const dir = path.dirname(WIKI_STATE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(WIKI_STATE, JSON.stringify(this.state, null, 2), 'utf-8');
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const pipeline = new WikiPipeline();

  if (args.includes('--dry-run')) {
    await pipeline.run({ dryRun: true });
  } else if (args.includes('--file')) {
    const fileIdx = args.indexOf('--file');
    const filePath = fileIdx >= 0 && args.length > fileIdx + 1 ? args[fileIdx + 1] : null;
    if (filePath) {
      await pipeline.run({ path: filePath });
    } else {
      console.error('Usage: --file <path>');
    }
  } else if (args.includes('--status')) {
    console.log(JSON.stringify(pipeline.state, null, 2));
  } else {
    await pipeline.run();
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error('[WIKI] Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = WikiPipeline;
