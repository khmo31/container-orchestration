#!/bin/bash
# webhook-say.sh <agent_name> <message>
# Sends a message to the agent's Discord channel via webhook.
# Usage: webhook-say.sh hermes "Hello from Hermes!"
# Multiline: webhook-say.sh metagpt "$(cat output.txt)"

AGENT=$1
shift
MESSAGE="$*"

if [ -z "$AGENT" ] || [ -z "$MESSAGE" ]; then
  echo "Usage: webhook-say.sh <agent_name> <message>"
  echo "Agents: hermes, metagpt, ejclaw, opencode, trading"
  exit 1
fi

WEBHOOKS_FILE="/home/khmo31/.openclaw/workspace/webhooks.json"
URL=$(python3 -c "import json; print(json.load(open('$WEBHOOKS_FILE')).get('$AGENT',''))" 2>/dev/null)

if [ -z "$URL" ]; then
  echo "Error: Unknown agent '$AGENT' or webhook not found"
  exit 1
fi

# Escape for JSON
ESCAPED=$(python3 -c "
import json,sys
print(json.dumps(sys.argv[1]))
" "$MESSAGE" 2>/dev/null)

curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "{\"content\": $ESCAPED}" && echo " [sent to $AGENT channel]"
