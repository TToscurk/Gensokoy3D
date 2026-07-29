@echo off
REM 幻想鄉 3D —— 一鍵更新腳本
REM 雙擊執行：拉取目前分支的最新版本。

cd /d "%~dp0"

echo.
echo   幻想鄉 3D — 更新
echo   ------------------------------------
echo.

REM 有本地未提交的修改就先停下來問，不要悶著頭 pull 把東西蓋掉
git diff --quiet && git diff --cached --quiet
if errorlevel 1 (
  echo   偵測到本地有未提交的修改，為了不蓋掉你的東西先停在這裡。
  echo   目前狀態：
  echo.
  git status --short
  echo.
  echo   確定要繼續的話，自己手動處理好（commit 或 stash）再重新執行這個腳本。
  echo.
  pause
  exit /b 1
)

echo   目前分支：
git branch --show-current
echo.
echo   拉取更新中…
echo.
git pull

echo.
echo   ------------------------------------
echo   完成。這個視窗按任意鍵關閉。
echo.
pause >nul
