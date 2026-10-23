# HANDOFF · 人物/动物改造（P0~P3 收尾）2026-10-23

> 给下一个窗口的一页索引。细节看 `research/characters/README.md`（§11~§16）与根目录 `CODELY.md`。
> 分支 `refactor-06-split-20261013`。

## 1. 现在是什么状态

| 批次 | 内容 | 状态 | 提交 |
|---|---|---|---|
| P0 | 马会走（后腿骨链 + 四拍/对角步态 + 走↔吃草） | ✅ | 5208a46 |
| P1 | 资产管线（prompts / prep / validate）+ 4 件 AI 人物接入 | ✅ | 215c…/2194e12 |
| P2 | 程序化步态（不滑步）、对弈闲手+棋子、跪坐文士抚琴、文士端茶 | ✅ | 6567635 / c54be02 / 69ce296 |
| P3 | 马夫刷马（只动肘/腕 + 程序化马刷） | ✅ | 7c95077 |
| P2 收尾 | 文士捧卷轴（含与端茶的四相互斥）+ 马夫手持草料 | ✅ 本轮 |
| P4 | README 补节（research/characters §15/§16） | ✅ 本轮 |
| P4 剩余 | **交付前全量门禁**、**临时探针清理** | ⏳ |

## 2. 本轮做了什么（一句话一条）

- **文士捧卷轴**：两臂各自反解到"卷轴两端木轴"，实测两手相距 0.353m、腕在离地 1.12m、
  木轴落在腕心 10mm；纸面上沿朝人、法线上仰 24°；腕子内旋 0.90（5 变体出图定案）。
  相位机 0 捧读(22~38s)/1 放下/2 喝茶/3 捧起；茶盏只在相位 2 可见。
- **马夫手持草料**：只动左肘 `ex −1.60`（腕在身前 0.116m、离地 1.11m），11 根草
  `InstancedMesh`（1 个 draw call）+ 根黄梢绿渐变贴图，摆在腕前 9cm。

## 3. 验证证据（都可复跑）

| 断言 | 数字 | 探针 |
|---|---|---|
| 卷轴两端木轴 ↔ 两只手腕 | 各 **10mm**（掌厚） | `actor-final-shots.mjs` |
| 两手间距 / 高度 / 纸面法线 | 0.353m / 1.12m / (0.36,0.41,0.84) | 同上 |
| 四相状态机 | 0:w=1 无盏 / 1:w→0 / 2:w=0 有盏 sip=1 / 3:w→0.99 | `actor-scroll-check.mjs` |
| 刷尖贴在马颈颌（z=1.30 站位） | 全程 **42~74mm**，命中高度 1.157~1.283m | `actor-brush-final.mjs` |
| 腰带安全（只转右肘 0.35rad） | Spine/Hips/Chest/Skirt 位移 **0** | `actor-brush-probe.mjs` |
| 草把尺寸 | 0.272×0.105×0.156m，腕前 0.09m | `actor-final-shots.mjs` |

本轮还跑完 `verify:quick` 的三道尾巴：**pageerror-guard 28/28、layout-fingerprint ALL PASS
（网格 189 / 指纹 2971685213 / 变化 0）、random-guard 14/14**。

## 4. 已知边界（不是 bug，别再当缺陷查）

- **马夫够不到马嘴**：这条骨架没有前臂旋前、也不许转肩（腰带误权重），手臂只能在肘上折
  ⇒ 草把只能"拎在身前"（离地 1.11m），不能递到低头马的口鼻（0.87m）。
- **手的指节只有食指/中指/拇指三根骨**，无名指小指是刚性网格 ⇒ 握姿只能靠腕子转。
- **马模型是 AI 低模**（无眼/鼻孔/耳朵细节、腿是方棍）—— 属网格形体，不换资产改不动。
- `probe/figure-audit.mjs` 的"人物配色"判据对 GLB 白模会误报（改判据、不是改材质）。

## 5. 下一步（按优先级）

1. **交付前全量门禁**：`npm run verify`（67 门，约 20~40 分钟；只在交付前跑一次）。
   若某门红：先单跑复核，再 `git stash push -- <改的文件>` 对照 HEAD 定性。
2. **临时探针清理**：`outputs/_diag/actor-*.mjs` 是诊断件（不入库，仓库本来也不跟踪
   `outputs/`）；要留的先例是 `probe/` 下带判据的门禁。
3. 可选：书童的独立动作、马夫的"递草"若要更像，只能换带旋前骨的资产重新绑。
4. 可选：`search_my_assets`/生成管线若要再做新角色，先读
   `docs/characters-asset-spec.md`（预算 1.5MB、1024 JPEG、UniRig 绑骨）。

