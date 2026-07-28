import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp } from '../core/noise.js';
import { skirtMats } from './terrain.js';

// 晝夜循環：太陽 / 月亮 / 星空 / 霧色
// timeOfDay 以「分鐘」計，0 = 午夜，720 = 正午。

const DAY = 1440;

const PALETTE = [
  // t(分鐘)  天空霧色      日光色        日光強度  環境光    星星
  // 2026-07 調亮：舊版夜晚 amb 0.16~0.20 幾乎全黑（「晚上太暗看不到」）。
  // 月夜提高到 0.32~0.36，仍保留夜晚氣氛與燈籠的暖光對比。
  { t: 0,    fog: 0x1b2740, sun: 0x2a3a68, si: 0.05, amb: 0.34, star: 1.0 },
  { t: 300,  fog: 0x252e48, sun: 0x394a78, si: 0.08, amb: 0.36, star: 0.9 },
  { t: 380,  fog: 0x6b5a72, sun: 0xd08a5a, si: 0.55, amb: 0.40, star: 0.35 },
  { t: 440,  fog: 0xc4a898, sun: 0xffc08a, si: 1.35, amb: 0.52, star: 0.0 },
  { t: 600,  fog: 0xb9cbdc, sun: 0xfff2dd, si: 2.10, amb: 0.68, star: 0.0 },
  { t: 780,  fog: 0xc2d2e0, sun: 0xfff8ee, si: 2.35, amb: 0.72, star: 0.0 },
  { t: 1010, fog: 0xd8b79c, sun: 0xffbf7d, si: 1.70, amb: 0.58, star: 0.0 },
  { t: 1090, fog: 0xa8748a, sun: 0xff8a54, si: 0.85, amb: 0.40, star: 0.15 },
  { t: 1160, fog: 0x524468, sun: 0x6a4a78, si: 0.22, amb: 0.38, star: 0.7 },
  { t: 1260, fog: 0x223052, sun: 0x33447a, si: 0.07, amb: 0.34, star: 1.0 },
  { t: DAY,  fog: 0x1b2740, sun: 0x2a3a68, si: 0.05, amb: 0.34, star: 1.0 },
];

function sample(t) {
  t = ((t % DAY) + DAY) % DAY;
  let a = PALETTE[0], b = PALETTE[PALETTE.length - 1];
  for (let i = 0; i < PALETTE.length - 1; i++) {
    if (t >= PALETTE[i].t && t <= PALETTE[i + 1].t) { a = PALETTE[i]; b = PALETTE[i + 1]; break; }
  }
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return {
    fog: new THREE.Color(a.fog).lerp(new THREE.Color(b.fog), k),
    sun: new THREE.Color(a.sun).lerp(new THREE.Color(b.sun), k),
    si: lerp(a.si, b.si, k),
    amb: lerp(a.amb, b.amb, k),
    star: lerp(a.star, b.star, k),
  };
}

export class SkySystem {
  constructor(scene, renderer, viewDist) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 840;          // 預設 14:00
    this.speed = 12;          // 遊戲分鐘 / 真實秒

    // --- 大氣散射天空 ---
    this.sky = new Sky();
    this.sky.scale.setScalar(60000);
    this.sky.material.uniforms.turbidity.value = 4.2;
    this.sky.material.uniforms.rayleigh.value = 2.1;
    this.sky.material.uniforms.mieCoefficient.value = 0.006;
    this.sky.material.uniforms.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    // --- 太陽 ---
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.9;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 900;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // --- 環境光 ---
    this.hemi = new THREE.HemisphereLight(0xbcd4ee, 0x53472f, 0.7);
    scene.add(this.hemi);

    // --- 霧 ---
    this.scene.fog = new THREE.Fog(0xc2d2e0, viewDist * 0.16, viewDist);

    // --- 星空 ---
    this.stars = this._buildStars();
    scene.add(this.stars);

    // --- 月亮 ---
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xf4f0e2, fog: false, transparent: true });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), moonMat);
    this.moon.scale.setScalar(190);
    scene.add(this.moon);

    this.sunDir = new THREE.Vector3();
    this.shadowExtent = 190;
  }

  _buildStars() {
    const N = 2600;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      // 只鋪半球以上，地平線以下看不到
      const u = Math.random(), v = Math.random() * 0.92 + 0.05;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - v);
      const r = 9000;
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi) * 0.9 + 400;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      c.setHSL(0.55 + Math.random() * 0.12, 0.35, 0.72 + Math.random() * 0.28);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 26, vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, fog: false, sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geo, mat);
  }

  setShadowExtent(e) {
    this.shadowExtent = e;
    const c = this.sun.shadow.camera;
    c.left = -e; c.right = e; c.top = e; c.bottom = -e;
    c.far = e * 5;
    c.updateProjectionMatrix();
  }

  setViewDist(d) {
    this.scene.fog.near = d * 0.16;
    this.scene.fog.far = d;
  }

  /** 太陽仰角（-1 地平線下 ~ 1 天頂） */
  get sunElevation() {
    return this.sunDir.y;
  }

  update(dt, focus) {
    this.time = (this.time + dt * this.speed) % DAY;

    // 太陽沿黃道走，稍微傾斜避免正頭頂
    const a = ((this.time - 360) / DAY) * Math.PI * 2;
    this.sunDir.set(
      Math.cos(a) * 0.42,
      Math.sin(a),
      Math.cos(a) * 0.88
    ).normalize();

    const p = sample(this.time);

    // 天空 shader
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.sky.material.uniforms.rayleigh.value = lerp(0.4, 2.6, clamp(this.sunDir.y * 2 + 0.5, 0, 1));
    this.sky.material.uniforms.turbidity.value = lerp(1.5, 6.0, clamp(this.sunDir.y + 0.4, 0, 1));

    // 平行光：夜晚換成月光方向
    const night = this.sunDir.y < -0.02;
    const dir = night ? this.sunDir.clone().negate() : this.sunDir;
    const dist = this.shadowExtent * 2.6;

    this.sun.position.copy(focus).addScaledVector(dir, dist);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sun.color.copy(p.sun);
    this.sun.intensity = night ? 0.65 : p.si;   // 月光：舊版 0.28 幾乎照不亮地面
    if (night) this.sun.color.setHex(0x93b0e0);

    // 環境
    this.hemi.intensity = p.amb;
    this.hemi.color.copy(p.fog).lerp(new THREE.Color(0xffffff), 0.25);
    this.scene.fog.color.copy(p.fog);

    // 裙邊的大氣散射補光跟著晝夜走：白天 0.22、夜晚收到近零，
    // 顏色直接借霧色（黃昏轉暖、夜晚轉深藍，裙邊才不會離隊）
    const skirtGlow = 0.22 * clamp(this.sunDir.y * 2 + 0.25, 0.03, 1);
    for (const m of skirtMats) {
      m.emissive.copy(p.fog);
      m.emissiveIntensity = skirtGlow;
    }
    this.renderer.toneMappingExposure = lerp(0.85, 0.55, clamp(this.sunDir.y, 0, 1));

    // 星星 / 月亮
    this.stars.material.opacity = p.star;
    this.stars.visible = p.star > 0.01;
    this.stars.position.copy(focus);
    this.stars.rotation.y = this.time * 0.0012;

    this.moon.visible = p.star > 0.01;
    this.moon.material.opacity = clamp(p.star * 1.2, 0, 1);
    this.moon.position.copy(focus).addScaledVector(this.sunDir, -7000);

    this.sky.position.copy(focus);

    return p;
  }
}
