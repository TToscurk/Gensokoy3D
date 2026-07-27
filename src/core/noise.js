// 確定性梯度雜訊 —— 地形高度與植被分佈共用同一份函式，
// 因此「畫出來的山」和「腳踩到的山」永遠一致。

const F = 4294967296;

function hashInt(ix, iy) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function hash2(ix, iy) {
  return hashInt(ix, iy) / F;
}

// 梯度查表。
// 原本每個角點都用 hash 算角度再取 cos/sin —— 一次 terrainHeight 會做將近
// 90 次三角函數，而地形高度是全專案呼叫最頻繁的函式（地形網格、植被落點、
// 玩家碰撞、相機、草地磚塊全都用它）。改成查表後成本降到原本的零頭。
const GN = 32;
const GRAD_X = new Float32Array(GN);
const GRAD_Y = new Float32Array(GN);
for (let i = 0; i < GN; i++) {
  const a = (i / GN) * Math.PI * 2;
  GRAD_X[i] = Math.cos(a);
  GRAD_Y[i] = Math.sin(a);
}

function grad(ix, iy, x, y) {
  const h = hashInt(ix, iy) & (GN - 1);
  return GRAD_X[h] * (x - ix) + GRAD_Y[h] * (y - iy);
}

const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** 梯度雜訊，回傳約 -1..1 */
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy);
  const n00 = grad(ix,     iy,     x, y);
  const n10 = grad(ix + 1, iy,     x, y);
  const n01 = grad(ix,     iy + 1, x, y);
  const n11 = grad(ix + 1, iy + 1, x, y);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.45;
}

/** 分形疊加雜訊 */
export function fbm(x, y, octaves = 4, lacunarity = 2.02, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** 山脊雜訊 —— 拿來做比較銳利的稜線 */
export function ridged(x, y, octaves = 4) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * freq, y * freq));
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return (sum / norm) * 2 - 1;
}

/** 可重現的偽隨機序列 —— 給植被 / 建築散佈用 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / F;
  };
}

export const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export { lerp };
