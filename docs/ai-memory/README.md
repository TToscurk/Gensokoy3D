# AI 工作筆記（快照）

這四份是開發過程中累積的**技術筆記**，原本存在 Claude Code 的記憶區
（`~/.claude/projects/<工作目錄>/memory/`）——那個位置在使用者的設定檔底下，
不會跟著 repo 走，所以在這裡放一份快照。

**匯出日期：2026-07-27。**

## 這些是什麼

寫給 AI 讀的筆記，語氣偏「這裡有坑、別再踩」，跟 `HANDOFF.md` 的定位不同：

| | 定位 |
|---|---|
| `HANDOFF.md` | 給人看的：專案是什麼、怎麼跑、架構、約束、待辦 |
| 這個資料夾 | 各系統的施工細節與踩過的坑，含當時的實測數字 |

`HANDOFF.md` 已經把最重要的坑蒸餾進〈坑〉那一節，所以**先讀 HANDOFF，
需要某個系統的細節時再翻這裡**。

## 內容

| 檔案 | 範圍 |
|---|---|
| `gensokyo-3d-mountain-rebuild.md` | 妖怪之山考據重建四批：地形、守矢神社＋河童索道、傳送點、紋理與霧之湖反射修復 |
| `gensokyo-map-ui.md` | 地圖系統：terrain 烘焙底圖、小地圖圓盤、大地圖傳送、任務金點 |
| `gensokyo-main-quest.md` | 主線任務引擎擴充（scene / start.after / main 旗標）與第一章「無名之劍」 |
| `gensokyo-combat-system.md` | 戰鬥系統全部：十三型、拔刀、動作庫、刀光、火星火龍、大招、機動力、全黑畫面的成因 |

## 讀的時候注意

- 檔頭的 `---` 區塊是記憶系統的中繼資料（`name` / `description` / `type`），
  不是文件內容的一部分。
- 內文的 `[[名字]]` 是記憶之間的互相連結，對應同資料夾的檔名。
  有些連結指向沒有收進來的私人筆記（使用者個人偏好、故事設定聖經的私人檔案路徑），
  那些**刻意沒有匯出**。
- 裡面的實測數字是**當時**的，之後改動不會自動更新。以 `HANDOFF.md` 的
  〈現況實測〉為準。

## 要更新的話

直接從記憶區複製覆蓋即可（不需要改格式）：

```bash
cp ~/.claude/projects/E--CODE-gensokyo-3d/memory/gensokyo-*.md docs/ai-memory/
```

Windows 上的來源路徑是
`C:\Users\<你>\.claude\projects\E--CODE-gensokyo-3d\memory\`。
注意那個資料夾名稱是**從工作目錄路徑轉出來的**（`E:\CODE\gensokyo-3d` →
`E--CODE-gensokyo-3d`），換一台機器或換一個路徑開專案，資料夾名稱就不一樣。
