import * as THREE from 'three';
import { QUALITY, DEFAULT_QUALITY, WORLD, REGIONS, REGION_BY_ID } from './config.js';
import { regionAt } from './world/terrain.js';
import { WIND } from './world/vegetation.js';
import { buildStructures, MAT, FALLS, ROPEWAY, INTERIORS, WARP_NODES } from './world/structures.js';
import { nearestInteractive, registerInteractive, clearInteractives } from './world/interactives.js';
import { mergeStaticByMaterial } from './core/optimize.js';
import { SkySystem } from './world/sky.js';
import { buildCharacter, RIM } from './entities/model.js';
import { PLAYABLE, ROSTER } from './entities/roster.js';
import { NPCManager } from './entities/npc.js';
import { PlayerController } from './player/controller.js';
import { Dialogue } from './ui/dialogue.js';
import { QuestManager } from './quests/manager.js';
import { QuestLog } from './ui/questlog.js';
import { buildComposer, tuneBloom } from './fx/postprocess.js';
import { Petals, Spirits, Danmaku } from './fx/particles.js';
import { SceneManager } from './scene/manager.js';
import { Combat } from './combat/combat.js';
import { FairyMobs } from './combat/mobs.js';
import { SlashFX, SlashAudio } from './fx/slash.js';
import { MapView } from './ui/mapview.js';

window.__gensokyoBooted = true;

// ===========================================================================
// 全域狀態
// ===========================================================================
const state = {
  quality: DEFAULT_QUALITY,
  running: false,
  worldGroup: null,
  terrain: null,
  vegetation: null,
  water: null,
  lanterns: [],
  lightPool: [],
  clock: new THREE.Clock(),
  t: 0,
  fpsAcc: 0, fpsCount: 0, fps: 60,
  lastRegion: null,
  sensitivity: 1.0,
  invertY: false,
};

const $ = id => document.getElementById(id);
const boot = $('boot'), bootBar = $('bar').firstElementChild, tip = $('tip');

function progress(pct, text) {
  bootBar.style.width = pct + '%';
  if (text) tip.textContent = text;
  // 刻意不用 requestAnimationFrame —— 分頁在背景時 rAF 會被凍結，
  // 載入流程會直接卡死。setTimeout 在背景仍然會跑。
  return new Promise(r => setTimeout(r, 0));
}

// ===========================================================================
// 渲染器
// ===========================================================================
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const DEFAULT_EXPOSURE = 0.72;
renderer.toneMappingExposure = DEFAULT_EXPOSURE;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// EffectComposer 每個 pass 都會呼叫 render()，而 render() 預設會重置統計，
// 導致 HUD 只讀到最後一個全螢幕 pass。改成手動重置，讓數字涵蓋整幀。
renderer.info.autoReset = false;
// WebGL context 遺失偵測：記進除錯心跳（index.html 的 __hb），
// 分頁異常消失後能分辨是不是 GPU 層出的問題。
renderer.domElement.addEventListener('webglcontextlost', () => {
  if (window.__hb) { window.__hb.state.contextLost = true; window.__hb.write(); }
});
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.2, 4000);
camera.position.set(0, 60, 400);

let sky, composer, bloom, npcs, player, dialogue, petals, spirits, danmaku, quests, questLog;
let combat, mobs, slashFX, slashAudio;
let mapView;

// ===========================================================================
// 世界建構 —— 交給場景管理器
// ===========================================================================
// 世界不再是「開機時建一次的東西」，而是「現在載著的那張地圖」。
// 階段 1 只有一張圖（legacy_open ＝ 原本的 2400×2400 開放世界），
// 行為與改造前完全一致；分圖是階段 2 以後的事。
const manager = new SceneManager({
  scene, renderer,
  quality: () => QUALITY[state.quality],
  progress,
  hooks: {
    /** 地圖卸載前：互動點不歸地圖持有，卸圖時一律清掉。
     *  要裝什麼回去由下一張圖的 applyEnv 決定 —— 判斷放在載入端，
     *  卸載端不需要知道「下一張是誰」。 */
    beforeUnload() {
      clearInteractives();
    },
    placePlayer(spot) {
      if (!player) return;
      // teleport() 內部已把 vel 歸零 —— 切圖不能帶著上一張圖的墜落速度過去
      player.teleport(spot.x, spot.z, spot.y);
      if (spot.facing !== undefined) player.camYaw = spot.facing;
      // 注意讀的是 manager.map 而不是 state.grass —— 這個 hook 在
      // syncWorldRefs() 之前跑，state.grass 還指著剛被 dispose 的舊圖。
      // 磚格快取記的是上一張圖的座標，先作廢再暖機（規格書 §4 #10）。
      const g = manager.map?.grass;
      g?.reset();
      g?.warmup(player.pos);
    },
    applyEnv(meta, map) {
      // 曝光：預設全專案統一 DEFAULT_EXPOSURE，圖自己想調亮/調暗才填 meta.exposure
      // （目前只有神社用，其餘 17 張圖沒有這個欄位、行為不變）。
      renderer.toneMappingExposure = meta?.exposure ?? DEFAULT_EXPOSURE;
      // 空氣牆：把玩家夾在這張圖的範圍內（見 controller._clampToBounds）。
      // legacy_open 的 2400 對應舊世界本來就有的環形山，設了也一致。
      if (player) {
        const hx = (meta?.sizeX ?? meta?.size ?? 0) / 2;
        const hz = (meta?.sizeZ ?? meta?.size ?? 0) / 2;
        player.bounds = hx > 0 ? { hx, hz } : null;
      }
      // 自帶內容的圖（shrine / sando）用自己的；沒有的（legacy_open）
      // 把開機時建好的持久層裝回去。
      // 有些圖沒有建築也沒有互動點（霧之湖），但它仍然是一張自給自足的圖 ——
      // 靠數量推斷會把它誤判成 legacy_open，把舊世界的持久層裝回來。
      // 所以地圖可以用 ownsContent 明講。
      const ownsContent = map?.ownsContent
        ?? !!(map?.colliders?.length || map?.interactives?.length);
      if (ownsContent) applyMapContent(map);
      else restorePersistentLayer();
    },
    onEnter(mapId) {
      quests?.onEnter(mapId);
    },
    lockInput(on) {
      if (player) player.enabled = !on;
    },
    // 過場沿用傳送用的黑幕：'walk' 只淡一下，'gate' 走完整的進度條
    fadeOut(style, mapId) { return beginTransition(style, mapId); },
    fadeIn(style) { return endTransition(style); },
  },
});

