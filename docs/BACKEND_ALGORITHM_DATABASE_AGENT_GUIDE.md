# 后端、匹配算法与数据库 Agent 交接说明

> 文档快照：2026-07-25
>
> 目标：让负责 API、匹配算法和数据库的 Agent 能在不猜测前端行为的情况下开始实现
>
> 当前状态：本文是建议的 v1 契约，尚未由真实服务实现

## 1. 开始前必须知道的事实

仓库内存在两套不兼容的原型：

| 项目 | 当前网页 `website/` | 现有 Python 原型 |
| --- | --- | --- |
| 形态 | Vite + React 单页原型 | Streamlit 应用 |
| 接口 | 无真实 HTTP API | 无 HTTP JSON API |
| 问卷 | 24 题，1–7 分 | 10 题，1–5 分 |
| 结果 | 7 个维度、重要题目、版本和归档 | 10 维原始答案 |
| 用户字段 | 邮箱、社交账号、简介、期待、头像、认证和匹配状态 | 姓名、学校、年龄、性别、性别偏好、简介 |
| 匹配 | 每周一位、认证门槛、维度解释和反馈 | 同校+双向性别偏好，余弦相似度 Top 5 |
| 数据库 | 浏览器 `localStorage` | SQLite，两张表、每人单次问卷 |
| 鉴权 | 任意凭据演示 | 无鉴权 |

因此：

- `app.py`、`db.py`、`matching.py` 和 `questions.py` 只能作为早期思路参考，不能直接作为网页后端。
- 新后端必须以 24 题网页流程和本文契约为基线。
- 旧数据库没有生产数据迁移承诺；如果已有需保留的数据，应先另行确认映射规则。
- 不要让前端继续维护权威问题、维度或算法规则；正式版本应由后端的版本化定义提供。

当前网页行为的详细说明见 [CURRENT_WEBSITE_FUNCTIONS.md](./CURRENT_WEBSITE_FUNCTIONS.md)。

## 2. 实现目标与职责边界

后端负责：

- 账号、密码、会话和权限。
- 用户资料、联系方式可见性、头像 URL 和匹配开关。
- 校友认证状态与证据。
- 问卷定义、草稿、提交、版本、归档和维度分数。
- 匹配候选过滤、评分、每周批处理和结果解释。
- 推荐反馈、举报、屏蔽和联系方式访问控制。
- 数据一致性、审计、隐私、错误码和幂等性。

前端负责：

- 表单和页面交互。
- 调用 API 并展示服务端状态。
- 将 1–7 答案、草稿阶段和重要题号发送给后端。
- 不自行决定认证是否成功、用户是否有资格匹配或对方联系方式是否可见。
- 不自行生成正式匹配、不持有算法密钥或长期会话秘密。

## 3. API 通用约定

### 3.1 基础约定

```text
Base URL: /api/v1
Content-Type: application/json
字段命名: camelCase
ID: 不透明字符串，建议 UUID/ULID
时间: ISO 8601 UTC，例如 2026-07-25T20:30:00Z
```

建议本地前端使用：

```env
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

成功响应：

```json
{
  "data": {},
  "meta": {
    "requestId": "req_01..."
  }
}
```

`POST /auth/logout` 返回 `204` 是无 envelope 的例外。

失败响应：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不合法",
    "fields": {
      "email": "邮箱格式不正确"
    }
  },
  "meta": {
    "requestId": "req_01..."
  }
}
```

### 3.2 鉴权建议

浏览器端优先使用服务端会话和 `HttpOnly`、`Secure` Cookie。前后端分域时必须同时配置：

- 精确的 CORS allowlist，不使用 `*` 搭配凭据。
- `SameSite`、HTTPS 和 CSRF 防护。
- 登录、注册、验证码和密码重置限流。
- 密码使用 Argon2id 或 bcrypt 哈希，绝不保存明文。

v1 建议采用有状态的不透明会话：

```text
Cookie: cg_session（HttpOnly、Secure、SameSite=Lax）
普通会话 TTL: 24 小时
rememberMe 会话 TTL: 30 天
数据库: 只保存会话 token 的哈希
前端 fetch: credentials: "include"
CSRF: cg_csrf Cookie + X-CSRF-Token 请求头，所有写请求必须校验
```

