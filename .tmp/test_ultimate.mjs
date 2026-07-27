// 大招（日之呼吸・全型）+ 2 倍速的驗證：
//   ① 動作長度＝ dur / 2（出招與動畫都快一倍）
//   ② 左鍵按住 2.5 秒觸發大招；不到 2.5 秒放開不會觸發
//   ③ 大招連放十三型、順序正確、中間沒有空檔
//   ④ 大招期間普通攻擊插不進來、不會自動納刀
//   ⑤ 蓄力讀條 0→1；放開歸零
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
await wait(3000);
await evaljs(`(() => {
  const g = window.__gensokyo;
  const m = g.mobs.mobs.find(m => m.state !== 2);
  g.player.teleport(m.pos.x + 2.4, m.pos.z + 2.4);
  g.player.camYaw = Math.atan2(-(m.pos.x - g.player.pos.x), -(m.pos.z - g.player.pos.z));
  window.__err = []; window.addEventListener('error', e => window.__err.push(String(e.message)));
  return 1;
})()`);

// --- ① 2 倍速 ---
await evaljs(`window.__gensokyo.combat.toggleSheath()`);
await wait(700);
const speed = await evaljs(`new Promise(res => {
  const g = window.__gensokyo, c = g.combat;
  const out = [];
  const tick = () => {
    if (!c.busy) {
      const f = c.tryAttack();
      if (f) out.push({ name: f.name, dur: f.dur, animDur: +c.animDur.toFixed(4) });
    }
    if (out.length >= 4) return res(out);
    requestAnimationFrame(tick);
  };
  tick();
})`, true);
const ratio = speed.map(s => +(s.dur / s.animDur).toFixed(2));
ck('動作長度＝ dur / 2', ratio.every(r => Math.abs(r - 2) < 0.01),
  ratio.map((r, i) => `${speed[i].dur}→${speed[i].animDur}`).join(' '));

// --- ② 不到 2.5 秒放開不觸發 ---
await wait(800);
const shortHold = await evaljs(`(async () => {
  const c = window.__gensokyo.combat;
  c.holdStart();
  await new Promise(r => setTimeout(r, 1200));
  const mid = +c.chargeRatio.toFixed(2);
  c.holdEnd();
  return { mid, after: c.chargeRatio, ult: c.ultimate };
})()`, true);
ck('按不到 2.5 秒不會觸發大招',
  shortHold.mid > 0.35 && shortHold.mid < 0.75 && shortHold.after === 0 && shortHold.ult === false,
  JSON.stringify(shortHold));

// --- ③④⑤ 按滿 2.5 秒 ---
const ult = await evaljs(`new Promise(res => {
  const g = window.__gensokyo, c = g.combat;
  const seen = [], ratios = [];
  let blocked = 0, started = false, sheathedDuring = false, gapFrames = 0;
  const banner = document.getElementById('formBanner');
  c.holdStart();
  const t0 = performance.now();
  const tick = () => {
    ratios.push(+c.chargeRatio.toFixed(2));
    if (c.ultimate) {
      started = true;
      if (c.tryAttack()) blocked = -999;      // 大招期間插得進普通攻擊 = 失敗
      else blocked++;
      if (!c.drawn) sheathedDuring = true;
      if (!c.busy) gapFrames++;
      const n = banner.textContent;
      if (n && seen[seen.length - 1] !== n) seen.push(n);
    } else if (started) {
      return res({ seen, blocked, sheathedDuring, gapFrames,
                   maxRatio: Math.max(...ratios),
                   secs: +((performance.now() - t0) / 1000).toFixed(2) });
    }
    requestAnimationFrame(tick);
  };
  tick();
})`, true);

// 蓄滿的那一幀就直接轉成大招、charging 歸零，所以輪詢抓不到剛好 1.00
ck('按住 2.5 秒觸發大招', ult.maxRatio >= 0.95 && ult.seen.length > 0,
  `蓄力峰值 ${ult.maxRatio}，蓄力+大招共 ${ult.secs}s`);
ck('大招連放十三型且順序正確',
  ult.seen.length === 14 && ult.seen[0] === '日之呼吸・全型' &&
  ult.seen[1] === '壹之型・圓舞' && ult.seen[13] === '拾參之型・輪廻',
  `${ult.seen.length} 段：${ult.seen.slice(0, 3).join('→')} … ${ult.seen[ult.seen.length - 1]}`);
ck('大招期間普通攻擊插不進來', ult.blocked > 0, `擋下 ${ult.blocked} 次`);
ck('大招期間不會自動納刀', ult.sheathedDuring === false);
ck('大招連段中間沒有空檔', ult.gapFrames <= 14, `空檔 ${ult.gapFrames} 幀（每段交接最多 1 幀）`);

const end = await evaljs(`(() => {
  const g = window.__gensokyo, c = g.combat;
  return { ult: c.ultimate, charging: c.charging, nextForm: g.combat.currentForm.name,
           charge: document.getElementById('charge').className,
           swings: c.stats.swings, hits: c.stats.hits, kills: c.stats.kills,
           fps: Math.round(g.state.fps || 0), err: (window.__err || []).length };
})()`);
ck('大招結束後狀態乾淨', end.ult === false && end.charging === false &&
  end.nextForm === '壹之型・圓舞' && !end.charge.includes('on'), JSON.stringify(end));
ck('無錯誤且 FPS ≥ 55', end.err === 0 && end.fps >= 55, `fps=${end.fps} err=${end.err}`);

console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`);
page.close();
process.exit(fail ? 1 : 0);