// ---------------------------------------------------------------------------
// 持久層（legacy_open 專用）
// ---------------------------------------------------------------------------
// 舊世界的建築、碰撞盒、燈籠、互動點都在開機時建好，跨圖不重建。
// 分圖切走再切回來時，得把這一份原樣裝回去。
const persistent = { colliders: null, lanterns: null, staticLights: null };

/** 現行地圖自己掛進場景的常亮燈（吊燈、壁燭台）。切圖時要收走。 */
let mapStaticLights = [];

function clearMapStaticLights() {
  for (const l of mapStaticLights) scene.remove(l);
  mapStaticLights = [];
}

/** 裝回舊世界的持久層：互動點、碰撞盒、燈籠、建築群、NPC。
 *  互動點展開：室內每處拆「進入 / 離開」兩點，索道 WARP_NODES 配對互傳。
 *  離開點掛在室內落點上（帶 y）—— 站在館外同一水平座標不會誤觸。 */
function restorePersistentLayer() {
  clearInteractives();
  for (const inr of INTERIORS) {
    registerInteractive({
      id: inr.id + ':enter', label: `進入${inr.zh}`,
      x: inr.enter.x, z: inr.enter.z, y: inr.enter.y,
      to: { x: inr.inside.x, z: inr.inside.z, y: inr.inside.y },
      zh: inr.zh, msg: '推門而入…',
    });
    registerInteractive({
      id: inr.id + ':exit', label: `離開${inr.zh}`,
      x: inr.inside.x, z: inr.inside.z, y: inr.inside.y,
      to: { x: inr.exit.x, z: inr.exit.z, y: inr.exit.y },
      zh: inr.zh, msg: '回到戶外…',
    });
  }
  for (const w of WARP_NODES) {
    const dest = WARP_NODES.find(v => v.id === w.to);
    if (!dest) continue;
    registerInteractive({
      id: 'warp:' + w.id, label: w.label,
      x: w.x, z: w.z, y: w.y,
      to: { x: dest.x, z: dest.z, y: dest.y },
      zh: dest.zh, msg: '索道行進中…',
    });
  }
  clearMapStaticLights();
  if (persistent.colliders) {
    state.colliders = persistent.colliders;
    state.lanterns = persistent.lanterns;
    if (player) player.colliders = state.colliders;
    for (const l of persistent.staticLights || []) scene.add(l);
  }
  // 舊世界的建築群整組顯示回來
  const st = scene.getObjectByName('structures');
  if (st) st.visible = true;
  npcs?.setRoster(null);
  syncGlobalFx({ id: 'legacy_open' }, null);
}

/**
 * 套用現行地圖自帶的內容：碰撞盒、燈籠、互動點。
 * 自帶內容的圖（shrine / sando）會把持久層的建築藏起來 ——
 * 那是舊世界的東西，站在參道上不該撞到人間之里的牆。
 */
function applyMapContent(map) {
  const st = scene.getObjectByName('structures');
  if (st) st.visible = false;
  // 這張圖只上自己列的住民，位置照地圖原點換算成局部座標
  npcs?.setRoster(map.npcs || [], map.origin || { x: 0, z: 0 },
                  (manager.meta?.size || 0) / 2);

  state.colliders = map.colliders || [];
  state.lanterns = map.lanterns || [];
  if (player) player.colliders = state.colliders;

  // 常亮燈（室內吊燈、壁燭台）不跟晝夜開關，是直接掛在場景上的物件 ——
  // 換圖時舊世界那批要收走，換上這張圖自己的，否則紅魔館的吊燈
  // 會亮在別張圖的空中，而遷過來的館裡反而是黑的。
  for (const l of persistent.staticLights || []) scene.remove(l);
  clearMapStaticLights();
  for (const l of map.staticLights || []) { scene.add(l); mapStaticLights.push(l); }

  syncGlobalFx(manager.meta, map.origin);

  clearInteractives();
  for (const it of map.interactives || []) registerInteractive(it);
}

/** 櫻花吹雪與人魂是全域物件，粒子座標寫死在舊世界的世界座標。
 *  分圖的座標系以各地圖原點為心，這些粒子只有在「錨點所在的那張圖」
 *  才對得上位置 —— 進那張圖時整組平移過來，其他圖乾脆收起來，
 *  免得白玉樓的花瓣飄在魔法之森的上空（世界座標在別張圖是錯的）。
 *  人魂一半錨魔法之森、一半錨白玉樓：平移後只有屬於這張圖的那半
 *  會落在視野內，另半掛在圖外遠處，看不見也不花錢。 */
function syncGlobalFx(meta, origin) {
  if (!petals || !spirits) return;
  const id = meta?.id;
  const anchored = id === 'netherworld' || id === 'forest';
  if (id === 'legacy_open') {
    petals.points.visible = spirits.points.visible = true;
    petals.points.position.set(0, 0, 0);
    spirits.points.position.set(0, 0, 0);
  } else if (anchored && origin) {
    petals.points.visible = id === 'netherworld';
    spirits.points.visible = true;
    petals.points.position.set(-origin.x, 0, -origin.z);
    spirits.points.position.set(-origin.x, 0, -origin.z);
  } else {
    petals.points.visible = spirits.points.visible = false;
  }
}

