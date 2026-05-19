#!/bin/bash
set -e

# 환경변수 기본값 설정
: "${METAGPT_LLM_MODEL:=deepseek-v4-pro}"
: "${METAGPT_LLM_BASE_URL:=https://opencode.ai/zen/go/v1/chat/completions}"
: "${METAGPT_LLM_API_KEY:=sk-placeholder}"

# config 템플릿 → 실제 config 생성
export METAGPT_LLM_MODEL METAGPT_LLM_BASE_URL METAGPT_LLM_API_KEY

mkdir -p /root/.metagpt
envsubst < /config/config2.yaml > /root/.metagpt/config2.yaml

echo "[MetaGPT] Config generated: model=${METAGPT_LLM_MODEL}, base_url=${METAGPT_LLM_BASE_URL}"

# 명령어가 있으면 실행, 없으면 대기
if [ $# -gt 0 ]; then
    exec "$@"
else
    exec tail -f /dev/null
fi
