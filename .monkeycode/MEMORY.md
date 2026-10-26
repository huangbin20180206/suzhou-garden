# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Deduplication Strategy

- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.

## Entries

[对话固定格式约定]
- Date: 2026-10-26
- Context: 用户与助手约定对话固定格式（苏州园林项目会话中提出并确认）
- Instructions:
  - 任务开始时先报：开始时间、预计执行时长、预计完成时刻
  - 预计超过 10 分钟的长任务：期间约每 10 分钟汇报一行状态 —— 已耗时 / 当前进度 / 预估是否需要修正
  - 长命令一律放后台终端跑，汇报只读输出文件；汇报期间不改代码（跑门禁期间不改 src/）
  - 改动类任务收尾固定三段：① 改了什么（涉及文件与要点）② 怎么一眼看到（验证命令或页面）③ 有没有变差（门禁结果与风险）
  - 汇报用大白话，给结论与下一步建议，不用问句把任务推回用户
  - 用户报 bug：先取证再改，改完出图自证
  - 大改动（拆模块、动观感、动管线）先报预计时间，经用户确认再动手
