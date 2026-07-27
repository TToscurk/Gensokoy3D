# 場景管理器改造規格書 — 幻想鄉 3D

> 對象：Claude Code（在 `gensokyo-3d/` 專案內執行）
> 目的：把「一張 2400×2400 開放世界地形」改成「多張獨立地圖 + 出入口串接」（楓之谷式結構）
> 前提：讀完 `README.md` 與 `HANDOFF.md` 再動手
> 原則：**分階段落地，每階段結束都要能跑、`.tmp/e2e_check.mjs` 要過**

---

## 0. 為什麼要改（給你判斷取捨用）

現況是單一大地形，所有系統直接吃全域的 `terrainHeight()`。這造成三個結構性問題：

1. 地區之間沒有距離感（走幾秒就到，異界跟本土在同一張地形上）
2. draw call 與記憶體無法分攤（目前 316～480，接近預算上限）
3. 手機平台完全無望（一次載入整個世界）

改成分圖載入後，這三項同時解決，而且單張圖的美術預算會變寬鬆。

**不要做的事**：不要順手改美術、不要順手優化別的東西、不要重寫戰鬥或任務系統。這次只動「世界是怎麼被建構與銷毀的」。

---

## 1. 目標架構

```
src/
  scene/
    manager.js      新增 — 場景生命週期、切換、過場
    registry.js     新增 — 地圖清單與出入口連線表
    maps/
      shrine.js     新增 — 博麗神社（第一張）
      sando.js      新增 — 參道（第二張）
      _template.js  新增 — 新地圖樣板
```

### 每張地圖的介面契約

```js
// src/scene/maps/shrine.js
export const meta = {
  id: 'shrine',
  zh: '博麗神社',
  en: 'HAKUREI SHRINE',
  size: 420,              // 這張圖的邊長（公尺），遠小於原本的 2400
  spawn: { x: 0, y: 0, z: 30 },
  fog: 0x9fb4cc,
  accent: 0xc2382f,
  sky: 'day',             // 天空預設，異界可換
  bgm: null,
};

// 建構這張圖。回傳的物件由 manager 持有。
export async function build(ctx) {
  // ctx = { THREE, quality, renderer, progress, THIS_MAP_SEED }
  return {
    group,              // THREE.Group，manager 會 add 進 scene
    heightAt(x, z),     // 這張圖專屬的地形高度函式（取代全域 terrainHeight）
    npcs: [...],        // 這張圖要生成的 NPC id 陣列
    mobs: [...],        // 這張圖的敵人配置
    portals: [...],     // 見下節
    interactives: [...],
    update(dt, t),      // 這張圖專屬的每幀更新（水面、霧、風車等）
    dispose(),          // 見第 3 節，必須徹底
  };
}
```

### 出入口（portal）資料格式

```js
portals: [
  {
    id: 'shrine_to_sando',
    to: 'sando',                    // 目標地圖 id
    entry: 'from_shrine',           // 目標地圖的入口點名稱
    trigger: { x: 0, z: 180, r: 6 },// 觸發圓柱範圍
    label: '往參道',
    style: 'walk',                  // 'walk' 即時淡出淡入 ／ 'gate' 黑幕+進度條
    condition: null,                // 例：{ quest: 'main_ch1', stage: 'x' }
  },
],

entries: {
  from_sando: { x: 0, z: 170, facing: Math.PI },
},
```

**規則**：portal 一律成對定義（A 有去 B 的，B 就要有回 A 的），`registry.js` 啟動時要驗證雙向完整、目標存在、`entry` 存在，缺一就在 console 印明確錯誤。

---

## 2. 分階段執行計畫

### 階段 1 — 骨架（不動任何現有地圖）

1. 建 `scene/manager.js`、`scene/registry.js`、`maps/_template.js`
2. `manager.load(mapId, entryName)`：卸舊 → 建新 → 放置玩家 → 淡入
3. 把 `main.js` 裡 `buildWorld()` 的內容**原封不動**包成 `maps/legacy_open.js`，讓現有世界變成「一張叫 legacy_open 的圖」
4. 此時遊戲行為應與改造前**完全一致**。跑全套 12 支測試，全過才進下一步

> 這一步是整個改造的安全網。先讓舊世界在新框架下活著，再談拆分。

