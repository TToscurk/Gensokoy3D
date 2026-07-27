import * as THREE from 'three';
import { buildCharacter, animateCharacter } from './model.js';
import { ROSTER } from './roster.js';
import { REGION_BY_ID, WORLD } from '../config.js';
import { groundHeight } from '../world/terrain.js';

const TALK_RANGE = 4.2;
// 26 位住民散布全圖，不可能同時入鏡 —— 超過這個距離整隻隱藏、
// 連待機動畫都不跑，同屏負擔跟 16 位的時代一樣。
const CULL_DIST = 260;

function nameplate(zh, en) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 128);

  g.font = '600 46px "Noto Sans TC","Microsoft JhengHei",sans-serif';
  g.textAlign = 'center';
  g.shadowColor = 'rgba(0,0,0,.9)';
  g.shadowBlur = 12;
  g.fillStyle = '#fff';
  g.fillText(zh, 256, 56);

  g.font = '400 20px sans-serif';
  g.letterSpacing = '4px';
  g.fillStyle = 'rgba(220,200,230,.8)';
  g.fillText(en, 256, 92);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({
    map: t, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.set(3.2, 0.8, 1);
  s.renderOrder = 999;
  return s;
}

export class NPCManager {
  constructor(scene) {
    this.scene = scene;
    this.npcs = [];
    this.nearest = null;

    for (const spec of ROSTER) {
      const reg = REGION_BY_ID[spec.region];
      if (!reg) continue;

      const x = reg.x + spec.offset[0];
      const z = reg.z + spec.offset[1];
      const ground = Math.max(groundHeight(x, z), WORLD.waterLevel);
      const y = ground + (spec.float ? (spec.floatY ?? 0.8) : 0);

      const root = buildCharacter(spec);
      root.position.set(x, y, z);
      root.rotation.y = spec.face ?? 0;
      scene.add(root);

      const plate = nameplate(spec.zh, spec.en);
      plate.position.set(x, y + 2.35, z);
      scene.add(plate);

      // 描邊在遠處看不出來，卻是實打實的 draw call —— 收集起來按距離開關
      const outlines = [];
      root.traverse(o => { if (o.name === 'outline') outlines.push(o); });

      this.npcs.push({
        spec, root, plate, outlines,
        pos: new THREE.Vector3(x, y, z),
        talkIndex: 0,
        baseYaw: spec.face ?? 0,
      });
    }
  }

  update(t, playerPos, camera) {
    let best = null, bestD = TALK_RANGE;

    for (const n of this.npcs) {
      const d = n.pos.distanceTo(playerPos);

      // 距離剔除：直接整隻關掉，動畫與描邊邏輯全部跳過
      const visible = d < CULL_DIST;
      if (n.culled !== !visible) {
        n.culled = !visible;
        n.root.visible = visible;
        if (!visible) n.plate.visible = false;
      }
      if (!visible) continue;

      animateCharacter(n.root, t, 0);

      // 遠處關掉描邊：省下的 draw call 比看得出來的差異多得多
      const wantOutline = d < 70;
      if (n.outlineOn !== wantOutline) {
        n.outlineOn = wantOutline;
        for (const o of n.outlines) o.visible = wantOutline;
      }

      // 名牌：靠近才浮現，永遠面向相機
      const vis = 1 - Math.min(1, Math.max(0, (d - 6) / 14));
      n.plate.material.opacity += (vis - n.plate.material.opacity) * 0.12;
      n.plate.visible = n.plate.material.opacity > 0.01;

      // 玩家靠近時轉頭看你
      if (d < 9) {
        const want = Math.atan2(playerPos.x - n.pos.x, playerPos.z - n.pos.z);
        let diff = want - n.root.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        n.root.rotation.y += diff * 0.045;
      } else {
        let diff = n.baseYaw - n.root.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        n.root.rotation.y += diff * 0.02;
      }

      if (d < bestD) { bestD = d; best = n; }
    }

    this.nearest = best;
    return best;
  }

  /** 取出下一段對話，並把指標推進 */
  nextTalk(npc) {
    const talks = npc.spec.talks;
    const lines = talks[npc.talkIndex % talks.length];
    npc.talkIndex++;
    return lines;
  }
}
