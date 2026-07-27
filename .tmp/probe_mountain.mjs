// 批次1 地形探針：驗收妖怪之山重建後的高度剖面與地區判定
// 用法：node .tmp/probe_mountain.mjs
import { terrainHeight, regionAt, riverSample } from '../src/world/terrain.js';
import { CRATER_LAKE, RIVER, REGION_BY_ID } from '../src/config.js';

let fails = 0;
function check(label, actual, lo, hi) {
  const ok = actual >= lo && actual <= hi;
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual.toFixed(1)}  (expect ${lo}~${hi})`);
}
function checkEq(label, actual, expect) {
  const ok = actual === expect;
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}  (expect ${expect})`);
}

const M = REGION_BY_ID.youkaiMountain;   // (-640,-690) elev150 peakH225
const MO = REGION_BY_ID.moriya;          // (-598,-648) elev352

// --- 1. 山峰與火口湖 ---
check('峰心高度（火口底）', terrainHeight(M.x, M.z), 330, 356);            // 375-26±rough，再被湖床壓向334
check('湖床（湖心）', terrainHeight(CRATER_LAKE.x, CRATER_LAKE.z), 330, 338);
// 火口緣：湖半徑48+4 的方向任取（正東）
check('火口緣（正東 d=60）', terrainHeight(M.x + 60, M.z), 344, 372);
// 湖緣八方位都必須高於水面 342（溢流口方向除外——河道在那裡切了缺口）
{
  let worst = 1e9;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const px = M.x + Math.cos(a) * 54, pz = M.z + Math.sin(a) * 54;
    if (riverSample(px, pz).w > 0.3) continue;   // 溢流口缺口跳過
    worst = Math.min(worst, terrainHeight(px, pz));
  }
  check(`湖緣最低點（水面 ${CRATER_LAKE.waterY}）`, worst, CRATER_LAKE.waterY + 1, 372);
}
check('錐面 d=120', terrainHeight(M.x + 120, M.z), 250, 320);
check('錐面 d=250', terrainHeight(M.x + 250, M.z), 60, 230);
check('山域邊緣 d=355（已出山域，回到基底）', terrainHeight(M.x + 355, M.z), -30, 180);

// --- 2. 守矢平台 ---
check('守矢平台中心', terrainHeight(MO.x, MO.z), 348, 356);
// 平台核心（建築落點區）必須平；外圈向湖畔傾斜是預期的
{
  let mn = 1e9, mx = -1e9;
  for (let a = 0; a < 8; a++) {
    const h = terrainHeight(MO.x + Math.cos(a) * 15, MO.z + Math.sin(a) * 15);
    mn = Math.min(mn, h); mx = Math.max(mx, h);
  }
  check('守矢平台核心 15m 起伏', mx - mn, 0, 6);
}
checkEq('regionAt(守矢中心)', regionAt(MO.x, MO.z)?.id, 'moriya');
checkEq('regionAt(拜殿預定地)', regionAt(MO.x, MO.z - 16)?.id, 'moriya');
checkEq('regionAt(山腰 d=200)', regionAt(M.x + 200, M.z)?.id, 'youkaiMountain');

// --- 3. 湖面 vs 神社：水不能淹到拜殿 ---
check('拜殿預定地高度', terrainHeight(MO.x, MO.z - 16), CRATER_LAKE.waterY + 1, 358);
// 湖畔（諏訪子位）
check('湖畔（中心西北 8,8）', terrainHeight(MO.x - 8, MO.z - 8), CRATER_LAKE.waterY - 1, 356);

// --- 4. 河道：逐站遞減且河床貼合測站 ---
{
  let prev = 1e9, mono = true;
  for (const [x, z, bed] of RIVER) {
    const h = terrainHeight(x, z);
    const rv = riverSample(x, z);
    if (h > prev + 0.5) mono = false;
    console.log(`  測站 (${x},${z}) 地形=${h.toFixed(1)} 預期床=${bed} 權重=${rv.w.toFixed(2)} ${h <= bed + 6 ? '' : '  <-- 偏高'}`);
    prev = h;
  }
  checkEq('河道單調下坡', mono, true);
}
// 瀑布落差
check('九天瀑布落差', terrainHeight(-852, -600) - terrainHeight(-866, -592), 18, 40);
// 天狗聚落不被沖掉
check('天狗聚落中心', terrainHeight(-840, -590), 136, 150);
// 入湖口低於世界水位附近
check('入湖口', terrainHeight(-498, -406), -8, 4);

// --- 5. 舊址回歸山坡（不再有 208 平台） ---
check('守矢舊址（-545,-615）', terrainHeight(-545, -615), 230, 330);

// --- 6. 其他地區不受影響 ---
check('博麗神社平台', terrainHeight(855, -175), 100, 108);
check('人里平台', terrainHeight(-80, 150), 12, 18);
check('白玉樓平台', terrainHeight(620, -760), 164, 172);
check('天界平台', terrainHeight(350, -880), 336, 344);
check('霧之湖湖床', terrainHeight(-430, -400), -18, -10);

console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項未過`);
process.exit(fails ? 1 : 0);