具体 TTL 可以配置，但服务端、OpenAPI 和前端必须使用同一规则。

若最终使用 Bearer Token，应使用短期访问令牌和可撤销刷新机制，不把长期令牌写入 `localStorage`。

### 3.3 HTTP 状态码

| 状态码 | 用途 |
| --- | --- |
| `200` | 查询或更新成功 |
| `201` | 注册、创建草稿、创建举报成功 |
| `202` | 第三方认证或异步任务已受理 |
| `204` | 退出成功且无响应体 |
| `400` | 请求无法处理 |
| `401` | 未登录或会话失效 |
| `403` | 已登录但无权限，例如未认证或匹配暂停 |
| `404` | 资源不存在或对当前用户不可见 |
| `409` | 邮箱重复、版本冲突、状态冲突 |
| `422` | 字段或业务校验失败 |
| `429` | 请求过于频繁 |

建议稳定错误码：

```text
AUTH_REQUIRED
INVALID_CREDENTIALS
EMAIL_ALREADY_EXISTS
VALIDATION_ERROR
REVISION_CONFLICT
QUESTIONNAIRE_INCOMPLETE
IMPORTANT_QUESTION_COUNT_INVALID
VERIFICATION_REQUIRED
VERIFICATION_PENDING
MATCHING_PAUSED
MATCH_NOT_AVAILABLE
MATCH_EXPIRED
CONTACT_NOT_VISIBLE
USER_BLOCKED
```

## 4. 核心数据契约

### 4.1 User

自己的用户对象可以返回全部个人字段：

```json
{
  "id": "usr_01...",
  "displayName": "林晴",
  "email": "linqing@example.com",
  "wechat": "linqing_wc",
  "instagram": "@linqing",
  "xiaohongshu": null,
  "linkedin": null,
  "contactVisibility": {
    "email": true,
    "wechat": true,
    "instagram": true,
    "xiaohongshu": false,
    "linkedin": false
  },
  "accountStatus": "active",
  "matchingStatus": "active",
  "questionnaireStatus": "completed",
  "createdAt": "2026-06-01T10:00:00Z",
  "photoUrl": "https://cdn.example.com/avatars/usr_01.jpg",
  "bio": "自我介绍",
  "matchPreference": "对 TA 的期待",
  "alumniVerificationStatus": "verified",
  "alumniVerificationMethod": "email"
}
```

枚举：

```text
accountStatus: active | suspended | deleted
matchingStatus: active | inactive
questionnaireStatus: not_started | in_progress | completed | retaking
alumniVerificationStatus: unverified | pending | verified | rejected
alumniVerificationMethod: email | chsi | referral
```

`questionnaireStatus` 是便于展示的派生字段：没有结果/草稿为 `not_started`，只有草稿为 `in_progress`，只有当前结果为 `completed`，当前结果与新草稿并存为 `retaking`。权威状态仍是 `/questionnaires/state` 返回的 `draft` 和 `current`。

前端当前把匹配开关命名为 `status`，且只支持三个问卷状态和 `unverified`/`verified` 两个认证状态。接入时应把 TypeScript 模型改为上述明确字段，并补充 `retaking`、`pending` 和 `rejected` UI。

### 4.2 QuestionnaireResponse

```json
{
  "id": "qnr_01...",
  "definitionVersion": 1,
  "version": 2,
  "revision": 7,
  "answers": {
    "1": 5,
    "2": 3,
    "3": 5,
    "4": 4,
    "5": 3,
    "6": 3,
    "7": 6,
    "8": 4,
    "9": 3,
    "10": 4,
    "11": 4,
    "12": 5,
    "13": 4,
    "14": 5,
    "15": 4,
    "16": 3,
    "17": 4,
    "18": 5,
    "19": 4,
    "20": 6,
    "21": 5,
    "22": 4,
    "23": 3,
    "24": 4
  },
  "importantQuestionIds": [1, 5, 7, 19, 23],
  "startedAt": "2026-07-25T18:00:00Z",
  "updatedAt": "2026-07-25T18:08:00Z",
  "completedAt": "2026-07-25T18:10:00Z",
  "status": "current",
  "currentSection": 5,
  "dimensionScores": [
    {
      "dimensionId": "exploration_stability",
      "name": "稳定守序 ↔ 探索开放",
      "leftLabel": "稳定守序",
      "rightLabel": "探索开放",
      "score": 4.33,
      "percent": 56
    }
  ]
}
```

