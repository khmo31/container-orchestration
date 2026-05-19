# AGENTS.md — MANDATORY OPERATING MANUAL

> ⚠️ **이 파일은 컨텍스트에 매 실행(run)마다 주입된다 (OpenClaw contextInjection=always, 공식 문서 확인 완료).**
> 아래 규칙은 참고사항이 아니라 **반드시 따라야 하는 운영 지침**이다.
> khmo의 메시지를 처리하기 전에, 이 파일의 관련 섹션을 먼저 참조하라.

---

## 🚀 Dispatcher 우선 사용 (MANDATORY)

khmo가 요청을 보내면, **가능한 경우 `dispatcher.js`를 통해 처리**하라.

```
khmo 메시지
  → node dispatcher.js --dispatch "메시지"   (자동 분류 + 라우팅)
  → dispatcher가 처리 불가능한 경우에만 수동 판단
```

**dispatcher.js 사용이 강제되는 경우:**
- 새 기능/개발 요청 (classification 우선)
- 복잡한 분석 (에이전트 라우팅)
- 다단계 파이프라인 (MetaGPT + EJClaw)

**수동 처리해야 하는 경우:**
- dispatcher가 `no_matching_policy` 반환
- dispatcher가 `circuit_open` 반환 (직접 처리 + fallback)
- 민감한 설정 변경 (API 키, 시크릿)
- dispatcher 자체 수정 작업

### Dispatcher 명령어

```bash
# 디스패치 실행
node /home/khmo31/.openclaw/workspace/dispatcher/dispatcher.js --dispatch "khmo 메시지"

# 상태 확인
node /home/khmo31/.openclaw/workspace/dispatcher/dispatcher.js --status

# 헬스체크
node /home/khmo31/.openclaw/workspace/dispatcher/dispatcher.js --registry-check

# 최근 로그 조회
node /home/khmo31/.openclaw/workspace/dispatcher/dispatcher.js --logs
```

### Dispatcher 응답 해석

```json
{
  "success": true/false,
  "policy_id": "bug_short_circuit",
  "intent": ["bug"],
  "result": { "action": "route", "agent_id": "ejclaw", ... },
  "duration_ms": 1234,
  "fallback_used": false
}
```

- `success: true` → 결과를 khmo에게 보고
- `success: false` + `fallback_used: true` → fallback 결과 보고
- `success: false` + `circuit_open: true` → 직접 처리로 fallback
- `success: false` + `no_matching_policy` → 수동 분류 적용

---

## 🔴 Workflow Decision Tree (수동 Fallback용)

dispatcher가 처리 불가능할 때만 수동으로 적용:

### Step 1 — 유형 분류

```
khmo 메시지 분석:
  ├─ 버그/에러 ("~ 안 돼", "~ 에러", "500", "고장")
  │   → Short Circuit (Step 2-A)
  ├─ 신규 기능/개선 ("~ 만들어줘", "~ 추가해줘", "~ 구현")
  │   → MetaGPT 파이프라인 (Step 2-B-1)
  ├─ 코드 검토 ("검토해줘", "리뷰", "확인해봐")
  │   → EJClaw Review (Step 2-B-2)
  ├─ 복잡한 분석 / PDF / 이미지 처리 ("분석해줘", "PDF 정리", "이미지 봐줘")
  │   → Hermes 위임 (Step 2-B-3)
  ├─ 트레이딩/금융 관련 ("트레이딩", "주식", "포트폴리오")
  │   → auto-trading pipeline (Docker exec: python3 cli.py ...)
  ├─ 설정/환경변수 ("API 키", "환경변수", "설정")
  │   → 직접 처리
  ├─ 전략/아이디어 ("어떤 것 같아?", "검토")
  │   → 직접 처리 or Hermes
  ├─ 기록/저장 ("기록해둬", "저장")
  │   → Hermes API 직접 호출 → second_brain 저장
  └─ 일반 질문/기타
      → 직접 처리
```

### Step 2-A — Short Circuit (버그 수정)

```
khmo: "로그인 버튼 500 에러"
  → EJClaw 실행: "에러 로그: 500, 위치: 로그인 버튼. 원인 찾아서 수정해줘"
  → 완료 후 khmo에게 보고
  → Hermes(/chat) → second_brain 저장 (자동)
```

