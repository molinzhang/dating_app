# Website Creation

约会匹配产品的 Vite + React 前端原型。原始设计来自 [Figma](https://www.figma.com/design/3nVUEa8XDUAINiTI81T8Re/Website-Creation)。

## 本地运行

### 环境要求

- Node.js 20 LTS（Node.js 18+ 也可运行）
- pnpm 9 或更高版本

项目提交了 `pnpm-lock.yaml`，请优先使用 pnpm，避免生成第二份锁文件。

```bash
cd website
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

开发服务器启动后，访问终端中 Vite 输出的地址（通常是 `http://localhost:5173`）。

生产构建检查：

```bash
pnpm build
```

## 配置说明

当前版本不需要环境变量，也没有真实后端请求。登录、注册、问卷、匹配结果均为前端演示逻辑，状态保存在浏览器 `localStorage` 的 `cg_state` 键中。若演示状态异常，可在浏览器开发者工具中删除该键后刷新。

后续接入后端时：

1. 将 API 地址放入本地 `.env.local`（例如 `VITE_API_BASE_URL`），不要提交真实地址、密钥或令牌。
2. 提交一份不含敏感值的 `.env.example`。
3. 将 `src/app/App.tsx` 中 `AppProvider` 的本地演示方法替换为 API 调用。

项目交接文档：

- [当前网站功能说明](../docs/CURRENT_WEBSITE_FUNCTIONS.md)
- [后端、匹配算法与数据库 Agent 交接说明](../docs/BACKEND_ALGORITHM_DATABASE_AGENT_GUIDE.md)
- [后端接入文档入口](./BACKEND_INTEGRATION.md)

## 会提交与不会提交的内容

会提交源码、静态资源、`package.json`、`pnpm-lock.yaml`、Vite/PostCSS 配置和协作文档。以下本地产物由根目录 `.gitignore` 排除：

- `node_modules/`
- `dist/`、`.vite/`、`.cache/`、`coverage/`
- `.env`、`.env.*`（示例配置除外）
- 编辑器设置、日志和操作系统临时文件
