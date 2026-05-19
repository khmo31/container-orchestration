# 통합 아키텍처: MetaGPT + EJClaw + gstack + OpenClaw

## 개요

세 개의 오픈소스 + OpenClaw(나)를 결합한 **AI 소프트웨어 팩토리** 아키텍처.

```
khmo (회장님)
  └─ "이거 해" / "이거 안 되는데?"
       │
       ▼
┌─────────────────────────────────────────┐
│  🦀 OpenClaw (Claw = 비서 / 시종장)       │
│  역할: 트리아지, 오케스트레이션, ENV 주입,   │
│        사용자 커뮤니케이션                  │
└────┬────────────┬──────────────┬─────────┘
     │            │              │
     ▼            ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ MetaGPT  │ │ EJClaw   │ │ gstack   │
│ (본사)    │ │ (외주팀)  │ │ (두뇌)    │
│ 기획/설계  │ │ 구현/검증 │ │ 프롬프트  │
└──────────┘ └──────────┘ └──────────┘
```

---

## 1. 컴포넌트 분석

### 1.1 MetaGPT (본사 기획부)
- **언어:** Python 3.9+
- **역할:** ProductManager, Architect, TeamLeader, Engineer, DataAnalyst
- **동작:** 1줄 요구사항 → PRD → System Design → Task List → 코드
- **핵심:** `software_company.py`에서 `Team.hire([...])`로 역할 구성
- **증분 모드:** `--inc` 플래그로 기존 프로젝트 기반 변경만 수행
- **LLM 타입:** OpenAI, Anthropic, DeepSeek, OpenRouter, Gemini, Ollama 등 20+ 지원
- **설치:** `pip install metagpt`, 설정 `~/.metagpt/config2.yaml`

### 1.2 EJClaw (외주 개발팀)
- **언어:** TypeScript (Bun runtime, SQLite WAL)
- **역할:** Owner(작업자) / Reviewer(리뷰어) / Arbiter(중재자) — 3인 Tribunal
- **동작:** Owner가 코드 작성 → Reviewer가 교차 검증 → Arbiter가 교착 해결
- **평결 체계:** `TASK_DONE`, `STEP_DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, `NEEDS_CONTEXT`
- **중재자 평결:** `PROCEED`, `REVISE`, `RESET`, `ESCALATE`
- **에이전트 타입:** `codex` (Codex CLI / OpenAI) 또는 `claude` (Claude Code CLI / Anthropic)
- **MoA (Mixture of Agents):** 외부 모델(Kimi, GLM) 의견을 Arbiter에 주입 가능
- **설치:** Bun + Claude Code CLI / Codex CLI

### 1.3 gstack (엘리트 두뇌 이식)
- **제작:** Garry Tan (Y Combinator CEO)
- **형태:** 23개의 Claude Code Skill 파일 (Markdown + Bash)
- **핵심 스킬:**
  - `/office-hours` — YC식 제품 발상/검증
  - `/plan-ceo-review` — CEO 전략 리뷰 (4가지 모드)
  - `/plan-eng-review` — 아키텍처/데이터 흐름 검증
  - `/plan-design-review` — 디자인 차원 평가 (0-10)
  - `/review` — PR 코드 리뷰 (SQL 안전성, LLM 신뢰 경계 등)
  - `/qa` — 실제 브라우저 QA 테스트 + 버그 수정
  - `/ship` — 테스트 → 리뷰 → PR 생성
  - `/cso` — OWASP Top 10 + STRIDE 보안 감사
  - `/design-review` — 실시간 시각 QA + 픽스 루프
- **핵심 철학:** "Boil the Lake" — AI의 한계비용이 거의 0이면 완전하게 해라
- **설치:** `git clone` → `./setup`

---

## 2. 컨테이너 아키텍처

### 2.1 컨테이너 분리 전략

**결론: MetaGPT 컨테이너 + EJClaw 컨테이너는 각각 격리. Docker 네트워크로 연결.**

```
┌────────────────────────────────────────────────────────────────────┐
│                       Docker Network: aifactory                     │
│                                                                     │
│  ┌─────────────────────────┐    ┌──────────────────────────┐       │
│  │ MetaGPT Container        │    │ EJClaw Container          │       │
│  │ (본사 기획부)             │    │ (외주 개발팀)              │       │
│  │                          │    │                           │       │
│  │ Python 3.9+              │    │ Bun 1.3+                  │       │
│  │ pip install metagpt      │    │ Claude Code CLI           │       │
│  │                          │    │ Codex CLI                 │       │
│  │ 모델: OpenCode Go API    │    │ SQLite (DB)               │       │
│  │   또는 DeepSeek 직접     ├────┤                           │       │
│  │                          │    │ 모델: OpenCode Go API     │       │
│  └──────────┬───────────────┘    │   또는 Claude/Codex 직접  │       │
│             │                    └─────────────┬────────────┘       │
│             │                                  │                    │
│             └──────────────┬───────────────────┘                    │
│                            │                                        │
│                    ┌───────▼────────┐                               │
│                    │  공유 볼륨      │                               │
│                    │  /workspace    │                               │
│                    │  설계서 ↔ 코드  │                               │
│                    └────────────────┘                               │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ OpenClaw (Gateway 위, 외부)                                   │   │
│  │ 🦀 Claw: 트리아지 + 오케스트레이션                              │   │
│  │ → docker exec / docker compose run 으로 컨테이너 호출          │   │
│  │ → 공유 볼륨으로 결과 확인                                      │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

