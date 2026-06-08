---
name: weread-sync
description: 微信读书数据同步到 Obsidian，生成每日读书小结。支持手动触发和定时自动执行。
version: 0.2.0
---

# weread-sync — 微信读书同步

将微信读书的阅读数据（进度、划线、个人想法）同步到 Obsidian，基于两次同步之间的差异生成每日读书小结。小结融合《如何阅读一本书》方法论和对话式深读理念。

## 触发方式

| 命令 | 行为 |
|------|------|
| `/weread-sync` | 手动触发，先展示上次同步时间，确认后执行 |
| `/weread-sync --since 2026-06-04` | 指定起点日期补同步 |

定时任务由 Hermes 在每日 00:00 自动触发（后续配置）。

## 前置条件

- `WEREAD_API_KEY` 环境变量已设置（格式 `wrk-xxxxxxxx`）
- weread-skills 已安装
- Obsidian vault 路径为 `{VAULT}`（见下方配置）

## 路径配置

```
VAULT_ROOT = "知识太空舱" 的绝对路径
BASELINE_DIR = "{VAULT_ROOT}/知识库/20.Areas/阅读/books/<书名>/weread/"
SUMMARY_DIR  = "{VAULT_ROOT}/知识库/20.Areas/阅读/读书笔记/"
SKILL_DIR = 本 skill 的安装目录
```

注意：`VAULT_ROOT` 默认为当前用户的 Obsidian vault 路径。在 SKILL.md 被 LLM 加载执行时，应从会话上下文中自动获取 vault 路径。如果无法自动获取，使用以下默认路径：

```
/Users/princyzhang/Library/Mobile Documents/iCloud~md~obsidian/Documents/知识太空舱
```

## 工作流

### 第 0 步：前置检查

1. 确认 `WEREAD_API_KEY` 环境变量已设置。若未设置，提示用户：
   > 请先设置微信读书 API Key：`export WEREAD_API_KEY=<你的apikey>`
   > 在微信读书 App → 设置 → 技能管理 中申请。
2. 确认 Obsidian vault 路径可访问。

### 第 1 步：检测是否需要初始化

1. 检查 `{VAULT_ROOT}/知识库/20.Areas/阅读/books/` 下是否存在任何 `weread/baseline.md` 文件
2. **如果没有任何基线文件**（首次使用）：
   ```
   🆕 检测到你是第一次使用 weread-sync。
   需要先拉取全部微信读书数据并建立基线，预计需 3-5 分钟。
   
   是否开始初始化？
   ```
   用户确认后，执行**附录 A：首次全量初始化**，完成后结束。
3. **如果已有基线文件**：继续第 2 步。

### 第 2 步：查询上次同步时间

1. 扫描 `{VAULT_ROOT}/知识库/20.Areas/阅读/books/` 下所有子目录
2. 对每个包含 `weread/baseline.md` 的书，读取其 frontmatter 中的 `lastSync` 字段
3. 向用户展示：

```
上次同步时间：
- 《少年》：2026-06-06 00:00
- 《系统思考》：2026-06-05 22:30
- 《xxx》：尚未同步（新书）

是否继续同步？
```

4. 如果是 `--since` 模式，跳过确认，直接执行。

### 第 3 步：拉取微信读书最新数据

使用 weread-skills 的 API 接口，按以下顺序拉取：

1. **获取书架列表**：调用 `/shelf/sync`，获取所有书籍的 `bookId`、`title`、`author`、`category`、`finishReading`
2. **筛选在读书籍**：只同步 `finishReading !== 1` 或最近有更新的书（`readUpdateTime` 在 `lastSync` 之后）
3. **对每本需要同步的书，并行获取**：
   - `/book/info` (bookId) → 元信息（translator, publisher, publishTime, isbn, wordCount, rating, intro）
   - `/book/getprogress` (bookId) → 当前进度（progress, chapterUid, chapterOffset, totalReadTime, finishTime）
   - `/book/chapterinfo` (bookId) → 章节目录
   - `/book/bookmarklist` (bookId) → 全部划线（含 bookmarkId, markText, createTime, chapterUid, range, colorStyle）
   - `/review/list/mine` (bookid) → 全部个人想法（含 reviewId, content, createTime, chapterUid）
     - **注意**：`/review/list/mine` 返回 `reviews[].review.reviewId`（嵌套在 `review` 对象内），组装 BookData 时必须提取到顶层，保留 `reviewId` 字段
4. **对每本书组装 BookData JSON**，写入临时文件 `/tmp/weread-sync/<bookId>.json`
   - **关键字段**：每条 bookmark 必须保留 `bookmarkId`，每条 review 必须保留 `reviewId`——这是 diff 比对的唯一标识，丢失会导致所有旧笔记被误判为新增
