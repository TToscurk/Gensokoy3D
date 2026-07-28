import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight } from './terrain.js';
import { addClearing, captureClearings } from './vegetation.js';
import { REGION_BY_ID, WORLD, RIVER, CRATER_LAKE } from '../config.js';
import { mulberry32 } from '../core/noise.js';
import {
  barkTexture, roofTileTexture, stoneTexture, shojiTexture, glowTexture,
  solidColorTexture, pbrSet,
} from '../core/textures.js';

// 室內空間共用：進入判定用的門洞資料（main.js 的載入過渡系統會讀這個陣列）
export const INTERIORS = [];

// 傳送節點：索道兩站這類「A 點互動 → 黑幕 → B 點」的配對資料（批次 3 接線）
export const WARP_NODES = [];

// 索道的動態參考：曲線與車廂。車廂每幀由 main.js 擺位，
// 所以車廂 Group 命名 'rope-cabin' 並列進 mergeStaticByMaterial 的 skip 名單 ——
// 漏了就會被烘進靜態合併網格，永遠凍結在起點。
export const ROPEWAY = { curve: null, cabins: [] };

// ---------------------------------------------------------------------------
// 材質庫
// ---------------------------------------------------------------------------
// 顏色貼圖全部走雙軌：assets/textures/ 的 CC0 PBR 照片優先，
// 檔案不在時退回程序 canvas —— 兩條路共用同一組材質物件。
const MAT = {};

/** 一套 PBR 貼圖設好 repeat 後回傳 */
function pbr(name, fallback, repeatX, repeatY, opts = {}) {
  const s = pbrSet(name, fallback, opts);
  for (const t of [s.map, s.normalMap, s.roughnessMap]) t.repeat.set(repeatX, repeatY);
  return s;
}

function initMats() {
  if (MAT.ready) return;
  const kawara  = pbr('roof_kawara', roofTileTexture('#2e3944'), 3, 2, { rough: 0.82 });
  const thatch  = pbr('roof_thatch', roofTileTexture('#6a5a38'), 2, 1, { rough: 0.95 });
  const stoneP  = pbr('stone_path', stoneTexture('#8a8178'), 2, 2, { rough: 0.95 });
  const stoneW  = pbr('stone_wall', stoneTexture('#7d766a'), 2, 2, { rough: 0.95 });
  const woodF   = pbr('wood_frame', barkTexture(false), 1, 2, { rough: 0.92 });
  const planks  = pbr('planks', barkTexture(false), 1, 1.6, { rough: 0.9 });
  const plaster = pbr('plaster', solidColorTexture('#e4dcc8'), 2, 1.4, { rough: 0.95 });
  const brick   = pbr('brick_red', solidColorTexture('#8e2230'), 2, 2, { rough: 0.86 });
  const cobble  = pbr('cobble', stoneTexture('#8a8178'), 3, 3, { rough: 0.95 });
  const deck    = pbr('deck', barkTexture(false), 2, 2, { rough: 0.85 });
  const tatami  = pbr('tatami', stoneTexture('#c3ad6e', 10), 3, 2, { rough: 0.88 });
  const velvet  = pbr('velvet_red', solidColorTexture('#4a0f18'), 2, 2, { rough: 0.92 });
  const mCheck  = pbr('marble_check', stoneTexture('#d8d0c2', 8), 3, 3, { rough: 0.28 });
  const mPlain  = pbr('marble_plain', stoneTexture('#c6bfae', 6), 2, 2, { rough: 0.32 });
  const dWood   = pbr('dark_wood', barkTexture(true), 1, 2, { rough: 0.55 });
  const grave   = pbr('grave_stone', stoneTexture('#726b5e', 14), 1.4, 1.4, { rough: 0.96 });

  const std = (p, extra = {}) => new THREE.MeshStandardMaterial({
    map: p.map, normalMap: p.normalMap, roughnessMap: p.roughnessMap,
    roughness: 1.0, metalness: 0.0, ...extra,
  });

  MAT.roof      = std(kawara, { side: THREE.DoubleSide, metalness: 0.05 });
  MAT.roofRed   = std(kawara, { color: 0xcf7a72, side: THREE.DoubleSide, metalness: 0.08 });
  MAT.roofThatch = std(thatch, { side: THREE.DoubleSide });
  // 深色瓦：同一組 kawara PBR 乘深色 tint（比照 roofRed），
  // 不再是純色 —— 純色在陽光下是一片死黑，瓦溝的陰影層次全無。
  MAT.roofBlack = std(kawara, { color: 0x2e3440, side: THREE.DoubleSide, metalness: 0.1 });
  MAT.vermilion = new THREE.MeshStandardMaterial({ color: 0xc2382f, roughness: 0.55, metalness: 0.02 });
  MAT.wood      = std(woodF);
  MAT.planks    = std(planks);
  MAT.woodDark  = new THREE.MeshStandardMaterial({ color: 0x4a382a, roughness: 0.9 });
  MAT.stone     = std(stoneP);
  MAT.stoneWall = std(stoneW);
  MAT.cobble    = std(cobble);
  MAT.deck      = std(deck);
  MAT.stoneDark = new THREE.MeshStandardMaterial({ color: 0x5d564e, roughness: 0.94 });
  MAT.plaster   = std(plaster);
  MAT.shoji     = new THREE.MeshStandardMaterial({ map: shojiTexture(), roughness: 0.9, side: THREE.DoubleSide });
  MAT.brickRed  = std(brick);
  // 紅魔館的深色線腳/簷口 —— 原本這裡乘了一層淺粉色(0xd88a84)去疊紅磚照片貼圖，
  // 亮色相乘的結果比照片本身更白更亮，是「紅魔館太亮」的主因之一。
  // 原作設定紅魔館是「窗戶很少的西洋要塞式建築」（仿惡魔城改建的宅邸），
  // 磚牆應該深、線腳應該是鐵鑄般的近黑色，不是粉色滾邊。
  MAT.brickRed2 = std(brick, { color: 0x5a2226 });        // 深磚：塔樓、簷口陰影面
  MAT.ironTrim  = new THREE.MeshStandardMaterial({ color: 0x18151c, roughness: 0.5, metalness: 0.35 });
  MAT.gold      = new THREE.MeshStandardMaterial({ color: 0xd9b26a, roughness: 0.34, metalness: 0.75 });
  // 白天是深色玻璃（要塞感），夜裡才透出暖光 —— 由 main.js 依 nightFactor 調整 emissive
  MAT.glassWarm = new THREE.MeshStandardMaterial({
    color: 0x241c30, emissive: 0xffb95e, emissiveIntensity: 0.1, roughness: 0.22, metalness: 0.1,
  });
  MAT.paperLamp = new THREE.MeshStandardMaterial({
    color: 0xffe6bd, emissive: 0xffb060, emissiveIntensity: 0.9, roughness: 0.85,
  });
  MAT.clothRed  = new THREE.MeshStandardMaterial({ color: 0xb8443c, roughness: 0.9, side: THREE.DoubleSide });
  MAT.clothIndigo = new THREE.MeshStandardMaterial({ color: 0x3a4a72, roughness: 0.9, side: THREE.DoubleSide });
  // ---- 室內 ----
  MAT.tatami    = std(tatami);
  MAT.velvet    = std(velvet, { side: THREE.DoubleSide, roughness: 1.0, metalness: 0 });
  MAT.marbleCheck = std(mCheck, { metalness: 0.05 });
  MAT.marblePlain = std(mPlain, { metalness: 0.04 });
  MAT.darkWood  = std(dWood, { metalness: 0.02 });
  MAT.grave     = std(grave);
  // 注連繩的稻草、紙垂/御幣的白紙 —— 神社考據素材
  MAT.straw     = new THREE.MeshStandardMaterial({ color: 0xb9a06a, roughness: 0.95 });
  MAT.paper     = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.88, side: THREE.DoubleSide });
  // 人間之里的田園
  MAT.crop      = new THREE.MeshStandardMaterial({ color: 0x5a7d3c, roughness: 0.92 });
  MAT.soil      = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1.0 });
  MAT.candleFlame = new THREE.MeshStandardMaterial({
    color: 0xffd9a0, emissive: 0xff9a3a, emissiveIntensity: 2.4, roughness: 0.5,
  });
  MAT.ready = true;
}

// ---------------------------------------------------------------------------
// 幾何工具
// ---------------------------------------------------------------------------

/** 8 點環，四角上翹 —— 日式屋頂的靈魂 */
function ring(w, d, y, lift) {
  const hw = w / 2, hd = d / 2;
  return [
    [-hw, y + lift, -hd], [0, y, -hd], [hw, y + lift, -hd], [hw, y, 0],
    [hw, y + lift, hd], [0, y, hd], [-hw, y + lift, hd], [-hw, y, 0],
  ];
}

/** 把一疊環縫成曲面屋頂 */
function loftRings(rings) {
  const pos = [], uv = [];
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1];
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      const a0 = A[i], a1 = A[j], b0 = B[i], b1 = B[j];
      // 兩個三角形組成一個 quad
      pos.push(...a0, ...a1, ...b1);
      pos.push(...a0, ...b1, ...b0);
      const u0 = i / 8, u1 = (i + 1) / 8;
      const v0 = r / (rings.length - 1), v1 = (r + 1) / (rings.length - 1);
      uv.push(u0, v0, u1, v0, u1, v1);
      uv.push(u0, v0, u1, v1, u0, v1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** 日式曲面屋頂 */
function curvedRoof(w, d, h, ridgeFrac = 0.28, lift = 0.5) {
  return loftRings([
    ring(w, d, 0, lift),
    ring(w * 0.72, d * 0.66, h * 0.48, lift * 0.45),
    ring(w * ridgeFrac, 0.001, h, 0),
  ]);
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** box() 的固定貼圖密度版：大牆不再把貼圖拉成長條（BoxGeometry 每面 UV 0..1）。
 *  只給新程式碼用 —— 舊建築的貼圖密度是既定外觀，全域換掉會整批翻掉。
 *  k = 一張貼圖涵蓋的世界尺寸（公尺），越小越密。 */
function boxUV(w, h, d, mat, x = 0, y = 0, z = 0, ry = 0, k = 1.6) {
  const geo = new THREE.BoxGeometry(w, h, d);
  scaleBoxUV(geo, w, h, d, k);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// 元件
// ---------------------------------------------------------------------------

/** 鳥居 */
export function makeTorii(scale = 1) {
  const g = new THREE.Group();
  // 尺度沿用 D:\神社\shrine 那份場景的比例（柱距 9.2m、笠木全寬 13.6m），
  // 比原本的 5.4m 寬近一倍 —— 站在鳥居下的壓迫感差很多。
  const H = 7.4 * scale, span = 4.6 * scale, r = 0.42 * scale;

  // 柱：微微向內傾（真實鳥居的「転び」），柱腳有根卷石
  for (const sx of [-1, 1]) {
    const p = cyl(r * 0.88, r, H, MAT.vermilion, sx * span, H / 2, 0, 16);
    p.rotation.z = -sx * 0.02;
    g.add(p);
    g.add(cyl(r * 1.45, r * 1.45, 0.4 * scale, MAT.stone, sx * span, 0.2 * scale, 0, 16));
  }

  // 貫（下橫樑）與額束
  g.add(box(span * 2 + 1.1 * scale, 0.52 * scale, 0.62 * scale, MAT.vermilion, 0, H * 0.76, 0));
  g.add(box(0.5 * scale, 1.5 * scale, 0.5 * scale, MAT.vermilion, 0, H * 0.76 + 1.0 * scale, 0));

  // 島木＋笠木：兩根疊起的橫樑，兩端向上翹。
  //
  // 舊版是「一根盒子把頂點往上推」，翹角是連續的拋物線，看起來像被拉扯過。
  // 改成分 14 段各自旋轉的短樑 —— 中央平直、末端才抬起（曲線用 |t|^3.2），
  // 這才是真正的「反り」。段與段之間長度多給 4% 避免接縫露出。
  const halfSpan = span + 2.2 * scale, SEG = 14;
  for (const [yOff, hgt, dep] of [[0.04, 0.4, 0.78], [0.52, 0.5, 1.02]]) {
    for (let i = 0; i < SEG; i++) {
      const t0 = i / SEG * 2 - 1, t1 = (i + 1) / SEG * 2 - 1;
      const curve = (t) => Math.pow(Math.abs(t), 3.2) * 1.15 * scale;
      const x0 = t0 * halfSpan, x1 = t1 * halfSpan;
      const y0 = H + (yOff * scale) + curve(t0), y1 = H + (yOff * scale) + curve(t1);
      const len = Math.hypot(x1 - x0, y1 - y0);
      const m = box(len * 1.04, hgt * scale, dep * scale, MAT.vermilion,
                    (x0 + x1) / 2, (y0 + y1) / 2, 0);
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      g.add(m);
    }
  }

  // 注連繩橫掛在貫下方（原本鳥居是光禿的，只有拜殿前才有）
  const nawa = makeShimenawa(span * 1.6, scale);
  nawa.position.set(0, H * 0.76 - 0.42 * scale, 0);
  g.add(nawa);

  return g;
}

/** 石燈籠 —— 夜裡會亮 */
export function makeLantern(scale = 1) {
  const g = new THREE.Group();
  const s = scale;
  g.add(cyl(0.34 * s, 0.44 * s, 0.36 * s, MAT.stoneDark, 0, 0.18 * s, 0, 8));
  g.add(cyl(0.15 * s, 0.19 * s, 1.05 * s, MAT.stone, 0, 0.88 * s, 0, 8));
  g.add(cyl(0.42 * s, 0.3 * s, 0.2 * s, MAT.stoneDark, 0, 1.5 * s, 0, 8));

  const fire = cyl(0.3 * s, 0.34 * s, 0.5 * s, MAT.paperLamp, 0, 1.85 * s, 0, 8);
  fire.name = 'lantern-fire';
  g.add(fire);

  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.55 * s, 0.42 * s, 8), MAT.stoneDark);
  cap.position.y = 2.3 * s;
  cap.castShadow = true;
  g.add(cap);

  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 8, 6), MAT.stoneDark);
  knob.position.y = 2.56 * s;
  g.add(knob);

  return g;
}

/** 紙燈籠（吊掛式） */
function makePaperLantern(s = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3 * s, 12, 10), MAT.paperLamp);
  body.scale.set(1, 1.35, 1);
  body.name = 'lantern-fire';
  g.add(body);
  g.add(cyl(0.12 * s, 0.12 * s, 0.08 * s, MAT.woodDark, 0, 0.42 * s, 0, 8));
  g.add(cyl(0.12 * s, 0.12 * s, 0.08 * s, MAT.woodDark, 0, -0.42 * s, 0, 8));
  return g;
}

/** 日式主殿 / 民家 */
function makeHall(w, d, wallH, opts = {}) {
  const g = new THREE.Group();
  const roofMat = opts.roofMat || MAT.roof;
  const wallMat = opts.wallMat || MAT.plaster;

  // 台基
  g.add(box(w + 1.0, 0.55, d + 1.0, MAT.stone, 0, 0.27, 0));

  // 牆體
  g.add(box(w, wallH, d, wallMat, 0, 0.55 + wallH / 2, 0));

  // 障子（正面拉門）
  const doorW = Math.min(w * 0.62, 5.2);
  const shoji = box(doorW, wallH * 0.72, 0.14, MAT.shoji, 0, 0.55 + wallH * 0.4, d / 2 + 0.02);
  g.add(shoji);

  // 側面窗
  if (w > 5) {
    g.add(box(0.14, wallH * 0.4, d * 0.4, MAT.shoji, -w / 2 - 0.02, 0.55 + wallH * 0.55, 0));
    g.add(box(0.14, wallH * 0.4, d * 0.4, MAT.shoji, w / 2 + 0.02, 0.55 + wallH * 0.55, 0));
  }

  // 柱
  const pr = 0.16;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cyl(pr, pr, wallH, MAT.woodDark, sx * (w / 2 - 0.1), 0.55 + wallH / 2, sz * (d / 2 - 0.1), 8));
  }

  // 屋頂
  const rh = opts.roofH || Math.max(2.2, wallH * 0.85);
  const roof = new THREE.Mesh(curvedRoof(w + 2.4, d + 2.4, rh, 0.3, 0.55), roofMat);
  roof.position.y = 0.55 + wallH;
  roof.castShadow = roof.receiveShadow = true;
  g.add(roof);

  // 棟木
  g.add(box((w + 2.4) * 0.32, 0.3, 0.5, MAT.roofBlack, 0, 0.55 + wallH + rh, 0));

  g.userData.collider = { w: w + 0.6, d: d + 0.6, h: 0.55 + wallH };
  return g;
}

