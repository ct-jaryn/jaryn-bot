# 连接器示例

用 `--patch` 叠加到运行配置：

```bash
jary serve --patch examples/connectors/github.json
```

环境变量：

- GitHub：`GITHUB_TOKEN`
- Demo：`DEMO_API_KEY`

工具会以 `github.repo`、`github.issues`、`demo.get` 出现，调用前按 `risk` 走审批。
