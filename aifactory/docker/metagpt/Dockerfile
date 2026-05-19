# MetaGPT Container — 빠른 업데이트
FROM aifactory-metagpt:latest AS base

# agentops Python 3.9 호환성 픽스
RUN pip install "agentops<0.3.0" 2>/dev/null

# config + entrypoint 최신화
COPY config/metagpt/config2.yaml /config/config2.yaml
COPY docker/metagpt/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["tail", "-f", "/dev/null"]
