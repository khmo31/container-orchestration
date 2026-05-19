#!/bin/bash
set -e

echo "[EJClaw] Starting with agent_type=codex, model=${CODEX_DEFAULT_MODEL:-gpt-5.3-codex}"

# EJClaw 설정 디렉토리 준비
mkdir -p /data/db /data/rooms

# 설정 파일 환경변수 치환 (필요시)
# (room_settings.json은 직접 복사)

# EJClaw config 파일 생성
cat > /ejclaw/.env <<EOF
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
CODEX_DEFAULT_MODEL=${CODEX_DEFAULT_MODEL:-gpt-5.3-codex}
CLAUD_DEFAULT_MODEL=${CLAUD_DEFAULT_MODEL:-claude-opus-4-6}
DATA_DIR=/data
EJCLAW_ROOM_SETTINGS=/ejclaw/config/room_settings.json
WORKSPACE_ROOT=/workspace
EOF

echo "[EJClaw] Config ready. Data dir: ${DATA_DIR}"

# 명령어가 있으면 실행, 없으면 대기
if [ $# -gt 0 ]; then
    exec "$@"
else
    exec tail -f /dev/null
fi
