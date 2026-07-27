import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// 後製鏈：場景 → GTAO → Bloom → 色調映射 → 色彩分級 → SMAA
// 1070 在 1080p 跑這條鏈大約吃掉 4~5ms —— GTAO 佔大宗，但它給的
// 接觸陰影是「引擎感」最大的單一來源：牆角、樹根、屋簷下都會沉下去。

// ---------------------------------------------------------------------------
// 電影調色彩分級：飽和微推、暗部偏青、亮部偏暖、四角輕暗角。
// 在 OutputPass（色調映射 + sRGB）之後跑，處理的是最終畫面。
// ---------------------------------------------------------------------------
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.09 },
    uVignette: { value: 0.30 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));

      // 飽和度
      c.rgb = mix(vec3(luma), c.rgb, uSaturation);

      // 暗部偏青藍、亮部偏暖 —— 最經典的電影分離調色
      float shadowW = 1.0 - smoothstep(0.0, 0.5, luma);
      float highW = smoothstep(0.55, 1.0, luma);
      c.rgb += vec3(0.010, 0.022, 0.045) * shadowW;
      c.rgb *= mix(vec3(1.0), vec3(1.045, 1.015, 0.965), highW);

      // 暗角
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - smoothstep(0.52, 0.98, d) * uVignette;

      gl_FragColor = c;
    }`,
};

export function buildComposer(renderer, scene, camera, q) {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  let gtao = null;
  if (q.ao) {
    gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
    gtao.output = GTAOPass.OUTPUT.Default;
    composer.addPass(gtao);
  }

  let bloom = null;
  if (q.bloom) {
    bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.62,   // strength
      0.72,   // radius
      0.72    // threshold
    );
    composer.addPass(bloom);
  }

  composer.addPass(new OutputPass());

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  if (q.smaa) {
    const smaa = new SMAAPass(
      window.innerWidth * renderer.getPixelRatio(),
      window.innerHeight * renderer.getPixelRatio()
    );
    composer.addPass(smaa);
  }

  return { composer, bloom, renderPass, gtao, grade };
}

/** 夜裡把 bloom 推強一點，白天收斂 */
export function tuneBloom(bloom, sunElevation) {
  if (!bloom) return;
  const night = 1 - Math.min(1, Math.max(0, sunElevation * 3 + 0.35));
  bloom.strength = 0.42 + night * 0.72;
  bloom.threshold = 0.82 - night * 0.42;
}
