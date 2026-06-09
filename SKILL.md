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

### 执行前：复述关键规则

**读完本 skill 全部内容后，生成小结前，先用自己的话复述以下关键规则（3-5 句即可）。目的是强制消化，避免旧习惯惯性覆盖新规则。**

复述时必须覆盖：
- 重述区能放什么、不能放什么
- 拾贝区的内容来源和顺序
- 掩卷之后里 [[wikilink]] 怎么用
- 同日多次同步时文件名怎么处理
- 日记类书籍重述附加什么

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
6. **日记时间范围**：对每本有变化的书，检查标题是否含「日记」「日志」「diary」「journal」（或分类为人物传记且标题含年份范围）。如是日记类，从 BookData 章节标题中提取纯年份（正则 `^\d{4}年?$`），取最早和最晚年份 → 在重述 prose 段落后附加 `**日记跨度**：YYYY年—YYYY年（N年）`。无法提取时静默跳过。
7. **插图生成**：对每本文学/小说类有变化的书，判断重述部分是否适合配木刻版画插图。如需配图，按附录 B 的规范调用魔搭 Modelscope API 生成，保存到 `{VAULT}/知识库/20.Areas/阅读/books/<书名>/weread/diagrams/`，在 markdown 中嵌入 wikilink，ASCII 结构图保留在插图下方作为 fallback。工具书/非虚构/哲学类跳过插图，仅用 ASCII。API 调用失败时静默回退到纯 ASCII。
8. 按模板要求生成完整小结 markdown，严格遵守各区块的风格规则，始终包含「✎ 今日随笔」留白区
9. 将小结写入 `{VAULT_ROOT}/知识库/20.Areas/阅读/读书笔记/YYYY-MM-DD.md`
   - 如果当日文件不存在 → 直接创建（图片名用 `YYYY-MM-DD-<类型>.png`）
   - 如果当日文件已存在 → 笔记和图片同步递增尾缀：笔记 `YYYY-MM-DD-N.md`，图片 `YYYY-MM-DD-N-<类型>.png`（N 取已有最大尾缀 +1）

### 第 6 步：建立连接（Wikilink）

掩卷之后中引用其他书/作者/概念时，确保使用 Obsidian wikilink 内联，并在笔记末尾 🔗 连接区汇总。

1. 检查掩卷之后中是否引用了其他书、作者或核心概念
2. 如有 → 用 `[[书名]]` / `[[作者名]]` / `[[概念词]]` 包裹引用（掩卷之后模板中已要求使用 wikilink，此处确认即可）
3. 在笔记末尾 `## 🔗 连接` 区汇总所有跨笔记连接，每条一行：`[[目标页]]` + `·` + 一句话说明
4. 无跨笔记连接时不生成 🔗 连接区
5. 不创建独立 insight 文件、不维护 INDEX——Obsidian 反向链接自动聚合

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
```

如果当日无任何阅读变化，告知用户"今日无新增阅读活动"，不生成空白小结。

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

---

## 附录 B：木刻版画插图生成（魔搭 Modelscope）

使用魔搭 Modelscope 的 Qwen/Qwen-Image 模型，通过异步 API 生成木刻版画风格插图。免费额度：2000 次/天。

### B.1 前置条件

- `MODELSCOPE_API_KEY` 已设置（格式 `ms-xxxxxxxx`）
- 魔搭账号已绑定阿里云账号

### B.2 API 调用流程

三步：提交任务 → 轮询状态 → 下载图片。

**关键点**：
- 提交时必带 `X-ModelScope-Async-Mode: true`
- 轮询时必带 `X-ModelScope-Task-Type: image_generation`（不带则返回 "task not found"）
- 状态字段名是 `task_status`（不是 `status`）
- Prompt 不超过 2000 字符
- 图片尺寸固定 `1024x576`（16:9）

**Python 脚本模板**（内联在 bash 中执行）：

```bash
export MODELSCOPE_API_KEY="ms-xxxxxxxx"

python3 << 'PYEOF'
import requests, time, json, sys

API_KEY = "ms-xxxxxxxx"

prompt = """[木刻 prompt，按 B.3 模板组装]"""

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "X-ModelScope-Async-Mode": "true"
}

resp = requests.post(
    "https://api-inference.modelscope.cn/v1/images/generations",
    headers=headers,
    json={"model": "Qwen/Qwen-Image", "prompt": prompt, "n": 1, "size": "1024x576"},
    timeout=30
)

