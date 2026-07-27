import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight, terrainNormal, regionAt, riverSample } from './terrain.js';
import { mulberry32, fbm, smoothstep } from '../core/noise.js';
import { WORLD, REGIONS, REGION_BY_ID, CRATER_LAKE } from '../config.js';
import { grassAtlasTexture, leafTexture, barkTexture, flowerTexture, pbrSet } from '../core/textures.js';
import { biomeColor } from './terrain.js';

// 樹冠風擺的共享時間 uniform —— 主迴圈每幀推進，全部樹種同步起風。
export const WIND = { uTime: { value: 0 } };
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** 給 instanced 樹冠材質注入風擺：頂點越高擺幅越大，樹根不動 */
function injectSway(mat, amp = 0.09) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WIND.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 swPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 swPos = vec3(0.0);
        #endif
        float swSway = sin(uTime * 0.9 + swPos.x * 0.05 + swPos.z * 0.07)
                     + sin(uTime * 1.7 + swPos.x * 0.021) * 0.4;
        float swInfl = smoothstep(1.5, 9.0, transformed.y);
        transformed.x += swSway * ${amp.toFixed(3)} * swInfl;
        transformed.z += swSway * ${(amp * 0.6).toFixed(3)} * swInfl;`);
  };
  return mat;
}

// ---------------------------------------------------------------------------
// 樹木原型 —— 每種都是幾個基本體合併成一份 geometry，再用 InstancedMesh 畫幾千棵。
// GTX 1070 畫 2400 棵 instanced 樹只要一個 draw call。
// ---------------------------------------------------------------------------

function trunkGeo(h, rBot, rTop, seg = 6) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
  g.translate(0, h / 2, 0);
  return g;
}

function blobGeo(r, detail = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  // 隨機擾動頂點，讓樹冠不要是完美球
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = 0.78 + Math.random() * 0.44;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.86, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

const PROTOTYPES = {
  // 一般闊葉樹
  broadleaf() {
    const trunk = trunkGeo(5.2, 0.42, 0.24, 6);
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const b = blobGeo(1.9 + Math.random() * 0.9, 1);
      b.translate(
        (Math.random() - 0.5) * 2.4,
        5.0 + Math.random() * 2.4,
        (Math.random() - 0.5) * 2.4
      );
      parts.push(b);
    }
    return { trunk, leaves: BGU.mergeGeometries(parts), leafHue: 104, leafSat: 34, height: 8.5 };
  },
  // 針葉杉 —— 神社周邊
  cedar() {
    const trunk = trunkGeo(9.5, 0.5, 0.16, 6);
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const c = new THREE.ConeGeometry(3.1 - t * 1.9, 3.6, 7, 1);
      c.translate(0, 4.6 + i * 2.2, 0);
      parts.push(c);
    }
    return { trunk, leaves: BGU.mergeGeometries(parts), leafHue: 128, leafSat: 30, height: 13 };
  },
  // 魔法森林的暗色扭曲樹
  gnarled() {
    const parts = [trunkGeo(6.2, 0.55, 0.3, 6)];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.random();
      const b = trunkGeo(3.2, 0.22, 0.09, 5);
      b.rotateZ(Math.cos(a) * 0.85);
      b.rotateX(Math.sin(a) * 0.85);
      b.translate(0, 5.0, 0);
      parts.push(b);
    }
    const leaves = [];
    for (let i = 0; i < 5; i++) {
      const b = blobGeo(1.6 + Math.random() * 0.8, 1);
      b.translate((Math.random() - 0.5) * 3.6, 6.4 + Math.random() * 2.2, (Math.random() - 0.5) * 3.6);
      leaves.push(b);
    }
    return {
      trunk: BGU.mergeGeometries(parts),
      leaves: BGU.mergeGeometries(leaves),
      leafHue: 148, leafSat: 24, height: 9.5,
    };
  },
  // 櫻花 —— 冥界
  sakura() {
    const parts = [trunkGeo(4.4, 0.44, 0.22, 6)];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const b = trunkGeo(3.0, 0.18, 0.08, 5);
      b.rotateZ(Math.cos(a) * 0.95);
      b.rotateX(Math.sin(a) * 0.95);
      b.translate(0, 3.6, 0);
      parts.push(b);
    }
    const leaves = [];
    for (let i = 0; i < 6; i++) {
      const b = blobGeo(1.8 + Math.random() * 0.7, 1);
      b.scale(1.25, 0.62, 1.25);
      b.translate((Math.random() - 0.5) * 4.2, 5.4 + Math.random() * 1.6, (Math.random() - 0.5) * 4.2);
      leaves.push(b);
    }
    return {
      trunk: BGU.mergeGeometries(parts),
      leaves: BGU.mergeGeometries(leaves),
      leafHue: 338, leafSat: 62, height: 8,
    };
  },
  // 楓 —— 神社秋色
  maple() {
    const trunk = trunkGeo(4.6, 0.36, 0.2, 6);
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const b = blobGeo(1.7 + Math.random() * 0.8, 1);
      b.translate((Math.random() - 0.5) * 2.6, 4.6 + Math.random() * 2.0, (Math.random() - 0.5) * 2.6);
      parts.push(b);
    }
    return { trunk, leaves: BGU.mergeGeometries(parts), leafHue: 14, leafSat: 66, height: 7.5 };
  },
};

// ---------------------------------------------------------------------------

// 樹幹用真實樹皮（CC0）：一般樹用日本杉皮，櫻花用櫻皮，魔法之森的
// 扭曲暗樹保留程序深色皮 —— 那種「被魔法浸過」的感覺照片做不出來。
const TRUNK_MAT = () => {
  const p = pbrSet('bark_cedar', barkTexture(false), { rough: 0.95 });
  for (const t of [p.map, p.normalMap, p.roughnessMap]) t.repeat.set(1, 2);
  return new THREE.MeshStandardMaterial({
    map: p.map, normalMap: p.normalMap, roughnessMap: p.roughnessMap,
    roughness: 1.0, metalness: 0,
  });
};
const TRUNK_MAT_SAKURA = () => {
  const p = pbrSet('bark_sakura', barkTexture(false), { rough: 0.95 });
  for (const t of [p.map, p.normalMap, p.roughnessMap]) t.repeat.set(1, 2);
  return new THREE.MeshStandardMaterial({
    map: p.map, normalMap: p.normalMap, roughnessMap: p.roughnessMap,
    roughness: 1.0, metalness: 0,
  });
};
const TRUNK_MAT_DARK = () => new THREE.MeshStandardMaterial({
  map: barkTexture(true), roughness: 0.96, metalness: 0,
});

function leafMat(hue, sat, light = 0.42) {
  const c = new THREE.Color().setHSL(hue / 360, sat / 100, light);
  return injectSway(new THREE.MeshStandardMaterial({
    color: c,
    map: leafTexture(hue, sat),
    roughness: 0.88,
    metalness: 0,
    flatShading: true,
  }));
}

/** 依噪聲場選出這一小片林地的「當令樹種」，而不是每棵樹獨立擲骰子。
 *  真實森林是一叢一叢的：這邊一片杉林、那邊一片闊葉林，邊界模糊過渡，
 *  偶爾夾雜幾株外來種。純逐點機率分布只會長出「均勻撒胡椒鹽」的樹海，
 *  肉眼一眼就能看出是演算法撒的。
 *  choices: [[name, weight], ...]；outlierChance 決定「長錯地方」的機率。 */
function clusterSpecies(x, z, choices, rnd, freq = 0.02, outlierChance = 0.1) {
  const totalW = choices.reduce((s, [, w]) => s + w, 0);
  if (rnd() < outlierChance) {
    let p = rnd() * totalW;
    for (const [name, w] of choices) { p -= w; if (p <= 0) return name; }
    return choices[0][0];
  }
  // 低頻雜訊決定「這一帶」偏向哪個樹種，鄰近的點會取樣到相近的值 → 自然成片
  const n = fbm(x * freq + 11.7, z * freq + 11.7, 2) * 0.5 + 0.5;
  let p = n * totalW;
  for (const [name, w] of choices) { p -= w; if (p <= 0) return name; }
  return choices[choices.length - 1][0];
}

/** 依地區決定該長哪種樹、密度多高 */
function speciesAt(x, z, rnd) {
  const reg = regionAt(x, z);
  const id = reg?.id;
  if (id === 'forest')      return clusterSpecies(x, z, [['gnarled', 0.8], ['cedar', 0.2]], rnd, 0.022);
  if (id === 'netherworld') return 'sakura';
  if (id === 'shrine')      return clusterSpecies(x, z, [['cedar', 0.5], ['maple', 0.5]], rnd, 0.03);
  if (id === 'bamboo')      return null;             // 竹林另外處理
  if (id === 'lake')        return rnd() < 0.4 ? 'broadleaf' : null;
  if (id === 'village')     return rnd() < 0.25 ? 'broadleaf' : null;
  if (id === 'sdm')         return rnd() < 0.3 ? 'gnarled' : null;
  if (id === 'youkaiMountain') return clusterSpecies(x, z, [['cedar', 0.75], ['broadleaf', 0.25]], rnd, 0.016);
  // 守矢：湖畔楓樹為主（參道的紅葉），杉為輔
  if (id === 'moriya')      return clusterSpecies(x, z, [['maple', 0.7], ['cedar', 0.3]], rnd, 0.03);
  if (id === 'myouren')     return clusterSpecies(x, z, [['cedar', 0.5], ['broadleaf', 0.5]], rnd, 0.03);
  if (id === 'kourindou')   return rnd() < 0.3 ? 'broadleaf' : null;
  if (id === 'sunflower')   return null;             // 花田，不長樹
  if (id === 'namelessHill') return rnd() < 0.15 ? 'broadleaf' : null;
  if (id === 'muenzuka')    return rnd() < 0.3 ? 'gnarled' : null;
  if (id === 'tenguVillage') return clusterSpecies(x, z, [['cedar', 0.7], ['broadleaf', 0.3]], rnd, 0.02);
  if (id === 'tenkai')      return rnd() < 0.35 ? 'sakura' : null;   // 天界疏疏落落幾株櫻，不長成林
  if (id === 'higan')       return rnd() < 0.18 ? 'gnarled' : null;  // 彼岸的枯枝，稀疏乾瘦
  // 野外：一樣用群落雜訊，讓闊葉林與杉林各自成片，而不是逐點獨立決定
  const density = fbm(x * 0.0035, z * 0.0035, 3);
  if (density < -0.12) return null;
  return clusterSpecies(x, z, [['broadleaf', 0.68], ['cedar', 0.32]], rnd, 0.012);
}

/** 這個點適合長東西嗎 */
function plantable(x, z) {
  const h = terrainHeight(x, z);
  if (h < WORLD.waterLevel + 1.2) return false;      // 水裡
  // 樹線（五合目森林界線）：妖怪之山系 190 以上岩石裸露不長樹；
  // 守矢湖畔是刻意留的楓樹帶，山頂高度仍准長；其他地區維持原雪線邏輯
  const reg0 = regionAt(x, z);
  const treeline = (reg0 && (reg0.id === 'youkaiMountain' || reg0.id === 'tenguVillage')) ? 190
                 : (reg0 && reg0.id === 'moriya') ? 380
                 : 150;
  if (h > treeline) return false;
  const n = terrainNormal(x, z);
  if (n.y < 0.80) return false;                       // 太陡
  // 風神湖水面下不准長（湖床高於世界水位，靠 h < waterLevel 檢查不到）
  const dc = Math.hypot(x - CRATER_LAKE.x, z - CRATER_LAKE.z);
  if (dc < CRATER_LAKE.r * 1.1 && h < CRATER_LAKE.waterY + 0.8) return false;
  // 河道裡也不長樹
  if (riverSample(x, z).w > 0.35) return false;
  // 避開建築核心區 —— 邊界疊一層低頻雜訊，不然每個地區周圍都是
  // 一圈完美的正圓形空地，從空中看像用圓規畫的，一眼就露餡。
  for (const r of REGIONS) {
    if (r.id === 'forest' || r.id === 'bamboo' || r.id === 'netherworld') continue;
    const jitter = fbm((x + r.x * 0.31) * 0.045, (z + r.z * 0.31) * 0.045, 2) * 0.24;
    const d = Math.hypot(x - r.x, z - r.z);
    if (d < r.radius * 0.42 * (1 + jitter)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
export function buildVegetation(count) {
  const group = new THREE.Group();
  group.name = 'vegetation';

  const rnd = mulberry32(20250724);
  const half = WORLD.size * 0.46;

  // --- 1. 依樹種分桶 ---
  const buckets = {};
  for (const k of Object.keys(PROTOTYPES)) buckets[k] = [];

  let tries = 0;
  const maxTries = count * 14;
  let placed = 0;
  while (placed < count && tries < maxTries) {
    tries++;
    const x = (rnd() * 2 - 1) * half;
    const z = (rnd() * 2 - 1) * half;
    if (!plantable(x, z)) continue;
    const sp = speciesAt(x, z, rnd);
    if (!sp) continue;
    buckets[sp].push({
      x, z, y: terrainHeight(x, z), s: 0.68 + rnd() * 0.8, r: rnd() * Math.PI * 2,
      // 小幅度傾斜（最多約 8°）：整片林子才不會像用尺量出來一樣，每棵都直挺挺立正
      tilt: (rnd() - 0.5) * 0.14, tiltDir: rnd() * Math.PI * 2,
    });
    placed++;
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const tiltAxis = new THREE.Vector3();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  for (const [name, list] of Object.entries(buckets)) {
    if (!list.length) continue;
    const proto = PROTOTYPES[name]();
    const tMat = name === 'gnarled' ? TRUNK_MAT_DARK()
               : name === 'sakura' ? TRUNK_MAT_SAKURA()
               : TRUNK_MAT();
    const lMat = leafMat(proto.leafHue, proto.leafSat, name === 'sakura' ? 0.72 : 0.36);

    const trunks = new THREE.InstancedMesh(proto.trunk, tMat, list.length);
    const leaves = new THREE.InstancedMesh(proto.leaves, lMat, list.length);
    trunks.castShadow = leaves.castShadow = true;
    trunks.receiveShadow = leaves.receiveShadow = true;

    list.forEach((t, i) => {
      q.setFromAxisAngle(WORLD_UP, t.r);
      tiltAxis.set(Math.cos(t.tiltDir), 0, Math.sin(t.tiltDir));
      qTilt.setFromAxisAngle(tiltAxis, t.tilt);
      q.premultiply(qTilt);
      v.set(t.x, t.y - 0.3, t.z);
      sc.set(t.s, t.s * (0.85 + Math.random() * 0.3), t.s);
      m4.compose(v, q, sc);
      trunks.setMatrixAt(i, m4);
      leaves.setMatrixAt(i, m4);
    });
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    trunks.frustumCulled = leaves.frustumCulled = false;
    group.add(trunks, leaves);
  }

  // --- 2. 竹林 ---
  group.add(buildBamboo(Math.round(count * 0.55), rnd));

  // --- 3. 花田與花草 ---
  group.add(buildSunflowers(Math.round(count * 0.32), rnd));
  group.add(buildSuzuran(Math.round(count * 0.18), rnd));
  group.add(buildFlowerPatches(Math.round(count * 0.45), rnd));

  return group;
}

// ---------------------------------------------------------------------------
// 花田建構器 —— 全部 instanced，一種花一個 draw call
// ---------------------------------------------------------------------------

/** 頂點著色：整份 geometry 染單色（合併後靠 vertexColors 一次畫完） */
function paintGeo(g, r, gg, b) {
  const cnt = g.attributes.position.count;
  const col = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) { col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** 太陽花田：莖 + 花盤 + 放射花瓣，一株約 60 個三角形 */
function buildSunflowers(n, rnd) {
  const reg = REGION_BY_ID.sunflower;
  if (!reg) return new THREE.Group();

  const parts = [];
  const stem = new THREE.CylinderGeometry(0.035, 0.055, 1.7, 5);
  stem.translate(0, 0.85, 0);
  parts.push(paintGeo(stem, 0.20, 0.36, 0.13));
  // 葉
  for (const sz of [-1, 1]) {
    const lf = new THREE.PlaneGeometry(0.34, 0.2);
    lf.rotateX(-Math.PI / 2 + sz * 0.5);
    lf.rotateY(sz * 0.8);
    lf.translate(sz * 0.12, 0.75, 0.05);
    parts.push(paintGeo(lf, 0.22, 0.40, 0.15));
  }
  // 花盤（朝 +Z 微仰）
  const disc = new THREE.CircleGeometry(0.15, 10);
  disc.rotateX(-0.35);
  disc.translate(0, 1.72, 0.05);
  parts.push(paintGeo(disc, 0.30, 0.17, 0.07));
  // 花瓣
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const p = new THREE.PlaneGeometry(0.09, 0.17);
    p.translate(0, 0.20, 0);
    p.rotateZ(a);
    p.rotateX(-0.35);
    p.translate(0, 1.72, 0.04);
    parts.push(paintGeo(p, 0.95, 0.74, 0.10));
  }
  const geo = BGU.mergeGeometries(parts);

  const mat = injectSway(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, side: THREE.DoubleSide,
  }), 0.05);

  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const v = new THREE.Vector3(), sc = new THREE.Vector3();
  let i = 0, tries = 0;
  while (i < n && tries < n * 12) {
    tries++;
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * reg.radius * 0.92;
    const x = reg.x + Math.cos(a) * d, z = reg.z + Math.sin(a) * d;
    const h = terrainHeight(x, z);
    if (h < WORLD.waterLevel + 1) continue;
    e.set((rnd() - 0.5) * 0.1, Math.PI * 0.5 + (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.1);
    q.setFromEuler(e);
    v.set(x, h - 0.04, z);
    const s = 0.8 + rnd() * 0.55;
    sc.set(s, s * (0.85 + rnd() * 0.35), s);
    m4.compose(v, q, sc);
    mesh.setMatrixAt(i, m4);
    i++;
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** 無名之丘的鈴蘭：細莖垂著三顆白色小鐘 */
function buildSuzuran(n, rnd) {
  const reg = REGION_BY_ID.namelessHill;
  if (!reg) return new THREE.Group();

  const parts = [];
  const stem = new THREE.CylinderGeometry(0.012, 0.02, 0.5, 4);
  stem.translate(0, 0.25, 0);
  parts.push(paintGeo(stem, 0.24, 0.40, 0.18));
  for (let b = 0; b < 3; b++) {
    const bell = new THREE.ConeGeometry(0.045, 0.09, 6);
    bell.rotateX(Math.PI);
    const a = b * 2.1;
    bell.translate(Math.cos(a) * 0.07, 0.42 - b * 0.09, Math.sin(a) * 0.07);
    parts.push(paintGeo(bell, 0.94, 0.95, 0.92));
  }
  // 葉
  const lf = new THREE.PlaneGeometry(0.09, 0.42);
  lf.rotateX(-0.5);
  lf.translate(0.05, 0.2, 0);
  parts.push(paintGeo(lf, 0.26, 0.42, 0.2));
  const geo = BGU.mergeGeometries(parts);

  const mat = injectSway(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, side: THREE.DoubleSide,
  }), 0.03);

  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const v = new THREE.Vector3(), sc = new THREE.Vector3();
  let i = 0, tries = 0;
  while (i < n && tries < n * 12) {
    tries++;
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * reg.radius * 0.95;
    const x = reg.x + Math.cos(a) * d, z = reg.z + Math.sin(a) * d;
    const h = terrainHeight(x, z);
    if (h < WORLD.waterLevel + 1) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
    v.set(x, h - 0.02, z);
    const s = 0.9 + rnd() * 0.8;
    sc.setScalar(s);
    m4.compose(v, q, sc);
    mesh.setMatrixAt(i, m4);
    i++;
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** 野花與彼岸花：十字面片 + 程序花貼圖，instanceColor 染色。
 *  村里/神社周邊撒暖色野花，無緣塚撒整片紅色彼岸花。 */
function buildFlowerPatches(n, rnd) {
  const quad = new THREE.PlaneGeometry(0.42, 0.42);
  quad.translate(0, 0.21, 0);
  const q2 = quad.clone(); q2.rotateY(Math.PI / 2);
  const geo = BGU.mergeGeometries([quad, q2]);

  const mat = new THREE.MeshStandardMaterial({
    map: flowerTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9,
  });

  // 野花色系：白 / 淡黃 / 淡紫 / 粉；彼岸花固定緋紅
  const WILD = [0xf4f0e0, 0xf2e08a, 0xc8a8e8, 0xf2b0c8];
  const spots = [
    { region: 'village', share: 0.32, colors: WILD, rMin: 0.3, rMax: 0.95 },
    { region: 'shrine', share: 0.22, colors: WILD, rMin: 0.3, rMax: 0.9 },
    { region: 'myouren', share: 0.1, colors: WILD, rMin: 0.35, rMax: 0.9 },
    { region: 'muenzuka', share: 0.36, colors: [0xd8383a, 0xc22830, 0xe04840], rMin: 0.2, rMax: 0.9 },
    // 彼岸花：名字本來就是「彼岸」的花，長在三途川岸邊最合適
    { region: 'higan', share: 0.3, colors: [0xd8383a, 0xc22830, 0xe04840], rMin: 0.15, rMax: 0.75 },
  ];

  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const v = new THREE.Vector3(), sc = new THREE.Vector3();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  let i = 0, tries = 0;
  while (i < n && tries < n * 14) {
    tries++;
    // 依配額輪選花區
    let pick = rnd(), spot = spots[0];
    for (const s of spots) { pick -= s.share; if (pick <= 0) { spot = s; break; } }
    const reg = REGION_BY_ID[spot.region];
    if (!reg) continue;
    const a = rnd() * Math.PI * 2;
    const d = reg.radius * (spot.rMin + Math.sqrt(rnd()) * (spot.rMax - spot.rMin));
    const x = reg.x + Math.cos(a) * d, z = reg.z + Math.sin(a) * d;
    const h = terrainHeight(x, z);
    if (h < WORLD.waterLevel + 0.8 || h > 132) continue;
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    v.set(x, h - 0.02, z);
    sc.setScalar(0.7 + rnd() * 0.8);
    m4.compose(v, q, sc);
    mesh.setMatrixAt(i, m4);
    col.setHex(spot.colors[(rnd() * spot.colors.length) | 0]);
    mesh.setColorAt(i, col);
    i++;
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
function buildBamboo(n, rnd) {
  const reg = REGION_BY_ID.bamboo;
  const geo = new THREE.CylinderGeometry(0.14, 0.19, 14, 5, 4);
  geo.translate(0, 7, 0);
  // 竹節：靠頂點色做出深淺環
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = (Math.sin(y * 2.2) * 0.5 + 0.5) * 0.22 + 0.78;
    col[i * 3] = 0.42 * k; col[i * 3 + 1] = 0.58 * k; col[i * 3 + 2] = 0.26 * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const leafGeo = new THREE.ConeGeometry(1.5, 3.0, 5, 1, true);
  leafGeo.translate(0, 13.2, 0);

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const lMat = injectSway(new THREE.MeshStandardMaterial({
    color: 0x87a84e, roughness: 0.85, side: THREE.DoubleSide, flatShading: true,
  }), 0.14);

  const stalks = new THREE.InstancedMesh(geo, mat, n);
  const tops = new THREE.InstancedMesh(leafGeo, lMat, n);
  stalks.castShadow = tops.castShadow = true;
  stalks.receiveShadow = true;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const v = new THREE.Vector3(), sc = new THREE.Vector3();
  const e = new THREE.Euler();

  let i = 0, tries = 0;
  while (i < n && tries < n * 20) {
    tries++;
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * reg.radius * 1.15;
    const x = reg.x + Math.cos(a) * d;
    const z = reg.z + Math.sin(a) * d;
    const h = terrainHeight(x, z);
    if (h < WORLD.waterLevel + 1) continue;
    e.set((rnd() - 0.5) * 0.13, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.13);
    q.setFromEuler(e);
    v.set(x, h - 0.2, z);
    const s = 0.7 + rnd() * 0.65;
    sc.set(s, s * (0.8 + rnd() * 0.55), s);
    m4.compose(v, q, sc);
    stalks.setMatrixAt(i, m4);
    tops.setMatrixAt(i, m4);
    i++;
  }
  stalks.count = tops.count = i;
  stalks.instanceMatrix.needsUpdate = true;
  tops.instanceMatrix.needsUpdate = true;
  stalks.frustumCulled = tops.frustumCulled = false;

  const g = new THREE.Group();
  g.add(stalks, tops);
  return g;
}

// ---------------------------------------------------------------------------
// 草地
// ---------------------------------------------------------------------------
const GRASS_H = 0.52;

// 把固定數量的草平均撒滿 1700×1700 的世界，等於每 100 平方公尺才一撮 —— 看起來
// 就是幾根孤零零的雜草。真正該做的是讓草「跟著玩家走」：維持一塊以玩家為中心的
// 磚格陣列，玩家跨過磚界時只重新配置捲出視野的那幾塊。
//
// 於是同樣的 instance 預算全部集中在看得到的範圍內，密度提高兩個數量級。
// 除草區：建築模組登記的長方形（街道、廣場、參道），草不長在裡面。
// GrassField 會隨玩家移動持續重鋪磚塊，所以建構順序無所謂——
// 建築在初始化期間登記完，之後每次 _fill 都會查到。
const clearings = [];
export function addClearing(x, z, hw, hd) { clearings.push({ x, z, hw, hd }); }

export class GrassField {
  constructor(total, tiles = 8, tileSize = 26) {
    this.n = tiles;
    this.tileSize = tileSize;
    this.per = Math.max(8, Math.floor(total / (tiles * tiles)));
    this.count = this.per * tiles * tiles;
    this.rnd = mulberry32(90210);

    // 角色高 1.75 單位，草就該是腳踝到小腿的高度。
    const H = GRASS_H, W = 0.8;
    const blade = new THREE.PlaneGeometry(W, H, 1, 1);
    blade.translate(0, H / 2, 0);
    const b2 = blade.clone(); b2.rotateY(Math.PI / 2);
    const b3 = blade.clone(); b3.rotateY(Math.PI / 4);
    const geo = BGU.mergeGeometries([blade, b2, b3]);

    // 每個實例挑圖集左半（高草）或右半（矮叢）—— 一個 draw call 兩種草
    const variants = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) variants[i] = this.rnd() < 0.55 ? 0 : 1;
    geo.setAttribute('aVariant', new THREE.InstancedBufferAttribute(variants, 1));

    const mat = new THREE.MeshStandardMaterial({
      map: grassAtlasTexture(),
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.92,
      metalness: 0,
    });

    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      mat.userData.shader = sh;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          attribute float aVariant;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          // 圖集左右分區：aVariant 決定用哪一種草
          vMapUv.x = vMapUv.x * 0.5 + aVariant * 0.5;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 iPos = vec3(0.0);
          #endif
          float sway = sin(uTime * 1.7 + iPos.x * 0.28 + iPos.z * 0.19)
                     + sin(uTime * 2.9 + iPos.x * 0.11) * 0.45;
          float infl = smoothstep(0.0, ${GRASS_H.toFixed(2)}, transformed.y);
          transformed.x += sway * 0.085 * infl;
          transformed.z += sway * 0.05 * infl;`);
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData.isGrass = true;

    // 每個 slot 目前對應到哪一格世界磚；用不可能的初值強迫首次填充
    this.slotCoord = new Int32Array(tiles * tiles * 2).fill(0x7ffffff);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._col = new THREE.Color();
  }

  _fill(slot, wx, wz) {
    const T = this.tileSize;
    const x0 = wx * T, z0 = wz * T;
    const base = slot * this.per;
    const rnd = this.rnd;

    for (let i = 0; i < this.per; i++) {
      const x = x0 + rnd() * T;
      const z = z0 + rnd() * T;
      const h = terrainHeight(x, z);

      // 不長在水裡、雪線之上，或裸露的陡坡上
      let ok = h > WORLD.waterLevel + 0.8 && h < 132;
      if (ok) {
        // 便宜的坡度估算：兩個額外取樣就夠，不必用 terrainNormal（那要四個）
        const dx = terrainHeight(x + 2.5, z) - h;
        const dz = terrainHeight(x, z + 2.5) - h;
        ok = dx * dx + dz * dz < 3.2;
      }
      if (ok && fbm(x * 0.008, z * 0.008, 2) < -0.34) ok = false;
      // 街道 / 廣場 / 參道：除草區內不長草
      if (ok) {
        for (const c of clearings) {
          if (Math.abs(x - c.x) < c.hw && Math.abs(z - c.z) < c.hd) { ok = false; break; }
        }
      }

      if (!ok) {
        // 用零縮放藏起來，比維護一份壓縮列表簡單得多
        this._m.makeScale(0, 0, 0);
      } else {
        this._q.setFromAxisAngle(this._up, rnd() * Math.PI * 2);
        this._v.set(x, h - 0.06, z);
        const s = 0.75 + rnd() * 0.5;
        this._s.set(s, s * (0.7 + rnd() * 0.75), s);
        this._m.compose(this._v, this._q, this._s);
        // 跟著地表生態染色：森林裡的草偏深、神社周邊偏乾、湖岸偏黃
        biomeColor(x, z, h, 0.1, this._col);
        const j = 0.82 + rnd() * 0.36;
        this._col.r *= j; this._col.g *= j; this._col.b *= j;
        this.mesh.setColorAt(base + i, this._col);
      }
      this.mesh.setMatrixAt(base + i, this._m);
    }
  }

  /** 玩家移動時補上捲進視野的磚塊；每幀最多重建 budget 塊以免掉幀 */
  update(playerPos, budget = 2) {
    const n = this.n, T = this.tileSize, half = n >> 1;
    const ptx = Math.floor(playerPos.x / T);
    const ptz = Math.floor(playerPos.z / T);
    let dirty = false;

    for (let iz = 0; iz < n && budget > 0; iz++) {
      for (let ix = 0; ix < n && budget > 0; ix++) {
        const wx = ptx - half + ix;
        const wz = ptz - half + iz;
        // 環狀對應：同一格世界磚永遠落在同一個 slot
        const sx = ((wx % n) + n) % n;
        const sz = ((wz % n) + n) % n;
        const slot = sz * n + sx;
        if (this.slotCoord[slot * 2] === wx && this.slotCoord[slot * 2 + 1] === wz) continue;
        this.slotCoord[slot * 2] = wx;
        this.slotCoord[slot * 2 + 1] = wz;
        this._fill(slot, wx, wz);
        budget--;
        dirty = true;
      }
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** 開場先把整片草鋪好，避免玩家看到草一塊塊長出來 */
  warmup(pos) {
    this.update(pos, this.n * this.n);
  }
}
