# 交接文件 — 幻想鄉 3D（Gensokyo Explorer）

> 給接手的人（或 AI）看的。讀完這份 + `README.md` 就能上手。
> 最後更新：**2026-07-27**（戰鬥系統與緣一機動力完工）。
> 更早的輪次紀錄見文末〈歷史沿革〉。

---

## 一分鐘摘要

純 Web 的 3D 幻想鄉探索遊戲（three.js r170，打包在 `vendor/three/`，**不走 CDN**）。
無建置步驟、無 npm、無框架 —— `index.html` + ES modules 原樣跑。

**34 位 NPC + 7 位可操作角色**（東方角色 + 原創穿越角色繼國緣一）、**17 個地區**、晝夜循環、
步行／飛行／對話、分支任務系統、地圖與傳送、**日之呼吸十三型戰鬥系統**。
目標硬體是 **GTX 1070 @ 1080p 穩 60fps**。

---

## 如何跑起來

```bash
python -m http.server 8080
```
瀏覽器開 `http://localhost:8080/`（或直接雙擊 `run.bat`）。

- ES module 不能用 `file://` 開，一定要 HTTP 伺服器。
- 打不開時 99% 是伺服器沒起來。貼圖與 three.js 全部是本機檔案，不需要網路。
- **改了 `index.html` 就要把 `?v=N` 加一**（檔尾的 `<script src="./src/main.js?v=N">`）。
  原因見〈坑〉第 1 條。

## 自動化驗證（改完東西一定要跑）

```bash
# 1. 起 HTTP 伺服器（上面那行）
# 2. 起 headless Chrome：
chrome --headless=new --remote-debugging-port=9223 --window-size=1600,900 \
  --use-angle=d3d11 "http://localhost:8080/"
# 3. 跑檢查：
node .tmp/e2e_check.mjs 10
```

判讀基準：boot OK、`game running: true`、**console 零錯誤**、高畫質 FPS 接近 60。

`.tmp/` 底下有 12 支回歸腳本，全部走同一套 CDP 工具 `.tmp/cdp.mjs`
（提供 `evaljs` / `shot`）。**動到哪個系統就跑對應的那幾支**：

| 腳本 | 項數 | 範圍 |
|---|---|---|
| `e2e_check.mjs` | — | 開機、FPS、draw call、console 錯誤、截圖 |
| `test_quests.mjs` | — | 任務引擎（**純 Node，不進瀏覽器**） |
| `test_main_quest.mjs` | — | 主線第一章實機流程 |
| `test_interact.mjs` | 17 | 傳送點、室內進出、索道、NPC 對話優先權 |
| `test_map.mjs` | 13 | 底圖烘焙、小地圖、17 地標、大地圖傳送 |
| `test_combat.mjs` | — | 十三型輪迴、命中、連擊、UI |
| `test_sword.mjs` | 28 | 拔刀系統、十三型逐型刀身軌跡掃描、出招節奏 |
| `test_trail.mjs` | 9 | 刀光是否貼合刀身、無刀角色的 fallback |
| `test_ultimate.mjs` | 9 | 大招觸發、十三型連段、2 倍速 |
| `test_fx.mjs` | 11 | 火星粒子、火龍飛行與清理 |
| `test_mobility.mjs` | 12 | 跳躍高度、疾走速度、疾走動畫、音效 |
| `test_crashguard.mjs` | 5 | 更新階段例外時畫面不能全黑 |

另有 `shot_*.mjs` 系列是截圖工具（不重載、沿用現場），`probe_*.mjs` 是數值探針。

**驗證心法：能用數字驗的就不要截圖。** 例如「刀有沒有插進地面」是量刀尖的世界座標
最低值，不是看圖；「刀光有沒有對齊刀身」是量最新取樣點與刀尖的距離。
只有「長相」問題才拍圖。

---

## 現況實測（2026-07-27）

| 指標 | 數值 |
|---|---|
| FPS（高畫質） | 60 |
| FPS / draw call（低畫質，**現在的預設**） | 60 / 86（約 55 萬三角形、42 張貼圖） |
| draw call / 三角形（神社出生點） | 316 / 約 580 萬 |
| draw call（魔法之森，戰鬥中） | 460～480 |
| GPU 貼圖數 | 66 |
| console 錯誤 | 0 |
| 回歸測試 | 12 支全過，共 100+ 項 |

draw call 預算是這個專案真正的瓶頸（不是三角形數）。目前健康，但**加東西前先量**。

---

## 架構地圖