**분리 이유:**

| 항목 | MetaGPT | EJClaw |
|------|---------|--------|
| 런타임 | Python 3.9+ (pip) | Bun 1.3+ (npm) |
| 의존성 | metagpt 패키지 + pip deps | Claude Code CLI + Codex CLI + Bun |
| 상태 관리 | Git workspace (파일) | SQLite DB + Discord |
| 모델 접근 | OpenAI 호환 API | Claude Agent SDK / Codex SDK |
| 재시작 영향 | 독립적 | 독립적 |

### 2.2 컨테이너 간 통신

| 경로 | 방식 |
|------|------|
| Claw → MetaGPT | `docker exec metagpt metagpt "요구사항" --inc` |
| Claw → EJClaw | `docker exec ejclaw bun run ...` 또는 HTTP API 호출 |
| MetaGPT → EJClaw | 공유 볼륨 (`/workspace`) 통해 설계서 파일 전달 |
| EJClaw → MetaGPT | 공유 볼륨 통해 코드 저장, 필요시 HTTP 콜백 |
| MetaGPT → OpenCode Go | 외부 API 호출 (컨테이너 outbound) |
| EJClaw → OpenCode Go / Claude / Codex | 외부 API 호출 (컨테이너 outbound) |

### 2.3 Docker Compose 구조 (초안)

```yaml
version: "3.8"
name: aifactory

networks:
  aifactory-net:
    driver: bridge

volumes:
  workspace-data:
  metagpt-home:
  ejclaw-data:

services:
  metagpt:
    build: ./docker/metagpt
    container_name: metagpt
    volumes:
      - workspace-data:/workspace
      - metagpt-home:/root
    networks:
      - aifactory-net
    environment:
      - OPENCODE_GO_KEY=${OPENCODE_GO_KEY}
      - METAGPT_LLM_MODEL=opencode-go/deepseek-v4-pro
    restart: unless-stopped
    # 대기 모드로 실행, Claw가 docker exec로 명령

  ejclaw:
    build: ./docker/ejclaw
    container_name: ejclaw
    volumes:
      - workspace-data:/workspace
      - ejclaw-data:/data
    networks:
      - aifactory-net
    environment:
      - OPENCODE_GO_KEY=${OPENCODE_GO_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - EJCLAW_CONFIG=/workspace/ejclaw-config/
    restart: unless-stopped
```

---

## 3. API / 모델 호환성

