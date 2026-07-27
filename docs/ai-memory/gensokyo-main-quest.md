---
name: gensokyo-main-quest
description: 主線系統與第一章「無名之劍」完工：引擎新增 scene 整場對話/start.after 鏈接/main 旗標，章節伏筆對照與測試腳本
metadata: 
  node_type: memory
  type: project
  originSessionId: 3a41b95b-851a-4eae-9eaf-7edd11aed4b9
  modified: 2026-07-26T15:33:48.658Z
---

gensokyo-3d 主線（2026-07-26 開工，第一章完工）。劇情調性一律按 [[yoriichi-story-bible]]：靜謐、成熟、不戀愛劇。

**任務引擎擴充**（quests/manager.js + data.js）：
- `stage.scene = { npcId: [lines] }`：整場對話「取代」閒聊，播過不重播（scenesSeen 存檔）。**關鍵規則：scene 要放在「對話發生時的作用中節點」上**——即 next.onTalkTo 指向該 NPC 的那個節點，同一通對話播完順便推進。放錯節點玩家要跟同一 NPC 講兩次
- `start.after = 'questId'`：前置完成瞬間自動開啟（章節接龍）；`quest.main = true` 主線旗標（toast「主線開始」+ 日誌金徽章）
- `onTalk(npcId)` 回傳 `{ hint, scene }`（原本是字串）；main.js tryTalk：有 scene 播 scene，否則 hint+閒聊
- `_tryStart` 提前到收集 scene 之前：第一次講話的「那一通」就能播 start 節點的 scene
- SAVE_KEY 照舊 `gensokyo-quests-v1`，存檔多了 scenesSeen 陣列

**第一章「無名之劍」**（id `main_ch1_nameless_blade`，6 節點 5 場景）：
緣一開場（里緣黃昏，「空氣裡有不屬於這裡的味道」）→ 靈夢（結界「晃」了一下）→ 紫（有東西「走進來」、鏡花水月殘響、往紅魔館去）→ onEnter sdm → 咲夜（鐘停七秒、地下室門開過一次、芙蘭「窗外拿刀的大哥哥」）→ 回報緣一（「我曾經晚回家過一次……這次不會」，手按刀柄收尾）。
伏筆對照：走進來的東西＝藍染、窗外大哥哥＝芙蘭奪還事件前兆、按刀柄＝天照加護線起手。本章只到「察覺」，不開打。二章用 `start: { after: 'main_ch1_nameless_blade' }` 接。

**測試**：
- `.tmp/test_quests.mjs`：Node 純邏輯測（含主線全流程 + 假二章驗證鏈接，測完 QUESTS.pop() 還原）
- `.tmp/test_main_quest.mjs`：瀏覽器實機（清存檔→重載→傳送緣一→真按 E→截圖）
- **坑：test_interact.mjs 不重載頁面直接沿用 session**——前一個測試留著對話框/玩家禁用會污染它的 E 鍵測試（這次 5 項假 FAIL）。test_main_quest.mjs 收尾已加 Escape+關日誌+還控制權；污染的解法是先跑 e2e_check.mjs 重載

**Why:** 使用者指定主線以繼國緣一開頭，這是 地圖→動畫→主線→mission AI 佇列的第三棒；第一章是整條藍染主線的入口。
**How to apply:** 寫第二章時直接加 QUESTS 條目 + start.after 接龍，scene 放對節點；開打/天照加護的數值與演出要先回聖經確認戰力天花板（略輸靈夢）。相關：[[gensokyo-3d-mountain-rebuild]]、[[feedback-faster-iteration]]