说明：

- `definitionVersion` 标识题目和维度定义。
- `version` 是该用户的第几次完整问卷。
- `revision` 用于草稿并发控制和幂等重试。
- `dimensionScores` 由后端生成；前端不应作为权威计算者。
- JSON 对象键会变成字符串，后端应按整数题号校验。

### 4.3 WeeklyMatch

```json
{
  "id": "mat_01...",
  "algorithmVersion": "values-v1",
  "matchedUser": {
    "id": "usr_02...",
    "displayName": "晓晨",
    "photoUrl": "https://cdn.example.com/avatars/usr_02.jpg"
  },
  "contactsAvailable": true,
  "overallScore": 0.84,
  "compatibilitySummary": "你们在 5 个核心维度上高度接近",
  "dimensionComparisons": [
    {
      "dimensionId": "exploration_stability",
      "dimension": "稳定守序 ↔ 探索开放",
      "userScore": 5.0,
      "matchScore": 5.0,
      "category": "close"
    }
  ],
  "recommendationDate": "2026-07-25T16:00:00Z",
  "expiresAt": "2026-08-01T16:00:00Z",
  "nextRefreshDate": "2026-08-01T16:00:00Z",
  "responseStatus": "unseen"
}
```

当前推荐摘要和详情不直接嵌入邮箱或社交账号。前端进入联系方式区域时，再调用受审计的联系方式端点。不要复用 `GET /users/:id` 暴露完整个人记录。

推荐时间字段均为完整 ISO 8601 时间。当前前端直接输出字符串，接入时必须通过日期格式化函数展示，不能把整段 UTC 字符串原样放入 UI。

## 5. 接口清单

### 5.1 会话与启动

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/auth/register` | 注册、创建会话、返回自己 |
| `POST` | `/auth/login` | 登录并创建/轮换会话 |
| `POST` | `/auth/logout` | 撤销当前会话 |
| `POST` | `/auth/password/forgot` | 发送密码重置流程，响应不能泄露邮箱是否存在 |
| `POST` | `/auth/password/reset` | 使用一次性令牌重置密码并撤销旧会话 |
| `GET` | `/legal/current` | 返回当前服务条款、隐私政策版本和展示 URL |
| `GET` | `/bootstrap` | 页面启动时一次获取用户、问卷状态和推荐状态 |

注册请求：

```json
{
  "displayName": "林晴",
  "email": "user@example.com",
  "password": "a-strong-password",
  "wechat": null,
  "instagram": null,
  "xiaohongshu": null,
  "linkedin": null,
  "acceptedTermsVersion": "2026-07-01",
  "acceptedPrivacyVersion": "2026-07-01"
}
```

`displayName` 可选。若前端暂未收集，服务端可用经过长度和字符校验的邮箱本地部分作为初始值；之后允许用户通过 `PATCH /me` 修改。服务端必须校验提交的条款和隐私版本恰好等于 `/legal/current` 返回的有效版本，不能接受任意客户端字符串。

登录请求：

```json
{
  "email": "user@example.com",
  "password": "a-strong-password",
  "rememberMe": true
}
```

推荐的启动响应：

```json
{
  "data": {
    "user": {
      "id": "usr_01...",
      "displayName": "林晴",
      "email": "linqing@example.com",
      "accountStatus": "active",
      "matchingStatus": "active",
      "questionnaireStatus": "not_started",
      "createdAt": "2026-07-25T18:00:00Z",
      "alumniVerificationStatus": "unverified",
      "alumniVerificationMethod": null
    },
    "questionnaire": {
      "draft": null,
      "current": null,
      "archiveCount": 0
    },
    "match": {
      "eligibility": "verification_required",
      "current": null,
      "nextRefreshDate": null
    }
  },
  "meta": {
    "requestId": "req_01..."
  }
}
```

`match.eligibility` 使用 `eligible | verification_required | matching_paused | questionnaire_incomplete`。聚合接口始终返回完整主页状态；单独访问 `/matches/current` 时再按第 5.4 节返回 `403` 或匹配数据。

未登录访问 `/bootstrap` 返回 `401`，前端据此展示公开首页。

### 5.2 用户资料与认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/me` | 获取自己的完整资料 |
| `PATCH` | `/me` | 更新简介、期待、自己的联系方式或匹配状态 |
| `POST` | `/me/photo` | `multipart/form-data` 上传头像 |
| `DELETE` | `/me/photo` | 删除头像 |
| `GET` | `/verifications/current` | 获取当前认证记录 |
| `POST` | `/verifications` | 发起邮箱、学信网或推荐码认证并返回下一步 |
| `POST` | `/verifications/:id/confirm` | 确认邮箱验证码/链接令牌或核销推荐码 |
| `GET` | `/verifications/chsi/callback` | 接收学信网 OAuth 回调；具体路径按供应商要求调整 |

