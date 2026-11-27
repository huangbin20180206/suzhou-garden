// @guards: index.html, src/main.js, src/11-loop.js, src/11c-ux.js, src/12-env.js
// 对真实源码的小段做依赖注入；不复制被测算法，不加载 WebGL，错误分支可在毫秒内复验。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { decodeView } from '../src/00c-ux.js';
import { THREE, OrbitControls } from '../vendor.js';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const loop = fs.readFileSync(new URL('../src/11-loop.js', import.meta.url), 'utf8');
const ux = fs.readFileSync(new URL('../src/11c-ux.js', import.meta.url), 'utf8');
const env = fs.readFileSync(new URL('../src/12-env.js', import.meta.url), 'utf8');
function sourceFunction(source, name){
  const m = source.match(new RegExp('(?:export )?function ' + name + '[(][^]*?^}', 'm'));
  assert.ok(m, '应能定位真实函数：' + name);
  return m[0].replace(/^export /, '');
}
const guardTag = [...html.matchAll(new RegExp('<script>([^]*?)</script>', 'g'))].find(m => m[1].includes('window.__gardenBootFail'));
function bootFixture({ present = true, ready = false } = {}){
  assert.ok(guardTag, '需要先于 module 的独立启动兜底');
  const events = new Map(), timers = [];
  let card, retries = 0;
  const loading = { children:[{id:'ld-quick'},{className:'ld-text'}], style:{}, classList:{ remove(){} },
    replaceChildren(node){ card = node; this.children = [node]; },
    appendChild(node){ card = node; this.children.push(node); } };
  const document = {
    getElementById(id){ return id === 'loading' ? (present ? loading : null) : id === 'garden-boot-error' ? card || null : null; },
    createElement(){
      const detail = { textContent:'' }, button = { addEventListener(type, fn){ this.click = fn; } };
      return { style:{}, innerHTML:'', detail, button,
        querySelector(selector){ return selector === 'button' ? button : detail; } };
    },
  };
  const window = ready ? { __garden:{} } : {};
  const context = { window, document, location:{ reload(){ retries++; } },
    addEventListener(type, fn, capture){ events.set(type, { fn, capture }); },
    setTimeout(fn, ms){ timers.push({ fn, ms }); return timers.length; } };
  vm.runInNewContext(guardTag[1], context, { filename:'index-bootstrap.js' });
  return { window, loading, events, timers, get card(){ return card; }, get retries(){ return retries; } };
}
test('启动兜底在唯一 module 请求前安装，且自身不依赖模块', () => {
  assert.ok(guardTag);
  assert.ok(guardTag.index < html.indexOf('<script type="module" src="./src/main.js">'));
  assert.doesNotMatch(guardTag[1], /\bimport\s/);
});
test('依赖脚本加载失败走捕获阶段并显示重试', () => {
  const f = bootFixture();
  const e = f.events.get('error');
  assert.equal(e.capture, true);
  e.fn({ target:{ tagName:'SCRIPT' } });
  assert.match(f.card.detail.textContent, /模块加载失败/);
  f.card.button.click();
  assert.equal(f.retries, 1);
});
test('依赖求值异常按字面显示，且限制错误长度', () => {
  const f = bootFixture();
  const text = '<img src=x onerror=alert(1)>' + 'x'.repeat(400);
  f.events.get('error').fn({ target:f.window, message:text });
  assert.equal(f.card.detail.textContent, text.slice(0, 300));
  assert.ok(!f.card.innerHTML.includes('<img'));
});
test('普通图片失败不会覆盖营造进度', () => {
  const f = bootFixture();
  f.events.get('error').fn({ target:{ tagName:'IMG' } });
  assert.equal(f.card, undefined);
});
test('未处理异步启动异常和空 reason 均显示错误', () => {
  for (const reason of [new Error('dependency rejected'), null]){
    const f = bootFixture();
    f.events.get('unhandledrejection').fn({ reason });
    assert.equal(f.card.detail.textContent, reason?.message || '启动任务发生异常');
  }
});
test('首级超时只在尚未就绪时触发', () => {
  const f = bootFixture();
  assert.equal(f.timers[0].ms, 15000);
  f.timers[0].fn();
  assert.match(f.card.detail.textContent, /15 秒/);
  const ready = bootFixture({ ready:true });
  ready.timers[0].fn();
  ready.events.get('error').fn({ target:ready.window, message:'later error' });
  ready.events.get('unhandledrejection').fn({ reason:new Error('later rejection') });
  assert.equal(ready.card, undefined);
});
test('二级看门狗仍能主动报告失败；缺失加载层时正常返回', () => {
  const f = bootFixture({ ready:true });
  f.window.__gardenBootFail('warmup timeout');
  assert.equal(f.card.detail.textContent, 'warmup timeout');
  const missing = bootFixture({ present:false });
  assert.doesNotThrow(() => missing.window.__gardenBootFail('early error'));
});