/** 把現行地圖的世界物件接回 state —— 切圖後這些參考全是新的。 */
function syncWorldRefs() {
  const m = manager.map;
  state.worldGroup = m?.group || null;
  state.terrain = m?.terrain || null;
  state.vegetation = m?.vegetation || null;
  state.grass = m?.grass || null;
  state.water = m?.water || null;
  state.craterWater = m?.craterWater || null;
  state.riverWater = m?.riverWater || null;
  state.atmosphere = m?.atmosphere || null;
  // 切圖後重烘小地圖底圖（分圖各自一張局部俯視圖；legacy_open 用世界烘焙）
  mapView?.onMapChanged();
}

async function buildOnce() {
  const q = QUALITY[state.quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));

  await manager.validate();
  // 開機直接進分圖（神社）。legacy_open 仍是備援，可從設定面板傳送進去。
  await manager.load('shrine', null, { style: 'boot' });
  syncWorldRefs();

  await progress(64, '建造神社、洋館、寺塔與白玉樓…');
  const { root, colliders, lights, staticLights } = buildStructures();
  // 建築完全靜態 —— 依材質合併成少數大網格，draw call 少一個數量級。
  // 時鐘指針會轉、索道車廂會動，必須留在外面（skip 沿父鏈查名）。
  mergeStaticByMaterial(root, ['clock-hands', 'rope-cabin']);
  scene.add(root);
  // 室內常亮燈（吊燈、壁燭台）：不像戶外燈籠池那樣跟著晝夜開關，
  // 加進場景一次就好，數量少（目前僅紅魔館正廳 3 盞），不會拖垮 light 預算。
  for (const l of staticLights) scene.add(l);
  persistent.staticLights = staticLights;

  const hands = root.getObjectByName('clock-hands');
  state.clockHour = hands?.getObjectByName('hour') || null;
  state.clockMinute = hands?.getObjectByName('minute') || null;
  state.colliders = colliders;
  state.lanterns = lights;
  persistent.colliders = colliders;
  persistent.lanterns = lights;

  // 持久層建好後，只有開機落在舊世界才需要立刻裝回；落在分圖的話
  // applyMapContent 已經把該藏的藏好了（此時建築才剛生出來，要補藏）。
  if (manager.id === 'legacy_open') {
    restorePersistentLayer();
  } else {
    const st = scene.getObjectByName('structures');
    if (st) st.visible = false;
  }

  // 燈籠光源池：只點亮離玩家最近的幾盞
  for (let i = 0; i < 8; i++) {
    const l = new THREE.PointLight(0xffaa66, 0, 38, 1.9);
    l.castShadow = false;
    scene.add(l);
    state.lightPool.push(l);
  }

  await progress(74, '張開天蓋…');
  sky = new SkySystem(scene, renderer, q.viewDist);
  sky.setShadowExtent(q.shadowExtent);
  if (q.shadow > 0) {
    sky.sun.shadow.mapSize.set(q.shadow, q.shadow);
  } else {
    sky.sun.castShadow = false;
  }
  camera.far = q.viewDist * 1.35;
  camera.updateProjectionMatrix();

  await progress(84, '召喚幻想鄉的住民…');
  npcs = new NPCManager(scene);
  // 舊世界＝全員到齊。分圖之後每張圖只上自己那幾位（§4 #8）。
  npcs.setRoster(null);

  await progress(92, '散開櫻花與人魂…');
  petals = new Petals(q.petals);
  scene.add(petals.points);
  spirits = new Spirits(Math.round(q.petals * 0.5));
  scene.add(spirits.points);

  // 彈幕：繞著幾位角色的裝飾性彈幕環
  const anchorFor = (id, color, count, radius, speed) => {
    const n = npcs.npcs.find(v => v.spec.id === id);
    if (!n) return null;
    return { pos: n.pos.clone().setY(n.pos.y + 1.4), color, count, radius, speed };
  };
  const anchors = [
    anchorFor('remilia', 0xff4a5a, 16, 1.5, 0.7),
    anchorFor('flandre', 0xffd24a, 24, 1.8, -0.55),
    anchorFor('cirno', 0x8fe0ff, 16, 1.6, 0.9),
    anchorFor('marisa', 0xfff0a0, 8, 1.3, 1.1),
    anchorFor('yukari', 0xd48aff, 16, 1.7, 0.45),
    anchorFor('yuyuko', 0xffb0d8, 16, 1.6, 0.35),
    anchorFor('yuuka', 0xd8e84a, 14, 1.5, 0.5),
    anchorFor('kanako', 0xd84a4a, 14, 1.6, -0.4),
    anchorFor('kaguya', 0xf2d8a0, 12, 1.4, 0.3),
  ].filter(Boolean);
  danmaku = new Danmaku(anchors);
  scene.add(danmaku.mesh);

  // 戰鬥：斬擊特效池 + 雜魚妖精群（玩家無關，先建好；控制器等選角後建）
  slashFX = new SlashFX(scene);
  slashAudio = new SlashAudio();
  mobs = new FairyMobs(scene);

  await progress(97, '整備後製…');
  ({ composer, bloom } = buildComposer(renderer, scene, camera, q));

  dialogue = new Dialogue();

  // Mission AI：手寫分支任務樹。isNight 直接讀 sky 的太陽仰角，
  // 跟 HUD、燈籠池判斷晝夜用的是同一套邏輯，不會兩邊對不上。
  quests = new QuestManager({ isNight: () => sky.sunElevation < -0.1125 });
  questLog = new QuestLog(quests);

  await progress(100, '結界已開。');
}

