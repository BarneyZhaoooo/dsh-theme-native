# Contributing

感谢关注 `dsh-theme-native`。

## 本地验证

在仓库根目录运行：

```bash
node tools/emit-plugin.mjs
node tools/verify-runtime.mjs
node tools/verify-manifest.mjs
node tools/simulate-client.mjs
```

提交 UI 改动时，请说明 DSH 版本，并附上实际设置页截图。不要提交个人路径、账号信息、凭证或本机生成的配置文件。

## 设计边界

- 只使用 DSH 官方 bundle、Client slot 和 theme token 扩展点。
- 不直接修改宿主 DOM，不引入 DSH Client primitive 包。
- 不把字体文件、账号信息或远程请求加入插件。
- 新增颜色先通过对比度和浅色/深色模式验证。

## 提交问题

请提供 DSH 版本、插件版本、复现步骤和相关验证输出。不要在 issue 中粘贴 API key、登录信息或完整本机日志。
