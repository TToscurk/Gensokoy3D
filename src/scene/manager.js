// 場景生命週期：載入、卸載、切換、過場。
//
// 這個檔案不認識任何一張地圖的內容 —— 就像 quests/manager.js 不認識任何任務。
// 它只負責「世界是怎麼被建構與銷毀的」，以及過場順序不可被打亂。
import { loadMapModule, validateGraph } from './registry.js';
import { setHeightField } from '../world/terrain.js';
import { setClearings, setGrassBounds } from '../world/vegetation.js';

export class SceneManager {
  /**
   * @param opts.scene      THREE.Scene
   * @param opts.renderer   THREE.WebGLRenderer
   * @param opts.quality    () => 目前的 QUALITY 條目
   * @param opts.progress   (pct, text) => Promise，載入進度回報
   * @param opts.hooks      見 _hook()：全部選用
   */
  constructor(opts) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this._quality = opts.quality;
    this._progress = opts.progress || (async () => {});
    this.hooks = opts.hooks || {};

    /** 目前地圖的實例（build() 的回傳值），沒有載入時為 null */
    this.map = null;
    /** 目前地圖的模組（meta / entries / portals） */
    this.mod = null;
    this.id = null;
    this.entry = null;

    /** 載圖中：主迴圈必須跳過 update，但照樣 render（保險絲不能拆） */
    this.loading = false;
    this._seq = 0;
  }

  get meta() { return this.mod?.meta || null; }

  /** 目前地圖的地形高度場。沒有地圖時回傳 0（不要讓呼叫端拿到 undefined 去做算術）。 */
  heightAt(x, z) {
    const f = this.map?.heightAt;
    return f ? f(x, z) : 0;
  }

  _hook(name, ...args) {
    const fn = this.hooks[name];
    return fn ? fn(...args) : undefined;
  }

  /** 開機時驗證出入口連線圖，錯誤直接印出來（缺一就是資料寫壞了）。 */
  async validate() {
    const errs = await validateGraph();
    for (const e of errs) console.error('[registry]', e);
    return errs;
  }

  /**
   * 切到某張地圖。順序見 SCENE_MANAGER_SPEC.md §5，不可調換。
   * @param mapId      目標地圖 id
   * @param entryName  目標地圖的入口名稱（省略則用 meta.spawn）
   * @param opts.style 'walk' | 'gate' | 'boot'（開機）| 'quality'（畫質重建）
   * @param opts.at    覆寫落點 { x, z, y?, facing? }
   * @param opts.place false = 完全不動玩家（畫質重建時留在原地）
   */
  async load(mapId, entryName = null, opts = {}) {
    if (this.loading) return false;
    const style = opts.style || 'walk';
    const first = style === 'boot';
    // 開機與畫質重建都由呼叫端自己顯示載入畫面，不要再疊一層過場
    const noFade = first || style === 'quality';
    const seq = ++this._seq;

    // 1. 鎖住輸入
    this.loading = true;
    this._hook('lockInput', true);

    try {
      // 2. 淡出
      if (!noFade) await this._hook('fadeOut', style, mapId);

      // 3. 等一幀 —— 確保沒有 update 跑到一半（rAF 在背景分頁會凍結，用 timeout 保底）
      if (!noFade) await new Promise(r => setTimeout(r, 0));

      // 4. 卸舊
      this.unload();

      // 5. 建新
      const mod = await loadMapModule(mapId);
      const map = await mod.build({
        quality: this._quality(),
        renderer: this.renderer,
        progress: this._progress,
        first,
        seed: mod.meta?.seed ?? 0,
      });
      if (seq !== this._seq) { map.dispose?.(); return false; }

      this.mod = mod;
      this.map = map;
      this.id = mapId;
      this.entry = entryName;
      this.scene.add(map.group);

      // 這一行是分圖改造的樞紐（規格書 §4 #1）：碰撞、相機、NPC、敵人、
      // 草地、粒子全都透過 terrain.js 的 groundHeight() 讀高度，
      // 指標一換，整個世界的「地面在哪」就換成這張圖說了算。
      // 必須在放置玩家之前 —— teleport 會用它算落地高度。
      setHeightField(map.heightAt);
      // 除草區同理：草地的 _fill 讀「現行清單」，記錯座標系就會在
      // 錯誤的地方挖洞。沒有自己那份的圖（legacy_open）傳 null 用舊世界的。
      setClearings(map.clearings || null);
      // 草磚範圍也一併切換：滾動草格不設限會種到圖外虛空（白底浮黑點）。
      // 沒有 size 的圖（legacy_open）不設限，沿用舊世界行為。
      const gsx = mod.meta?.sizeX ?? mod.meta?.size ?? 0;
      const gsz = mod.meta?.sizeZ ?? mod.meta?.size ?? 0;
      setGrassBounds(gsx ? { cx: 0, cz: 0, hx: gsx / 2, hz: gsz / 2 } : null);

      // 6. 放置玩家（清速度與慣性由 hook 負責）
      if (opts.place !== false) {
        const spot = opts.at || (entryName && mod.entries?.[entryName]) || mod.meta?.spawn || null;
        if (spot) this._hook('placePlayer', spot, mapId);
      }

      // 7. 套用新圖的環境
      this._hook('applyEnv', mod.meta, map);

      // 8. 任務事件 —— 一定要在玩家定位之後，否則在錯誤位置觸發
      this._hook('onEnter', mapId, mod.meta);

      return true;
    } finally {
      // 9. 解鎖 + 淡入
      this.loading = false;
      this._hook('lockInput', false);
      if (!noFade) await this._hook('fadeIn', style, mapId);
    }
  }

  /** 卸掉現行地圖。互動點與敵人交給 hook 清（它們不歸地圖持有）。 */
  unload() {
    if (!this.map) return;
    this._hook('beforeUnload', this.id, this.map);
    try {
      this.map.dispose?.();
    } catch (err) {
      console.error('[scene] dispose 失敗：', err);
    }
    this.scene.remove(this.map.group);
    this.map = null;
    this.mod = null;
    this.id = null;
    // 沒有地圖時高度場與除草區都還原成舊世界，
    // 避免呼叫端讀到已銷毀地圖的閉包
    setHeightField(null);
    setClearings(null);
    setGrassBounds(null);
  }

  /** 用目前的畫質重建同一張圖，玩家留在原地（完全不碰玩家狀態）。 */
  async rebuild() {
    if (!this.id) return false;
    return this.load(this.id, this.entry, { style: 'quality', place: false });
  }

  /** 每幀更新現行地圖。載圖中不呼叫。 */
  update(dt, t, rt) {
    if (this.loading || !this.map) return;
    this.map.update?.(dt, t, rt);
  }

  /**
   * 觸發區偵測：玩家踏進 portal 的圓柱範圍就回傳那個 portal。
   * 戰鬥中一律不觸發（避免打到一半被傳走）。
   */
  portalAt(x, z, { inCombat = false } = {}) {
    if (inCombat || this.loading || !this.map) return null;
    for (const p of this.map.portals || []) {
      const t = p.trigger;
      if (!t) continue;
      const dx = x - t.x, dz = z - t.z;
      if (dx * dx + dz * dz <= t.r * t.r) return p;
    }
    return null;
  }
}
