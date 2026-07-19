# 后端接入说明

本文记录当前前端原型的后端接入边界，方便前后端并行开发。以下接口是基于现有页面行为整理的建议契约，尚未在前端实现，可在联调前共同确认路径和字段。

## 当前状态

- 所有业务状态集中在 `src/app/App.tsx` 的 `AppProvider`。
- 登录接受任意邮箱和密码；注册、个人资料更新均只修改内存和 `localStorage`。
- 问卷答案、历史结果和每周匹配均使用本地模拟数据。
- 当前没有 `fetch`/Axios 调用，也没有鉴权令牌或环境变量。

## 现有核心模型

### User

```ts
{
  id: string;
  displayName: string;
  email: string;
  wechat?: string;
  instagram?: string;
  xiaohongshu?: string;
  linkedin?: string;
  status: "active" | "inactive";
  questionnaireStatus: "not_started" | "in_progress" | "completed";
  createdAt: string;
  photoUrl?: string;
  bio?: string;
  matchPreference?: string;
  alumniVerificationStatus?: "unverified" | "verified";
  alumniVerificationMethod?: "email" | "chsi" | "referral";
}
```

### QuestionnaireResponse

```ts
{
  id: string;
  version: number;
  answers: Record<number, number>;
  importantQuestionIds: number[];
  startedAt: string;
  completedAt?: string;
  status: "draft" | "current" | "archived";
  currentSection: number;
}
```

### WeeklyMatch

```ts
{
  id: string;
  matchedUser: {
    displayName: string;
    email: string;
    wechat?: string;
    instagram?: string;
    photoUrl?: string;
  };
  compatibilitySummary: string;
  dimensionComparisons: Array<{
    dimension: string;
    userScore: number;
    matchScore: number;
    category: "close" | "complementary" | "discuss";
  }>;
  recommendationDate: string;
  nextRefreshDate: string;
  responseStatus: "unseen" | "viewed" | "interested" | "skipped";
}
```

时间字段建议统一返回 ISO 8601 UTC 字符串。不要在匹配对象中向另一位用户暴露未授权的联系方式。

## 建议接口清单

| 前端行为 | 建议接口 | 说明 |
| --- | --- | --- |
| 注册 | `POST /api/auth/register` | 创建账号并返回会话与用户 |
| 登录 | `POST /api/auth/login` | 校验凭据并返回会话与用户 |
| 退出 | `POST /api/auth/logout` | 使服务端会话失效 |
| 获取当前用户 | `GET /api/me` | 页面刷新时恢复用户状态 |
| 更新个人资料 | `PATCH /api/me` | 更新简介、社交账号、匹配偏好等 |
| 上传头像 | `POST /api/me/photo` | 建议使用 `multipart/form-data` |
| 获取当前问卷 | `GET /api/questionnaires/current` | 返回草稿或已完成版本 |
| 保存问卷草稿 | `PUT /api/questionnaires/current` | 支持按章节增量保存答案 |
| 提交问卷 | `POST /api/questionnaires/current/submit` | 提交重点题目并触发评分/匹配流程 |
| 重做问卷 | `POST /api/questionnaires/retake` | 归档当前版本并创建新草稿 |
| 获取问卷历史 | `GET /api/questionnaires/archive` | 返回已归档版本列表 |
| 获取本周匹配 | `GET /api/matches/current` | 无结果时建议返回 `204` 或明确的空对象契约 |
| 更新匹配反馈 | `PATCH /api/matches/:id/response` | 更新 `viewed`、`interested` 或 `skipped` |

## 前端接入顺序

1. 新增 `src/lib/api.ts`，从 `VITE_API_BASE_URL` 读取基地址并统一处理 JSON、错误和鉴权。
2. 先替换 `login`、`register`、`logout` 和页面刷新时的用户恢复逻辑。
3. 再替换 `saveAnswers`、`submitQuestionnaire`、`retakeQuestionnaire`。
4. 最后接入每周匹配与反馈更新，并删除仅用于演示的 `buildState`、模拟用户和模拟匹配数据。

若使用 Cookie 会话，前后端分域时需同时约定 CORS、`SameSite`、HTTPS 和 CSRF 策略；若使用令牌，不要把长期令牌写入仓库或前端源码。
