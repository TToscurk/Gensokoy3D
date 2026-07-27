---
name: gensokyo-combat-system
description: 戰鬥系統完工——緣一日之呼吸13型輪迴、橘藍劍氣VFX、妖精雜魚群、拔刀+13型各自動作；含additive蓋屏與刀身骨架的教訓
metadata: 
  node_type: memory
  type: project
  originSessionId: 3a41b95b-851a-4eae-9eaf-7edd11aed4b9
  modified: 2026-07-27T01:20:55.894Z
---

# 戰鬥系統（2026-07-27 完工驗收）

檔案：
- `src/combat/forms.js` — FORMS[13] 資料表（name/dmg/range/arc/lunge/cd/dur/flags），`BREATH_CORE` 橘 / `BREATH_EDGE` 藍
- `src/combat/combat.js` — 控制器：型輪迴、冷卻、突進衝量、扇形命中、連擊 3s、hitstop（重擊0.07/終結0.14）、手臂動畫在 player.update 之後覆寫 rig.armR
- `src/fx/slash.js` — SlashFX（頂點色扇形環帶，池化 mesh、每招重建幾何）+ SlashAudio（WebAudio 白噪帶通下滑=破空聲）
- `src/combat/mobs.js` — 妖精 8 窩×8 隻，身體+翅膀兩個 InstancedMesh，HP40、重生12s
- main.js 接線：左鍵攻擊（dialogue.active 時左鍵=推進對話）、hitstop 時 dt*0.12
- index.html：#formBanner 型名閃字、#combo 連擊計數
- 測試：`.tmp/test_combat.mjs`（14 招驗輪迴+命中+UI+FPS）、`.tmp/shot_crescent.mjs`（特寫截圖，不重載沿用現場）

## 教訓：additive 特效在近相機會變「蓋屏床單」

斬弧一開始是內徑 0.28R 的寬環帶，camDist 4.2m 時整片 additive 藍色蓋住半個螢幕，
看起來像世界破圖（誤以為是湖面或翅膀 InstancedMesh 壞掉）。
**修法不是調相機，是把帶寬縮到外圈 25%（r0=0.74R）、殘影亮度壓 0.4。**
截圖驗特效要用 camPitch≥0.5 俯角才看得出扇形；貼地視角只會看到一條線。

## 拔刀系統 + 十三型各自動作（2026-07-27 完工，26 項實測全過）

新檔 `src/combat/motion.js`：關鍵影格資料表 + `poseFor(name,k)` / `applyPose(rig,pose)`。
forms.js 每型加 `motion:'名字'`，引擎照樣不認識招式內容。16 套動作＝13 型 + draw/sheathe/guard。
測試 `.tmp/test_sword.mjs`（26 項）、探針 `.tmp/probe_pose.mjs`、截圖 `.tmp/shot_sword.mjs`。

**踩過的坑（改動作前必讀）**：
- **刀原本拔不出來**：`propWaist` 的刀被 `mergeAnimNode` 併進軀幹網格。要拆成 `blade`/`sheath`
  兩個 **ANIM_NODES**（model.js 的清單）才會各自保留 transform；描邊厚度要給刀身打 0.45 折，
  不然 1.2cm 的刀身會被外殼撐成棍子
- **手腕角度千萬別綁在手掌座標**：刀若當成手掌子物件，手臂一揮下去刀會多轉 90° 折進地板，
  每格都要反推補償。現在 `wrist` 是**軀幹空間的絕對刀身朝向**（0=朝下、1.57=水平、3.14=朝天），
  位置才取自手掌 —— 所見即所得
- **鞘引き**：刀身 0.98m 比整條手臂（0.45m）還長，靠手拉永遠拔不出來。解法是拔刀時
  **鞘沿自身 +Y 後退 0.55m**（真實居合的左手鞘引き），刀身則全程跟著手，不做「沿軸推出」——
  推出去會變成刀飄在半空 1.5m 外
- **鞘要比刀長**：切先 0.10m 的錐體會露在鞘外，要補「鐺」（鞘尾段）
- **收招 yaw 必須是 2π 的整數倍**，否則轉圈類招式收招後人停在歪的方向
- **`applyPose` 的 dy 寫絕對值**（`rig.bobY + dy`，bobY 由 animateCharacter 存）——
  早期用 `+=`，探針一次跑 20 格就把人推到地底，害我誤判 6 型「刀尖插地」
- 佩刀在**左胯**、鞘尾朝後上（model.js 的角度是從方向向量反推的），右手才跨得過去抓柄