/** 石階 */
function makeStairs(width, steps, rise, run, mat = MAT.stoneWall) {
  const parts = [];
  for (let i = 0; i < steps; i++) {
    const b = new THREE.BoxGeometry(width, rise, run);
    b.translate(0, rise / 2 + i * rise, -i * run);
    parts.push(b);
  }
  const m = new THREE.Mesh(BGU.mergeGeometries(parts), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** 木柵欄 */
function makeFence(length, mat = MAT.woodDark) {
  const parts = [];
  const n = Math.max(2, Math.round(length / 1.6));
  for (let i = 0; i <= n; i++) {
    const p = new THREE.BoxGeometry(0.14, 1.5, 0.14);
    p.translate(-length / 2 + (i * length) / n, 0.75, 0);
    parts.push(p);
  }
  for (const y of [0.55, 1.15]) {
    const r = new THREE.BoxGeometry(length, 0.1, 0.09);
    r.translate(0, y, 0);
    parts.push(r);
  }
  const m = new THREE.Mesh(BGU.mergeGeometries(parts), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** 玉垣（移植自 demo 的紅柵）：神社境內的朱紅圍籬。
 *  柱距比木柵欄密（1.3m）、柱身較粗，雙橫檔——村裡的木柵欄是另一種東西。 */
function makeTamagaki(length) {
  const parts = [];
  const n = Math.max(2, Math.round(length / 1.3));
  for (let i = 0; i <= n; i++) {
    const p = new THREE.BoxGeometry(0.18, 1.5, 0.18);
    p.translate(-length / 2 + (i * length) / n, 0.75, 0);
    parts.push(p);
  }
  for (const y of [0.6, 1.35]) {
    const r = new THREE.BoxGeometry(length, 0.14, 0.14);
    r.translate(0, y, 0);
    parts.push(r);
  }
  const m = new THREE.Mesh(BGU.mergeGeometries(parts), MAT.vermilion);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** 繪馬掛（移植自 demo）：兩柱一桁，掛九塊繪馬。
 *  傾角用固定表不用亂數 —— 場景重建時樣子要一致。 */
function makeEma() {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) g.add(cyl(0.12, 0.14, 2.2, MAT.woodDark, sx * 1.6, 1.1, 0, 8));
  g.add(box(3.6, 0.16, 0.3, MAT.woodDark, 0, 2.1, 0));
  const TILT = [0.05, -0.06, 0.03, -0.02, 0.07, -0.04, 0.02, -0.05, 0.04];
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.28), MAT.paper);
    p.position.set(-1.4 + (i % 5) * 0.7, 1.75 - ((i / 5) | 0) * 0.42, 0.02 + ((i / 5) | 0) * 0.06);
    p.rotation.z = TILT[i];
    p.castShadow = true;
    g.add(p);
  }
  return g;
}

/** 拜殿：三面牆＋開放正面（簷廊式），真正能走進去的神社室內。
 *  真實神社的拜殿不是密室——朝參道那一面通常是開放或格柵狀的，
 *  賽錢箱、鈴、狛犬都在那個開口前。opts.open 決定哪一側是開口：
 *  -1 = 開口朝本地座標 -Z（給博麗神社，參道在較小的 z）；
 *   1 = 開口朝本地座標 +Z（給守矢神社，參道在較大的 z）。 */
function makeHaidenOpen(w, d, wallH, opts = {}) {
  const g = new THREE.Group();
  const roofMat = opts.roofMat || MAT.roof;
  const wallMat = opts.wallMat || MAT.plaster;
  const open = opts.open ?? -1;
  const back = -open;   // 牆在開口的另一側

  g.add(box(w + 1.0, 0.55, d + 1.0, MAT.stone, 0, 0.27, 0));

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, d - 0.4), MAT.tatami);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.56, 0);
  floor.receiveShadow = true;
  g.add(floor);

  // 後牆 + 左右牆，開口那面不放牆
  g.add(box(w, wallH, 0.18, wallMat, 0, 0.55 + wallH / 2, back * (d / 2 - 0.09)));
  g.add(box(0.18, wallH, d, wallMat, -w / 2 + 0.09, 0.55 + wallH / 2, 0));
  g.add(box(0.18, wallH, d, wallMat, w / 2 - 0.09, 0.55 + wallH / 2, 0));

  const pr = 0.16;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cyl(pr, pr, wallH, MAT.woodDark, sx * (w / 2 - 0.1), 0.55 + wallH / 2, sz * (d / 2 - 0.1), 8));
  }

  // 內部神龕：簡化的御神體台 + 圓鏡
  g.add(box(1.6, 0.9, 0.5, MAT.woodDark, 0, 0.55 + 0.45, back * (d / 2 - 0.6)));
  const mirror = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), MAT.gold);
  mirror.position.set(0, 0.55 + 1.35, back * (d / 2 - 0.5));
  mirror.rotation.y = open > 0 ? Math.PI : 0;
  mirror.castShadow = true;
  g.add(mirror);

  const rh = opts.roofH || Math.max(2.2, wallH * 0.85);
  const roof = new THREE.Mesh(curvedRoof(w + 2.4, d + 2.4, rh, 0.3, 0.55), roofMat);
  roof.position.y = 0.55 + wallH;
  roof.castShadow = roof.receiveShadow = true;
  g.add(roof);
  g.add(box((w + 2.4) * 0.32, 0.3, 0.5, MAT.roofBlack, 0, 0.55 + wallH + rh, 0));

  for (const sx of [-1, 1]) {
    const lp = makePaperLantern(0.8);
    lp.position.set(sx * (w / 2 - 1.2), 0.55 + wallH - 0.6, open * (d / 2 - 1.4));
    g.add(lp);
  }

  g.userData.hollow = { w, d, wallH, backZ: back * (d / 2 - 0.09) };
  return g;
}

/** 狛犬（移植自 demo）：高台座＋方身軀＋十二面體頭＋捲尾，
 *  比舊版球頭大一圈，遠看剪影才認得出是狛犬。
 *  面向本地 +Z；成對呼叫兩次分置左右，mouthOpen 區分「阿吽」（開口/閉口）。 */
function makeKomainu(scale = 1, mouthOpen = true) {
  const g = new THREE.Group();
  const s = scale;
  g.add(box(1.1 * s, 1.5 * s, 1.5 * s, MAT.stone, 0, 0.75 * s, 0));        // 台座
  const body = box(0.72 * s, 0.85 * s, 1.25 * s, MAT.stone, 0, 1.95 * s, 0);
  body.rotation.x = -0.06;
  g.add(body);
  for (const sx of [-1, 1]) {
    g.add(box(0.2 * s, 0.62 * s, 0.2 * s, MAT.stone, sx * 0.24 * s, 1.25 * s, 0.42 * s));  // 前腳
    g.add(box(0.2 * s, 0.55 * s, 0.2 * s, MAT.stone, sx * 0.24 * s, 1.3 * s, -0.42 * s));  // 後腳
  }
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.48 * s, 0), MAT.stone);
  head.position.set(0, 2.55 * s, 0.62 * s);
  head.castShadow = true;
  g.add(head);
  g.add(box(0.3 * s, 0.26 * s, 0.36 * s, MAT.stone, 0, 2.45 * s, 0.98 * s));  // 吻部
  if (mouthOpen) {   // 「阿」形：嘴下開一道暗縫
    g.add(box(0.24 * s, 0.12 * s, 0.3 * s, MAT.stoneDark, 0, 2.3 * s, 0.96 * s));
  }
  for (const sz of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16 * s, 0.34 * s, 5), MAT.stone);
    ear.position.set(sz * 0.26 * s, 2.92 * s, 0.5 * s);
    ear.rotation.x = 0.3;
    ear.castShadow = true;
    g.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3 * s, 0.95 * s, 6), MAT.stone);
  tail.position.set(0, 2.5 * s, -0.7 * s);
  tail.rotation.x = -0.7;
  tail.castShadow = true;
  g.add(tail);
  return g;
}

/** 手水舍：參拜前淨手的小亭 */
function makeChozuya(scale = 1) {
  const g = new THREE.Group();
  const s = scale;
  // 四柱方亭（移植自 demo）：直坡雙坡屋根、長方石鉢、四柄竹杓
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cyl(0.17 * s, 0.19 * s, 3.0 * s, MAT.woodDark, sx * 1.7 * s, 1.5 * s, sz * 1.4 * s, 10));
  }
  g.add(box(4.6 * s, 0.22 * s, 3.6 * s, MAT.woodDark, 0, 3.05 * s, 0));   // 軒受け
  for (const dir of [1, -1]) {
    const m = box(5.2 * s, 0.4 * s, 2.6 * s, MAT.roof, 0, 3.75 * s, dir * 1.05 * s);
    m.rotation.x = dir * 0.42;
    g.add(m);
  }
  g.add(box(5.3 * s, 0.5 * s, 0.7 * s, MAT.roof, 0, 4.3 * s, 0));         // 棟

  g.add(box(2.6 * s, 0.9 * s, 1.7 * s, MAT.stone, 0, 0.45 * s, 0));       // 石鉢
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2.2 * s, 1.3 * s),
    new THREE.MeshStandardMaterial({
      color: 0x5f8f93, roughness: 0.08, metalness: 0.55, transparent: true, opacity: 0.9,
    }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.92 * s;
  g.add(water);

  for (let i = 0; i < 4; i++) {   // 竹杓斜架在鉢緣
    const l = new THREE.Group();
    l.position.set((-0.9 + i * 0.6) * s, 1.0 * s, 0);
    const handle = cyl(0.03 * s, 0.03 * s, 0.8 * s, MAT.wood, 0, 0, 0.35 * s, 6);
    handle.rotation.x = Math.PI / 2;
    l.add(handle);
    l.add(cyl(0.11 * s, 0.11 * s, 0.1 * s, MAT.wood, 0, 0, -0.1 * s, 8));
    g.add(l);
  }
  return g;
}

/** 鈴緒：拜殿前懸掛的鈴鐺與麻繩。
 *  繩身是紅白相間的短節（移植自 demo 的鈴緒）——純白一根太單調，
 *  紅白節紋才是祭典鈴緒的樣子。 */
function makeSuzuBell(scale = 1) {
  const g = new THREE.Group();
  const s = scale;
  for (let i = 0; i < 6; i++) {
    g.add(cyl(0.075 * s, 0.075 * s, 0.26 * s, i % 2 ? MAT.clothRed : MAT.paper,
      0, -0.13 * s - i * 0.26 * s, 0, 8));
  }
  g.add(cyl(0.1 * s, 0.07 * s, 0.28 * s, MAT.clothRed, 0, -0.13 * s - 6 * 0.26 * s, 0, 8));  // 穗
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.78), MAT.gold);
  bell.position.y = 0.02 * s;
  bell.castShadow = true;
  g.add(bell);
  return g;
}

/** 三角柱（屋根破風的三角形截面，稜線沿 Z 軸…更正：沿 X 軸水平） */
function triPrismGeo(w, h, thick) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  geo.translate(0, 0, -thick / 2);
  return geo;
}

/** 賽銭箱：石座 + 木箱 + 微傾的格柵蓋（錢從木條縫投入）+ 正面飾帶。
 *  真實的賽銭箱頂面是一排平行木格柵，不是一塊平板——這是「做得像不像」的關鍵。 */
function makeSaisenBox(scale = 1) {
  const g = new THREE.Group();
  const s = scale;
  const tilt = 0.12;                    // 頂蓋前傾角

  g.add(box(2.7 * s, 0.24 * s, 1.6 * s, MAT.stoneDark, 0, 0.12 * s, 0));   // 石座
  g.add(box(2.4 * s, 0.85 * s, 1.25 * s, MAT.planks, 0, 0.24 * s + 0.425 * s, 0));

  // 頂框 + 格柵（同一傾角）
  const lid = box(2.62 * s, 0.13 * s, 1.48 * s, MAT.woodDark, 0, 1.15 * s, 0);
  lid.rotation.x = tilt;
  g.add(lid);
  const bars = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const b = new THREE.BoxGeometry(0.1 * s, 0.07 * s, 1.4 * s);
    b.translate(-1.08 * s + (i * 2.16 * s) / (n - 1), 1.24 * s, 0);
    bars.push(b);
  }
  const lattice = new THREE.Mesh(BGU.mergeGeometries(bars), MAT.woodDark);
  lattice.rotation.x = tilt;
  lattice.castShadow = true;
  g.add(lattice);

  // 正面飾帶（捐獻者名牌欄）
  const band = box(2.44 * s, 0.2 * s, 0.05 * s, MAT.woodDark, 0, 0.92 * s, -0.65 * s);
  band.rotation.x = tilt;
  g.add(band);
  return g;
}

/** 注連繩（しめなわ）：稻草繩 + 三處草輪 + 四枚紙垂（しで）。
 *  掛在拜殿入口上方，紙垂是白色閃電形摺紙。
 *  k = 繩體粗細倍率 —— 守矢神社（諏訪大社神樂殿）的注連繩以「巨粗」聞名。 */
function makeShimenawa(len = 6, k = 1) {
  const g = new THREE.Group();
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * k, 0.1 * k, len, 8), MAT.straw);
  rope.rotation.z = Math.PI / 2;
  rope.castShadow = true;
  g.add(rope);
  for (const fx of [-0.28, 0, 0.28]) {          // 草輪（わらの束ねた膨らみ）
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * k, 0.17 * k, 0.24 * k, 8), MAT.straw);
    band.rotation.z = Math.PI / 2;
    band.position.x = fx * len;
    band.castShadow = true;
    g.add(band);
  }
  const shideS = Math.min(k, 1.8);               // 紙垂跟著變大但不成正比（太大會像床單）
  for (const fx of [-0.36, -0.12, 0.12, 0.36]) { // 紙垂
    const shide = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const fold = box(0.2 * shideS, 0.02, 0.3 * shideS, MAT.paper,
        (i % 2 ? -0.055 : 0.055) * shideS, (-0.14 - i * 0.15) * shideS - 0.06 * (k - 1), 0);
      fold.rotation.y = (i % 2 ? -1 : 1) * 0.5;
      shide.add(fold);
    }
    shide.position.set(fx * len, -0.06 * k, 0);
    g.add(shide);
  }
  return g;
}

/** 貼坡石段：沿本地 Z 軸從 z0 鋪到 z1，每階頂面貼合該處地形高度。
 *  博麗神社考據：「鳥居の外は斜面の石段」——鳥居之外是山坡上的長石段。
 *  回傳單一合併網格（含兩側緣石），1 次 draw call。 */
/** BoxGeometry 每面 UV 都是 0..1：7m 寬的台階會把石材貼圖拉成平行長條，
 *  看起來像木板。依各面實際尺寸縮放 UV，讓貼圖以固定世界尺寸重覆。 */
function scaleBoxUV(geo, w, h, d, k = 1.6) {
  const uv = geo.attributes.uv;
  // BoxGeometry 面順序 +x,-x,+y,-y,+z,-z，每面 4 頂點
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * su / k, uv.getY(i) * sv / k);
    }
  }
}

