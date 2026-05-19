#!/bin/bash
# AI Factory - Claw Management Script
# 사용법: ./aifactory.sh <명령어> [인자]

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
ENV_FILE="${PROJECT_DIR}/.env"

# .env 파일 로드
if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

dc() {
    docker compose -f "$COMPOSE_FILE" "$@"
}

case "${1:-help}" in
    up)
        echo "🚀 AI Factory 시작..."
        dc up -d
        echo "✅ MetaGPT: http://metagpt:8080 (컨테이너 내부)"
        echo "✅ EJClaw: http://ejclaw:8081 (컨테이너 내부)"
        ;;
    down)
        echo "🛑 AI Factory 종료..."
        dc down
        ;;
    build)
        echo "🔨 AI Factory 빌드..."
        dc build
        ;;
    status|ps)
        dc ps
        ;;
    logs)
        shift
        dc logs -f "$@"
        ;;
    metagpt)
        shift
        echo "📋 MetaGPT 실행: metagpt $*"
        dc exec -T metagpt metagpt "$@"
        ;;
    ejclaw)
        shift
        echo "🤖 EJClaw 실행: $*"
        dc exec -T ejclaw "$@"
        ;;
    shell:metagpt)
        dc exec metagpt /bin/bash
        ;;
    shell:ejclaw)
        dc exec ejclaw /bin/bash
        ;;
    init)
        echo "🔧 AI Factory 초기화..."
        if [ ! -f "$ENV_FILE" ]; then
            cp "${PROJECT_DIR}/.env.example" "$ENV_FILE"
            echo "⚠️  .env 파일 생성됨. API 키를 설정하세요: ${ENV_FILE}"
        fi
        dc build
        dc up -d
        echo "✅ 초기화 완료"
        ;;
    test:metagpt)
        echo "🧪 MetaGPT 테스트..."
        dc exec -T metagpt metagpt "Create a simple hello world Python script" --project-name "test-project"
        echo "✅ 결과: /workspace/test-project/"
        ;;
    *)
        echo "AI Factory - 사용법:"
        echo "  ./aifactory.sh up              # 컨테이너 시작"
        echo "  ./aifactory.sh down            # 컨테이너 종료"
        echo "  ./aifactory.sh build           # 컨테이너 빌드"
        echo "  ./aifactory.sh status          # 상태 확인"
        echo "  ./aifactory.sh logs [service]  # 로그 확인"
        echo "  ./aifactory.sh metagpt <args>  # MetaGPT 명령 실행"
        echo "  ./aifactory.sh ejclaw <args>   # EJClaw 명령 실행"
        echo "  ./aifactory.sh init            # 초기 설정"
        echo "  ./aifactory.sh test:metagpt    # MetaGPT 테스트 실행"
        ;;
esac