`README.md` 的「技術筆記」與「檔案結構」兩節務必先讀。以下是讀程式碼的定位點。

```
src/
  main.js            入口：renderer / scene / composer / 主迴圈 / HUD / 設定面板
  config.js          QUALITY 四檔畫質表、WORLD 常數（重力 -26、水面 0）
  core/              noise（地形雜訊）、optimize（合併與描邊）、textures（雙軌貼圖）
  world/             terrain / vegetation / water / sky / structures / interactives
  entities/          roster（角色資料，最大單檔）、model（程序式人形）、npc
  player/            controller（移動、相機、碰撞、跳躍）
  quests/            data（任務資料）、manager（引擎）
  ui/                dialogue / questlog / mapview
  combat/            forms（十三型資料）、motion（動作關鍵影格）、combat（控制器）、mobs
  fx/                slash（刀光與斬弧）、embers（火星）、dragon（火龍）、
                     particles / atmosphere / postprocess
```

**幾個「唯一真相」的位置**：

- **地形高度**：`world/terrain.js` 的 `terrainHeight()`。植被落點、玩家碰撞、
  相機避地全部吃它，改它等於改全世界。
- **畫質分級**：`config.js` 的 `QUALITY` 表。所有系統都從這裡讀。
- **全域除錯掛鉤**：console 裡的 `window.__gensokyo`
  （`renderer` / `scene` / `sky` / `player` / `combat` / `slashFX` / `mobs` / `quests` / `mapView`）。
  所有測試腳本都靠它。

### 主迴圈的結構（重要）

```js
function loop() {
  requestAnimationFrame(loop);   // 排在前面
  frame();
}
function frame() {
  try { update(); } catch (err) { reportCrash(err); }
  composer.render();                       // 不論更新成敗都要畫
  try { updateHUD(...); mapView?.frame(); } catch (err) { reportCrash(err); }
}
```

兩件事不能改掉：
1. **`composer.render()` 一定要在 try 之外**。更新階段丟例外時 rAF 照轉、FPS 照顯示 60，
   但畫面會全黑 —— 這個保險絲就是為了防它（見〈坑〉第 2 條）。
2. **HUD 讀 `renderer.info` 必須在 render 之後**（`autoReset = false`，幀首手動 reset，
   在 render 前讀永遠是 0）。

---

## 各系統速覽

### 任務系統（`quests/`）

手寫分支任務樹，**不是 LLM**（使用者選的：零費用、離線、零延遲）。
`data.js` 是純資料，`manager.js` 是引擎且不認識任何任務內容，只認得這幾種邊：

- `onTalkTo` — 跟指定 NPC 對話推進
- `onEnter` — 走進指定地區推進
- `branch` — 依條件分支（目前支援 `isNight`）
- `start.after: 'questId'` — 前置任務完成時自動開啟（章節接龍）
- `stage.scene = { npcId: [台詞] }` — 整場對話**取代**閒聊，播過不重播

**兩個關鍵規則**：
- `scene` 要放在「對話發生時的作用中節點」上，放錯玩家要跟同一 NPC 講兩次。
- 純分支節點（只有 branch）會被 `_gotoStage()` 立刻遞迴解掉 —— 否則它永遠不會被檢查
  （它自己不產生觸發事件）。這是踩過的真實漏洞，`test_quests.mjs` 有迴歸測試。

存檔在 localStorage `gensokyo-quests-v1`。**改任務邏輯先跑 `node .tmp/test_quests.mjs`，
不要只在瀏覽器裡試。**

主線第一章「無名之劍」已完工（緣一開場 → 靈夢 → 紫 → 咲夜 → 回報），
第二章用 `start: { after: 'main_ch1_nameless_blade' }` 接。

### 戰鬥系統（`combat/` + `fx/`）

只有帶刀的角色（緣一）走完整流程；其他可玩角色走簡化路徑。

- **`forms.js`** — 十三型純資料表（`dmg` / `range` / `arc` / `lunge` / `dur` / 旗標 / `motion`）。
  引擎不認識任何一招的內容。**沒有冷卻欄位**：出招門檻就是「上一招的動作演完沒」
  （`combat.busy`），節奏完全由 `dur` 決定。
- **`motion.js`** — 動作關鍵影格資料表 + 一個插值器。16 套：十三型各一套，
  加 `draw` / `sheathe` / `guard` / `stand` / `run` / `runDrawn`。
  介面只有 `poseFor(name, k)` 與 `applyPose(rig, pose)`。
