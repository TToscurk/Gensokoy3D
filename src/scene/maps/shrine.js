// 博麗神社 —— 獨立地圖，heightSpace:'local'（2026-07 重做）。
//
// 不再從舊世界的噪聲地形切出來，也不透過 structures.js 的 buildStructureSet/
// buildShrine() 分派——地形與建築排版完全在這個檔案裡自己造，只借
// structures.js 的低階元件（makeTorii/makeHakureiHaiden/box/cyl…）。
// 做法比照 sando.js（本專案第一張 heightSpace:'local' 的圖）。
//
// 座標系：局部座標，原點在神社台地中心。+X＝東、+Z＝南（跟世界座標同一套
// 方向約定）。台地在中心，拜殿面向北（-Z，朝向參道方向）。
//
// 三個出口方位（trigger 座標不變，跟參道/太陽花田/白玉樓三張鄰接圖的
// entry 約定一致，這三張圖完全不用改）：
//   北（往參道 sando）：主要的大石道下山
//   西（往白玉樓 netherworld，結界之門）：較短的緩坡
//   南（往太陽花田 sunflower）：較長的緩坡
//   東：沒有出口，疊地形做懸崖擋住視野
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight, groundSample } from '../../world/terrain.js';
import { buildVegetation, GrassField } from '../../world/vegetation.js';
import {
  initMats, makeTorii, makeLantern, makeHakureiHaiden, makeKomainu, makeChozuya,
  makeEma, makeSaisenBox, makeShimenawa, makeSuzuBell, makeTamagaki, makeHall,
  makeHaidenOpen, box, cyl, MAT,
} from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { fbm } from '../../core/noise.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.shrine;
export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'shrine',
  zh: '博麗神社',
  en: 'HAKUREI SHRINE',
  size: 480,
  // z 要落在台地核心（半徑 46 內）——z=58 左右剛好在南側緩坡的過渡帶，
  // 第三人稱攝影機的地形防穿模在那一帶會把鏡頭頂到貼著地面，
  // 近距離看斜坡像一大片沒有細節的色塊（實測驗證過，換成 z=28 就正常）。
  spawn: { x: 0, z: 28, facing: Math.PI },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  // 自己造地形的圖：世界座標對它沒有意義，必須自己提供 skirtHeightAt。
  heightSpace: 'local',
  // 這張圖比其他圖亮一點（參考使用者另外做的示範版，曝光 1.05；
  // 其他圖維持專案統一的 0.72）。main.js 的 applyEnv 讀這個欄位。
  exposure: 0.95,
};

export const entries = {
  from_sando: { x: 0, z: -84, facing: 0 },
  from_sunflower: { x: -56, z: 152, facing: Math.PI * -0.2 },
  from_netherworld: { x: -126, z: 34, facing: Math.PI * -0.55 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'shrine_to_sando', to: 'sando', entry: 'from_shrine',
    trigger: { x: 0, z: -150, r: 9 }, label: '往參道', style: 'walk', condition: null,
  },
  {
    id: 'shrine_to_sunflower', to: 'sunflower', entry: 'from_shrine',
    trigger: { x: -72, z: 186, r: 10 }, label: '往太陽花田', style: 'walk', condition: null,
  },
  {
    id: 'shrine_to_netherworld', to: 'netherworld', entry: 'from_shrine',
    trigger: { x: -150, z: 40, r: 7 }, label: '結界之門（往白玉樓）', style: 'gate', condition: null,
  },
];

// ---------------------------------------------------------------------------
// 地形：台地 + 三條出口坡道 + 東側懸崖
// ---------------------------------------------------------------------------
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function angleDiff(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }
/** 1 = 正對 center 方位，往外側 halfArc 淡出到 0 */
function gate(bearing, center, halfArc) {
  return 1 - smoothstep(0, halfArc, angleDiff(bearing, center));
}

const PLATEAU_R = 46;   // 台地核心半徑，拜殿與其他建築都在這個範圍內
const PLATEAU_H = 106;  // 台地高度，接近原本的 R.elev(104)
const EDGE_H = 88;      // 台地邊緣陡降的第一段（擋土坡）
const BASE_H = 58;      // 再往外的一般地勢