// ===========================================================================
// 畫質切換：重建地形、植被、陰影與後製
// ===========================================================================
async function applyQuality(name) {
  if (name === state.quality || !state.running) return;
  state.quality = name;
  const q = QUALITY[name];

  state.running = false;
  boot.classList.remove('gone');
  await progress(8, '重建結界…');

  // 拆掉舊世界、用新畫質重建同一張圖（玩家留在原地）
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
  await manager.rebuild();
  syncWorldRefs();
  state.grass?.warmup(player.pos);

  await progress(82, '調整光影…');
  sky.setShadowExtent(q.shadowExtent);
  sky.setViewDist(q.viewDist);
  sky.sun.castShadow = q.shadow > 0;
  if (q.shadow > 0) {
    sky.sun.shadow.mapSize.set(q.shadow, q.shadow);
    sky.sun.shadow.map?.dispose();
    sky.sun.shadow.map = null;
  }
  camera.far = q.viewDist * 1.35;
  camera.updateProjectionMatrix();

  await progress(94, '重建後製鏈…');
  composer.dispose?.();
  ({ composer, bloom } = buildComposer(renderer, scene, camera, q));

  await progress(100, '完成。');
  boot.classList.add('gone');
  state.running = true;
  state.clock.getDelta();
}

// ===========================================================================
// 角色選擇
// ===========================================================================
function showCharacterSelect() {
  // 除錯心跳：上一局如果不是乾淨結束（分頁異常消失），把最後狀態亮在選角畫面，
  // 使用者不必開 F12 也能回報。
  const prev = window.__hb?.state?.prev;
  if (prev && prev.t) {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:11px;color:#8d7f94;letter-spacing:.06em;max-width:520px;text-align:center;line-height:1.8';
    el.textContent = `〔除錯〕上一局 ${prev.t} 存活 ${prev.aliveSec}s` +
      `・記憶體 ${prev.heapMB}MB` +
      (prev.contextLost ? '・WebGL context 曾遺失！' : '') +
      (prev.error ? `・錯誤：${prev.error}` : '・無錯誤紀錄（分頁是被外部關閉的）');
    $('select').appendChild(el);
  }
  const wrap = $('chars');
  wrap.innerHTML = '';
  for (const c of PLAYABLE) {
    const el = document.createElement('div');
    el.className = 'card';
    const hex = '#' + c.palette.outfit.toString(16).padStart(6, '0');
    el.innerHTML = `
      <div class="swatch" style="background:${hex}"></div>
      <div class="nm">${c.zh}</div>
      <div class="rm">${c.en}</div>
      <div class="ds">${c.desc}</div>`;
    el.onclick = () => startGame(c);
    wrap.appendChild(el);
  }
  boot.classList.add('gone');
  $('select').classList.add('on');
}

function startGame(charSpec) {
  $('select').classList.remove('on');

  const model = buildCharacter({ ...charSpec, float: false });
  scene.add(model);

  player = new PlayerController(model, camera, renderer.domElement, state.colliders);
  player.speedMul = charSpec.speed;
  player.canFly = charSpec.canFly !== false;
  player.maxAirJumps = charSpec.airJumps || 0;
  // 沒填就沿用預設（一般人的 1.6m 跳、1.85 倍疾走）
  if (charSpec.jump) player.jumpV = charSpec.jump;
  if (charSpec.airJump) player.airJumpV = charSpec.airJump;
  if (charSpec.sprintMul) player.sprintMul = charSpec.sprintMul;
  player.sensitivity = state.sensitivity;
  player.invertY = state.invertY;

  // 戰鬥控制器綁這位玩家（換角時重建，舊的自然被 GC）
  combat = new Combat(player, mobs, slashFX, slashAudio, {
    formBanner(name) {
      const el = $('formBanner');
      el.textContent = name;
      el.classList.remove('on');
      void el.offsetWidth;          // 重播 CSS 動畫
      el.classList.add('on');
    },
    charge(r) {
      // 這個 HUD 元素是後來才加的。瀏覽器如果拿到舊快取的 index.html 配新的 JS，
      // 這裡會是 null —— 而更新階段一丟例外就永遠跑不到 renderer.render()，
      // 整個畫面會全黑。少一條蓄力條無所謂，畫面不能不見。
      const el = $('charge');
      if (!el) return;
      el.classList.toggle('on', r > 0.06);
      el.classList.toggle('full', r >= 1);
      const fill = el.querySelector('.f');
      if (fill) fill.style.width = (r * 100).toFixed(1) + '%';
    },
    combo(n) {
      const el = $('combo');
      el.classList.toggle('on', n >= 2);
      if (n >= 2) {
        el.querySelector('.n').textContent = n;
        el.classList.remove('tick');
        void el.offsetWidth;
        el.classList.add('tick');
      }
    },
  });

  // 地圖：小地圖圓盤 + M 鍵大地圖。任務目標解析成世界座標在這裡做——
  // 引擎只知道「找誰/去哪區」，座標是 NPC 實體與地區表才知道的事。
  mapView = new MapView({
    player, npcs, manager,
    questMarkers: () => quests.mapObjectives().map(o => {
      if (o.npc) {
        // 目標是 NPC：分圖上要知道 NPC 住在哪張圖（roster 的 region）
        const mapId = ROSTER.find(r => r.id === o.npc)?.region || null;
        if (mapId && mapId === manager.id) {
          const n = npcs.npcs.find(v => v.spec.id === o.npc);
          if (n) return { x: n.root.position.x, z: n.root.position.z, mapId, main: o.main, label: o.title };
          return null;
        }
        if (mapId) return { x: 0, z: 0, mapId, main: o.main, label: o.title };  // 別圖的目標：大地圖落在節點上
        const n = npcs.npcs.find(v => v.spec.id === o.npc);
        if (n) return { x: n.root.position.x, z: n.root.position.z, mapId: 'legacy_open', main: o.main, label: o.title };
      } else if (o.region) {
        const r = REGION_BY_ID[o.region];
        if (r) return { x: r.x, z: r.z, mapId: o.region, main: o.main, label: o.title };
      }
      return null;
    }).filter(Boolean),
    onWarp: r => warpTo(r),
    onWarpMap: id => warpToMap(id),
  });

  // 不會飛的角色，把提示列的說明換掉
  if (!player.canFly) {
    $('keys').innerHTML =
      '<div><b>WASD</b>移動 <b>Shift</b>疾走 <b>Space</b>跳躍（可二段跳） <b>左鍵</b>攻擊（按住＝大招）</div>' +
      '<div><b>E</b>對話／互動 <b>R</b>拔刀／納刀 <b>J</b>任務日誌 <b>M</b>地圖 <b>Esc</b>放開滑鼠 <b>O</b>設定</div>';
  } else {
    $('keys').innerHTML =
      '<div><b>WASD</b>移動 <b>Shift</b>疾走 <b>F</b>飛行 <b>Space</b>升 <b>C</b>降 <b>左鍵</b>攻擊（按住＝大招）</div>' +
      '<div><b>E</b>對話／互動 <b>J</b>任務日誌 <b>M</b>地圖 <b>Esc</b>放開滑鼠 <b>O</b>設定</div>';
  }

  // 從神社的參道起步 —— 讓第一眼就看到鳥居。
  // 舊世界：傳到世界座標的參道點。分圖開機：manager.load 時玩家還沒出生，
  // placePlayer 被跳過，選角後要補放一次該圖 spawn。
  if (manager.id === 'legacy_open') {
    const R = REGION_BY_ID.shrine;
    player.teleport(R.x, R.z - 96);
    player.camYaw = Math.PI;
  } else {
    const s = manager.mod?.meta?.spawn;
    if (s) {
      player.teleport(s.x, s.z);
      if (s.facing !== undefined) player.camYaw = s.facing;
    }
  }
  // applyEnv 同理：manager.load 時玩家還沒出生，if(player) 判斷失敗，
  // 空氣牆（player.bounds）從沒被設過 —— 選角後要在這裡補跑一次。
  manager._hook('applyEnv', manager.mod?.meta, manager.map);
  state.grass?.warmup(player.pos);

  $('hud').classList.add('on');
  state.running = true;
  state.clock.getDelta();
  bindInteraction();
}

