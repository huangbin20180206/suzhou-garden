# 2026-11-12 · 主峰 GLB 改按需预取（首次下载 14.18MB → 8.97MB，−37%）

## 1. 问题

准备把项目挂到公网发链接给朋友体验。首次访问实测：

```
请求数 83 ｜ 合计 14.18 MB
    5.21 MB  /assets/boulder-hero.glb      ← 占 37%
    0.99 MB  /vendor.js
    0.91 MB  /assets/Macaw.glb
```

`boulder-hero.glb` **5.21MB，默认路径根本不用**。

## 2. 根因：一次没撤干净的遗留

2026-10-30「第 0 周热修」把主峰默认改成**程序化**（`makeTaihuHeroGeo`），
只有显式 `?heroSrc=glb` 才用这个 GLB。当时：

- `08-assemble.js:479` 的注释写明「两份预载清单已同步撤下，见 13-preload / sw.js」；
- `assets/manifest.json` 里它是 `"phase": "lazy", "precache": false`；
- `13-preload.js` 的 `PRELOAD_MANIFEST` 里也确实没有它。

**唯独 `08c-aquatic.js` 那行模块期预取漏了撤。**

那行原本是 2026-10-14 修「预载清单 settle 不到 → warmBoot 死锁 180s」加的
（boulder 的 fetch 只住在 deferred 的 heroStones 里，模块期没人发起）。
撤默认档之后，这条死锁链已经**不成立了**（默认路径压根不 fetch 它），
但那行预取还在无条件跑。

## 3. 改法

`src/08c-aquatic.js`：把无条件预取改成**与 08-assemble 的 `heroSrc` 同一条口径**。

```js
{
  let wantGlb = false;
  try { wantGlb = new URLSearchParams(location.search).get('heroSrc') === 'glb'; } catch {}
  if (wantGlb) loadAssetOnce('assets/boulder-hero.glb', 4.49, () => {});
}
```

- 原来的死锁说明**完整保留**在注释里 —— 它对 `?heroSrc=glb` 那条路径**仍然有效**
  （走 glb 档时 fetch 仍只住在 deferred 里，仍需模块期先发起）；
- 补了一条警告：两处判定必须是同一口径，否则会出现「预取了不用」或「用了没预取（死锁）」。

只改预取条件，**没有动** `loadAssetOnce` 的行为、程序的来源选择、或任何资产内容。

## 4. 读数

### 首次下载（`01-requests.log`）
| | 改前 | 改后 |
|---|---|---|
| 请求数 | 83 | 82 |
| 合计 | **14.18 MB** | **8.97 MB（−37%）** |
| 最大单文件 | boulder 5.21MB | vendor.js 0.99MB |

### 两条路径都正常（`02-two-paths.log`）
```
默认(proc)      boulder请求 0 ｜ 立峰 true（子节点0 = 程序化 Mesh）｜ 报错 0
?heroSrc=glb    boulder请求 1 ｜ 立峰 true（子节点1 = GLB 容器）  ｜ 报错 0
```

### 冷启动墙钟（本机无头 ANGLE / high 档）
把预取注释掉 + 让该 URL 返回 404（确保拿到也用不了）的对照实验：
```
有预取 39.2s  →  无预取 23.0 / 23.2 / 23.3s
```
⚠️ 这一组是**同机对照**，绝对值含本机 GPU 缓存态波动；**可复现的是"少下一个 5.21MB 文件"**，
墙钟秒数按网络条件变化 —— 手机 4G 上省下的时间远大于本机。

## 5. 门禁

| 门 | 读数 |
|---|---|
| `npm run check` | PASS（400 文本文件 UTF-8） |
| `preload-guard` | **16/16 PASS** —— 这道门直接守预载清单与 settle，是本次改动的高危面 |
| `refract-coverage` | **6/6 PASS** —— 立峰水下段进折射层，换了加载时序要复验 |
| `layout-fingerprint` | ALL PASS（2 项） |

## 6. 没做的

- **没有做 GLB 压缩**（Draco/meshopt）。剩下的 8.97MB 里 `.glb` 仍占 5.4MB，
  压缩可到 2MB 左右，但要改资产工具链与加载代码，另立任务。
- **没有开 gzip**。3.42MB 的 JS 压缩后约 1MB，但这是**托管平台**的事，不是代码的事。
- 暖机（首次访问特有的着色器编译，本机 high 档 22s）一分没少，本次不涉及。