5. **如果某本书没有基线文件**：这是新书，直接用当前数据生成基线（调 baseline.mjs generate），不参与 diff

API 调用规范（来自 weread-skills）：
- 统一入口：`POST https://i.weread.qq.com/api/agent/gateway`
- Header：`Authorization: Bearer $WEREAD_API_KEY`
- Body 参数平铺在顶层，包含 `api_name` 和 `skill_version: "1.0.3"`
- 每次请求必须带 `skill_version`

### 第 4 步：计算 Diff

对每本已有基线且拉取了新数据的书：

1. 用 `node {SKILL_DIR}/scripts/baseline.mjs extract <baseline.md路径>` 提取基线 JSON → 写入 `/tmp/weread-sync/<bookId>-baseline.json`
2. 用 `node {SKILL_DIR}/scripts/diff.mjs /tmp/weread-sync/<bookId>-baseline.json /tmp/weread-sync/<bookId>.json` 计算 diff
3. 收集所有书的 DiffResult

### 第 5 步：生成每日小结

1. 读取 `{SKILL_DIR}/templates/daily-summary.md`、`fiction.md`、`non-fiction.md`
2. 将所有有变化的书的 DiffResult 汇总，替换 daily-summary.md 中的 `[DIFF_JSON_PLACEHOLDER]`
3. **检测章节边界**：对每本有变化的书，检查 `chapterChange.from.chapterUid` 和 `chapterChange.to.chapterUid`。如果不同，说明跨过了章节边界 → 生成「📌 章节回顾」
4. **检测内容边界**：分析新增划线/想法的内容，判断是否出现场景收束、论证段落结束、章节分水岭等自然边界 → 有则生成「🔜 翻页之前」
5. **检测阅读阶段**：根据 `progressChange.to` 判断阶段（0-5% 开卷 / 5-30% 渐入 / 30-70% 沉浸 / 70-99% 收束 / 100% 读完），按对应阶段选择掩卷之后的问题侧重
6. 按模板要求生成完整小结 markdown，严格遵守各区块的风格规则，始终包含「✎ 今日随笔」留白区
7. 将小结写入 `{VAULT_ROOT}/知识库/20.Areas/阅读/读书笔记/YYYY-MM-DD.md`
   - 如果当日文件已存在（手动多次触发），追加内容而非覆盖，用 `---` 分隔符分隔

### 第 6 步：Insight 沉淀

每日小结写完后，检查小结中产出的 insight 候选，将其沉淀到 vault 的 `insight/` 体系，与对话式深读系统打通。

#### 6.1 识别候选

掩卷之后的条目已直接使用 insight 分类名作为标签（`**悬题** ·` / `**延伸** ·` / `**闪回** ·` / `**共振** ·`），直接解析即可——无需额外判断。

另外检查拾贝中是否有值得沉淀的概念：
- 如果拾贝对某个术语做了展开解读，且该概念有独立记录价值 → 归入「概念」

**若无合适候选（掩卷之后为空或拾贝无概念），跳过本步骤。**

#### 6.2 写入 insight 文件

对每条候选，按 vault CLAUDE.md 规范写入文件。

**路径**：`{VAULT_ROOT}/insight/{维度}/{条目slug}.md`

**文件模板**：
```markdown
---
title: <主题标题>
tags: [<书名>, <相关标签>]
updated: YYYY-MM-DD
---

<问题/概念/关联的完整表述，2-4句话>

**来源**：[[知识库/20.Areas/阅读/读书笔记/YYYY-MM-DD|YYYY-MM-DD 读书小结]] · 《书名》

---

## 演化
- YYYY-MM-DD：初次记录，来自每日读书小结
```

**slug 规则**：
- 悬题：`<书名简称>-<问题关键词>`，如 `少年-思想与自述的关系`
- 概念：`<概念名>`
- 延伸/闪回/共振：`<主题slug>`

**写入前检查**：
- 如果目标文件已存在 → 读取现有内容，追加到「演化」段而非覆盖正文
- 如果文件名冲突但指向不同内容 → 用更具体的 slug 区分

#### 6.3 更新 INDEX.md

读取 `{VAULT_ROOT}/insight/INDEX.md`，对每条新增/更新的条目：

- **新增条目**：在对应分类段落下添加 `- [[维度/条目slug]] — 一行摘要`
- **更新已有条目**：重写对应行的摘要以反映条目当前全貌（不续写，覆盖整行）
- 如果该分类段落尚不存在 → 新增分节标题

#### 6.4 无候选时

不在 INDEX 中新增条目。正常进入下一步。

