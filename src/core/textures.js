import * as THREE from 'three';

// 貼圖雙軌制：
// 1. assets/textures/ 裡的 CC0 PBR 照片素材（Poly Haven）—— 優先使用
// 2. canvas 程序貼圖 —— 建構當下立刻可用，檔案載入後「熱替換」image，
//    檔案不存在（離線/精簡版）時就永遠停在程序版，畫面不會壞。

const cache = new Map();
const TEX_DIR = './assets/textures/';
const texLoader = new THREE.TextureLoader();

function make(key, w, h, draw) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set(key, t);
  return t;
}

function makeData(key, w, h, draw) {
  const t = make(key, w, h, draw);
  t.colorSpace = THREE.NoColorSpace;   // 法線 / 遮罩不做色彩轉換
  return t;
}

/** 單色貼圖：PBR 顏色備援用 */
export function solidColorTexture(css = '#888888') {
  return make(`solid-${css}`, 4, 4, (g, w, h) => {
    g.fillStyle = css;
    g.fillRect(0, 0, w, h);
  });
}

/** 草葉：中間濃、邊緣透明的一撮草，含 alpha */
export function grassBladeTexture() {
  return make('grass-blade', 128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = 14 + Math.random() * (w - 28);
      const bw = 5 + Math.random() * 7;
      const bh = h * (0.55 + Math.random() * 0.45);
      const bend = (Math.random() - 0.5) * 26;
      const hue = 78 + Math.random() * 30;
      const lit = 34 + Math.random() * 20;
      const grd = g.createLinearGradient(0, h, 0, h - bh);
      grd.addColorStop(0, `hsl(${hue},38%,${lit * 0.7}%)`);
      grd.addColorStop(1, `hsl(${hue + 12},50%,${lit + 20}%)`);
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x - bw / 2, h);
      g.quadraticCurveTo(x - bw / 2 + bend * 0.5, h - bh * 0.6, x + bend, h - bh);
      g.quadraticCurveTo(x + bw / 2 + bend * 0.5, h - bh * 0.6, x + bw / 2, h);
      g.closePath();
      g.fill();
    }
  });
}

/** 樹葉團塊的斑駁色調。
 *  必須是「不透明」的 —— 樹冠本身已經是實心多面體，
 *  貼圖若留下 alpha 鏤空，材質沒開 alphaTest 時那些像素會被當成黑色畫出來，
 *  整棵樹就變成一團黑影。 */
export function leafTexture(hueBase = 100, sat = 38) {
  return make(`leaf-${hueBase}-${sat}`, 128, 128, (g, w, h) => {
    g.fillStyle = `hsl(${hueBase},${sat}%,32%)`;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const r = 5 + Math.random() * 13;
      g.fillStyle = `hsla(${hueBase + (Math.random() - 0.5) * 30},${sat + Math.random() * 22}%,${22 + Math.random() * 26}%,${0.5 + Math.random() * 0.5})`;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.6 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** 木紋：樹幹 / 木造建築 */
export function barkTexture(dark = false) {
  return make(`bark-${dark}`, 128, 256, (g, w, h) => {
    const base = dark ? '#3a2c22' : '#5a4433';
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = 12 + Math.random() * 70;
      g.strokeStyle = `rgba(${dark ? 20 : 34},${dark ? 14 : 24},${dark ? 10 : 16},${0.12 + Math.random() * 0.3})`;
      g.lineWidth = 0.7 + Math.random() * 2.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 5, y + len);
      g.stroke();
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(255,240,220,${0.02 + Math.random() * 0.05})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 10 + Math.random() * 40);
    }
  });
}

/** 屋瓦 */
export function roofTileTexture(color = '#2f3b48') {
  return make(`roof-${color}`, 128, 128, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const rows = 8, cols = 8;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * (w / cols) + (r % 2 ? w / cols / 2 : 0);
        const y = r * (h / rows);
        const grd = g.createLinearGradient(x, y, x, y + h / rows);
        grd.addColorStop(0, 'rgba(255,255,255,.14)');
        grd.addColorStop(0.5, 'rgba(0,0,0,.05)');
        grd.addColorStop(1, 'rgba(0,0,0,.3)');
        g.fillStyle = grd;
        g.beginPath();
        g.roundRect(x + 1, y + 1, w / cols - 2, h / rows - 2, 5);
        g.fill();
      }
    }
  });
}

