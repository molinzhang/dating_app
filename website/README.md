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

前端**所有数据都来自 `backend/` 的真实接口**，没有任何演示/假数据路径——注册、登录、问卷、匹配、照片全部走 API。只有登录令牌存在 `localStorage`。

```bash
cp .env.example .env      # VITE_API_BASE_URL 默认指向 http://localhost:8000
```

不要把真实地址、密钥或令牌提交进仓库；改配置项时同步更新 `.env.example`。

### 测试

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

项目交接文档：

- [当前网站功能说明](../docs/CURRENT_WEBSITE_FUNCTIONS.md)
- [后端、匹配算法与数据库 Agent 交接说明](../docs/BACKEND_ALGORITHM_DATABASE_AGENT_GUIDE.md)
- [后端接入文档入口](./BACKEND_INTEGRATION.md)

> 活动/Pool、结构化资料（身高学历职业等 21 个字段）那一套 V2 界面**不在 main 上**，暂存在分支
> `v2-profile-events-experience`。设计契约见 [docs/PROFILE_EVENTS_BACKEND_INTEGRATION.md](../docs/PROFILE_EVENTS_BACKEND_INTEGRATION.md)。
> 它依赖 4 个尚未实现的接口（`/api/me/profile`、`/api/me/match-criteria`、`/api/events`、`/api/matches`），
> 在 main 上跑只会显示假数据，所以先摘掉了。

## 会提交与不会提交的内容

会提交源码、静态资源、`package.json`、`pnpm-lock.yaml`、Vite/PostCSS 配置和协作文档。以下本地产物由根目录 `.gitignore` 排除：

- `node_modules/`
- `dist/`、`.vite/`、`.cache/`、`coverage/`
- `.env`、`.env.*`（示例配置除外）
- 编辑器设置、日志和操作系统临时文件