function makeTerrainStairs(R, width, z0, z1, xOff = 0, run = 0.62) {
  const parts = [];
  const len = Math.abs(z1 - z0);
  const n = Math.ceil(len / run);
  const dir = Math.sign(z1 - z0) || 1;
  for (let i = 0; i < n; i++) {
    const z = z0 + dir * (i + 0.5) * run;
    const h = terrainHeight(R.x + xOff, R.z + z);
    // 階板：頂面高出地形 0.12（地形在取樣點之間有雜訊起伏，齊平會被地面吃掉）
    const b = new THREE.BoxGeometry(width, 0.95, run + 0.1);
    scaleBoxUV(b, width, 0.95, run + 0.1, 1.5);
    b.translate(xOff, h - 0.35, z);
    parts.push(b);
  }

  // 兩側斜欄（移植自 demo 的石段欄干）：實心石欄干沿坡而下，
  // 每隔一段一根親柱，欄干頂比踏面高一公尺出頭。
  // 舊版是每階一塊小緣石，遠看碎成一串方塊；整段斜欄才有「石段」的樣子。
  const SEG = 7.5;
  const m = Math.max(1, Math.round(len / SEG));
  const segLen = len / m;
  const railX = width / 2 + 0.55;
  for (let i = 0; i < m; i++) {
    const za = z0 + dir * i * segLen;
    const zb = z0 + dir * (i + 1) * segLen;
    const ha = terrainHeight(R.x + xOff, R.z + za);
    const hb = terrainHeight(R.x + xOff, R.z + zb);
    const slope = Math.hypot(segLen, hb - ha) + 0.35;
    for (const sx of [-1, 1]) {
      const r = new THREE.BoxGeometry(0.6, 1.4, slope);
      scaleBoxUV(r, 0.6, 1.4, slope, 1.2);
      r.rotateX(dir * Math.atan2(ha - hb, segLen));
      r.translate(xOff + sx * railX, (ha + hb) / 2 + 0.53, (za + zb) / 2);
      parts.push(r);
    }
  }
  // 親柱：欄干的節點柱，立在每段斜欄的接縫與兩端
  for (let i = 0; i <= m; i++) {
    const z = z0 + dir * i * segLen;
    const h = terrainHeight(R.x + xOff, R.z + z);
    for (const sx of [-1, 1]) {
      const p = new THREE.BoxGeometry(0.72, 1.7, 0.72);
      scaleBoxUV(p, 0.72, 1.7, 0.72, 1.2);
      p.translate(xOff + sx * railX, h + 0.85, z);
      parts.push(p);
      const cap = new THREE.BoxGeometry(0.95, 0.22, 0.95);
      scaleBoxUV(cap, 0.95, 0.22, 0.95, 1.2);
      cap.translate(xOff + sx * railX, h + 1.81, z);
      parts.push(cap);
    }
  }

  const mesh = new THREE.Mesh(BGU.mergeGeometries(parts), MAT.stoneWall);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** 博麗神社社殿 —— 屋頂移植自 D:\神社\shrine demo 的切妻造：
 *  ・切妻造大屋根（兩坡、深簷），棟上鰹木（附金飾端）＋兩端千木
 *  ・高床式：木架把地板抬離地面，正面縁側與木階上下
 *  ・外壁白漆喰（木造白壁，不是磚造）、深色木柱
 *  ・內有榻榻米、神龕御鏡、幣束一對、燭台一對，頂上有天花板與露明樑
 *  開口朝本地 -Z（參道側）。本地原點在地面中心。 */
function makeHakureiHaiden(w = 12, d = 9, wallH = 3.6) {
  const g = new THREE.Group();
  const floorY = 1.5;                  // 高床：地板頂面離地高度（境內地形比 elev 高約 0.6，實際視覺抬高約 0.9）
  const doorW = 3.6;                   // 正面中央參拜口寬

  // 床下石墩（高床的腳）
  const piers = [];
  for (const px of [-w / 2 + 0.7, 0, w / 2 - 0.7]) {
    for (const pz of [-d / 2 + 0.7, 0, d / 2 - 0.7]) {
      const c = new THREE.CylinderGeometry(0.26, 0.34, floorY, 8);
      c.translate(px, floorY / 2, pz);
      piers.push(c);
    }
  }
  const pierMesh = new THREE.Mesh(BGU.mergeGeometries(piers), MAT.stoneDark);
  pierMesh.castShadow = pierMesh.receiveShadow = true;
  g.add(pierMesh);

  // 木地板 + 正面縁側（向外突出 1.5）
  g.add(box(w + 1.2, 0.24, d + 1.2, MAT.darkWood, 0, floorY - 0.12, 0));
  g.add(box(w + 1.2, 0.22, 1.5, MAT.darkWood, 0, floorY - 0.11, -(d / 2 + 0.75)));

  // 正面木階（可行走，碰撞在 buildShrine 以 walk 碰撞盒註冊）
  const st = makeStairs(2.6, 5, floorY / 5, 0.5, MAT.darkWood);
  st.rotation.y = Math.PI;             // 預設向 -Z 上升，轉成向 +Z（朝緣側）上升
  st.position.set(0, 0, -(d / 2 + 1.5) - 2.0);
  g.add(st);

  // 牆體：白漆喰三面；正面中央開口、兩側障子拉門、上口白壁帶
  const wallY = floorY + wallH / 2;
  g.add(box(w, wallH, 0.2, MAT.plaster, 0, wallY, d / 2 - 0.1));
  g.add(box(0.2, wallH, d, MAT.plaster, -w / 2 + 0.1, wallY, 0));
  g.add(box(0.2, wallH, d, MAT.plaster, w / 2 - 0.1, wallY, 0));
  const sideW = (w - doorW) / 2;
  for (const sx of [-1, 1]) {
    g.add(box(sideW, wallH * 0.72, 0.14, MAT.shoji,
      sx * (doorW / 2 + sideW / 2), floorY + wallH * 0.36, -d / 2 + 0.07));
  }
  g.add(box(w, wallH * 0.28, 0.2, MAT.plaster, 0, floorY + wallH * 0.86, -d / 2 + 0.1));

  // 木柱：四角 + 正面門框柱 + 緣側前沿一對（撐唐破風與注連繩）
  const pr = 0.17;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cyl(pr, pr, wallH, MAT.woodDark, sx * (w / 2 - 0.12), wallY, sz * (d / 2 - 0.12), 8));
  }
  for (const sx of [-1, 1]) {
    g.add(cyl(pr * 0.9, pr, wallH + 0.35, MAT.woodDark, sx * (doorW / 2 + 0.45), floorY + (wallH + 0.35) / 2, -(d / 2 + 1.45), 8));
  }

  // 內部：榻榻米 + 神龕（御神體鏡）+ 幣束一對 + 燭台一對
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.5, d - 0.5), MAT.tatami);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, floorY + 0.01, 0);
  floor.receiveShadow = true;
  g.add(floor);
  g.add(box(1.9, 1.0, 0.6, MAT.woodDark, 0, floorY + 0.5, d / 2 - 0.85));
  const mirror = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), MAT.gold);
  mirror.position.set(0, floorY + 1.65, d / 2 - 0.62);
  mirror.rotation.y = Math.PI;
  mirror.castShadow = true;
  g.add(mirror);
  for (const sx of [-1, 1]) {          // 幣束（御幣）
    const gohei = new THREE.Group();
    gohei.add(cyl(0.03, 0.03, 1.15, MAT.wood, 0, 0.57, 0, 6));
    for (let i = 0; i < 3; i++) {
      const f = box(0.15, 0.02, 0.26, MAT.paper, (i % 2 ? -0.05 : 0.05), 1.06 - i * 0.13, 0);
      f.rotation.y = (i % 2 ? -1 : 1) * 0.5;
      gohei.add(f);
    }
    gohei.position.set(sx * 1.7, floorY, d / 2 - 0.85);
    g.add(gohei);
  }
  for (const sx of [-1, 1]) {          // 燭台（demo 移植）：金座＋火珠，不設點光源（省給主燈）
    g.add(cyl(0.09, 0.13, 0.72, MAT.gold, sx * 1.35, floorY + 1.36, d / 2 - 0.85, 8));
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), MAT.candleFlame);
    flame.position.set(sx * 1.35, floorY + 1.78, d / 2 - 0.85);
    g.add(flame);
  }

  // 天花板＋露明樑（demo 移植）：抬頭看到的是木料，不是屋頂瓦的背面
  g.add(box(w - 0.6, 0.16, d - 0.8, MAT.darkWood, 0, floorY + wallH + 0.26, 0));
  for (let i = -3; i <= 3; i++) {
    g.add(box(0.2, 0.26, d - 0.8, MAT.wood, i * 1.5, floorY + wallH + 0.1, 0));
  }

  // 縁側欄杆（demo 移植）：朱紅細欄沿兩側走到後緣
  for (const sx of [-1, 1]) {
    g.add(box(0.12, 0.12, d + 0.9, MAT.vermilion, sx * (w / 2 + 0.48), floorY + 0.82, -0.15));
    for (let i = 0; i < 8; i++) {
      g.add(box(0.09, 0.82, 0.09, MAT.vermilion, sx * (w / 2 + 0.48), floorY + 0.41, -(d / 2 + 0.55) + i * 1.42));
    }
  }

  // 御札（demo 移植）：釘在正面兩側障子上，微微歪斜才有生活感
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) {
    const o = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.85), MAT.paper);
    o.position.set(sx * (doorW / 2 + 1.3 + i * 1.0), floorY + 2.6 - i * 0.22, -d / 2 + 0.16);
    o.rotation.y = Math.PI;
    o.rotation.z = sx * (0.04 + i * 0.03);
    g.add(o);
  }

  // 屋頂：切妻造大屋根（demo 移植）——脊沿 X、兩坡深簷。
  // 坡度比沿用 demo 的 0.735（高/跨），屋頂佔的視覺體積夠大，
  // 神社才會是「遠遠就看到一頂大屋根」的剪影。
  const slopeRatio = 0.735;
  const halfD = d / 2 + 2.8;                       // 簷口出挑 2.8m（深簷）
  const eaveY = floorY + wallH + 0.2;
  const ridgeY = eaveY + halfD * slopeRatio;
  const roofW = w + 4.4;
  for (const dir of [1, -1]) {
    const eaveZ = dir * halfD;
    const dy = ridgeY - eaveY, dz = halfD;
    const len = Math.hypot(dz, dy);
    const m = box(roofW, 0.5, len, MAT.roof, 0, (ridgeY + eaveY) / 2, eaveZ / 2);
    m.rotation.x = dir * Math.atan2(dy, dz);
    g.add(m);
    // 簷口緣板
    g.add(box(roofW + 0.3, 0.38, 0.45, MAT.darkWood, 0, eaveY - 0.1, eaveZ));
  }

  // 山牆（兩端切妻封口）
  for (const sx of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-halfD, eaveY - 0.36);
    shape.lineTo(halfD, eaveY - 0.36);
    shape.lineTo(0, ridgeY);
    const tri = new THREE.Mesh(new THREE.ShapeGeometry(shape), MAT.darkWood);
    tri.position.set(sx * (roofW / 2 - 0.05), 0, 0);
    tri.rotation.y = sx * Math.PI / 2;
    tri.castShadow = true;
    g.add(tri);
  }

  // 大棟＋鰹木（附金飾端）＋兩端千木（交叉長木，切妻造的標記）
  g.add(box(roofW + 0.5, 0.8, 1.5, MAT.roof, 0, ridgeY + 0.05, 0));
  for (let i = -2; i <= 2; i++) {
    const k = cyl(0.26, 0.26, 2.1, MAT.darkWood, i * (roofW / 5), ridgeY + 0.62, 0, 10);
    k.rotation.x = Math.PI / 2;
    g.add(k);
    for (const sz of [-1, 1]) {
      const cap = cyl(0.29, 0.29, 0.18, MAT.gold, i * (roofW / 5), ridgeY + 0.62, sz * 1.05, 10);
      cap.rotation.x = Math.PI / 2;
      g.add(cap);
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c = box(0.26, 3.0, 0.26, MAT.darkWood, sx * (roofW / 2 - 0.3), ridgeY + 0.8, sz * 0.75);
    c.rotation.x = -sz * 0.42;
    g.add(c);
  }

  // 簷下紙燈籠一對
  for (const sx of [-1, 1]) {
    const lp = makePaperLantern(0.85);
    lp.position.set(sx * (doorW / 2 + 0.5), floorY + wallH * 0.78, -(d / 2 + 1.5));
    g.add(lp);
  }

  g.userData.hollow = { w, d, wallH, backZ: d / 2 - 0.1, floorY };
  return g;
}

/** 貼地參道：沿一條直線鋪石板，每個頂點取樣真實地形高度，不是固定高度的浮板。
 *  地區中心附近的地形會被壓平成 `elev`，但壓平只在地區半徑的 42% 內是滿的，
 *  再往外地形會漸漸恢復原本的起伏——參道如果整條都用固定高度鋪，
 *  遠端就會浮在半空中或插進地底，跟地面斷開一截，看起來像斷掉的路、
 *  也連不上外面其他地方。這裡讓每個頂點各自貼合實際地形，長度不受限制。
 * @param R        地區物件（用它的世界座標把本地座標換算成世界座標）
 * @param width    參道寬度
 * @param a0,a1    本地座標的起訖（axis='z' 時是 Z 範圍，'x' 時是 X 範圍）
 * @param off      另一軸的偏移，參道不一定通過地區正中心
 * @param axis     'z'（預設，路沿 Z 延伸）或 'x'（路沿 X 延伸）
 */
function buildGroundPath(R, width, a0, a1, off, mat, segments = 48, axis = 'z') {
  const len = Math.abs(a1 - a0);
  const geo = axis === 'z'
    ? new THREE.PlaneGeometry(width, len, 1, segments)
    : new THREE.PlaneGeometry(len, width, segments, 1);
  geo.rotateX(-Math.PI / 2);
  if (axis === 'z') geo.translate(off, 0, (a0 + a1) / 2);
  else geo.translate((a0 + a1) / 2, 0, off);
  // UV 按實際尺寸重覆，否則貼圖在長路上被拉成平行長條（石板路看起來像木板）。
  // 注意 axis='x' 時 PlaneGeometry(len, width)：u 對應長邊、v 對應寬邊，不能寫反。
  const su = (axis === 'z' ? width : len) / 3.5;
  const sv = (axis === 'z' ? len : width) / 3.5;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const h = terrainHeight(R.x + pos.getX(i), R.z + pos.getZ(i));
    pos.setY(i, h + 0.08);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  // 路面除草：草叢不從石板縫裡鑽出來
  if (axis === 'z') addClearing(R.x + off, R.z + (a0 + a1) / 2, width / 2 + 0.7, len / 2);
  else addClearing(R.x + (a0 + a1) / 2, R.z + off, len / 2, width / 2 + 0.7);
  return mesh;
}

// ---------------------------------------------------------------------------
// 各地區
// ---------------------------------------------------------------------------

/** 博麗神社 —— 依 THBWiki 考據重建（2026-07 第三輪）。
 *
 *  考據要點：
 *  ・「鳥居の外は斜面の石段」——大鳥居立在石段頂端，鳥居之外是
 *    沿山坡而下的長石段（此處地形從境內 104 降到山麓 43，正好符合）。
 *  ・鳥居之內是平坦石板參道，盡頭是社殿。
 *  ・社殿是木造白壁（漆喰外壁）的高床式建築，入母屋屋根、正面千鳥破風
 *    ＋軒唐破風，正面木階上下，絕對不是磚造。
 *  ・賽銭箱在社殿正面階前，上方掛注連繩與鈴緒。
 *  ・社殿旁有守矢神社分社與切妻倉庫（原作設定）。 */