test('先超时再恢复时，错误卡不以内联 opacity 覆盖开园淡出样式', () => {
  const f = bootFixture();
  f.timers[0].fn();
  assert.ok(f.card);
  assert.equal(f.loading.style.opacity || '', '');
  f.window.__garden = {};
  f.timers[0].fn();
  assert.equal(f.loading.style.opacity || '', '');
});

test('慢模块超时保留基础版入口和原进度节点', () => {
  const f = bootFixture(), original = f.loading.children.slice();
  f.timers[0].fn();
  assert.ok(f.card);
  assert.ok(original.every(node => f.loading.children.includes(node)), '提示不应销毁加载控件');
});

test('重复启动错误复用同一提示卡，不叠加卡片或重试入口', () => {
  const f = bootFixture();
  f.window.__gardenBootFail('first');
  const first = f.card;
  f.window.__gardenBootFail('second');
  assert.equal(f.card, first);
  assert.equal(f.card.detail.textContent, 'second');
  assert.equal(f.loading.children.filter(node => node.id === 'garden-boot-error').length,1);
});

test('看灯笼复用人工导览入口，无调试对象也能接管', () => {
  const m = main.match(/document\.getElementById\('see-lantern'\)\?\.addEventListener\('click', \(\) => \{[^]*?^\}\);/m);
  assert.ok(m, '产品按钮应在 main 中接线');
  let click;
  let visits = 0;
  const context = { document:{
    getElementById(){ return { addEventListener(type, fn){ click = fn; } }; },
    querySelector(selector){ assert.equal(selector, '#env [data-view="lantern"]'); return { click(){ visits++; } }; },
  } };
  vm.runInNewContext(m[0], context);
  click(); click();
  assert.equal(visits, 2);
  context.document.querySelector = () => null;
  assert.doesNotThrow(click);
});

for (const qos of [1, 0.94, 0.72]){
  test('resize 重算倍率并同步 renderer/composer，保留 QOS 倍率 ' + qos, () => {
    const calls = [];
    let ratio = 1;
    const s = { innerWidth:3840, innerHeight:2160,
      camera:{ aspect:0, updateProjectionMatrix(){ calls.push('projection'); } },
      AA:{ setStep(step){ assert.equal(step, 0); ratio = Math.sqrt(1920 * 1080 * 1.1 / (s.innerWidth * s.innerHeight)) * qos; } },
      renderer:{ setSize(w,h){ calls.push(['renderer', w, h, ratio]); } },
      composer:{ setSize(w,h){ calls.push(['composer', w, h, ratio]); } },
    };
    vm.runInNewContext(sourceFunction(loop, 'onResize') + '; onResize();', s);
    assert.equal(s.camera.aspect, 3840 / 2160);
    assert.equal(calls[0], 'projection');
    assert.ok(Math.abs(calls[1][3] - 0.5244044240850758 * qos) < 1e-10);
    assert.deepEqual(calls[1].slice(1), calls[2].slice(1));
    s.innerWidth = 640; s.innerHeight = 480;
    vm.runInNewContext('onResize();', s);
    assert.equal(calls[4][1], 640);
    assert.ok(calls[4][3] > calls[1][3]);
  });
}