资料更新示例：

```json
{
  "displayName": "林晴",
  "bio": "新的自我介绍",
  "matchPreference": "希望认识的人",
  "matchingStatus": "inactive",
  "wechat": null,
  "contactVisibility": {
    "email": true,
    "wechat": false
  }
}
```

PATCH 语义：字段省略表示不修改；联系方式显式传 `null` 表示删除；`contactVisibility` 只更新提供的键。`accountStatus`、问卷状态和认证状态不能通过 `/me` 修改。

头像接口要求：

- 只接受服务端实际解码成功的 JPEG、PNG 或 WebP，最大 5 MB。
- 校验真实文件内容而非只信任扩展名/MIME，移除 EXIF，并执行必要的恶意文件扫描。
- 成功响应使用通用 envelope，`data.photoUrl` 为新 URL。
- 新对象和数据库提交成功后再异步清理旧对象，失败不得留下悬空资料引用。

认证请求示例：

```json
{
  "method": "email",
  "credential": "name@alumni.edu"
}
```

认证成功响应仍使用通用 envelope：

```json
{
  "data": {
    "id": "ver_01...",
    "method": "email",
    "status": "pending",
    "nextAction": "enter_code",
    "createdAt": "2026-07-25T20:00:00Z",
    "verifiedAt": null,
    "failureReason": null
  },
  "meta": {
    "requestId": "req_01..."
  }
}
```

邮箱认证发起后返回 `enter_code` 或 `check_email`；学信网发起后返回受信任的 `authorizationUrl`；推荐码应在事务中一次性核销。不要把验证码、推荐码、第三方授权令牌或学信网原始敏感材料原样写入普通日志。