function buildShrine(colliders, lights, staticLights) {
  const R = REGION_BY_ID.shrine;
  const g = new THREE.Group();
  g.name = 'shrine';
  const base = R.elev;

  // 境內平坦參道（鳥居之內）；鳥居之外換成貼坡長石段
  g.add(buildGroundPath(R, 7, -84, 23, 0, MAT.stone));
  g.add(makeTerrainStairs(R, 7, -84, -186));

  // 三座鳥居：最大的一座立在石段頂端——結界與俗界的分界；
  // 越靠近社殿越大是舊版的視覺節奏，保留中、內兩座。
  [[-84, 1.0], [-48, 1.15], [-20, 1.35]].forEach(([z, s]) => {
    const ty = terrainHeight(R.x, R.z + z);
    const t = makeTorii(s);
    t.position.set(0, ty, z);
    g.add(t);
    const W = 5.4 * s / 2;
    colliders.push({ x: R.x - W, z: R.z + z, r: 0.4 * s, y: ty, h: 7 * s });
    colliders.push({ x: R.x + W, z: R.z + z, r: 0.4 * s, y: ty, h: 7 * s });
  });

  // 社殿：高床式木造白壁（考據見 makeHakureiHaiden）
  const hall = makeHakureiHaiden(12, 9, 3.6);
  hall.position.set(0, base, 16);
  g.add(hall);

  // —— 社殿碰撞（walk:true = 可踏上去的平台，controller 會把地面吸附到頂面）——
  const floorTop = 1.5;
  // 本體地板 + 緣側
  colliders.push({ x: R.x, z: R.z + 16, hw: 6.6, hd: 5.1, y: base, h: floorTop, walk: true });
  colliders.push({ x: R.x, z: R.z + 16 - 5.25, hw: 6.6, hd: 0.75, y: base, h: floorTop, walk: true });
  // 正面木階：5 級，每級各自是可走平台
  for (let i = 0; i < 5; i++) {
    colliders.push({
      x: R.x, z: R.z + 16 - 8.0 + i * 0.5, hw: 1.3, hd: 0.27,
      y: base, h: (i + 1) * (floorTop / 5), walk: true,
    });
  }
  // 牆：後牆、左右牆、正面兩側障子（從地面一路擋到牆頂，地板上下都進不去）
  const wallH = 3.6;
  colliders.push({ x: R.x, z: R.z + 16 + 4.4, hw: 6, hd: 0.2, y: base, h: floorTop + wallH });
  colliders.push({ x: R.x - 5.9, z: R.z + 16, hw: 0.2, hd: 4.5, y: base, h: floorTop + wallH });
  colliders.push({ x: R.x + 5.9, z: R.z + 16, hw: 0.2, hd: 4.5, y: base, h: floorTop + wallH });
  colliders.push({ x: R.x - 3.9, z: R.z + 16 - 4.4, hw: 2.1, hd: 0.15, y: base, h: floorTop + wallH });
  colliders.push({ x: R.x + 3.9, z: R.z + 16 - 4.4, hw: 2.1, hd: 0.15, y: base, h: floorTop + wallH });
  // 緣側前沿一對柱
  colliders.push({ x: R.x - 2.25, z: R.z + 16 - 5.95, r: 0.24, y: base, h: floorTop + wallH });
  colliders.push({ x: R.x + 2.25, z: R.z + 16 - 5.95, r: 0.24, y: base, h: floorTop + wallH });

  // 賽銭箱：石座木格柵蓋，就在社殿木階正前方（與階梯碰撞區保持間隙）
  const saisenY = terrainHeight(R.x, R.z + 7.0);
  const saisen = makeSaisenBox(1.1);
  saisen.position.set(0, saisenY, 7.0);
  g.add(saisen);
  colliders.push({ x: R.x, z: R.z + 7.0, hw: 1.5, hd: 0.65, y: saisenY, h: 1.4 });

  // 注連繩橫掛在緣側前柱之間，中央垂鈴緒
  const nawa = makeShimenawa(4.6);
  nawa.position.set(0, base + floorTop + 3.3, 16 - 5.95);
  g.add(nawa);
  const suzu = makeSuzuBell(1.15);
  suzu.position.set(0, base + floorTop + 3.28, 16 - 5.95);
  g.add(suzu);

  INTERIORS.push({
    id: 'hakurei-haiden', zh: '博麗神社拜殿', en: 'HAKUREI SHRINE — HAIDEN',
    enter: { x: R.x, z: R.z + 10.4 },
    inside: { x: R.x, y: base + floorTop + 0.7, z: R.z + 16 },
    exit: { x: R.x, z: R.z + 5.5 },
  });

  // 殿內常亮暖燈（照亮榻榻米與神龕，白天屋簷陰影下也看得見內部）
  const hallLight = new THREE.PointLight(0xffc27a, 2.2, 13, 2.0);
  hallLight.position.set(R.x, base + floorTop + 2.4, R.z + 16);
  staticLights.push(hallLight);
  // 簷下紙燈籠的夜燈（加入夜間光源池）
  for (const sx of [-1, 1]) {
    lights.push({ obj: null, x: R.x + sx * 2.25, y: base + floorTop + 2.8, z: R.z + 16 - 6.0, color: 0xffb060, power: 4 });
  }

  // 狛犬一對，夾著正面木階（一張口一閉口，「阿吽」）
  const komY = terrainHeight(R.x, R.z + 8.9);
  const komA = makeKomainu(1.0, true);
  komA.position.set(-3.6, komY, 8.9);
  komA.rotation.y = 0.3;
  g.add(komA);
  const komB = makeKomainu(1.0, false);
  komB.position.set(3.6, komY, 8.9);
  komB.rotation.y = -0.3;
  g.add(komB);
  colliders.push({ x: R.x - 3.6, z: R.z + 8.9, r: 0.9, y: komY, h: 3.0 });
  colliders.push({ x: R.x + 3.6, z: R.z + 8.9, r: 0.9, y: komY, h: 3.0 });

  // 手水舍：進入社殿前先淨手，位置在中鳥居與社殿之間
  const chozY = terrainHeight(R.x + 6.4, R.z - 4);
  const choz = makeChozuya(1.0);
  choz.position.set(6.4, chozY, -4);
  g.add(choz);
  colliders.push({ x: R.x + 6.4, z: R.z - 4, hw: 2.7, hd: 2.0, y: chozY, h: 4.4 });

  // 繪馬掛：參道另一側，與手水舍相對
  const emaY = terrainHeight(R.x - 6.5, R.z - 2);
  const ema = makeEma();
  ema.position.set(-6.5, emaY, -2);
  ema.rotation.y = 0.5;
  g.add(ema);
  colliders.push({ x: R.x - 6.5, z: R.z - 2, hw: 1.9, hd: 0.5, y: emaY, h: 2.2 });

  // 石燈籠列：貼著境內參道，每盞各自取樣腳下地形高度
  for (let i = 0; i < 6; i++) {
    const z = -72 + i * 12;
    for (const sx of [-1, 1]) {
      const ly = terrainHeight(R.x + sx * 5.6, R.z + z);
      const L = makeLantern(1.0);
      L.position.set(sx * 5.6, ly, z);
      g.add(L);
      lights.push({ obj: L, x: R.x + sx * 5.6, y: ly + 1.9, z: R.z + z, color: 0xffb066, power: 5 });
    }
  }
  // 石段兩側也立燈籠（夜裡下山的路看得見）
  for (const z of [-104, -128, -152, -176]) {
    const ly = terrainHeight(R.x - 4.6, R.z + z);
    const L = makeLantern(0.9);
    L.position.set(-4.6, ly, z);
    g.add(L);
    lights.push({ obj: L, x: R.x - 4.6, y: ly + 1.7, z: R.z + z, color: 0xffb066, power: 4 });
  }

  // 守矢神社分社（原作：本殿旁的小分社）+ 迷你鳥居
  const sub = makeHaidenOpen(4.5, 3.6, 2.5, { roofH: 2.2, open: -1 });
  sub.position.set(14, terrainHeight(R.x + 14, R.z + 18), 18);
  g.add(sub);
  colliders.push({ x: R.x + 14, z: R.z + 18 + 1.7, hw: 2.25, hd: 0.15, y: base, h: 3 });
  colliders.push({ x: R.x + 14 - 2.15, z: R.z + 18, hw: 0.15, hd: 1.8, y: base, h: 3 });
  colliders.push({ x: R.x + 14 + 2.15, z: R.z + 18, hw: 0.15, hd: 1.8, y: base, h: 3 });
  const miniT = makeTorii(0.55);
  miniT.position.set(14, terrainHeight(R.x + 14, R.z + 11), 11);
  g.add(miniT);

  // 切妻倉庫（原作：社殿旁的獨立平屋倉庫）
  const store = makeHall(6, 5, 2.8, { roofMat: MAT.roofBlack, wallMat: MAT.planks, roofH: 2.4 });
  store.position.set(-14, terrainHeight(R.x - 14, R.z + 20), 20);
  store.rotation.y = 0.18;
  g.add(store);
  colliders.push({ x: R.x - 14, z: R.z + 20, hw: 3.5, hd: 3.0, y: base, h: 5.5, rotY: 0.18 });

  // 側屋（靈夢住的地方）
  const side = makeHall(6.5, 6, 3.0, { roofH: 2.6 });
  side.position.set(-13, base - 0.3, 6);
  side.rotation.y = 0.3;
  g.add(side);
  colliders.push({ x: R.x - 13, z: R.z + 6, hw: 3.8, hd: 3.6, y: base, h: 6 });

  // 玉垣：朱紅圍籬（村裡的木柵欄是另一種）
  for (const sx of [-1, 1]) {
    const f = makeTamagaki(40);
    f.rotation.y = Math.PI / 2;
    f.position.set(sx * 22, base, 0);
    g.add(f);
  }

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 人間之里 —— 2026-07 第三輪擴充。
 *
 *  舊版只有一圈隨機散布的民家，不像「里」。這版補上街廓結構：
 *  ・十字街道（東西大街＋南北街），中央是帶水井的廣場
 *  ・沿大街兩側的連棟町屋（商店街）
 *  ・原作地標：鈴奈庵（租書店，暖簾＋書箱）、寺子屋（慧音的學堂，在慧音旁）、
 *    稗田家（求聞持的大宅，圍牆＋門＋主屋）
 *  ・里外的田園（田壟＋作物＋圍籬）與石燈籠街燈
 *  ・阿福婆的糰子攤留在她站的位置（11,-7），町屋排讓開 */
function buildVillage(colliders, lights) {
  const R = REGION_BY_ID.village;
  const g = new THREE.Group();
  g.name = 'village';
  const rnd = mulberry32(7788);

  // ---- 街道 ----
  g.add(buildGroundPath(R, 8, -105, 105, 0, MAT.cobble, 64, 'x'));  // 東西大街
  g.add(buildGroundPath(R, 6, -105, 105, 0, MAT.stone, 64, 'z'));   // 南北街

  // ---- 町屋：沿大街兩側的連棟町屋 ----
  // 北面 z=-9（正面朝南对街）、南面 z=+9（正面朝北），阿福婆攤位 (11,-7) 前的北面留空
  const rowX = [14, 20.4, 26.8, 33.2, 39.6, 46];
  const placeMachiya = (x, z, faceSouth) => {
    const roll = rnd();
    const h = makeHall(6, 6, 2.9 + rnd() * 0.5, {
      roofMat: roll < 0.25 ? MAT.roofThatch : roll < 0.55 ? MAT.roofBlack : MAT.roof,
      wallMat: rnd() < 0.5 ? MAT.planks : MAT.plaster,
      roofH: 2.4 + rnd() * 0.5,
    });
    const y = terrainHeight(R.x + x, R.z + z);
    h.position.set(x, y, z);
    h.rotation.y = faceSouth ? 0 : Math.PI;
    g.add(h);
    colliders.push({ x: R.x + x, z: R.z + z, hw: 3.3, hd: 3.3, y, h: 5.5, rotY: h.rotation.y });
  };
  for (const x of rowX) {
    placeMachiya(-x, -9, true);                    // 北排西段
    if (x !== 14) placeMachiya(-x, 9, false);      // 南排西段（-14 位讓給鈴奈庵）
  }
  for (const x of rowX) {
    if (x !== 14) placeMachiya(x, -9, true);   // 北排東段（讓出糰子攤）
    if (x === 14 || x >= 39) placeMachiya(x, 9, false);  // 南排東段（中段是稗田家）
  }

  // ---- 鈴奈庵（租書店）：南排西段臨街，暖簾＋門口書箱 ----
  {
    const y = terrainHeight(R.x - 14, R.z + 9);
    const shop = makeHall(6.2, 5.5, 3.0, { roofMat: MAT.roofBlack, wallMat: MAT.planks, roofH: 2.6 });
    shop.position.set(-14, y, 9);
    shop.rotation.y = Math.PI;
    g.add(shop);
    colliders.push({ x: R.x - 14, z: R.z + 9, hw: 3.4, hd: 3.0, y, h: 5.6, rotY: Math.PI });
    // 暖簾：門楣一桿 + 三幅布
    g.add(cyl(0.04, 0.04, 3.0, MAT.woodDark, -14, y + 2.35, 9 - 2.9, 6).rotateZ(Math.PI / 2));
    for (let i = 0; i < 3; i++) {
      g.add(box(0.85, 1.15, 0.04, MAT.clothIndigo, -15.05 + i * 1.05, y + 1.75, 9 - 2.9));
    }
    // 門口書箱
    for (let i = 0; i < 3; i++) {
      g.add(box(0.7, 0.45, 0.5, MAT.woodDark, -16.6, y + 0.22 + i * 0.46, 9 - 2.2, (rnd() - 0.5) * 0.3));
    }
  }

  // ---- 寺子屋（慧音的學堂）：廣場南側，帶庭院圍籬與招牌 ----
  {
    const y = terrainHeight(R.x + 14, R.z + 24);
    const school = makeHall(8, 6, 3.2, { roofMat: MAT.roofThatch, wallMat: MAT.plaster, roofH: 2.8 });
    school.position.set(14, y, 24);
    school.rotation.y = Math.PI;
    g.add(school);
    colliders.push({ x: R.x + 14, z: R.z + 24, hw: 4.3, hd: 3.3, y, h: 6, rotY: Math.PI });
    // 院籬（留出入口）
    for (const [fx, fz, len, rot] of [[9.6, 19.6, 8, 0], [18.4, 19.6, 8, 0], [5.6, 22, 5, Math.PI / 2], [22.4, 22, 5, Math.PI / 2]]) {
      const f = makeFence(len);
      f.position.set(fx, terrainHeight(R.x + fx, R.z + fz), fz);
      f.rotation.y = rot;
      g.add(f);
    }
    // 門柱招牌
    g.add(cyl(0.09, 0.11, 2.2, MAT.woodDark, 12.4, y + 1.1, 19.6, 6));
    g.add(box(1.6, 0.6, 0.08, MAT.planks, 12.4, y + 1.9, 19.6));
  }

  // ---- 稗田家：南排東段臨街的大宅，圍牆＋正門＋主屋 ----
  {
    // 圍牆（北牆留門洞 24..30）
    const wallSegs = [
      [21, 8, 3, 0.35], [33, 8, 3, 0.35],           // 北牆左右段（中心 x, z, 半長）
      [27, 26, 9, 0.35],                            // 南牆
      [18, 17, 4.5, 0.35, true], [36, 17, 4.5, 0.35, true],  // 東西牆（沿 Z）
    ];
    for (const [cx, cz, half, th, alongZ] of wallSegs) {
      const y = terrainHeight(R.x + cx, R.z + cz);
      const w = alongZ ? box(th * 2, 2.4, half * 2, MAT.plaster, cx, y + 1.2, cz)
                       : box(half * 2, 2.4, th * 2, MAT.plaster, cx, y + 1.2, cz);
      g.add(w);
      colliders.push({
        x: R.x + cx, z: R.z + cz,
        hw: alongZ ? th : half, hd: alongZ ? half : th,
        y, h: 2.4,
      });
    }
    // 正門：門柱＋門屋頂
    const gy = terrainHeight(R.x + 27, R.z + 8);
    for (const sx of [-1, 1]) {
      g.add(cyl(0.16, 0.18, 3.0, MAT.woodDark, 27 + sx * 1.6, gy + 1.5, 8, 8));
      colliders.push({ x: R.x + 27 + sx * 1.6, z: R.z + 8, r: 0.24, y: gy, h: 3 });
    }
    const gateRoof = new THREE.Mesh(curvedRoof(5.2, 1.6, 1.0, 0.3, 0.3), MAT.roofBlack);
    gateRoof.position.set(27, gy + 3.0, 8);
    gateRoof.castShadow = true;
    g.add(gateRoof);
    // 主屋
    const hy = terrainHeight(R.x + 27, R.z + 19);
    const house = makeHall(9, 6.5, 3.4, { roofMat: MAT.roof, wallMat: MAT.plaster, roofH: 3.0 });
    house.position.set(27, hy, 19);
    house.rotation.y = Math.PI;
    g.add(house);
    colliders.push({ x: R.x + 27, z: R.z + 19, hw: 4.8, hd: 3.6, y: hy, h: 6.4, rotY: Math.PI });
    // 門內石燈籠一對
    for (const sx of [-1, 1]) {
      const L = makeLantern(0.85);
      const ly = terrainHeight(R.x + 27 + sx * 2.6, R.z + 10.5);
      L.position.set(27 + sx * 2.6, ly, 10.5);
      g.add(L);
      lights.push({ obj: L, x: R.x + 27 + sx * 2.6, y: ly + 1.6, z: R.z + 10.5, color: 0xffb066, power: 4 });
    }
  }

  // ---- 田園：里東的兩塊田（田壟＋作物＋圍籬） ----
  for (const [fx, fz, fw, fd, rot] of [[56, 14, 12, 8, 0.15], [56, -14, 10, 8, -0.1]]) {
    const plot = new THREE.Group();
    plot.add(box(fw, 0.14, fd, MAT.soil, 0, 0.07, 0));
    const rows = [];
    const nRows = Math.floor(fd / 1.6);
    for (let i = 0; i < nRows; i++) {
      const r = new THREE.BoxGeometry(fw - 1, 0.4, 0.5);
      r.translate(0, 0.32, -fd / 2 + 0.9 + i * 1.6);
      rows.push(r);
    }
    const crops = new THREE.Mesh(BGU.mergeGeometries(rows), MAT.crop);
    crops.castShadow = true;
    plot.add(crops);
    const y = terrainHeight(R.x + fx, R.z + fz);
    plot.position.set(fx, y, fz);
    plot.rotation.y = rot;
    g.add(plot);
  }

  // ---- 外圈散戶（保留舊版的隨機民家，避開街廓與田園） ----
  let placed = 0, guard = 0;
  while (placed < 12 && guard++ < 200) {
    const a = rnd() * Math.PI * 2;
    const d = 50 + rnd() * 50;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.abs(z) < 13 && Math.abs(x) < 54) continue;   // 東西大街廊道
    if (Math.abs(x) < 10 && Math.abs(z) < 54) continue;   // 南北街廊道
    if (x > 40 && Math.abs(z) < 24) continue;             // 田園區
    if (x > 6 && x < 22 && z > 16 && z < 32) continue;    // 寺子屋
    const wx = x + R.x, wz = z + R.z;
    const y = terrainHeight(wx, wz);
    const w = 5 + rnd() * 4.5, dpt = 4.5 + rnd() * 3.5;
    // 每戶隨機搭配：白灰泥牆或木板牆 × 瓦頂、茅草頂或黑瓦 —— 村子一眼就有貧富與年代差
    const roll = rnd();
    const h = makeHall(w, dpt, 2.8 + rnd() * 1.1, {
      roofMat: roll < 0.22 ? MAT.roofThatch : roll < 0.5 ? MAT.roofBlack : MAT.roof,
      wallMat: rnd() < 0.45 ? MAT.planks : MAT.plaster,
    });
    h.position.set(x, y, z);
    h.rotation.y = -a + Math.PI / 2 + (rnd() - 0.5) * 0.5;
    g.add(h);
    colliders.push({ x: wx, z: wz, hw: w / 2 + 0.5, hd: dpt / 2 + 0.5, y, h: 6, rotY: h.rotation.y });
    placed++;

    if (rnd() < 0.55) {
      const l = makePaperLantern(1.0);
      l.position.set(x + (rnd() - 0.5) * 5, y + 3.2, z + (rnd() - 0.5) * 5);
      g.add(l);
      lights.push({ obj: l, x: l.position.x + R.x, y: l.position.y, z: l.position.z + R.z, color: 0xff9a4a, power: 4 });
    }
  }

  // ---- 中央廣場：石板地 + 水井 ----
  const cy = terrainHeight(R.x, R.z);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(12, 28), MAT.cobble);
  plaza.geometry.rotateX(-Math.PI / 2);
  // 圓盤 UV 預設 0..1 鋪滿整個直徑，24m 只蓋 3 塊貼圖會太粗；拉到與街道同級
  const puv = plaza.geometry.attributes.uv;
  for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * 7, puv.getY(i) * 7);
  plaza.position.set(0, cy + 0.15, 0);      // 比街道高 0.07，避免與街道貼面閃爍
  plaza.receiveShadow = true;
  g.add(plaza);
  addClearing(R.x, R.z, 13, 13);            // 廣場除草

  const well = new THREE.Group();
  well.add(cyl(1.3, 1.4, 1.1, MAT.stone, 0, 0.55, 0, 12));
  well.add(cyl(1.15, 1.15, 0.1, MAT.stoneDark, 0, 1.05, 0, 12));
  for (const sx of [-1, 1]) well.add(cyl(0.1, 0.1, 2.6, MAT.woodDark, sx * 1.15, 2.0, 0, 6));
  const wr = new THREE.Mesh(curvedRoof(3.4, 2.6, 1.1, 0.3, 0.28), MAT.roof);
  wr.position.y = 3.3;
  wr.castShadow = true;
  well.add(wr);
  well.position.set(0, cy, 0);
  g.add(well);
  colliders.push({ x: R.x, z: R.z, r: 1.5, y: cy, h: 1.2 });

  // 里的入口鳥居（比較樸素），在南街盡頭
  const t = makeTorii(1.15);
  const tz = 108;
  t.position.set(0, terrainHeight(R.x, R.z + tz), tz);
  g.add(t);

  // ---- 市集攤位 —— 廣場邊的三頂棚子（阿福婆的糰子攤是 (10,-6) 那頂） ----
  const stallAt = (sx, sz, ry, cloth) => {
    const s = new THREE.Group();
    const y = terrainHeight(R.x + sx, R.z + sz);
    for (const px of [-1.6, 1.6]) for (const pz of [-1.1, 1.1]) {
      s.add(cyl(0.09, 0.11, 2.4, MAT.woodDark, px, 1.2, pz, 6));
    }
    const top = box(3.9, 0.09, 2.9, cloth, 0, 2.5, 0);
    top.rotation.z = 0.07;
    s.add(top);
    // 檯面與貨
    s.add(box(3.2, 0.12, 1.5, MAT.deck, 0, 0.95, 0));
    const rnd2 = mulberry32(Math.round(sx * 91 + sz * 57));
    for (let i = 0; i < 5; i++) {
      s.add(box(0.34 + rnd2() * 0.3, 0.28 + rnd2() * 0.22, 0.34 + rnd2() * 0.3,
        rnd2() < 0.5 ? MAT.woodDark : MAT.plaster,
        -1.2 + i * 0.6, 1.15, (rnd2() - 0.5) * 0.8, rnd2() * 3));
    }
    const lamp = makePaperLantern(0.9);
    lamp.position.set(1.5, 2.1, 1.2);
    s.add(lamp);
    lights.push({ obj: lamp, x: R.x + sx + 1.5, y: y + 2.1, z: R.z + sz + 1.2, color: 0xff9a4a, power: 3 });
    s.position.set(sx, y, sz);
    s.rotation.y = ry;
    g.add(s);
    colliders.push({ x: R.x + sx, z: R.z + sz, hw: 2, hd: 1.5, y, h: 2.6, rotY: ry });
  };
  stallAt(10, -6, 0.5, MAT.clothRed);
  stallAt(-11, 3, -0.4, MAT.clothIndigo);
  stallAt(4, 12, 2.6, MAT.clothRed);

  // ---- 大街石燈籠（夜裡的街燈） ----
  for (const [lx, lz] of [[-42, 5.5], [-26, -5.5], [-10, 5.5], [10, -5.5], [26, 5.5], [42, -5.5]]) {
    const ly = terrainHeight(R.x + lx, R.z + lz);
    const L = makeLantern(1.0);
    L.position.set(lx, ly, lz);
    g.add(L);
    lights.push({ obj: L, x: R.x + lx, y: ly + 1.9, z: R.z + lz, color: 0xffb066, power: 5 });
  }

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 紅魔館 —— 湖畔的西洋要塞改建成的宅邸。
 *
 *  原作設定：紅魔館窗戶很少（城塞防禦性建築改建為住宅，並非採光用洋樓），
 *  外型帶有惡魔城式的高塔與雉堞。舊版本開了 62 扇大暖光窗、用淺粉色去乘紅磚
 *  照片貼圖，兩者疊加起來洗白了整棟建築，是「太亮」的根本原因。
 *  這版：磚牆維持照片原色不疊亮色調、窗戶砍到個位數、牆體改用鐵鑄般的近黑線腳，
 *  屋簷加雉堞，牆體拆成四片獨立牆板讓南面留出真正能走進去的正門。 */