function shareFixture(){
  const calls = [];
  let cam = [0, 4, 18], target = [0, 3, -12];
  const s = { decodeView, VIEW_OPTS:{ seasons:['spring','autumn','winter'], weathers:['clear','mist'] },
    ENV:{ hour:12.5, season:'spring', weather:'clear' }, REEL:{ on:true },
    toggleReel(){ s.REEL.on = !s.REEL.on; calls.push('reel-stop'); },
    stopSeasonDemo(){ calls.push('season-stop'); }, introCancel(){ calls.push('intro-stop'); },
    tourStop(){ calls.push('tour-stop'); }, cancelCamFly(){ calls.push('fly-stop'); },
    applyState(next){ calls.push('apply'); Object.assign(s.ENV, next); }, settleEnv(){ calls.push('settle'); },
    HOOKS:{ walkExit(){ calls.push('walk-exit'); } }, CAM_MIN_DIST:1.6,
    CAM_MIN_POLAR:Math.PI*0.055, CAM_MAX_POLAR:Math.PI*0.492,
    camera:{ position:{ fromArray(v){ cam = v; }, distanceTo(){ return Math.hypot(...cam.map((v,i) => v - target[i])); } } },
    controls:{ target:{ fromArray(v){ target = v; } }, update(){ calls.push('camera-update'); } },
    console:{ warn(){ calls.push('warning'); } },
  };
  vm.runInNewContext(sourceFunction(ux, 'applySharedView'), s);
  return { s, calls };
}
test('环境分享也先停全部旧自动模式，再应用目标状态', () => {
  const { s, calls } = shareFixture();
  assert.equal(s.applySharedView('#v=1&s=autumn&w=mist&h=17.25'), true);
  assert.equal(s.REEL.on, false);
  assert.equal(s.ENV.hour, 17.25);
  assert.equal(s.ENV.season, 'autumn');
  assert.deepEqual(calls, ['reel-stop','season-stop','intro-stop','tour-stop','fly-stop','apply','settle']);
});
test('机位分享在停止旧导演后退步行并落位', () => {
  const { s, calls } = shareFixture();
  assert.equal(s.applySharedView('#v=1&c=12,4,18&t=0,3,-12'), true);
  assert.ok(calls.indexOf('season-stop') < calls.indexOf('camera-update'));
  assert.ok(calls.includes('walk-exit'));
  assert.ok(s.controls.minDistance > 0);
});
test('坏分享链接不改变已有模式和环境', () => {
  const { s, calls } = shareFixture();
  for (const hash of ['#invalid', '#v=2&h=6', '#v=1&h=25']) assert.equal(s.applySharedView(hash), false);
  assert.equal(s.REEL.on, true);
  assert.equal(s.ENV.hour, 12.5);
  assert.deepEqual(calls, []);
});
test('流转原已关闭时不会被分享反向开启；恢复异常按失败返回', () => {
  const { s, calls } = shareFixture();
  s.REEL.on = false;
  s.applyState = () => { throw new Error('fixture failure'); };
  assert.equal(s.applySharedView('#v=1&h=6.5'), false);
  assert.equal(s.REEL.on, false);
  assert.ok(!calls.includes('reel-stop'));
  assert.ok(calls.includes('warning'));
});

