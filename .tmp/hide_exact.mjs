// 精確實驗：raycast 找到弧線命中的那個 mesh，藏「它本人」再截圖
import { cdp } from './cdp.mjs';

const TMP = (await import('os')).tmpdir();   // 原本寫死作者機器的路徑
const { evaljs, shot, close } = await cdp();

// 先列出所有 BoxGeometry+ShaderMaterial 的 scene 直接子節點
const boxes = await evaljs(`(() => {
  const G = window.__gensokyo;
  return G.scene.children.map((c, i) => ({
    i, name: c.name || '-', type: c.type,
    geo: c.geometry?.type, mat: c.material?.type,
    scale: c.scale.x,
  })).filter(c => c.geo === 'BoxGeometry' || c.mat === 'ShaderMaterial');
})()`);
console.log('shader/box children:', JSON.stringify(boxes, null, 1));

// raycast 命中弧線的那個 mesh，存起來並藏掉
const hit = await evaljs(`(async () => {
  const THREE = await import('./vendor/three/build/three.module.js');
  const G = window.__gensokyo;
  const ray = new THREE.Raycaster();
  ray.far = 1e9;
  ray.setFromCamera(new THREE.Vector2(0.25, 0.8), G.camera);
  const hits = ray.intersectObjects(G.scene.children, true)
    .filter(h => h.object.material?.type === 'ShaderMaterial');
  if (!hits.length) return null;
  const o = hits[0].object;
  window.__arcObj = o;
  o.visible = false;
  return { dist: Math.round(hits[0].distance), geo: o.geometry.type, scale: o.scale.x,
           idx: G.scene.children.indexOf(o) };
})()`, true);
console.log('hidden arc object:', JSON.stringify(hit));
await shot(TMP + '/arc_gone.png');
console.log('shot arc_gone');

await evaljs(`window.__arcObj.visible = true`);
await close();