/** 石板 / 磚牆 */
export function stoneTexture(color = '#8a8178', jitter = 16) {
  return make(`stone-${color}-${jitter}`, 128, 128, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const cols = 4 + (r % 2);
      for (let c = 0; c < cols; c++) {
        const bw = w / cols, bh = h / rows;
        const x = c * bw + (r % 2 ? bw * 0.3 : 0);
        const y = r * bh;
        const d = (Math.random() - 0.5) * jitter;
        g.fillStyle = `rgb(${138 + d},${129 + d},${120 + d})`;
        g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.1})`;
        g.fillRect(x + 1.5, y + bh - 5, bw - 3, 3.5);
      }
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
}

/** 和紙 / 障子 */
export function shojiTexture() {
  return make('shoji', 128, 128, (g, w, h) => {
    g.fillStyle = '#e8e0cd';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(150,138,112,${Math.random() * 0.12})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    g.strokeStyle = '#6b5540';
    g.lineWidth = 4;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke();
    }
    g.lineWidth = 7;
    g.strokeRect(3.5, 3.5, w - 7, h - 7);
  });
}

/** 水面法線（動態擾動用） */
export function waterNormalTexture() {
  return makeData('water-normal', 256, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    const d = img.data;
    const hf = (x, y) => {
      let s = 0, a = 1, f = 0.045;
      for (let o = 0; o < 4; o++) {
        s += a * Math.sin(x * f + Math.cos(y * f * 1.3) * 2.4) *
                 Math.cos(y * f * 0.9 + Math.sin(x * f * 1.1) * 2.1);
        a *= 0.5; f *= 2.1;
      }
      return s;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = (hf(x + 1, y) - hf(x - 1, y)) * 0.5;
        const ny = (hf(x, y + 1) - hf(x, y - 1)) * 0.5;
        const len = Math.hypot(nx, ny, 1);
        const i = (y * w + x) * 4;
        d[i]     = ((-nx / len) * 0.5 + 0.5) * 255;
        d[i + 1] = ((-ny / len) * 0.5 + 0.5) * 255;
        d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** 圓形柔光點：花瓣、螢火、彈幕 */
export function glowTexture(inner = '#ffffff', outer = 'rgba(255,255,255,0)') {
  return make(`glow-${inner}`, 64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.35, inner);
    grd.addColorStop(1, outer);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}

/** 花瓣形狀 */
export function petalTexture() {
  return make('petal', 64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffd6e4';
    g.beginPath();
    g.moveTo(32, 58);
    g.bezierCurveTo(6, 44, 6, 16, 32, 6);
    g.bezierCurveTo(58, 16, 58, 44, 32, 58);
    g.fill();
    g.fillStyle = 'rgba(255,160,195,.55)';
    g.beginPath();
    g.moveTo(32, 58);
    g.bezierCurveTo(20, 44, 20, 20, 32, 8);
    g.bezierCurveTo(44, 20, 44, 44, 32, 58);
    g.fill();
  });
}

/** 小花：五瓣圓花，白色 —— 實際顏色用 instanceColor 染 */
export function flowerTexture() {
  return make('flower', 64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = 32, cy = 34;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, 10, 7, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(255,230,140,.95)';
    g.beginPath();
    g.arc(cx, cy, 7, 0, Math.PI * 2);
    g.fill();
    // 莖
    g.strokeStyle = 'rgba(90,140,70,.9)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, cy + 8);
    g.quadraticCurveTo(cx + 4, cy + 20, cx + 1, h);
    g.stroke();
  });
}

/** 雲：幾團疊加的柔邊橢圓，底部略平 */
export function cloudTexture() {
  return make('cloud', 256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const blobs = [
      [128, 78, 92, 34], [80, 82, 60, 26], [176, 82, 62, 27],
      [108, 62, 52, 26], [152, 60, 48, 24], [128, 52, 40, 22],
    ];
    for (const [x, y, rx, ry] of blobs) {
      const grd = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      grd.addColorStop(0, 'rgba(255,255,255,.85)');
      grd.addColorStop(0.65, 'rgba(255,255,255,.38)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.save();
      g.translate(x, y);
      g.scale(1, ry / rx);
      g.beginPath();
      g.arc(0, 0, rx, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  });
}

/** 霧：極淡的水平光帶，給低空霧片用 */
export function mistTexture() {
  return make('mist', 256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,.34)');
    grd.addColorStop(0.5, 'rgba(255,255,255,.16)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(1, 0.42);
    g.beginPath();
    g.arc(0, 0, w / 2, 0, Math.PI * 2);
    g.fill();
    g.restore();
  });
}

export function disposeTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

// ---------------------------------------------------------------------------
// 檔案貼圖 + 程序備援
// ---------------------------------------------------------------------------

/** 平面法線佔位圖：(128,128,255) = 無擾動，檔案載入前不會改變光照 */
export function flatNormalTexture() {
  return makeData('flat-normal', 4, 4, (g, w, h) => {
    g.fillStyle = 'rgb(128,128,255)';
    g.fillRect(0, 0, w, h);
  });
}

/** 等值灰階佔位圖：roughness / ao 等數值貼圖的備援 */
export function solidGrayTexture(level = 0.9) {
  return makeData(`gray-${level}`, 4, 4, (g, w, h) => {
    const v = Math.round(level * 255);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, 0, w, h);
  });
}

/**
 * 載入 assets/textures/<name>.jpg，載入前先用 fallback 貼圖頂著。
 * 熱替換：直接換掉同一個 Texture 物件的 image，所有引用它的材質自動生效。
 * @param name      不含副檔名的檔名
 * @param fallback  已建好的備援 Texture（canvas 版）
 * @param srgb      true=顏色貼圖 / false=數值貼圖（normal、rough）
 */
export function fileTexture(name, fallback, { srgb = true, aniso = 4 } = {}) {
  // 依檔名去重：同一張圖無論被幾個材質引用，GPU 裡只留一份
  const key = `file-${name}-${srgb ? 'c' : 'd'}`;
  if (cache.has(key)) return cache.get(key);
  const t = fallback;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;   // clone() 出來的佔位圖需要這面旗子才會上傳
  cache.set(key, t);
  texLoader.load(TEX_DIR + name + '.jpg',
    (loaded) => {
      t.image = loaded.image;
      t.needsUpdate = true;
      loaded.dispose();
    },
    undefined,
    () => { /* 檔案不在就停在程序備援，不算錯誤 */ });
  return t;
}

/**
 * 一整套 PBR：diff + nor_gl + rough。
 * @param name     assets/textures/ 裡的前綴（例如 'plaster' → plaster_diff.jpg ...）
 * @param fallback 顏色備援 Texture（程序版）
 * @param rough    檔案缺失時的固定粗糙度
 */
export function pbrSet(name, fallback, { rough = 0.9, aniso = 4 } = {}) {
  return {
    map: fileTexture(`${name}_diff`, fallback, { srgb: true, aniso }),
    normalMap: fileTexture(`${name}_nor_gl`, flatNormalTexture().clone(), { srgb: false, aniso }),
    roughnessMap: fileTexture(`${name}_rough`, solidGrayTexture(rough).clone(), { srgb: false, aniso: 1 }),
  };
}

/** 草葉圖集：左右兩種草叢（窄葉高草 / 寬葉矮叢），實例用 aVariant 挑邊 */
export function grassAtlasTexture() {
  return make('grass-atlas', 256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // 左半：原本的修長草葉
    for (let i = 0; i < 9; i++) {
      const x = 14 + Math.random() * (128 - 28);
      const bw = 5 + Math.random() * 7;
      const bh = h * (0.55 + Math.random() * 0.45);
      const bend = (Math.random() - 0.5) * 26;
      const hue = 78 + Math.random() * 30;
      const lit = 34 + Math.random() * 20;
      const grd = g.createLinearGradient(0, h, 0, h - bh);
      grd.addColorStop(0, `hsl(${hue},38%,${lit * 0.7}%)`);
      grd.addColorStop(1, `hsl(${hue + 12},50%,${lit + 20}%)`);
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x - bw / 2, h);
      g.quadraticCurveTo(x - bw / 2 + bend * 0.5, h - bh * 0.6, x + bend, h - bh);
      g.quadraticCurveTo(x + bw / 2 + bend * 0.5, h - bh * 0.6, x + bw / 2, h);
      g.closePath();
      g.fill();
    }
    // 右半：矮而密的寬葉叢（三葉草感）
    for (let i = 0; i < 16; i++) {
      const x = 128 + 10 + Math.random() * (128 - 20);
      const bw = 7 + Math.random() * 9;
      const bh = h * (0.3 + Math.random() * 0.4);
      const bend = (Math.random() - 0.5) * 34;
      const hue = 92 + Math.random() * 34;
      const lit = 30 + Math.random() * 18;
      const grd = g.createLinearGradient(0, h, 0, h - bh);
      grd.addColorStop(0, `hsl(${hue},34%,${lit * 0.7}%)`);
      grd.addColorStop(1, `hsl(${hue + 16},46%,${lit + 18}%)`);
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x - bw / 2, h);
      g.quadraticCurveTo(x - bw / 2 + bend * 0.4, h - bh * 0.55, x + bend, h - bh);
      g.quadraticCurveTo(x + bw / 2 + bend * 0.4, h - bh * 0.55, x + bw / 2, h);
      g.closePath();
      g.fill();
    }
  });
}