// 三個出口的方位角（bearing = atan2(x,z)，跟 portal trigger 座標算出來的方向一致）
const NORTH = Math.atan2(0, -150);      // ≈ π，往參道
const WEST = Math.atan2(-150, 40);      // ≈ -75°，往白玉樓
const SOUTH = Math.atan2(-72, 186);     // ≈ -21°，往太陽花田
const EAST = Math.PI / 2;               // 東側無出口，疊懸崖

function baseFalloff(d) {
  // 第一段（擋土坡）原本 9 公尺內降 18 公尺（~200% 坡度），實測太陡——
  // 第三人稱攝影機的地形防穿模在這附近會把鏡頭頂到貼著地面，近距離看
  // 斜坡像一大片沒有細節的色塊。拉長到 22 公尺內降完，坡度降到 ~80%，
  // 仍然看得出「台地邊緣」但攝影機不會再出問題（實測驗證過）。
  let h = lerp(PLATEAU_H, EDGE_H, smoothstep(PLATEAU_R, PLATEAU_R + 22, d));
  h = lerp(h, BASE_H, smoothstep(PLATEAU_R + 22, PLATEAU_R + 80, d));
  return h;
}

export function heightAt(x, z) {
  const d = Math.hypot(x, z);
  const bearing = Math.atan2(x, z);
  let h = baseFalloff(d);

  // 北：往參道的長坡（trigger 在 d=150）
  const gN = gate(bearing, NORTH, 38 * Math.PI / 180);
  if (gN > 0) {
    const t = smoothstep(PLATEAU_R - 4, 175, d);
    h = lerp(h, lerp(PLATEAU_H, 34, t), gN);
  }
  // 西：往結界之門的短緩坡（trigger 在 d≈155）
  const gW = gate(bearing, WEST, 26 * Math.PI / 180);
  if (gW > 0) {
    const t = smoothstep(PLATEAU_R - 4, 150, d);
    h = lerp(h, lerp(PLATEAU_H, 50, t), gW);
  }
  // 南：往太陽花田的緩坡（trigger 在 d≈199）
  const gS = gate(bearing, SOUTH, 30 * Math.PI / 180);
  if (gS > 0) {
    const t = smoothstep(PLATEAU_R - 4, 200, d);
    h = lerp(h, lerp(PLATEAU_H, 46, t), gS);
  }
  // 東：沒有出口，疊陡升做懸崖——視覺上把「走不到的地方」擋住，
  // 取代開闊到底其實是空氣的處理。純視覺，玩家邊界仍是 meta.size 換算的空氣牆。
  const gE = gate(bearing, EAST, 48 * Math.PI / 180);
  if (gE > 0) {
    // 起漲點刻意拉遠（140，而不是貼著台地邊緣），讓陡升是「遠方的一座山」，
    // 而不是貼著玩家腳邊的一面近牆——太近的話 4m 網格解析度撐不住陡坡，
    // 會看起來像破圖的巨大三角形斜面。
    const t = smoothstep(140, 280, d);
    const jag = fbm(x * 0.02, z * 0.02, 3) * 8 * t;
    h += gE * (t * 120 + jag);
  }
  return h;
}

/** 裙襬用：從自己的地形平滑過渡到舊世界地貌，圖邊才不會斷崖。 */
export function skirtHeightAt(x, z) {
  const own = heightAt(x, z);
  const world = terrainHeight(x + ORIGIN.x, z + ORIGIN.z);
  // d=1 是這張圖自己的邊界（跟主地形網格的最外圈頂點重合）。混合一定要在
  // d=1 那裡是 t=0（純 own），不然裙襬的第一圈跟主地形對不上，接縫處會摺出一道
  // 突兀的斷崖（往外 0.6 個半徑內完成過渡，比照 sando.js 的做法）。
  const d = Math.max(Math.abs(x), Math.abs(z)) / (meta.size / 2);
  const t = smoothstep(1.0, 1.6, d);
  return lerp(own, world, t);
}

