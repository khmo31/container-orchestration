FROM ghcr.io/anomalyco/opencode:latest

RUN mkdir -p /opencode/config /opencode/workspace

# Provider 설정 (OpenCode Go)
RUN echo '{"provider":{"opencode-go":{}}}' > /opencode/config/config.json

EXPOSE 4096

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