> **階段 1 完成紀錄（2026-07-27）**
>
> 已建：`scene/manager.js`、`scene/registry.js`、`scene/maps/_template.js`、
> `scene/maps/legacy_open.js`。`main.js` 的建構、畫質重建、世界動態更新、
> 過場、`__gensokyo` 掛鉤全部改走 manager。
>
> 實測與改造前逐項相同：高畫質 316 draw call、約 580 萬三角形、66 張 GPU 貼圖、
> console 零錯誤、出生點座標一致。
> 低畫質（預設已改成 `low`，目標機器換成 Intel Iris Xe 筆電）：60 FPS、
> 86 draw call、約 55 萬三角形、42 張 GPU 貼圖、**12 支回歸腳本全過**。
>
> 這次一併處理的風險清單項目：#14（切圖清慣性，由 `placePlayer` hook 做）、
> #15（`manager.loading` 期間跳過 update 但照樣 render）、
> #16（`__gensokyo` 改用 getter）。其餘各項留給階段 2／3。
>
> **一處與規格不同，先記在這裡**：#16 原本要把 `__gensokyo.scene` 改成回傳
> 現行地圖的 group。實際保留 `scene` 指向根 Scene，另外加 `map` / `mapGroup` /
> `mapId` 三個 getter。原因有二：`.tmp/lake_probe.mjs` 靠 `scene.traverse` 找湖面；
> 而階段 1 的建築、NPC、燈光都還在 manager 之外的持久層，把 `scene` 換成
> 地圖 group 會讓既有腳本掃不到它們。等階段 3 建築遷進地圖後再改回規格的寫法。
>
> **階段 1 沒有搬進地圖的東西**：`buildStructures()` 與其互動點、NPC、燈籠池。
> 規格說「把 `buildWorld()` 的內容原封不動包起來」，而畫質切換從來不重建建築 ——
> 一併搬進去就會改變既有行為，違背這一階段的目的。

### 階段 2 — 兩張真圖互通

1. 從 `legacy_open` 切出 `shrine.js`（神社台地 + 拜殿 + 鳥居 + 石段起點，約 420×420）
2. 新增 `sando.js`（參道，狹長 200×600，兩側石燈籠與杉木）
3. 兩張圖用 portal 互通，`style: 'walk'`
4. 驗收：來回切換 20 次，記憶體不成長（見第 3 節）、console 零錯誤

### 階段 3 — 逐張遷移

依序：人間之里 → 魔法之森 → 霧之湖 → 紅魔館 → 竹林/永遠亭 → 其餘。
異界（白玉樓、天界、彼岸）最後做，且 `style: 'gate'`，天空與霧色獨立。

**每遷移一張就跑一次回歸測試**，不要一口氣搬完再測。

---

## 3. dispose 紀律（最容易出錯的地方）

three.js 不會自動回收 GPU 資源。每張圖的 `dispose()` 必須：

```js
dispose() {
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        for (const k in m) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      });
    }
  });
  group.removeFromParent();
  // 額外：RenderTarget（水面反射）、InstancedMesh 的 instanceMatrix、
  //       自訂 shader 的 uniform 貼圖、事件監聽器、setInterval
}
```

**共用資源不可 dispose**：角色的共用 toon 材質、`assets/textures/` 載入的 PBR 貼圖、草葉圖集——這些跨圖重用，交給一個 `core/sharedAssets.js` 持有，永不釋放。誤 dispose 共用貼圖會讓切回來時整片變黑。

**驗證方式**（寫成 `.tmp/test_scene_churn.mjs`）：
連續切換兩張圖 30 次，每 10 次記錄一次
`renderer.info.memory.geometries / .textures` 與 `performance.memory.usedJSHeapSize`。
判定：geometries 與 textures 回到基準值 ±5 以內，heap 不單調成長。

---

## 4. 會被牽動而出錯的地方（重點清單）

這是這次改造真正的風險面。逐項處理，處理完在本檔打勾。

