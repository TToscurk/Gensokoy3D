@echo off
REM 幻想鄉 3D —— 本地啟動腳本
REM ES module 不能用 file:// 開啟，必須經過 HTTP 伺服器。

cd /d "%~dp0"

echo.
echo   幻想鄉 3D — Gensokyo Explorer
echo   ------------------------------------
echo   伺服器啟動中：http://localhost:8080/
echo   關閉此視窗即停止伺服器。
echo.

start "" http://localhost:8080/
python -m http.server 8080
