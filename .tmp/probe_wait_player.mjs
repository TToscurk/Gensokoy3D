import { cdp } from './cdp.mjs';
const { evaljs } = await cdp();
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 10; i++) {
  const t = await evaljs(`typeof window.__gensokyo?.player`);
  console.log(`t+${i * 2}s player:`, t);
  if (t !== 'undefined') break;
  await wait(2000);
}
process.exit(0);