## 6. 干活入口

```powershell
npm run serve                 # 8935（不要重复起第二个）
npm run check                 # 语法 + no-undef + PWA
npm run verify:quick          # 7 道快门（改完功能先跑这个）
node outputs/_diag/actor-final-shots.mjs   # 人物道具验收图 + 量化
```

---

## 7. ����׷�ӣ�2026-10-23�������� + �������ɫ

### 7.1 ����Tinker �� Rodin ��ƥ���޹�����α��Ƥ��

| �� | ֵ |
|---|---|
| �ʲ� | `assets/horse-camargue.glb` 782KB / `horse-mongolian.glb` 786KB / `horse-criollo-saddle.glb` 862KB |
| ��Դ | �û��������ʲ��⣨`search_my_assets`������ƥ���� Rodin ���ɼ����Դ���/��/�ǿ�/���� + 2048 PBR |
| ���� | `outputs/_diag/horse-cand/convert_horse.py`���ŵ� y=0��ͷ�� +Z���ܸ� 1.75��x/z ���С���ͼ���� 1024 JPEG |
| �Ǽ� | **û�й���**��`skins=0`��? ����Ŀ�ֳɵ���ɫ��α��Ƥ `installHorseRig` |
| Ȩ�� | `rodinRigData()` ����һ�����ʵ�ʼ������������ķִء������� (0,1.26,0.40)��β�������µ� |
| ���� | `strideWalk = 2����ߡ�sin(A) = 0.663m`���� HORSE_GAIT �����Ử���� |
| ���� | ���� criollo/camargue��ԯ�� camargue+mongolian���Բ� camargue����ι mongolian |
| ���� | `src/15-stable.js` ���� `HORSE_MODEL = 'tinker'` һ�� |

��֤��`outputs/_diag/horse-rodin-check.mjs`��PASS��������ƥ���ڡ�`headDot=1`��ͷ����λǰ������
���� `minY == groupY`��������κη�������**��Χ���ཻ��� 0**����� 12s ��ƥ��̬��ȫ���аڷ���
�� pageerror����ͼ�� `outputs/_diag/horse-rodin/`��wide/quarter/top/inside/close����

�Ž�ͬ����`probe/horse-motion-guard.mjs` ����**α��Ƥ��֧** ���� û����Ƥ����ʱ����
`rig.head/tail/leg/jaw`��β���ż�����λ���֣�������֧���ס�α��Ƥ�ǻ��ȣ���
����"��ͷ�Բ�/ҡβ/̧��/�׽�/����"����һ��û�ˡ�

?? ������ȣ��� ������Ӱ�� 1.18��2.30 ��**����ƽ��**��������Χ�л���������ƥ"����һ��"
�������� 0.51m3�������ཻ����ֻȡ���������񣻢� α��Ƥֻע����ɫ���ʡ�**ûע����Ȳ���**
? ��ƥȫ�� `castShadow=false` + ������Ӱ������ͶӰ��Զ��"û��ͷ��վ��"��

### 7.2 �������ɫ�����ˡ�

| �� | ֵ |
|---|---|
| �ʲ� | `assets/fig-guest.glb` 667KB / 11222 tri / **60 ��**��54 + 6 ȹ�ǣ�|
| prompt | `research/characters/prompts.md` ��8���Һ�ֱ�� + ���½� + ���� + ��׳������ʿ���֣�|
| ���� | Rodin Gen-2.5-Medium �� **prep_character.py** �� UniRig �� repair_hands.py �� add_skirt_bones.py �� optimize_character.py |
| ��� | �¶����� `(0.15, 20.9)`��`yaw=��`���泯԰�ڣ���`floorRay: true`��`floorMax: 1.20` |

?? **������ prep �ٰ��**��ԭʼ���ɼ��ŵ��� z=?0.947�����У���ֱ�Ӷ��� UniRig �����ĹǼ���
"�� 0~1 ��һ��С��"�ڵ� ���� `Hips` ���� **z=0.027**�������Ǽ����ڽŵס���������ȫ�����ϣ�
`add_skirt_bones.py` �ᵱ���� `hip z=0.027 hem z=0.120 / reweighted=0`�������"��ͷû�����·���"
�Ŀ������źţ���prep �� `--height 1.70` ֮�� `Hips` �ص� **z=0.873**��ȹ�� `reweighted=1698`��

?? UniRig ������һ�� `Icosphere`��2��2��2����`optimize_character.py` �ᰴ"û�� ARMATURE �޸���"
ɾ��������ɾ��������һ�� 2m ����
