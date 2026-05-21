#!/bin/bash
# start_crewai.sh — CrewAI Manager 서비스 시작/중지/재시작
CREWAI_DIR="/home/khmo31/.openclaw/workspace/crewai-manager"
VENV_DIR="/home/khmo31/crewai_env"
PORT="${CREWAI_PORT:-8001}"

case "${1:-start}" in
  start)
    echo "Starting CrewAI Manager on port $PORT..."
    export CREWAI_ROUTER_API_KEY="sk-rHshw5zGxRI5ZEPcdKBBBBhajxSRQEhSsgol1PC7ZUPd3halT6rxVusEyTumPmyW"
    export CREWAI_ROUTER_BASE_URL="https://opencode.ai/zen/go/v1"
    export CREWAI_ROUTER_LLM="opencode-go/deepseek-v4-flash"
    cd "$CREWAI_DIR" && source "$VENV_DIR/bin/activate" && \
    nohup python3 crewai_service.py > /tmp/crewai_manager.log 2>&1 &
    echo "PID: $!"
    echo "Log: /tmp/crewai_manager.log"
    ;;
  stop)
    pkill -f "crewai_service.py" 2>/dev/null && echo "Stopped" || echo "Not running"
    ;;
  restart)
    $0 stop; sleep 1; $0 start
    ;;
  status)
    if pgrep -f "crewai_service.py" > /dev/null; then
      echo "Running (PID: $(pgrep -f crewai_service.py))"
      curl -s http://localhost:$PORT/health 2>/dev/null || echo "Health check failed"
    else
      echo "Not running"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    ;;
esac