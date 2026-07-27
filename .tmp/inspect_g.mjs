import { cdp } from './cdp.mjs';
const { evaljs } = await cdp();
console.log(await evaljs(`Object.keys(window.__gensokyo).join(',')`));
console.log('petals in scene:', await evaljs(`!!window.__gensokyo.scene?.getObjectByName('petals')`));
console.log('map:', await evaljs(`window.__gensokyo.manager.id`));
process.exit(0);
