import { cdp } from './cdp.mjs';
const { evaljs } = await cdp();
console.log('keys:', await evaljs(`Object.keys(window.__gensokyo).join(',')`));
console.log('player type:', await evaljs(`typeof window.__gensokyo.player`));
console.log('map:', await evaljs(`window.__gensokyo.manager.id`));
process.exit(0);
