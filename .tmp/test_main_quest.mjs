// 主線第一章瀏覽器實測：快取禁用重載 → 清任務存檔 → 傳送到緣一身邊 →
// 真按 E 鍵對話 → 驗證 scene 進對話框、任務推進、日誌徽章，截圖留證。
import { cdp } from './cdp.mjs';

const TMP = 'C:/Users/B365/AppData/Local/Temp';
const page = await cdp();
const { send, evaljs, shot } = page;

// 1. 快取禁用 + 重載（拿最新 JS），順便清掉任務存檔從零開始
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await evaljs(`localStorage.removeItem('gensokyo-quests-v1'); undefined`);
await send('Page.reload', { ignoreCache: true });

// 等開機（結界已開）→ 選第一個角色進遊戲
let booted = false;
for (let i = 0; i < 60; i++) {
  booted = await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`);
  if (booted) break;
  await new Promise(r => setTimeout(r, 1000));
}
console.log('boot:', booted ? 'OK' : 'TIMEOUT');
if (!booted) { page.close(); process.exit(1); }
await evaljs(`document.querySelector('.card').click(); undefined`);
await new Promise(r => setTimeout(r, 4000));

const alive = await evaljs(`!!window.__gensokyo && window.__gensokyo.state.running`);
console.log('頁面存活:', alive);
if (!alive) { console.log('FAIL: 頁面沒起來'); page.close(); process.exit(1); }

// 2. 傳送到緣一身邊（village 中心 + roster offset [-52,-46]，再往旁邊站 2m）
const pos = await evaljs(`(async () => {
  const { REGION_BY_ID } = await import('./src/config.js');
  const v = REGION_BY_ID.village;
  const x = v.x - 52, z = v.z - 46;
  window.__gensokyo.player.teleport(x + 2, z + 2);
  return { x, z, px: window.__gensokyo.player.pos.x, pz: window.__gensokyo.player.pos.z };
})()`, true);
console.log('傳送:', JSON.stringify(pos));

// 3. 按 E —— 應開對話框並播主線開場 scene
// 傳送完必須先等幾幀：`npcs.nearest` 是在主迴圈的 update() 裡算的，
// 傳送當下還是舊值（出生點附近沒人），立刻按 E 會什麼都沒發生。
await new Promise(r => setTimeout(r, 700));
await evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); undefined`);
await new Promise(r => setTimeout(r, 800));
const talk1 = await evaljs(`({
  active: document.getElementById('talk').classList.contains('on'),
  who: document.querySelector('#talk .who .n').textContent,
  line: document.querySelector('#talk .line').textContent,
  quests: window.__gensokyo.quests.listActive(),
})`);
console.log('對話框:', JSON.stringify(talk1, null, 1));
await shot(TMP + '/main_ch1_open.png');

// 4. 把對話按完（連按 E），確認推進狀態與「scene 不重播」
for (let i = 0; i < 10; i++) {
  await evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); undefined`);
  await new Promise(r => setTimeout(r, 120));
}
const after = await evaljs(`({
  active: window.__gensokyo.quests.listActive(),
  seen: [...window.__gensokyo.quests.scenesSeen],
  saved: JSON.parse(localStorage.getItem('gensokyo-quests-v1') || '{}'),
})`);
console.log('按完對話後:', JSON.stringify(after, null, 1));

// 5. 打開任務日誌截圖（主線徽章）
await evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' })); undefined`);
await new Promise(r => setTimeout(r, 500));
await shot(TMP + '/main_ch1_questlog.png');

// 6. console 錯誤檢查
const errs = await evaljs(`(window.__errLog || []).slice(0, 5)`);
console.log('console 錯誤:', JSON.stringify(errs));

const pass = talk1.who === '繼國緣一'
  && after.active.some(q => q.id === 'main_ch1_nameless_blade')
  && after.seen.includes('main_ch1_nameless_blade:start:yoriichi')
  && (after.saved.active || {}).main_ch1_nameless_blade === 'start';
console.log(pass ? 'PASS 主線開場實機驗證通過' : 'FAIL 某環節沒過');

// 收尾：關對話、關日誌、還玩家控制權 —— test_interact.mjs 不重載頁面，
// 直接沿用這個 session，留著對話框會污染它的 E 鍵測試
await evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); undefined`);
await evaljs(`document.getElementById('questLog').classList.remove('on'); undefined`);
await evaljs(`window.__gensokyo.player.enabled = true; undefined`);

page.close();
process.exit(pass ? 0 : 1);
