// 地圖清單與出入口連線表。
//
// 地圖模組一律用動態 import 延遲載入 —— 一張圖沒被走進去就不該進記憶體，
// 這也是分圖改造在手機上唯一有機會跑起來的前提。
export const MAP_LOADERS = {
  legacy_open: () => import('./maps/legacy_open.js'),
};

export const MAP_IDS = Object.keys(MAP_LOADERS);

export function hasMap(id) {
  return Object.prototype.hasOwnProperty.call(MAP_LOADERS, id);
}

const _cache = new Map();

/** 載入（並快取）一張地圖的模組。 */
export async function loadMapModule(id) {
  if (!hasMap(id)) throw new Error(`[registry] 沒有這張地圖：${id}`);
  if (!_cache.has(id)) _cache.set(id, await MAP_LOADERS[id]());
  return _cache.get(id);
}

/**
 * 連線完整性驗證：portal 必須成對、目標地圖存在、目標 entry 存在。
 * 會把所有地圖模組載進來，只在開機時跑一次（或測試腳本手動呼叫）。
 * @returns 錯誤訊息陣列，空陣列代表全部通過
 */
export async function validateGraph() {
  const errs = [];
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
    }
  }
  return errs;
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
