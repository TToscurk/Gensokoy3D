// 守矢神社 —— 階段 3 遷移。風神湖畔的社殿、御柱、索道山上站。
//
// 三樣比一般圖多的東西：
//   ・火口湖（buildCraterLake，走法線滾動水面，無 RenderTarget）
//   ・拜殿可走入（INTERIORS → 互動點）
//   ・索道山上站 —— 這張圖只畫上半段纜線（規格書 §1）
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings, captureClearings } from '../../world/vegetation.js';
import { buildStructureSet, buildRopewayHalf } from '../../world/structures.js';
import { buildCraterLake, buildRiver, updateWater } from '../../world/water.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.moriya;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'moriya',
  zh: '守矢神社',
  en: 'MORIYA SHRINE',
  size: 340,                        // 社殿平台 + 火口湖 + 索道山上站
  spawn: { x: 6, z: 30, facing: 0 },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  heightSpace: 'world',
};

export const entries = {
  // 搭索道上來 —— 月台外的參道口（出站即參道）
  from_ropeway: { x: 10, z: 26, facing: 0 },
  // 從天界下來 —— 落在參道西側的空地，手水舍旁
  from_tenkai: { x: -10, z: 6, facing: Math.PI * 0.4 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'moriya_to_mountain',
    to: 'youkaiMountain',
    entry: 'from_moriya',
    // 月台：踏上月台就是搭乘。觸發半徑刻意小（3.2m）
    trigger: { x: 18, z: 18, r: 3.2 },
    label: '搭乘索道（往山麓）',
    style: 'vehicle',
    condition: null,
  },
  {
    id: 'moriya_to_tenkai',
    to: 'tenkai',
    entry: 'from_moriya',
    // 參道西側的天界之門 —— 雲上之路從這裡開始。
    // 平台實測 352m 整片平坦；注意火口湖在西南（local -42,-42），
    // 門不能開在那側，會沉進湖底
    trigger: { x: -18, z: 16, r: 5 },
    label: '天界之門（往雲上）',
    style: 'gate',
    condition: null,
  },
];

export function heightAt(x, z) {
  return terrainHeight(x + ORIGIN.x, z + ORIGIN.z);
}

export async function build(ctx) {
  const { quality: q, progress } = ctx;
  const group = new THREE.Group();
  group.name = 'map:moriya';

  await progress?.(20, '整平火口緣的平台…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  await progress?.(45, '立起社殿與御柱…');
  const st = buildStructureSet(['moriya']);
  // 索道山上站＋上半段纜線＋停靠車廂，除草區收成這張圖的一份
  const rwColliders = [];
  let rwGroup;
  const rwCaps = captureClearings(() => {
    rwGroup = buildRopewayHalf(rwColliders, 'top');
  });
  st.root.add(rwGroup);
  mergeStaticByMaterial(st.root, ['clock-hands', 'rope-cabin']);
  st.root.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(st.root);

  await progress?.(60, '注入風神湖…');
  // 火口湖與山溪都是法線滾動水面（無 RenderTarget），整組平移回原點
  const waterRoot = new THREE.Group();
  waterRoot.name = 'moriya-water';
  const crater = buildCraterLake();
  const river = buildRiver();
  waterRoot.add(crater, river);
  waterRoot.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(waterRoot);

  const toLocal = o => ({ ...o, x: o.x - ORIGIN.x, z: o.z - ORIGIN.z });
  const colliders = [...st.colliders.map(toLocal), ...rwColliders.map(toLocal)];
  const lanterns = st.lights.map(toLocal);
  const clearings = [...st.clearings.map(toLocal), ...rwCaps.map(toLocal)];
  const staticLights = st.staticLights.map(l => {
    l.position.x -= ORIGIN.x;
    l.position.z -= ORIGIN.z;
    return l;
  });

  const interactives = [];
  for (const inr of st.interiors) {
    const e = toLocal(inr.enter), ins = toLocal(inr.inside), ex = toLocal(inr.exit);
    interactives.push({
      id: inr.id + ':enter', label: `進入${inr.zh}`,
      x: e.x, z: e.z, y: e.y,
      to: { x: ins.x, z: ins.z, y: ins.y }, zh: inr.zh, msg: '推門而入…',
    });
    interactives.push({
      id: inr.id + ':exit', label: `離開${inr.zh}`,
      x: ins.x, z: ins.z, y: ins.y,
      to: { x: ex.x, z: ex.z, y: ex.y }, zh: inr.zh, msg: '回到戶外…',
    });
  }

  await progress?.(75, '種下湖畔的樹…');
  const density = q.trees / (2400 * 0.92) ** 2;
  // 下種與 plantable() 都在世界座標，先換上這張圖的除草區（換算前那份）
  setClearings([...st.clearings, ...rwCaps]);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(88, '鋪上草地…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.5)) : null;
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
    clearings,
    portals,
    npcs: ['sanae', 'kanako', 'suwako'],
    mobs: [],
    terrain, vegetation, grass, atmosphere, crater, river,

    update(dt, t, rt) {
      updateWater(crater, dt, rt.sunDir);
      updateWater(river, dt, rt.sunDir);
      atmosphere?.update(t, rt.sky, rt.nightFactor);
      if (grass) {
        grass.update(rt.playerPos);
        const gsh = grass.mesh.material.userData.shader;
        if (gsh) gsh.uniforms.uTime.value = t;
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