| # | 系統 | 現況 | 會壞在哪 | 對策 |
|---|---|---|---|---|
| 1 | `world/terrain.js` `terrainHeight()` | 全域唯一真相，植被／碰撞／相機／草地全吃它 | 分圖後不再有「全世界」的高度 | 改成每張圖回傳自己的 `heightAt()`；`manager` 暴露 `currentMap.heightAt`，所有呼叫端改讀它。**這是改動量最大的一項** |
| 2 | `regionAt()` | 依座標判斷所在地區 | 分圖後地區 = 地圖本身 | 直接改成回傳 `manager.current.meta`，函式保留以免呼叫端全改 |
| 3 | `config.js` `REGIONS` | 含 x/z/radius/elev 的全域佈局表 | 座標欄位失效 | 保留 id/zh/en/fog/accent 當 meta 來源，**移除 x/z/elev/radius/peak**，改由各地圖自己定義地形 |
| 4 | `ui/mapview.js` | 底圖烘焙 + 17 地標 + 大地圖傳送 | 沒有單一世界座標系了 | 改成「地圖連線圖」（節點 + 連線），不是俯視底圖。這一項工作量不小，可以在階段 2 先降級成純清單 |
| 5 | `quests/manager.js` `onEnter` | 靠 `regionAt` 變化觸發 | 觸發時機改變 | 改由 `manager` 在載圖完成時發出 `onEnter(mapId)`。**注意：載圖完成的時機要在玩家定位之後**，否則會在錯誤位置觸發 |
| 6 | `world/structures.js` `WARP_NODES` | 設定面板的傳送清單 | 與 portal 概念重複 | 保留為除錯用「直接跳到任一地圖」，走 `manager.load()` |
| 7 | `world/interactives.js` | 全域 registry + `clearInteractives()` | 切圖時殘留舊圖的互動點 | `manager` 在卸圖時強制 `clearInteractives()`，新圖 build 後重新註冊 |
| 8 | `entities/npc.js` | 34 位 NPC 全域管理、260m 距離剔除 | 全部 NPC 一直存在 | 改成每張圖只生成 `meta.npcs` 列出的那幾位。距離剔除可以保留但幾乎用不到了 |
| 9 | `combat/mobs.js` | 敵人生成 | 切圖時敵人殘留、或戰鬥中切圖 | 卸圖時清空 mobs；**戰鬥中禁止觸發 portal**（`combat.isActive()` 時忽略觸發區） |
| 10 | `world/vegetation.js` `GrassField` | 以玩家為中心 8×8 磚格 | 磚格座標跨圖後錯亂 | 切圖時重置磚格快取；小圖可考慮直接鋪滿不用磚格 |
| 11 | `fx/atmosphere.js` | 雲與霧的 instanced 面片 | 霧片位置綁在世界座標 | 每張圖自己一份 Atmosphere 實例，dispose 時釋放 |
| 12 | `world/water.js` | 反射水面用 RenderTarget | RenderTarget 洩漏 | 沒水的圖不要建；有水的圖 dispose 時 `.dispose()` RenderTarget |
| 13 | 燈籠光源池（8 盞 PointLight） | 全域池，每 0.25s 指派 | 指到已銷毀的燈籠 | 池子留在 manager 層（跨圖重用 Light 物件），但每次切圖清空指派名單 |
| 14 | `player/controller.js` | 碰撞、相機避地吃 `terrainHeight` | 同 #1 | 改注入 `heightAt`；切圖後**必須清空垂直速度與慣性**，否則帶著墜落速度進新圖 |
| 15 | `main.js` 主迴圈 | `try { update() } catch` + 迴圈外 `composer.render()` | 切圖中途 update 讀到半銷毀的物件 | manager 設 `state.loading = true` 期間跳過 update，但**照樣 render**（保險絲不能拆） |
| 16 | `window.__gensokyo` | 12 支測試腳本全靠它 | 物件參考在切圖後失效 | 改成 getter：`get scene(){ return manager.current?.group }`，永遠指向現行場景 |
| 17 | 存檔 `gensokyo-quests-v1` | localStorage | 沒有記錄所在地圖 | 新增 `gensokyo-save-v1` 存 `{ mapId, entry }`，重整後回到原地圖 |
| 18 | `index.html` 的 `?v=N` | 快取破除 | 改了忘了加 | 每次改 `index.html` 都要加一 |

---

## 5. 過場流程（避免半銷毀狀態被讀到）

順序不可調換：

1. `state.loading = true`、鎖住輸入
2. 淡出（`walk` 200ms／`gate` 黑幕 + 進度條）
3. **等一幀**（確保沒有 update 正在跑到一半）
4. `clearInteractives()`、清 mobs、清 NPC、`oldMap.dispose()`
5. `await newMap.build()`
6. 放置玩家到 `entry` 座標與朝向，**清空速度與慣性**
7. 套用新圖的 fog／sky／accent
8. `quests.onEnter(newMapId)`
9. `state.loading = false`、淡入、解鎖輸入

---

## 6. 驗收標準

階段 2 完成時，全部要成立：

- [ ] `node .tmp/e2e_check.mjs 10` 通過，console 零錯誤
- [ ] 12 支既有回歸腳本全過（`test_quests` / `test_combat` / `test_sword` / `test_trail` / `test_ultimate` / `test_fx` / `test_mobility` / `test_crashguard` 為必測）
- [ ] 新增 `test_scene_churn.mjs`：切換 30 次無記憶體成長
- [ ] 新增 `test_portal.mjs`：雙向連線完整性、entry 定位正確、戰鬥中不觸發、切圖後玩家速度歸零
- [ ] 單張圖 draw call < 200（比現在的 316 明顯下降，這是這次改造應得的紅利）
- [ ] 低畫質下手機瀏覽器可開啟且 > 25fps（用手機連區網 IP 實測）

---

## 7. 給執行者的提醒

- **不要一次改完**。階段 1 的 `legacy_open` 包裝是刻意設計的緩衝，跳過它會讓除錯變成大海撈針。
- **`heightAt` 的注入是最容易漏的**。全專案搜尋 `terrainHeight`，每一處都要處理，包括測試腳本裡的。
- **能用數字驗的就不要截圖**（沿用專案既有心法）。記憶體、draw call、玩家座標都可以量。
- 遇到與本規格衝突的既有設計，**先回報再動手**，不要自行決定。
