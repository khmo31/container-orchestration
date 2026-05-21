# TOOLS.md - Local Notes

### Sudo
**Password:** rkdgush1! (서버 sudo용)

### Notion
**Integration:** agent_workspace
**API:** https://api.notion.com/v1
**워크스페이스:** 강현모/의공학과님의 워크스페이스

### Inject (Second Brain HTTP Endpoint)
- **Port:** 4826
- **Endpoint:** `POST http://localhost:4826/inject`
- **Health:** `GET http://localhost:4826/health`
- **Script:** `/home/khmo31/.openclaw/workspace/inject.js`

### GitHub
**User:** khmo31
**Token:** ~/.git-credentials (PAT)

### Agents

| 에이전트 | 역할 | 엔드포인트 | 비고 |
|----------|------|-----------|------|
| **claw-full** | 자유 대화, 빠른 작업 | OpenClaw (#일반) | full tools |
| **claw-restricted** | 오케스트레이션 게이트 | OpenClaw (#오케스트레이션) | messaging only |
| **crewai-manager** | CrewAI 라우팅 엔진 | http://localhost:8001/route | 내부 전용 |
| **hermes** | 분석/추론/기록 | http://localhost:8000/chat | deepseek-v4-pro |
| **aifactory-metagpt** | 기획/설계/코드 | docker exec | AI-Factory |
| **aifactory-ejclaw** | 리뷰/심사 | docker exec | |
| **aifactory-opencode** | 버그수정 | docker exec | |
| **auto-trading** | 자동매매 | docker exec | |

### Knowledge Base
Second brain 읽기 전용: `/knowledge` (모든 컨테이너)
쓰기: Hermes (inject.js)
