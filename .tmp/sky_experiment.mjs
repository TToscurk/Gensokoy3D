// 天空弧線實驗：(1) 只留 sky box 截圖 (2) uniforms 重置成 three 預設值再截圖
import { cdp } from './cdp.mjs';

const TMP = (await import('os')).tmpdir();   // 原本寫死作者機器的路徑
const { evaljs, shot, close } = await cdp();

// 目前 uniform 值
const uni = await evaljs(`(() => {
  const G = window.__gensokyo;
  const sky = G.scene.children.find(o => o.geometry?.type === 'BoxGeometry' && o.material?.type === 'ShaderMaterial');
  const u = sky.material.uniforms;
  window.__skyBox = sky;
  return {
    turbidity: u.turbidity.value, rayleigh: u.rayleigh.value,
    mie: u.mieCoefficient.value, g: u.mieDirectionalG.value,
    sun: u.sunPosition.value.toArray().map(v => +v.toFixed(3)),
    up: u.up.value.toArray(),
    exposure: G.renderer.toneMappingExposure,
    time: G.state.sky?.time ?? window.__gensokyo.state.timeOfDay,
  };
})()`);
console.log('uniforms:', JSON.stringify(uni));

// 只留 sky box
await evaljs(`(() => {
  const G = window.__gensokyo;
  window.__hidden = [];
  for (const c of G.scene.children) {
    if (c !== window.__skyBox && c.visible) { c.visible = false; window.__hidden.push(c); }
  }
  return G.scene.children.length;
})()`);
await shot(TMP + '/sky_only.png');
console.log('shot sky_only');

// 重置 uniforms 成 three Sky 範例預設
await evaljs(`(() => {
  const u = window.__skyBox.material.uniforms;
  u.turbidity.value = 10; u.rayleigh.value = 3;
  u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.7;
  return 1;
})()`);
await shot(TMP + '/sky_default.png');
console.log('shot sky_default');

// 還原
await evaljs(`(() => {
  for (const c of window.__hidden) c.visible = true;
  const u = window.__skyBox.material.uniforms;
  u.turbidity.value = ${uni.turbidity}; u.rayleigh.value = ${uni.rayleigh};
  u.mieCoefficient.value = ${uni.mie}; u.mieDirectionalG.value = ${uni.g};
  return 1;
})()`);
await close();