/** 樹木/草的可種植判定：台地核心（建築區）與三條坡道淨空，其餘（含東側懸崖坡）開放。 */
function plantableHere(x, z) {
  const d = Math.hypot(x, z);
  if (d < PLATEAU_R + 4) return false;
  if (d > 232) return false;
  const bearing = Math.atan2(x, z);
  if (d < 190 && gate(bearing, NORTH, 30 * Math.PI / 180) > 0.15) return false;
  if (d < 165 && gate(bearing, WEST, 20 * Math.PI / 180) > 0.15) return false;
  if (d < 210 && gate(bearing, SOUTH, 24 * Math.PI / 180) > 0.15) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 陰陽玉——浮空的小彩蛋（參考使用者另外做的示範版，重新上材質，不搬原始程式碼）
// ---------------------------------------------------------------------------
function makeYinYang(r = 0.32) {
  const g = new THREE.Group();
  const red = new THREE.Mesh(
    new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xc2382f, roughness: 0.32, emissive: 0x4a1108, emissiveIntensity: 0.5 }),
  );
  const white = new THREE.Mesh(
    new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf4ecd8, roughness: 0.32, emissive: 0x3a3628, emissiveIntensity: 0.42 }),
  );
  red.castShadow = white.castShadow = true;
  g.add(red, white);
  g.rotation.z = 0.22;
  return g;
}

