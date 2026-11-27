#!/usr/bin/env node
// 运行期模块清单生成器：src/*.js 是唯一真值，独立生成 sw.js 的 MODULES 段。
// 用法：node tools/gen-module-manifest.mjs（默认校验）
//       node tools/gen-module-manifest.mjs --check
//       node tools/gen-module-manifest.mjs --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SW = 'sw.js';
export const MODULE_BEGIN = '  /* <module-manifest:src> 由 tools/gen-module-manifest.mjs 从 src/*.js 生成，勿手改 */';
export const MODULE_END = '  /* </module-manifest:src> */';

const lf = (s) => s.replace(/\r\n/g, '\n');
export const readText = (rel) => lf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

export function moduleFiles(){
  return fs.readdirSync(path.join(ROOT, 'src'), { withFileTypes:true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

const q = (s) => "'" + String(s) + "'";
export function genModuleBlock(files = moduleFiles()){
  const unique = [...new Set(files)];
  if (unique.length !== files.length) throw new Error('src 模块清单出现重复文件');
  const rows = unique.map(file => '  ' + q('./src/' + file) + ',');
  return [MODULE_BEGIN, ...rows, MODULE_END].join('\n');
}

export function extractBlock(src, begin = MODULE_BEGIN, end = MODULE_END){
  const i = src.indexOf(begin), j = src.indexOf(end);
  if (i < 0 || j < i) return null;
  return src.slice(i, j + end.length);
}

export function replaceBlock(src, block){
  const current = extractBlock(src);
  if (current === null) throw new Error('找不到 MODULES 生成段标记');
  return src.replace(current, () => block);
}

function main(){
  const write = process.argv.includes('--write');
  const allowed = new Set(['--write', '--check']);
  if (process.argv.slice(2).some(arg => !allowed.has(arg))){
    console.error('[gen-module-manifest] 用法：--check（默认）或 --write');
    process.exit(1);
  }
  const sw = readText(SW);
  const expected = genModuleBlock();
  const actual = extractBlock(sw);
  if (actual === null){
    console.error('[gen-module-manifest] sw.js 缺少 MODULES 生成段');
    process.exit(1);
  }
  if (actual !== expected){
    if (write){
      fs.writeFileSync(path.join(ROOT, SW), replaceBlock(sw, expected));
      console.log('[gen-module-manifest] 已写回 sw.js MODULES（' + moduleFiles().length + ' 件）');
      return;
    }
    console.error('[gen-module-manifest] 不一致：sw.js MODULES ≠ src/*.js（' + moduleFiles().length + ' 件） ⇒ 跑 --write');
    process.exit(1);
  }
  console.log('[gen-module-manifest] 一致：' + moduleFiles().length + ' 个 src 模块');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
