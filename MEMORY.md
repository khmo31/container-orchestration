# MEMORY.md — 장기 기억

> ⚠️ 이 파일은 startupContext에서만 로드된다. 컨텍스트 압축 시 반드시 `read`로 다시 로드할 것.
> 컨테이너 발견/등록 규칙은 **AGENTS.md**를 기준으로 따르고, 실제 에이전트 목록은 **TOOLS.md**를 참조할 것.

## 조직 구조 (2026-05-17 정립)

```
👑 khmo (사장/귀족) — 최종 결과만 확인
  └─ 🦀 Claw (비서/시종장) — 지시, 판단, 보고, 오케스트레이션 총괄
       ├─ 🧠 헤르메스 (고급 분석 엔진 — deepseek-v4-pro)
       │   - 더 좋은 모델 (v4 pro)로 복잡한 작업 전담
       │   - 장기기억 가능 (알려준 건 바로 흡수)
       │   - **파이프라인 모드**: 분석 → 분류 → 기록까지 원샷 처리
       │   - **배치/야간 작업**: 00_Raw 정리, 위키 분류, 주간 요약
       │   - Claw(나)는 전처리만, 본처리는 Hermes 위임
       │   - 호출: `curl http://localhost:8000/chat` (직접 API, sessions_spawn 금지)
       │   - 결과는 내가 검토/요약해서 khmo에게 보고
       ├─ 🤖 aifactory-metagpt (기획/설계/코드생성)
       │   - AI-Factory 프레임워크 기반 PM → Architect → Engineer → Review
       ├─ 🤖 aifactory-ejclaw (리뷰/구현/심사)
       │   - 코드 검토, 버그 수정, 기능 구현 전문
       └─ 🏗️ auto-trading (AI 자동매매 파이프라인)
           - LangGraph 기반 10+ 멀티에이전트, GitHub Copilot (3-tier)
           - Docker 컨테이너 auto-trading 으로 실행 중
           - CLI: python3 cli.py run daily / portfolio status / report 등록
```

## 역할 정의

- **khmo**: "이거 해"만 던짐. 최종 결과만 봄. 세부 진행 모름.
- **Claw (나)**: khmo 명령을 받아 내가 직접 처리할지, 에이전트에 위임할지 판단.
  - 직접 처리: 간단한 작업, 도구로 충분한 작업
  - MetaGPT 위임: 기획/설계/대규모 코드 생성
  - EJClaw 위임: 코드 검토, 버그 수정, 기능 구현
  - Hermes 위임: 복잡한 추론, 이미지 처리, 방대한 분석, second_brain 분류/기록 (파이프라인 모드)
  - 기타 컨테이너 위임: 해당 도메인 전문 작업
  - 결과는 항상 검토/요약해서 khmo에게 보고
- **헤르메스** (deepseek-v4-pro): 분석 → 분류 → 기록 원샷 처리. 배치/야간 작업 담당.
- **기타 컨테이너**: 각자 전문 도메인 담당.

## 판단 기준

| 구분 | Claw (나) | 헤르메스 |
|------|-----------|---------|
| 강점 | 맥락 유지, 도구 접근, 장기기억 관리, khmo와 직접 소통 | 더 좋은 모델(v4 pro), 복잡한 추론, 장기기억 |
| 적합 작업 | 단순/도구기반/직접 처리, 전처리 | 복잡한 추론/이미지 처리/방대한 분석/기록 파이프라인 |

→ **복잡할수록 헤르메스에 위임. 단순/전처리는 Claw가 처리.**

## PDF 처리 예시

- PDF(이미지 포함) 업로드 + "정리해줘" → 헤르메스 위임 (이미지 분석, 구조화)
- PDF(텍스트) 업로드 + "정리해줘" → 내가 직접 처리 가능

## 교훈 & 실수 기록 (2026-05-17)

### ❌ PDF 처리 실수: Tesseract OCR 폭주

**상황:** khmo가 job_wiki PDF(이미지 기반)를 노션에 정리해달라고 요청.
내가 서브 에이전트에 위임했는데, 서브 에이전트가 Hermes API를 직접 호출하지 않고
로컬 Tesseract OCR (`pytesseract kor+eng`)로 이미지를 분석하려 시도함.

**결과:**
- 4코어 구형 CPU에서 tesseract가 180%씩 두 개 동시 실행 → CPU 360% 점유
- 20분 넘게 시스템 마비, 응답 속도 극도로 저하
- 결국 강제 종료 처리

**원인:**
1. 서브 에이전트에게 Hermes API 호출을 명시적으로 강제하지 않음
2. 서브 에이전트가 "내가 직접 처리" 모드로 빠짐 (Hermes bypass)
3. `sessions_spawn`으로 생성된 서브 에이전트가 내 모델과 동일한 제약을 가짐

**🔧 재발 방지 규칙:**
1. **이미지 기반 PDF는 절대 서브 에이전트에 위임하지 말고 Hermes API를 직접 호출할 것**
   - `curl http://localhost:8000/chat` — 여기에 분석+Notion 기록까지 한 번에 요청