### Step 2-B-3 — Hermes 위임 (⚠️ 직접 API 호출 필수, v4 pro)

Hermes는 **분석 → 분류 → 기록**까지 한 번에 처리하는 파이프라인 모드로 사용.
Claw(나)는 전처리만 하고 본처리는 Hermes에 맡긴다.

**파이프라인 모드 (권장):**
```
khmo: "이 PDF 분석해서 노션에 정리해줘"
  → Claw: 파일 경로 확인, 기본 메타 추출 (전처리)
  → Hermes API 직접 호출 (sessions_spawn 금지!):
      curl http://localhost:8000/chat -d '{"message":"이 PDF 분석하고 10_Wiki/Projects/에 정리해서 기록까지 해줘"}'
  → Hermes 결과 검토 → khmo 보고
```

**배치/야간 작업:**
```
# 00_Raw 쌓인 거 정리해서 Wiki에 분류 (크론으로 새벽 실행)
curl http://localhost:8000/chat -d '{"message":"00_Raw/ 미분류 파일 분석해서 Wiki에 분류해줘"}'
```

**⚠️ 이미지 PDF 처리 필수 규칙 (위반 시 CPU 폭주):**
1. `sessions_spawn`으로 PDF 이미지 분석을 위임하지 말 것
2. Hermes API를 **직접** 호출할 것 (http://localhost:8000/chat)
3. 서브 에이전트 spawn 시 OCR 금지 문구 필수 포함

### Step 3 — 기록 (자동)

```
모든 완료된 작업은 khmo가 말하지 않아도 자동으로 기록:
  node record.js --project "Projects/xxx" "내용"        # 프로젝트 문서 (overwrite/append)
  node record.js --decision "Decisions/xxx" "내용"      # 결정 기록 (append)
  node record.js --raw "xxx" "내용"                      # 원시 데이터
  node record.js --template project "xxx" "내용"         # 템플릿 기반 Wiki (4종)
  node record.js --commit "내용"                          # 기록 + 자동 git push
  node record.js "내용"                                  # 일일 로그 (00_Raw/날짜.md)
```

**record.js** (v3): `/home/khmo31/.openclaw/workspace/record.js`
- Hermes 의존성 없음, Claw 직접 실행
- 템플릿을 `_templates/` 디렉토리 마크다운 파일에서 읽음 (코드-데이터 분리)
- `--template` 옵션: **9종** - project, decision, skill, topic, meeting, rfc, postmortem, release, guide
- `--status` 옵션: frontmatter 상태 오버라이드 (예: --status "review")
- `--commit` 옵션: 기록 직후 git add/commit/push 자동 실행
- `--template` + `--commit` + `--status` 조합 가능
  예: `node record.js --template rfc "API 설계" "내용" --status "review" --commit`
- 새 템플릿 유형 추가: `_templates/새유형.md` 파일만 만들고 `record.js`의 `getDirForType()`에 디렉토리만 추가

**inject.js** (HTTP 엔드포인트): `http://localhost:4826/inject`
- POST JSON `{"title":"...", "content":"...", "template":"...", "tags":["..."]}`
- 자동 git sync까지 한 번에 처리
- GET /health → 상태 확인

**Hermes 분류 지침**: `10_Wiki/Skills/wiki-classification-instructions.md`
- Hermes가 00_Raw/ → Wiki 분류 시 참조
- Surgical Model 적용 (기존 문서 append, 중복 금지)
- 9종 템플릿 + frontmatter + 상태 라이프사이클

**중복 탐지**: `scripts/dedupe-check.js` (second_brain 내)
- Projects/Topics/Skills 디렉토리 간 유사 파일명 감지
- 주기적 실행 권장 (배치 작업 시 포함)

기록 경로: `/home/khmo31/second_brain/10_Wiki/` (Projects/Decisions/Skills/Topics/Meetings/RFCs/Postmortems/Releases/Guides)
문서 표준: `20_Meta/DocumentStandards.md`

---

## 🏗️ Dispatcher 아키텍처 (참조용)

```
khmo 메시지 → dispatcher.js
  ├── parser.js (2-layer: Rule-based → LLM → Sanity check)
  ├── matcher.js (policy.json priority 기반 매칭)
  ├── executor.js (agent 호출: HTTP / docker exec)
  ├── circuit.js (CLOSED → OPEN → HALF_OPEN)
  ├── retry.js (exponential/linear backoff)
  ├── dedupe.js (request_id 중복 방지)
  ├── fallback.js (skip / notify / fallback_agent)
  └── observability.js (JSON line 로그 + trace)

핵심 파일 (코드와 분리된 데이터):
  ├── registry.json    ← Agent 정보 (추가만 하면 됨)
  └── policy.json      ← 라우팅 규칙 (수정만 하면 됨)
```

자세한 내용은 `workspace/dispatcher/` 참조.

---

## 🧠 MEMORY.md — 장기 기억 (중요: 압축 시 재읽기 필요)

- **주요 세션에서만 로드** (Discord 등 공유 컨텍스트에서는 금지)
- 중요한 결정, 맥락, 교훈은 반드시 MEMORY.md에 기록
- "기억해둬"라는 말이 없어도 스스로 판단해서 기록할 것

### ⚠️ 컨텍스트 압축 발생 시 필수 조치

컨텍스트 압축(/compact 또는 auto-compaction)이 발생하면:
1. MEMORY.md를 `read`로 다시 읽어라 (장기 기억 복원)
2. 이후 판단은 다시 읽은 MEMORY.md 내용을 기준으로 할 것

---

## 📝 기록 원칙 — 반드시 지킬 것

1. **khmo가 말하지 않아도** 중요한 변경/완료는 내 판단으로 second_brain 기록
2. 기록 범위: 코딩뿐 아니라 질문/답변/파일 업로드/아키텍처 결정 등 **모든 활동**
3. Two-Track 구조:
   - **메인 문서** (Overwrite): `second_brain/10_Wiki/Projects/xxx.md`
   - **결정 기록** (Append): `second_brain/10_Wiki/Decisions/xxx-의사결정.md`

---

## 🔒 안전 규칙

- **절대** 개인 데이터 외부 유출 금지
- **절대** 확인 없이 외부 전송 금지 (이메일, 트윗, 공개 글)
- 파괴적 명령은 `rm` 대신 `trash` 사용
- 불확실하면 물어볼 것

---

## 🤖 컨테이너/에이전트 자동 발견 및 등록

### 새 에이전트 발견 시 등록 절차

새 컨테이너 발견 시 아래 순서로 등록한다:

1. **Docker 스캔** (`docker ps --format`)
2. **registry.json에 등록**: endpoint, capabilities, timeout, retry, circuit breaker 설정 포함
3. 필요시 **policy.json에 라우팅 규칙 추가** (match 조건 + action)
4. TOOLS.md → MEMORY.md → second_brain 순서로 기록
5. khmo에게 보고

> **원칙**: dispatcher 코드는 수정할 필요 없음. registry.json + policy.json만 업데이트하면 자동 반영.

### 현재 알려진 에이전트

registry.json 참조. 최신 정보는 `workspace/dispatcher/registry.json`이 단일 진실 공급원.

---

## 워크스페이스 파일 관계도

| 파일 | 역할 | 비고 |
|------|------|------|
| **AGENTS.md** | 운영 지침 (dispatcher 우선 + 수동 fallback) | **매 턴 주입** |
| **SOUL.md** | 성격/말투 | startupContext |
| **IDENTITY.md** | 기본 정보 | startupContext |
| **USER.md** | 사용자 정보 | startupContext |
| **TOOLS.md** | 환경 설정 | startupContext |
| **MEMORY.md** | 장기 기억 | startupContext, **압축 시 재읽기** |
| **HEARTBEAT.md** | 하트비트 태스크 | startupContext |
| **dispatcher/** | **실행 엔진 (코드 + 설정)** | 실행 시 참조 |

**우선순위 (충돌 시): AGENTS.md (운영 규칙) > SOUL.md (성격) > IDENTITY.md (정보) > MEMORY.md (기억)**

---

## 관련 문서

- [Default AGENTS.md](/reference/AGENTS.default)
- [OpenClaw Context 문서](https://docs.openclaw.ai/concepts/context)
- `workspace/dispatcher/README.md` — Dispatcher 상세 사용법
