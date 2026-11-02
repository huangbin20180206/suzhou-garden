#!/usr/bin/env bash
# 代码地图：把一个源文件的"章节标题 + 顶层函数/常量 + 行号"列出来。
# 用途：让 AI（或你自己）按行号直接读那一段，而不是从第 1 行翻到第 4600 行。
# 用法：
#   tools/code-map.sh src/16-actors.js   # 单文件：章节 + 符号 + 行号
#   tools/code-map.sh src               # 目录：只列文件与行数（按行数降序）
set -euo pipefail

target="${1:-}"
[ -n "$target" ] || { echo "用法：tools/code-map.sh <文件或目录>"; exit 1; }
command -v rg >/dev/null 2>&1 || { echo "需要 ripgrep（rg）"; exit 1; }

if [ -d "$target" ]; then
  # 目录模式：只回答"哪些文件大"，不展开符号
  find "$target" -maxdepth 1 -name '*.js' -print0 \
    | xargs -0 wc -l | sort -rn | head -40
  exit 0
fi

[ -f "$target" ] || { echo "找不到文件：$target"; exit 1; }

echo "── $target（$(wc -l < "$target") 行）──────────────────────────"
# ① 章节横幅：本项目用 /* ══ … ══ */ 与 // ── … ── 分段，先给骨架
rg -n '^\s*(/\* ═|// ──)' "$target" 2>/dev/null | sed -E 's/\s+/ /g' | head -80
echo "── 符号（顶层 function / const / class）────────────────────"
# ② 顶层声明：起首无缩进，带行号，供 Read offset 直接跳
rg -n '^(export )?(async )?(function|class) [A-Za-z_$]|^(export )?const [A-Za-z_$]{3,}' "$target" \
  | sed -E 's/\{\s*$//' | head -220
echo "── 提示：拿到行号后读该段（Read offset=N limit=80），别整读 ──"
