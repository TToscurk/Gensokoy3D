// 姿勢逐格傾印：找出哪一個關鍵影格把刀尖壓到地底下
import { cdp } from './cdp.mjs';
const page = await cdp();
const { evaljs } = page;

const names = process.argv.slice(2);
const out = await evaljs(`(async () => {
  const M = await import('/src/combat/motion.js');
  const THREE = await import('three');
  const g = window.__gensokyo;
  const rig = g.player.model.userData.rig;
  const TIP = new THREE.Vector3(0, 1.07, 0);
  const res = {};
  for (const name of ${JSON.stringify(names)}) {
    const rows = [];
    for (let i = 0; i <= 20; i++) {
      const k = i / 20;
      const pose = M.poseFor(name, k);
      g.combat.drawn = true;
      M.applyPose(rig, pose);
      g.combat._updateBlade(pose);
      g.player.model.updateMatrixWorld(true);
      const tip = rig.blade.localToWorld(TIP.clone());
      rows.push({ k: +k.toFixed(2), aRx: +pose.aR[0].toFixed(2), wx: +pose.wrist[0].toFixed(2),
                  tipY: +(tip.y - g.player.pos.y).toFixed(2),
                  tipR: +Math.hypot(tip.x - g.player.pos.x, tip.z - g.player.pos.z).toFixed(2) });
    }
    res[name] = rows;
  }
  return res;
})()`, true);

for (const [name, rows] of Object.entries(out)) {
  console.log('===', name);
  console.log(rows.map(r => `k${r.k} aRx${r.aRx} wx${r.wx} → y${r.tipY} r${r.tipR}`).join('\n'));
}
page.close();
