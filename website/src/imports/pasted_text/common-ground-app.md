Design and build a polished, responsive web application for values-based dating and friendship matching.

The working product name is “Common Ground”. The product helps users understand their personal values and receive one carefully selected compatible match every week.

Build this as a functional multi-page prototype with reusable components, realistic states, form validation, responsive desktop/mobile layouts, and persistent mock data or local state. Do not create only static mockups.

LANGUAGE

Use Simplified Chinese for the main interface, with a few short English brand moments where appropriate.

Important celebration copy:
“Congratulations!”
“You’re ready to match!”

PRODUCT PRINCIPLES

- Warm, thoughtful, trustworthy, inclusive and modern
- Focus on personal values rather than appearance
- Avoid overly romantic, childish or corporate aesthetics
- Do not label any value orientation as good or bad
- Present compatibility as dimensions and conversation opportunities, not absolute destiny
- Use progressive disclosure so the questionnaire feels lightweight
- The current product contains a 24-question universal core questionnaire
- Future versions will add optional topic packs such as family, parenting, finances and intimacy, so design the architecture to support future questionnaires

VISUAL DIRECTION

Create a distinctive editorial-style visual identity:
- Warm off-white or pale cream page background
- Dark ink text
- Bright coral/orange as the main action color
- Secondary accents in cobalt blue, vivid violet and fresh green
- Large expressive headings, clean readable body text
- Rounded cards with subtle borders and soft shadows
- Generous whitespace
- Abstract overlapping shapes, gradients or value-spectrum graphics
- Avoid generic stock photography
- Avoid a generic SaaS dashboard appearance
- Use accessible contrast, visible focus states and large touch targets
- Desktop max content width around 1200px
- Questionnaire reading width around 760–860px
- Fully responsive mobile navigation and forms

GLOBAL NAVIGATION

Logged-out navigation:
- Logo: Common Ground
- 首页
- 关于匹配
- 登录
- 注册 / 开始探索 as the primary button

Logged-in navigation:
- Logo
- 我的主页
- 问卷结果
- Account avatar/menu
- Active / Inactive status control should also be easy to find

Create reusable components for:
- Header/navigation
- Footer
- Primary, secondary and text buttons
- Form inputs
- Password input with show/hide control
- Social/contact inputs
- Status toggle
- Progress bar
- Questionnaire spectrum slider
- Value-dimension result card
- Match recommendation card
- Empty state
- Archive result card
- Confirmation modal
- Toast and validation message

PAGES AND ROUTES

Create the following pages and their important states:

1. Landing page: /
2. Register page: /register
3. Login page: /login
4. Personal dashboard: /dashboard
5. Questionnaire: /questionnaire
6. Questionnaire completion celebration: /questionnaire/complete
7. Current questionnaire result: /results
8. Archived results: /results/archive
9. Weekly match detail: /matches/current

LANDING PAGE

Build a complete homepage with:

Hero section:
- Eyebrow: “从三观开始认识一个人”
- Main heading: “比起猜你喜欢什么，我们更在意你如何看待生活。”
- Supporting copy explaining that users complete a short personal values questionnaire and receive one thoughtful match each week
- Primary CTA: “开始探索”
- Secondary CTA: “登录”
- A colorful abstract visualization showing two different value profiles with areas of overlap
- If the user is already logged in, replace CTAs with “进入我的主页”

How it works section with three steps:
1. 完成核心价值问卷
2. 看见真实的个人价值画像
3. 每周收到一位认真筛选的推荐

Questionnaire introduction:
- 24道普适性问题
- 约6–8分钟
- 没有正确答案
- 可以保存进度
- Emphasize that the product does not judge users and does not promise a perfect partner

Value dimensions preview:
- 探索与稳定
- 独立与联结
- 成就与生活
- 金钱与体验
- 公平与责任
- 信任与能动性
- 沟通与亲密

Weekly matching section:
- Explain that completed and Active users receive one current best match every seven days
- Use a sample match card without exposing real personal information
- CTA: “完成问卷，开启匹配”

Trust/privacy section:
- Explain that contact details are only shown to a recommended match
- Users can become Inactive at any time
- Inactive users do not receive recommendations or invitations

Add a complete footer with product links, privacy, terms and contact placeholders.

REGISTER PAGE

Create a centered registration page with a clear step-free form.

Required fields:
- Email
- Password
- Confirm password

Optional contact fields:
- 微信号
- Instagram
- 小红书
- LinkedIn

Add helper copy:
“联系方式仅会在匹配成功或系统推荐场景中按规则展示。”

Include:
- Email format validation
- Password strength guidance
- Password confirmation validation
- Checkbox agreeing to privacy policy and terms
- Primary button: “创建账号”
- Link: “已有账号？登录”
- Successful registration should log the user in and take them to /dashboard

