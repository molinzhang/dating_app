# dating_app

校友价值观匹配产品原型（Common Ground）。用 24 题价值观问卷 + 稳定匹配，每周为用户推荐一位对象。

匹配池按性取向拆成三个互不重叠的池子：异性池用 Gale-Shapley 稳定匹配，两个同性池用贪心配对（同性场景是 stable roommates 问题，不保证存在稳定解）。

线上环境：<https://dating-app-khaki-three.vercel.app>

## 项目结构

- `backend/`：FastAPI 后端 + 匹配算法（Postgres / Supabase）
  - `main.py` 接口层，`matching.py` Gale-Shapley 与逐题硬筛选，`db.py` 数据访问，`auth.py` 密码与会话
  - `text_match.py` 自我介绍 ↔ 期待的中文文本匹配（字符 n-gram TF-IDF，纯标准库）
  - `orientation.py` 性取向分池与年龄硬筛选
  - `questionnaire_config.py` 24 题、5 个阶段、7 个价值维度的定义
  - 测试：`python3 test_text_match.py`、`python3 test_matching_text.py`、`python3 test_orientation.py`（无需 pytest）
- `website/`：Vite + React + shadcn 前端
- `docs/`：交接说明与待办清单
- `gale_shapley_slides.md`：匹配算法讲解

## 本地运行

需要 Python 3.9+ 和 Node 18+（前端用 pnpm）。

### 1. 后端

```bash
cd backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

cp .env.example .env      # 然后把 DATABASE_URL 换成你自己的连接串
./venv/bin/uvicorn main:app --reload --port 8000
```

`DATABASE_URL` 指向任意 Postgres 均可（我们用 Supabase 的 Session pooler 地址；Supabase 的 Direct connection 只解析 IPv6，很多网络环境连不上）。首次启动会自动建表，不需要手动跑 SQL。

验证：<http://localhost:8000/api/health> 返回 `{"ok":true}`。

### 2. 前端

```bash
cd website
pnpm install
cp .env.example .env      # VITE_API_BASE_URL 默认指向 localhost:8000
pnpm dev
```

打开 <http://localhost:5173>。

### 3. 造测试数据（可选）

匹配需要池子里有人，且 Gale-Shapley 按 `min(男, 女)` 配对，哪边人多哪边就有人落单：

```bash
cd backend
./venv/bin/python seed_demo_pool.py 4     # 补齐两侧人数并留 4 人缓冲
```

生成的账号密码统一为 `password123`。脚本可重复运行，只补缺的。

## 参与开发

- **先设好自己的 git 身份**，否则提交会记到仓库所有者名下：
  ```bash
  git config user.name "你的名字"
  git config user.email "你的GitHub邮箱"     # 需已加进 GitHub 账号的 Emails
  ```
- 从 `main` 切分支开发（例如 `feat/xxx`、`fix/xxx`），完成后开 Pull Request，不要直接推 `main`。
- `.env` 已被 gitignore，**不要提交任何真实连接串或密码**；改动配置项时同步更新 `.env.example`。
- 目前分工：后端（`backend/`）由仓库所有者维护。前端改动如果需要新的接口字段，请在 PR 里写清楚字段名、取值范围和默认行为——前端先发字段、后端还没接的话，FastAPI 会静默忽略，数据会悄悄丢掉。

## 文档

- [待实现功能清单](./docs/TODO_BACKLOG.md)
- [当前网站功能说明](./docs/CURRENT_WEBSITE_FUNCTIONS.md)
- [后端接口契约（含逐题匹配偏好）](./website/BACKEND_INTEGRATION.md)
- [后端、匹配算法与数据库交接说明](./docs/BACKEND_ALGORITHM_DATABASE_AGENT_GUIDE.md)（写于后端实现之前，其接口设计部分已不作为实现依据）
- [前端本地运行说明](./website/README.md)
