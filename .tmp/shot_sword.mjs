// 佩刀/拔刀/招式的外觀確認。凍結在指定姿勢再拍，不追即時動畫。
import { cdp } from './cdp.mjs';

const TMP = (await import('os')).tmpdir();   // 原本寫死作者機器的路徑
const page = await cdp();
const { evaljs, shot } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

if (!await evaljs(`!!window.__gensokyo?.state?.running`)) {
  console.log('遊戲沒在跑，先跑 test_sword.mjs'); page.close(); process.exit(1);
}

// 找一塊空地站好，側前方視角才看得到腰上的刀
await evaljs(`(() => {
  const g = window.__gensokyo, p = g.player;
  p.teleport(-8, 14);
  p.camYaw = 2.3; p.camPitch = 0.22;
  p.camDist = 7.2; p.camDistTarget = 7.2;
  p.yaw = 0.9; p.model.rotation.y = 0.9;
  p.enabled = true;          // 關掉的話相機不會跟著傳送走，會拍到空地
  g.sky.time = 780;            // 13:00 —— 夜裡拍全黑，看不出刀
  g.sky.speed = 0;
  return true;
})()`);
await wait(1500);

// 凍結姿勢：關掉 combat 的每幀更新，自己擺一格
const freeze = async (motion, k, drawn, file) => {
  await evaljs(`(async () => {
    const M = await import('/src/combat/motion.js');
    const g = window.__gensokyo, rig = g.player.model.userData.rig;
    g.combat.animT = -1;
    g.combat.update = () => {                    // 蓋掉每幀更新，畫面停在這格
      g.combat.drawn = ${drawn};
      const pose = M.poseFor('${motion}', ${k});
      M.applyPose(rig, pose);
      g.combat._updateBlade(pose);
    };
    return true;
  })()`, true);
  // 相機會自己 lerp/避障，拍之前再釘一次距離
  await evaljs(`(() => { const p = window.__gensokyo.player;
    p.camDist = 7.2; p.camDistTarget = 7.2; p.camPitch = 0.22; return 1; })()`);
  await wait(500);
  await shot(TMP + '/' + file);
  console.log('拍了', file);
};

await freeze('sheathe', 1, false, 'sword_1_sheathed.png');   // 佩在左胯
await freeze('draw', 0.40, true, 'sword_2_drawing.png');     // 拔刀中（刀正離鞘）
await freeze('skyRend', 0.26, true, 'sword_3_overhead.png'); // 貳之型上段
await freeze('sunPierce', 0.4, true, 'sword_4_thrust.png');  // 柒之型突刺

page.close();
process.exit(0);