**行為**：刀在鞘裡時第一次攻擊＝居合拔刀斬（播 draw，照樣結算該型傷害）；停手 5 秒自動納刀；
R 鍵手動拔/納。持刀待機是正眼架式（只覆寫右手，左手仍跟走路擺動）。

## 大招「日之呼吸・全型」+ 2 倍速（2026-07-27，9 項實測全過）

- 左鍵**按住 2.5 秒**（`CHARGE_TIME`）觸發，十三型從壹連放到拾參，中間零間隔。
  點一下＝一般攻擊、按住＝蓄大招；`#charge` 讀條在畫面下方。
  放開／視窗失焦／pointerlock 解除都會取消蓄力（不然切回來會莫名放大招）。
- `ATTACK_SPEED = 2`：**一個常數同時決定動畫快慢與連打節奏**（因為出招門檻就是
  「動作演完沒」，animDur = dur / ATTACK_SPEED）。拔刀/納刀的手動切換不吃倍速。
- 普通攻擊與大招的每一段共用 `_execForm(form)`，手感不會分岔。
- `ULT_LEAD` 0.3s 起手空拍是必要的：沒有它，「日之呼吸・全型」的橫幅會在同一幀
  就被壹之型蓋掉，玩家永遠看不到大招名字。收鞘狀態用 `stand` 動作（刻意一個肢體
  欄位都不寫＝讓待機動畫繼續跑）。
- 測試 `.tmp/test_ultimate.mjs`。**測試斷言不要寫 `chargeRatio >= 1`** ——
  蓄滿那一幀就轉成大招、charging 歸零，輪詢永遠只抓得到 0.99。

## ⚠ 全黑畫面的成因（2026-07-27 踩過）

`main.js` 的 `loop()` 把 `requestAnimationFrame` 排在 `frame()` **之前**，所以
更新階段丟例外時迴圈照轉、FPS 照顯示 60，但**永遠跑不到 `renderer.render()`**
→ `render.calls` 變 0 → 畫面全黑、HTML 疊層還在。

實際案例：新增 `#charge` 蓄力條後，使用者瀏覽器拿到**舊快取的 index.html 配新的 JS**，
`ui.charge()` 對 null 呼叫 classList，每幀丟例外 → 全黑。

**為什麼會新舊混搭**：index.html 用 `?v=N` 破壞 main.js 的快取，但我改東西時沒有動 N ——
於是 index.html 被瀏覽器沿用舊的（python http.server 不送 Cache-Control），
main.js?v=N 卻因為 Last-Modified 變了而重新抓到新的。
**教訓：動到 index.html 就要把 `?v=` 加一**（目前 v=8）；且新增 HUD 元素時 JS 端一定要 null-guard。
使用者端的解法是硬重新整理 Ctrl+Shift+R。

**已加保險絲**（`main.js` 的 `frame()`）：更新階段包在 try/catch，出錯也照樣
`composer.render()`，並在畫面頂端顯示 `#crash` 告示、主控台只印前 3 次（不洗版）。
最慘只會是「畫面凍住但看得見、而且告訴你原因」。測試 `.tmp/test_crashguard.mjs`。

## 出招節奏：拿掉冷卻（2026-07-27）

使用者要「點擊即出招、只等動作演完」。`forms.js` 的 `cd` 欄位已**移除**，
出招門檻只剩 `combat.busy`（＝`animT >= 0`）。節奏完全由各型的 `dur` 決定（0.32~0.62s）。

**同時修掉的真 bug**：`hitstop` 用被 `dt *= 0.12` 壓慢後的 dt 倒數 →
寫 0.14 秒實際凍 1.17 秒，終結技一命中就慢動作一秒多。
現在 main.js 傳 `rawDt` 給 `combat.update(dt, rawDt)`，hitstop 用真實時間倒數。

## 緣一的機動力與疾走動畫（2026-07-27，12 項實測全過）

使用者要求：二段跳到兩層樓、**地面疾走達到其他角色的飛行速度**（緣一維持不會飛）、
居合走り的奔跑動畫、攻擊加火焰音效。

- 跳躍/疾走改成**角色能力**（roster spec 的 `jump` / `airJump` / `sprintMul`，
  controller 有預設值 9.2 / 8.4 / 1.85，沒填的角色零影響）。
  緣一 `jump:12.0, airJump:12.6, sprintMul:2.78` → 實測一段 2.87m、二段頂點 **6.03m**、
  疾走 **17.7 m/s ＝ 15×speedMul ＝ 飛行基礎速度**。高度公式 v²/(2·26)。
