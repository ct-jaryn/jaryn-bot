# Bot computer: Chromium + optional Xvfb/VNC desktop + terminal
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ca-certificates fonts-noto-cjk \
      xvfb x11vnc novnc websockify \
      python3 xdotool git curl jq \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 10001 jary && mkdir -p /workspace /profile && chown -R jary /workspace /profile
USER jary
WORKDIR /workspace
EXPOSE 9222 6080
# Chromium (CDP) + Xvfb display + VNC -> noVNC bridge
ENTRYPOINT ["sh", "-c", "\
  Xvfb :99 -screen 0 1280x900x24 & \
  x11vnc -display :99 -nopw -forever -shared -rfbport 5900 & \
  websockify --web=/usr/share/novnc 6080 localhost:5900 & \
  exec chromium --no-sandbox --headless=new --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222 --user-data-dir=/profile --window-size=1280,900 about:blank"]