### 3.1 OpenCode Go 지원 모델 ($10/월)

| 모델 | 용도 | 추론 능력 | 경제성 |
|------|------|----------|-------|
| **DeepSeek V4 Pro** | 기획, 설계, 코딩, 중재 | ⭐⭐⭐⭐⭐ | 보통 |
| **DeepSeek V4 Flash** | 리뷰, QA, 단순 작업 | ⭐⭐⭐⭐ | 매우 좋음 |
| Qwen3.6 Plus | QA, 문서화, 일상 업무 | ⭐⭐⭐⭐ | 좋음 |
| Kimi K2.6 | 리서치, 분석 | ⭐⭐⭐⭐ | 보통 |
| MiniMax M2.7 | 번역, 문서 요약 | ⭐⭐⭐ | 좋음 |

### 3.2 GitHub Copilot Edu Pro 지원 모델

(2026년 3월 이후 Copilot Student 플랜 변경으로 직접 선택 가능 모델 축소)

**Copilot Edu Pro (유료) 사용 가능 모델:**
- GPT-5.3-Codex (GA)
- GPT-5.4 (GA)
- GPT-5.4 mini (GA)
- GPT-5.5 (GA)
- Claude Haiku 4.5 (GA)
- Claude Opus 4.5 / 4.6 (GA)

**참고:** Copilot Edu Pro는 유료 업그레이드. 무료 Student 플랜에서는 GPT-4.1 등 제한적. khmo가 Copilot Edu Pro를 가지고 있다면 Claude Opus / GPT-5 Codex 모델 사용 가능.

### 3.3 MetaGPT LLM 설정

MetaGPT는 **OpenAI 호환 API를 전부 지원**한다.

```yaml
# ~/.metagpt/config2.yaml (MetaGPT 컨테이너 내부)

# Option A: OpenCode Go → DeepSeek V4
llm:
  api_type: "openai"
  model: "deepseek-v4-pro"   # 모델 ID
  base_url: "https://opencode.ai/zen/go/v1/chat/completions"
  api_key: "${OPENCODE_GO_KEY}"

# Option B: DeepSeek 직접 API
# llm:
#   api_type: "deepseek"
#   model: "deepseek-chat"
#   base_url: "https://api.deepseek.com/v1"
#   api_key: "${DEEPSEEK_API_KEY}"

# Option C: Copilot Edu Pro (GitHub Models)
# llm:
#   api_type: "openai"
#   model: "gpt-5.4"
#   base_url: "https://models.inference.ai.azure.com"  # Copilot 추론 엔드포인트
#   api_key: "${GITHUB_TOKEN}"
```

**MetaGPT가 지원하는 api_type:**
`openai`, `anthropic`, `claude`, `deepseek`, `openrouter`, `gemini`, `azure`, `ollama`, `mistral`, `bedrock` 등 20+ — **거의 모든 LLM 호환**

### 3.4 EJClaw 모델 설정

EJClaw는 `codex` 또는 `claude` Agent Type으로 동작:

```json
// EJClaw Config (room_settings.json)
{
  "paired": {
    "ownerAgentType": "codex",        // Codex CLI 사용
    "reviewerAgentType": "codex",     // Codex CLI 사용
    "arbiterAgentType": "codex",       // Codex CLI 사용
    "maxRoundTrips": 5,
    "arbiterDeadlockThreshold": 3
  },
  "models": {
    "owner": {
      "model": "gpt-5.3-codex",      // Codex 호환 고성능 모델
      "effort": "high",
      "fallbackEnabled": true
    },
    "reviewer": {
      "model": "gpt-5.3-codex",      // 또는 DeepSeek V4 Flash
      "effort": "medium",
      "fallbackEnabled": true
    },
    "arbiter": {
      "model": "gpt-5.4",            // 가장 강력한 모델로 판단
      "effort": "high",
      "fallbackEnabled": true
    }
  },
  "providers": {
    "claudeDefaultModel": "claude-opus-4-6",
    "codexDefaultModel": "gpt-5.3-codex"
  }
}
```

