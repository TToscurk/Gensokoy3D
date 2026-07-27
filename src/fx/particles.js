import * as THREE from 'three';
import { REGION_BY_ID, WORLD } from '../config.js';
import { terrainHeight } from '../world/terrain.js';
import { petalTexture, glowTexture } from '../core/textures.js';

// ---------------------------------------------------------------------------
// 櫻花吹雪 —— 白玉樓上空永遠飄著花瓣
// ---------------------------------------------------------------------------
export class Petals {
  constructor(count) {
    const R = REGION_BY_ID.netherworld;
    this.R = R;
    this.n = count;
    this.spread = R.radius * 1.5;

    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.spin = new Float32Array(count);
    // 落地高度在重生時算一次就存起來。
    // 每幀對每片花瓣重新取樣地形高度會吃掉大半個 frame budget，
    // 而花瓣一輪只飄幾公尺，用生成點的高度肉眼看不出差別。
    this.groundY = new Float32Array(count);

    for (let i = 0; i < count; i++) this._respawn(i, pos, size, true);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    const mat = new THREE.PointsMaterial({
      map: petalTexture(),
      color: 0xffc8dc,
      size: 0.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
      alphaTest: 0.25,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.name = 'petals';
    this.pos = pos;
    this.size = size;
  }

  _respawn(i, pos, size, initial) {
    const R = this.R;
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * this.spread;
    const x = R.x + Math.cos(a) * d;
    const z = R.z + Math.sin(a) * d;
    const ground = terrainHeight(x, z);
    this.groundY[i] = ground - 0.5;
    pos[i * 3] = x;
    pos[i * 3 + 1] = initial
      ? ground + Math.random() * 40
      : ground + 30 + Math.random() * 14;
    pos[i * 3 + 2] = z;
    size[i] = 0.28 + Math.random() * 0.4;
    this.vel[i * 3] = (Math.random() - 0.5) * 1.4;
    this.vel[i * 3 + 1] = -(0.5 + Math.random() * 0.9);
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
    this.spin[i] = Math.random() * Math.PI * 2;
  }

  update(dt, t) {
    const p = this.pos, v = this.vel;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      // 花瓣是飄的，不是掉的 —— 加一點正弦擺盪
      const sway = Math.sin(t * 1.6 + this.spin[i]) * 0.9;
      p[i3] += (v[i3] + sway) * dt;
      p[i3 + 1] += v[i3 + 1] * dt;
      p[i3 + 2] += (v[i3 + 2] + Math.cos(t * 1.3 + this.spin[i]) * 0.7) * dt;

      if (p[i3 + 1] < this.groundY[i]) {
        this._respawn(i, p, this.size, false);
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// 螢火 / 靈魂之火 —— 魔法之森與冥界，只在夜裡出現
// ---------------------------------------------------------------------------
export class Spirits {
  constructor(count) {
    this.n = count;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    this.home = new Float32Array(count * 3);
    this.phase = new Float32Array(count);

    const forest = REGION_BY_ID.forest;
    const neth = REGION_BY_ID.netherworld;
    const c = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const inForest = i % 2 === 0;
      const R = inForest ? forest : neth;
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * R.radius * 1.3;
      const x = R.x + Math.cos(a) * d;
      const z = R.z + Math.sin(a) * d;
      const y = terrainHeight(x, z) + 0.8 + Math.random() * 5;
      this.home[i * 3] = pos[i * 3] = x;
      this.home[i * 3 + 1] = pos[i * 3 + 1] = y;
      this.home[i * 3 + 2] = pos[i * 3 + 2] = z;
      this.phase[i] = Math.random() * Math.PI * 2;

      if (inForest) c.setHSL(0.42 + Math.random() * 0.1, 0.9, 0.62);
      else c.setHSL(0.78 + Math.random() * 0.12, 0.75, 0.72);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
      map: glowTexture('#ffffff'),
      size: 0.85,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.name = 'spirits';
    this.pos = pos;
  }

  update(dt, t, sunElevation) {
    // 只在太陽低於地平線時浮現
    const want = 1 - Math.min(1, Math.max(0, sunElevation * 4 + 0.5));
    const m = this.points.material;
    m.opacity += (want * 0.95 - m.opacity) * Math.min(1, dt * 1.4);
    this.points.visible = m.opacity > 0.02;
    if (!this.points.visible) return;

    const p = this.pos, h = this.home;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      const ph = this.phase[i];
      p[i3]     = h[i3]     + Math.sin(t * 0.42 + ph) * 3.2;
      p[i3 + 1] = h[i3 + 1] + Math.sin(t * 0.65 + ph * 1.7) * 1.4;
      p[i3 + 2] = h[i3 + 2] + Math.cos(t * 0.37 + ph * 1.3) * 3.2;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// 彈幕 —— 純裝飾用的旋轉彈幕環，繞著特定角色打轉
// ---------------------------------------------------------------------------
export class Danmaku {
  constructor(anchors) {
    this.anchors = anchors;         // [{pos:Vector3, color, count, radius, speed}]
    const total = anchors.reduce((s, a) => s + a.count, 0);

    const geo = new THREE.PlaneGeometry(0.34, 0.34);
    const mat = new THREE.MeshBasicMaterial({
      map: glowTexture('#ffffff'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, total);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'danmaku';
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(total * 3), 3);

    const c = new THREE.Color();
    let k = 0;
    this.slots = [];
    for (const a of anchors) {
      c.set(a.color);
      for (let i = 0; i < a.count; i++) {
        this.mesh.setColorAt(k, c);
        this.slots.push({ a, i, k });
        k++;
      }
    }
    this.mesh.instanceColor.needsUpdate = true;

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  update(t, camera) {
    // 彈幕永遠面向相機（billboard），繞著錨點做多重同心環
    camera.getWorldQuaternion(this._q);
    for (const s of this.slots) {
      const a = s.a;
      const ring = Math.floor(s.i / 8);
      const idx = s.i % 8;
      const ang = (idx / 8) * Math.PI * 2 + t * a.speed * (ring % 2 ? -1 : 1) + ring * 0.4;
      const r = a.radius * (0.55 + ring * 0.3);
      this._v.set(
        a.pos.x + Math.cos(ang) * r,
        a.pos.y + Math.sin(t * 0.9 + s.i) * 0.35 + ring * 0.32,
        a.pos.z + Math.sin(ang) * r
      );
      const pulse = 0.85 + Math.sin(t * 3 + s.i * 0.7) * 0.3;
      this._s.setScalar(pulse);
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(s.k, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
