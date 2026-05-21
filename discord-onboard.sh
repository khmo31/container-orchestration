#!/bin/bash
# discord-onboard.sh — 새 에이전트 컨테이너를 디스코드에 온보딩
#
# Usage: discord-onboard.sh <agent_id> <display_name> [container_name]
#   agent_id:     소문자 id (hermes, metagpt, ejclaw, ...)
#   display_name: 채널에 표시될 이름 (한글/영문)
#   container_name: docker 컨테이너명 (선택. 주어지면 webhook-say.sh 복사)
#
# Example:
#   discord-onboard.sh myagent "My Agent" my-agent-container
#
# 환경변수: DISCORD_TOKEN (없으면 openclaw.json에서 자동 읽음)

set -euo pipefail

AGENT_ID="$1"
DISPLAY_NAME="$2"
CONTAINER_NAME="${3:-}"

if [ -z "$AGENT_ID" ] || [ -z "$DISPLAY_NAME" ]; then
  echo "Usage: discord-onboard.sh <agent_id> <display_name> [container_name]"
  exit 1
fi

WORKSPACE="/home/khmo31/.openclaw/workspace"
WEBHOOKS_FILE="$WORKSPACE/webhooks.json"
GUILD_ID="1505459883145957396"
CATEGORY_ID="1505477865464922242"  # AI 에이전트

# ── 토큰 획득 ──
if [ -z "${DISCORD_TOKEN:-}" ]; then
  DISCORD_TOKEN=$(python3 -c "
import json
d = json.load(open('$WORKSPACE/../openclaw.json'))
print(d['channels']['discord']['token'])
" 2>/dev/null || true)
fi
if [ -z "${DISCORD_TOKEN:-}" ] && [ -f "/home/khmo31/.openclaw/.env" ]; then
  set +o allexport
  source /home/khmo31/.openclaw/.env 2>/dev/null || true
  DISCORD_TOKEN="${DISCORD_BOT_TOKEN:-}"
fi
if [ -z "${DISCORD_TOKEN:-}" ]; then
  echo "❌ Cannot find Discord bot token"
  exit 1
fi
echo "🔑 Token acquired"

# ── 1. 기존 채널 확인 (agent_id + display_name 여러 방식으로 매칭) ──
echo "🔍 Checking existing channels..."
CHANNEL_DATA=$(curl -sf -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/guilds/$GUILD_ID/channels" 2>/dev/null || echo "")

# 매칭할 채널명 후보들
CHANNEL_NAME=$(echo "$DISPLAY_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/ /-/g')
# Also try agent_id as channel name
CANDIDATE_NAMES=("$CHANNEL_NAME" "$AGENT_ID")

CHANNEL_ID=""
while IFS='|' read -r cid cname; do
  for candidate in "${CANDIDATE_NAMES[@]}"; do
    if [ "$cname" = "$candidate" ]; then
      CHANNEL_ID="$cid"
      echo "  ✅ Existing channel: #$cname ($cid)"
      break 2
    fi
  done
done < <(echo "$CHANNEL_DATA" | python3 -c "
import json,sys
data = json.load(sys.stdin)
for c in data:
    if c.get('parent_id') == '$CATEGORY_ID' and c['type'] == 0:
        print(f'{c[\"id\"]}|{c[\"name\"]}')
" 2>/dev/null || true)

# ── 2. 채널 생성 (없으면) ──
if [ -z "$CHANNEL_ID" ]; then
  echo "📝 Creating channel: #$CHANNEL_NAME"
  RESP=$(curl -sf -X POST "https://discord.com/api/v10/guilds/$GUILD_ID/channels" \
    -H "Authorization: Bot $DISCORD_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$CHANNEL_NAME\",\"type\":0,\"parent_id\":\"$CATEGORY_ID\"}" 2>/dev/null || echo "")
  
  if [ -z "$RESP" ]; then
    echo "❌ Failed to create channel"
    exit 1
  fi
  
  CHANNEL_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
  echo "  ✅ Created channel: #$CHANNEL_NAME ($CHANNEL_ID)"
fi

# ── 3. 웹훅 생성 ──
echo "🔗 Creating webhook for #$CHANNEL_NAME..."
# First check existing webhooks
EXISTING_WH=$(curl -sf -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/channels/$CHANNEL_ID/webhooks" 2>/dev/null || echo "")

WEBHOOK_URL=""
# Check if webhook for this agent already exists
for row in $(echo "$EXISTING_WH" | python3 -c "
import json,sys
data = json.load(sys.stdin)
for wh in data:
    if '$AGENT_ID' in wh.get('name', ''):
        print(f\"{wh['id']}|{wh['token']}\")
" 2>/dev/null || true); do
  OLD_IFS="$IFS"
  IFS='|' read -r wid wtok <<< "$row"
  IFS="$OLD_IFS"
  if [ -n "$wid" ] && [ -n "$wtok" ]; then
    WEBHOOK_URL="https://discord.com/api/webhooks/$wid/$wtok"
    echo "  ✅ Found existing webhook"
    break
  fi
done

if [ -z "$WEBHOOK_URL" ]; then
  # Create new webhook
  WH_RESP=$(curl -sf -X POST "https://discord.com/api/v10/channels/$CHANNEL_ID/webhooks" \
    -H "Authorization: Bot $DISCORD_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${AGENT_ID}-agent\"}" 2>/dev/null || echo "")
  
  if [ -n "$WH_RESP" ]; then
    WEBHOOK_ID=$(echo "$WH_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
    WEBHOOK_TOKEN=$(echo "$WH_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "")
    WEBHOOK_URL="https://discord.com/api/webhooks/$WEBHOOK_ID/$WEBHOOK_TOKEN"
    echo "  ✅ Created new webhook"
  fi
fi

if [ -z "$WEBHOOK_URL" ]; then
  echo "❌ Failed to create/get webhook"
  exit 1
fi
echo "  URL: ${WEBHOOK_URL:0:55}..."

# ── 4. webhooks.json 업데이트 ──
echo "📝 Updating webhooks.json..."
python3 << PYEOF
import json
path = "$WEBHOOKS_FILE"
try:
    with open(path) as f:
        hooks = json.load(f)
except:
    hooks = {}
hooks["$AGENT_ID"] = "$WEBHOOK_URL"
with open(path, 'w') as f:
    json.dump(hooks, f, indent=2)
print(f"  ✅ $AGENT_ID webhook saved")
PYEOF

# ── 5. webhook-say.sh를 컨테이너에 복사 ──
if [ -n "$CONTAINER_NAME" ]; then
  echo "📦 Copying webhook scripts to container: $CONTAINER_NAME..."
  docker cp "$WORKSPACE/webhook-say.sh" "$CONTAINER_NAME:/usr/local/bin/webhook-say.sh" 2>/dev/null || true
  docker cp "$WORKSPACE/webhook-say.py" "$CONTAINER_NAME:/usr/local/bin/webhook-say.py" 2>/dev/null || true
  docker cp "$WEBHOOKS_FILE" "$CONTAINER_NAME:/etc/webhooks.json" 2>/dev/null || true
  docker exec "$CONTAINER_NAME" chmod +x /usr/local/bin/webhook-say.sh /usr/local/bin/webhook-say.py 2>/dev/null || true
  echo "  ✅ Scripts copied to container"
fi

echo ""
echo "🎉 Onboarding complete: $DISPLAY_NAME → #$CHANNEL_NAME"
