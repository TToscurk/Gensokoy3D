import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { WORLD, REGION_BY_ID, CRATER_LAKE, RIVER } from '../config.js';
import { waterNormalTexture } from '../core/textures.js';
import { terrainHeight } from './terrain.js';

// 霧之湖。高畫質用 Water.js 的平面反射（多一次場景繪製），
// 低畫質退回自寫的 fresnel 蔽面 shader，省掉整個 reflection pass。

export function buildWater(reflective, renderer) {
  const lake = REGION_BY_ID.lake;
  const size = lake.radius * 3.1;
  const geo = new THREE.CircleGeometry(size * 0.5, 72);
  // 注意：不能 geo.rotateX 把旋轉烘進幾何體 —— Water(Reflector) 的 onBeforeRender
  // 用 mesh 本身的旋轉推鏡面法線（假設 +z 朝外）。烘進幾何體後法線一直是 (0,0,1)，
  // 「鏡子背對就跳過」的判斷會在相機位於湖心 -z 側時永遠提早返回，
  // 反射貼圖與 eye uniform 全部凍結在舊視角 —— 湖面出現定格的亮紫倒影。

  let mesh;

  if (reflective) {
    const normals = waterNormalTexture();
    normals.wrapS = normals.wrapT = THREE.RepeatWrapping;

    mesh = new Water(geo, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: normals,
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff,
      waterColor: 0x22405a,
      distortionScale: 2.6,
      fog: true,
      alpha: 0.92,
    });
    mesh.material.uniforms.size.value = 6.0;
    // 從高處俯看整面湖變成鏡子（反射天頂紫藍 + 對岸山壁，像一道發光弧）：
    // 原廠 shader 用「雜訊微法線」算 fresnel theta，雜訊 y 分量過半為負，
    // theta 被 clamp 成 0 → reflectance 趨近 1 → 任何角度都是全反射。
    // 修正：theta 改用巨觀水平面（真實入射角），微法線只留給扭曲與高光。
    // 俯視 reflectance≈0.07（看見湖水本色），岸邊掠射角仍有大鏡面倒影。
    // 順帶：rf0 0.3→0.02（真實水面垂直反射率約 2%）、太陽漫射減半、
    // 反射取樣 clamp 到 1.2 —— 鏡面貼圖是 HDR 的（Preetham 太陽附近可超過 10），
    // 不 clamp 的話就算反射率只有 7%，俯視仍會整片爆亮。
    mesh.material.fragmentShader = mesh.material.fragmentShader
      .replace('float rf0 = 0.3;', 'float rf0 = 0.02;')
      .replace('sunColor * diffuseLight * 0.3', 'sunColor * diffuseLight * 0.15')
      .replace('vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );',
               'vec3 reflectionSample = min( vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) ), vec3( 1.2 ) );')
      .replace('float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );',
               'float theta = max( dot( eyeDirection, vec3( 0.0, 1.0, 0.0 ) ), 0.0 );');
    mesh.material.needsUpdate = true;
    mesh.userData.reflective = true;
  } else {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x35637f,
      transparent: true,
      opacity: 0.82,
      roughness: 0.14,
      metalness: 0.35,
      normalMap: waterNormalTexture(),
      normalScale: new THREE.Vector2(0.45, 0.45),
    });
    mat.normalMap.repeat.set(18, 18);
    mesh = new THREE.Mesh(geo, mat);
    mesh.userData.reflective = false;
  }

  mesh.rotation.x = -Math.PI / 2;   // 水平的鏡面：旋轉必須留在 mesh 上（見上方註解）
  mesh.position.set(lake.x, WORLD.waterLevel, lake.z);
  mesh.name = 'water';
  mesh.renderOrder = 1;
  return mesh;
}

/** 每幀推進水面動畫 */
export function updateWater(mesh, dt, sunDir) {
  if (!mesh) return;
  if (mesh.userData.reflective) {
    mesh.material.uniforms.time.value += dt * 0.55;
    mesh.material.uniforms.sunDirection.value.copy(sunDir);
  } else {
    const nm = mesh.material.normalMap;
    nm.offset.x += dt * 0.012;
    nm.offset.y += dt * 0.008;
  }
}

