// 更新階段的保險絲：更新爆炸時畫面不能全黑。
//   ① 正常時照樣有 draw call、HUD 有在更新
//   ② 更新階段丟例外 → 畫面仍持續繪製、#crash 告示出現、主控台不被洗版
//   ③ 例外排除後回復正常
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
await evaljs(`(() => {
  for (const c of document.querySelectorAll('.card')) if (c.textContent.includes('緣一')) { c.click(); return 1; }
})()`);
await wait(4000);

const healthy = await evaljs(`(() => {
  const g = window.__gensokyo;
  return { calls: g.renderer.info.render.calls, hud: document.getElementById('stats')?.textContent?.length || 0,
           crash: document.getElementById('crash').className };
})()`);
ck('正常狀態有在繪製、HUD 有內容',
  healthy.calls > 20 && healthy.hud > 0 && !healthy.crash.includes('on'), JSON.stringify(healthy));

// --- 故意讓更新階段爆炸 ---
await evaljs(`(() => {
  const g = window.__gensokyo;
  window.__realMobsUpdate = g.mobs.update.bind(g.mobs);
  g.mobs.update = () => { throw new Error('保險絲測試'); };
  window.__consoleErrs = 0;
  const ce = console.error;
  console.error = (...a) => { window.__consoleErrs++; ce.apply(console, a); };
  return 1;
})()`);
await wait(2000);

const broken = await evaljs(`(() => {
  const g = window.__gensokyo;
  const el = document.getElementById('crash');
  return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
           crashOn: el.className.includes('on'), msg: el.textContent.slice(0, 40),
           consoleErrs: window.__consoleErrs };
})()`);
ck('更新爆炸時畫面仍持續繪製', broken.calls > 20 && broken.tris > 1000,
  `${broken.calls} draw / ${broken.tris} 三角形`);
ck('畫面上有出現錯誤告示', broken.crashOn && broken.msg.includes('保險絲測試'), broken.msg);
ck('主控台沒有被每幀洗版', broken.consoleErrs > 0 && broken.consoleErrs <= 3,
  `印了 ${broken.consoleErrs} 次（約 120 幀）`);

// --- 排除例外後回復 ---
await evaljs(`(() => {
  const g = window.__gensokyo;
  g.mobs.update = window.__realMobsUpdate;
  window.__c0 = g.renderer.info.render.calls;
  return 1;
})()`);
await wait(1500);
const healed = await evaljs(`(() => {
  const g = window.__gensokyo;
  return { calls: g.renderer.info.render.calls, moving: g.state.t > 0,
           fps: Math.round(g.state.fps || 0) };
})()`);
ck('排除例外後回復正常', healed.calls > 20 && healed.fps >= 55, JSON.stringify(healed));

console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`);
page.close();
process.exit(fail ? 1 : 0);
