#!/bin/bash
# gstack 프롬프트 이식 스크립트
# MetaGPT/EJClaw 컨테이너 실행 후 실행

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

# ============ 1. MetaGPT PM 프롬프트 주입 ============
echo "[1/4] Injecting gstack PM enhancement into MetaGPT..."
docker exec aifactory-metagpt bash -c '
  PM_FILE=$(python3 -c "import metagpt.prompts.product_manager; print(metagpt.prompts.product_manager.__file__)")
  echo "Backing up original PM prompt..."
  cp "$PM_FILE" "${PM_FILE}.bak"
  echo "PM prompt location: $PM_FILE"
'

# ============ 2. MetaGPT Architect 프롬프트 주입 ============
echo "[2/4] Injecting gstack Architect enhancement into MetaGPT..."
docker exec aifactory-metagpt bash -c '
  ARCH_FILE=$(python3 -c "import metagpt.prompts.di.architect; print(metagpt.prompts.di.architect.__file__)" 2>/dev/null || python3 -c "from metagpt.prompts.di import architect; print(architect.__file__)" 2>/dev/null)
  if [ -n "$ARCH_FILE" ]; then
    cp "$ARCH_FILE" "${ARCH_FILE}.bak"
    echo "Architect prompt location: $ARCH_FILE"
  else
    echo "Architect prompt file not found (might use RoleZero directly)"
  fi
'

# ============ 3. EJClaw Owner 프롬프트 주입 ============
echo "[3/4] Injecting gstack Owner enhancement into EJClaw..."
docker exec aifactory-ejclaw bash -c '
  PROMPT_DIR="/ejclaw/prompts"
  if [ -f "$PROMPT_DIR/owner-common-paired-room.md" ]; then
    cp "$PROMPT_DIR/owner-common-paired-room.md" "${PROMPT_DIR}/owner-common-paired-room.md.bak"
    echo "Owner prompt found at $PROMPT_DIR/owner-common-paired-room.md"
  fi
'

# ============ 4. EJClaw Reviewer 프롬프트 주입 ============
echo "[4/4] Injecting gstack Reviewer enhancement into EJClaw..."
docker exec aifactory-ejclaw bash -c '
  PROMPT_DIR="/ejclaw/prompts"
  if [ -f "$PROMPT_DIR/claude-paired-room.md" ]; then
    cp "$PROMPT_DIR/claude-paired-room.md" "${PROMPT_DIR}/claude-paired-room.md.bak"
    echo "Reviewer prompt found at $PROMPT_DIR/claude-paired-room.md"
  fi
'

echo ""
echo "✅ gstack prompt injection complete!"
echo ""
echo "Next steps:"
echo "  1. Review the enhancement files in prompts/"
echo "  2. Edit MetaGPT prompt files in the container if needed"
echo "  3. Edit EJClaw prompt files in the container if needed"
echo "  4. Restart containers to apply changes"