- **`combat.js`** — 控制器：型輪迴、命中扇形、連擊、頓挫、拔刀狀態機、刀身跟手、
  大招、疾走判定。
- **`fx/slash.js`** — 刀光（跟著刀身跑的軌跡帶）＋ 無刀角色用的固定扇形 fallback
  ＋ 出招音效（WebAudio 合成，無音檔）。
- **`fx/embers.js`** — 所有火花共用一個 Points（1 個 draw call，上限 640 顆）。
- **`fx/dragon.js`** — 火龍，只有拾壹之型與拾參之型會放。

**操作**：左鍵攻擊 / 按住 2.5 秒放大招（十三型全放）/ `R` 拔刀納刀。
刀在鞘裡時第一次攻擊是居合拔刀斬；停手 5 秒自動納刀。

**角色能力寫在 roster spec**（`jump` / `airJump` / `sprintMul` / `airJumps` / `canFly` / `speed`），
controller 有預設值，沒填的角色零影響。緣一：一段跳 2.87m、二段跳頂點 6.03m、
疾走 17.7 m/s（＝其他角色的飛行巡航速度，但他不會飛）。

### 地圖（`ui/mapview.js`）

開局把 `terrainHeight` 整張採過烘成 448² 俯視底圖。小地圖圓盤北向固定；
`M` 開大地圖，17 個地標是疊在 canvas 上的 HTML button，點了走 `warpTo(region)`。
坡向陰影從高度格差分算，**不要每像素多叫一次 `terrainHeight`**。

---

## 坑（都修了，但接手前必讀）

1. **瀏覽器快取會讓 HTML 與 JS 版本錯開 → 全黑畫面。**
   `index.html` 用 `?v=N` 破壞 `main.js` 的快取。**改了 index.html 卻沒把 N 加一**時，
   瀏覽器會沿用舊的 index.html（Python `http.server` 不送 `Cache-Control`），
   但因為 `main.js` 的 Last-Modified 變了又抓到新的 JS。
   新 JS 去找舊 HTML 沒有的元素 → 每幀丟例外 → 全黑。
   **新增 HUD 元素時 JS 端一定要 null-guard。** 使用者端解法是 Ctrl+Shift+R。

2. **更新階段的例外 = 永久黑畫面（而且 FPS 騙你說 60）。**
   成因見上面的〈主迴圈結構〉。已加保險絲：出錯照樣 render，畫面頂端顯示 `#crash`
   告示，主控台只印前 3 次（不洗版）。回歸測試 `test_crashguard.mjs`。

3. **`structures.js` 的 Y 座標慣例**：每個 `buildXxx()` 最後只 `set(R.x, 0, R.z)`，
   **Y 永遠不動**。所以函式內所有本地 Y 必須直接寫世界高度，不能寫相對值。
   （瀑布那次差點被塞到地底 142 個單位。）

4. **`structures.js` 沒有 `part()`**（那是 `model.js` 專用），只有 `box()` / `cyl()`。

5. **`geo.rotateX` 會把旋轉烘進幾何體** → `Water`(Reflector) 用 mesh 旋轉推法線會拿到
   錯的向量 → 「鏡子背對就跳過」永遠提早 return → 反射貼圖凍結成定格 HDR
   （霧之湖發紫、夜裡發光的真凶）。**旋轉要留在 `mesh.rotation.x`，不要碰幾何體。**

6. **換地形貼圖必須重測平均色**（`LAYER_MEAN`，canvas 縮 64×64 取樣）。
   平均值表不更新，正規化會把山坡染成黃泥。

7. **合併管線與動畫節點**：`optimize.js` 的 `mergeAnimNode` 只在動畫節點「內部」合併。
   要能單獨移動的東西（刀身、刀鞘、時鐘指針、索道車廂）必須登記在
   `ANIM_NODES` 或 `mergeStaticByMaterial` 的 skip 名單裡，否則會被烘進大網格。

8. **`headless Chrome 不會自動重載`**：改完 JS 要 `Network.setCacheDisabled` +
   `Page.reload`，否則 CDP 查到的是舊程式碼。`e2e_check.mjs` 已內建。

9. **測試腳本會互相污染**：`test_interact.mjs` 不重載頁面，前一個測試留下的對話框、
   凍結的玩家、擺好的姿勢都會害它假 FAIL。收尾記得還原控制權，或先跑 `e2e_check.mjs` 重載。

10. **additive 特效在近相機會變「蓋屏床單」**：斬弧當年整片藍色蓋住半個螢幕，
    看起來像世界破圖。修法不是調相機，是把帶寬縮到外圈（刀光只取刀身外側 55%）。