export async function build(ctx) {
  const { quality: q, progress } = ctx;
  const group = new THREE.Group();
  group.name = 'map:shrine';
  initMats();

  const colliders = [], lanterns = [], staticLights = [];
  const props = new THREE.Group();
  props.name = 'shrine-props';

  // --- 地形 -----------------------------------------------------------------
  await progress?.(20, '墊起神社台地…');
  const half = meta.size / 2;
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  {
    const pos = terrain.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    pos.needsUpdate = true;
    terrain.geometry.computeVertexNormals();

    // buildTerrain() 內部烘的頂點色／splat 權重是照「舊世界地形」的坡度算的
    // （蓋 Y 之前）。這張圖的地形跟舊世界差很多——尤其東側懸崖，舊世界那裡
    // 本來是緩坡，色彩烘焙從沒判定成「陡坡」，套不到 rocky 貼圖，於是陡峭的
    // 懸崖套著跟緩坡一樣的純草地色，看起來像一片沒有紋理細節的死板色塊。
    // 蓋完 Y、算完新法線之後，照 groundSample 的邏輯用新坡度重新烘一次。
    const nrm = terrain.geometry.attributes.normal;
    const colorAttr = terrain.geometry.attributes.color;
    const splatAAttr = terrain.geometry.attributes.aSplatA;
    const splatBAttr = terrain.geometry.attributes.aSplatB;
    const _col = new THREE.Color(); const _a4 = [0, 0, 0, 0]; const _b2 = [0, 0];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const slope = 1 - nrm.getY(i);
      groundSample(x + ORIGIN.x, z + ORIGIN.z, h, slope, _col, _a4, _b2);
      colorAttr.setXYZ(i, _col.r, _col.g, _col.b);
      splatAAttr.setXYZW(i, _a4[0], _a4[1], _a4[2], _a4[3]);
      splatBAttr.setXYZW(i, _b2[0], _b2[1], 0, 0);
    }
    colorAttr.needsUpdate = true;
    splatAAttr.needsUpdate = true;
    splatBAttr.needsUpdate = true;
  }
  group.add(terrain);
  group.add(buildTerrainSkirt(half, 1100, skirtHeightAt));

  // --- 建築排版 ---------------------------------------------------------------
  // 拜殿在台地中心，面向北（不用轉向，makeHakureiHaiden 預設前面朝 -Z）。
  await progress?.(45, '重建拜殿與鳥居…');
  const hallX = 0, hallZ = 13, hallW = 13, hallD = 10, hallWallH = 4.0;
  const floorTop = 1.5; // makeHakureiHaiden 內部寫死的高床高度，外部不能改
  const hallBase = heightAt(hallX, hallZ);
  const hall = makeHakureiHaiden(hallW, hallD, hallWallH);
  hall.position.set(hallX, hallBase, hallZ);
  props.add(hall);

  const hx2 = (hallW + 1.2) / 2, hz2 = (hallD + 1.2) / 2;
  colliders.push({ x: hallX, z: hallZ, hw: hx2, hd: hz2, y: hallBase, h: floorTop, walk: true });
  colliders.push({ x: hallX, z: hallZ - hz2 + 0.75, hw: hx2, hd: 0.8, y: hallBase, h: floorTop, walk: true });
  for (let i = 0; i < 5; i++) {
    colliders.push({
      x: hallX, z: hallZ - hz2 - 2.0 + i * 0.5, hw: 1.4, hd: 0.27,
      y: hallBase, h: (i + 1) * (floorTop / 5), walk: true,
    });
  }
  const wallH2 = floorTop + hallWallH;
  colliders.push({ x: hallX, z: hallZ + hallD / 2 + 0.3, hw: hallW / 2, hd: 0.2, y: hallBase, h: wallH2 });
  colliders.push({ x: hallX - hallW / 2 - 0.1, z: hallZ, hw: 0.2, hd: hallD / 2 - 0.4, y: hallBase, h: wallH2 });
  colliders.push({ x: hallX + hallW / 2 + 0.1, z: hallZ, hw: 0.2, hd: hallD / 2 - 0.4, y: hallBase, h: wallH2 });

  // 賽錢箱：拜殿正前方
  const saisenZ = hallZ - hz2 - 4.2;
  const saisenY = heightAt(hallX, saisenZ);
  const saisen = makeSaisenBox(1.1);
  saisen.position.set(hallX, saisenY, saisenZ);
  props.add(saisen);
  colliders.push({ x: hallX, z: saisenZ, hw: 1.5, hd: 0.65, y: saisenY, h: 1.4 });

  // 注連繩＋鈴：掛在緣側前緣
  const nawaZ = hallZ - hz2 + 0.1;
  const nawa = makeShimenawa(4.8);
  nawa.position.set(hallX, hallBase + floorTop + 3.3, nawaZ);
  props.add(nawa);
  const suzu = makeSuzuBell(1.15);
  suzu.position.set(hallX, hallBase + floorTop + 3.28, nawaZ);
  props.add(suzu);

  // 殿內常亮暖燈
  const hallLight = new THREE.PointLight(0xffc27a, 2.2, 13, 2.0);
  hallLight.position.set(hallX, hallBase + floorTop + 2.4, hallZ);
  staticLights.push(hallLight);
  for (const sx of [-1, 1]) {
    lanterns.push({ obj: null, x: hallX + sx * 2.3, y: hallBase + floorTop + 2.8, z: hallZ - hz2 + 0.3, color: 0xffb060, power: 4 });
  }

  const interactives = [
    {
      id: 'hakurei-haiden:enter', label: '進入博麗神社拜殿',
      x: hallX, z: hallZ - hz2 - 1.6, y: heightAt(hallX, hallZ - hz2 - 1.6),
      to: { x: hallX, z: hallZ, y: hallBase + floorTop + 0.7 },
      zh: '博麗神社拜殿', msg: '推門而入…',
    },
    {
      id: 'hakurei-haiden:exit', label: '離開博麗神社拜殿',
      x: hallX, z: hallZ, y: hallBase + floorTop + 0.7,
      to: { x: hallX, z: hallZ - hz2 - 3.5, y: heightAt(hallX, hallZ - hz2 - 3.5) },
      zh: '博麗神社拜殿', msg: '回到戶外…',
    },
  ];

  // 大鳥居：立在拜殿正前方（Gansokoy 構圖）
  const mainToriiZ = hallZ - hz2 - 8;
  {
    const ty = heightAt(0, mainToriiZ);
    const t = makeTorii(1.3);
    t.position.set(0, ty, mainToriiZ);
    props.add(t);
    const W = 5.4 * 1.3 / 2;
    colliders.push({ x: -W, z: mainToriiZ, r: 0.5, y: ty, h: 9 });
    colliders.push({ x: W, z: mainToriiZ, r: 0.5, y: ty, h: 9 });
  }
  // 外鳥居：立在台地邊緣，石道起點——結界與俗界的分界
  const outerToriiZ = -38;
  {
    const ty = heightAt(0, outerToriiZ);
    const t = makeTorii(1.15);
    t.position.set(0, ty, outerToriiZ);
    props.add(t);
    const W = 5.4 * 1.15 / 2;
    colliders.push({ x: -W, z: outerToriiZ, r: 0.46, y: ty, h: 8 });
    colliders.push({ x: W, z: outerToriiZ, r: 0.46, y: ty, h: 8 });
  }

  // 狛犬：夾著拜殿前的木階
  const komZ = hallZ - hz2 - 2.6;
  const komY = heightAt(4.0, komZ);
  const komA = makeKomainu(1.05, true);
  komA.position.set(-4.0, komY, komZ);
  komA.rotation.y = 0.3;
  props.add(komA);
  const komB = makeKomainu(1.05, false);
  komB.position.set(4.0, komY, komZ);
  komB.rotation.y = -0.3;
  props.add(komB);
  colliders.push({ x: -4.0, z: komZ, r: 0.95, y: komY, h: 3.1 });
  colliders.push({ x: 4.0, z: komZ, r: 0.95, y: komY, h: 3.1 });

  // 手水舍／繪馬掛：分立石道兩側，在外鳥居與拜殿之間
  const chozX = 12, chozZ = -20;
  const chozY = heightAt(chozX, chozZ);
  const choz = makeChozuya(1.05);
  choz.position.set(chozX, chozY, chozZ);
  props.add(choz);
  colliders.push({ x: chozX, z: chozZ, hw: 2.8, hd: 2.1, y: chozY, h: 4.5 });

  const emaX = -12, emaZ = -18;
  const emaY = heightAt(emaX, emaZ);
  const ema = makeEma();
  ema.position.set(emaX, emaY, emaZ);
  ema.rotation.y = 0.5;
  props.add(ema);
  colliders.push({ x: emaX, z: emaZ, hw: 2.0, hd: 0.5, y: emaY, h: 2.2 });

  // 守矢神社分社（原作：本殿旁的小分社）＋ 迷你鳥居
  const subX = 25, subZ = 18;
  const subY = heightAt(subX, subZ);
  const sub = makeHaidenOpen(4.6, 3.7, 2.5, { roofH: 2.3, open: -1 });
  sub.position.set(subX, subY, subZ);
  props.add(sub);
  colliders.push({ x: subX, z: subZ + 1.7, hw: 2.3, hd: 0.15, y: subY, h: 3 });
  colliders.push({ x: subX - 2.2, z: subZ, hw: 0.15, hd: 1.8, y: subY, h: 3 });
  colliders.push({ x: subX + 2.2, z: subZ, hw: 0.15, hd: 1.8, y: subY, h: 3 });
  const miniT = makeTorii(0.55);
  miniT.position.set(subX, heightAt(subX, subZ - 7), subZ - 7);
  props.add(miniT);

  // 切妻倉庫
  const storeX = -26, storeZ = 20;
  const storeY = heightAt(storeX, storeZ);
  const store = makeHall(6.2, 5.2, 2.9, { roofMat: MAT.roofBlack, wallMat: MAT.planks, roofH: 2.5 });
  store.position.set(storeX, storeY, storeZ);
  store.rotation.y = 0.18;
  props.add(store);
  colliders.push({ x: storeX, z: storeZ, hw: 3.6, hd: 3.1, y: storeY, h: 5.6, rotY: 0.18 });

  // 玉垣：沿台地邊緣、拜殿東西兩側各一段
  for (const sx of [-1, 1]) {
    const fx = sx * 30, fz = 0;
    const f = makeTamagaki(38);
    f.rotation.y = Math.PI / 2;
    f.position.set(fx, heightAt(fx, fz), fz);
    props.add(f);
  }

  // 石燈籠：疏落幾盞，沿主石道兩側分佈（少而有效，不密集排列）
  await progress?.(65, '點起石燈籠…');
  for (const z of [-52, -78, -104, -130]) {
    for (const sx of [-1, 1]) {
      const lx = sx * 7.5;
      const ly = heightAt(lx, z);
      const L = makeLantern(0.95);
      L.position.set(lx, ly, z);
      props.add(L);
      lanterns.push({ obj: L, x: lx, y: ly + 1.85, z, color: 0xffb066, power: 4.8 });
    }
  }

  // 陰陽玉：境內飄浮的小彩蛋。每幀要動（見下方 update），
  // 命名 'yinyang-orb' 排進合併白名單，不然會被烘進靜態網格、飄不動。
  const orbs = [];
  for (const [ox, oz, oy0] of [[-14, 24, 3.2], [14, 22, 2.6], [-8, -6, 4.4]]) {
    const orb = makeYinYang(0.3);
    orb.name = 'yinyang-orb';
    const oy = heightAt(ox, oz) + oy0;
    orb.position.set(ox, oy, oz);
    orb.userData = { baseY: oy, phase: Math.random() * Math.PI * 2 };
    props.add(orb);
    orbs.push(orb);
  }

  mergeStaticByMaterial(props, ['yinyang-orb']);
  group.add(props);

  // --- 植被 -------------------------------------------------------------------
  await progress?.(75, '種下杉木、楓與櫻…');
  const density = 5 * Math.max(q.trees, 2000) / (2400 * 0.92) ** 2;
  const trees = Math.round(density * meta.size ** 2);
  // cx/cz 用世界座標，讓預設 speciesFn（vegetation.js 的 speciesAt）能靠
  // regionAt() 正確判斷這裡是 'shrine' 地區；heightFn/plantableFn 因此要
  // 自己把世界座標換回這張圖的局部座標，再丟給只認得局部座標的 heightAt/plantableHere。
  const vegetation = buildVegetation(trees, {
    cx: ORIGIN.x, cz: ORIGIN.z, half,
    heightFn: (x, z) => heightAt(x - ORIGIN.x, z - ORIGIN.z),
    plantableFn: (x, z) => plantableHere(x - ORIGIN.x, z - ORIGIN.z),
  });
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(88, '鋪上草原…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.6)) : null;
  if (grass) group.add(grass.mesh);

  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.5), Math.round(q.mist * 0.5));
  group.add(atmosphere.group);

  return {
    group,
    heightAt,
    origin: ORIGIN,
    colliders,
    lanterns,
    staticLights,
    interactives,
    // 台地核心一塊（拜殿與其他建築）＋北側石道一條長條（燈籠列所在，
    // 不然草會種到石道跟燈籠腳下）。
    clearings: [
      { x: 0, z: 0, hw: PLATEAU_R + 4, hd: PLATEAU_R + 4 },
      { x: 0, z: -115, hw: 10, hd: 75 },
    ],
    portals,
    npcs: ['reimu', 'yukari'],
    mobs: [],
    terrain, vegetation, grass, atmosphere,

    update(dt, t, rt) {
      atmosphere?.update(t, rt.sky, rt.nightFactor);
      if (grass) {
        grass.update(rt.playerPos);
        const gsh = grass.mesh.material.userData.shader;
        if (gsh) gsh.uniforms.uTime.value = t;
      }
      for (const orb of orbs) {
        orb.position.y = orb.userData.baseY + Math.sin(t * 0.6 + orb.userData.phase) * 0.35;
        orb.rotation.y = t * 0.4 + orb.userData.phase;
      }
    },

    dispose() {
      group.traverse(o => {
        if (o.isMesh || o.isPoints) {
          o.geometry?.dispose();
          const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (const m of mats) m.dispose();
        }
      });
      group.removeFromParent();
    },
  };
}
