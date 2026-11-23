FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 10001 jary && mkdir -p /workspace /profile && chown -R jary /workspace /profile
USER jary
EXPOSE 9222
ENTRYPOINT ["chromium", "--headless=new", "--no-sandbox", "--remote-debugging-address=0.0.0.0", "--remote-debugging-port=9222", "--user-data-dir=/profile", "--window-size=1280,900", "about:blank"]