LOGIN PAGE

Fields:
- Email
- Password
- Remember me
- Forgot password link
- Primary button: “登录”
- Link to registration
- Error state for incorrect credentials
- Successful login routes to /dashboard

PERSONAL DASHBOARD

Create multiple dashboard states.

Shared dashboard header:
- Greeting with user name
- Profile completeness indicator
- Active / Inactive status toggle

Status behavior:
- Active copy: “匹配已开启”
- Inactive copy: “匹配已暂停”
- When changing to Inactive, show a confirmation modal explaining:
  “暂停后，你不会收到每周推荐、匹配邀请，也不会被推荐给其他用户。你的问卷和历史记录会保留。”
- When Active is restored, show a positive toast

STATE A — USER HAS NOT COMPLETED THE QUESTIONNAIRE

At the top of the dashboard, show a large, highly colorful, visually dominant CTA card.

Copy:
- “从认识自己开始”
- “完成24道核心价值问题，生成你的个人价值画像，并开启每周匹配。”
- Estimated time: “约6–8分钟”
- Large primary button: “开始填写问卷”

Use a vivid coral-to-violet treatment so this is clearly the primary action.

Below it, show disabled/locked previews for:
- 我的价值画像
- 本周推荐
- 专项题库

STATE B — QUESTIONNAIRE IN PROGRESS

Show:
- “继续完成你的问卷”
- Current section and percentage
- Progress bar
- Button: “继续填写”
- Secondary action: “重新开始”
- Do not show match recommendations yet

STATE C — COMPLETED, ACTIVE, MATCH AVAILABLE

At the very top, show the current weekly match card before the personal result.

Match card content:
- “本周推荐”
- First name or display name
- Compatibility summary such as “你们在5个核心维度上高度接近”
- Small value-overlap visualization
- Recommendation date
- Primary button: “查看本周推荐”
- Countdown or text: “下一次推荐将在6天后更新”

Below:
- Personal value profile summary
- Seven dimension cards
- Button: “查看完整结果”
- Questionnaire completion date
- Button: “重新填写问卷”
- Optional topic packs section marked “即将开放”:
  家庭关系、育儿观念、金钱与财务、亲密关系

STATE D — COMPLETED, ACTIVE, WAITING FOR NEXT MATCH

Show a calm waiting card:
- “新的推荐正在准备中”
- Next recommendation date
- Explain that recommendations update every seven days
- Keep personal results visible

STATE E — COMPLETED, INACTIVE

Do not show an active recommendation.
Show:
- “匹配已暂停”
- “重新开启后，你将恢复每周推荐。”
- Button: “开启匹配”
- Personal results remain accessible

QUESTIONNAIRE EXPERIENCE

All five questionnaire sections must exist on one route and within one continuous page flow, but show only one section at a time.

Top sticky questionnaire header:
- Logo or back-to-dashboard control
- “核心价值问卷”
- Overall progress percentage
- Overall progress bar based on all 24 questions
- “已自动保存” state
- Exit and continue later action

Five stages:
1. 生活方式
2. 人生方向
3. 社会与世界
4. 情感与沟通
5. 亲密关系

Show a compact five-step indicator under the main progress bar:
- Completed stages use a check icon
- Current stage uses the accent color
- Future stages remain muted

QUESTION INTERACTION

Each question is a spectrum between two equally valid statements.

Use a 7-position interactive slider or seven selectable dots:
- 1 means strongly closer to the left statement
- 4 means balanced / depends on context
- 7 means strongly closer to the right statement

For every question:
- Show question number
- Show a short topic title
- Put the left statement and right statement in two balanced cards
- Place the 7-point selector between or below them
- Clearly show the selected position
- On mobile, stack the two statements vertically but preserve the left-to-right meaning
- Do not imply that one side is better
- Disable “下一阶段” until all questions in the current section are answered
- Show inline guidance if unanswered questions remain
- Allow “上一阶段”
- Persist all answers when moving between sections or leaving the page

SECTION 1 — 生活方式, QUESTIONS 1–6

Question 1, 稳定与变化:
Left: “我更喜欢可预测、有规律的生活”
Right: “我更喜欢变化、探索和新的体验”

Question 2, 计划与随性:
Left: “重要事情最好提前规划并按计划推进”
Right: “保留弹性、根据当下情况决定更适合我”

Question 3, 风险态度:
Left: “我倾向于选择可靠稳妥的道路”
Right: “为了更大的可能性，我愿意承担不确定性”

Question 4, 秩序与自由:
Left: “清晰的规则和秩序能让生活运行得更好”
Right: “个人自由和具体情况比统一规则更重要”

