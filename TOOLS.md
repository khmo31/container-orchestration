# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

### Sudo
**Password:** rkdgush1! (서버 sudo용)

### Notion

**Integration:** agent_workspace (워크스페이스 레벨 봇)
**Token:** ntn_... (TOOLS.md에 저장, 실제 값은 env)
**API:** https://api.notion.com/v1
**워크스페이스:** 강현모/의공학과님의 워크스페이스
**접근 가능:** 데이터베이스 06e05b98..., 여러 페이지들 (로봇진행상황, 인허가 기술문서, YOLOv8 등)

### Inject (Second Brain HTTP Endpoint)

- **Port:** 4826
- **Endpoint:** `POST http://localhost:4826/inject`
- **Health:** `GET http://localhost:4826/health`
- **Body:** `{"title": "...", "content": "...", "template": "project|decision|skill|topic", "tags": [...]}`
- **기능:** second_brain에 지식 저장 + 자동 git push
- **스크립트:** `/home/khmo31/.openclaw/workspace/inject.js`

### GitHub

**User:** khmo31
**Token:** ~/.git-credentials 에 저장 (PAT)
**접근:** `git` 명령어로 private repo clone/fetch 가능
**주의:** `git push` 는 확인 후 실행

### Agents (Docker 컨테이너) — 실제 실행 중

| 에이전트 | 역할 | API 엔드포인트 | 상태 |
|----------|------|---------------|------|
| aifactory-metagpt | 기획/설계/코드생성 | AI-Factory CLI (Internal) | ✅ 실행 중 |
| aifactory-ejclaw | 리뷰/구현/심사 | AI-Factory CLI (Internal) | ✅ 실행 중 |
| hermes | 복잡한 분석/PDF/추론/기록 | http://localhost:8000/chat | ✅ 실행 중 |
| auto-trading | AI 자동매매 파이프라인 | Docker (LangGraph + GitHub Copilot) | ✅ 실행 중 |

### 에이전트 발견 규칙
- `metagpt` → 기획/설계
- `ejclaw` → 리뷰/구현
- `hermes` → 분석/추론
- `trading` → 트레이딩/금융
- 그 외 → khmo에게 확인

### 참고: 환경변수 파일
- `.secrets.env` — Notion API 토큰 등 민감 정보 (gitignore 처리됨)
- `~/.git-credentials` — GitHub PAT (git push용)

### Knowledge Base 접근

모든 에이전트 컨테이너는 `/knowledge` 경로로 second_brain 읽기 전용 접근 가능:
- `ls /knowledge/10_Wiki/Projects/` — 프로젝트 문서
- `ls /knowledge/10_Wiki/Decisions/` — 결정 기록
- `ls /knowledge/00_Raw/` — 일일 로그
- 읽기 전용 (read-only), 쓰기 불가

## Related

- [Agent workspace](/concepts/agent-workspace)
