import { cdp } from './cdp.mjs';
const page = await cdp();
const wait = ms => new Promise(r => setTimeout(r, ms));
await page.send('Network.enable');
await page.send('Network.setCacheDisabled', { cacheDisabled: true });
await page.send('Page.reload', { ignoreCache: true });
await wait(3000);
for (let i = 0; i < 60; i++) { if (await page.evaljs(`!!document.querySelector('.card')`)) break; await wait(500); }
// 進遊戲前先裝錯誤捕捉（選角後會用到）
await page.evaljs(`(()=>{
  window.__errs = [];
  window.addEventListener('error', e => __errs.push('ERR: ' + e.message + ' @ ' + (e.filename||'') + ':' + (e.lineno||'')));
  window.addEventListener('unhandledrejection', e => __errs.push('REJ: ' + (e.reason && (e.reason.stack || e.reason.message || String(e.reason)))));
  const ce = console.error.bind(console);
  console.error = (...a) => { __errs.push('CE: ' + a.map(x => String(x && x.stack || x)).join(' ').slice(0,300)); ce(...a); };
})(); undefined`);
await page.evaljs(`document.querySelector('.card').click(); undefined`);
for (let i = 0; i < 90; i++) { if (await page.evaljs(`!!(window.__gensokyo && __gensokyo.player)`)) break; await wait(500); }
await wait(1500);
console.log('start map:', await page.evaljs(`__gensokyo.manager.id`));
await page.evaljs(`__gensokyo.manager.load('village', null, {style:'walk'}); undefined`);
await wait(4500);
console.log('after village:', await page.evaljs(`__gensokyo.manager.id`));
await page.evaljs(`__gensokyo.manager.load('shrine', null, {style:'walk'}); undefined`);
await wait(4500);
console.log('after shrine:', await page.evaljs(`__gensokyo.manager.id`));
console.log('errors:', await page.evaljs(`(window.__errs||[]).slice(0,12).join('\\n---\\n') || '(none)'`));
page.close(); process.exit(0);
