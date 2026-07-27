// 用 CDP 驅動 headless Chrome：選角色進遊戲、跑幾幀、抓 console 錯誤、截圖
// 用法: node .tmp/e2e_check.mjs [waitSeconds]
const CDP_PORT = 9223;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
if (!page) { console.error('找不到頁面 target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const errors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++mid;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 500));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('CONSOLE.ERROR: ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 500));
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push('LOG: ' + msg.params.entry.text.slice(0, 500));
  }
};

await new Promise(r => { ws.onopen = r; });
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

// headless Chrome 不會自己重載 —— 不改 cache 直接測的話，
// 查到的是上一版的 JS / 舊碰撞盒。關快取 + 強制 reload 才開始等開機。
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
await wait(1500);

async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.value;
}

// 等開機完成
let booted = false;
for (let i = 0; i < 60; i++) {
  booted = await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`);
  if (booted) break;
  await wait(1000);
}
console.log('boot:', booted ? 'OK' : 'TIMEOUT');
if (!booted) process.exit(1);

// 選第一個角色（博麗靈夢）進遊戲
await evaljs(`document.querySelector('.card').click(); undefined`);
await wait(1000);
console.log('game running:', await evaljs(`window.__gensokyo?.state?.running`));

// 跑幾秒讓 shader 編譯、貼圖載入
const secs = Number(process.argv[2] || 8);
await wait(secs * 1000);

// 抓 HUD 統計與狀態
const hud = await evaljs(`document.getElementById('stats')?.innerHTML`);
console.log('HUD:', hud);
const info = await evaljs(`(() => { const i = window.__gensokyo.renderer.info.render; return JSON.stringify({calls: i.calls, tris: i.triangles}); })()`);
console.log('render.info:', info);
const texCount = await evaljs(`window.__gensokyo.renderer.info.memory.textures`);
console.log('gpu textures:', texCount);

// 截圖
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('fs');
const { tmpdir } = await import('os');
const shotPath = `${tmpdir()}/game_shot.png`;
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
console.log('screenshot saved:', shotPath);

console.log(errors.length ? `--- ${errors.length} errors ---\n` + errors.slice(0, 10).join('\n') : '--- no console errors ---');
ws.close();
process.exit(0);