### 3.5 추천 모델 매트릭스 (역할별)

**Provider별 사용 가능 모델:**

| Provider | 모델 | 용도 |
|----------|------|------|
| **OpenCode Go** ($10/mo) | DeepSeek V4 Pro, V4 Flash, Qwen3.6 Plus, Kimi K2.6, MiniMax M2.7 | 기본 전담 — 추가 결제 불필요 |
| **Copilot Edu Pro** (보유) | GPT-5.3-Codex, GPT-5.4, Claude Opus 4.6, Claude Haiku 4.5 | 보조 — Codex-high 필요시 |

**역할별 최종 할당 (2026-05-16 최종):**

| 역할 | 작업 | 선택 모델 | Provider |
|------|------|---------|----------|
| **MetaGPT PM** | PRD, 요구사항 | **GPT-5.4-mini-high** | Copilot Edu Pro |
| **MetaGPT Architect** | 시스템 설계 | **GPT-5.4-mini-high** | Copilot Edu Pro |
| **EJClaw Owner** | 코드 작성 | **GLM-5.1** | OpenCode Go |
| **EJClaw Reviewer** | 코드 리뷰 | **Qwen3.6 Plus** | OpenCode Go |
| **EJClaw Arbiter** | 교착 중재 | **Kimi K2.6** (1M+ ctx) | OpenCode Go |
| **QA / 테스트** | 버그 발견, 검증 | **GPT-5.3-Codex** | Copilot Edu Pro |
| **보안 감사** | OWASP, STRIDE | DeepSeek V4 Pro | OpenCode Go |

**Provider별 매핑:**

| 컨테이너 | API | 모델들 |
|----------|-----|-------|
| **MetaGPT** | Copilot Edu Pro (`models.inference.ai.azure.com`) | GPT-5.4-mini, GPT-5.3-Codex, Claude Opus 등 |
| **EJClaw** | OpenCode Go (`opencode.ai/zen/go/v1`) | GLM-5.1, Qwen3.6 Plus, Kimi K2.6 |

**Gemini 2.5 Pro / 3.1 Pro:** Copilot Edu Pro 공식 지원 여부 불확실. GitHub Models API에 있을 수 있으나 추후 테스트 필요.

---

## 4. 통합 파이프라인

### 4.1 신규 기능 개발 (Full Pipeline)

```
Step 0: khmo → Claw
  "새로운 TODO 앱 만들어줘"
  
Step 1: Claw → MetaGPT (Planning Phase)
  판단: 신규 기능 → 본사 기획부터
  명령: docker exec metagpt metagpt "Create a TODO app" --inc

  [MetaGPT 컨테이너 내부]
  PM (DeepSeek V4 Pro + gstack office-hours 프롬프트)
    → PRD 생성 (요구사항, 사용자 스토리, 경쟁 분석)
  
  Architect (DeepSeek V4 Pro + gstack plan-eng-review 프롬프트)
    → System Design (DB 구조, API 스펙, 컴포넌트)
  
  TeamLeader
    → Task List (세부 구현 태스크)

  출력: /workspace/project_name/ 내 문서들 (공유 볼륨)

Step 2: Claw → EJClaw (Implementation Phase)
  MetaGPT의 설계서 / Task List를 공유 볼륨으로 EJClaw에 전달
  
  [EJClaw 컨테이너 내부 - Tribunal 루프]
  Owner (DeepSeek V4 Pro) → 코드 작성
  Reviewer (DeepSeek V4 Flash) → 코드 리뷰
    └─ DONE → 다음 태스크
    └─ DONE_WITH_CONCERNS → Owner 수정 → 재리뷰
    └─ BLOCKED → Arbiter 호출
         └─ PROCEED → 진행
         └─ REVISE → Owner 수정
         └─ RESET → 새 접근법
         └─ ESCALATE → Claw (→ khmo)

  gstack Reviewer 체크리스트 적용:
  - SQL Injection / NoSQL Injection
  - LLM Trust Boundary (출력 검증 누락)
  - 조건부 사이드 이펙트 (early return 전 cleanup)
  - 전체 시스템 구조 붕괴 방지
  - "It should work"는 증거가 아님 — 실제 검증

Step 3: Claw → gstack Skills (QA & Release Phase)
  QA: gstack /qa 실제 브라우저 테스트 (3단계: Quick/Standard/Exhaustive)
  Design: gstack /design-review 시각 QA
  Security: gstack /cso OWASP + STRIDE 보안 감사
  Ship: gstack /ship PR 생성 + 머지

Step 4: Claw → khmo (Report)
  완료 보고서 (무엇이 만들어졌는지, 어떻게 동작하는지, diff)
```

