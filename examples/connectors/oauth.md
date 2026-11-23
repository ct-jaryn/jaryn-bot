# 用 OAuth 连接 Gmail / Calendar

jaryn 不内置第三方 OAuth 应用（规避审核与密钥托管），你在自己的 Google Cloud 项目里建一个 OAuth 客户端即可：

1. 创建 OAuth 客户端（Web 应用），回调地址填：`https://<你的域名>/api/oauth/callback/gmail`（Calendar 同理替换 id）。
2. 设置环境变量：
   ```bash
   export JARY_OAUTH_TOKEN_URL_GMAIL=https://oauth2.googleapis.com/token
   export JARY_OAUTH_CLIENT_ID_GMAIL=xxx.apps.googleusercontent.com
   export JARY_OAUTH_CLIENT_SECRET_GMAIL=xxx
   export JARY_OAUTH_STATE_GMAIL=some-random-state
   ```
3. 在浏览器打开授权 URL（scope 自定，例如 `https://www.googleapis.com/auth/gmail.readonly`）：
   ```
   https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=https%3A%2F%2F<域名>%2Fapi%2Foauth%2Fcallback%2Fgmail&response_type=code&scope=...&state=some-random-state
   ```
4. 回调成功后 token 存入 Vault，连接器后续请求自动带 `Authorization: Bearer`。
5. 启动时叠加连接器配置：`jary serve --patch examples/connectors/gmail.json`

> access_token 默认 1 小时过期；如需长期使用，配置 refresh 流程（当前只保存 refresh_token，自动刷新待实现）。
