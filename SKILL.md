---
name: weread-sync
description: 微信读书数据同步到 Obsidian，生成每日读书小结。支持手动触发和定时自动执行。
version: 0.1.0
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

### 第 1 步：查询上次同步时间

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

### 第 2 步：拉取微信读书最新数据

使用 weread-skills 的 API 接口，按以下顺序拉取：

1. **获取书架列表**：调用 `/shelf/sync`，获取所有书籍的 `bookId`、`title`、`author`、`category`、`finishReading`
2. **筛选在读书籍**：只同步 `finishReading !== 1` 或最近有更新的书（`readUpdateTime` 在 `lastSync` 之后）
3. **对每本需要同步的书，并行获取**：
   - `/book/info` (bookId) → 元信息（translator, publisher, publishTime, isbn, wordCount, rating, intro）
   - `/book/getprogress` (bookId) → 当前进度（progress, chapterUid, chapterOffset, totalReadTime, finishTime）
   - `/book/chapterinfo` (bookId) → 章节目录
   - `/book/bookmarklist` (bookId) → 全部划线（含 markText, createTime, chapterUid, range, colorStyle）
   - `/review/list/mine` (bookid) → 全部个人想法（含 content, createTime, chapterUid）
4. **对每本书组装 BookData JSON**，写入临时文件 `/tmp/weread-sync/<bookId>.json`
5. **如果某本书没有基线文件**：这是新书，直接用当前数据生成基线（调 baseline.mjs generate），不参与 diff

API 调用规范（来自 weread-skills）：
- 统一入口：`POST https://i.weread.qq.com/api/agent/gateway`
- Header：`Authorization: Bearer $WEREAD_API_KEY`
- Body 参数平铺在顶层，包含 `api_name` 和 `skill_version: "1.0.3"`
- 每次请求必须带 `skill_version`

### 第 3 步：计算 Diff

对每本已有基线且拉取了新数据的书：

1. 用 `node {SKILL_DIR}/scripts/baseline.mjs extract <baseline.md路径>` 提取基线 JSON → 写入 `/tmp/weread-sync/<bookId>-baseline.json`
2. 用 `node {SKILL_DIR}/scripts/diff.mjs /tmp/weread-sync/<bookId>-baseline.json /tmp/weread-sync/<bookId>.json` 计算 diff
3. 收集所有书的 DiffResult

### 第 4 步：生成每日小结

1. 读取 `{SKILL_DIR}/templates/daily-summary.md`、`fiction.md`、`non-fiction.md`
2. 将所有有变化的书的 DiffResult 汇总，替换 daily-summary.md 中的 `[DIFF_JSON_PLACEHOLDER]`
3. 按模板要求生成完整小结 markdown
4. 将小结写入 `{VAULT_ROOT}/知识库/20.Areas/阅读/读书笔记/YYYY-MM-DD.md`
   - 如果当日文件已存在（手动多次触发），追加内容而非覆盖，用 `---` 分隔符分隔

### 第 5 步：更新基线文件

对每本有变化的书：

1. 用最新 BookData JSON 生成新的 baseline.md：
   ```bash
   node {SKILL_DIR}/scripts/baseline.mjs generate /tmp/weread-sync/<bookId>.json {VAULT_ROOT}/知识库/20.Areas/阅读/books/<书名>/weread/baseline.md
   ```
2. 如果书的 `weread/` 目录不存在，先创建

### 第 6 步：报告结果

向用户展示同步结果摘要：

```
✅ 同步完成

《少年》：进度 8% → 12%（+4%），新增 3 条划线，1 条想法
《系统思考》：进度 18% → 22%（+4%），新增 5 条划线
📝 小结已写入：知识库/20.Areas/阅读/读书笔记/2026-06-07.md
```

如果当日无任何阅读变化，告知用户"今日无新增阅读活动"，不生成空白小结。

### 错误处理

- **API 调用失败**：重试一次，若仍失败，跳过该书并告知用户
- **基线文件损坏**：提示用户"《书名》基线文件格式异常，将重新创建基线"，用当前数据覆盖
- **无新数据**：正常结束，不生成小结
- **WEREAD_API_KEY 未设置**：终止并提示配置

## 引用文件

生成小结时附上文件路径，方便用户点击跳转：
- 小结文件：`知识库/20.Areas/阅读/读书笔记/YYYY-MM-DD.md`
- 基线文件：`知识库/20.Areas/阅读/books/<书名>/weread/baseline.md`
