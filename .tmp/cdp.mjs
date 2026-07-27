// 共用 CDP 工具：連接 9223 的遊戲頁面，提供 evaljs / shot
// 用法（在其他 .mjs 裡）：
//   import { cdp } from './cdp.mjs';
//   const page = await cdp();
//   await page.evaljs(`window.__gensokyo.player.teleport(-592, -666, 353.2); undefined`);
//   await page.shot('C:/Users/B365/AppData/Local/Temp/x.png');
//   page.close();
const CDP_PORT = 9223;

export async function cdp() {
  const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
  const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
  if (!page) throw new Error('找不到 8080 頁面 target（headless Chrome 沒開？）');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let mid = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++mid;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable');
  await send('Page.enable');

  return {
    send,
    // 頁面例外會直接丟出，不會靜默吞掉
    async evaljs(expression, awaitPromise = false) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (r.exceptionDetails) throw new Error('頁面例外: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 400));
      return r.result?.value;
    },
    async shot(path) {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      const { writeFileSync } = await import('fs');
      const { tmpdir } = await import('os');
      // 舊腳本寫死了作者機器的暫存路徑。目錄不存在時改寫到本機 temp，
      // 不要讓一張截圖把整支回歸測試打斷。
      const { existsSync } = await import('fs');
      const dir = path.replace(/[\\/][^\\/]*$/, '');
      const out = existsSync(dir) ? path : `${tmpdir()}/${path.split(/[\\/]/).pop()}`;
      writeFileSync(out, Buffer.from(s.data, 'base64'));
      return out;
    },
    close() { try { ws.close(); } catch {} },
  };
}
