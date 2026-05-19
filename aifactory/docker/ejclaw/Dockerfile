# EJClaw Container — Outsourced Dev Team
FROM oven/bun:1.3

ENV EJCLAW_HOME=/ejclaw \
    WORKSPACE=/workspace \
    DATA_DIR=/data

WORKDIR /ejclaw

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates python3 make gcc g++ && rm -rf /var/lib/apt/lists/*

# EJClaw 소스
RUN git clone --single-branch --depth 1 \
    https://github.com/phj1081/EJClaw.git /tmp/source \
    && mv /tmp/source/* /ejclaw/ && mv /tmp/source/.* /ejclaw/ 2>/dev/null; \
    rm -rf /tmp/source

# 의존성 + 러너 빌드
RUN bun install --frozen-lockfile && \
    bun run install:runners && \
    bun run --cwd runners/shared build && \
    bun run --cwd runners/agent-runner build && \
    bun run --cwd runners/codex-runner build

# 메인 + 대시보드
RUN bun run build && (bun run dashboard:build 2>/dev/null || true)

RUN mkdir -p ${DATA_DIR}/db ${DATA_DIR}/rooms

COPY config/ejclaw/room_settings.json /ejclaw/config/room_settings.json
COPY docker/ejclaw/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["tail", "-f", "/dev/null"]
