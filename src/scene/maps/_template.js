// 新地圖樣板 —— 複製這個檔案改名，然後登記到 ../registry.js。
//
// 一張地圖必須自給自足：它擁有自己的地形高度場、自己的建築、自己的 NPC 名單，
// 並且能把自己徹底清乾淨。manager 不認識任何一張地圖的內容。
import * as THREE from 'three';

export const meta = {
  id: 'template',
  zh: '樣板',
  en: 'TEMPLATE',
  size: 420,                        // 邊長（公尺）
  spawn: { x: 0, y: 0, z: 30 },     // 沒指定 entry 時的落點
  fog: 0x9fb4cc,
  accent: 0xc2382f,
  sky: 'day',
  bgm: null,
};

/** 這張圖的入口點：portal 的 `entry` 指的就是這裡的鍵。 */
export const entries = {
  // from_somewhere: { x: 0, z: 170, facing: Math.PI },
};

/** 出入口。一律成對定義（A 有去 B 的，B 就要有回 A 的），registry 開機時驗證。 */
export const portals = [
  // {
  //   id: 'template_to_sando',
  //   to: 'sando',
  //   entry: 'from_template',
  //   trigger: { x: 0, z: 180, r: 6 },
  //   label: '往參道',
  //   style: 'walk',            // 'walk' 淡出淡入 ／ 'gate' 黑幕 + 進度條
  //   condition: null,          // 例：{ quest: 'main_ch1', stage: 'x' }
  // },
];

/**
 * 建構這張圖。
 * @param ctx { THREE, quality, renderer, progress(pct, text), seed, first }
 * @returns 見 SCENE_MANAGER_SPEC.md §1 的介面契約
 */
export async function build(ctx) {
  const group = new THREE.Group();
  group.name = 'map:' + meta.id;

  return {
    group,

    /** 這張圖專屬的地形高度（取代全域 terrainHeight） */
    heightAt(x, z) { return 0; },

    npcs: [],           // NPC id 陣列
    mobs: [],           // 敵人配置
    portals,            // 見上方模組層宣告
    interactives: [],   // { id, label, x, y, z, to, zh, msg }

    /** 這張圖專屬的每幀更新（水面、霧、風車…） */
    update(dt, t, ctxRT) {},

    /** 徹底釋放。共用資源（toon 材質、PBR 貼圖、草葉圖集）不可在這裡 dispose。 */
    dispose() {
      group.removeFromParent();
    },
  };
}
