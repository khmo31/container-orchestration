#!/bin/sh
set -e

# opencode 설정 파일 생성
mkdir -p /root/.config/opencode

# Custom provider로 OpenCode Go API 등록
cat > /root/.config/opencode/opencode.json << 'CONFIG'
{
  "provider": {
    "opencode-go-api": {
      "options": {
        "baseURL": "https://opencode.ai/zen/go/v1"
      }
    }
  }
}
CONFIG

# API 키를 OPENAI_API_KEY로 전달 (custom provider는 OpenAI 호환 API)
# 실제로 OpenCode Go API key 사용
if [ -n "$OPENCODE_GO_KEY" ]; then
    export OPENAI_API_KEY="$OPENCODE_GO_KEY"
fi

echo "Starting OpenCode web server on port ${PORT:-4096}..."
exec opencode web --port "${PORT:-4096}" --hostname "0.0.0.0"
