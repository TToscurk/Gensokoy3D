// 地圖系統 —— 小地圖（HUD 圓盤）+ 大地圖（M 鍵全屏、點地標傳送）。
//
// 底圖不是畫死的圖片：開局時把 terrainHeight 整張採過一遍烘焙成
// 俯視色圖（水色依深度、陸地依海拔漸層 + 坡向陰影 + 地區代表色薄染），
// 所以地圖跟實際走出來的世界永遠一致——改地形不用重畫地圖。
//
// 座標：世界 +X=東 / +Z=南；地圖 canvas 上=北(-Z)、右=東(+X)，直接對應不用轉。
//
// 小地圖：北向固定、玩家居中，箭頭跟相機朝向（camYaw）轉。
// 大地圖：整張幻想鄉，地標按鈕點了走 onWarp（main.js 的 warpTo，
//         結界之外自然帶黑幕過場），任務目標金點 1Hz 重繪。

import { WORLD, REGIONS, CRATER_LAKE } from '../config.js';
import { terrainHeight } from '../world/terrain.js';

const HALF = WORLD.size / 2;          // 1200，世界邊界 ±HALF
const BAKE_N = 448;                   // 底圖解析度（448²≈20 萬次高度採樣，開局一次性）
const MINI_RANGE = 130;               // 小地圖半徑涵蓋的世界距離（m）

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

export class MapView {
  /** deps: { player, npcs, questMarkers: () => [{x,z,main,label}], onWarp: (region) => void } */
  constructor({ player, npcs, questMarkers, onWarp }) {
    this.player = player;
    this.npcs = npcs;
    this.questMarkers = questMarkers;
    this.onWarp = onWarp;

    this.open = false;
    this._qCache = [];
    this._qTimer = 0;

    this._bake();

    this.mini = document.getElementById('minimap');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.mini.width = this.mini.height = Math.round(176 * dpr);
    this._mctx = this.mini.getContext('2d');

    this.bigCanvas = document.getElementById('bigmapCanvas');
    this._bctx = this.bigCanvas.getContext('2d');
    this._buildBigDom();
  }

  // ------------------------------------------------------------------ 底圖烘焙
  _bake() {
    const t0 = performance.now();
    const N = BAKE_N, step = WORLD.size / N;
    // 先採整張高度格（著色與坡向陰影共用，陰影不用再呼叫 terrainHeight）
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
        let r, g, b;

        const dCrater = Math.hypot(x - CRATER_LAKE.x, z - CRATER_LAKE.z);
        if (dCrater < CRATER_LAKE.r) {
          r = 0x6f; g = 0xb7; b = 0xd9;                       // 風神湖（高山湖，亮藍）
        } else if (h < WORLD.waterLevel + 0.4) {
          const d = Math.min(1, (WORLD.waterLevel + 0.4 - h) / 14);
          r = lerp(WATER_SHAL[0], WATER_DEEP[0], d);
          g = lerp(WATER_SHAL[1], WATER_DEEP[1], d);
          b = lerp(WATER_SHAL[2], WATER_DEEP[2], d);
        } else {
          [r, g, b] = landColor(Math.min(1, Math.max(0, h / 360)));
          // 坡向陰影：光從西北來，向東南的坡變暗，山體才讀得出立體感
          const hx = H[j * (N + 1) + Math.max(0, i - 1)] - H[j * (N + 1) + Math.min(N, i + 1)];
          const hz = H[Math.max(0, j - 1) * (N + 1) + i] - H[Math.min(N, j + 1) * (N + 1) + i];
          const sh = 1 + Math.max(-0.3, Math.min(0.3, (hx + hz) * 0.045));
          r *= sh; g *= sh; b *= sh;
          // 地區代表色薄染（最後圈到的那個地區生效，小的壓大的）
          for (const reg of REGIONS) {
            const dx = x - reg.x, dz = z - reg.z;
            if (dx * dx + dz * dz < reg.radius * reg.radius) {
              r = lerp(r, reg.accent >> 16 & 255, 0.14);
              g = lerp(g, reg.accent >> 8 & 255, 0.14);
              b = lerp(b, reg.accent & 255, 0.14);
            }
          }
        }
        const o = (j * N + i) * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
    cv.getContext('2d').putImageData(img, 0, 0);
    this.baked = cv;
    console.info(`[map] 底圖烘焙 ${N}×${N}，耗時 ${(performance.now() - t0).toFixed(0)}ms`);
  }

  // ------------------------------------------------------------------ 大地圖 DOM
  _buildBigDom() {
    const wrap = document.getElementById('bigmap');
    const labels = wrap.querySelector('.labels');
    // 地標按鈕 + 地區名標籤（全部地區都標名；有傳送點的才可點）
    for (const r of REGIONS) {
      const el = document.createElement('button');
      el.className = 'lm' + (r.remote ? ' remote' : '');
      el.style.left = ((r.x + HALF) / WORLD.size * 100) + '%';
      el.style.top = ((r.z + HALF) / WORLD.size * 100) + '%';
      el.innerHTML = `<i></i><span>${r.zh}${r.remote ? '<em>結界之外</em>' : ''}</span>`;
      el.onclick = () => { this.close(); this.onWarp(r); };
      labels.appendChild(el);
    }
    // 玩家標記
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
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.baked, 0, 0, S, S);

    // 玩家
    const P = this.player.pos;
    this._bigPlayer.style.left = ((P.x + HALF) / WORLD.size * 100) + '%';
    this._bigPlayer.style.top = ((P.z + HALF) / WORLD.size * 100) + '%';

    // 任務金點
    this._bigQuests.innerHTML = '';
    for (const q of this.questMarkers()) {
      const el = document.createElement('div');
      el.className = 'qm' + (q.main ? ' main' : '');
      el.style.left = ((q.x + HALF) / WORLD.size * 100) + '%';
      el.style.top = ((q.z + HALF) / WORLD.size * 100) + '%';
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
    // 世界→小地圖像素比例
    const k = S / (MINI_RANGE * 2);
    const toMap = (x, z) => [(x - P.x) * k + R, (z - P.z) * k + R];

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.clip();

    // 底圖：以玩家為中心取 MINI_RANGE*2 見方
    const src = MINI_RANGE * 2 / WORLD.size * BAKE_N;
    const sx = (P.x - MINI_RANGE + HALF) / WORLD.size * BAKE_N;
    const sz = (P.z - MINI_RANGE + HALF) / WORLD.size * BAKE_N;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.baked, sx, sz, src, src, 0, 0, S, S);

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

    // 任務金點（超出範圍的壓到邊緣，方向還是指得對）
    ctx.fillStyle = '#ffd66a';
    for (const q of this._qCache) {
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