### 5.3 问卷

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/questionnaires/definition` | 返回当前 24 题、阶段、量表和维度映射 |
| `GET` | `/questionnaires/state` | 返回 `draft`、`current` 和归档数量 |
| `PUT` | `/questionnaires/draft` | 幂等创建或更新草稿 |
| `POST` | `/questionnaires/draft/submit` | 校验并提交草稿，生成维度结果 |
| `POST` | `/questionnaires/retake` | 创建新草稿，保留旧 current |
| `GET` | `/questionnaires/history` | 分页列出 current 与 archived |
| `GET` | `/questionnaires/history/:id` | 获取自己的某个只读版本 |

问卷定义的最低 schema：

```ts
type QuestionnaireDefinition = {
  version: number;
  status: "active" | "retired";
  scale: { min: 1; max: 7; midpoint: 4 };
  sections: Array<{
    id: number;
    name: string;
    order: number;
    questionIds: number[];
  }>;
  questions: Array<{
    id: number;
    sectionId: number;
    topic: string;
    leftText: string;
    rightText: string;
    order: number;
  }>;
  dimensions: Array<{
    id: string;
    name: string;
    leftLabel: string;
    rightLabel: string;
    order: number;
    questions: Array<{
      questionId: number;
      direction: 1 | -1;
      weight: number;
    }>;
  }>;
};
```

返回数组必须包含该版本的完整 24 题和全部正式维度。定义从 `draft` 发布为 `active` 后不可修改，只能发布新版本；历史响应始终可按自己的 `definitionVersion` 解释。匹配批次应在配置中记录允许参与的定义版本和迁移宽限期，不能因发布新问卷而让全部旧用户瞬间失去资格。

历史列表使用游标分页：

```text
GET /questionnaires/history?limit=20&cursor=<opaque>
limit 默认 20，最大 100
meta.nextCursor 为 null 表示结束
```

草稿保存请求：

```json
{
  "definitionVersion": 1,
  "revision": 6,
  "currentSection": 3,
  "answers": {
    "1": 5,
    "2": 3,
    "13": 4
  }
}
```

服务端要求：

- 值只能是整数 `1..7`。
- 题号必须属于该 `definitionVersion`。
- `answers` 是该草稿的完整快照，但允许少于 24 题；服务端以该快照替换已有答案，不做隐式增量合并。
- 首次创建可省略 `revision`；更新时必须传最近响应中的 `revision`。
- 成功响应返回完整草稿和递增后的新 `revision`。
- 使用事务和 `revision` 防止旧请求覆盖新草稿；不匹配时返回 `409 REVISION_CONFLICT` 和服务端当前 revision。
- 同一用户最多一个 `draft`。
- 创建草稿和提交时接受 `Idempotency-Key` 请求头；相同用户、路径和幂等键的重试返回第一次结果，不得创建第二份草稿或重复提交。

提交请求：

```json
{
  "revision": 12,
  "importantQuestionIds": [1, 5, 7, 19, 23]
}
```

提交校验：

- 24 题全部作答。
- 每题为 `1..7` 整数。
- 重要题号去重且全部存在。
- 重要题数量为 `3..5`。
- 草稿属于当前用户且尚未提交。

提交必须在一个事务中：

1. 锁定草稿和当前结果。
2. 计算并保存维度分数。
3. 将旧 `current` 改为 `archived`。
4. 将草稿改为新的 `current`。
5. 让派生的 `questionnaireStatus` 变为 `completed`。
6. 记录算法/问卷定义版本。

### 5.4 每周推荐与反馈

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/matches/current` | 获取当前有效推荐或等待状态 |
| `GET` | `/matches/:id` | 获取当前用户可见的推荐详情与维度对比，不含联系方式 |
| `GET` | `/matches/:id/contacts` | 权限校验后返回允许公开的联系方式并写访问审计 |
| `PATCH` | `/matches/:id/response` | 更新 `viewed`、`interested`、`skipped` |
| `POST` | `/matches/:id/reports` | 举报当前推荐 |
| `POST` | `/users/:id/block` | 屏蔽用户 |
| `DELETE` | `/users/:id/block` | 解除屏蔽，若产品允许 |

建议“暂无推荐”仍返回 `200`，避免前端从 `204` 猜测下一次刷新日期：

```json
{
  "data": {
    "match": null,
    "reason": "waiting_for_next_cycle",
    "nextRefreshDate": "2026-08-01T16:00:00Z"
  },
  "meta": {
    "requestId": "req_01..."
  }
}
```

状态码规则：

- 未认证：`403 VERIFICATION_REQUIRED`。
- 匹配暂停：`403 MATCHING_PAUSED`。
- 没有有效完整问卷：`403 QUESTIONNAIRE_INCOMPLETE`。
- 用户具备资格但本周期没有结果：`200`，`match: null`，并返回稳定的 `reason`：
  `waiting_for_next_cycle | no_eligible_candidate | cycle_processing`。

反馈请求：

```json
{
  "status": "interested"
}
```

反馈状态机：

- 进入详情后前端调用一次 `viewed`；`unseen -> viewed`。
- `unseen` 或 `viewed` 可进入 `interested` 或 `skipped`。
- `interested` 和 `skipped` 在 v1 视为终态；重复提交相同状态幂等成功，切换终态返回 `409`。
- 推荐过期后禁止新的兴趣/跳过操作，返回 `409 MATCH_EXPIRED`。

举报请求：

```json
{
  "reason": "feels_fake",
  "details": "可选补充说明",
  "blockUser": true
}
```

v1 举报原因枚举：

```text
inappropriate_content | feels_fake | harassment | other
```

`blockUser=true` 时，写举报和建立屏蔽关系必须处于同一事务；重复举报/屏蔽请求应安全幂等。