function realShareFixture(){
  const camera=new THREE.PerspectiveCamera(46,1,0.1,900);camera.position.set(0,1.65,26);
  const controls=new OrbitControls(camera);controls.enableDamping=true;controls.dampingFactor=0.055;controls.minDistance=1.6;controls.maxDistance=170;controls.minPolarAngle=Math.PI*0.055;controls.maxPolarAngle=Math.PI*0.492;controls.target.set(0,3.5,-1);controls.update();
  const s={decodeView,VIEW_OPTS:{seasons:['spring','autumn','winter'],weathers:['clear','mist']},ENV:{hour:12.5,season:'spring',weather:'clear'},REEL:{on:false},toggleReel(){},stopSeasonDemo(){},introCancel(){},tourStop(){},cancelCamFly(){},applyState(){},settleEnv(){},HOOKS:{walkExit(){}},CAM_MIN_DIST:1.6,CAM_MIN_POLAR:Math.PI*0.055,CAM_MAX_POLAR:Math.PI*0.492,camera,controls,console:{warn(){}}};
  vm.runInNewContext(sourceFunction(ux,'applySharedView'),s);return {s,camera,controls};
}
function closeVec(actual,expected,tolerance=0.02){return actual.distanceTo(new THREE.Vector3(...expected))<=tolerance;}
test('真实 OrbitControls 往返恢复水平、仰视、俯视分享机位并保持 120 帧',()=>{
  for(const [label,hash] of [['水平','#v=1&c=0,1.65,26&t=0,1.65,24'],['仰视','#v=1&c=0,1.65,26&t=0,3.09,24.61'],['俯视','#v=1&c=0,1.65,26&t=0,0.30,24']]){
    const {s,camera,controls}=realShareFixture();assert.equal(s.applySharedView(hash),true,label);const v=decodeView(hash);assert.ok(closeVec(camera.position,v.cam),label+' position');
    const wanted=new THREE.Vector3(...v.tgt).sub(new THREE.Vector3(...v.cam)).normalize();assert.ok(camera.getWorldDirection(new THREE.Vector3()).angleTo(wanted)<Math.PI/360,label+' orientation');
    for(let i=0;i<120;i++)controls.update();assert.ok(closeVec(camera.position,v.cam),label+' stable position');assert.ok(closeVec(controls.target,v.tgt),label+' stable target');
  }
});
test('真实 OrbitControls 分享接管清除旧手势惯性',()=>{
  const {s,camera,controls}=realShareFixture();for(let i=0;i<5;i++)controls.rotateLeft(0.45);const hash='#v=1&c=12,4,18&t=0,3,-12',v=decodeView(hash);assert.equal(s.applySharedView(hash),true);
  assert.ok(closeVec(camera.position,v.cam),'接管当下机位精确落位');assert.ok(closeVec(controls.target,v.tgt),'接管当下注视点精确落位');for(let i=0;i<120;i++)controls.update();
  assert.ok(closeVec(camera.position,v.cam),'120 帧后旧旋转惯性已清');assert.ok(closeVec(controls.target,v.tgt),'120 帧后旧平移惯性已清');
});
function qosPointerFixture(){
  const globalEvents=new Map(),docEvents=new Map(),canvasEvents=new Map();
  const context={renderer:{domElement:{addEventListener(type,fn){canvasEvents.set(type,fn);}}},addEventListener(type,fn){globalEvents.set(type,fn);},document:{hidden:false,addEventListener(type,fn){docEvents.set(type,fn);}}};
  const start=loop.indexOf('const _pointerIds = new Set();'),end=loop.indexOf('const QOS =',start),visStart=loop.indexOf("document.addEventListener('visibilitychange',"),visEnd=loop.indexOf('});',visStart)+3;
  assert.ok(start>=0&&end>start&&visStart>=0&&visEnd>visStart,'定位实际指针锁存与隐藏页监听');
  const source=loop.slice(start,end)+'\nlet pageHidden=false;\n'+loop.slice(visStart,visEnd)+'\nglobalThis.peek=()=>_pointerDown;';vm.runInNewContext(source,context);
  return {context,globalEvents,docEvents,canvasEvents,isDown:()=>context.peek()};
}
test('QOS 隐藏页释放未结束的指针锁，无需 blur/up/cancel',()=>{
  const f=qosPointerFixture();f.canvasEvents.get('pointerdown')({pointerId:1});assert.equal(f.isDown(),true);f.context.document.hidden=true;f.docEvents.get('visibilitychange')();assert.equal(f.isDown(),false);
  f.context.document.hidden=false;f.docEvents.get('visibilitychange')();assert.equal(f.isDown(),false,'恢复后允许重新采样画质');
});
test('QOS 多指操作只在最后一根指针结束后解锁',()=>{
  const f=qosPointerFixture();f.canvasEvents.get('pointerdown')({pointerId:1});f.canvasEvents.get('pointerdown')({pointerId:2});f.globalEvents.get('pointerup')({pointerId:1});assert.equal(f.isDown(),true);f.globalEvents.get('pointerup')({pointerId:2});assert.equal(f.isDown(),false);
});
test('人工导览先取消开场镜头，再启动目标飞行', () => {
  const start = env.indexOf("  if (b.dataset.view){", env.indexOf("envEl.addEventListener('click'"));
  const endText = 'gotoViewpoint(b.dataset.view); showManualCaption(b.dataset.view); return;';
  const end = env.indexOf(endText, start);
  assert.ok(start >= 0 && end > start);
  const body = env.slice(start, end + endText.length) + ' }';
  const calls = [];
  const context = { b:{ dataset:{ view:'lantern' } },
    introCancel(){ calls.push('intro-stop'); },
    gotoViewpoint(id){ calls.push('view:' + id); }, showManualCaption(id){ calls.push('caption:' + id); } };
  vm.runInNewContext('(function(){' + body + '})();', context);
  assert.deepEqual(calls, ['intro-stop', 'view:lantern', 'caption:lantern']);
});

test('控制面板方印使用原生按钮语义并关联受控内容', () => {
  const toggle = html.match(/<(\w+)\b[^>]*class="drawer-toggle"[^>]*>/);
  assert.ok(toggle);
  assert.equal(toggle[1], 'button', '应支持原生 Tab、Enter 与 Space');
  assert.match(toggle[0], /type="button"/);
  assert.match(toggle[0], /aria-expanded="false"/);
  const target = toggle[0].match(/aria-controls="([^"]+)"/);
  assert.ok(target);
  assert.ok(html.includes('id="' + target[1] + '"'));
});

