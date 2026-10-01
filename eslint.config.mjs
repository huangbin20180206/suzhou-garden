// eslint.config.mjs —— 本仓库只为一件事：no-undef（裸用未定义标识符）。
//
// 【为什么存在】src/08-assemble.js 的事故：把 `b.preen` 误写成 `b.peen`，`undefined*13` 产 NaN，
// 被 `p.yaw = b.yaw + (b.yawOff || 0)` 的 `||0` 静默吃掉 —— 53 道门禁全绿，只有那个动作消失。
// `node --check` 只查语法，对"标识符查无此人"完全瞎。本配置把 ESLint 的 no-undef
// 作为一层真正的作用域分析接进 npm run check（probe/check.mjs 以编程方式调用本配置）。
//
// 【如实声明这层门禁的边界】no-undef 只判"裸标识符是否声明过"：
//   · 抓得住：裸用未定义变量（`peen = 1`）、忘 import 的模块导出名（页面加载即 ReferenceError）、
//     给未声明变量赋值（ESM 严格模式下运行期必炸）、读不存在的作用域名（`fooBarBaz123`）。
//   · 抓不住：**属性链上的拼写**（`b.peen` 是属性访问，no-undef 不管属性名存不存在）——
//     上述事故本体恰好属于这一类，它只能靠"对象自身属性名校验"另行解决，本配置不装能抓。
//   · 注意取舍：vendor.js 的名字（THREE、GTAOPass…）**故意不进白名单**——它们是
//     import 绑定而非环境全局；谁忘 import 谁就该红。把它们加进 globals 反而会
//     把"缺 import"这类真错掩成绿（import-audit ①② 已经吃过这类亏）。
//
// 【离线性】eslint 已装进 node_modules（devDependency，跑 `npm install --include=dev` 可复装；
// 本机 npm 配了 omit=dev，普通 `npm install` 会跳过 devDependencies —— check.mjs 缺它时会给红并提示）。
// 运行全程零网络：flat config 就地加载，规则解析全部本地。

/* 真正的运行环境：浏览器页面 + Service Worker。这些内建（Math、Promise、document…）
   不是 import 进来的，no-undef 不知道它们存在 ⇒ 必须白名单放行，否则全是假红。
   白名单只放"标准环境提供的名字"：多放一个项目名，就少抓一类"忘 import"的真错。 */
const makeGlobals = names => Object.fromEntries(names.map(n => [n, 'readonly']));

const ES_BUILTIN = [
  'Array', 'ArrayBuffer', 'Atomics', 'BigInt', 'BigInt64Array', 'BigUint64Array', 'Boolean',
  'DataView', 'Date', 'Error', 'EvalError', 'AggregateError', 'FinalizationRegistry', 'Function',
  'Infinity', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'Intl', 'JSON',
  'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'Proxy', 'RangeError', 'ReferenceError',
  'Reflect', 'RegExp', 'Set', 'SharedArrayBuffer', 'String', 'Symbol', 'SyntaxError', 'TypeError',
  'URIError', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'WeakMap', 'WeakRef',
  'WeakSet', 'WebAssembly',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape',
  'eval', 'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'queueMicrotask',
  'structuredClone', 'undefined', 'arguments',
];

const BROWSER_PAGE = [
  'window', 'document', 'self', 'location', 'navigator', 'history', 'screen', 'console',
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'performance', 'localStorage', 'sessionStorage', 'matchMedia', 'getComputedStyle',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio',
  'screenX', 'screenY', 'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset',
  'URL', 'URLSearchParams', 'Image', 'Audio', 'Video', 'MediaSource',
  'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
  'AbortController', 'AbortSignal', 'ReadableStream', 'WritableStream', 'TransformStream',
  'Event', 'CustomEvent', 'EventTarget', 'Node', 'NodeList', 'Element', 'HTMLElement',
  'HTMLCanvasElement', 'HTMLImageElement', 'HTMLVideoElement', 'HTMLAudioElement',
  'CanvasRenderingContext2D', 'WebGLRenderingContext', 'WebGL2RenderingContext',
  'OffscreenCanvas', 'ImageBitmap', 'createImageBitmap', 'TextEncoder', 'TextDecoder',
  'MessageChannel', 'MessagePort', 'Worker', 'SharedWorker',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
  'DOMMatrix', 'DOMPoint', 'DOMRect', 'Path2D', 'crypto', 'Notification', 'IdleDeadline',
];

/* SW（classic script）专属：页面代码用不到，单独一组，避免把页面白名单越放越宽 */
const SW_ONLY = ['caches', 'clients', 'registration', 'importScripts', 'skipWaiting'];

export default [
  {
    /* 手动跑 `npx eslint .` 全仓扫时，别把门禁范围外的东西拖进来（v10 会按扩展名
       把没命中任何 files 的 .js/.mjs 也 parse 一遍 —— _attic 归档、outputs 产物、
       probe 工具链、vendor.js 压缩包会被拖进来产 parsing 噪声）。
       check.mjs 走 lintFiles/lintText 的**显式路径**，不依赖这条。 */
    name: 'suzhou-garden/no-undef (out of scope)',
    ignores: [
      'node_modules/**', 'vendor.js', 'probe/**', 'outputs/**', 'docs/**', '_attic/**',
      'icons/**', 'assets/**', '.workbuddy/**', '.workbuddy-ai/**', '.codely/**', '.codely-cli/**',
      '.git/**', '_attic/**',
    ],
  },
  {
    /* 应用代码（ESM）：src 模块 + 打包入口 + index.html 内联主模块。
       内联主模块是 check.mjs 用 lintText 以虚拟文件名 index-inline.mjs 喂进来的，
       磁盘上不存在 —— 手动跑 `npx eslint .` 时自然只会扫到磁盘文件。 */
    name: 'suzhou-garden/no-undef (app, ESM)',
    files: ['src/**/*.js', 'build-entry.js', 'index-inline.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: makeGlobals([...ES_BUILTIN, ...BROWSER_PAGE]),
    },
    rules: { 'no-undef': 'error' },
  },
  {
    /* Service Worker：classic script（不是 module），运行环境是 worker 作用域 */
    name: 'suzhou-garden/no-undef (service worker, classic)',
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: makeGlobals([...ES_BUILTIN, ...BROWSER_PAGE, ...SW_ONLY]),
    },
    rules: { 'no-undef': 'error' },
  },
];