Question 5, 独立与陪伴:
Left: “我需要较多独处时间和个人空间”
Right: “我更喜欢经常与亲近的人一起活动”

Question 6, 社交范围:
Left: “我更愿意维持少数稳定而深入的关系”
Right: “我喜欢认识不同的人并扩大社交圈”

SECTION 2 — 人生方向, QUESTIONS 7–12

Question 7, 成就与从容:
Left: “不断成长、取得成果对我的人生很重要”
Right: “生活舒适从容、不被成就压力支配更重要”

Question 8, 工作与生活:
Left: “遇到重要机会时，我愿意暂时把事业放在生活前面”
Right: “即使影响事业发展，我也会优先保障个人生活”

Question 9, 储蓄与体验:
Left: “收入更应该用于积累储蓄和未来保障”
Right: “在能力范围内，收入应该更多用于当下体验”

Question 10, 财富的意义:
Left: “经济条件是安全感和人生选择权的重要基础”
Right: “金钱够用即可，不应成为衡量人生的重要标准”

Question 11, 竞争与合作:
Left: “适度竞争能推动个人成长和社会进步”
Right: “合作共赢通常比相互竞争更有价值”

Question 12, 认可与内在满足:
Left: “自己的努力获得认可和影响力很重要”
Right: “即使无人认可，做自己觉得有意义的事就足够”

SECTION 3 — 社会与世界, QUESTIONS 13–18

Question 13, 公平与贡献:
Left: “公平更接近让每个人获得相对平等的结果”
Right: “公平更接近按照投入、能力和贡献分配”

Question 14, 原则与情境:
Left: “做人应该坚持稳定的原则，不能轻易因情况改变”
Right: “同一件事在不同情境中可能需要不同判断”

Question 15, 传统与更新:
Left: “经过长期形成的传统通常有值得尊重的道理”
Right: “传统也需要不断接受质疑和重新选择”

Question 16, 责任范围:
Left: “人的责任应优先从家人和身边人开始”
Right: “即使是陌生人，也应该得到相对平等的关心”

Question 17, 信任与谨慎:
Left: “大多数人在获得信任后，会愿意善意相待”
Right: “信任应当逐步建立，不能轻易假定他人善意”

Question 18, 努力与环境:
Left: “个人长期努力通常能够显著改变人生处境”
Right: “家庭背景、机遇和社会环境往往更能决定处境”

SECTION 4 — 情感与沟通, QUESTIONS 19–22

Question 19, 理性与感受:
Left: “做重要决定时，我更相信事实、逻辑和长期结果”
Right: “做重要决定时，我也很重视直觉和内心感受”

Question 20, 直接与委婉:
Left: “有问题时，直接清楚地说出来更有利于解决”
Right: “表达问题时，应优先照顾对方感受和关系氛围”

Question 21, 冲突节奏:
Left: “发生矛盾后，我希望尽快沟通解决”
Right: “发生矛盾后，我通常需要先独处和整理情绪”

Question 22, 表达与行动:
Left: “爱与关心需要经常通过语言和情绪表达出来”
Right: “可靠的行动和实际承担比语言表达更重要”

SECTION 5 — 亲密关系, QUESTIONS 23–24

Question 23, 共同体与个人边界:
Left: “长期伴侣应当深度参与彼此的重要决定和生活”
Right: “即使关系亲密，双方也应保留较强的个人自主权”

Question 24, 坚持与止损:
Left: “关系遇到长期困难时，应尽最大努力磨合和修复”
Right: “如果核心需求长期无法满足，及时结束也很负责”

After questions 23–24, add an importance-selection step within Section 5:

Heading:
“哪些差异对你最重要？”

Copy:
“请从24道题中选出最多5项，你更希望未来的匹配对象与你接近。”

Show all question topics as selectable chips or compact cards, grouped by section.
- Minimum 3 selections
- Maximum 5 selections
- Show count: “已选择 3/5”
- These selected items receive higher matching weight

Final button:
“提交并生成我的价值画像”

Before final submission, show a confirmation:
“提交后，本次结果将被锁定，不能直接修改。你可以稍后重新填写，旧结果会自动归档。”

QUESTIONNAIRE COMPLETION PAGE

Create a joyful full-screen celebration page with tasteful confetti or animated abstract shapes.

Copy:
- “Congratulations!”
- “You’re ready to match!”
- “你的核心价值画像已经生成。开启匹配后，我们会每周为你推荐一位当前最合适的人。”

Show:
- Completion checkmark
- Small preview of the user’s value spectrum
- Active matching status
- Primary button: “查看我的价值画像”
- Secondary button: “返回个人主页”

If the user is Inactive, replace supporting text with:
“你的价值画像已经生成。开启匹配后，你将有机会收到每周推荐。”
Primary action: “开启匹配”

