// 活體shader手術：reflectance 強制歸零 → 截圖；再整片紅色 → 截圖
import { cdp } from './cdp.mjs';

const TMP = (await import('os')).tmpdir();   // 原本寫死作者機器的路徑
const { evaljs, shot, close } = await cdp();

// A: reflectance = 0
console.log(await evaljs(`(() => {
  const m = window.__w.material;
  m.fragmentShader = m.fragmentShader.replace(
    'float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );',
    'float reflectance = 0.0;');
  m.needsUpdate = true;
  return m.fragmentShader.includes('float reflectance = 0.0;') ? 'patched A' : 'A 沒替換到';
})()`));
await new Promise(r => setTimeout(r, 800));
await shot(TMP + '/lake_noreflect.png');
console.log('shot lake_noreflect');

// B: 整片紅色（驗證 recompile 機制本身）
console.log(await evaljs(`(() => {
  const m = window.__w.material;
  m.fragmentShader = m.fragmentShader.replace(
    'gl_FragColor = vec4( outgoingLight, alpha );',
    'gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );');
  m.needsUpdate = true;
  return m.fragmentShader.includes('1.0, 0.0, 0.0') ? 'patched B' : 'B 沒替換到';
})()`));
await new Promise(r => setTimeout(r, 800));
await shot(TMP + '/lake_allred.png');
console.log('shot lake_allred');
await close();
