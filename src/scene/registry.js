// 地圖清單與出入口連線表。
//
// 地圖模組一律用動態 import 延遲載入 —— 一張圖沒被走進去就不該進記憶體，
// 這也是分圖改造在手機上唯一有機會跑起來的前提。
export const MAP_LOADERS = {
  legacy_open: () => import('./maps/legacy_open.js'),
  shrine: () => import('./maps/shrine.js'),
  sando: () => import('./maps/sando.js'),
  village: () => import('./maps/village.js'),
  forest: () => import('./maps/forest.js'),
  lake: () => import('./maps/lake.js'),
  sdm: () => import('./maps/sdm.js'),
  bamboo: () => import('./maps/bamboo.js'),
  myouren: () => import('./maps/myouren.js'),
  kourindou: () => import('./maps/kourindou.js'),
  muenzuka: () => import('./maps/muenzuka.js'),
  sunflower: () => import('./maps/sunflower.js'),
  namelessHill: () => import('./maps/namelessHill.js'),
  youkaiMountain: () => import('./maps/youkaiMountain.js'),
  tenguVillage: () => import('./maps/tenguVillage.js'),
  moriya: () => import('./maps/moriya.js'),
  netherworld: () => import('./maps/netherworld.js'),
  tenkai: () => import('./maps/tenkai.js'),
  higan: () => import('./maps/higan.js'),
};

export const MAP_IDS = Object.keys(MAP_LOADERS);

export function hasMap(id) {
  return Object.prototype.hasOwnProperty.call(MAP_LOADERS, id);
}

/** 落點到「同圖回程觸發區」邊緣的最小建議餘裕（公尺）。
 *  低於這個值不算壞，但只要有人微調座標就會變成下一個妖怪之山。 */
export const MIN_ENTRY_MARGIN = 15;

const _cache = new Map();

/** 載入（並快取）一張地圖的模組。 */
export async function loadMapModule(id) {
  if (!hasMap(id)) throw new Error(`[registry] 沒有這張地圖：${id}`);
  if (!_cache.has(id)) _cache.set(id, await MAP_LOADERS[id]());
  return _cache.get(id);
}

/**
 * 連線完整性驗證：portal 必須成對、目標地圖存在、目標 entry 存在，
 * 而且**落點不能落在目標圖的觸發區裡**（幾何規則，見下方註解）。
 * 會把所有地圖模組載進來，只在開機時跑一次（或測試腳本手動呼叫）。
 * @returns { errors, warnings } —— errors 代表壞掉，warnings 代表偏薄
 */
export async function validateGraph() {
  const errs = [];
  const warns = [];
  const mods = {};
  for (const id of MAP_IDS) {
    try {
      mods[id] = await loadMapModule(id);
    } catch (err) {
      errs.push(`地圖 ${id} 載入失敗：${err.message}`);
    }
  }

  for (const id of Object.keys(mods)) {
    const m = mods[id];
    if (!m.meta) { errs.push(`地圖 ${id} 缺少 meta`); continue; }
    if (m.meta.id !== id) errs.push(`地圖 ${id} 的 meta.id 是「${m.meta.id}」，與註冊名不符`);
    if (typeof m.build !== 'function') errs.push(`地圖 ${id} 缺少 build()`);

    for (const p of m.portals || []) {
      const dst = mods[p.to];
      if (!dst) { errs.push(`${id} 的 portal「${p.id}」指向不存在的地圖 ${p.to}`); continue; }
      if (!(dst.entries || {})[p.entry]) {
        errs.push(`${id} 的 portal「${p.id}」指向 ${p.to} 不存在的入口 ${p.entry}`);
      }
      // 成對規則：A 有去 B 的，B 就要有回 A 的
      if (!(dst.portals || []).some(q => q.to === id)) {
        errs.push(`${id} → ${p.to} 是單向的，${p.to} 沒有回到 ${id} 的 portal`);
      }

      // 幾何規則：落點不能落在目標圖任何一個觸發區裡。
      //
      // 這一條是實戰打出來的。youkaiMountain 的 from_lake 落點距離
      // mountain_to_lake 的觸發區只有 8.9m（半徑 12），玩家從霧之湖走上山
      // 會被立刻送回湖邊 —— 妖怪之山用走的永遠到不了，連帶天狗聚落、
      // 守矢、天界整支都進不去。
      //
      // 而且**連線圖本身是對的**：配對完整、可達性算出來是 18/18。
      // 是幾何把它推翻的。所以這個檢查非做不可，光驗拓樸會漏。
      const e = (dst.entries || {})[p.entry];
      if (e) {
        for (const q of dst.portals || []) {
          if (!q.trigger) continue;
          const d = Math.hypot(e.x - q.trigger.x, e.z - q.trigger.z);
          if (d <= q.trigger.r) {
            errs.push(`${p.to} 的入口「${p.entry}」落在自己的觸發區「${q.id}」裡` +
              `（距離 ${d.toFixed(1)} ≤ 半徑 ${q.trigger.r}）—— 從 ${id} 過去會被立刻送走`);
          } else if (d - q.trigger.r < MIN_ENTRY_MARGIN) {
            // 沒壞，但薄。分成 warns 才不會讓「壞掉」跟「偏薄」混在一起 ——
            // 混在一起的下場是大家學會忽略整條訊息。
            warns.push(`${p.to} 的入口「${p.entry}」距觸發區「${q.id}」邊緣只有 ` +
              `${(d - q.trigger.r).toFixed(1)}m（建議 ≥ ${MIN_ENTRY_MARGIN}m）`);
          }
        }
      }
    }
  }
  return { errors: errs, warnings: warns };
}

/** 靜態出入口表（給地圖檢視、除錯用）：{ mapId: [目標 mapId] } */
export async function linkTable() {
  const table = {};
  for (const id of MAP_IDS) {
    const m = await loadMapModule(id);
    table[id] = (m.portals || []).map(p => p.to);
  }
  return table;
}