### 4.2 버그 수정 (Short Circuit)

```
Step 0: khmo → Claw
  "로그인 버튼 누르면 500 에러 나"

Step 1: Claw 판단
  "단순 코드 버그. 기획 변경 아님."
  → MetaGPT 본사 생략
  → EJClaw 컨테이너에 직행

Step 2: Claw → EJClaw
  명령: "로그인 버튼에서 500 에러. 원인 찾아서 수정해줘"
  첨부: 에러 로그, 최근 변경된 파일 리스트

  [EJClaw Tribunal]
  - Owner가 코드 분석 (DeepSeek V4 Pro)
  - Reviewer가 수정 검증 (DeepSeek V4 Flash)
  - 수정 완료

Step 3: Claw → khmo
  "원인은 세션 만료 체크 로직 버그였고, 수정했습니다. (diff 첨부)"
```

### 4.3 BLOCKED / HITL 처리 (사용자 필요 시)

```
[상황 1] ENV / API 키 부족
EJClaw Owner: "OpenWeather API 키가 필요합니다"
  → BLOCKED 상태로 Claw에게 보고

Claw → khmo:
  "외주팀에서 날씨 API 연동하려는데 키가 필요하다고 멈췄어요.
   키를 보내주시면 전달하겠습니다."

khmo → Claw:
  "키는 abc123..."

Claw:
  1. .env 파일에 기록 (컨테이너 공유 볼륨)
  2. MetaGPT/EJClaw 설정에 환경변수로 주입
  3. "키 전달했어, 멈춘 곳부터 재개해" → EJClaw 작업 재개

──────────────────────────────────────────

[상황 2] Arbiter도 판단 불가 (ESCALATE)
EJClaw Arbiter: "Owner는 A안, Reviewer는 B안.
   두 접근법 모두 기술적으로 유효. 어떤 걸 선택할지 사용자 결정 필요."
  → ESCALATE → Claw → khmo

Claw → khmo:
  "개발팀에서 두 가지 방법 중 선택이 필요합니다:
   A안: 단순하지만 확장성 제한
   B안: 확장성 좋지만 구현 복잡
   어떤 걸로 할까요?"

khmo → Claw:
  "A안으로 가"

Claw:
  Arbiter 판결을 PROCEED로 전달 → Owner A안으로 진행

──────────────────────────────────────────

[상황 3] 반복 BLOCKED (루프 감지)
EJClaw: 동일한 BLOCKED가 2회 이상 반복

Claw 판단:
  "이건 에이전트들끼리 해결 못 하는 문제"
  → 자동으로 khmo에게 상황 보고 + 판단 요청
  → 해결 후 진행

──────────────────────────────────────────

[상황 4] 비용/토큰 한도 도달
OpenCode Go 월간 한도 도달 → API 429

Claw:
  감지 → khmo에게 보고
  "OpenCode Go 월간 한도에 도달했습니다.
   대안: 1) Zen 잔액으로 fallback 2) 다른 API 키 추가
   어떻게 할까요?"
```

---

## 5. gstack 프롬프트 이식

gstack의 SKILL.md 파일들은 Claude Code용이지만, **프롬프트 내용 자체는 시스템에 독립적**이다.