function buildMansion(colliders, lights, staticLights) {
  const R = REGION_BY_ID.sdm;
  const g = new THREE.Group();
  g.name = 'sdm';
  const base = R.elev;

  const W = 34, D = 20, H = 15, WT = 1.0;   // WT = 牆厚
  const doorW = 5.2;

  // 基座
  g.add(box(W + 2.2, 1.2, D + 2.2, MAT.stone, 0, base + 0.6, 0));

  // 四片牆板（南牆留門洞）—— 拆成獨立牆板而非一整塊實心箱，
  // 牆洞才是真正能走進去的空間，不是貼圖騙眼睛。
  g.add(box(W, H, WT, MAT.brickRed, 0, base + H / 2, -D / 2 + WT / 2));      // 北牆
  g.add(box(WT, H, D, MAT.brickRed, -W / 2 + WT / 2, base + H / 2, 0));      // 西牆
  g.add(box(WT, H, D, MAT.brickRed, W / 2 - WT / 2, base + H / 2, 0));       // 東牆
  const southSeg = (W - doorW) / 2;
  for (const sx of [-1, 1]) {
    g.add(box(southSeg, H, WT, MAT.brickRed,
      sx * (doorW / 2 + southSeg / 2), base + H / 2, D / 2 - WT / 2));
  }
  // 門楣（門洞上方的過樑，補回結構的連續性）
  g.add(box(doorW + 0.6, H - 5.2, WT, MAT.brickRed, 0, base + H - (H - 5.2) / 2, D / 2 - WT / 2));
  // 鐵鑄門框
  g.add(box(doorW + 0.5, 0.5, WT + 0.3, MAT.ironTrim, 0, base + 5.2, D / 2 - WT / 2));
  for (const sx of [-1, 1]) {
    g.add(box(0.4, 5.2, WT + 0.3, MAT.ironTrim, sx * doorW / 2, base + 2.6, D / 2 - WT / 2));
  }
  colliders.push({ x: R.x - (doorW / 2 + southSeg / 2), z: R.z + D / 2 - WT / 2, hw: southSeg / 2, hd: WT, y: base, h: H });
  colliders.push({ x: R.x + (doorW / 2 + southSeg / 2), z: R.z + D / 2 - WT / 2, hw: southSeg / 2, hd: WT, y: base, h: H });
  colliders.push({ x: R.x, z: R.z - D / 2 + WT / 2, hw: W / 2, hd: WT, y: base, h: H });
  colliders.push({ x: R.x - W / 2 + WT / 2, z: R.z, hw: WT, hd: D / 2, y: base, h: H });
  colliders.push({ x: R.x + W / 2 - WT / 2, z: R.z, hw: WT, hd: D / 2, y: base, h: H });

  // 簷口 —— 鐵鑄近黑色，不再是淺粉色
  g.add(box(W + 1.2, 1.0, D + 1.2, MAT.ironTrim, 0, base + H, 0));
  // 雉堞（城垛）：沿簷口一整圈的矩齒，要塞感的關鍵
  {
    const merlonGeo = new THREE.BoxGeometry(1.1, 1.3, 0.9);
    const perimeter = [];
    const step = 2.6;
    for (let x = -W / 2 + 1.5; x <= W / 2 - 1.5; x += step) {
      perimeter.push([x, -D / 2 - 0.1], [x, D / 2 + 0.1]);
    }
    for (let z = -D / 2 + 1.5; z <= D / 2 - 1.5; z += step) {
      perimeter.push([-W / 2 - 0.1, z], [W / 2 + 0.1, z]);
    }
    const inst = new THREE.InstancedMesh(merlonGeo, MAT.ironTrim, perimeter.length);
    const m4 = new THREE.Matrix4();
    perimeter.forEach(([x, z], i) => {
      m4.makeTranslation(x, base + H + 1.65, z);
      inst.setMatrixAt(i, m4);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    inst.castShadow = true;
    g.add(inst);
  }

  // 斜頂（雉堞後方收頭）
  const roof = new THREE.Mesh(curvedRoof(W - 4, D - 4, 5.5, 0.34, 0.2), MAT.roofBlack);
  roof.position.y = base + H + 2.3;
  roof.castShadow = roof.receiveShadow = true;
  g.add(roof);

  // 窗：全棟只留少數幾扇，符合原作「防禦性建築、窗戶很少」的設定，
  // 也是修掉「太亮」的關鍵 —— 材質本身白天是深色玻璃，入夜才透出暖光。
  const windowSpots = [
    [-W / 2 + 5, base + 9.5, 1], [W / 2 - 5, base + 9.5, 1],
    [-W / 2 + 5, base + 9.5, -1], [W / 2 - 5, base + 9.5, -1],
    [0, base + 10.5, -1],
  ];
  for (const [x, y, sz] of windowSpots) {
    const win = box(1.7, 2.8, 0.22, MAT.glassWarm, x, y, sz * (D / 2 + 0.02));
    win.name = 'window';
    win.castShadow = false;
    g.add(win);
    g.add(box(2.05, 3.15, 0.14, MAT.ironTrim, x, y, sz * (D / 2 - 0.06)));
  }

  // 側塔 —— 深磚 + 鐵鑄雉堞頂，窗戶一座只留一扇
  for (const sx of [-1, 1]) {
    const tw = 8, th = 24;
    g.add(box(tw, th, tw, MAT.brickRed2, sx * (W / 2 + 1), base + th / 2, -D / 2 + 3));
    const tr = new THREE.Mesh(new THREE.ConeGeometry(7.2, 8, 4), MAT.roofBlack);
    tr.position.set(sx * (W / 2 + 1), base + th + 4, -D / 2 + 3);
    tr.rotation.y = Math.PI / 4;
    tr.castShadow = true;
    g.add(tr);
    colliders.push({ x: R.x + sx * (W / 2 + 1), z: R.z - D / 2 + 3, hw: tw / 2, hd: tw / 2, y: base, h: th + 8 });

    const win = box(1.3, 2.1, 0.2, MAT.glassWarm, sx * (W / 2 + 1), base + 15, -D / 2 + 3 + tw / 2 + 0.02);
    win.name = 'window';
    g.add(win);
  }

  // ---- 室內：正廳（可從南面門洞走進去） ----
  {
    const ix = 0, iz = -1.5;               // 室內中心（略靠北，留玄關緩衝）
    const iw = W - WT * 2 - 0.4, id = D - WT * 2 - 0.4;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(iw, id), MAT.marbleCheck);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(ix, base + 0.62, iz);
    floor.receiveShadow = true;
    g.add(floor);

    // 牆裙：深色木護牆板 + 上段絨毯壁掛
    const wain = (x, z, w, d, ry) => {
      g.add(box(w, 2.0, d, MAT.darkWood, x, base + 1.0, z, ry));
    };
    wain(0, -D / 2 + WT + 0.05, iw, 0.08, 0);
    for (const sx of [-1, 1]) {
      g.add(box(2.6, 3.2, 0.06, MAT.velvet, sx * (iw / 2 - 3), base + 3.0, -D / 2 + WT + 0.1));
    }

    // 中央大理石柱兩排，暗示縱深的正廳
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      g.add(cyl(0.42, 0.46, H - 1.6, MAT.marblePlain, sx * (iw * 0.28), base + 0.62 + (H - 1.6) / 2, -6 + i * 6, 12));
    }

    // 主樓梯：貼北牆，暗示樓上還有空間（本版不可上樓，純視覺縱深）
    const st = makeStairs(6.5, 9, 0.32, 0.42, MAT.marblePlain);
    st.position.set(0, base + 0.62, -D / 2 + WT + 6.3);
    st.rotation.y = Math.PI;
    g.add(st);
    for (const sx of [-1, 1]) {
      const rail = box(0.1, 1.0, 3.9, MAT.ironTrim, sx * 3.0, base + 2.2, -D / 2 + WT + 4.4);
      g.add(rail);
    }

    // 吊燈：正廳中央，全天候常亮（室內沒有窗光，不跟著晝夜開關）
    const chandelier = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 6, 16), MAT.ironTrim);
    ring.rotation.x = Math.PI / 2;
    chandelier.add(ring);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 6), MAT.candleFlame);
      flame.position.set(Math.cos(a) * 0.9, 0.18, Math.sin(a) * 0.9);
      chandelier.add(flame);
    }
    chandelier.add(cyl(0.03, 0.03, 2.4, MAT.ironTrim, 0, 1.2, 0, 6));
    chandelier.position.set(ix, base + H - 2.4, iz);
    g.add(chandelier);
    const chLight = new THREE.PointLight(0xffb060, 5.5, 24, 2.0);
    chLight.position.set(R.x + ix, base + H - 2.5, R.z + iz);
    staticLights.push(chLight);

    // 兩側壁燭台
    for (const sx of [-1, 1]) for (const zz of [-6, 6]) {
      const sconce = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6), MAT.candleFlame);
      sconce.position.set(sx * (iw / 2 - 0.3), base + 3.4, zz);
      g.add(sconce);
      const sl = new THREE.PointLight(0xff9a4a, 1.6, 9, 2.0);
      sl.position.set(R.x + sx * (iw / 2 - 0.3), base + 3.4, R.z + zz);
      staticLights.push(sl);
    }

    INTERIORS.push({
      id: 'sdm-hall', zh: '紅魔館正廳', en: 'SCARLET DEVIL MANSION — GRAND HALL',
      enter: { x: R.x, z: R.z + D / 2 - 3 }, inside: { x: R.x + ix, y: base + 0.7, z: R.z + iz },
      exit: { x: R.x, z: R.z + D / 2 + 6 },
    });
  }

  // 中央鐘塔
  const ct = box(7, 32, 7, MAT.brickRed, 0, base + 16, -D / 2 - 3.5);
  g.add(ct);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), MAT.plaster);
  clock.position.set(0, base + 27, -D / 2 - 3.5 - 3.55);
  clock.rotation.y = Math.PI;
  g.add(clock);
  const hands = new THREE.Group();
  hands.name = 'clock-hands';
  const hh = box(0.16, 1.5, 0.08, MAT.woodDark, 0, 0.75, 0);
  const mh = box(0.11, 2.1, 0.06, MAT.woodDark, 0, 1.05, 0);
  mh.name = 'minute';
  hh.name = 'hour';
  hands.add(hh, mh);
  hands.position.set(0, base + 27, -D / 2 - 7.15);
  g.add(hands);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(5.2, 9, 4), MAT.roofBlack);
  spire.position.set(0, base + 36, -D / 2 - 3.5);
  spire.rotation.y = Math.PI / 4;
  spire.castShadow = true;
  g.add(spire);
  colliders.push({ x: R.x, z: R.z - D / 2 - 3.5, hw: 3.5, hd: 3.5, y: base, h: 40 });

  // 大門
  const gate = new THREE.Group();
  for (const sx of [-1, 1]) {
    gate.add(cyl(0.8, 1.0, 8, MAT.stone, sx * 6, 4, 0, 8));
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), MAT.gold);
    orb.position.set(sx * 6, 8.6, 0);
    orb.castShadow = true;
    gate.add(orb);
    colliders.push({ x: R.x + sx * 6, z: R.z + 42, r: 1.0, y: base, h: 8 });
  }
  gate.add(box(13.5, 0.9, 0.6, MAT.gold, 0, 8.2, 0));
  gate.position.set(0, base, 42);
  g.add(gate);

  // 前庭圍牆
  for (const sx of [-1, 1]) {
    const wall = box(1.0, 4, 46, MAT.brickRed2, sx * 26, base + 2, 20);
    g.add(wall);
    colliders.push({ x: R.x + sx * 26, z: R.z + 20, hw: 0.6, hd: 23, y: base, h: 4 });
  }

  // 庭園路燈
  for (let i = 0; i < 5; i++) {
    for (const sx of [-1, 1]) {
      const p = new THREE.Group();
      p.add(cyl(0.1, 0.14, 4.2, MAT.stoneDark, 0, 2.1, 0, 6));
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8), MAT.paperLamp);
      lamp.position.y = 4.5;
      lamp.name = 'lantern-fire';
      p.add(lamp);
      p.position.set(sx * 12, base, 12 + i * 7);
      g.add(p);
      lights.push({ obj: p, x: R.x + sx * 12, y: base + 4.5, z: R.z + 12 + i * 7, color: 0xff5a55, power: 6 });
    }
  }

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 白玉樓 —— 冥界，滿地櫻花 */
function buildNetherworld(colliders, lights) {
  const R = REGION_BY_ID.netherworld;
  const g = new THREE.Group();
  g.name = 'netherworld';
  const base = R.elev;

  // 長階梯（冥界的招牌）
  const st = makeStairs(14, 40, 0.42, 1.3, MAT.stone);
  st.position.set(0, base - 40 * 0.42, 52 + 40 * 1.3);
  g.add(st);

  // 石燈籠夾道
  for (let i = 0; i < 10; i++) {
    const z = 55 + i * 5.2;
    const y = base - (40 - i * 4) * 0.42 * 0.25;
    for (const sx of [-1, 1]) {
      const L = makeLantern(1.15);
      L.position.set(sx * 9, base, z);
      g.add(L);
      lights.push({ obj: L, x: R.x + sx * 9, y: base + 2.1, z: R.z + z, color: 0xd8a0ff, power: 5 });
    }
  }

  // 白玉樓本體
  const hall = makeHall(18, 13, 5.5, { roofH: 6.0, roofMat: MAT.roofBlack, wallMat: MAT.plaster });
  hall.position.set(0, base, -6);
  g.add(hall);
  colliders.push({ x: R.x, z: R.z - 6, hw: 9.6, hd: 7.2, y: base, h: 12 });

  // 二層
  const upper = makeHall(12, 9, 4.0, { roofH: 4.6, roofMat: MAT.roofBlack });
  upper.position.set(0, base + 11.5, -6);
  upper.scale.setScalar(0.98);
  g.add(upper);

  // 山門
  const t = makeTorii(1.5);
  t.position.set(0, base, 34);
  g.add(t);

  // 西行妖（那棵封印著的巨大櫻樹）
  const trunk = cyl(1.4, 2.6, 16, MAT.woodDark, -26, base + 8, 8, 10);
  g.add(trunk);

  const sakMat = new THREE.MeshStandardMaterial({
    color: 0xffc0d8,
    emissive: 0xff7fae,
    emissiveIntensity: 0.28,
    roughness: 0.85,
    flatShading: true,
  });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = 5.5 + Math.random() * 4;
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(4.2 + Math.random() * 2.4, 1), sakMat);
    blob.position.set(
      -26 + Math.cos(a) * r,
      base + 16 + Math.sin(i * 1.7) * 2.6,
      8 + Math.sin(a) * r
    );
    blob.scale.set(1.2, 0.72, 1.2);
    blob.castShadow = blob.receiveShadow = true;
    g.add(blob);
  }
  // 枝幹
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const br = cyl(0.25, 0.6, 9, MAT.woodDark, 0, 0, 0, 6);
    br.position.set(-26, base + 13, 8);
    br.rotation.z = Math.cos(a) * 0.75;
    br.rotation.x = Math.sin(a) * 0.75;
    br.translateY(4.5);
    g.add(br);
  }
  colliders.push({ x: R.x - 26, z: R.z + 8, r: 2.4, y: base, h: 16 });

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 魔法之森 —— 魔理沙的小屋 + 發光蘑菇 */
function buildForest(colliders, lights) {
  const R = REGION_BY_ID.forest;
  const g = new THREE.Group();
  g.name = 'forest';
  const rnd = mulberry32(31415);

  // 魔理沙的家
  const cy = terrainHeight(R.x, R.z);
  const hut = makeHall(7, 6, 3.2, { roofMat: MAT.roofBlack });
  hut.position.set(0, cy, 0);
  hut.rotation.y = 0.5;
  g.add(hut);
  colliders.push({ x: R.x, z: R.z, hw: 4.2, hd: 3.8, y: cy, h: 7, rotY: 0.5 });

  // 堆在門口的雜物（魔理沙的收藏）
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, d = 5 + rnd() * 5;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const y = terrainHeight(R.x + x, R.z + z);
    const b = box(0.5 + rnd() * 0.8, 0.4 + rnd() * 0.6, 0.5 + rnd() * 0.7,
      rnd() < 0.5 ? MAT.woodDark : MAT.stoneDark, x, y + 0.3, z, rnd() * 3);
    g.add(b);
  }

  // 煙囪
  g.add(box(0.8, 3.4, 0.8, MAT.stoneDark, 2.2, cy + 5.2, -1.6));

  // 發光蘑菇群
  const capGeo = new THREE.SphereGeometry(0.42, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.5, 6);
  stemGeo.translate(0, 0.25, 0);
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x66e0c8, emissive: 0x2fd9b8, emissiveIntensity: 1.4, roughness: 0.6,
  });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0xd8e8dd, roughness: 0.9 });

  const N = 420;
  const caps = new THREE.InstancedMesh(capGeo, capMat, N);
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, N);
  caps.name = 'mushroom-caps';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const v = new THREE.Vector3(), sc = new THREE.Vector3();
  let i = 0, tries = 0;
  while (i < N && tries < N * 12) {
    tries++;
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R.radius * 1.3;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const y = terrainHeight(R.x + x, R.z + z);
    if (y < WORLD.waterLevel + 1) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
    v.set(x, y, z);
    const s = 0.55 + rnd() * 1.15;
    sc.setScalar(s);
    m4.compose(v, q, sc);
    caps.setMatrixAt(i, m4);
    // 傘蓋要架在柄上
    v.y += 0.5 * s;
    m4.compose(v, q, sc);
    caps.setMatrixAt(i, m4);
    v.y -= 0.5 * s;
    m4.compose(v, q, sc);
    stems.setMatrixAt(i, m4);
    i++;
  }
  caps.count = stems.count = i;
  caps.instanceMatrix.needsUpdate = true;
  stems.instanceMatrix.needsUpdate = true;
  caps.frustumCulled = stems.frustumCulled = false;
  g.add(caps, stems);

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 迷途竹林 —— 永遠亭：竹林深處的長屋群 */
function buildBamboo(colliders, lights) {
  const R = REGION_BY_ID.bamboo;
  const g = new THREE.Group();
  g.name = 'bamboo';
  const cy = terrainHeight(R.x, R.z);

  // 主屋（輝夜的居所）—— 座南朝北的長屋
  const hall = makeHall(16, 10, 4.2, { roofH: 4.4 });
  hall.position.set(0, cy, -30);
  g.add(hall);
  colliders.push({ x: R.x, z: R.z - 30, hw: 8.6, hd: 5.6, y: cy, h: 9 });

  // 左右廂房（永琳的診所與藥庫）
  for (const sx of [-1, 1]) {
    const wing = makeHall(9, 7, 3.2, { roofH: 3.0 });
    wing.position.set(sx * 14, terrainHeight(R.x + sx * 14, R.z - 22), -22);
    wing.rotation.y = sx * 0.12;
    g.add(wing);
    colliders.push({ x: R.x + sx * 14, z: R.z - 22, hw: 5, hd: 4, y: cy, h: 7, rotY: sx * 0.12 });
  }

  // 中庭圍籬（南面留口接參道）
  for (const sx of [-1, 1]) {
    const f = makeFence(26);
    f.rotation.y = Math.PI / 2;
    f.position.set(sx * 20, cy, -14);
    g.add(f);
    const f2 = makeFence(20);
    f2.position.set(sx * 15, cy, -34);
    g.add(f2);
  }

  // 門前石階與賽錢箱是沒有的 —— 這裡不是神社，是私宅。
  // 但門口一對石燈籠是有的。
  for (const sx of [-1, 1]) {
    const L = makeLantern(1.1);
    L.position.set(sx * 3.4, cy, -8);
    g.add(L);
    lights.push({ obj: L, x: R.x + sx * 3.4, y: cy + 2.0, z: R.z - 8, color: 0xffc070, power: 5 });
  }

  const t = makeTorii(1.2);
  t.position.set(0, terrainHeight(R.x, R.z + 12), 12);
  g.add(t);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 30, z = Math.sin(a) * 30;
    const L = makeLantern(0.9);
    L.position.set(x, terrainHeight(R.x + x, R.z + z), z);
    g.add(L);
    lights.push({ obj: L, x: R.x + x, y: terrainHeight(R.x + x, R.z + z) + 1.8, z: R.z + z, color: 0xffc070, power: 4 });
  }

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 守矢神社 —— 妖怪之山上的神社，御柱鎮四方 */
/** 御柱（おんばしら）：諏訪信仰的原木巨柱，柱頂纏一圈注連繩。
 *  每根各自取樣腳下地形 —— 立在坡上的柱子不會浮空或插地。 */