// ===========================================================================
// 互動 / UI
// ===========================================================================
function bindInteraction() {
  const tryTalk = () => {
    if (dialogue.active) {
      const closed = dialogue.advance();
      if (closed) player.enabled = true;
      return;
    }
    const n = npcs.nearest;
    if (n) {
      player.enabled = false;
      // 任務引擎先看這次對話：有沒有整場劇情（scene，取代閒聊）、
      // 有沒有專屬提示（hint，插在閒聊之前）、有沒有推進任何進行中的任務。
      const { hint, scene } = quests.onTalk(n.spec.id);
      if (scene) {
        dialogue.open(n.spec, scene, () => { player.enabled = true; });
        return;
      }
      const lines = npcs.nextTalk(n);
      dialogue.open(n.spec, hint ? [hint, ...lines] : lines, () => { player.enabled = true; });
      return;
    }
    // 附近沒 NPC 才輪到互動點（進室內、搭索道）—— NPC 優先
    const it = nearestInteractive(player.pos.x, player.pos.y, player.pos.z);
    if (it) fadeTeleport({ x: it.to.x, z: it.to.z, y: it.to.y, zh: it.zh, msg: it.msg });
  };

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyE') { tryTalk(); e.preventDefault(); }
    if (e.code === 'KeyJ') questLog.toggle();
    if (e.code === 'KeyO') $('opt').classList.toggle('on');
    if (e.code === 'KeyM' && mapView) mapView.toggle();
    if (e.code === 'KeyR' && combat && !dialogue.active) combat.toggleSheath();
    if (e.code === 'Escape') {
      if (mapView?.open) { mapView.close(); return; }
      if (dialogue.active) {
        dialogue.close();
        player.enabled = true;
      }
    }
  });

  renderer.domElement.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (dialogue.active) { tryTalk(); return; }
    // 指鎖定狀態下的左鍵 = 攻擊（還沒鎖定的第一下是拿去鎖指標的，不算出招）
    // 按著不放則同時開始蓄大招：點一下＝一招，按住 2.5 秒＝十三型全放
    if (player.locked && combat) { combat.tryAttack(); combat.holdStart(); }
  });
  // 放開、滑出視窗、切走分頁都要停止蓄力，不然回來時會莫名其妙放大招
  const endHold = () => combat?.holdEnd();
  window.addEventListener('mouseup', e => { if (e.button === 0) endHold(); });
  window.addEventListener('blur', endHold);
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) endHold(); });

  // --- 設定面板 ---
  document.querySelectorAll('#q-seg button').forEach(b => {
    if (b.dataset.q === state.quality) b.classList.add('sel');
    b.onclick = () => {
      document.querySelectorAll('#q-seg button').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      applyQuality(b.dataset.q);
    };
  });

  const timeSlider = $('time');
  timeSlider.oninput = () => {
    sky.time = +timeSlider.value;
    $('tv').textContent = fmtTime(sky.time);
  };

  const speedSlider = $('speed');
  speedSlider.oninput = () => {
    sky.speed = +speedSlider.value;
    $('sv').textContent = (+speedSlider.value) + '×';
  };

  const fovSlider = $('fov');
  fovSlider.oninput = () => {
    camera.fov = +fovSlider.value;
    camera.updateProjectionMatrix();
    $('fv').textContent = fovSlider.value;
  };

  const sensSlider = $('sens');
  sensSlider.oninput = () => {
    state.sensitivity = +sensSlider.value;
    player.sensitivity = state.sensitivity;
    $('mv').textContent = state.sensitivity.toFixed(2);
  };

  document.querySelectorAll('#inv-seg button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#inv-seg button').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      state.invertY = b.dataset.inv === '1';
      player.invertY = state.invertY;
    };
  });

  // --- 傳送點 ---
  const warps = $('warps');

  // --- 分圖：直接跳到任一張地圖（規格書 §4 #6 的除錯入口）---------------
  // 舊世界的地區傳送（下面那批）是同一張圖裡的瞬移；這批是真的換圖。
  (async () => {
    const { MAP_IDS, loadMapModule } = await import('./scene/registry.js');
    for (const id of MAP_IDS) {
      const mod = await loadMapModule(id);
      const b = document.createElement('button');
      b.className = 'warp';
      b.style.borderColor = 'rgba(120,200,255,.45)';   // 跟地區傳送區分開
      b.innerHTML = `${mod.meta.zh}<span>MAP · ${mod.meta.en.split(' ')[0]}</span>`;
      b.onclick = async () => {
        $('opt').classList.remove('on');
        pendingDest = { zh: mod.meta.zh, msg: '' };
        await manager.load(id, null, { style: 'walk' });
        syncWorldRefs();
      };
      warps.appendChild(b);
    }
  })();

  for (const r of REGIONS) {
    const b = document.createElement('button');
    b.className = 'warp';
    b.innerHTML = `${r.zh}<span>${r.en.split(' ')[0]}</span>`;
    b.onclick = () => {
      $('opt').classList.remove('on');
      warpTo(r);
    };
    warps.appendChild(b);
  }
}