服务端必须再次验证当前推荐属于当前用户且仍在有效期内。不能相信前端提交的对方联系方式、分数或 user ID 组合。

联系方式响应示例：

```json
{
  "data": {
    "email": "xiaochen@example.com",
    "wechat": "xiaochen_wc",
    "instagram": "@xiaochen_life"
  },
  "meta": {
    "requestId": "req_01..."
  }
}
```

`/bootstrap`、`/matches/current` 和 `/matches/:id` 均不得提前携带联系方式；只有显式访问 `/contacts` 才返回并记录审计。

## 6. 数据库建议

开发环境可以继续使用 SQLite，生产建议使用 PostgreSQL。至少需要以下逻辑表：

| 表 | 关键字段与约束 |
| --- | --- |
| `users` | `id`、规范化唯一邮箱、密码哈希、`account_status`、`matching_status`、创建/更新时间 |
| `user_profiles` | `user_id` 唯一、昵称、简介、期待、头像对象键 |
| `user_contacts` | `user_id`、类型、加密后的值、是否允许对推荐公开；每用户每类型唯一 |
| `sessions` | 哈希后的会话令牌、用户、过期、撤销时间、设备信息 |
| `password_reset_tokens` | 用户、哈希后的单次令牌、过期和使用时间 |
| `terms_consents` | 用户、条款/隐私版本、同意时间、必要审计信息 |
| `alumni_verifications` | 用户、方式、状态、证据引用、失败原因、提交/验证/过期时间 |
| `verification_challenges` | 认证记录、哈希后的验证码/一次性令牌、用途、尝试次数和过期时间 |
| `referral_codes` | 签发人、哈希后的码、状态、过期时间和核销用户；一次性码有唯一约束 |
| `questionnaire_definitions` | 版本、状态、发布时间；已使用版本不可原地修改 |
| `questions` | 定义版本、稳定题号、阶段、左右文案、量表范围、顺序 |
| `dimensions` | 定义版本、稳定 ID、左右标签、解释和展示顺序 |
| `dimension_questions` | 维度、题目、方向、权重；联合唯一 |
| `questionnaire_responses` | 用户、定义版本、用户版本、revision、状态和时间 |
| `questionnaire_answers` | response、question、value；联合唯一 |
| `response_important_questions` | response、question、权重/顺序；联合唯一 |
| `dimension_scores` | response、dimension、score、算法版本；联合唯一 |
| `matching_cycles` | 周期开始/结束、状态、算法版本和随机种子 |
| `matches` | cycle、总体分、状态、生成/过期时间；不直接依赖 userA/userB 唯一约束 |
| `match_participants` | match、cycle、user、slot；`UNIQUE(cycle_id, user_id)` 保证每周期每用户最多一场 |
| `match_dimension_comparisons` | match、dimension、双方分数、类别和解释 |
| `match_user_feedback` | match、user、responseStatus、查看/操作时间；联合唯一 |
| `blocks` | blocker、blocked、创建时间；有序用户对唯一 |
| `reports` | reporter、reported、match、原因、详情、处理状态 |
| `contact_access_audit` | 谁在何时因哪次有效推荐读取了谁的联系方式 |
| `idempotency_requests` | 用户、方法、路径、key、请求摘要、响应摘要和过期时间；联合唯一 |
| `background_jobs` | 匹配批次/清理任务、状态、尝试次数、租约和错误摘要 |
| `outbox_events` | 事务内待发送事件，用于邮件、通知和对象清理的可靠投递 |

关键一致性约束：

- 邮箱使用规范化值做唯一索引。
- 用户最多一个 `draft` 和一个 `current` 问卷响应。
- 已提交答案和问卷定义不可原地修改。
- 匹配中的两位用户不能相同。
- `match_participants` 以 `UNIQUE(cycle_id, user_id)` 保证同一周期同一用户最多出现一次；创建配对时在同一事务中插入两位参与者。
- 屏蔽关系和无效认证必须在候选查询与最终写入时各校验一次。
- 产生匹配、维度解释和双方可见记录应在同一事务中完成。

联系方式属于敏感数据。生产环境应考虑字段级加密、最小权限、访问审计和数据删除策略。