- 疾走動畫 `run` / `runDrawn`（motion.js，循環播放，相位由 `speedH/5.2` 驅動）：
  軀幹前傾 0.44、壓低 dy -0.10、右手橫過身前扣柄（armR.z -0.65）、左手扶鞘口。
  觸發條件在 `combat._running()`：**有刀 + 著地 + speedH > 8.5**（走路 6.4 / 疾走 17.7，
  用速度而不是讀按鍵，被地形拖慢時架式會自己收）。
- `SlashAudio.fire(k)`：慢速噪聲過低通（Q=6，截止竄升再落）＝火舌捲起的轟聲，
  另一路帶通掃中高頻＝劈啪，再補下滑正弦當底。`swing(form)` 現在吃整個型，
  龍形/終結技 k=1.5。
- **測跳躍高度的坑**：站在地上 `vel.y` 恆為 0，用 `vel.y<=0` 判頂點會在第一幀
  就把二段跳一起用掉（測出 peak1=0）。要先等 `!grounded` 再開始量。
- 測試 `.tmp/test_mobility.mjs`、截圖 `.tmp/shot_run.mjs`。

## 火星 + 火龍（2026-07-27，11 項實測全過）

- `src/fx/embers.js` — `EmberField`：全部火花共用**一個 Points**（自訂 shader 才能每顆
  不同 size/color；three 內建 PointsMaterial 只能全體同一個 size）。上限 640 顆，
  用「拿最後一顆補空位 + setDrawRange」保持活粒子在前段。
  **原本每顆火花是一個 Mesh，40 顆＝40 個 draw call；改完只花 1 個**，粒子還多十幾倍。
- `src/fx/dragon.js` — `FireDragon`：龍身是「十字緞帶」（每節吐出直立＋水平兩片四邊形），
  任何角度都有體積感、只要兩條 triangle strip。沿攻擊方向飛 15m、蛇行、頭大尾細、
  頭白橘尾藍，沿路噴火星。**只有 `form.dragon`（拾壹）與 `form.finisher`（拾參）會放**。
- 刀尖火星的初速取自刀身該格的位移 → 是「被甩出去」不是原地噴，揮越快甩越遠。
- A/B 實測粒子成本幾乎為零（連打含火星 60.3 avg / 關掉 60.2）。
- **坑**：`dragon.spawn()` 一定要 `headPos.copy(origin)`，否則 spawn 到第一次 update
  之間讀到 (0,0,0)，測試會算出「飛了 732 公尺」的假數字。測試要寫上界才抓得到。
- 測試 `.tmp/test_fx.mjs`、截圖 `.tmp/shot_fx.mjs`（一樣用 hitstop 慢動作拍）。
- **FPS 斷言不要讀 `state.fps` 單點**（滾動平均雜訊大，會假掉），在頁面內自己數 60 幀。

## 刀光：斬擊特效改由刀身軌跡生成（2026-07-27，9 項實測全過）

`slash.js` 加 `beginTrail(form)` / `traceBlade(a,b)`：出招時 combat 每幀把刀身兩點
（外側 45% 與刀尖）的世界座標餵進去，拉成環狀緩衝的帶狀 mesh（26 取樣點、TTL 0.30s、
橘內緣藍外緣、additive）。舊的腳下固定扇形 **保留給沒刀的角色**（靈夢等也能攻擊，
不留 fallback 就變成完全沒特效）——分支在 `combat.tryAttack` 的 `hasKatana`。
測試 `.tmp/test_trail.mjs`、截圖 `.tmp/shot_trail.mjs`。

- **不必標「哪一段是斬擊」**：靠刀尖每幀位移門檻（`TRAIL_MIN_STEP` 0.06m）自動過濾，
  起手/收招的慢動作不會拖出刀光
- **只取刀身外側 55%**：整條 1m 寬的 additive 帶在近相機會蓋屏（同 additive 那條教訓）
- `beginTrail` 一定要把整條緩衝壓到當前位置，否則第一格會跟上一招的殘留位置連成一條長條
- **截圖刀光的技巧**：刀光只活 0.3 秒，CDP 一個來回就過期。設 `combat.hitstop = 9`
  借用現成的 dt*0.12 慢動作，就能穩穩拍到尖峰那一格

相關：[[gensokyo-main-quest]]（主線一章）、[[gensokyo-3d-mountain-rebuild]]、[[yoriichi-story-bible]]
