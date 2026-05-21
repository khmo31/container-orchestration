# MEMORY.md — 장기 기억

> ⚠️ startupContext에서만 로드. 컨텍스트 압축 시 반드시 `read`로 다시 로드.

## 조직 구조 (2026-05-20 — CrewAI Hierarchical Orchestration)

```
👑 khmo
  │
  ├─ #일반 ── claw-full (full tools) ── 자유 대화
  │
  └─ #오케스트레이션 ── claw-restricted (messaging only)
        → sessions_send ── crewai-manager (CrewAI 라우터)
              ├─ Hermes (분석/추론/기록)
              ├─ MetaGPT (기획/설계/코드)
              ├─ EJClaw (리뷰/심사)
              ├─ OpenCode (버그수정)
              └─ Auto-Trading (자동매매)
```

## 역할 정의

- **khmo**: #일반/오케스트레이션 채널 선택. 통제권 보유.
- **claw-full**: 자유 대화, 상황 파악, 빠른 조회
- **claw-restricted**: 도구 제한됨, CrewAI 게이트 역할
- **crewai-manager**: CrewAI 기반 라우팅 엔진 (싼 LLM)
- **Hermes/MetaGPT/EJClaw/OpenCode/Trading**: 실행자 컨테이너

## 교훈 & 실수 기록

### ❌ 시종장/보좌관 모델 실패 (2026-05-20)
- 프롬프트 기반 enforcement는 LLM이 bypass 가능함을 입증
- "Hermes 먼저 거쳐라" → 2시간 만에 위반
- **원인:** LLM에게 선택권을 주면 가장 편한 길을 선택함

### 🔧 해결: CrewAI 계층 구조 (2026-05-20)
- 도구 자체를 물리적으로 제한 (tools.profile: minimal)
- bypass할 선택지 자체를 코드로 차단
- 채널 분리: #일반(자유) / #오케스트레이션(강제)

## 서버 현황

**서버:** khmoserver (Intel i5-4200U, 8GB RAM, 128GB SSD)
**crewai-manager:** Docker 컨테이너 (Python + CrewAI)
**Hermes:** deepseek-v4-pro, 포트 8000

## 주요 아키텍처 결정

### 1. CrewAI 전환 (2026-05-20) — 현재
- dispatcher 폐기 → CrewAI 기반 Hierarchical Process
- 2채널 분리: 일반/오케스트레이션
- claw-restricted 도구 제한으로 강제성 확보
- crewai-manager = 순수 라우터 (직접 실행 안 함)

### 2. Discord Webhook 채널 시스템 (2026-05-21)
- 각 에이전트 컨테이너에 전용 디스코드 채널 + 웹훅 연결
- AI 에이전트 카테고리 아래 5개 채널: 헤르메스, 메타-gpt, ej클로, 오픈코드, 트레이딩
- 헤르메스는 main_api.py에 discord_say() 내장 → chat 응답마다 자동 포스팅
- Claw 중계: claw-relay.sh → 작업 결과를 해당 채널로 포워딩
- 신규 컨테이너 자동 온보딩: discover.js → discord-onboard.sh → 채널생성 + 웹훅연결 (12시간 크론)
- 공유 스크립트: webhook-say.sh / webhook-say.py / claw-relay.sh (모든 컨테이너에 설치)