## 7. 匹配算法基线

### 7.1 候选资格

两位用户进入候选池前都必须满足：

- 账号未封禁或删除。
- `accountStatus=active` 且 `matchingStatus=active`。
- 校友认证为 `verified` 且未过期。
- 存在基于当前问卷定义的 `current` 完整结果。
- 双方没有屏蔽关系。
- 不违反重复推荐冷却期。
- 不与自己匹配。

旧原型使用“同校 + 双向性别偏好”，但当前网页没有收集学校、性别或意向对象字段。正式算法不能偷偷沿用这些过滤条件。产品必须先决定：

1. 是否恢复这些资料字段。
2. 是否属于硬过滤、软偏好或完全不用。
3. 如何处理非二元性别与隐私。

### 7.2 可解释的 v1 相似度建议

前端答案范围为 `1..7`。可先将每题差异归一化：

```text
questionDistance = abs(answerA - answerB) / 6
```

重要题目的初始权重建议：

```text
weight = 1
       + 0.5 if A selected the question as important
       + 0.5 if B selected the question as important
```

基础相似度：

```text
similarity = 1 - weightedMean(questionDistance)
```

这只是可解释的第一版建议，必须通过测试数据和产品评审后固化为 `algorithmVersion`。所有 24 题都应被处理；如果只按维度计算，必须先解决 7 道未映射题目。

维度分数使用定义中的方向和权重：

```text
orientedAnswer = answer                  when direction = 1
orientedAnswer = 8 - answer              when direction = -1
dimensionScore = weightedMean(orientedAnswer)
percent = floor(((dimensionScore - 1) / 6 * 100) + 0.5)
```

`direction=1` 表示高分朝 `rightLabel`，`direction=-1` 表示该题需要反向计分。后端保存未舍入分数，API 的 `score` 建议保留两位小数；`percent` 使用上式统一舍入。

不要原样复用旧代码对正数 Likert 向量计算余弦相似度：全为正数时分数容易普遍偏高，而且无法自然表达“方向差异”和重要题权重。

### 7.3 维度类别

前端需要每个维度返回：

```text
close | complementary | discuss
```

当前 mock 中相同的分差可能分别被标为 `complementary` 和 `discuss`，说明尚无一致规则。算法 Agent 必须把规则版本化并可解释。建议规则至少考虑：

- 双方绝对分差。
- 该维度是否被产品定义为“差异可以互补”。
- 双方是否把相关题目标为重要。
- 极端值组合是否触发“建议交流”。

类别由后端返回，前端只负责展示。

当前第一个维度的中文名称顺序还与 1–7 分值方向相反；冻结定义时应分别保存稳定 `dimensionId`、`leftLabel`、`rightLabel`、正反向计分规则，不能用中文名称推断方向。

### 7.4 每周配对

v1 建议使用批处理的一对一、互惠配对：

- 固定时区和每周周期边界。
- 每个合格用户每周期最多一位推荐。
- A 推荐 B 时，B 同周期也推荐 A。
- 使用最大权重匹配或稳定的贪心基线，并记录算法版本、种子和候选排除原因。
- 同分时使用确定性 tie-break，保证重跑可复现。
- 批次失败可安全重试，不能产生重复配对。
- 使用数据库 advisory lock、唯一租约或等价机制，保证同一周期只有一个活动批次。
- 候选数为奇数时允许一人轮空；下一周期在近似分数相同时优先长期未匹配者。

若产品决定单向推荐，必须另行定义联系方式授权、同一用户一周可被推荐给多少人以及骚扰风险控制。

## 8. 现有代码的本地使用

### 8.1 前端

```powershell
cd website
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

默认访问 Vite 输出的本地地址，通常为 `http://localhost:5173`。