/** 結界之外的地點需要真正的過渡，不能瞬間跳過去；近處的地點維持即時傳送。 */
function isRemoteRegion(r) {
  return r.remote === true || r.dir === '結界之外';
}

let warping = false;

/** 共用傳送過場：黑幕 + 進度條 + 落地。
 *  只吃純資料（{x, z, y?, zh, msg}），設定頁傳送、互動點、未來的存檔都走同一條。
 *  進度條純粹是節奏感 —— 讓「跨越邊界」讀起來有份量，
 *  而不是暗示背景在做什麼運算。 */
async function fadeTeleport({ x, z, y, zh, msg }) {
  if (warping) return;
  warping = true;
  player.enabled = false;
  const fade = $('warpFade'), bar = $('warpBar');
  $('warpDest').textContent = zh;
  $('warpMsg').textContent = msg;
  bar.style.width = '0%';
  fade.classList.add('on');

  await new Promise(res => setTimeout(res, 60));
  bar.style.width = '38%';
  await new Promise(res => setTimeout(res, 420));
  bar.style.width = '78%';
  player.teleport(x, z, y);
  state.grass?.warmup(player.pos);
  await new Promise(res => setTimeout(res, 380));
  bar.style.width = '100%';
  $('warpMsg').textContent = '已抵達。';
  await new Promise(res => setTimeout(res, 500));

  fade.classList.remove('on');
  await new Promise(res => setTimeout(res, 700));   // 等淡出動畫跑完再解鎖操作
  warping = false;
  player.enabled = true;
}

// --- 地圖切換的過場（manager 的 fadeOut / fadeIn hook）------------------------
// 沿用傳送黑幕的同一組 DOM：'walk' 只是短暫淡出淡入，'gate' 有份量地跨越結界。
let pendingDest = { zh: '', msg: '' };

async function beginTransition(style) {
  const fade = $('warpFade'), bar = $('warpBar');
  if (!fade) return;
  $('warpDest').textContent = pendingDest.zh;
  $('warpMsg').textContent = pendingDest.msg;
  bar.style.width = '0%';
  fade.classList.add('on');
  await new Promise(r => setTimeout(r, style === 'walk' ? 200 : 480));
  bar.style.width = '55%';
}

async function endTransition(style) {
  const fade = $('warpFade'), bar = $('warpBar');
  if (!fade) return;
  bar.style.width = '100%';
  if (style !== 'walk') $('warpMsg').textContent = '已抵達。';
  await new Promise(r => setTimeout(r, style === 'walk' ? 120 : 420));
  fade.classList.remove('on');
  await new Promise(r => setTimeout(r, 700));   // 等淡出動畫跑完
}

/** 走進出入口：切到目標地圖的指定入口。 */
async function travelTo(portal) {
  if (warping || manager.loading) return;
  warping = true;
  pendingDest = {
    zh: portal.label || '',
    msg: portal.style === 'gate' ? '正在跨越結界…'
       : portal.style === 'vehicle' ? '索道正在行進…' : '',
  };
  try {
    await manager.load(portal.to, portal.entry, { style: portal.style || 'walk' });
    syncWorldRefs();
  } finally {
    warping = false;
  }
}

/** 大地圖連線圖點節點：傳送到那張圖的預設入口。異界三張用 gate 過場。 */
const MAP_WARP_GATE = ['netherworld', 'tenkai', 'higan'];
async function warpToMap(mapId) {
  if (warping || manager.loading || mapId === manager.id) return;
  warping = true;
  const style = MAP_WARP_GATE.includes(mapId) ? 'gate' : 'walk';
  pendingDest = { zh: '', msg: style === 'gate' ? '正在跨越結界…' : '' };
  try {
    await manager.load(mapId, null, { style });
    syncWorldRefs();
  } finally {
    warping = false;
  }
}

function warpTo(r) {
  // r.warp 是地區的指定傳送落點（如妖怪之山落在索道山麓站），
  // 以前被無視、永遠傳到地區圓心南方 —— 有 warp 用 warp。
  const [wx, wz] = r.warp || [r.x, r.z + r.radius * 0.55];
  if (!isRemoteRegion(r)) {
    player.teleport(wx, wz);
    state.grass?.warmup(player.pos);
    return;
  }
  fadeTeleport({ x: wx, z: wz, zh: r.zh, msg: '正在跨越結界…' });
}

