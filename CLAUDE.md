# 项目约定（给 Claude 的常驻指令）

> 这页每次会话都会被加载，所以只写"能直接省 token / 防踩坑"的规则。
> 背景数字来自 2026-11-02 实测：按 4 字符 ≈ 1 token 估算。

## 读代码

- **默认不许整读大文件**（确需整读，先说明理由）：`src/16-actors.js` 4627 行 ≈ **69K token**、
  `src/11-loop.js` 2513 行 ≈ **43K**、`index.html` ≈ 17K、`src/15d-carriage.js` ≈ 12K。
- 取数顺序固定：`rg -n "<关键词>" <文件>` 拿行号 → `Read offset=行号 limit=80`。
  同一次会话里不要重复读同一段。
- 要看文件结构先跑 `tools/code-map.sh <文件>`：章节横幅 + 顶层符号 + 行号，
  最大的文件也只有约 155 行（≈2.5K token），比整读省约 27 倍。
- `docs/HANDOFF-*.md` 单篇 8~10K token，只读被问到的那个小节。

## 跑命令

- 一律截断：`| tail -n 5` / `| head -n 40`；**不要 `cat` 大文件**。
- `git diff --stat` 先看面，再 `git diff -- <单个文件>` 看细节；
  `git log` 用 `--oneline`，不要打印 `%b` 正文（一条提交正文就能上千 token）。
- 门禁只看结论：`node probe/xxx.mjs 2>&1 | grep -E '✗|ALL PASS|FAILED'`。
- `npm run check` 的尾部会列 58 个模块名，用 `| tail -n 2`。

## 验证

- 日常三连：`npm run check`（1s）→ `npm test`（≈2min）→ `npm run verify -- --changed`。
- 全量 `npm run verify` ≈90 分钟，**独占跑**，期间别开第二个工作区或别的浏览器任务
  （带时间阈值的门会报假红，见 docs/PARALLEL-WORKFLOW.md）。
- 能读一个数值就别截图：`window.__garden` 已有 `qualityState()` / `actorVisit()` /
  `loopErrors()` / `drawStats()` 等接口。必须截图时只截 1 张（一张约 1.5~2K token）。

## 并行

- 规矩见 `docs/PARALLEL-WORKFLOW.md`：改码 ≤2 条、只读调研 3~4 条、同一条验证链只跑一条。
- 两个会话不得同时改 `src/16-actors.js` 或 `probe/_actor-sim/baseline/*.json.gz`（二进制基线会冲）。

## 记录

- 一次性取证脚本放 `outputs/_diag/`（已 gitignore），命名 `<问题>-<日期>.mjs`，下次直接跑。
- "为什么这么改"写进代码注释（本项目惯例），不要重复写进对话。
