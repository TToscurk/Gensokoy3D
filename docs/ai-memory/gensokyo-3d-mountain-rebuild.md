---
name: gensokyo-3d-mountain-rebuild
description: 網頁版妖怪之山考據重建全四批完工驗收：批1地形、批2守矢/索道、批3傳送、批4紋理+霧之湖反射凍結根治
metadata: 
  node_type: memory
  type: project
  originSessionId: bc09b1a0-22a8-4fe6-a773-87d3ae0b712e
  modified: 2026-07-27T01:39:39.227Z
---

gensokyo-3d 網頁版下一輪工程（2026-07-25 規劃完成，四批次：地形→建築→傳送→紋理，含驗收標準；原始施工計畫檔在本機 plans 目錄，計畫已結案）。3 個範圍問題使用者已口頭同意按推薦選項（纜車=車站傳送+車廂會動、室內=只接現有 3 處）。

**進度（2026-07-26）：全四批完工 ✅**。批1地形 ✅、批2守矢重蓋+索道+瀑布河面 ✅、批3傳送點+載入畫面+互動點 ✅（17 項實測全過）、批4紋理+霧之湖 ✅（e2e 零錯誤、test_interact 17/17、各地 60 FPS；draw：神社 310／山上 420／湖畔 436／紅魔館 ~712 為批前既有水準）。四批計畫結案，下一棒是動畫或繼國緣一主線（使用者佇列順序：地圖→動畫→主線→mission AI）。

**批4 施工要點**：
- roofBlack 純色 → kawara PBR 深色調（0x2e3440 tint + DoubleSide）；紅魔館日/夜驗收沒變亮 ✅
- 地形岩層 terrain_rock → cliff_rock（同索引不動 shader）；**LAYER_MEAN[2] 舊值是 rock_face_03 的灰 [0.45,0.42,0.38]，新貼圖實測 [0.49,0.32,0.20]** —— 平均值表不更新，正規化會把山坡染成黃泥。換貼圖必重測平均色（canvas 縮 64×64 取樣）
- boxUV() helper 加在 structures.js box() 之後（scaleBoxUV k=1.6），只給新程式碼用
- 4 組貼圖重抓 2K（--sets plaster,stone_path,stone_wall,roof_kawara --res 2k，檔名不變直接覆蓋）
- **霧之湖發紫/天上發光弧的真凶（重大）**：`geo.rotateX` 把旋轉烘進水面幾何體 → Water(Reflector) 用 mesh 旋轉推法線得到 (0,0,1) 水平向量 → 「鏡子背對就跳過」在相機位於湖心 -z 側時**永遠提早 return**，反射貼圖和 eye uniform 凍結在舊視角 → 湖面放著定格 HDR 倒影（亮紫+綠弧、夜裡還會發光）。**修法：旋轉留在 `mesh.rotation.x`，不碰幾何體**。凍結時 eye 卡在山東 (429,115,-344) → theta≈0.13 → 全鏡面；修復後反射 pass 每幀真的執行（draw +150 屬正常代價）
- Water shader 附加 patch（buildWater 內字串 replace，不動 vendor）：rf0 0.3→0.02（真實垂直反射率 2%）、fresnel theta 改用巨觀水平面 (0,1,0) 不用雜訊微法線（雜訊 y 過半為負會讓 theta 恆 0）、反射取樣 clamp 1.2（Preetham 太陽附近 HDR>10，7% 反射也會爆亮）、太陽漫射 0.3→0.15
- buildRiver 入湖段修剪（河床低於湖面的測站不鋪可見水面）——這修的是舊「紫色河帶浮在湖上」，與反射凍結是兩個獨立 bug