RESULT PAGE

The submitted result cannot be directly edited.

Show:
- Completion date
- Result version
- Seven value-dimension cards or horizontal spectrum charts
- A readable narrative summary
- The five topics the user marked as most important
- A note that no orientation is inherently better
- Button: “重新填写问卷”
- Link: “查看历史结果”

Suggested value dimensions:
- 探索开放 ↔ 稳定守序
- 独立空间 ↔ 社交联结
- 成就驱动 ↔ 生活从容
- 储蓄保障 ↔ 当下体验
- 竞争贡献 ↔ 平等合作
- 原则传统 ↔ 情境更新
- 直接表达 ↔ 关系照顾

When the user clicks “重新填写问卷”:
- Show a confirmation modal
- Explain that the current result remains active until the new questionnaire is submitted
- Once the new questionnaire is submitted, archive the previous result
- Use the newest completed result for matching

ARCHIVED RESULTS PAGE

Show a chronological list of previous result cards:
- Date
- Version
- Small dimension preview
- “查看当时结果”
- Archived results are read-only
- Clearly mark the current active result versus archived results

WEEKLY MATCH SYSTEM

All users who:
- completed the questionnaire
- have status Active

are eligible to receive one best current match every seven days.

For the prototype, implement this with mock matching data and a simulated weekly cycle. Do not claim that a real recommendation algorithm is already scientifically validated.

CURRENT MATCH DETAIL PAGE

At the top:
- “本周推荐”
- Match display name
- Short introduction
- Recommendation date
- Compatibility overview
- A visual showing areas of similarity and meaningful difference

Show compatibility by dimensions:
- 高度接近
- 可以互补
- 建议交流

Include:
- Three strongest areas of alignment
- Two suggested conversation topics
- The other user’s email address
- Optional social/contact details only if available and allowed by the mock data
- Copy explaining that contact information is shown because this person is the user’s current system recommendation

Actions:
- “复制邮箱”
- “我感兴趣”
- “暂时跳过”
- “举报或屏蔽”

Do not expose phone numbers or private data not included in the registration fields.

If no match exists:
- Show a friendly empty state
- Explain when the next matching cycle will run
- Do not fabricate a match

DATA AND STATE MODEL

Create realistic local/mock data structures for:

User:
- id
- displayName
- email
- password placeholder
- wechat optional
- instagram optional
- xiaohongshu optional
- linkedin optional
- status: active or inactive
- questionnaireStatus: not_started, in_progress, completed
- createdAt

Questionnaire response:
- id
- userId
- version
- answers for questions 1–24
- importantQuestionIds, 3–5 items
- startedAt
- completedAt
- status: draft, current, archived

Weekly match:
- id
- userId
- matchedUser
- compatibility summary
- dimension comparisons
- recommendation date
- expiration or next refresh date
- response status: unseen, viewed, interested, skipped

BEHAVIOR REQUIREMENTS

- Logged-out users trying to access questionnaire, dashboard, results or matches should be redirected to login
- After login, return users to the dashboard
- Questionnaire answers autosave
- Refreshing the page should preserve progress
- Completed results are read-only
- Retaking the questionnaire creates a new draft
- Old results archive only after the new result is successfully submitted
- Active users can receive and appear in match recommendations
- Inactive users cannot receive recommendations, invitations or appear as recommendations
- Show appropriate loading, empty, validation, success and error states
- Make all primary flows clickable in the prototype
- Use realistic sample user and match data
- Include a demo method to switch between dashboard states for design review

RESPONSIVE REQUIREMENTS

Desktop:
- Spacious navigation and content
- Dashboard can use a two-column layout
- Match and result cards can sit beside supporting information

Mobile:
- Single-column layouts
- Sticky bottom action on questionnaire sections
- Large 7-point touch targets
- Condensed progress header
- Navigation becomes a menu
- Ensure long Chinese question statements wrap without clipping

ACCESSIBILITY

- Keyboard-accessible forms and questionnaire controls
- Visible focus states
- Labels for every form field
- Do not rely on color alone to communicate state
- Sufficient contrast
- Helpful error text
- Respect reduced-motion preferences for celebration effects

FINAL OUTPUT

Generate the complete responsive website prototype, not only a landing page.

Prioritize these reviewable flows:
1. Landing → Register → Dashboard without questionnaire
2. Start questionnaire → complete five sections → select important topics
3. Submit → Congratulations / You’re ready to match
4. View locked personal result
5. Retake questionnaire and archive previous result
6. Toggle Active / Inactive
7. View the current weekly recommended match and the match’s email

Keep the design system consistent and componentized so future optional questionnaire packs can be added without redesigning the product.