import * as THREE from 'three';
import { cloudTexture, mistTexture } from '../core/textures.js';
import { groundHeight } from '../world/terrain.js';
import { REGION_BY_ID } from '../config.js';
import { mulberry32 } from '../core/noise.js';

// ---------------------------------------------------------------------------
// 大氣層：程序雲 + 低空霧帶。
//
// 兩者都是「自寫 shader 的 instanced 面片」，各自只要一個 draw call。
// 雲用圓柱式 billboard（永遠面向相機、不翻轉），緩慢橫越天空，邊緣淡出；
// 霧片平貼地面，在湖面、魔法之森、竹林與冥界階梯上漂移呼吸。
// 時間與染色由主迴圈推進 —— 黃昏時雲會染上霧色，清晨的霧最濃。
// ---------------------------------------------------------------------------

const WORLD_SPAN = 3800;   // 雲的巡行範圍（-1900 ~ +1900）

function cloudMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: cloudTexture() },
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(0xffffff) },
      uOpacity: { value: 0.85 },
      uFogColor: { value: new THREE.Color(0xc2d2e0) },
      uFogNear: { value: 300 },
      uFogFar: { value: 2200 },
    },
    vertexShader: /* glsl */`
      attribute vec3 iPos;
      attribute float iScale;
      varying vec2 vUv;
      varying float vFade;
      varying float vFogDepth;
      uniform float uTime;
      void main() {
        vUv = uv;
        // 沿 +X 緩慢巡行，跨出邊界時繞回 —— 邊緣淡出遮住換場的瞬間
        float x = mod(iPos.x + uTime * 3.2 + ${(WORLD_SPAN / 2).toFixed(1)}, ${WORLD_SPAN.toFixed(1)}) - ${(WORLD_SPAN / 2).toFixed(1)};
        vec3 wp = vec3(x, iPos.y + sin(uTime * 0.05 + iPos.z) * 6.0, iPos.z);
        vFade = smoothstep(${(WORLD_SPAN / 2).toFixed(1)}, ${(WORLD_SPAN / 2 - 500).toFixed(1)}, abs(x));

        // 圓柱 billboard：只面向相機的方位角，保留俯仰（仰角看雲才自然）
        vec3 toCam = cameraPosition - wp;
        float yaw = atan(toCam.x, toCam.z);
        float c = cos(yaw), s = sin(yaw);
        vec3 local = vec3(position.x * c, position.y, -position.x * s) * iScale;
        wp += local;

        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform vec3 uTint;
      uniform float uOpacity;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec2 vUv;
      varying float vFade;
      varying float vFogDepth;
      void main() {
        vec4 tex = texture2D(uMap, vUv);
        float a = tex.a * uOpacity * vFade;
        if (a < 0.01) discard;
        float fogF = smoothstep(uFogNear, uFogFar, vFogDepth);
        vec3 col = mix(tex.rgb * uTint, uFogColor, fogF * 0.85);
        gl_FragColor = vec4(col, a * (1.0 - fogF * 0.6));
      }`,
  });
}

function mistMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uMap: { value: mistTexture() },
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(0xdfe8f0) },
      uOpacity: { value: 0.5 },
      uFogColor: { value: new THREE.Color(0xc2d2e0) },
      uFogNear: { value: 300 },
      uFogFar: { value: 2200 },
    },
    vertexShader: /* glsl */`
      attribute vec3 iPos;
      attribute float iScale;
      attribute float iPhase;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vFogDepth;
      uniform float uTime;
      void main() {
        vUv = uv;
        // 霧片的呼吸：位置緩慢漂移、透明度緩慢起伏
        vec3 wp = iPos + vec3(
          sin(uTime * 0.06 + iPhase) * 16.0,
          sin(uTime * 0.11 + iPhase * 2.1) * 0.8,
          cos(uTime * 0.045 + iPhase * 1.3) * 12.0
        );
        // 面片平放：xy 平面轉到 xz 地面
        wp += vec3(position.x, 0.0, position.y) * iScale;
        vAlpha = 0.55 + 0.45 * sin(uTime * 0.13 + iPhase * 2.7);
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform vec3 uTint;
      uniform float uOpacity;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vFogDepth;
      void main() {
        vec4 tex = texture2D(uMap, vUv);
        float a = tex.a * uOpacity * vAlpha;
        if (a < 0.008) discard;
        float fogF = smoothstep(uFogNear, uFogFar, vFogDepth);
        vec3 col = mix(tex.rgb * uTint, uFogColor, fogF);
        gl_FragColor = vec4(col, a * (1.0 - fogF));
      }`,
  });
}