**批3 施工要點**：
- controller.js `teleport(x,z,y?)` 第三參數可選，舊呼叫端零影響
- 新檔 `src/world/interactives.js`：INTERACTIVES 純資料註冊表 + nearestInteractive（水平半徑 2.6 + Y 差 ≤3.5 防隔牆觸發）
- main.js buildOnce 從 INTERIORS 拆進入/離開兩點 + WARP_NODES 配對展開，共 8 點
- warpTo 過場抽成共用 `fadeTeleport({x,z,y,zh,msg})`；順手修了 `r.warp` 死資料（妖怪之山傳送現在落在索道山麓站）
- 提示 NPC 優先、其次互動點；tryTalk 末尾分派互動點
- e2e_check.mjs 已內建 Network.setCacheDisabled + Page.reload（快取坑治本）
- 回歸腳本 `.tmp/test_interact.mjs`（傳送實測 17 項）、`.tmp/test_moriya_exit.mjs`（守矢反向）
- **2026-07-26 追加修正**：①諏訪子舊站位 [6,-10] 卡在賽錢箱裡（只剩蛙帽露出箱頂）→ 改 [9,-5] 參道東側與早苗對稱；之前以為擋門的是早苗，其實是諏訪子，搬走後守矢門口互動點自動解鎖 ②守矢拜殿只有三面牆碰撞、**沒有地板 walk 盒** → 走進去沉進地板 1m；補石垣基座+高床地板兩個 walk 盒（0.55 級高卡 controller 步高容許邊界）

**批2 施工要點**（structures.js `buildRopeway`/`buildMoriya`）：
- 直線懸鏈會在凸形山坡穿山 → 鋼索用貼地 CatmullRomCurve3（地形+12 密取支點、兩端降到站體+4，數值驗算淨空 ≥3.98m）
- 山麓站 (-408,-536) 湖岸陡坡無平地 → 9.4m 石垣基座拔月台到 26.1，東北側與坡面齊平可直接走上；碰撞盒帶 `walk:1` 才可站
- 山上站 (-580,-630) 參道東側肩台（原選址 -584,-608 在 240% 斷崖上）
- WARP_NODES 兩站互傳，帶明確 y（批3 fadeTeleport「有 y 用 y」要吃這個）
- headless Chrome 頁面不會自動重載！e2e_check.mjs 沒有 reload，改完 JS 要 Network.setCacheDisabled + Page.reload，否則 CDP 查到的是舊碰撞盒/舊程式碼

**批1 已修的關鍵 bug**：peak 死旗標（山變真火山錐 375m+風神湖）、守矢全白（雪線+groundSample moriya 分支）、regionAt 平手（取 radius 小者）、白玉樓粉櫻雪退化（netherworld 補 snW）。

**考據要點**（THBWiki 共識）：守矢神社在接近山頂的風神湖湖畔、有御柱群+巨大注連繩+河童索道；山是休眠火山、五合目森林界線；九天瀑布下游接溪流入霧之湖。

**現況關鍵 bug/死碼**（施工時必修）：
- `peak:true` 死旗標 → 妖怪之山其實是平坦高原（265m）
- 守矢平台 208m 觸發積雪線 → 神社地面全白；groundSample 無 moriya 分支
- `regionAt()` 平手取先者 → 守矢範圍被判成 youkaiMountain（HUD/任務/植被全錯）；修法：平手取 radius 小者
- 雪線抬高會讓白玉樓「粉櫻雪」退化 → netherworld 分支要補 snW
- `player.teleport(x,z)` 的 Y 永遠貼地形 → 室內傳送要加可選 y 參數
- 車廂等動態物件要加進 mergeStaticByMaterial 的 skip 名單（Group 命名 `rope-cabin`）
- 纜車山麓站選址 (-408,-536)；(-450,-480) 會沉進霧之湖
- `INTERIORS`（structures.js L13）+ `#warpFade`（index.html L288）是現成掛點，傳送系統直接接

**後續保留問題**：③山的長相使用者沒特別想法，全權按考據做。

**Why:** 使用者曾因 session 跳掉遺失進度，主動要求「輸出專案紀錄」；且他的指示順序是先把地圖/建築/傳送做好，之後才做動畫、繼國緣一主線、mission AI。
**How to apply:** 使用者回來說要繼續做地圖/守矢/傳送時，直接讀計畫檔按批次施工，先問他 3 個問題的答案（或直接按推薦選項做）。相關：[[gensokyo-ue5-pipeline]]、[[user-profile-b365]]
