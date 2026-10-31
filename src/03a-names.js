// 03a-names: 景点显示名的**唯一出处**（2026-10-30）。
// 主堂与池边凉亭以后要改名（审查 W10/W11：实景远香堂在池南、面阔三间四面厅；荷风四面亭是池中岛上的
// 六角攒尖亭，与本园东岸歇山水榭对不上）。为了改名时只动一处，所有**展示给人看**的名字都从这里取：
// 匾额贴图文字、机位按钮名、巡游字幕标题与正文。
// ⚠️ 只放"名字"，不放坐标/形制；无依赖（不 import 任何东西）⇒ 任何模块都能安全 import，不会成环。
// ⚠️ 改名前先看文末"仍写死在别处"的清单：那些文件不归 03~09 维护，要同步找对应模块的人改。

export const SITE_NAMES = Object.freeze({
  garden:    '拙政园',     // 园名（截图水印/页面标题用到，见文末清单）
  hall:      '远香堂',     // 主堂（04 匾额、08d 机位 hall / 字幕 hall·plaque·spring）
  pavilion:  '荷风四面',   // 池东临水凉亭/水榭（04 匾额、08d 机位 pavilion / 字幕 pavilion）
  heroStone: '云根',       // 池南特置立峰 + 题名石（08d 机位 hero/stele 名与字幕标题）
});

/* 由名字派生的展示串：集中在这里拼，调用处只引用结果，免得同一个名字在几处拼法不一。 */
export const SITE_LABELS = Object.freeze({
  hallPlaque:     SITE_NAMES.hall,                        // 主堂匾额贴图文字
  pavilionPlaque: SITE_NAMES.pavilion,                    // 凉亭匾额贴图文字
  heroVp:         '立峰·' + SITE_NAMES.heroStone,         // 机位按钮：立峰
  steleVp:        SITE_NAMES.heroStone + '近观',          // 机位按钮：题名石近观
  hoverHallPlaque:     '匾额「' + SITE_NAMES.hall + '」',       // 悬停标签（11-loop 待接入）
  hoverPavilionPlaque: '匾额「' + SITE_NAMES.pavilion + '」',   // 悬停标签（11-loop 待接入）
});

/* ── 仍写死在别处、不归本目录维护的地方（改名时要一并改；2026-10-30 盘点）──
   · index.html：<title>「苏州园林 · 拙政园远香堂对景」；机位按钮文字 data-view="hall"/"pavilion"
     （「远香堂」「荷风四面」）；CSS 注释。
   · src/11-loop.js：截图水印竖排「拙政园远香堂」；截图/长曝下载文件名前缀「远香堂」「远香堂长曝」；
     控制台「[远香堂] 场景就绪」；悬停标签「匾额「远香堂」」「匾额「荷风四面」」「远香堂」（台基）
     —— 可直接改用上面的 SITE_NAMES / SITE_LABELS.hoverHallPlaque / hoverPavilionPlaque。
   · src/12-env.js / 12d-lantern.js / 12e-precip.js：只在注释里出现，不影响显示。
   · 字幕正文里的「荷风四面」有两处是**诗意短语**而非亭名（08d CAPTIONS.hall「四面厅，荷风四面，香远益清」、
     SEASON_CAPTIONS.summer「正是荷风四面时」），刻意保留字面，改亭名时按语义决定是否跟改。 */