### 8.2 旧 Streamlit 原型

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run app.py
```

旧原型会在仓库根目录创建 `dating_app.db`，该文件已被 `.gitignore` 排除。它只用于查看旧思路，不代表目标 API 或目标数据库结构。

## 9. 后端 Agent 的执行顺序

1. 阅读本文和 [当前网站功能说明](./CURRENT_WEBSITE_FUNCTIONS.md)。
2. 先解决第 11 节的产品决策，不自行猜测。
3. 固化 OpenAPI 契约、错误码和问卷定义 v1。
4. 创建迁移和种子数据；问题、维度和映射由数据库/版本文件提供。
5. 实现账号、会话、`/bootstrap` 和 `/me`。
6. 实现问卷定义、草稿并发控制、提交事务、评分和历史。
7. 实现认证状态机与头像/联系方式存储。
8. 实现候选过滤、可复现的匹配批处理和推荐查询。
9. 实现反馈、举报、屏蔽和联系方式访问审计。
10. 生成 OpenAPI 文档和测试夹具，再交给前端替换 `AppProvider` 中的 mock。

建议的环境变量：

```env
DATABASE_URL=sqlite:///./dating_app_v1.db
SESSION_COOKIE_NAME=cg_session
CSRF_SECRET=replace-in-local-env
CONTACT_ENCRYPTION_KEY=replace-in-local-env
CORS_ORIGINS=http://localhost:5173
PUBLIC_ASSET_BASE_URL=http://localhost:8000/assets
MATCH_TIMEZONE=America/Los_Angeles
```

仓库只提交 `.env.example`，不得提交真实密码、第三方令牌或生产数据库地址。生产环境的联系方式加密密钥应由 KMS/Secret Manager 托管并支持轮换，而不是长期以明文文件保存。

## 10. 最低测试与验收清单

### API/鉴权

- 重复邮箱大小写变体不能创建两个账号。
- 错误密码不泄露账号是否存在。
- 退出或过期会话不能继续访问 `/me`。
- 用户不能读取或更新另一用户的资料、问卷或反馈。
- 暂停匹配不能绕过账号状态检查，封禁账号也不能通过恢复匹配重新入池。

### 问卷/数据库

- 部分草稿可保存并恢复。
- 旧 `revision` 更新返回 `409 REVISION_CONFLICT`。
- 缺题、越界值、重复重要题和少于 3/多于 5 个重要题均被拒绝。
- 重复提交同一幂等请求只产生一个版本。
- 新版本提交时旧 current 原子归档。
- 维度分数使用正确的定义版本和映射。

### 匹配算法

- 自己、暂停、未认证、被屏蔽和无完整问卷的用户永不进入候选。
- 同一周期用户不会出现在两个有效配对。
- 固定输入和种子得到相同输出。
- 重要题权重真实影响排序。
- 没有候选时返回等待状态，而不是伪造推荐。

### 隐私/安全

- `/bootstrap` 和推荐摘要/详情均不包含联系方式。
- 非当前有效推荐无法通过 `/matches/:id/contacts` 读取对方联系方式。
- 推荐过期后联系方式不再返回。
- 举报与屏蔽立即影响查询和下轮候选。
- 日志不包含密码、会话原文、推荐码或完整敏感认证材料。

## 11. 实现前必须确认的产品决策

| 决策 | 当前缺口 |
| --- | --- |
| 24 题到维度的完整映射 | 7 道题未进入当前 7 个维度 |
| 维度名称与计分方向 | 首个维度的源码名称顺序与左右分值方向相反 |
| 匹配硬过滤条件 | 网页没有学校、年龄、性别和意向对象字段 |
| 每周推荐是否互惠 | UI 没有明确说明单向或双向 |
| `complementary` 与 `discuss` 规则 | mock 标签不具备统一阈值 |
| 周期时间与时区 | 页面只有演示日期 |
| 重复推荐冷却期 | 尚未决定多少周期内不得重复配对 |
| 问卷版本升级宽限期 | 新定义发布后旧 current 可参与匹配多久尚未决定 |
| 轮空与长期公平性 | 奇数候选、连续轮空和最低等待保障尚无产品规则 |
| 联系方式授权方式 | 目前默认对当前推荐直接展示 |
| 认证供应商与状态机 | 三种方式均只有前端一键成功 |
| 删除、留存与导出策略 | 尚无账号注销和数据治理页面 |
| 感兴趣后的产品动作 | 当前只标记状态，不通知对方 |

若这些决策尚未完成，Agent 可以先实现通用数据模型、API 骨架和测试，但不应把临时猜测固化为不可迁移的生产逻辑。