---

## 不可違反的專案約束

1. **符合東方 Project 原作設定**：角色住所、個性、口氣、地理相對位置都有考究，
   新內容也要遵守。
2. **敘事主軸是繼國緣一**（原創穿越角色：「被史書抹去存在的人，而幻想鄉收容被遺忘之物」）。
   每位角色都有一組談論他的對話，新角色也必須有。對話文本用**高品質繁體中文**。
   寫主線前先讀 `C:\Users\B365\OneDrive\桌面\緣一芙蘭朵路.txt`（使用者的設定聖經：
   戰力天花板是「略輸靈夢」、感情線要靜謐成熟不戀愛劇）。
3. **效能底線**：GTX 1070 @1080p 高畫質穩 60fps。
   心法是「**draw call 才是瓶頸，不是三角形數**」。
4. **貼圖雙軌制**：任何新貼圖都必須有程序 canvas 備援，檔案缺席時專案仍要完整可跑
   （`core/textures.js` 的熱替換）。照片素材只用 CC0（全部來自 Poly Haven，
   見 `assets/textures/manifest.json`）。
5. **素材預算**：貼圖總量上限 10GB，目前約 37MB。
6. **美學方向**：環境寫實 + 角色賽璐璐動漫風的混搭，目標是「UE5 等級」的氛圍
   （GTAO 接觸陰影 + 色彩分級 + 體積感雲霧是主力）。

---

## 使用者的合作風格

- **繁體中文**溝通，語氣輕鬆。
- 給予高度創作自由，但**成品要主動驗證**（跑測試、看數字），不要只丟程式碼。
- **節奏要快**：相關修改湊成一批再一次驗證，不要改一處驗一處；
  數值能驗的就不截圖；獨立的工具呼叫盡量並行。

---

## 待辦 / 可以接手的方向

使用者的佇列順序是：地圖 → 動畫 → 主線 → mission AI。前兩棒已完工，所以：

1. **主線第二章** — 用 `start.after: 'main_ch1_nameless_blade'` 接。
   第一章只到「察覺」不開打；二章要開打的話，戰力與演出先回設定聖經確認天花板。
2. **Mission AI** — 使用者想要的「巫師式自動互動」還沒做到位，目前是手寫分支樹。
3. 零碎：`README.md` 的效能預算段落仍是大擴充前的舊數字；
   `.tmp/download_textures.mjs` 可再加貼圖（重跑會寫入 manifest）。

---

## 更深的施工細節

`docs/ai-memory/` 收了四份開發期的技術筆記快照（山脈重建、地圖、主線、戰鬥），
記的是各系統的施工細節與當時的實測數字。最重要的坑已經蒸餾進上面的〈坑〉那一節，
**需要某個系統的來龍去脈時再翻**。

## 檔案備註

- `.tmp/` 是工作目錄：測試腳本、截圖工具、探針、貼圖下載腳本、
  Poly Haven API 快取（`ph_assets.json`，可刪，重跑會重建）。
- `.tmp/ue5_export/` 是 UE5 移植線的地形烘焙輸出（那條線目前暫停）。
- `node_modules/three/index.mjs` 是**手寫的最小 three stub**，
  讓 Node 能直接 import `terrain.js` 算高度（規劃建築配置用），不是真的 three。
- `assets/textures/manifest.json` 記錄每組貼圖的來源與授權。

---

## 歷史沿革

- **第一輪**：26 角色 / 13 地區 / 無任務系統。
- **第二輪**（2026-07-24）：紅魔館重建（原作是「窗戶很少的西洋要塞」，舊版 62 扇亮窗
  把整棟洗白）、神社室內化、植被群落分布、人物模組升級、遠方地區黑幕過渡、
  三個新地區（天狗聚落／天界／彼岸）、任務系統。
- **第三輪**（2026-07-24 深夜）：博麗神社依 THBWiki 考據重建、人間之里街廓化、
  夜間照明調亮、室內常亮燈。新慣例：`walk` 可走平台碰撞盒、`addClearing` 除草區、
  `scaleBoxUV`。
- **第四輪**（2026-07-25～26）：妖怪之山考據重建四批（地形／守矢＋索道／傳送點／
  紋理＋霧之湖反射修復）、地圖系統、主線第一章、戰鬥系統雛形。
- **第五輪**（2026-07-27）：拔刀系統、十三型各自的動作、刀光軌跡、火星與火龍、
  大招與 2 倍速、緣一機動力與疾走動畫、主迴圈保險絲。