### 5.1 이식 방법

1. **SKILL.md 추출:** `/gstack/<skill-name>/SKILL.md` 에서 `## Preamble` 이후의 실제 행동 지침 텍스트 추출
2. **프롬프트 변환:** Claude Code 전용 지시사항 제거, 범용 LLM 지시사항으로 변환
3. **주입:** MetaGPT의 `prompts/` 파일 또는 EJClaw의 `prompts/` 파일에 저장
4. **모델 고려:** DeepSeek V4 / GPT / Claude 각각에 맞게 미세 조정

### 5.2 이식 매핑

| 타겟 역할 | 원본 페르소나 | gstack 이식 소스 | 적용될 모델 |
|-----------|-------------|-----------------|-------------|
| MetaGPT PM | 기본 PM 프롬프트 | `/office-hours` + `/plan-ceo-review` | DeepSeek V4 Pro |
| MetaGPT Architect | 기본 Architect 프롬프트 | `/plan-eng-review` | DeepSeek V4 Pro |
| MetaGPT Engineer | 기본 엔지니어 프롬프트 | (EJClaw로 대체) | - |
| EJClaw Owner | 기본 Owner 프롬프트 | `plan-ceo-review` 확장모드 | DeepSeek V4 Pro |
| EJClaw Reviewer | 기본 Reviewer 프롬프트 | `/review` 체크리스트 | DeepSeek V4 Flash |
| EJClaw Arbiter | 기본 Arbiter 프롬프트 | (gstack Arbiter 없음 → 자체 유지) | DeepSeek V4 Pro |
| 추가 QA 단계 | (없음) | `/qa` 브라우저 QA 방법론 | Qwen3.6 Plus |
| 추가 Security | (없음) | `/cso` OWASP + STRIDE | DeepSeek V4 Pro |
| 최종 릴리스 | (없음) | `/ship` PR/릴리스 워크플로 | - |

### 5.3 핵심 이식 내용

**gstack `/review` → EJClaw Reviewer 프롬프트:**
```
리뷰 체크리스트 (gstack 기반):
1. SQL Injection / NoSQL Injection — 사용자 입력이 쿼리에 직접 삽입?
2. LLM Trust Boundary — LLM 출력을 검증 없이 시스템 명령으로 실행?
3. 조건부 사이드 이펙트 — early return 전에 cleanup 누락?
4. 전체 시스템 구조 변경 감지 — 필요 이상으로 광범위한 수정?
5. 회귀 테스트 필요성 — 기존 기능 영향 범위?
6. 증거 기반 검증 — "it should work"는 무시, 실제 실행 결과 요구
```

**gstack `/plan-ceo-review` → EJClaw Owner 프롬프트:**
```
코딩 전에 다음 4가지 모드 중 선택:
1. SCOPE EXPANSION — 더 큰 그림, 10x 솔루션
2. SELECTIVE EXPANSION — 핵심 + 선택적 확장
3. HOLD SCOPE — 요구사항에 충실, 엄격함
4. SCOPE REDUCTION — MVP, 최소 필수 기능만
```

---

## 6. 설계 원칙

### 6.1 Cost Control (토큰 낭비 방지)

1. **트리아지 필수:** 모든 요청은 Claw가 먼저 판단. 불필요한 MetaGPT 실행 방지
2. **MetaGPT --inc 모드:** 항상 증분 모드로 실행. 백지 상태 재기획 방지
3. **EJClaw 루프 제한:** Owner↔Reviewer 루프가 3회 이상이면 Arbiter 자동 호출
4. **Stagnation 감지:** EJClaw 내장 기능 (Spinning, Oscillation, Diminishing returns)
5. **모델 계층화:** 중요한 작업(설계, 코딩, 중재) = V4 Pro / 단순 작업(리뷰, QA) = V4 Flash

### 6.2 안전 장치