function makeOnbashira(R, lx, lz, h, colliders, r = 0.9) {
  const y = terrainHeight(R.x + lx, R.z + lz);
  const g2 = new THREE.Group();
  g2.add(cyl(r * 0.92, r * 1.12, h, MAT.wood, 0, h / 2, 0, 9));
  const rope = new THREE.Mesh(new THREE.TorusGeometry(r + 0.14, 0.11, 6, 14), MAT.straw);
  rope.position.y = h * 0.86;
  rope.rotation.x = Math.PI / 2;
  rope.castShadow = true;
  g2.add(rope);
  g2.position.set(lx, y, lz);
  colliders.push({ x: R.x + lx, z: R.z + lz, r: r * 1.2, y, h });
  return g2;
}

/** 風神湖水線取點：從湖心朝方位角 a 二分搜尋「地形剛好高出水面 targetH」的半徑。
 *  湖岸形狀的唯一真相在 terrainHeight，這裡只是反查，不加自己的常數。 */
export function findLakeshorePoint(a, targetH) {
  let lo = CRATER_LAKE.r * 0.8, hi = CRATER_LAKE.r * 1.8;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const h = terrainHeight(CRATER_LAKE.x + Math.cos(a) * mid, CRATER_LAKE.z + Math.sin(a) * mid);
    if (h < targetH) lo = mid; else hi = mid;
  }
  const r = (lo + hi) / 2;
  return { x: CRATER_LAKE.x + Math.cos(a) * r, z: CRATER_LAKE.z + Math.sin(a) * r, r };
}

/** 守矢神社 —— 依考據重建（2026-07 第四輪）。
 *
 *  考據要點（THBWiki／求聞史紀／諏訪大社原型）：
 *  ・「接近山頂、風神湖湖畔」：社殿立在火口湖東南緣的平台上，背後就是湖。
 *  ・參拜動線：索道山上站 → 大鳥居（低）→ 登山石段 → 二之鳥居 → 石板參道
 *    → 賽銭箱 → 高處拜殿（原型為諏訪大社下社秋宮神樂殿）。
 *  ・巨大注連繩：神樂殿的招牌，目測比博麗的粗好幾倍（makeShimenawa k=2.6）。
 *  ・御柱（おんばしら）：殿後四根 + 湖畔一列五根 —— 諏訪信仰的招牌，
 *    水邊立柱是諏訪大社最有名的景觀。
 *  Y 一律 terrainHeight 取樣；拜殿先用石垣地基把四隅高差抹平再落柱。 */
