# Phase 3 실행 계획

## 목표: Full Pipeline + Hermes ↔ second_brain 연결

### 1. Hermes ↔ second_brain 연결
```yaml
# 현재: Hermes 컨테이너가 second_brain 디렉토리에 접근 불가
# 필요: aifactory-net 네트워크에 Hermes 추가 + 볼륨 공유

# docker-compose에 Hermes 서비스 추가 (또는 기존 Hermes를 aifactory-net에 연결)
services:
  hermes:
    container_name: hermes
    networks:
      - aifactory-net  # ← 추가
    volumes:
      - second-brain-data:/home/second_brain  # ← second_brain 디렉토리 마운트
      - workspace-data:/workspace  # ← AI Factory 산출물 접근

# Claw → Hermes 명령 프로토콜:
# "Hermes, MetaGPT 결과를 second_brain에 정리해줘"
# → Hermes가 /workspace/hello-test3/docs/ 읽어서 second_brain ingest 실행
```

### 2. Full Pipeline (Claw Orchestration)
```
khmo → "TODO 앱 만들어줘"
  → Claw가 MetaGPT에 요청
  → MetaGPT 결과 확인
  → EJClaw에 구현 요청 (TODO 직접 구현 or 준비)
  → Hermes에 "결과를 second_brain에 기록해줘"
  → khmo에게 보고
```

### 3. Short Circuit (버그 → EJClaw 직행)
```
khmo → "로그인 버튼 500 에러"
  → Claw 판단: 설계 변경 없음 → MetaGPT 생략
  → 바로 EJClaw에 버그 수정 요청
  → Hermes에 "수정 내역 기록해줘"
```

### 4. BLOCKED/HITL 자동화
- ENV 부족 → Claw 감지 → khmo 메시지 보냄 → 키 받으면 EJClaw 재개
- 반복 BLOCKED 2회 → 자동 알림

### 5. QA 테스트
- gstack /qa → 브라우저 QA (Copilot GPT-5.3-Codex-high)
- 결과도 second_brain에 기록

---

## 우선순위 제안

1️⃣ **Hermes 네트워크 연결** — 기존 Hermes 컨테이너를 aifactory-net에 붙임
2️⃣ **공유 볼륨 마운트** — second_brain 디렉토리를 Hermes가 접근 가능하게
3️⃣ **Claw 명령 프로토콜** — 내가 "기록해줘" 했을 때 Hermes가 처리
4️⃣ **Short Circuit 테스트** — 버그 시나리오로 EJClaw 직행 확인
5️⃣ **Full Pipeline 테스트** — MetaGPT→EJClaw→Hermes 전체 흐름
