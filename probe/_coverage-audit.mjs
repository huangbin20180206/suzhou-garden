/* 全园「隐形缺陷」盘点 —— 只读诊断，**未入链**（2026-09-20）。
 *
 * 起因：修完水面折射层漏石头之后发现，**这类缺陷的形状是固定的**：
 *   「某个东西该出现在某个集合里，却没出现 —— 不报错、不崩、状态全对，
 *     只有主动去问『这个集合里还应该有什么』才发现。」
 * 于是把同一套问法用到另外三类"集合"上，看还有没有同款：
 *   ① 会动的东西 → 风场名单（`addWind` 注入的材质）
 *   ② 会投影的东西 → 阴影名单（`castShadow`）
 *   ③ 该随季节消失/保留的东西 → 季节名单
 *
 * ⚠️ 本脚本**故意不做成门禁**：这三类的判据一半是启发式（"像叶子"没有硬定义），
 *    拿模糊判据当门禁＝制造假红。它只负责把**可疑项列成清单**，真伪由人判定；
 *    判定为真缺陷的，再单独写成有牙的判据。
 *
 * ⚠️ 判据口径沿用既有门禁，别另发明一套：
 *    · 风场用 `mat.customProgramCacheKey()` 的前缀 `wind|`（**不**用 `userData.shader`，
 *      后者只在材质被渲染过之后才有 → 视锥外的物体会漏检，见 wind-audit 的注释）。
 *
 * 用法: node probe/_coverage-audit.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 名字里带这些词的，**理应**会随风动。名单是启发式，写在这里便于被人反驳。 */
