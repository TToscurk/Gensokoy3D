// 地圖系統 —— 小地圖（HUD 圓盤）+ 大地圖（M 鍵全屏）。
//
// 分圖版（2026-07-28 重寫）：
//   小地圖：底圖是「現行地圖」的俯視烘焙（局部座標、自己的 heightAt），
//           切圖時由 main.js 呼叫 onMapChanged() 重烘。legacy_open 才用
//           舊的整張世界烘焙（2400²，第一次進去才烘，開機不浪費）。
//   大地圖：不再是俯視底圖（分圖上沒有單一座標系），改成**連線圖** ——
//           18 張圖是節點（按地區世界座標布局，地理感保留），portal 是
//           連線。點節點＝傳送到那張圖的預設入口（走 manager.load）。
//           異界三張（白玉樓／天界／彼岸）標紫點、用 gate 過場。
//           legacy_open 縮在左下角當「時光機」節點。
//
// 任務金點：questMarkers() 現在帶 mapId —— 大地圖把金點放在目標所在的
//           節點上；小地圖只顯示「就在這張圖」的目標（legacy_open 全顯示）。
//
// 座標：世界與局部都是 +X=東 / +Z=南；canvas 上=北(-Z)、右=東(+X)。

import { WORLD, REGIONS, REGION_BY_ID, CRATER_LAKE } from '../config.js';
import { terrainHeight } from '../world/terrain.js';
import { MAP_IDS, linkTable } from '../scene/registry.js';

const HALF = WORLD.size / 2;          // 1200，世界邊界 ±HALF
const BAKE_N = 448;                   // legacy_open 世界底圖解析度
const LOCAL_N = 224;                  // 分圖小地圖底圖解析度
const MINI_RANGE = 130;               // 小地圖半徑涵蓋的距離（m）
const GATE_MAPS = ['netherworld', 'tenkai', 'higan'];   // 結界之外（紫點）

// 高度 → 陸地色階（低地綠 → 高地岩灰 → 積雪白）
const RAMP = [
  [0.00, 0x3e5a36], [0.22, 0x66763f], [0.45, 0x8a7a58],
  [0.68, 0x7d7f84], [0.88, 0xb9c0c6], [1.00, 0xeef2f4],
];
const WATER_DEEP = [0x14, 0x2e, 0x46], WATER_SHAL = [0x4a, 0x86, 0xa8];

function lerp(a, b, t) { return a + (b - a) * t; }

function landColor(t) {
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const k = (t - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0]);
      const a = RAMP[i - 1][1], b = RAMP[i][1];
      return [lerp(a >> 16, b >> 16, k), lerp(a >> 8 & 255, b >> 8 & 255, k), lerp(a & 255, b & 255, k)];
    }
  }
  const b = RAMP[RAMP.length - 1][1];
  return [b >> 16, b >> 8 & 255, b & 255];
}

// 不是 REGIONS 地區的圖（參道是神社的延伸，沒有自己的地區圓）：
// 節點位置用它在分圖裡的世界原點，標籤另給。
const NO_REGION = {
  sando: { x: REGION_BY_ID.shrine.x, z: REGION_BY_ID.shrine.z - 475, zh: '參道' },
};

export class MapView {
  /** deps: { player, npcs, manager, questMarkers: () => [{x,z,mapId,main,label}],
   *          onWarp: (region) => void, onWarpMap: (mapId) => void } */
  constructor({ player, npcs, manager, questMarkers, onWarp, onWarpMap }) {
    this.player = player;
    this.npcs = npcs;
    this.manager = manager;
    this.questMarkers = questMarkers;
    this.onWarp = onWarp;
    this.onWarpMap = onWarpMap;

    this.open = false;
    this._qCache = [];
    this._qTimer = 0;
    this.base = null;            // 現行小地圖底圖 { cv, minX, minZ, w, h }
    this._legacyBase = null;     // legacy_open 的世界烘焙（lazy）
    this._links = null;          // 連線表（lazy）
    this._nodeEls = new Map();   // mapId → 大地圖按鈕

    this.mini = document.getElementById('minimap');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.mini.width = this.mini.height = Math.round(176 * dpr);
    this._mctx = this.mini.getContext('2d');

    this.bigCanvas = document.getElementById('bigmapCanvas');
    this._bctx = this.bigCanvas.getContext('2d');
    this._buildBigDom();
    linkTable().then(t => { this._links = t; if (this.open) this._drawBig(); });
    // 建構時地圖已載好（boot 先 load 再建 UI），補烘第一張小地圖底圖
    this.onMapChanged();
  }

