// 從相機往天空弧線的幾個螢幕點射 ray，直接問三維場景「這條弧是誰」
import { cdp } from './cdp.mjs';

const { evaljs, close } = await cdp();

const out = await evaljs(`(async () => {
  const THREE = await import('./vendor/three/build/three.module.js');
  const G = window.__gensokyo;
  const cam = G.camera;
  const ray = new THREE.Raycaster();
  ray.far = 1e9;
  const pts = [[0, 0.92], [0.25, 0.8], [-0.3, 0.7], [0.55, 0.55], [-0.6, 0.5], [0, 0.6]];
  const seen = {};
  for (const [nx, ny] of pts) {
    ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
    const hits = ray.intersectObjects(G.scene.children, true);
    for (const h of hits.slice(0, 4)) {
      const o = h.object;
      const chain = [];
      let p = o;
      while (p) { chain.push(p.name || p.type); p = p.parent; }
      const key = chain.join('<');
      if (!seen[key]) {
        const m = o.material || {};
        seen[key] = {
          dist: Math.round(h.distance),
          geo: o.geometry ? o.geometry.type : '-',
          mat: m.type || '-',
          emissive: m.emissive ? m.emissive.getHexString() : '-',
          color: m.color ? m.color.getHexString() : '-',
          fog: m.fog,
          pos: o.getWorldPosition(new THREE.Vector3()).toArray().map(v => Math.round(v)),
          scale: o.scale.toArray().map(v => +v.toFixed(2)),
        };
      }
    }
  }
  return seen;
})()`, true);

console.log(JSON.stringify(out, null, 2));
await close();
