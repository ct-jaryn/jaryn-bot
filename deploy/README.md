# 部署

> 完整部署、反代、备份恢复与升级见 [docs/operations/deployment.md](../docs/operations/deployment.md)。

## Docker Compose（推荐）

```bash
cp .env.example .env        # 填 DEEPSEEK_API_KEY（可选，缺省用 echo provider）
docker compose -f deploy/docker-compose.yml up -d --build
# → http://127.0.0.1:8787
```

镜像说明：

- 基于 `node:24-bookworm-slim`，直接以 Node 运行 TypeScript（无需编译步骤）
- 构建时把 `packages/*` 链到 `node_modules/@jaryn/*`
- 数据卷 `/data`：SQLite、workspace、artifacts、computers、skills、vault.key
- 默认只绑 `127.0.0.1:8787`，公网请用 Caddy/Nginx 反代 TLS

## 反代 + TLS（公网必做）

```bash
# 把 deploy/Caddyfile 里的域名改成你的，然后：
docker run -d --name caddy -p 80:80 -p 443:443 \
  -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile" \
  -v caddy_data:/data -v caddy_config:/config caddy:2
```

要点：

- jary 只绑 `127.0.0.1:8787`，**不要**把 8787 直接暴露到公网；
- 设置 `JARY_API_TOKEN`（强随机串），否则任何能访问端口的人都是 owner；
- Caddy 自动签发/续期证书并加 HSTS；WebSocket/SSE 走同一个反代即可（`flush_interval -1`）；
- 配对端点（`/api/devices/pair`）建议在边缘限速；
- 更完整的鉴权模型与威胁模型见 [docs/operations/security.md](../docs/operations/security.md)。

## 云电脑镜像（可选）

```bash
docker build -t jaryn-computer:0.2 -f deploy/computer/Dockerfile .
# 使用 Docker 后端
jary serve --patch packages/bundles/docker-computer/patch.json
```

## 不用 Docker

```bash
node packages/cli/src/index.ts init --home ./data-home
node packages/cli/src/index.ts serve --home ./data-home --port 8787
```

## 检查

```bash
node scripts/check-deploy.ts   # 校验 Dockerfile/compose 与包注册表一致
node packages/cli/src/index.ts doctor
```
