# 后端接入说明

本文记录当前 React 前端使用的后端契约，以及逐题匹配偏好需要后端补充的字段和筛选规则。前端请求统一由 `src/lib/api.ts` 发起，基地址来自 `VITE_API_BASE_URL`，鉴权使用 `Authorization: Bearer <token>`。

## 当前接口

| 前端行为 | 接口 | 说明 |
| --- | --- | --- |
| 注册 | `POST /api/register` | 返回令牌和用户启动数据 |
| 登录 | `POST /api/login` | 返回令牌和用户启动数据 |
| 退出 | `POST /api/logout` | 结束当前会话 |
| 获取启动数据 | `GET /api/me` | 返回用户、当前问卷、归档问卷和本周匹配 |
| 更新个人资料 | `PATCH /api/me` | 更新状态、简介和匹配偏好 |
| 上传头像 | `POST /api/me/photo` | 使用 `multipart/form-data` |
| 保存问卷草稿 | `PUT /api/questionnaire` | 合并答案、逐题匹配偏好并保存当前章节 |
| 提交问卷 | `POST /api/questionnaire/submit` | 提交重点题和最终逐题匹配偏好 |
| 重做问卷 | `POST /api/questionnaire/retake` | 创建新草稿 |
| 获取问卷历史 | `GET /api/questionnaire/archive` | 返回已归档问卷 |
| 获取本周匹配 | `GET /api/match/current` | 无匹配时返回 `null` |
| 更新匹配反馈 | `POST /api/match/response` | 更新 `viewed`、`interested` 或 `skipped` |
| 永久屏蔽推荐 | `POST /api/match/dislike` | 双向排除当前推荐对象 |

## 问卷模型

```ts
type MatchPreference = "any" | "same" | "different";

interface QuestionnaireResponse {
  id: string;
  version: number;
  answers: Record<number, number>;
  matchPreferences: Record<number, MatchPreference>;
  importantQuestionIds: number[];
  startedAt: string;
  completedAt?: string;
  status: "draft" | "current" | "archived";
  currentSection: number;
}
```

`matchPreferences` 以题号为键：

- `"any"`：无所谓，不产生硬性筛选。
- `"same"`：只接受与本人位于同一侧的候选人。
- `"different"`：只接受与本人位于相反侧的候选人。

前端会为 1–24 题发送完整映射。为兼容旧问卷，字段缺失、题号缺失或值为空时，后端必须按 `"any"` 处理。

## 保存与提交载荷

保存草稿（以下示例为便于阅读只展示部分题号，实际请求发送 1–24 的完整映射）：

```http
PUT /api/questionnaire
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "answers": { "1": 2, "2": 6 },
  "matchPreferences": {
    "1": "same",
    "2": "different",
    "3": "any"
  },
  "currentSection": 1
}
```

提交问卷：

```http
POST /api/questionnaire/submit
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "importantQuestionIds": [1, 8, 20],
  "matchPreferences": {
    "1": "same",
    "2": "different",
    "3": "any"
  }
}
```

提交接口再次接收完整 `matchPreferences`，以最终提交载荷覆盖草稿值，避免最后一次防抖自动保存尚未完成时提交到旧数据。保存和提交成功后返回的 `QuestionnaireResponse` 必须包含服务端最终保存的 `matchPreferences`。

## 后端硬性筛选规则

答案侧别只看方向，不比较具体分值：

- 1–3：`left`
- 4：`neutral`
- 5–7：`right`

对于规则设置者 A 和候选人 B 的某一道题：

| A 的偏好 | A 的答案 | B 的答案 | 是否通过 |
| --- | --- | --- | --- |
| `any` | 任意 | 任意 | 是 |
| `same` / `different` | 4 | 任意 | 是，A 为中立时该题不设限制 |
| `same` | 左或右 | 与 A 同侧 | 是 |
| `same` | 左或右 | 与 A 异侧或为 4 | 否 |
| `different` | 左或右 | 与 A 异侧 | 是 |
| `different` | 左或右 | 与 A 同侧或为 4 | 否 |

一对用户只有在以下条件同时成立时才能进入现有匹配排序：

1. A 设置的全部明确偏好都接受 B。
2. B 设置的全部明确偏好都接受 A。
3. 现有屏蔽、账号状态和其他候选资格条件均通过。

硬性条件应在 Gale–Shapley 偏好排序及重点题加权之前过滤。通过过滤的候选人继续使用现有 3–5 道重点题权重和相似度评分，不改变原有计分方式。

## 后端待实现项

- 为问卷草稿、当前版本和归档版本持久化 `match_preferences`，默认值为空映射或全 `"any"`。
- 扩展保存、提交、启动数据和归档问卷的序列化/反序列化。
- 校验偏好值只能为 `"any"`、`"same"` 或 `"different"`；服务端最终数据应将本人答案为 4 的题归一化为 `"any"`。
- 在候选人进入现有排序前执行上述双向硬性筛选。

本次前端改动不会修改后端代码；完成以上实现前，后端可能忽略新字段，逐题偏好也不会实际影响匹配结果。