const FOLIAGE = /bamboo|leaf|leaves|reed|willow|vine|wisteria|banana|grass|flower|petal|lotus|blade|branch|bough|shrub|canopy|crown|stem|lily/i;
/* 这些是"平面/背景/容器"，不投影、不动都合理，别报出来刷屏 */
const SKIP_SHADOW = /^(waterSurface|pondBed|ground|hill|sky|mistField|mergedStatic|bank)/i;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.setDefaultTimeout(180000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  /* 等 GLB 到齐（荷/芭蕉/龟是首帧后异步挂载的，固定 sleep 会漏检 —— wind-audit 踩过） */
  await page.waitForFunction(() => {
    let lotus = 0, banana = 0;
    window.__garden.scene.traverse(o => {
      if (!o.isMesh) return;
      if (o.name === 'LotusPlant') lotus++; else if (o.name === 'BananaPlant') banana++;
    });
    return lotus >= 12 && banana >= 8;
  }, { timeout: 180000, polling: 500 }).catch(() => null);
  await sleep(1200);

  const FOLIAGE_SRC = FOLIAGE.source, SKIP_SRC = SKIP_SHADOW.source;
  const data = await page.evaluate(({ FOLIAGE_SRC, SKIP_SRC }) => {
    const G = window.__garden, T = G.THREE;
    const RE_FOL = new RegExp(FOLIAGE_SRC, 'i'), RE_SKIP = new RegExp(SKIP_SRC, 'i');
    const windInjected = (m) => typeof m.customProgramCacheKey === 'function'
                            && String(m.customProgramCacheKey()).indexOf('wind|') === 0;
    const path = (o) => {
      const out = []; let p = o;
      while (p && p !== G.scene){ if (p.name) out.unshift(p.name); p = p.parent; }
      return out.join('/');
    };
    /* ⚠️ 合并后的网格全都**无名**（第一版只报"无名/材质 ?"，64 条清单一条也判不了）。
       给无名对象补足可辨识标签：材质名 → 颜色 → 有无贴图 → 三角形数。
       有了这三样，人一眼就能认出"这是瓦顶/这是荷叶/这是远山"。 */
    const matLabel = (o) => {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m) return '(无材质)';
      const tri = o.geometry && o.geometry.index ? o.geometry.index.count / 3
                : (o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0);
      return `${m.name || (m.color ? '#' + m.color.getHexString() : '?')}`
           + `${m.map ? '+贴图' : ''}/${m.type.replace('Mesh', '').replace('Material', '')}`
           + `/三角${Math.round(tri)}`;
    };

    const noShadow = [], noWind = [], allInjected = {};
    let meshN = 0, injectedN = 0;
    const seen = new Set();
    G.scene.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      if (seen.has(o.uuid)) return; seen.add(o.uuid);
      meshN++;
      const p = path(o);
      const box = new T.Box3().setFromObject(o);
      const size = box.isEmpty() ? new T.Vector3() : box.getSize(new T.Vector3());
      const h = size.y, w = Math.max(size.x, size.z);

      /* 风场：**全场景**枚举（第一版只在"名字像叶子"的子树里统计 → 报出"3 种"，
         与 wind-audit 既有断言（柳叶 crown 模式存在）矛盾。枚举面太窄＝假绿。） */
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats){
        if (!m || !windInjected(m)) continue;
        injectedN++;
        /* 2026-09-20 起风参数降为 uniform、program 合并：mode/amp/maxDisp 读 windParams */
        const wp = (m.userData && m.userData.windParams) || {};
        const ck = String(m.customProgramCacheKey()).split('|');
        const k = m.name || m.uuid.slice(0, 6);
        if (!allInjected[k]) allInjected[k] = {
          mode: wp.mode || ck[3], amp: wp.amp !== undefined ? wp.amp : ck[1],
          maxDisp: wp.maxDisp !== undefined ? wp.maxDisp : ck[4],
          users: 0, where: p.slice(0, 50), colored: m.color ? '#' + m.color.getHexString() : '' };
        allInjected[k].users++;
      }

      /* ① 阴影名单：大件却不投影 */
      if (!o.castShadow && h > 1.0 && w > 1.5 && !RE_SKIP.test(o.name) && box.min.y < 6){
        const c = box.getCenter(new T.Vector3());
        const gp = o.geometry && o.geometry.parameters;
        noShadow.push({ name: o.name || '(无名)', path: p.slice(0, 46), h: +h.toFixed(1),
                        w: +w.toFixed(1), y: +box.min.y.toFixed(2), mat: matLabel(o),
                        at: `(${c.x.toFixed(1)}, ${c.z.toFixed(1)})`,
                        parent: (o.parent && o.parent.name) || o.parent.type,
                        /* 几何类型 + 参数：盒子能直接读出宽高深，用来把对象对回建它的那段代码 */
                        geo: o.geometry ? o.geometry.type : '?',
                        dim: gp ? `${gp.width ?? ''}×${gp.height ?? ''}×${gp.depth ?? ''}` : '' });
      }

      /* ② 风场名单：名字像叶子却没有风 */
      const injected = mats.filter(m => m && windInjected(m));
      if (RE_FOL.test(p) || RE_FOL.test(o.name || '')){
        if (!injected.length && h > 0.25)
          noWind.push({ name: o.name || '(无名)', path: p.slice(0, 46), h: +h.toFixed(2),
                        inst: !!o.isInstancedMesh, mat: matLabel(o) });
      }
    });

    return { noShadow, noWind, allInjected, meshN, injectedN };
  }, { FOLIAGE_SRC, SKIP_SRC });

  console.log(`\n[盘点] 场景里参与检查的网格 ${data.meshN} 个`);
  console.log(`[风场] 全场景被注入风的**材质-网格引用** ${data.injectedN} 处，涉及 ${Object.keys(data.allInjected).length} 种材质：`);
  for (const [k, v] of Object.entries(data.allInjected))
    console.log(`      · ${k}${v.colored ? '(' + v.colored + ')' : ''}: ${v.mode} amp=${v.amp} maxDisp=${v.maxDisp}`
              + ` ｜ 用在 ${v.users} 个网格 ｜ 例：${v.where || '(无名)'}`);

  console.log(`\n① 阴影名单可疑（大件却不投影：高>1.0m 且宽>1.5m）共 ${data.noShadow.length} 个`
            + `（只列最大的 24 条；括号里是世界 (x,z)，用来认它是园子里的哪一处）`);
  data.noShadow.sort((a, b) => b.h * b.w - a.h * a.w).slice(0, 24)
    .forEach(r => console.log(`      · ${r.at} 高${r.h}×宽${r.w} 底y=${r.y} ｜ ${r.mat}`
                             + ` ｜ ${r.geo}${r.dim ? '(' + r.dim + ')' : ''} ｜ 父级 ${r.parent}`));

  console.log(`\n② 风场名单可疑（名字像叶子却没风：高>0.25m）共 ${data.noWind.length} 个`);
  data.noWind.sort((a, b) => b.h - a.h)
    .forEach(r => console.log(`      · ${r.name}${r.inst ? ' [实例化]' : ''} ｜ 高${r.h} ｜ 材质 ${r.mat} ｜ ${r.path}`));

  /* ── ③ 季节名单：**不靠名字**，按"材质标签 → 可见网格数"对比冬夏 ──
     第一版按名字匹配，只抓到 3 行（紫藤/竹子根本没出现）＝ 判据没有分辨力。
     换成按材质标签分组后，能客观回答："哪些东西在冬天没了、哪些该没却没没"。 */
  const season = async (s) => {
    await page.evaluate((ss) => window.__garden.setEnv('season', ss), s);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000 }).catch(() => {});
    await sleep(1500);
    return page.evaluate(() => {
      const G = window.__garden;
      const label = (o) => {
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m) return '(无材质)';
        const tri = o.geometry && o.geometry.index ? o.geometry.index.count / 3 : 0;
        return `${m.name || (m.color ? '#' + m.color.getHexString() : '?')}${m.map ? '+贴图' : ''}/三角${Math.round(tri)}`;
      };
      const out = {};
      G.scene.traverse(o => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        /* ⚠️ 必须查**整条祖先链**的 visible：季节开关是挂在父级 group 上的，
           子级自己的 visible 一直是 true —— 只看 o.visible 会全部"都在"。 */
        let p = o, hidden = false;
        while (p && p !== G.scene){ if (!p.visible){ hidden = true; break; } p = p.parent; }
        if (hidden) return;
        const k = label(o); out[k] = (out[k] || 0) + 1;
      });
      return out;
    });
  };
  const winter = await season('winter'), summer = await season('summer');
  const keys = [...new Set([...Object.keys(winter), ...Object.keys(summer)])].sort();
  const onlySummer = keys.filter(k => summer[k] && !winter[k]);
  const onlyWinter = keys.filter(k => winter[k] && !summer[k]);
  const bothDiff = keys.filter(k => summer[k] && winter[k] && summer[k] !== winter[k]);
  console.log(`\n③ 季节名单（按材质标签对比"冬/夏可见网格数"）`);
  console.log(`      只夏天有（＝冬天消失）${onlySummer.length} 种：`);
  onlySummer.forEach(k => console.log(`        · ${k} ×${summer[k]}`));
  console.log(`      只冬天有 ${onlyWinter.length} 种：`);
  onlyWinter.forEach(k => console.log(`        · ${k} ×${winter[k]}`));
  console.log(`      两季都有但数量不同 ${bothDiff.length} 种：`);
  bothDiff.forEach(k => console.log(`        · ${k} 冬${winter[k]} 夏${summer[k]}`));
  await page.evaluate(() => window.__garden.setEnv('season', 'summer'));

  /* ── ④ 天气名单（积雪 / 湿地登记表）──
     这张表是**手工维护的数组**（01-materials.js:727/736），材质必须显式登记：
     雪在 installSnow(SNOW_COVER_MATS) 时被链式注入，湿地靠 applyWetness 每帧遍历。
     漏登记**不报错、不崩**，只是那一块冬天不积雪、下雨不打湿 —— 与折射层漏石头同款。

     ⚠️ 与前两张不同：这张的判据全是**客观的对象身份**比对（不是"名字像不像石头"这种启发式），
        所以它有资格升级成正式门禁。四条指纹：
        W1 带 dryRough（＝有人以为它进了湿表）却不在 WET_MATS 里
           → clone 漏网：MAT.stone.clone() 会**复制 userData**（含 dryRough），
             但数组存的是**对象引用**，clone 是另一个对象 → 参数在、遍历不到 → 静默不生效。
        W2 带 snowInstalled 却不在 SNOW_COVER_MATS 里 → 同上（雪侧）
        W3 在 SNOW_COVER_MATS 里但 customProgramCacheKey 不含 '|snow'
           → 登记了却没被装雪：installSnow 遍历的是**调用当刻**的数组内容，
             之后（deferBoot 大件）才 push 进去的材质收不到注入。
        W4 在 WET_MATS 里却 dryRough === undefined → 在表里但被 applyWetness 的
             `continue` 跳过（表里混进了没走 registerWeatherRoles 的材质）。
        W5 雪表之外的**大块可见实体面**清单（按尺寸排序，供人判定该不该积雪）。

     读名单的办法：**动态 import 同一个模块 URL** —— ESM 是单例，拿到的就是页面正在用的
     那两个数组对象本身（不是副本），所以 Set.has 的对象身份判定成立。 */
  const weather = await page.evaluate(async ({ SKIP_SRC }) => {
    const G = window.__garden, T = G.THREE;
    const RE_SKIP = new RegExp(SKIP_SRC, 'i');
    /* index.html 里写的是 './src/01-materials.js'，与这里的相对路径解析到同一 URL */
    const M = await import(new URL('src/01-materials.js', document.baseURI).href);
    const SNOW = M.SNOW_COVER_MATS || [], WET = M.WET_MATS || [];
    const snowSet = new Set(SNOW), wetSet = new Set(WET);
    const hasSnowKey = (m) => {
      try { return String(m.customProgramCacheKey()).indexOf('|snow') >= 0; } catch (_) { return false; }
    };
    const label = (m) => `${m.name || '(无名)'}`
      + `${m.color ? '#' + m.color.getHexString() : ''}`
      + `/${m.type.replace('Mesh', '').replace('Material', '')}`;
    const pth = (o) => { const a = []; let p = o;
      while (p && p !== G.scene){ if (p.name) a.unshift(p.name); p = p.parent; } return a.join('/'); };

    const mats = new Map();
    G.scene.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])){
        if (!m) continue;
        let r = mats.get(m.uuid);
        if (!r){
          r = { label: label(m), inSnow: snowSet.has(m), inWet: wetSet.has(m),
                dry: m.userData.dryRough !== undefined, si: !!m.userData.snowInstalled,
                snowKey: hasSnowKey(m), users: 0, sample: '', maxDim: 0 };
          mats.set(m.uuid, r);
        }
        r.users++;
        if (!r.sample) r.sample = pth(o);
        const box = new T.Box3().setFromObject(o);
        if (!box.isEmpty()){
          const s = box.getSize(new T.Vector3());
          r.maxDim = Math.max(r.maxDim, s.x, s.y, s.z);
        }
      }
    });

    const all = [...mats.values()];
    const brief = (r) => ({ label: r.label, users: r.users, sample: r.sample.slice(0, 52),
                            maxDim: +r.maxDim.toFixed(1) });
    return {
      nMat: all.length, nSnow: SNOW.length, nWet: WET.length,
      nSnowUsed: all.filter(r => r.inSnow).length,
      nWetUsed: all.filter(r => r.inWet).length,
      W1: all.filter(r => r.dry && !r.inWet).map(brief),
      W2: all.filter(r => r.si && !r.inSnow).map(brief),
      W3: all.filter(r => r.inSnow && !r.snowKey).map(brief),
      W4: all.filter(r => r.inWet && !r.dry).map(brief),
      W5: all.filter(r => !r.inSnow && !RE_SKIP.test(r.sample) && r.maxDim > 1.5)
            .sort((a, b) => b.maxDim - a.maxDim).slice(0, 20).map(brief),
    };
  }, { SKIP_SRC });

  const w = weather;
  console.log(`\n④ 天气名单（积雪 / 湿地登记表）`);
  console.log(`      名单规模：雪表 ${w.nSnow} 项 / 湿表 ${w.nWet} 项`
            + ` ｜ 场景在用材质 ${w.nMat} 种，其中属雪表 ${w.nSnowUsed}、属湿表 ${w.nWetUsed}`);
  const wline = (tag, arr, why) => {
    console.log(`      ${tag} ${arr.length} ${arr.length ? '← ' + why : ''}`);
    arr.slice(0, 12).forEach(r =>
      console.log(`          · ${r.label} ｜ 用 ${r.users} 处 ｜ 最大尺寸 ${r.maxDim}m ｜ ${r.sample}`));
  };
  wline('W1 带 dryRough 却不在湿表', w.W1, 'clone 漏网：参数在、遍历不到 → 静默不生效');
  wline('W2 带 snowInstalled 却不在雪表', w.W2, '同上（雪侧）');
  wline('W3 在雪表却没被装雪', w.W3, '登记晚于 installSnow → 收不到注入');
  wline('W4 在湿表却缺 dryRough', w.W4, '在表里但被 applyWetness 跳过');
  console.log(`      W5 雪表之外的大块可见实体面（最大尺寸>1.5m）共 ${w.W5.length} 种`
            + `（列前 20；用来人工判定"这块该不该积雪"）`);
  w.W5.forEach(r => console.log(`          · ${r.label} ｜ 用 ${r.users} 处 ｜ 最大尺寸 ${r.maxDim}m ｜ ${r.sample}`));

  console.log(`\n[异物] pageerror=${errs.length}${errs.length ? ' → ' + errs[0] : ''}`);
  console.log('[说明] ①②③ 是**可疑项**（启发式判据），真伪由人裁决；');
  console.log('       ④ 的 W1~W4 是**客观指纹**（对象身份比对），可直接写成有牙的门禁。');
  await browser.close();
  server.close();
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