function instancedQuad(n) {
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(2, 1);
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.instanceCount = n;
  return geo;
}

export class Atmosphere {
  /**
   * @param {number} cloudCount  雲的片數（0 = 不建）
   * @param {number} mistCount   霧的片數（0 = 不建）
   */
  constructor(cloudCount = 40, mistCount = 48) {
    this.group = new THREE.Group();
    this.group.name = 'atmosphere';
    const rnd = mulberry32(1123);

    // --- 雲 ---
    if (cloudCount > 0) {
      const geo = instancedQuad(cloudCount);
      const pos = new Float32Array(cloudCount * 3);
      const scl = new Float32Array(cloudCount);
      for (let i = 0; i < cloudCount; i++) {
        pos[i * 3]     = (rnd() * 2 - 1) * WORLD_SPAN / 2;
        pos[i * 3 + 1] = 230 + rnd() * 190;              // 比山高、比天低
        pos[i * 3 + 2] = (rnd() * 2 - 1) * WORLD_SPAN / 2;
        scl[i] = 90 + rnd() * 150;
      }
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
      geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(scl, 1));
      this.cloudMat = cloudMaterial();
      this.clouds = new THREE.Mesh(geo, this.cloudMat);
      this.clouds.frustumCulled = false;
      this.clouds.renderOrder = 1;
      this.group.add(this.clouds);
    }

    // --- 霧帶 ---
    if (mistCount > 0) {
      // 低窪與陰濕的地區才有霧：湖面、魔法之森、竹林、無緣塚、冥界
      const beds = [
        { id: 'lake', share: 0.34, yOff: 3.5, spread: 1.15 },
        { id: 'forest', share: 0.24, yOff: 3.0, spread: 1.0 },
        { id: 'bamboo', share: 0.16, yOff: 2.6, spread: 1.0 },
        { id: 'muenzuka', share: 0.12, yOff: 2.2, spread: 1.0 },
        { id: 'netherworld', share: 0.14, yOff: 4.0, spread: 1.1 },
      ];
      const geo = instancedQuad(mistCount);
      const pos = new Float32Array(mistCount * 3);
      const scl = new Float32Array(mistCount);
      const pha = new Float32Array(mistCount);
      for (let i = 0; i < mistCount; i++) {
        let pick = rnd(), bed = beds[0];
        for (const b of beds) { pick -= b.share; if (pick <= 0) { bed = b; break; } }
        const reg = REGION_BY_ID[bed.id];
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * reg.radius * bed.spread;
        const x = reg.x + Math.cos(a) * d, z = reg.z + Math.sin(a) * d;
        pos[i * 3]     = x;
        pos[i * 3 + 1] = groundHeight(x, z) + bed.yOff;
        pos[i * 3 + 2] = z;
        scl[i] = 26 + rnd() * 34;
        pha[i] = rnd() * Math.PI * 2;
      }
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
      geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(scl, 1));
      geo.setAttribute('iPhase', new THREE.InstancedBufferAttribute(pha, 1));
      this.mistMat = mistMaterial();
      this.mist = new THREE.Mesh(geo, this.mistMat);
      this.mist.frustumCulled = false;
      this.mist.renderOrder = 2;
      this.group.add(this.mist);
    }
  }

  /**
   * @param {number} t          累計秒數
   * @param {object} sky        SkySystem —— 拿霧色與日夜狀態
   * @param {number} nightFactor 0(白天) ~ 1(深夜)
   */
  update(t, sky, nightFactor) {
    const fog = sky.scene.fog;
    if (this.cloudMat) {
      const u = this.cloudMat.uniforms;
      u.uTime.value = t;
      u.uFogColor.value.copy(fog.color);
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
      // 白天偏白、黃昏與夜裡染上天空色
      u.uTint.value.copy(fog.color).lerp(new THREE.Color(0xffffff), 0.55 + nightFactor * 0.1);
      u.uOpacity.value = 0.75 - nightFactor * 0.35;
    }
    if (this.mistMat) {
      const u = this.mistMat.uniforms;
      u.uTime.value = t;
      u.uFogColor.value.copy(fog.color);
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
      u.uTint.value.copy(fog.color).lerp(new THREE.Color(0xffffff), 0.5);
      // 清晨與夜晚霧最濃，正午收乾
      u.uOpacity.value = 0.28 + nightFactor * 0.5;
    }
  }
}
