@echo off
REM cmd 預設編碼不是 UTF-8，檔案是 UTF-8 存的中文字會被讀錯、
REM 甚至把某些符號誤判成指令 → 跳出「不是內部或外部命令」。
chcp 65001 >nul
REM 幻想鄉 3D —— 本地啟動腳本
REM ES module 不能用 file:// 開啟，必須經過 HTTP 伺服器。

cd /d "%~dp0"

echo.
echo   幻想鄉 3D — Gensokyo Explorer
echo   ------------------------------------
echo   伺服器啟動中：http://localhost:8080/
echo   關閉此視窗即停止伺服器。
echo.

REM 開瀏覽器和起伺服器是兩件事，不能同時發生——瀏覽器不會等伺服器就緒才發請求。
REM 大多時候伺服器起得比瀏覽器快所以看起來沒事，但電腦一忙（防毒掃描、硬碟慢）
REM 瀏覽器搶先送出請求時伺服器還沒在監聽，就會看到「無法連上這個網站」。
REM 這裡把開瀏覽器丟到另一個背景視窗，先等 1 秒再開，跟下面主視窗的伺服器分開跑。
start "" cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:8080/"
python -m http.server 8080
