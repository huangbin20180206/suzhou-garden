#!/usr/bin/env bash
# 任务工作区助手（2026-11-02）
#   一个任务一个 git worktree = 一个独立目录 + 独立分支，多个会话同时改也不会互相踩文件。
#
# 用法：
#   tools/task-worktree.sh new <任务名>     # 新建工作区（分支 task/<任务名>）
#   tools/task-worktree.sh list             # 看现在有哪些任务工作区
#   tools/task-worktree.sh done <任务名>    # 移除工作区（分支保留，合并后再删）
#
# 约定：
#   · 工作区建在仓库**同级**的 suzhou-garden-wt/ 下，不污染仓库本身；
#   · 任务名只允许小写字母、数字、连字符（会成为分支名与目录名）；
#   · 新建后会把主仓库的 node_modules 用目录联接（junction）引过来，
#     省掉每次 npm ci 的 83MB 与一两分钟；引不过来就自己进去 npm ci。
#
# 注意：同一时间**改同一批文件**的任务不要并行；只读调研的任务可以多开。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$(dirname "$ROOT")/suzhou-garden-wt"

die(){ echo "✗ $*" >&2; exit 1; }
check_name(){ [[ "${1:-}" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "任务名只能用小写字母/数字/连字符，例如 fix-lint"; }

link_deps(){
  local dst="$1/node_modules"
  [ -d "$ROOT/node_modules" ] || return 0
  [ -e "$dst" ] && return 0
  # 用 Node 建目录联接（junction）：Windows 上不需要管理员权限，也不经过 Git Bash
  # 的路径转换；失败就算了，让人自己 npm ci。
  if node -e "require('fs').symlinkSync(process.argv[1], process.argv[2], 'junction')" \
       "$ROOT/node_modules" "$dst" 2>/dev/null; then
    echo "  · node_modules 已联接到主仓库（省 83MB 与一次 npm ci）"
  else
    echo "  · 未能联接 node_modules：跑测试前请先 cd 进去执行 npm ci"
  fi
}

# ⚠️ 收工时必须先**断开联接**再删工作区：
#   直接 rm -rf 一个 junction，在 Git Bash 下有可能顺着链接把主仓库的 node_modules 删掉。
#   用 fs.rmdirSync 只摘掉链接本身；如果它是 npm ci 装出来的真目录，这里会失败 —— 那正是我们要的。
unlink_deps(){
  local dst="$1/node_modules"
  [ -e "$dst" ] || return 0
  node -e "try{require('fs').rmdirSync(process.argv[1])}catch(e){}" "$dst" 2>/dev/null || true
}

cmd="${1:-}"; name="${2:-}"
case "$cmd" in
  new)
    check_name "$name"
    [ -e "$BASE/$name" ] && die "$BASE/$name 已存在"
    git -C "$ROOT" rev-parse --verify --quiet "refs/heads/task/$name" >/dev/null \
      && die "分支 task/$name 已存在；换个任务名，或先 git branch -D task/$name"
    mkdir -p "$BASE"
    git -C "$ROOT" worktree add -b "task/$name" "$BASE/$name" HEAD >/dev/null
    link_deps "$BASE/$name"
    cat <<EOF
✓ 工作区已建好：$BASE/$name   （分支 task/$name）
  下一步：
    cd "$BASE/$name"
    npm run check        # 1 秒的语法门
    npm test             # 冒烟 56 项（约 2 分钟）
    npm run verify -- --changed   # 按改动面挑门（发版前才需要全量）
EOF
    ;;
  list)
    echo "任务工作区根目录：$BASE"
    git -C "$ROOT" worktree list
    ;;
  done)
    check_name "$name"
    [ -d "$BASE/$name" ] || die "找不到 $BASE/$name"
    unlink_deps "$BASE/$name"
    git -C "$ROOT" worktree remove "$BASE/$name"
    echo "✓ 已移除工作区；分支 task/$name 仍在（合并后再 git branch -d task/$name）"
    ;;
  *)
    cat <<EOF
任务工作区助手
  用法：
    tools/task-worktree.sh new <任务名>     # 新建工作区（分支 task/<任务名>）
    tools/task-worktree.sh list             # 看现在有哪些任务工作区
    tools/task-worktree.sh done <任务名>    # 移除工作区（分支保留，合并后再删）
  说明见 docs/PARALLEL-WORKFLOW.md
EOF
    exit 1
    ;;
esac
