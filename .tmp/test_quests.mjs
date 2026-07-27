// 純邏輯單元測試：直接跑 QuestManager，不經過瀏覽器，
// 徹底避開瀏覽器對已載入模組的快取問題。
import { QuestManager } from '../src/quests/manager.js';

// localStorage 在 Node 沒有，manager.js 的 _save/_load 用 try/catch 包著，
// 讓它自然拋錯被吞掉即可，不影響邏輯正確性。
global.localStorage = undefined;

function run(label, isNightVal) {
  console.log(`\n=== ${label} (isNight=${isNightVal}) ===`);
  const mgr = new QuestManager({ isNight: () => isNightVal });
  const toasts = [];
  mgr.onToast = (t, k) => toasts.push(`[${k}] ${t}`);

  const assertActive = (msg, expectObjectiveIncludes) => {
    const a = mgr.listActive().find(q => q.id === 'erased_records');
    const ok = a && a.objective.includes(expectObjectiveIncludes);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`, ok ? '' : JSON.stringify(a));
    if (!ok) process.exitCode = 1;
  };

  mgr.onTalk('keine');
  assertActive('對話慧音後，任務開始於 start 節點', '去人間之里找他談談');

  mgr.onTalk('yoriichi');
  assertActive('對話緣一後，純分支節點應該立刻解掉，不該卡在「決定接下來」',
    isNightVal ? '不如先回神社' : '去問問射命丸文');

  mgr.onTalk(isNightVal ? 'reimu' : 'aya');
  assertActive('對話分支目標後，進入 talked_reporter', '回去告訴慧音');

  mgr.onTalk('keine');
  const completed = mgr.listCompleted();
  const stillActive = mgr.listActive().some(q => q.id === 'erased_records');
  console.log(`${!stillActive && completed.includes('被抹去的記錄') ? 'PASS' : 'FAIL'} 回報慧音後任務完成`,
    JSON.stringify({ completed, stillActive }));
  if (stillActive || !completed.includes('被抹去的記錄')) process.exitCode = 1;

  console.log('toasts:', toasts);
}

run('白天分支', false);
run('夜晚分支', true);

// ---- 第二個任務：地區觸發（onEnter），非 NPC 觸發 ----
console.log('\n=== shrine_pilgrimage：onEnter 觸發 ===');
{
  const mgr = new QuestManager({ isNight: () => false });
  mgr.onTalk('reimu');
  let a = mgr.listActive().find(q => q.id === 'shrine_pilgrimage');
  console.log(a ? 'PASS 任務開始' : 'FAIL 任務未開始', a?.objective);
  if (!a) process.exitCode = 1;

  mgr.onEnter('shrine');
  mgr.onEnter('moriya');
  mgr.onEnter('myouren');
  a = mgr.listActive().find(q => q.id === 'shrine_pilgrimage');
  console.log(a?.objective.includes('回博麗神社跟靈夢報告') ? 'PASS 三間都巡過' : 'FAIL', a?.objective);
  if (!a?.objective.includes('回博麗神社跟靈夢報告')) process.exitCode = 1;

  mgr.onTalk('reimu');
  const done = mgr.listCompleted().includes('香油錢的巡禮');
  console.log(done ? 'PASS 任務完成' : 'FAIL', mgr.listCompleted());
  if (!done) process.exitCode = 1;
}

// ---- 邊界情況：跟不相關的 NPC 對話不該影響任務狀態 ----
console.log('\n=== 邊界情況：無關 NPC 不該推進任務 ===');
{
  const mgr = new QuestManager({ isNight: () => false });
  mgr.onTalk('keine');
  mgr.onTalk('marisa');   // 跟任務無關，不該推進 erased_records
  mgr.onTalk('cirno');
  const a = mgr.listActive().find(q => q.id === 'erased_records');
  const ok = a && a.objective.includes('去人間之里找他談談');
  console.log(ok ? 'PASS 無關對話不影響任務狀態' : 'FAIL', a?.objective);
  if (!ok) process.exitCode = 1;
}

console.log(process.exitCode ? '\n有測試失敗' : '\n全部通過');

// ===========================================================================
// 主線第一章：scene 整場對話、播過不重播、onEnter 推進、start.after 鏈接
// ===========================================================================
import { QUESTS } from '../src/quests/data.js';
console.log('\n=== main_ch1_nameless_blade：主線全流程 ===');
{
  // 假的第二章，用 start.after 掛在第一章後面，驗證鏈接啟動
  QUESTS.push({
    id: 'test_chain_ch2', title: '（測試用二章）', main: true,
    giver: 'yoriichi', start: { after: 'main_ch1_nameless_blade' },
    stages: { start: { objective: '鏈接成功' } },
  });

  const mgr = new QuestManager({ isNight: () => false });
  const toasts = [];
  mgr.onToast = (t, k) => toasts.push(`[${k}] ${t}`);

  const stage = () => mgr.listActive().find(q => q.id === 'main_ch1_nameless_blade');
  const check = (cond, msg, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`, extra);
    if (!cond) process.exitCode = 1;
  };

  let r = mgr.onTalk('yoriichi');
  check(Array.isArray(r.scene) && r.scene.length >= 5, '第一通對話：開場 scene 回傳', `(${r.scene?.length} 行)`);
  check(stage()?.objective.includes('博麗神社'), '任務開始於 start 節點');
  check(toasts.some(t => t.includes('主線開始')), 'toast 標示「主線開始」', toasts[0]);

  r = mgr.onTalk('yoriichi');
  check(r.scene === null, '同節點再講一次：scene 不重播');

  r = mgr.onTalk('reimu');
  check(Array.isArray(r.scene), '靈夢 scene 回傳');
  check(stage()?.objective.includes('八雲紫'), '推進到 asked_reimu');

  r = mgr.onTalk('yukari');
  check(Array.isArray(r.scene), '紫 scene 回傳');
  check(stage()?.objective.includes('紅魔館'), '推進到 asked_yukari');

  mgr.onEnter('sdm');
  check(stage()?.objective.includes('咲夜'), 'onEnter sdm 推進到 arrived_sdm');

  r = mgr.onTalk('sakuya');
  check(Array.isArray(r.scene), '咲夜 scene 回傳（進館第一通就播）');
  check(stage()?.objective.includes('帶回給緣一'), '推進到 asked_sakuya');

  r = mgr.onTalk('yoriichi');
  check(Array.isArray(r.scene) && r.scene.some(l => l.includes('這次不會')), '結尾 scene 回傳');
  check(mgr.isCompleted('main_ch1_nameless_blade'), '第一章完成');
  check(mgr.isActive('test_chain_ch2'), 'start.after 鏈接：二章自動開始');
  check(toasts.some(t => t.includes('主線開始：（測試用二章）')), '鏈接任務 toast 出現');

  console.log('toasts:', toasts);
  QUESTS.pop();   // 測試資料還原，避免影響其他測試檔
}

console.log(process.exitCode ? '\n主線測試有失敗' : '\n主線測試全部通過');