  // ------------------------------------------------------------------ 小地圖底圖
  /** 切圖後由 main.js 呼叫：重烘現行地圖的小地圖底圖。 */
  onMapChanged() {
    const mgr = this.manager;
    if (!mgr?.map) return;
    if (mgr.id === 'legacy_open') {
      if (!this._legacyBase) this._legacyBase = this._bakeWorld();
      this.base = this._legacyBase;
    } else {
      this.base = this._bakeLocal(mgr.map, mgr.mod?.meta || {});
    }
  }

  _bakeWorld() {
    const t0 = performance.now();
    const N = BAKE_N, step = WORLD.size / N;
    const H = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) {
      const z = -HALF + j * step;
      for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = terrainHeight(-HALF + i * step, z);
    }
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const img = cv.getContext('2d').createImageData(N, N);
    const px = img.data;
    for (let j = 0; j < N; j++) {
      const z = -HALF + (j + 0.5) * step;
      for (let i = 0; i < N; i++) {
        const x = -HALF + (i + 0.5) * step;
        const h = H[j * (N + 1) + i];
        const [r, g, b] = this._shade(x, z, h, H, N, i, j, step,
          CRATER_LAKE.x, CRATER_LAKE.z, REGIONS);
        const o = (j * N + i) * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
    cv.getContext('2d').putImageData(img, 0, 0);
    console.info(`[map] legacy 世界底圖 ${N}×${N}，耗時 ${(performance.now() - t0).toFixed(0)}ms`);
    return { cv, minX: -HALF, minZ: -HALF, w: WORLD.size, h: WORLD.size };
  }

  _bakeLocal(map, meta) {
    const t0 = performance.now();
    const w = meta.sizeX || meta.size || 400, h = meta.sizeZ || meta.size || 400;
    const N = LOCAL_N, M = Math.max(16, Math.round(N * h / w));
    const minX = -w / 2, minZ = -h / 2;
    const stepX = w / N, stepZ = h / M;
    // 高度格（陰影共用）
    const H = new Float32Array((N + 1) * (M + 1));
    for (let j = 0; j <= M; j++) {
      for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = map.heightAt(minX + i * stepX, minZ + j * stepZ);
    }
    // 火口湖的世界座標換成這張圖的局部座標（只有守矢會落在圈內）
    const ox = map.origin?.x ?? 0, oz = map.origin?.z ?? 0;
    const clx = CRATER_LAKE.x - ox, clz = CRATER_LAKE.z - oz;
    const accent = meta.accent != null ? [{ x: 0, z: 0, radius: Math.max(w, h), accent: meta.accent }] : null;

    const cv = document.createElement('canvas');
    cv.width = N; cv.height = M;
    const img = cv.getContext('2d').createImageData(N, M);
    const px = img.data;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const x = minX + (i + 0.5) * stepX, z = minZ + (j + 0.5) * stepZ;
        const hh = H[j * (N + 1) + i];
        const [r, g, b] = this._shade(x, z, hh, H, N, i, j, stepX, clx, clz, accent, M);
        const o = (j * N + i) * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
    cv.getContext('2d').putImageData(img, 0, 0);
    console.info(`[map] ${meta.id || '?'} 小地圖底圖 ${N}×${M}，耗時 ${(performance.now() - t0).toFixed(0)}ms`);
    return { cv, minX, minZ, w, h };
  }

  /** 共用上色：水（含火口湖）/ 陸地色階 + 坡向陰影 + 地區薄染。 */
  _shade(x, z, h, H, N, i, j, step, craterX, craterZ, tints, M = N) {
    let r, g, b;
    const dCrater = Math.hypot(x - craterX, z - craterZ);
    if (dCrater < CRATER_LAKE.r) {
      r = 0x6f; g = 0xb7; b = 0xd9;
    } else if (h < WORLD.waterLevel + 0.4) {
      const d = Math.min(1, (WORLD.waterLevel + 0.4 - h) / 14);
      r = lerp(WATER_SHAL[0], WATER_DEEP[0], d);
      g = lerp(WATER_SHAL[1], WATER_DEEP[1], d);
      b = lerp(WATER_SHAL[2], WATER_DEEP[2], d);
    } else {
      [r, g, b] = landColor(Math.min(1, Math.max(0, h / 360)));
      const hx = H[j * (N + 1) + Math.max(0, i - 1)] - H[j * (N + 1) + Math.min(N, i + 1)];
      const hz = H[Math.max(0, j - 1) * (N + 1) + i] - H[Math.min(M, j + 1) * (N + 1) + i];
      const sh = 1 + Math.max(-0.3, Math.min(0.3, (hx + hz) * 0.045));
      r *= sh; g *= sh; b *= sh;
      if (tints) {
        for (const reg of tints) {
          const dx = x - reg.x, dz = z - reg.z;
          if (dx * dx + dz * dz < reg.radius * reg.radius) {
            r = lerp(r, reg.accent >> 16 & 255, 0.14);
            g = lerp(g, reg.accent >> 8 & 255, 0.14);
            b = lerp(b, reg.accent & 255, 0.14);
          }
        }
      }
    }
    return [r, g, b];
  }

  // ------------------------------------------------------------------ 大地圖 DOM（連線圖）
  _nodePct(mapId) {
    if (mapId === 'legacy_open') return { left: 8, top: 91 };
    const r = REGION_BY_ID[mapId];
    if (r) return { left: (r.x + HALF) / WORLD.size * 100, top: (r.z + HALF) / WORLD.size * 100 };
    const fb = NO_REGION[mapId];
    return fb ? { left: (fb.x + HALF) / WORLD.size * 100, top: (fb.z + HALF) / WORLD.size * 100 } : null;
  }

  _buildBigDom() {
    const wrap = document.getElementById('bigmap');
    const labels = wrap.querySelector('.labels');
    labels.innerHTML = '';
    this._nodeEls.clear();

    for (const id of MAP_IDS) {
      const pct = this._nodePct(id);
      if (!pct) continue;
      const isLegacy = id === 'legacy_open';
      const mod = isLegacy ? { zh: '舊世界', en: 'LEGACY' }
        : { zh: REGION_BY_ID[id]?.zh || NO_REGION[id]?.zh || id, remote: GATE_MAPS.includes(id) };
      const el = document.createElement('button');
      el.className = 'lm' + (GATE_MAPS.includes(id) ? ' remote' : '') + (isLegacy ? ' legacy' : '');
      el.style.left = pct.left + '%';
      el.style.top = pct.top + '%';
      el.innerHTML = `<i></i><span>${mod.zh}${GATE_MAPS.includes(id) ? '<em>結界之外</em>' : ''}${isLegacy ? '<em>時光機</em>' : ''}</span>`;
      el.onclick = () => {
        if (this.manager.id === id) return;
        this.close();
        this.onWarpMap(id);
      };
      labels.appendChild(el);
      this._nodeEls.set(id, el);
    }

    // 玩家標記（放在現行地圖的節點上）
    this._bigPlayer = document.createElement('div');
    this._bigPlayer.className = 'me';
    labels.appendChild(this._bigPlayer);
    // 任務目標層
    this._bigQuests = document.createElement('div');
    this._bigQuests.className = 'quests';
    labels.appendChild(this._bigQuests);
  }

  toggle(force) {
    const want = force !== undefined ? force : !this.open;
    if (want === this.open) return;
    this.open = want;
    document.getElementById('bigmap').classList.toggle('on', want);
    this.player.enabled = !want;
    if (want) {
      document.exitPointerLock?.();
      this._drawBig();
    }
  }

  close() { this.toggle(false); }

  _drawBig() {
    const wrap = document.getElementById('bigmap');
    const box = wrap.querySelector('.inner');
    const S = Math.floor(Math.min(box.clientWidth, box.clientHeight));
    if (this.bigCanvas.width !== S) this.bigCanvas.width = this.bigCanvas.height = S;
    const ctx = this._bctx;
    ctx.clearRect(0, 0, S, S);

    // 底：深色和紙
    ctx.fillStyle = '#12101a';
    ctx.fillRect(0, 0, S, S);

    // 連線（portal 邊，去重：A→B 與 B→A 只畫一次）
    ctx.strokeStyle = 'rgba(217,178,106,.28)';
    ctx.lineWidth = Math.max(1, S * 0.0016);
    if (this._links) {
      const seen = new Set();
      for (const [from, tos] of Object.entries(this._links)) {
        const a = this._nodePct(from);
        if (!a) continue;
        for (const to of tos) {
          const key = [from, to].sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          const b = this._nodePct(to);
          if (!b) continue;
          ctx.beginPath();
          ctx.moveTo(a.left / 100 * S, a.top / 100 * S);
          ctx.lineTo(b.left / 100 * S, b.top / 100 * S);
          ctx.stroke();
        }
      }
    }

    // 現行地圖節點高亮 + 玩家標記跟到節點上
    const cur = this.manager.id;
    for (const [id, el] of this._nodeEls) el.classList.toggle('here', id === cur);
    const cp = this._nodePct(cur);
    if (cp) {
      this._bigPlayer.style.left = cp.left + '%';
      this._bigPlayer.style.top = cp.top + '%';
    }

    // 任務金點：放在目標所在的節點
    this._bigQuests.innerHTML = '';
    for (const q of this.questMarkers()) {
      const pct = q.mapId ? this._nodePct(q.mapId)
        : { left: (q.x + HALF) / WORLD.size * 100, top: (q.z + HALF) / WORLD.size * 100 };
      if (!pct) continue;
      const el = document.createElement('div');
      el.className = 'qm' + (q.main ? ' main' : '');
      el.style.left = pct.left + '%';
      el.style.top = pct.top + '%';
      el.title = q.label;
      this._bigQuests.appendChild(el);
    }
  }

  // ------------------------------------------------------------------ 每幀（主迴圈呼叫）
  frame(dt) {
    this._qTimer -= dt;
    if (this._qTimer <= 0) {
      this._qTimer = 1;
      this._qCache = this.questMarkers();
      if (this.open) this._drawBig();
    }
    this._drawMini();
  }

  _drawMini() {
    const ctx = this._mctx;
    const S = this.mini.width, R = S / 2;
    const P = this.player.pos;
    const k = S / (MINI_RANGE * 2);
    const toMap = (x, z) => [(x - P.x) * k + R, (z - P.z) * k + R];

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.clip();

    // 底圖：以玩家為中心取 MINI_RANGE*2 見方（底圖是現行地圖的局部座標）
    const base = this.base;
    if (base) {
      const ppmX = base.cv.width / base.w, ppmZ = base.cv.height / base.h;
      const srcW = MINI_RANGE * 2 * ppmX, srcH = MINI_RANGE * 2 * ppmZ;
      const sx = (P.x - MINI_RANGE - base.minX) * ppmX;
      const sz = (P.z - MINI_RANGE - base.minZ) * ppmZ;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(base.cv, sx, sz, srcW, srcH, 0, 0, S, S);
    }

    // NPC 點
    for (const n of this.npcs.npcs) {
      const nx = n.root.position.x, nz = n.root.position.z;
      if (Math.abs(nx - P.x) > MINI_RANGE || Math.abs(nz - P.z) > MINI_RANGE) continue;
      const [u, v] = toMap(nx, nz);
      ctx.fillStyle = '#' + (n.spec.palette?.accent ?? 0xffffff).toString(16).padStart(6, '0');
      ctx.beginPath();
      ctx.arc(u, v, S * 0.016, 0, Math.PI * 2);
      ctx.fill();
    }

    // 任務金點（只顯示在這張圖的目標；legacy_open 全顯示。
    //  超出範圍的壓到邊緣，方向還是指得對）
    const curId = this.manager.id;
    ctx.fillStyle = '#ffd66a';
    for (const q of this._qCache) {
      if (curId !== 'legacy_open' && q.mapId && q.mapId !== curId) continue;
      let dx = q.x - P.x, dz = q.z - P.z;
      const d = Math.hypot(dx, dz);
      if (d > MINI_RANGE * 0.92) { dx *= MINI_RANGE * 0.92 / d; dz *= MINI_RANGE * 0.92 / d; }
      const [u, v] = toMap(P.x + dx, P.z + dz);
      ctx.save();
      ctx.translate(u, v);
      ctx.rotate(Math.PI / 4);
      const s = S * 0.02 * (q.main ? 1.35 : 1);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }

    // 玩家箭頭：朝相機前方（camYaw 的前 = (-sin, -cos)，地圖 y 軸向下=南，直接對應）
    const cy = this.player.camYaw;
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(Math.atan2(fz, fx) + Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = S * 0.006;
    const a = S * 0.045;
    ctx.beginPath();
    ctx.moveTo(0, -a);
    ctx.lineTo(a * 0.62, a * 0.8);
    ctx.lineTo(0, a * 0.38);
    ctx.lineTo(-a * 0.62, a * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
    // 外圈描邊
    ctx.strokeStyle = 'rgba(217,178,106,.55)';
    ctx.lineWidth = Math.max(1.5, S * 0.008);
    ctx.beginPath();
    ctx.arc(R, R, R - ctx.lineWidth, 0, Math.PI * 2);
    ctx.stroke();
  }
}