2. 서브 에이전트에 PDF 관련 작업을 줄 때는 반드시 다음 금지문구 포함:
   `"IMPORTANT: Do NOT use local OCR (tesseract, pytesseract, etc). Only use Hermes API for image analysis."`
3. 서브 에이전트 spawn 시 `context="fork"` 대신 `context="isolated"` 사용 고려 (너무 많은 맥락이 불필요한 판단 유발)
4. 복잡한 작업(이미지 분석 + 노션 기록)은 단일 Hermes API 호출로 처리 (여러 단계로 쪼개면 중간에 엉뚱한 경로로 빠질 위험)

## 주요 아키텍처 결정

1. **워크스페이스 7파일 체계** (2026-05-17):
   - AGENTS.md (운영 규칙, 매 턴 주입)
   - SOUL.md (성격), IDENTITY.md (정보), USER.md (사용자), TOOLS.md (설정)
   - MEMORY.md (기억), HEARTBEAT.md (태스크)
   - 우선순위: AGENTS > SOUL > IDENTITY > MEMORY

2. **컨테이너 발견 자동화** (2026-05-17):
   - 하트비트 시점 docker ps 스캔
   - 발견 시 Claw가 TOOLS.md → MEMORY.md → AGENTS.md 순서로 등록
   - 새 에이전트는 Step 1 의사결정 트리에 자동 추가

3. **Dispatcher 3-Layer 아키텍처 확장** (2026-05-17, khmo 제안 기반):
   - **Escalation Layer** (`lib/escalation.js`, `lib/repo_search.js`):
     - Policy 미매칭, 모든 에이전트 실패, Circuit Open, 실행 오류 시 자동 에스컬레이션
     - GitHub 저장소 검색 (관련 repo 추천)
     - 대체 접근법 제안, 사용자에게 구조화된 보고
   - **Reflection Memory** (`lib/reflection.js`):
     - 모든 디스패치 결과를 reflections/ 디렉토리에 JSONL 기록
     - patterns.json에 성공/실패율, 지연시간 집계
     - 실패율 30% 초과 시 policy_suggestions.json에 자동 개선 제안 생성
   - **Selective Planner** (`lib/planner.js`):
     - 복잡한 요청(200자 이상, confidence < 0.5, 다중 인텐트, 명시적 키워드)만 LLM 태스크 분해
     - 태스크 그래프 생성 → 각 step을 agent로 라우팅
     - 간단한 요청은 기존처럼 바로 실행 (비용 최적화)
   - **진화 방향**: router + executor → capability-aware execution OS
   - CLI: `--reflection` (요약), `--suggestions` (개선 제안), `--test-escalation`, `--test-planner`

4. **전체 컨테이너에 second_brain 읽기 마운트** (2026-05-18):
   - 모든 에이전트 컨테이너가 `/knowledge` 경로로 second_brain 읽기 전용 접근
   - Hermes: `mount ro` (기존), MetaGPT + EJClaw: `--mount type=bind,source=/home/khmo31/second_brain,target=/knowledge,ro`
   - 쓰기는 Claw/Hermes/inject.js만 가능 (일관성 유지)

5. **Connect AI 차용 — record.js v2 + inject.js** (2026-05-18, wonseokjung/connect-ai 참고):
   - `record.js --commit` → 기록 + 자동 git add/commit/push
   - `inject.js` (port 4826) → HTTP POST /inject 엔드포인트 (경량 지식 주입)
   - `record.js --template project|decision|skill|topic` → 구조화된 Wiki 페이지
   - Hermes 모델 `deepseek-v4-flash` → `deepseek-v4-pro` 업그레이드
   - Hermes 사용법 개선: 파이프라인 모드 (분석→분류→기록 원샷), 배치/야간 작업 위임

6. **second_brain 문서 표준화 (2026-05-19, Karpathy CLAUDE.md 기반):**
   - 템플릿을 코드에서 분리 → `_templates/` 마크다운 파일 (9종)
   - 문서 유형 5종 추가: meeting, rfc, postmortem, release, guide
   - 모든 문서에 frontmatter + 상태 라이프사이클 표준화
   - Surgical Model 도입: 기존 문서는 append, 새 파일 추가 금지
   - 중복 문서 7개 deprecated + 10+ cross-reference 연결
   - Hermes 분류 지침: `10_Wiki/Skills/wiki-classification-instructions.md`
   - 중복 탐지: `scripts/dedupe-check.js`
   - 표준 문서: `20_Meta/DocumentStandards.md`