### 第 7 步：更新基线文件

对每本有变化的书：

1. 用最新 BookData JSON 生成新的 baseline.md：
   ```bash
   node {SKILL_DIR}/scripts/baseline.mjs generate /tmp/weread-sync/<bookId>.json {VAULT_ROOT}/知识库/20.Areas/阅读/books/<书名>/weread/baseline.md
   ```
2. 如果书的 `weread/` 目录不存在，先创建

### 第 8 步：报告结果

向用户展示同步结果摘要：

```
✅ 同步完成

《少年》：进度 8% → 12%（+4%），新增 3 条划线，1 条想法
《系统思考》：进度 18% → 22%（+4%），新增 5 条划线
📝 小结已写入：知识库/20.Areas/阅读/读书笔记/2026-06-07.md
💡 已沉淀 2 条 insight：悬题「少年-思想与自述的关系」、概念「不成熟叙事者」
```

如果当日无任何阅读变化，告知用户"今日无新增阅读活动"，不生成空白小结。
如果本次无 insight 产出，省略"💡 已沉淀…"行。

### 第 9 步：交互引导

小结写入 Obsidian 后，不要就此结束。以读书伙伴的身份主动邀请用户深入对话：

```
📝 小结已写入 Obsidian。

今天《少年》多了两条划线和一条你的想法。想聊聊"陀氏笔下的男人总是轻易爱上女人"这个观察吗？
```

交互原则：
- **自然邀请，不推销**：不是"请选择以下选项"，而是像朋友聊天一样随口提起一个可聊的点
- **优先引用用户的想法**：如果本次有新增个人想法，从这里切入最自然——这是读者自己的火种
- **其次引用掩卷之后的问题**：那些问题本身就是为了引发对话而写的
- **保持开放**：用户可以顺着聊，也可以说"不了"——小结本身已经有独立价值
- **如果用户愿意聊**：切换到对话式深读模式，参考 vault 中 CLAUDE.md 的陪读原则——以理解书的内容为主线，insight 是副产品

### 错误处理

- **API 调用失败**：重试一次，若仍失败，跳过该书并告知用户
- **基线文件损坏**：提示用户"《书名》基线文件格式异常，将重新创建基线"，用当前数据覆盖
- **无新数据**：正常结束，不生成小结
- **WEREAD_API_KEY 未设置**：终止并提示配置

## 引用文件

生成小结时附上文件路径，方便用户点击跳转：
- 小结文件：`知识库/20.Areas/阅读/读书笔记/YYYY-MM-DD.md`
- 基线文件：`知识库/20.Areas/阅读/books/<书名>/weread/baseline.md`

---

## 附录 A：首次全量初始化

首次使用时，将微信读书全部书籍数据拉取并建立基线文件。此流程由第 1 步自动触发，也可以手动执行：

```
/weread-sync --init
```

### A.1 执行初始化

使用 `bulk-first-sync.mjs` 脚本批量同步全部书籍：

```bash
node {SKILL_DIR}/scripts/bulk-first-sync.mjs
```

脚本会：
1. 调用 `/shelf/sync` 获取全部书籍（含已读完）
2. 对每本书并行拉取元信息、进度、章节目录、划线、想法
3. 为每本书生成 `baseline.md`（人类可读区 + 机器可读 JSON）
4. 写入 `{VAULT_ROOT}/知识库/20.Areas/阅读/books/<书名>/weread/baseline.md`

预计耗时：3-5 分钟（取决于书架大小，约 1 秒/本）。

### A.2 生成初见笔记

初始化完成后，取最近在读的一本书（按 `readUpdateTime` 降序，取第一本 `finishReading !== 1` 的书），自动生成一份「初见」笔记，让读者立刻看到手帐效果（AHA moment）。

1. 读取 `{SKILL_DIR}/templates/first-sync.md`
2. 将该书的 BookData JSON 替换模板中的 `[BOOK_DATA_PLACEHOLDER]`
3. 按模板要求生成初见笔记 markdown
4. 写入 `{VAULT_ROOT}/知识库/20.Areas/阅读/读书笔记/YYYY-MM-DD.md`（文件名用当天日期，与日常小结格式一致）
   - 如果该文件已存在 → 追加在已有内容之后，用 `---` 分隔符分隔

### A.3 初始化完成后

告知用户：

```
✅ 初始化完成：已为 N 本书建立基线。
📝 已生成初见笔记：知识库/20.Areas/阅读/读书笔记/YYYY-MM-DD.md
📁 基线路径：知识库/20.Areas/阅读/books/

从下次同步开始，将自动识别新增的划线和进度变化，生成每日读书小结。
```