function buildMoriya(colliders, lights) {
  const R = REGION_BY_ID.moriya;
  const g = new THREE.Group();
  g.name = 'moriya';
  const AX = 6;                 // 參道軸線的 x 偏移（朝向索道山上站那側）

  addClearing(R.x + AX, R.z - 14, 18, 16);

  // 大鳥居（低處、索道站那側）→ 登山石段 → 二之鳥居 → 石板參道
  for (const [z, s] of [[34, 1.15], [12, 1.3]]) {
    const ty = terrainHeight(R.x + AX, R.z + z);
    const t = makeTorii(s);
    t.position.set(AX, ty, z);
    g.add(t);
    const W = 5.4 * s / 2;
    colliders.push({ x: R.x + AX - W, z: R.z + z, r: 0.4 * s, y: ty, h: 7 * s });
    colliders.push({ x: R.x + AX + W, z: R.z + z, r: 0.4 * s, y: ty, h: 7 * s });
  }
  g.add(makeTerrainStairs(R, 6, 32, 14, AX));
  g.add(buildGroundPath(R, 5.5, -8, 14, AX, MAT.stone));

  // 拜殿：平台西北緣、背對風神湖。地基先取四隅最高點築石垣抹平，
  // 坡側會露出石牆 —— 山地寺社本來就是這樣蓋的。
  const HX = AX, HZ = -18;
  const HW = 13, HD = 9.5, HWALL = 4.6;
  let hallBase = -Infinity;
  for (const cx of [HX - HW / 2, HX + HW / 2]) {
    for (const cz of [HZ - HD / 2, HZ + HD / 2]) {
      hallBase = Math.max(hallBase, terrainHeight(R.x + cx, R.z + cz));
    }
  }
  hallBase += 0.12;
  g.add(box(HW + 2.4, 3.6, HD + 2.4, MAT.stoneWall, HX, hallBase - 1.8, HZ));
  const hall = makeHaidenOpen(HW, HD, HWALL, { roofH: 4.4, open: 1 });
  hall.position.set(HX, hallBase, HZ);
  g.add(hall);
  colliders.push({ x: R.x + HX, z: R.z + HZ - HD / 2, hw: HW / 2, hd: 0.2, y: hallBase, h: HWALL }); // 後牆
  colliders.push({ x: R.x + HX - HW / 2, z: R.z + HZ, hw: 0.2, hd: HD / 2, y: hallBase, h: HWALL }); // 左牆
  colliders.push({ x: R.x + HX + HW / 2, z: R.z + HZ, hw: 0.2, hd: HD / 2, y: hallBase, h: HWALL }); // 右牆
  // 可行走面：石垣基座頂 + 高床地板。少了這兩個，走進拜殿會直接沉進地板
  // （室內只有地形高度，比榻榻米面低 1m 多）。0.55 的級高正好卡在
  // controller 的步高容許邊界，從基座頂一步踏上地板。
  colliders.push({ x: R.x + HX, z: R.z + HZ, hw: (HW + 2.4) / 2, hd: (HD + 2.4) / 2, y: hallBase - 3.6, h: 3.6, walk: 1 }); // 石垣基座
  colliders.push({ x: R.x + HX, z: R.z + HZ, hw: (HW + 1.0) / 2, hd: (HD + 1.0) / 2, y: hallBase, h: 0.55, walk: 1 }); // 高床地板

  // 巨大注連繩（2.6 倍粗）橫掛拜殿正面，中央垂大鈴緒
  const nawa = makeShimenawa(HW - 2, 2.6);
  nawa.position.set(HX, hallBase + HWALL - 0.6, HZ + HD / 2 - 0.55);
  g.add(nawa);
  const suzu = makeSuzuBell(2.0);
  suzu.position.set(HX, hallBase + HWALL - 0.66, HZ + HD / 2 - 0.55);
  g.add(suzu);

  // 賽銭箱 + 狐狛犬一對（守矢是御柱與蛇（青蛙）信仰，不拜犬）
  const saisenY = terrainHeight(R.x + HX, R.z - 10.5);
  const saisen = makeSaisenBox(1.15);
  saisen.position.set(HX, saisenY, -10.5);
  g.add(saisen);
  colliders.push({ x: R.x + HX, z: R.z - 10.5, hw: 1.6, hd: 0.7, y: saisenY, h: 1.5 });
  for (const sx of [-1, 1]) {
    const fox = makeKomainu(0.95, sx < 0);
    const fy = terrainHeight(R.x + HX + sx * 4.2, R.z - 11.8);
    fox.position.set(HX + sx * 4.2, fy, -11.8);
    fox.rotation.y = sx * 0.3;
    g.add(fox);
  }

  // 手水舍：參道旁，參拜前淨手
  const chozY = terrainHeight(R.x + 13, R.z + 4);
  const choz = makeChozuya(1.0);
  choz.position.set(13, chozY, 4);
  g.add(choz);
  colliders.push({ x: R.x + 13, z: R.z + 4, hw: 2.7, hd: 2.0, y: chozY, h: 4.4 });

  // 御柱：殿後四根（諏訪大社四隅立柱的作法）
  for (const px of [HX - 10, HX + 10]) for (const pz of [-19, -24]) {
    g.add(makeOnbashira(R, px, pz, 11, colliders));
  }
  // 湖畔一列五根：沿水線立ち並ぶ。湖岸的形狀每個方位都不同，
  // 用二分反查水線位置，保證每根都剛好站在水邊而不泡在水裡。
  for (let i = 0; i < 5; i++) {
    const a = (20 + i * 12.5) * Math.PI / 180;
    const p = findLakeshorePoint(a, CRATER_LAKE.waterY + 1.6);
    g.add(makeOnbashira(R, p.x - R.x, p.z - R.z, 9, colliders, 0.75));
  }

  // 石燈籠列：參道兩側，各取樣腳下地形
  for (let i = 0; i < 4; i++) {
    const z = 26 - i * 10;
    for (const sx of [-1, 1]) {
      const ly = terrainHeight(R.x + AX + sx * 4.8, R.z + z);
      const L = makeLantern(1.0);
      L.position.set(AX + sx * 4.8, ly, z);
      g.add(L);
      lights.push({ obj: L, x: R.x + AX + sx * 4.8, y: ly + 1.9, z: R.z + z, color: 0x9ad0ff, power: 5 });
    }
  }

  INTERIORS.push({
    id: 'moriya-haiden', zh: '守矢神社拜殿', en: 'MORIYA SHRINE — HAIDEN',
    enter: { x: R.x + HX, z: R.z + HZ + HD / 2 + 0.6 },
    inside: { x: R.x + HX, y: hallBase + 0.7, z: R.z + HZ },
    exit: { x: R.x + HX, z: R.z - 7 },
  });

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 命蓮寺 —— 山門、本堂與三重塔 */
function buildMyouren(colliders, lights) {
  const R = REGION_BY_ID.myouren;
  const g = new THREE.Group();
  g.name = 'myouren';
  const base = R.elev;

  // 山門：兩柱一頂的山門（不用鳥居，寺不是神社）
  const gate = new THREE.Group();
  for (const sx of [-1, 1]) {
    gate.add(cyl(0.42, 0.5, 6.4, MAT.woodDark, sx * 3, 3.2, 0, 10));
    colliders.push({ x: R.x + sx * 3, z: R.z + 40, r: 0.5, y: base, h: 6.4 });
  }
  const gateRoof = new THREE.Mesh(curvedRoof(9.5, 3.4, 2.0, 0.3, 0.4), MAT.roof);
  gateRoof.position.y = 6.6;
  gateRoof.castShadow = gateRoof.receiveShadow = true;
  gate.add(gateRoof);
  gate.position.set(0, base, 40);
  g.add(gate);

  // 本堂
  const hall = makeHall(14, 10, 4.6, { roofH: 4.6 });
  hall.position.set(0, base, -6);
  g.add(hall);
  colliders.push({ x: R.x, z: R.z - 6, hw: 7.6, hd: 5.6, y: base, h: 9.5 });

  // 三重塔：塔身逐層收分，每層都挑一圈大屋簷
  let ty = base;
  const tiers = [[7.2, 3.4], [5.6, 2.9], [4.2, 2.5]];
  for (let i = 0; i < 3; i++) {
    const [w, h] = tiers[i];
    g.add(box(w, h, w, MAT.plaster, -17, ty + h / 2, 4));
    const eave = new THREE.Mesh(curvedRoof(w + 2.6, w + 2.6, h * 0.52, 0.26, 0.4), MAT.roof);
    eave.position.set(-17, ty + h, 4);
    eave.castShadow = eave.receiveShadow = true;
    g.add(eave);
    ty += h + h * 0.34;
  }
  // 相輪（塔頂的金屬環柱）
  g.add(cyl(0.07, 0.07, 3.4, MAT.gold, -17, ty + 1.6, 4, 6));
  const sorin = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 14), MAT.gold);
  sorin.position.set(-17, ty + 2.6, 4);
  g.add(sorin);
  colliders.push({ x: R.x - 17, z: R.z + 4, hw: 4.4, hd: 4.4, y: base, h: 16 });

  // 石燈籠與卒塔婆
  for (let i = 0; i < 4; i++) {
    const z = 30 - i * 11;
    for (const sx of [-1, 1]) {
      const L = makeLantern(0.95);
      L.position.set(sx * 5.2, base, z);
      g.add(L);
      lights.push({ obj: L, x: R.x + sx * 5.2, y: base + 1.8, z: R.z + z, color: 0xd8b8ff, power: 4 });
    }
  }

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 香霖堂 —— 古道具店，門口永遠堆著用途不明的收藏 */
function buildKourindou(colliders, lights) {
  const R = REGION_BY_ID.kourindou;
  const g = new THREE.Group();
  g.name = 'kourindou';
  const rnd = mulberry32(4896);

  const y = terrainHeight(R.x - 4, R.z - 5);
  const shop = makeHall(8, 6.5, 3.4, { roofMat: MAT.roofBlack });
  shop.position.set(-4, y, -5);
  shop.rotation.y = 0.35;
  g.add(shop);
  colliders.push({ x: R.x - 4, z: R.z - 5, hw: 4.6, hd: 3.9, y, h: 7, rotY: 0.35 });

  // 暖簾
  const noren = box(2.4, 1.1, 0.06, MAT.clothIndigo, -4, y + 2.6, -1.4);
  noren.rotation.y = 0.35;
  g.add(noren);

  // 門口的雜貨山：箱子、桶、看不出用途的外來道具
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2, d = 4 + rnd() * 5;
    const x = -4 + Math.cos(a) * d, z = -5 + Math.sin(a) * d;
    const gy = terrainHeight(R.x + x, R.z + z);
    if (rnd() < 0.4) {
      g.add(cyl(0.4, 0.45, 0.8 + rnd() * 0.5, MAT.wood, x, gy + 0.5, z, 9));
    } else {
      g.add(box(0.5 + rnd() * 0.7, 0.4 + rnd() * 0.5, 0.5 + rnd() * 0.6,
        rnd() < 0.5 ? MAT.woodDark : MAT.stoneDark, x, gy + 0.35, z, rnd() * 3));
    }
  }

  // 招牌燈籠
  const lamp = makePaperLantern(1.2);
  lamp.position.set(-1.2, y + 3.1, -1.8);
  g.add(lamp);
  lights.push({ obj: lamp, x: R.x - 1.2, y: y + 3.1, z: R.z - 1.8, color: 0xffc070, power: 4 });

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 無緣塚 —— 無緣者的墓所，石塔林立 */
function buildMuenzuka(colliders, lights) {
  const R = REGION_BY_ID.muenzuka;
  const g = new THREE.Group();
  g.name = 'muenzuka';
  const rnd = mulberry32(666);

  // 石塔群：一根 instanced 柱子解決，歪歪斜斜才有歲月感
  const geo = new THREE.BoxGeometry(0.55, 1.35, 0.24);
  geo.translate(0, 0.675, 0);
  const N = 42;
  const stones = new THREE.InstancedMesh(geo, MAT.grave, N);
  stones.castShadow = stones.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const v = new THREE.Vector3(), sc = new THREE.Vector3();
  let placed = 0, tries = 0;
  while (placed < N && tries < N * 10) {
    tries++;
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R.radius * 0.8;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const y = terrainHeight(R.x + x, R.z + z);
    if (y < WORLD.waterLevel + 1) continue;
    e.set((rnd() - 0.5) * 0.22, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.22);
    q.setFromEuler(e);
    v.set(x, y - 0.05, z);
    sc.setScalar(0.7 + rnd() * 0.8);
    m4.compose(v, q, sc);
    stones.setMatrixAt(placed, m4);
    placed++;
  }
  stones.count = placed;
  stones.instanceMatrix.needsUpdate = true;
  g.add(stones);

  // 中央的地藏：圓滾滾的，看著所有無緣者
  const jizo = new THREE.Group();
  jizo.add(cyl(0.5, 0.62, 1.1, MAT.stone, 0, 0.55, 0, 10));
  const jizoHead = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), MAT.stone);
  jizoHead.position.y = 1.35;
  jizoHead.castShadow = true;
  jizo.add(jizoHead);
  // 紅圍兜
  jizo.add(cyl(0.44, 0.5, 0.3, MAT.clothRed, 0, 1.02, 0, 10));
  const jy = terrainHeight(R.x, R.z);
  jizo.position.set(0, jy, 0);
  g.add(jizo);
  colliders.push({ x: R.x, z: R.z, r: 0.8, y: jy, h: 1.8 });

  // 兩盞常明燈
  for (const sx of [-1, 1]) {
    const L = makeLantern(0.9);
    L.position.set(sx * 2.6, jy, 1.4);
    g.add(L);
    lights.push({ obj: L, x: R.x + sx * 2.6, y: jy + 1.7, z: R.z + 1.4, color: 0xb89aff, power: 4 });
  }

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 太陽花田 —— 花田中央的小涼亭 */
function buildSunflower(colliders, lights) {
  const R = REGION_BY_ID.sunflower;
  const g = new THREE.Group();
  g.name = 'sunflower';
  const y = terrainHeight(R.x - 6, R.z - 4);

  // 東屋（あずまや）：四柱一方亭，賞花用
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cyl(0.14, 0.17, 3.0, MAT.woodDark, -6 + sx * 1.9, y + 1.5, -4 + sz * 1.9, 8));
  }
  colliders.push({ x: R.x - 6, z: R.z - 4, hw: 2.2, hd: 2.2, y, h: 3 });
  const roof = new THREE.Mesh(curvedRoof(5.6, 5.6, 1.8, 0.2, 0.5), MAT.roof);
  roof.position.set(-6, y + 3.1, -4);
  roof.castShadow = roof.receiveShadow = true;
  g.add(roof);
  // 長椅
  g.add(box(3.0, 0.12, 0.6, MAT.wood, -6, y + 0.55, -4.9));
  g.add(box(3.0, 0.12, 0.6, MAT.wood, -6, y + 0.55, -3.1));

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 瀑布共享的時間 uniform —— 主迴圈每幀推進，水流才會真的往下跑，
 *  不然靜止的瀑布看起來就是一塊藍白色的牆。 */
export const FALLS = { uTime: { value: 0 } };

/** 瀑布：垂直面片 + UV 向下捲動的水流貼圖，底部一圈水花 instanced 面片。
 *  不依賴地形真的挖出懸崖，直接貼著現有坡面擺一片會流動的水牆——
 *  在風格化的世界裡這樣完全站得住腳，成本只有一個 draw call。 */
function buildWaterfall(width, height) {
  const g = new THREE.Group();
  g.name = 'waterfall';

  const mat = new THREE.MeshStandardMaterial({
    color: 0xbfe0ea, transparent: true, opacity: 0.72, roughness: 0.2, metalness: 0.1,
    emissive: 0x8fc4d8, emissiveIntensity: 0.18,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = FALLS.uTime;
    mat.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vFallUv;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n  vFallUv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying vec2 vFallUv;
        float fallHash(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5); }`)
      .replace('#include <opaque_fragment>', `
        {
          float scroll = fract(vFallUv.y * 3.0 - uTime * 1.3);
          float streak = fallHash(vec2(floor(vFallUv.x * 24.0), floor(uTime * 6.0 + vFallUv.y * 8.0)));
          float veil = smoothstep(0.0, 0.5, scroll) * smoothstep(1.0, 0.5, scroll);
          outgoingLight += vec3(0.75, 0.86, 0.9) * veil * (0.35 + streak * 0.5);
        }
        #include <opaque_fragment>`);
  };

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 12), mat);
  plane.position.y = height / 2;
  g.add(plane);

  // 底部水花潭：半透明圓盤 + instanced 泡沫點
  const pool = new THREE.Mesh(new THREE.CircleGeometry(width * 0.62, 20), new THREE.MeshStandardMaterial({
    color: 0xdff0f4, transparent: true, opacity: 0.55, roughness: 0.12, metalness: 0.2,
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.05;
  g.add(pool);

  const foamGeo = new THREE.SphereGeometry(0.16, 6, 5);
  const foamMat = new THREE.MeshStandardMaterial({ color: 0xf4fafc, roughness: 0.4, transparent: true, opacity: 0.85 });
  const N = 26;
  const foam = new THREE.InstancedMesh(foamGeo, foamMat, N);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * width * 0.55;
    m4.makeTranslation(Math.cos(a) * d, 0.1 + Math.random() * 0.2, Math.sin(a) * d * 0.4);
    foam.setMatrixAt(i, m4);
  }
  foam.instanceMatrix.needsUpdate = true;
  foam.frustumCulled = false;
  g.add(foam);

  return g;
}

/** 天狗聚落 —— 妖怪之山山腰的木造聚落，非山頂的守矢神社。
 *  文有一半的家當在這裡：瞭望台看整片幻想鄉，居酒屋式的聚會所是天狗
 *  喝酒吵架的地方（她自己在對話裡提過）。旁邊補一道瀑布，山才有山的樣子。 */
function buildTenguVillage(colliders, lights) {
  const R = REGION_BY_ID.tenguVillage;
  const g = new THREE.Group();
  g.name = 'tenguVillage';
  const base = R.elev;

  // 聚會所：木板牆、黑瓦頂
  const hall = makeHall(11, 8, 3.4, { roofMat: MAT.roofBlack, wallMat: MAT.planks });
  hall.position.set(-6, base, 4);
  hall.rotation.y = 0.3;
  g.add(hall);
  colliders.push({ x: R.x - 6, z: R.z + 4, hw: 6.6, hd: 4.8, y: base, h: 7, rotY: 0.3 });

  // 瞭望台：疊箱收分 + 頂端鐘
  const towerX = 14, towerZ = -10;
  const ty0 = terrainHeight(R.x + towerX, R.z + towerZ);
  const tiers = [[3.4, 3.0], [2.6, 2.6], [1.9, 2.2]];
  let ty = ty0;
  for (const [w, h] of tiers) {
    g.add(box(w, h, w, MAT.wood, towerX, ty + h / 2, towerZ));
    ty += h;
  }
  const towerRoof = new THREE.Mesh(curvedRoof(3.0, 3.0, 1.4, 0.22, 0.4), MAT.roofBlack);
  towerRoof.position.set(towerX, ty + 0.7, towerZ);
  towerRoof.castShadow = towerRoof.receiveShadow = true;
  g.add(towerRoof);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), MAT.gold);
  bell.position.set(towerX, ty + 1.6, towerZ);
  g.add(bell);
  colliders.push({ x: R.x + towerX, z: R.z + towerZ, hw: 1.9, hd: 1.9, y: ty0, h: ty - ty0 + 1.6 });

  // 聚會所與瞭望台之間掛一串紙燈籠，順著坡地高低走
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const lx = -6 + (towerX + 6) * t, lz = 4 + (towerZ - 4) * t;
    const ly = terrainHeight(R.x + lx, R.z + lz) + 2.6;
    const lp = makePaperLantern(0.85);
    lp.position.set(lx, ly, lz);
    g.add(lp);
    lights.push({ obj: lp, x: R.x + lx, y: ly, z: R.z + lz, color: 0xffb066, power: 3 });
  }

  // 九天瀑布：山溪在這裡跌落一階（RIVER 測站 3→4，河床 172→140）。
  // 水源自山頂風神湖、下游進玄武之澤 —— 貼著河道階坎放，不再是憑空噴水。
  // g 最後只在 X/Z 平移到 (R.x, R.z)，Y 維持世界座標不變（本檔慣例）。
  const up = RIVER[3], dn = RIVER[4];
  const fx = (up[0] + dn[0]) / 2 - R.x, fz = (up[1] + dn[1]) / 2 - R.z;
  const falls = buildWaterfall(6, up[2] - dn[2] - 2);
  falls.position.set(fx, dn[2], fz);
  falls.rotation.y = Math.atan2(dn[0] - up[0], dn[1] - up[1]);
  g.add(falls);
  colliders.push({ x: R.x + fx, z: R.z + fz, hw: 3.2, hd: 1.0, y: dn[2], h: 12 });

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 天界 —— 雲上的白石台地，比那名居天子的住處。
 *  不擺滿裝飾，天界的味道是「空曠」：一座開放式的白石涼亭、
 *  一把插在台座上的劍（她的注連劍），僅此而已。 */