function fmtTime(m) {
  const h = Math.floor(m / 60) % 24;
  const mi = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function phaseName(m) {
  if (m < 300) return 'DEEP NIGHT';
  if (m < 400) return 'DAWN';
  if (m < 660) return 'MORNING';
  if (m < 900) return 'AFTERNOON';
  if (m < 1080) return 'DUSK';
  if (m < 1200) return 'TWILIGHT';
  return 'NIGHT';
}

// ===========================================================================
// 燈籠光源池
// ===========================================================================
let lightTimer = 0;
function updateLanterns(dt, playerPos, nightFactor) {
  // 材質統一調整發光強度
  if (MAT.paperLamp) MAT.paperLamp.emissiveIntensity = 0.15 + nightFactor * 2.2;
  if (MAT.glassWarm) MAT.glassWarm.emissiveIntensity = 0.1 + nightFactor * 2.6;

  lightTimer -= dt;
  if (lightTimer > 0) return;
  lightTimer = 0.25;

  if (nightFactor < 0.05) {
    for (const l of state.lightPool) l.intensity = 0;
    return;
  }

  // 找出離玩家最近的 N 盞
  const near = state.lanterns
    .map(v => ({ v, d: (v.x - playerPos.x) ** 2 + (v.z - playerPos.z) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, state.lightPool.length);

  state.lightPool.forEach((l, i) => {
    const n = near[i];
    if (!n || n.d > 90 * 90) { l.intensity = 0; return; }
    l.position.set(n.v.x, n.v.y, n.v.z);
    l.color.setHex(n.v.color);
    const fade = 1 - Math.min(1, Math.sqrt(n.d) / 90);
    l.intensity = n.v.power * nightFactor * fade * 4.6;
  });
}

// ===========================================================================
// 主迴圈
// ===========================================================================
function loop() {
  requestAnimationFrame(loop);
  frame();
}

// 更新階段丟例外時的保險絲。
//
// rAF 排在 frame() 之前，所以迴圈本身不會死 —— 但例外會讓 frame() 在
// composer.render() 之前就中斷，於是「畫面全黑、FPS 還顯示 60」，
// 症狀完全不像程式出錯，非常難查（2026-07-27 就被少一個 HUD 元素坑過一次）。
// 這裡把更新與繪製切開：更新爆炸了就記錄下來、照樣把上一個狀態畫出去。
// 畫面會卡住，但看得見、而且畫面上會講原因。
const crash = { count: 0, last: '' };

function reportCrash(err) {
  crash.count++;
  crash.last = String(err?.message || err);
  // 只印前幾次：每秒 60 次的洗版會把主控台淹掉，反而看不到第一手現場
  if (crash.count <= 3) console.error('[frame] 更新階段例外（畫面續繪）：', err);
  const el = $('crash');
  if (el) {
    el.classList.add('on');
    el.textContent = `更新出錯，畫面已凍結：${crash.last}（×${crash.count}）`;
  }
}

let frameDt = 0;      // update() 算出來的 dt，繪製後的 HUD 還要用

function frame() {
  if (!state.running) return;

  // 載圖中跳過更新（可能讀到半銷毀的物件），但照樣繪製 —— 保險絲不能拆
  if (!manager.loading) {
    try { update(); } catch (err) { reportCrash(err); }
  }

  // 不論更新成敗都要畫 —— 這是「不再全黑」的關鍵
  composer.render();

  // HUD 讀 renderer.info，一定要在 render 之後，否則讀到本幀 reset 完的 0
  try {
    updateHUD(player.pos, frameDt);
    mapView?.frame(frameDt);
  } catch (err) { reportCrash(err); }
}

function update() {
  renderer.info.reset();
  let dt = Math.min(0.05, state.clock.getDelta());
  // 頓挫：命中重擊時把時間壓慢一小段，無雙的「打感」。
  // rawDt 要留著給 combat 倒數 hitstop —— 用壓慢後的 dt 倒數的話，
  // 0.14 秒的頓挫會實際凍住 0.14/0.12 ≈ 1.2 秒。
  const rawDt = dt;
  if (combat?.hitstop > 0) dt *= 0.12;
  state.t += dt;
  frameDt = dt;
  const t = state.t;

  // --- 玩家 ---
  player.update(dt, t);
  const P = player.pos;

  // --- 戰鬥（接在玩家後：揮砍動畫要壓過走路動畫） ---
  combat?.update(dt, rawDt);
  mobs.update(dt, t, P);
  slashFX.update(dt);

  // --- 天空 / 光照 ---
  const pal = sky.update(dt, P);
  const nightFactor = 1 - Math.min(1, Math.max(0, sky.sunElevation * 4 + 0.5));

  // --- 世界動態（水面、雲霧、草地補磚都歸現行地圖管） ---
  manager.update(dt, t, {
    sky, sunDir: sky.sunDir, nightFactor, playerPos: P, camera,
  });
  updateLanterns(dt, P, nightFactor);
  petals.update(dt, t);
  spirits.update(dt, t, sky.sunElevation);
  danmaku.update(t, camera);
  tuneBloom(bloom, sky.sunElevation);

  // 風與輪廓光：樹冠、花田、竹葉共用同一個時間；rim 顏色跟著日光走
  WIND.uTime.value = t;
  FALLS.uTime.value = t;
  RIM.uRimColor.value.copy(sky.sun.color);
  RIM.uRimStrength.value = 0.42 + nightFactor * 0.3;

  // 紅魔館的時鐘指針
  if (state.clockHour) {
    state.clockHour.rotation.z = -(sky.time / 720) * Math.PI * 2;
    state.clockMinute.rotation.z = -((sky.time % 60) / 60) * Math.PI * 2;
  }

  // 索道車廂：兩台對開，到站折返（往返式索道，不繞圈 —— 端點回跳會穿幫）
  if (ROPEWAY.curve) {
    for (let i = 0; i < ROPEWAY.cabins.length; i++) {
      const cab = ROPEWAY.cabins[i];
      const u = (t * 0.011 + i * 1.0) % 2;
      const tt = u < 1 ? u : 2 - u;
      const p = ROPEWAY.curve.getPoint(tt);
      const q = ROPEWAY.curve.getPoint(Math.min(1, tt + 0.012));
      cab.position.copy(p);
      cab.lookAt(q.x, q.y, q.z);
    }
  }

  // --- 出入口：踏進觸發圓柱就切圖（戰鬥中不觸發，打到一半被傳走是災難） ---
  const portal = manager.portalAt(P.x, P.z, { inCombat: !!combat?.busy });
  if (portal) travelTo(portal);

  // --- NPC ---
  const near = npcs.update(t, P, camera);
  dialogue.update(dt);

  // 互動提示：NPC 對話優先，其次互動點（進入室內、搭乘索道）
  const it = near || dialogue.active ? null : nearestInteractive(P.x, P.y, P.z);
  const promptEl = $('prompt');
  const show = (near || it) && !dialogue.active;
  promptEl.classList.toggle('on', !!show);
  if (show) promptEl.querySelector('span').textContent =
    near ? `與 ${near.spec.zh} 交談` : it.label;

}

/** 現在載著的是不是舊世界那張大圖（一張圖裡有 17 個地區）。
 *
 *  切圖途中 manager.id 會短暫是 null。這裡**不能**把 null 當成舊世界 ——
 *  那一瞬間玩家的座標還是上一張圖的局部座標，拿去問 regionAt() 會判成
 *  某個不相干的地區，然後假的 quests.onEnter 就觸發了。
 *  （實測會在每次切圖時多噴一個 'village'。） */
function isLegacyWorld() {
  return manager.id === 'legacy_open';
}

/** 玩家現在在哪 —— 分圖時就是地圖本身，舊世界才靠座標判斷。
 *  載圖中回傳 null：這時候「在哪」根本沒有答案，不要猜。 */
function currentPlace(P) {
  if (manager.loading || !manager.id) return state.lastRegion;
  if (!isLegacyWorld()) return manager.meta;
  return regionAt(P.x, P.z);
}

let hudTimer = 0;
function updateHUD(P, dt) {
  hudTimer -= dt;

  // 地區名稱（規格書 §4 #2）
  //
  // 分圖之後「所在地區」有兩種意義，不能混用：
  //   ・legacy_open —— 一張圖裡有 17 個地區，靠世界座標判斷（舊行為）
  //   ・分圖 —— 地區就是地圖本身，玩家的座標是局部的，
  //             拿去問 regionAt() 會得到完全不相干的答案
  //             （站在神社圖的 (0,180)，世界座標的同一點在人間之里）
  //
  // 這不只是 HUD 顯示錯。任務的 onEnter 是靠地區變化觸發的（§4 #5），
  // 判錯地區代表任務會在錯的圖觸發、或該觸發時沒觸發。
  const reg = currentPlace(P);
  if (reg !== state.lastRegion) {
    state.lastRegion = reg;
    const el = $('place');
    el.querySelector('.zh').textContent = reg ? reg.zh : '幻想鄉';
    el.querySelector('.en').textContent = reg ? reg.en : 'GENSOKYO';
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    // 分圖的 onEnter 由 manager 在載圖完成時發出（時機才對得上玩家定位），
    // 這裡只負責舊世界那種「走進某個地區」的觸發。
    if (reg && isLegacyWorld()) quests.onEnter(reg.id);
  }

  // 時鐘
  $('clock').querySelector('.t').textContent = fmtTime(sky.time);
  $('clock').querySelector('.p').textContent = phaseName(sky.time);
  $('tv').textContent = fmtTime(sky.time);
  $('time').value = Math.round(sky.time);

  // 統計
  if (hudTimer <= 0) {
    hudTimer = 0.4;
    const info = renderer.info;
    $('stats').innerHTML =
      `${Math.round(state.fps)} FPS · ${QUALITY[state.quality].label}<br>` +
      `X ${P.x.toFixed(0)}  Y ${P.y.toFixed(0)}  Z ${P.z.toFixed(0)}` +
      `${player.flying ? '  ·  飛行中' : ''}<br>` +
      `${(info.render.triangles / 1000).toFixed(0)}K 三角形 · ${info.render.calls} draw`;
  }
}

// FPS 平滑：每 0.5 秒統計一次，避免數字亂跳
(function fpsMeter() {
  let frames = 0, last = performance.now();
  function tick() {
    frames++;
    const now = performance.now();
    if (now - last >= 500) {
      state.fps = (frames * 1000) / (now - last);
      frames = 0; last = now;
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

// ===========================================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setSize(window.innerWidth, window.innerHeight);
});

// ===========================================================================
// 除錯入口：F12 主控台可直接摸到場景內部，方便調參數。
// 例：__gensokyo.sky.time = 1150  → 立刻切到黃昏
window.__gensokyo = { camera, renderer, frame, manager,
  // `scene` 一律指向「現在載著的那張圖」。切圖後它會指向新圖 ——
  // 拿它去 traverse 永遠不會摸到已經被 dispose 的舊圖（規格書 §4 #16）。
  // 需要整個場景（含建築、NPC、燈光等持久層）時用 rootScene。
  get scene() { return manager.map?.group || null; },
  rootScene: scene,
  get state() { return state; },
  get map() { return manager.map; }, get mapId() { return manager.id; },
  get sky() { return sky; }, get player() { return player; }, get npcs() { return npcs; },
  get quests() { return quests; }, get questLog() { return questLog; },
  get combat() { return combat; }, get mobs() { return mobs; },
  get slashFX() { return slashFX; }, get mapView() { return mapView; } };

(async function init() {
  try {
    await progress(4, '喚醒渲染器…');
    await buildOnce();
    loop();
    showCharacterSelect();
  } catch (err) {
    console.error(err);
    tip.innerHTML = `<span style="color:#e0707a">建構失敗</span><br>${err.message}<br>` +
      `<span style="font-size:10px;opacity:.6">請用 F12 看主控台的錯誤細節，或用 Ctrl+F5 強制重新整理。</span>`;
  }
})();
