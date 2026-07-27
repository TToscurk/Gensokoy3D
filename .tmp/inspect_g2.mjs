import { cdp } from './cdp.mjs';
const { evaljs } = await cdp();
console.log('scene type:', await evaljs(`window.__gensokyo.scene?.type`));
console.log('rootScene type:', await evaljs(`window.__gensokyo.rootScene?.type`));
console.log('petals in rootScene:', await evaljs(`!!window.__gensokyo.rootScene?.getObjectByName('petals')`));
const r = await evaljs(`(() => {
  const s = window.__gensokyo.rootScene?.getObjectByName('petals');
  return s ? JSON.stringify({visible: s.visible, pos: [s.position.x, s.position.z]}) : 'null';
})()`);
console.log('petals state:', r);
process.exit(0);
