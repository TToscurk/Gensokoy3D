// 湖面薰衣草色還在 —— 活體實驗：確認 patch、紅色 waterColor、隱藏對照
import { cdp } from './cdp.mjs';

const TMP = 'C:/Users/B365/AppData/Local/Temp';
const { evaljs, shot, close } = await cdp();

const info = await evaljs(`(() => {
  let w; window.__gensokyo.scene.traverse(o => { if (o.name === 'water') w = o; });
  window.__w = w;
  const fs = w.material.fragmentShader;
  return {
    rf0: (fs.match(/float rf0 = [0-9.]+;/) || ['?'])[0],
    norm: (fs.match(/noise\\.xzy \\* vec3\\( [0-9., ]+\\)/) || ['?'])[0],
    wc: w.material.uniforms.waterColor.value.getHexString(),
    visible: w.visible,
  };
})()`);
console.log('water state:', JSON.stringify(info));

// 實驗 A：水色改純紅
await evaljs(`window.__w.material.uniforms.waterColor.value.setHex(0xff0000)`);
await shot(TMP + '/lake_red.png');
console.log('shot lake_red');

// 實驗 B：整個藏掉
await evaljs(`window.__w.material.uniforms.waterColor.value.setHex(0x22405a); window.__w.visible = false`);
await shot(TMP + '/lake_hidden.png');
console.log('shot lake_hidden');
await evaljs(`window.__w.visible = true`);
await close();