if resp.status_code != 200:
    print(f"❌ Submit failed: {resp.status_code}")
    print(resp.text[:500])
    sys.exit(1)

task_id = resp.json().get("task_id")
print(f"📋 Task: {task_id}")

poll_headers = {
    "Authorization": f"Bearer {API_KEY}",
    "X-ModelScope-Task-Type": "image_generation"
}

for i in range(15):
    time.sleep(3)
    r = requests.get(
        f"https://api-inference.modelscope.cn/v1/tasks/{task_id}",
        headers=poll_headers, timeout=30
    )
    if r.status_code != 200:
        continue
    result = r.json()
    ts = result.get("task_status")
    print(f"⏳ {i+1}/15: {ts}")
    if ts == "SUCCEED":
        url = result["output_images"][0]
        print(f"✅ {url}")
        img = requests.get(url, timeout=60).content
        out_path = "[图片保存路径]"
        with open(out_path, "wb") as f:
            f.write(img)
        print(f"📥 {out_path} ({len(img)/1024:.0f} KB)")
        sys.exit(0)
    elif ts == "FAILED":
        print(f"❌ FAILED")
        sys.exit(1)

print("❌ Timeout")
PYEOF
```

### B.3 Prompt 组装规范

按以下 5 段顺序组装 prompt，每段必含。总长度控制在 2000 字符以内。

```
1. 媒介+风格：
A woodcut print (木刻版画), black and white, high contrast, bold carved lines, visible wood grain texture. 1930s expressionist woodblock style.

2. 场景锚定：
Scene from [作者]'s "[书名]", [时代] [地点].

3. 具体画面（从 diff/prose 中提取）：
- 主角：[年龄]岁，[外貌特征——sharp features/high cheekbones/intense eyes 等具体描述]，[姿态——stands alone by window/watches in silence 等]，[衣着——high-collared student coat/practical coat 等，与年龄匹配]
- 配角群：[年龄——必须标注 YOUNG/students/early 20s，大写强调]，[动作——heated debate/pounding table 等]，[衣着]
- 空间：[房间类型——student apartment/parlour 等]，[光线——pale winter light/candle 等]，[关键物品]
- 窗外：[季节+城市地标——Petersburg winter rooftops 等]
- 构图：[主角在光中 / 配角在阴影中 / 对角线逆光 等]

4. 硬约束（一字不改）：
Requirements: [年龄要求如 characters YOUNG 19-22 student types], Russian/European features NOT Chinese, woodcut aesthetic bold carved strokes pure black and white no gray, NO text NO Chinese characters NO seals NO signatures, Aspect ratio 16:9.

5. 情感内核（一句话）：
[场景的情绪核心——如 a lonely observer trapped between silence and pressure to take sides]
```

### B.4 插图生成决策表

| 书类型 | 是否生成插图 | 插图类型 | 非文学替代方案 |
|--------|-------------|----------|---------------|
| 文学/小说 | ✅ 是 | 木刻场景插画 | - |
| 工具书/非虚构 | ❌ 否 | - | 仅 ASCII 概念图 |
| 哲学/思想 | ❌ 否 | - | 仅 ASCII 论证链 |

### B.5 错误处理

| 错误 | 处理方式 |
|------|---------|
| Prompt 超 2000 字符 | 精简第 3、5 段，保留第 1、2、4 段不变 |
| API 返回 400/500 | 重试一次，仍失败则静默回退到纯 ASCII |
| 轮询超时（45 秒后仍 PROCESSING） | 放弃该图，回退到 ASCII |
| 图片下载失败 | 回退到 ASCII |
| 任务状态 FAILED | 记录错误，回退到 ASCII |

**核心原则**：插图是锦上添花，不是必需。任何失败都不应阻塞小结生成。

### B.6 图片路径约定

- 目录：`{VAULT}/知识库/20.Areas/阅读/books/<书名>/weread/diagrams/`
- 文件名：`YYYY-MM-DD-<简短描述>.png`（如 `2026-06-09-人物关系.png`）
  - 同日多次同步时，图片名与笔记名同步加尾缀：`YYYY-MM-DD-N-<简短描述>.png`（如 `2026-06-09-2-人物关系.png`）
- 目录不存在时先创建
- 在 markdown 中用 vault 相对路径 wikilink 嵌入，与文件名匹配
