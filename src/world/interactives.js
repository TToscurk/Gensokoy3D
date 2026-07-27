// 互動點註冊表：E 鍵可觸發的非 NPC 點（進入室內、搭乘索道……）。
// 純資料模組 —— 由 main.js 在世界建構完後從 structures.js 的
// INTERIORS / WARP_NODES 展開註冊。這裡不 import 建築模組，
// 避免 world 層的模組互相咬尾。
//
// 每筆互動點：
//   id     唯一識別（除錯用）
//   label  提示列文字（「進入守矢神社拜殿」「搭乘索道（往山上）」）
//   x, z   觸發位置；y 可選 —— 有給才做高度差判定
//   radius 觸發半徑（預設 2.6）
//   to     { x, z, y? } 傳送落點；y 沒給就貼地形
//   zh     過場畫面的目的地名
//   msg    過場畫面的進度文字
export const INTERACTIVES = [];

export function registerInteractive(it) {
  INTERACTIVES.push(it);
}

export function clearInteractives() {
  INTERACTIVES.length = 0;
}

// 找玩家附近最近的互動點。水平半徑之外再驗 Y 差：
// 只看水平距離的話，拜殿地板正下方、索道月台正下方也會亮提示，
// 站在樓下對空按 E 會直接穿牆上樓。
export function nearestInteractive(px, py, pz) {
  let best = null, bestD = Infinity;
  for (const it of INTERACTIVES) {
    const r = it.radius || 2.6;
    const dx = it.x - px, dz = it.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) continue;
    if (it.y !== undefined && Math.abs(it.y - py) > 3.5) continue;
    if (d2 < bestD) { bestD = d2; best = it; }
  }
  return best;
}
