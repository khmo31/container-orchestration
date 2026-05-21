#!/bin/bash
# claw-relay.sh — Claw가 컨테이너 작업 결과를 디스코드 채널로 전달
# Usage: claw-relay.sh <agent_id> <message>
#   agent_id: hermes, metagpt, ejclaw, opencode, trading, ...
#   message:  보낼 내용 (파일 경로도 가능: @/path/to/file)
#
# Examples:
#   claw-relay.sh metagpt "기획 완료: API 설계서 작성"
#   claw-relay.sh ejclaw "$(cat review_result.txt)"
#   cat report.txt | claw-relay.sh trading -

WORKSPACE="/home/khmo31/.openclaw/workspace"
WEBHOOKS_FILE="$WORKSPACE/webhooks.json"
AGENT_ID="$1"
shift
MESSAGE="$*"

if [ -z "$AGENT_ID" ]; then
  echo "Usage: claw-relay.sh <agent_id> <message>"
  echo "  or:   echo 'msg' | claw-relay.sh <agent_id> -"
  echo "Agents: hermes, metagpt, ejclaw, opencode, trading"
  exit 1
fi

# Read from stdin if message is "-"
if [ "$MESSAGE" = "-" ]; then
  MESSAGE=$(cat)
fi

# Handle @file syntax
if [[ "$MESSAGE" == @* ]]; then
  FILE_PATH="${MESSAGE:1}"
  if [ -f "$FILE_PATH" ]; then
    MESSAGE=$(cat "$FILE_PATH")
  else
    echo "File not found: $FILE_PATH"
    exit 1
  fi
fi

# Get webhook URL
URL=$(python3 -c "
import json
try:
    with open('$WEBHOOKS_FILE') as f:
        hooks = json.load(f)
    print(hooks.get('$AGENT_ID', ''))
except:
    pass
")

if [ -z "$URL" ]; then
  echo "Error: No webhook for agent '$AGENT_ID'"
  echo "Available:"
  python3 -c "import json; [print(f'  {k}') for k in json.load(open('$WEBHOOKS_FILE'))]" 2>/dev/null
  exit 1
fi

# Truncate if too long
if [ ${#MESSAGE} -gt 1900 ]; then
  MESSAGE="${MESSAGE:0:1900}…"
fi

# Use curl with --data-urlencode to avoid shell escaping issues
ESCAPED=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$MESSAGE")
curl -sf -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "{\"content\": $ESCAPED}" \
  -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q 204 && \
  echo "✅ [$AGENT_ID] relayed ${#MESSAGE} chars" || \
  echo "❌ Failed to relay"