| 장치 | 설명 |
|------|------|
| **HITL** | 모든 에이전트 프롬프트에 "모르면 지어내지 말고 보고해" 규칙 |
| **ENV 게이트** | API 키/비밀번호는 Claw만 관리, 에이전트 직접 접근 불가 |
| **ESCALATE 경로** | Arbiter 판단 불가 → Claw → khmo (3.3 참조) |
| **BLOCKED 루프 감지** | 동일 BLOCKED 2회 → 자동 사용자 보고 |
| **Git SSOT** | 모든 변경은 Git으로 관리 |
| **브랜치 프로토콜** | EJClaw의 `codex/owner/<folder>` 브랜치 불변 |

### 6.3 Boil the Lake (gstack 철학)

AI의 한계비용이 거의 0에 가까울 때:

- 코드 리뷰 시 "대충 괜찮겠지" → **리뷰어가 직접 검증 명령 실행**
- QA 시 "에이 설마" → **실제 브라우저로 모든 케이스 통과**
- 에러 시 "문법만 고치고 넘어가" → **근본 원인 분석**
- 보안 시 "괜찮겠지" → **OWASP + STRIDE 정식 감사**

---

## 7. 구현 로드맵

### Phase 1: 기본 통합 (1주)
- [ ] Dockerfile: MetaGPT 컨테이너 (Python 3.9 + metagpt)
- [ ] Dockerfile: EJClaw 컨테이너 (Bun + Claude Code CLI + Codex CLI)
- [ ] Docker Compose: 네트워크 + 공유 볼륨 구성
- [ ] MetaGPT LLM 설정: OpenCode Go → DeepSeek V4 Pro
- [ ] EJClaw 기본 설정: room_settings, agent type
- [ ] Claw → 컨테이너 CLI 호출 인터페이스
- [ ] 기본 트리아지 룰 구현 (신규 vs 버그)

### Phase 2: gstack 프롬프트 이식 (1주)
- [ ] gstack repo clone, SKILL.md 구조 분석
- [ ] `/office-hours` → MetaGPT PM 프롬프트 이식
- [ ] `/plan-ceo-review` → MetaGPT PM + EJClaw Owner 이식
- [ ] `/plan-eng-review` → MetaGPT Architect 이식
- [ ] `/review` → EJClaw Reviewer 이식
- [ ] HITL/BLOCKED 규칙 전 프롬프트에 주입

### Phase 3: 전체 파이프라인 (1-2주)
- [ ] Full Pipeline: khmo → Claw → MetaGPT → EJClaw → 결과
- [ ] Short Circuit: 버그 → Claw → EJClaw (MetaGPT 생략)
- [ ] ENV/HITL 핸들링: Blocked → Claw → khmo → 재개
- [ ] BLOCKED 루프 감지 및 자동 보고
- [ ] gstack QA/보안/릴리스 단계 추가
- [ ] 최종 보고서 포맷 정의

### Phase 4: 운영 & 고도화 (계속)
- [ ] OpenCode Go 사용량 모니터링
- [ ] EJClaw Arbiter MoA 설정 (필요시)
- [ ] MetaGPT --inc 모드 활용 최적화
- [ ] 회고/개선 루프
- [ ] 타임아웃 및 에러 복구
- [ ] 컨테이너 헬스체크 + 자동 재시작

---

## 8. 참고 자료

- MetaGPT: https://github.com/FoundationAgents/MetaGPT
- EJClaw: https://github.com/phj1081/EJClaw
- gstack: https://github.com/garrytan/gstack
- OpenClaw: https://github.com/openclaw/openclaw
- OpenCode Go: https://opencode.ai/docs/go/
- GitHub Copilot Supported Models: https://docs.github.com/copilot/reference/ai-models/supported-models
- DeepSeek V4: https://api-docs.deepseek.com/
- Boil the Lake: https://garryslist.org/posts/boil-the-ocean

---

*최초 작성: 2026-05-16*
*1차 수정: 2026-05-16 — OpenCode Go/Copilot 호환성, 컨테이너 네트워크, 모델 매트릭스, BLOCKED 상세 추가*
