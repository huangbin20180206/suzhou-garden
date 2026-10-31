// art-license: 「写意艺术处理」集中登记表（2026-10-30）。
// 项目口径是**写意为主**。审查 W12/W14 指出几件与明清苏州私家园林实景不符的物件
// （金刚鹦鹉、马厩、西式双轮马车、外国马种）。Kyle 已拍板：**展示保留，标注为艺术处理**，
// 替代资产候选列在本表里，等以后有资产了再按表替换。说明文档：docs/art-license.md。
//
// 用法（建物件的地方）：
//   import { markArtLicense } from './art-license.js';
//   markArtLicense(holder, 'macaw');   // ⇒ holder.userData.artLicense = '写意艺术处理：……'
// 探针/调试可遍历场景读 userData.artLicense / artLicenseId，再回查本表拿完整说明。
// ⚠️ 无依赖（不 import 任何东西）⇒ 任何模块都能 import、node 里能直接单测（probe/art-license-unit.mjs）。
// ⚠️ 只往 userData 上加两个键，不改几何/材质/可见性 —— 对合批、季节、拾取都无影响。

/* status：'tagged' = 已在代码里给 userData 打标；'pending' = 物件在 15-/16- 开头的模块里建，
   按分工不改那些文件，打标留到后面合并时做（objects[].file 写明位置）。 */
/* 与 16b-artistic-note.js 分工：那张表管"导览字幕上给访客看的一行注"（?notes=1），
   本表管"场景物件上的 userData 标记 + 实景对应 + 替代资产候选"。两表口径一致，改一处要对照另一处。 */
export const ART_LICENSE = Object.freeze({
  macaw: Object.freeze({
    id: 'macaw',
    label: '金刚鹦鹉（3 只，假山峰顶栖息/换峰飞行）',
    tag: '写意艺术处理：金刚鹦鹉原产中南美热带，明清江南园林并无放养栖石的实景；作为画面色彩点睛保留',
    real: '明清苏州私家园林的鸟：野生有白鹭、翠鸟、乌鸫、白头鹎、珠颈斑鸠、喜鹊；园居养鸟多为廊下笼养八哥、画眉',
    why: '红/黄/蓝羽色在灰白太湖石与绿荫里是唯一的高饱和点景，换峰飞行是园中少有的大尺度动态；用户已确认保留',
    alternatives: ['八哥（廊下鸟笼或立石）', '画眉（笼养，挂廊檐）', '白鹭（池边浅水立姿）', '翠鸟（临水立石）'],
    objects: Object.freeze([
      { name: "Group 'Macaw'（×3，资产 assets/Macaw.glb）", file: 'src/08c-aquatic.js', status: 'tagged' },
      { name: '落点/作息/动作状态机（MACAW_SPOTS、macawWantPerch、updateMacaws）', file: 'src/08f-macaw.js', status: 'tagged-by-holder' },
    ]),
  }),
  stable: Object.freeze({
    id: 'stable',
    label: '马厩（园东墙外，4 槽 + 场院 + 马夫）',
    tag: '写意艺术处理：苏州城内交通以舟楫、肩舆为主，私家园林外设马厩停驷并不典型；作为"访客到园"叙事场景保留',
    real: '明清宅园多有轿厅（停轿、候客）与河埠船埠；北方或大宅偶有马房、车棚',
    why: '"到访"叙事（马车进出、马夫喂草）依托此场景，已有完整动作编排；用户已确认保留',
    alternatives: ['明清园林里的马房或卸车棚（体量收小、粉墙黛瓦）', '轿厅（停轿 + 轿夫）', '河埠船埠（码头 + 乌篷船）'],
    objects: Object.freeze([
      { name: 'makeStable() 返回的马厩整组（08-assemble 延迟批「马厩」里落位）', file: 'src/15e-stable.js（建）/ src/08-assemble.js（打标）', status: 'tagged' },
      { name: '院外石板路 makeStableRoad / 出园路 makeStableExitRoad', file: 'src/15e-stable.js', status: 'pending' },
    ]),
  }),
  carriage: Object.freeze({
    id: 'carriage',
    label: '西式双轮马车（套车待发 1 驾 + 卸马停车 1 驾 + 到访马车）',
    tag: '写意艺术处理：西式双轮马车非明清江南形制；作为到访叙事道具保留',
    real: '明清江南出行多乘轿子（肩舆）或船；北方有明式骡车/马车（带篷厢、独辕）',
    why: '到访编排（停车/卸马/出园路）依赖车辆；用户已确认保留',
    alternatives: ['轿子（四人/二人肩舆）', '明式马车（带篷厢、独辕双轮）'],
    objects: Object.freeze([
      { name: "makeCarriage()（部件名 'carriagePart'、'carriage*'；15e 里 carA 双马套车 / carB 卸马停车）", file: 'src/15d-carriage.js / src/15e-stable.js', status: 'tagged' },
      { name: '到访马车编排（visit carriage = TRAVEL.car，tickCarriage 接手时打标）', file: 'src/16-actors.js', status: 'tagged' },
    ]),
  }),
  foreignHorse: Object.freeze({
    id: 'foreignHorse',
    label: '外国马种（卡马格马 Camargue / 克里奥罗马 Criollo 带西式马鞍）',
    tag: '写意艺术处理：卡马格马（法国）与克里奥罗马（南美）及西式马鞍非明清江南所有；作为马厩场景造型保留',
    real: '明清中国常见马种为蒙古马（矮壮、短腿、厚鬃）',
    why: '三匹 Rodin 马资产已完成伪蒙皮与动作；用户已确认保留',
    alternatives: ['蒙古马（已有 assets/horse-mongolian.glb，可直接替换槽位）'],
    objects: Object.freeze([
      { name: "RODIN_GLB.camargue（assets/horse-camargue.glb）", file: 'src/15c-horse-life.js', status: 'tagged' },
      { name: "RODIN_GLB.criollo（assets/horse-criollo-saddle.glb，含西式马鞍）", file: 'src/15c-horse-life.js', status: 'tagged' },
      { name: 'Tinker 回退马（assets/HorseTinker.glb，BlenderKit 低模，品种不明；markTinkerHorse，15c Tinker 路径调用）', file: 'src/15b-horse-rig.js', status: 'tagged' },
    ]),
  }),
});

/* 打标：只写 userData 两个键。未知 id 直接抛错（登记表是唯一出处，拼错要当场暴露）。 */
export function markArtLicense(obj, id){
  const e = ART_LICENSE[id];
  if (!e) throw new Error('[art-license] 未登记的 id：' + id);
  if (obj && obj.userData){
    obj.userData.artLicense = e.tag;
    obj.userData.artLicenseId = id;
  }
  return obj;
}

/* 查询：给 UI/探针用（例如悬停时附一行"写意艺术处理"说明）。 */
export function artLicenseOf(obj){
  for (let o = obj; o; o = o.parent){
    if (o.userData && o.userData.artLicenseId) return ART_LICENSE[o.userData.artLicenseId] || null;
  }
  return null;
}