function buildTenkai(colliders, lights, staticLights) {
  const R = REGION_BY_ID.tenkai;
  const g = new THREE.Group();
  g.name = 'tenkai';
  const base = R.elev;

  // 白石平台邊緣的欄杆環
  const railGeo = new THREE.TorusGeometry(R.radius * 0.72, 0.12, 6, 48);
  const rail = new THREE.Mesh(railGeo, MAT.marblePlain);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = base + 0.9;
  rail.castShadow = true;
  g.add(rail);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.add(cyl(0.06, 0.06, 0.9, MAT.marblePlain,
      Math.cos(a) * R.radius * 0.72, base + 0.45, Math.sin(a) * R.radius * 0.72, 8));
  }

  // 開放式涼亭：四柱一頂，金色屋簷
  const pav = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    pav.add(cyl(0.16, 0.19, 4.2, MAT.marblePlain, sx * 3.2, 2.1, sz * 2.6, 10));
  }
  const pavRoof = new THREE.Mesh(curvedRoof(8.2, 6.8, 2.2, 0.26, 0.5), MAT.gold);
  pavRoof.position.y = 4.4;
  pavRoof.castShadow = pavRoof.receiveShadow = true;
  pav.add(pavRoof);
  pav.position.set(0, base, -10);
  g.add(pav);
  colliders.push({ x: R.x, z: R.z - 10, hw: 3.6, hd: 3.0, y: base, h: 4.4 });

  // 亭下的燭台，常亮 —— 天界沒有晝夜之分那種寂靜感
  for (const sx of [-1, 1]) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 6), MAT.candleFlame);
    flame.position.set(sx * 3.2, base + 4.0, -10);
    g.add(flame);
    const l = new THREE.PointLight(0xffe0b0, 1.4, 10, 2.0);
    l.position.set(R.x + sx * 3.2, base + 4.0, R.z - 10);
    staticLights.push(l);
  }

  // 注連劍：插在台座上的劍，天子的招牌
  const swordBase = cyl(0.9, 1.05, 0.7, MAT.marbleCheck, 0, base + 0.35, 12, 12);
  g.add(swordBase);
  const blade = box(0.09, 2.6, 0.02, MAT.ironTrim, 0, base + 0.7 + 1.3, 12);
  g.add(blade);
  const guard = box(0.5, 0.1, 0.14, MAT.gold, 0, base + 0.7 + 0.05, 12);
  g.add(guard);
  colliders.push({ x: R.x, z: R.z + 12, r: 1.1, y: base, h: 3.5 });

  // 鳥居式的入口，漆成金白色而非朱紅 —— 這裡不是神社，是天人的領域
  const gate = makeTorii(1.3);
  gate.traverse(o => { if (o.isMesh) o.material = MAT.gold; });
  gate.position.set(0, base, R.radius * 0.6);
  g.add(gate);

  g.position.set(R.x, 0, R.z);
  return g;
}

/** 彼岸 —— 三途川岸，小野塚小町擺渡、四季映姫審判亡者的地方。 */
function buildHigan(colliders, lights, staticLights) {
  const R = REGION_BY_ID.higan;
  const g = new THREE.Group();
  g.name = 'higan';
  const base = R.elev;

  // 冥府的裁判廳：暗紅磚牆、黑瓦，帶官署的方正感
  const hall = makeHall(15, 11, 5.0, { roofMat: MAT.roofBlack, wallMat: MAT.brickRed2 });
  hall.position.set(0, base, -20);
  g.add(hall);
  colliders.push({ x: R.x, z: R.z - 20, hw: 8.6, hd: 6.1, y: base, h: 10 });

  // 廳前一對鐵鑄燭台，長明不滅
  for (const sx of [-1, 1]) {
    const post = cyl(0.08, 0.1, 2.6, MAT.ironTrim, sx * 6, base + 1.3, -8, 8);
    g.add(post);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 6), MAT.candleFlame);
    flame.position.set(sx * 6, base + 2.7, -8);
    g.add(flame);
    const l = new THREE.PointLight(0xffb060, 2.0, 12, 2.0);
    l.position.set(R.x + sx * 6, base + 2.7, R.z - 8);
    staticLights.push(l);
  }

  // 三途川：一道橫貫地區的長水面，河上一葉扁舟
  const river = new THREE.Mesh(new THREE.PlaneGeometry(R.radius * 2.6, 22), new THREE.MeshStandardMaterial({
    color: 0x2a3038, roughness: 0.15, metalness: 0.35, transparent: true, opacity: 0.88,
  }));
  river.rotation.x = -Math.PI / 2;
  river.rotation.z = 0.18;
  river.position.set(0, base - 1.4, 26);
  g.add(river);

  // 小町的渡船：船身 + 船篙，泊在岸邊
  const boat = new THREE.Group();
  const hullGeo = new THREE.CylinderGeometry(0.9, 0.5, 5.4, 6, 1, true);
  hullGeo.rotateZ(Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, MAT.woodDark);
  hull.castShadow = hull.receiveShadow = true;
  boat.add(hull);
  boat.add(box(4.6, 0.08, 1.3, MAT.deck, 0, 0.3, 0));
  const pole = cyl(0.03, 0.04, 3.6, MAT.wood, -1.6, 2.0, 0, 6);
  pole.rotation.z = 0.15;
  boat.add(pole);
  boat.position.set(-8, base - 1.0, 24);
  boat.rotation.y = 0.5;
  g.add(boat);
  colliders.push({ x: R.x - 8, z: R.z + 24, hw: 2.6, hd: 1.1, y: base - 1.5, h: 1.6, rotY: 0.5 });

  // 岸邊的卒塔婆與石燈籠，呼應「亡者渡岸」的意象
  for (let i = 0; i < 5; i++) {
    const x = -30 + i * 15;
    const y = terrainHeight(R.x + x, R.z - 4);
    const L = makeLantern(0.9);
    L.position.set(x, y, -4);
    g.add(L);
    lights.push({ obj: L, x: R.x + x, y: y + 1.7, z: R.z - 4, color: 0x8a94ff, power: 4 });
  }

  g.position.set(R.x, 0, R.z);
  return g;
}

// ---------------------------------------------------------------------------
/** 索道共用資料：兩站位置與貼地弧曲線（整線 buildRopeway 與分圖半段都用）。
 *  路線：貼地弧。兩站直線懸鏈會在半山腰穿山（此坡中腹比弦高大幾十米），
 *  改沿地形 +12m 密取支點、兩端降到站體門廊 +4m，CatmullRom 平滑。
 *  Node 探針驗算（centripetal、26 支點）：全長 390m、鋼索淨空 ≥3.98m，
 *  車廂底再低 2.9m 仍不擦地；三座塔高均勻 12m。 */
function ropewayLine() {
  // 山麓站：湖岸陡坡上的石垣月台（四角地形 25.9→16.9，石垣拔高 9.4m，
  // 東北側與坡面齊平可直接走上下；朝湖一面是 9m 擋土牆，山城的味道）。
  // 山上站：參道東側肩台（四角 350.4→352，基座只補 2.4m），出站即參道。
  const foot = { x: -408, z: -536, F: 26.1, base: 9.4 };
  const top = { x: -580, z: -630, F: 352.15, base: 2.4 };
  const lineYaw = Math.atan2(top.x - foot.x, top.z - foot.z);

  const sup = [new THREE.Vector3(foot.x, foot.F + 4.0, foot.z)];
  for (let t = 0.06; t <= 0.901; t += 0.04) {
    const x = foot.x + (top.x - foot.x) * t, z = foot.z + (top.z - foot.z) * t;
    sup.push(new THREE.Vector3(x, terrainHeight(x, z) + 12, z));
  }
  for (const [t, off] of [[0.94, 8], [0.97, 5.5]]) {
    const x = foot.x + (top.x - foot.x) * t, z = foot.z + (top.z - foot.z) * t;
    sup.push(new THREE.Vector3(x, terrainHeight(x, z) + off, z));
  }
  sup.push(new THREE.Vector3(top.x, top.F + 4.0, top.z));
  return { foot, top, lineYaw, curve: new THREE.CatmullRomCurve3(sup) };
}

/** 站體：石垣基座（可行走月台）+ 木板候車小屋，橫跨路線方向 */
function buildRopewayStation(g, colliders, st, lineYaw) {
  g.add(box(8.6, st.base, 6.6, MAT.stoneWall, st.x, st.F - st.base / 2, st.z));
  colliders.push({ x: st.x, z: st.z, hw: 4.3, hd: 3.3, y: st.F - st.base, h: st.base, walk: 1 });
  const hall = makeHall(6.5, 4.5, 2.8, { roofMat: MAT.roofBlack, wallMat: MAT.planks, roofH: 2.0 });
  hall.position.set(st.x, st.F, st.z);
  hall.rotation.y = lineYaw + Math.PI / 2;
  g.add(hall);
  colliders.push({ x: st.x, z: st.z, hw: 3.6, hd: 2.6, y: st.F, h: 5.4, rotY: lineYaw + Math.PI / 2 });
  addClearing(st.x, st.z, 7, 7);
}

/** 車廂：原點在掛點（鋼索正下方），吊臂 + 廂體 + 窗帶 + 小頂。
 *  Group 命名 'rope-cabin' —— mergeStaticByMaterial 的 skip 名單有它，
 *  漏加就會被烘進靜態合併網格，車廂永遠凍結在起點。 */
function buildRopewayCabin() {
  const cab = new THREE.Group();
  cab.name = 'rope-cabin';
  cab.add(cyl(0.05, 0.05, 1.2, MAT.ironTrim, 0, -0.6, 0, 6));
  cab.add(box(1.7, 1.6, 2.3, MAT.planks, 0, -2.1, 0));
  cab.add(box(1.74, 0.5, 2.34, MAT.glassWarm, 0, -1.95, 0));
  const croof = new THREE.Mesh(curvedRoof(2.2, 2.8, 0.7, 0.2, 0.3), MAT.roofBlack);
  croof.position.y = -1.25;
  croof.castShadow = true;
  cab.add(croof);
  return cab;
}

/** 雙鋼索（沿曲線向兩側各偏 1.1m）+ 指定位置的塔架。t0/t1 取曲線的一段。 */
function buildRopewayCables(g, colliders, curve, lineYaw, t0, t1, towerTs) {
  const a = curve.getPoint(t0), b = curve.getPoint(t1);
  const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x);
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      pts.push(curve.getPoint(t0 + (t1 - t0) * i / 24).addScaledVector(perp, s * 1.1));
    }
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.055, 5), MAT.ironTrim);
    tube.castShadow = true;
    g.add(tube);
  }

  // 塔架：四腳收分鐵塔 + 頂部橫臂（貼地弧下塔高均勻 ~12m）
  for (const tt of towerTs) {
    const p = curve.getPoint(tt);
    const gy = terrainHeight(p.x, p.z);
    const th = Math.max(4, p.y - gy + 0.3);
    const tower = new THREE.Group();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = cyl(0.09, 0.14, th, MAT.ironTrim, sx * 0.9, th / 2, sz * 0.9, 6);
      leg.rotation.z = -sx * 0.055;
      leg.rotation.x = sz * 0.055;
      tower.add(leg);
    }
    for (const fy of [0.35, 0.7]) {
      tower.add(box(2.0, 0.1, 2.0, MAT.ironTrim, 0, th * fy, 0));
    }
    tower.add(box(3.0, 0.16, 0.5, MAT.ironTrim, 0, th + 0.1, 0));
    tower.position.set(p.x, gy, p.z);
    tower.rotation.y = lineYaw + Math.PI / 2;
    g.add(tower);
    colliders.push({ x: p.x, z: p.z, hw: 1.1, hd: 1.1, y: gy, h: th });
  }
}

/** 分圖用的半段索道（規格書 §1：搭乘＝觸發切圖，不是「會動的物件」）。
 *  各圖只畫自己那半段纜線，往圖外延伸、消失在霧裡；
 *  車廂是停靠在月台的道具，不是同一台在兩張圖之間移動。
 *  end='foot'：山麓站 + 鋼索 t∈[0,0.5] + 塔 0.22/0.45
 *  end='top' ：山上站 + 鋼索 t∈[0.5,1] + 塔 0.68
 *  回傳的 group 在世界座標，地圖自行平移回原點。
 *  除草區由呼叫端用 captureClearings 收成這張圖的一份。 */
export function buildRopewayHalf(colliders, end) {
  const { foot, top, lineYaw, curve } = ropewayLine();
  const g = new THREE.Group();
  g.name = 'ropeway:' + end;
  buildRopewayStation(g, colliders, end === 'foot' ? foot : top, lineYaw);
  buildRopewayCables(g, colliders, curve, lineYaw,
    end === 'foot' ? 0 : 0.5, end === 'foot' ? 0.5 : 1,
    end === 'foot' ? [0.22, 0.45] : [0.68]);
  // 停靠在月台門廊下的車廂（鋼索高 F+4，車廂底離月台約 1m）
  const cab = buildRopewayCabin();
  const p = curve.getPoint(end === 'foot' ? 0.008 : 0.992);
  cab.position.copy(p);
  cab.rotation.y = lineYaw;
  g.add(cab);
  return g;
}

/** 索道（ロープウェイ）：河童建造、山麓直達守矢神社參道口。
 *  兩站 + 三座塔架 + 雙鋼索 + 兩台會動的車廂（legacy_open 整線版）。
 *  分圖的兩端站體請用 buildRopewayHalf，不要重複建整線。 */
function buildRopeway(colliders, lights) {
  const g = new THREE.Group();
  g.name = 'ropeway';
  const { foot, top, lineYaw, curve } = ropewayLine();

  for (const st of [foot, top]) buildRopewayStation(g, colliders, st, lineYaw);

  ROPEWAY.curve = curve;
  buildRopewayCables(g, colliders, curve, lineYaw, 0, 1, [0.22, 0.45, 0.68]);

  // 車廂兩台：由主迴圈沿曲線推進
  for (let i = 0; i < 2; i++) {
    const cab = buildRopewayCabin();
    g.add(cab);
    ROPEWAY.cabins.push(cab);
  }

  // 互動點：站在月台上、站體沿線方向的端頭外（避開站體碰撞盒），
  // 帶明確 y —— 批次 3 的 fadeTeleport 有 y 用 y，沒有才貼地形。
  // 山麓側剛好是月台與山坡齊平的一端，也是徒步進出月台的路。
  const dl = Math.hypot(top.x - foot.x, top.z - foot.z);
  const dirX = (top.x - foot.x) / dl, dirZ = (top.z - foot.z) / dl;
  WARP_NODES.push(
    { id: 'rope-foot', zh: '索道・山麓站', x: foot.x + dirX * 4.2, z: foot.z + dirZ * 4.2, y: foot.F + 0.25, to: 'rope-top', label: '搭乘索道（往山上）' },
    { id: 'rope-top', zh: '索道・山上站', x: top.x + dirX * 4.1, z: top.z + dirZ * 4.1, y: top.F + 0.25, to: 'rope-foot', label: '搭乘索道（往山麓）' },
  );
  return g;
}

// 地區 id → 建築函式。分圖改造後每張地圖只建自己那一份，
// 所以這張表就是「哪個地區的建築歸誰」的唯一真相。
const BUILDERS = {
  shrine: buildShrine,
  village: buildVillage,
  sdm: buildMansion,
  netherworld: buildNetherworld,
  forest: buildForest,
  bamboo: buildBamboo,
  moriya: buildMoriya,
  ropeway: buildRopeway,
  myouren: buildMyouren,
  kourindou: buildKourindou,
  muenzuka: buildMuenzuka,
  sunflower: buildSunflower,
  tenguVillage: buildTenguVillage,
  tenkai: buildTenkai,
  higan: buildHigan,
};

export function buildStructures() {
  initMats();
  INTERIORS.length = 0;
  WARP_NODES.length = 0;
  ROPEWAY.curve = null;
  ROPEWAY.cabins.length = 0;
  const root = new THREE.Group();
  root.name = 'structures';
  const colliders = [];
  const lights = [];
  const staticLights = [];       // 室內常亮燈：不跟著晝夜開關，main.js 只需加進場景一次

  for (const id of Object.keys(BUILDERS)) {
    root.add(BUILDERS[id](colliders, lights, staticLights));
  }

  return { root, colliders, lights, staticLights };
}

/**
 * 只建指定地區的建築 —— 給分圖用。
 *
 * 各 buildXxx() 會直接往模組層的 INTERIORS / WARP_NODES 推東西（舊設計），
 * 這裡先把它們挪開、建完再收成回傳值、最後原樣放回去。分圖呼叫這個函式
 * 不會污染 legacy_open 那份全域清單。
 *
 * 回傳的 group 仍在世界座標（各 builder 最後都 `set(R.x, 0, R.z)`），
 * 地圖要自己的局部座標系的話，把整個 group 平移回原點即可。
 */
export function buildStructureSet(ids) {
  initMats();
  const savedI = INTERIORS.splice(0), savedW = WARP_NODES.splice(0);
  const root = new THREE.Group();
  root.name = 'structures:' + ids.join('+');
  const colliders = [], lights = [], staticLights = [];

  // 除草區同樣收成這張圖自己的一份（世界座標，呼叫端負責換算）
  const clearings = captureClearings(() => {
    for (const id of ids) {
      const fn = BUILDERS[id];
      if (!fn) { console.error('[structures] 沒有這個地區的建築：' + id); continue; }
      root.add(fn(colliders, lights, staticLights));
    }
  });

  const interiors = INTERIORS.splice(0), warps = WARP_NODES.splice(0);
  INTERIORS.push(...savedI);
  WARP_NODES.push(...savedW);
  return { root, colliders, lights, staticLights, interiors, warps, clearings };
}

export { MAT, initMats, makeHall, makePaperLantern, makeFence, makeStairs };