// 風神湖（山頂火口湖）。不做反射 —— Reflector 每面都是一次全場景繪製，
// GTX1070 吃不消第二份。素色透明 + 滾動法線波紋，高山湖泊的深藍。
// 從神社平台俯看是主要視角，粗糙度拉高壓掉天空鏡面反射（不然整面泛白）。
export function buildCraterLake() {
  const geo = new THREE.CircleGeometry(CRATER_LAKE.r * 1.12, 48);
  geo.rotateX(-Math.PI / 2);
  // waterNormalTexture 是快取共享的 —— repeat/offset 會互相踩，必須 clone
  const nm = waterNormalTexture().clone();
  nm.needsUpdate = true;
  nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
  nm.repeat.set(9, 9);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x16324a,
    transparent: true,
    opacity: 0.92,
    roughness: 0.38,
    metalness: 0.0,
    normalMap: nm,
    normalScale: new THREE.Vector2(0.55, 0.55),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(CRATER_LAKE.x, CRATER_LAKE.waterY, CRATER_LAKE.z);
  mesh.name = 'crater-water';
  mesh.renderOrder = 1;
  mesh.userData.reflective = false;   // 走 updateWater 的法線滾動分支
  return mesh;
}

/** 山溪：從風神湖溢流口沿 RIVER 折線鋪到霧之湖的水面帶。
 *  每個測站向兩側伸出半寬，水面貼著河床（河床單調遞減，水永遠往低處）。
 *  瀑布段（測站 3→4 落差 32m）形成一段陡坡水幕，剛好襯在瀑布平面後面。 */
export function buildRiver() {
  const HALF = 3.4;
  // 河條到湖面前一站為止：入湖段若整段鋪進湖裡，水面比湖面高的部分
  // 會浮在霧之湖上，成一條亮的藍紫色帶（水面 specular 反天空光）。
  // RIVER 資料不動（地形壓河道還是要壓進湖底），這裡只剪可見的水面。
  const pts = [];
  for (const [x, z, bed] of RIVER) {
    const y = bed + 0.55;
    if (y >= WORLD.waterLevel - 0.1) { pts.push([x, z, y]); continue; }
    const prev = pts[pts.length - 1];
    if (prev) {
      const t = (prev[2] - (WORLD.waterLevel - 0.1)) / (prev[2] - y);
      pts.push([prev[0] + (x - prev[0]) * t, prev[1] + (z - prev[1]) * t, WORLD.waterLevel - 0.1]);
    }
    break;
  }
  const n = pts.length;
  const pos = [], uv = [], idx = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const [x, z, y] = pts[i];
    const [px, pz] = i > 0 ? pts[i - 1] : [x, z];
    const [nx, nz] = i < n - 1 ? [pts[i + 1][0], pts[i + 1][1]] : [x, z];
    let dx = nx - px, dz = nz - pz;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    if (i > 0) run += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    // 左岸頂點、右岸頂點（岸向 = 流向轉 90°）
    pos.push(x - dz * HALF, y, z + dx * HALF, x + dz * HALF, y, z - dx * HALF);
    uv.push(0, run / 10, 1, run / 10);
    if (i > 0) {
      const b0 = (i - 1) * 2;
      idx.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nm = waterNormalTexture().clone();   // 共享貼圖，clone 才有自己的 offset
  nm.needsUpdate = true;
  nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
  nm.repeat.set(2, 26);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a4a5e,
    transparent: true,
    opacity: 0.88,
    roughness: 0.32,
    metalness: 0.0,
    normalMap: nm,
    normalScale: new THREE.Vector2(0.7, 0.7),
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'river-water';
  mesh.renderOrder = 1;
  mesh.userData.reflective = false;
  return mesh;
}

/** 水面下的湖底霧氣 + 岸邊蘆葦 */
export function buildLakeDressing() {
  const lake = REGION_BY_ID.lake;
  const g = new THREE.Group();
  g.name = 'lake-dressing';

  // 岸邊蘆葦
  const reed = new THREE.CylinderGeometry(0.03, 0.05, 2.2, 4);
  reed.translate(0, 1.1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a9a55, roughness: 0.9 });
  const N = 900;
  const inst = new THREE.InstancedMesh(reed, mat, N);
  inst.castShadow = true;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const v = new THREE.Vector3(), sc = new THREE.Vector3();
  const e = new THREE.Euler();
  let i = 0, tries = 0;
  while (i < N && tries < N * 25) {
    tries++;
    const a = Math.random() * Math.PI * 2;
    const d = lake.radius * (0.72 + Math.random() * 0.5);
    const x = lake.x + Math.cos(a) * d;
    const z = lake.z + Math.sin(a) * d;
    const h = terrainHeight(x, z);
    // 只長在水線上下 1.5 公尺的濕地帶
    if (h < WORLD.waterLevel - 1.4 || h > WORLD.waterLevel + 1.6) continue;
    e.set((Math.random() - 0.5) * 0.35, Math.random() * 6.28, (Math.random() - 0.5) * 0.35);
    q.setFromEuler(e);
    v.set(x, h, z);
    const s = 0.7 + Math.random() * 0.9;
    sc.set(1, s, 1);
    m4.compose(v, q, sc);
    inst.setMatrixAt(i, m4);
    i++;
  }
  inst.count = i;
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  g.add(inst);

  return g;
}
