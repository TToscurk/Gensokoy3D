// dispose 紀律驗收（SCENE_MANAGER_SPEC §3 / §6）：
// 連續切換兩張圖 30 次，每 10 次記錄 renderer.info.memory 與 JS heap。
//
// 判定：geometries / textures 回到基準值 ±5 以內，heap 不單調成長。
// three.js 不會自動回收 GPU 資源 —— 這支測的就是「有沒有真的還回去」。
//
// 需要 headless Chrome 帶 --js-flags=--expose-gc 才量得準 heap；
// 沒有的話 heap 那項會標成 SKIP，geometries/textures 仍然照驗。
import { cdp } from './cdp.mjs';

const page = await cdp();
const { send, evaljs } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (n, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  ' + info : ''}`); };

await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 60; i++) {
  if (await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`)) break;
  await wait(1000);
}
await evaljs(`document.querySelector('.card').click(); undefined`);
await wait(3000);
await evaljs(`(() => { window.__e = []; window.addEventListener('error', e => window.__e.push(String(e.message))); return 1; })()`);

const sample = async () => {
  await send('HeapProfiler.collectGarbage').catch(() => {});
  return evaljs(`(() => {
    const m = window.__gensokyo.renderer.info.memory;
    return JSON.stringify({
      geo: m.geometries, tex: m.textures,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    });
  })()`).then(JSON.parse);
};

const load = async (id) => {
  await evaljs(`window.__gensokyo.manager.load('${id}', null, { style: 'walk' })`, true);
  await wait(700);
};

// 先切一輪暖機：第一次載入會建共用資源（貼圖、材質、圖集），
// 那些是刻意不釋放的，不先暖機會把它們算進「成長」。
await load('shrine');
await load('sando');
await load('shrine');
const base = await sample();
console.log('基準  ', JSON.stringify(base));

const marks = [];
for (let i = 1; i <= 30; i++) {
  await load(i % 2 ? 'sando' : 'shrine');
  if (i % 10 === 0) {
    const s = await sample();
    marks.push({ i, ...s });
    console.log(`第 ${String(i).padStart(2)} 次`, JSON.stringify(s));
  }
}

const last = marks[marks.length - 1];
ck('geometries 回到基準 ±5', Math.abs(last.geo - base.geo) <= 5,
   `基準 ${base.geo} → ${last.geo}`);
ck('textures 回到基準 ±5', Math.abs(last.tex - base.tex) <= 5,
   `基準 ${base.tex} → ${last.tex}`);

if (base.heapMB === null) {
  console.log('SKIP  heap 不單調成長（需要 performance.memory）');
} else {
  // 單調成長 = 每一次取樣都比前一次高。允許波動，但不允許一路只漲不跌。
  let monotonic = true;
  for (let i = 1; i < marks.length; i++) if (marks[i].heapMB <= marks[i - 1].heapMB) monotonic = false;
  const growth = last.heapMB - base.heapMB;
  ck('heap 不單調成長', !monotonic || growth < 24,
     `${base.heapMB}MB → ${last.heapMB}MB（+${growth.toFixed(1)}MB）`);
}

const errs = await evaljs(`window.__e.length`);
ck('30 次切換無 runtime 錯誤', errs === 0, `err=${errs}`);
ck('最後仍能正常繪製', await evaljs(`window.__gensokyo.renderer.info.render.calls`) > 0);

// 收尾：把遊戲留在 legacy_open。
// test_interact 不重載頁面（HANDOFF〈坑〉第 9 條），留在小圖上會害它整套假 FAIL。
await load('legacy_open');

console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`);
page.close();
process.exit(fail ? 1 : 0);
