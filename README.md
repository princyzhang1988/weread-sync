# weread-sync

将微信读书的阅读数据同步到 Obsidian，自动生成每日读书小结。

## 安装

```bash
npx skills add <your-github-username>/weread-sync -g
```

## 前置条件

1. **Node.js ≥ 18**（脚本运行环境）
2. **微信读书 API Key**：在微信读书 App → 设置 → 技能管理 中申请
3. **weread-skills**：腾讯微信读书官方 skill（自动安装或手动 `npx skills add Tencent/WeChatReading -g`）
4. **Obsidian vault**：包含 `知识库/20.Areas/阅读/` 路径

## 配置

```bash
export WEREAD_API_KEY=wrk-xxxxxxxx
```

## 使用方法

### 手动同步

在 Claude Code 中执行：

```
/weread-sync
```

会先展示上次同步时间，确认后执行。

### 补同步

```
/weread-sync --since 2026-06-01
```

### 定时同步（通过 Hermes）

配置 Hermes 在每日 00:00 执行 `/weread-sync`。

## Obsidian 目录结构

```
知识库/20.Areas/阅读/
├── books/
│   └── <书名>/
│       └── weread/
│           └── baseline.md    # 该书的全量数据基线
└── 读书笔记/
    ├── 2026-06-07.md          # 每日读书小结
    └── ...
```

## 工作原理

1. 调用微信读书 API 拉取书架、进度、划线、想法
2. 与 Obsidian 中的基线文件对比，计算 diff
3. LLM 基于 diff 生成每日小结（内容总结 + 划线解读 + 阅读建议）
4. 小结写入 Obsidian，基线文件更新

## 阅读建议

小结末尾会根据书籍类型给出差异化建议：
- **小说/文学**：背景理解、人物关系梳理、引导式提问
- **工具书/非虚构**：核心主张识别、论证结构观察、实践连接

方法论参考：《如何阅读一本书》（莫提默·艾德勒）

## 文件说明

| 文件 | 说明 |
|------|------|
| `SKILL.md` | Skill 入口，定义同步工作流 |
| `scripts/baseline.mjs` | 基线文件解析与生成（零依赖） |
| `scripts/diff.mjs` | Diff 计算（零依赖） |
| `templates/daily-summary.md` | 每日小结 prompt 模板 |
| `templates/fiction.md` | 小说类建议模板 |
| `templates/non-fiction.md` | 工具书类建议模板 |

## License

MIT
