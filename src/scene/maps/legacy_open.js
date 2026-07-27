// 舊世界（2400×2400 單張開放世界）—— 場景管理器改造的安全網。
//
// 內容原封不動搬自 main.js 的 buildWorld()：先讓既有世界在新框架下活著，
// 再談拆分成一張一張的小地圖（見 SCENE_MANAGER_SPEC.md §2 階段 1）。
// 建築（structures.js）此階段仍留在 main.js 的持久層，因為畫質切換
// 從來不重建它們 —— 搬進來會改變既有行為，留給階段 3 逐張遷移時處理。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField } from '../../world/vegetation.js';
import { buildWater, updateWater, buildLakeDressing, buildCraterLake, buildRiver } from '../../world/water.js';
import { Atmosphere } from '../../fx/atmosphere.js';

export const meta = {
  id: 'legacy_open',
  zh: '幻想鄉',
  en: 'GENSOKYO',
  size: 2400,
  // 從神社的參道起步 —— 讓第一眼就看到鳥居
  spawn: {
    x: REGION_BY_ID.shrine.x,
    z: REGION_BY_ID.shrine.z - 96,
    facing: Math.PI,
  },
  sky: 'day',
  bgm: null,
};

export const entries = {
  default: meta.spawn,
};

// 連線表在模組層宣告（registry 不必先 build 就能驗證雙向完整性）。
// 舊世界是孤島：所有地區都在同一張圖裡，沒有出入口。
export const portals = [];

export async function build(ctx) {
  const { quality: q, renderer, progress, first = true } = ctx;

  const group = new THREE.Group();
  group.name = 'world';

  await progress(first ? 12 : 20, '隆起山脈與湖盆…');
  const terrain = buildTerrain(q.terrainSeg);
  group.add(terrain);

  await progress(first ? 34 : 45, '播種森林與竹海…');
  const vegetation = buildVegetation(q.trees);
  group.add(vegetation);

  await progress(first ? 44 : 58, '鋪上草原…');
  const grass = q.grass > 0 ? new GrassField(q.grass) : null;
  if (grass) group.add(grass.mesh);

  await progress(first ? 52 : 70, '注入霧之湖…');
  const water = buildWater(q.waterReflect, renderer);
  group.add(water);
  const craterWater = buildCraterLake();
  group.add(craterWater);
  const riverWater = buildRiver();
  group.add(riverWater);
  group.add(buildLakeDressing());

  await progress(first ? 58 : 76, '織起雲海與霧帶…');
  const atmosphere = new Atmosphere(q.clouds, q.mist);
  group.add(atmosphere.group);

  return {
    group,
    // 這張圖就是舊的全域高度場
    heightAt: terrainHeight,

    // 舊世界的 NPC / 敵人 / 互動點仍由 main.js 的持久層管理（階段 1 不動）
    npcs: null,
    mobs: null,
    portals,
    interactives: [],

    // main.js 仍會直接讀這幾個（草地補磚、水面波動、雲霧）
    terrain, vegetation, grass, water, craterWater, riverWater, atmosphere,

    update(dt, t, rt) {
      updateWater(water, dt, rt.sunDir);
      updateWater(craterWater, dt, rt.sunDir);
      updateWater(riverWater, dt, rt.sunDir);
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
      // 反射水面的 RenderTarget：不釋放的話每次重建都留一張 512² 在 GPU 上。
      // 貼圖只釋放這一張 —— 地形六層 PBR、草葉圖集、樹皮都是跨圖共用的，
      // 誤 dispose 會讓下一張圖整片變黑（見規格書 §3）。
      water?.material?.uniforms?.mirrorSampler?.value?.dispose?.();
      group.removeFromParent();
    },
  };
}
