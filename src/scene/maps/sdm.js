// 紅魔館 —— 階段 3 遷移的第四張圖。
//
// 這張圖比前面幾張多三樣東西，都是遷移最容易掉的：
//   ・可走進去的正廳（INTERIORS → 互動點）
//   ・室內常亮吊燈（staticLights，不跟晝夜開關）
//   ・**會轉的時鐘指針**（主迴圈每幀在動的物件，不能被靜態合併吃掉）
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.sdm;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'sdm',
  zh: '紅魔館',
  en: 'SCARLET DEVIL MANSION',
  size: 460,
  spawn: { x: 0, z: 120, facing: Math.PI },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
};

export const entries = {
  // 從湖畔過來 —— 站在館的東側，面向大門
  from_lake: { x: 165, z: 60, facing: Math.PI * -0.5 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'sdm_to_lake',
    to: 'lake',
    entry: 'from_sdm',
    trigger: { x: 196, z: 74, r: 12 },
    label: '往霧之湖',
    style: 'walk',
    condition: null,
  },
];

export function heightAt(x, z) {
  return terrainHeight(x + ORIGIN.x, z + ORIGIN.z);
}

export async function build(ctx) {
  const { quality: q, progress } = ctx;
  const group = new THREE.Group();
  group.name = 'map:sdm';

  await progress?.(20, '整平館前庭園…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  await progress?.(50, '建起紅魔館…');
  const st = buildStructureSet(['sdm']);
  // 時鐘指針會轉，必須留在合併之外（〈坑〉第 7 條）—— 跟舊世界同一份 skip 名單
  mergeStaticByMaterial(st.root, ['clock-hands', 'rope-cabin']);
  st.root.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(st.root);

  // 合併之後才抓得到指針節點（合併會重排場景樹）
  const hands = st.root.getObjectByName('clock-hands');
  const clockHour = hands?.getObjectByName('hour') || null;
  const clockMinute = hands?.getObjectByName('minute') || null;

  const toLocal = o => ({ ...o, x: o.x - ORIGIN.x, z: o.z - ORIGIN.z });
  const colliders = st.colliders.map(toLocal);
  const lanterns = st.lights.map(toLocal);
  const clearings = st.clearings.map(toLocal);
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

  await progress?.(72, '種下庭園的樹…');
  const density = q.trees / (2400 * 0.92) ** 2;
  setClearings(st.clearings);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(86, '鋪上庭園草地…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.5)) : null;
  if (grass) group.add(grass.mesh);

  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.4), Math.round(q.mist * 0.6));
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
    npcs: ['meiling', 'sakuya', 'remilia', 'patchouli', 'flandre'],
    mobs: [],
    terrain, vegetation, grass, atmosphere,

    update(dt, t, rt) {
      atmosphere?.update(t, rt.sky, rt.nightFactor);
      // 時鐘指針跟著遊戲時間走。這在舊世界是主迴圈直接做的，
      // 遷進來之後歸這張圖自己管 —— 不搬過來的話館裡的鐘會停住。
      if (clockHour) {
        clockHour.rotation.z = -(rt.sky.time / 720) * Math.PI * 2;
        clockMinute.rotation.z = -((rt.sky.time % 60) / 60) * Math.PI * 2;
      }
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
