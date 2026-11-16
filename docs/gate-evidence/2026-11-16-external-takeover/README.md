# 2026-11-16 接手外部会话两处真机返工（抱鼓石落位 + 红衣童子朝向第二修）

## 缺陷（外部会话 2026-11-15 发现并修改，空转 17h 未提交，Chief 按两段式空转判据接手收尾）
1. 石桥抱鼓石悬空 0.23m：鼓底面 1.534、下方平板石顶面 1.302。修法 position.y：+0.52 → +0.29（中心 = rise*0.62 + 0.288 = 1.590，鼓 r=0.32 半高 0.14，底面 = 中心 − sqrt(0.32²−0.14²)）。
2. 红衣童子背对主人：旧 yaw −2.36 的根因是注释「yaw 0 = 面朝 +z 南」南北写反。新法不靠方位词推，直接量 actor_child1 世界矩阵 +Z 基向量与「到主人」方向点积（改前 +0.0175 = 89° 侧对），反解 yaw = atan2(0.697, −0.717) = +2.3699 → +2.37。
诊断脚本（外部会话留，outputs/ 不入库）：outputs/_diag/bridge-drums-20261115.mjs、child1-yaw-real-20261115.mjs、seat-side-shot-20261115.mjs。

## 读数对照
| 门 | 改前 | 改后 |
|---|---|---|
| actor-replay-unit | **红**：carriage-rite/walkback 逐帧不符「首个不同帧0 t=0.4s 92:−2.36≠2.37」（00-before） | **8 pass / 0 fail**（01 重录基线 + 02 复跑验证，exit=0） |
| figure-audit | — | PASS ✓（exit=0） |
| figure-foot-guard | — | ALL PASS 8 项（158.2s） |
| fresnel-guard | — | ALL PASS 7 项（top 107.26 / grazing 146.09） |
| npm run check | — | PASS（60 编译单元 / 410 文本 UTF-8） |

## 基线重录说明
yaw 是产品侧有意改动 ⇒ 四份基线（carriage-2/walk-1/carriage-rite/carriage-walkback）按门头注释 ACTOR_SIM_RECORD=1 重录，提交说明写明原因。重录前红读数成对留存于 00-before。

## 哪条不能当证据
verify-all --only 不存在该参数（真实参数 = --gates=），首发误跑全量已被 job_kill，无读数产生。
