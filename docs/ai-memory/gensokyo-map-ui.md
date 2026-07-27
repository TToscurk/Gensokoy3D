---
name: gensokyo-map-ui
description: 地圖系統完工——terrain烘焙底圖、小地圖圓盤、M鍵大地圖點地標傳送；mapObjectives 任務金點
metadata: 
  node_type: memory
  type: project
  originSessionId: 3a41b95b-851a-4eae-9eaf-7edd11aed4b9
  modified: 2026-07-26T16:47:35.471Z
---

# 地圖系統（2026-07-27 完工驗收）

- `src/ui/mapview.js` — MapView：開局把 `terrainHeight` 整張採過烘成 448² 俯視底圖
  （水深漸層/海拔色階/坡向陰影/地區 accent 薄染 0.14）。坡向陰影從高度格差分算，
  **不要每像素多叫 terrainHeight**（先採 (N+1)² 格共用）。
- 小地圖：右上圓盤 176px、北向固定、玩家居中、箭頭跟 camYaw；NPC 點用
  `spec.palette.accent`；任務金菱形超界壓邊緣指方向。
- 大地圖：M/Esc 開關，開時 `player.enabled=false` + `exitPointerLock`；
  地標是疊在 canvas 上的 HTML button（17 區全標，含結界之外紫色），
  點了直接走 main.js 的 `warpTo(region)`（remote 自動帶黑幕過場）。
- `quests/manager.js` 加 `mapObjectives()`：從 stage.next 推出 {npc|region, main}；
  座標解析在 main.js 做（引擎不認識世界座標，只認 npcId/regionId）。
- 任務金點 1Hz 快取重繪，不用每幀查。
- 測試 `.tmp/test_map.mjs`：13 項（烘焙/小地圖像素/17地標/傳送/金點/FPS）。
- 測試收尾記得 mapView.close() + player.enabled=true，不然污染 test_interact（它不重載頁面）。

相關：[[gensokyo-main-quest]]、[[gensokyo-combat-system]]
