// 角色檢視台截圖：node .tmp/shot_chars.mjs "reimu,marisa" 0 out.png
import { cdp } from './cdp.mjs';
const [ids = 'reimu,marisa,yoriichi,sakuya', ang = '0', out = 'chars.png'] = process.argv.slice(2);
const { evaljs, shot } = await cdp('charviewer');
const wait = ms => new Promise(r => setTimeout(r, ms));
await evaljs(`location.search = '?ids=${ids}&a=${ang}'; undefined`);
await wait(2500);
for (let i = 0; i < 20; i++) { if (await evaljs('window.__ready === true')) break; await wait(300); }
const os = await import('os');
await shot(`${os.tmpdir()}/${out}`);
console.log('saved', out);
process.exit(0);
