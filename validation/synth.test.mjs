// 合成整曲精度护栏:端到端(分段+识别)对照逐小节精确真值,防止识别精度回归。
//
// 为什么需要它:music.test.mjs 只测单窗 chroma;真实语料只有粗检(和弦是否出现)。
// 这里用 songs_manifest.json 合成的 4 首整曲(有精确时间轴真值)算时间重叠加权的
// exact-match,是唯一能守住"逐拍报对"这一精度指标的回归网。
//
// 尤其守护 2026-07 的属七校准(extBonus 0.24):12 小节布鲁斯(全属七)的 exact
// 从 25% 提到 62%,同时流行/卡农/doo-wop 三和弦零回归。任何把 extBonus 调过头
// 而误伤三和弦、或调回去而丢掉七和弦的改动,都会让本测试变红。
//
// 数据:validation/synth_analysis/<歌>.json(含 notes)+ synth_references/<歌>.json(真值 segments)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectChords } from '../src/chords.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REF_DIR = join(HERE, 'synth_references');
const ANALYSIS_DIR = join(HERE, 'synth_analysis');

// 时间重叠加权的精确匹配率(与 score_batch.mjs 的 scoreSegments 同规则)
function exactMatch(segments, truth) {
  let total = 0;
  let exact = 0;
  for (const rs of truth) {
    const dur = rs.end - rs.start;
    if (dur <= 0 || !rs.label || rs.label === 'N.C.') continue;
    total += dur;
    for (const as of segments) {
      const ov = Math.min(rs.end, as.end) - Math.max(rs.start, as.start);
      if (ov > 0 && as.label === rs.label) exact += ov;
    }
  }
  return total ? { rate: exact / total, seconds: total } : null;
}

// 每首精确匹配下限(当前值留安全余量),以及整体加权下限
const FLOORS = { blues_a: 0.55, canon_d: 0.88, doowop_50s: 0.88, pop_axis: 0.88 };
const WEIGHTED_FLOOR = 0.84; // win 0.65 后加权 exact ≈86.5%,留安全余量

test('合成整曲:端到端精确匹配不低于校准基线(精度回归网)', () => {
  if (!existsSync(REF_DIR) || !existsSync(ANALYSIS_DIR)) {
    console.warn('  (无合成语料可测:缺 synth_analysis/ 或 synth_references/)');
    return;
  }
  let wExact = 0;
  let wTotal = 0;
  const below = [];
  for (const f of readdirSync(REF_DIR).filter((n) => n.endsWith('.json')).sort()) {
    const name = basename(f, '.json');
    const ref = JSON.parse(readFileSync(join(REF_DIR, f)));
    const analysisPath = join(ANALYSIS_DIR, name + '.json');
    if (!existsSync(analysisPath)) continue;
    const analysis = JSON.parse(readFileSync(analysisPath));
    if (!Array.isArray(analysis.notes)) continue;
    const { segments } = detectChords(analysis.notes, analysis.duration);
    const m = exactMatch(segments, ref.segments);
    if (!m) continue;
    wExact += m.rate * m.seconds;
    wTotal += m.seconds;
    const floor = FLOORS[name] ?? 0.8;
    const pct = (100 * m.rate).toFixed(1);
    console.log(`  ${name}: exact ${pct}% (下限 ${(100 * floor).toFixed(0)}%)`);
    if (m.rate < floor) below.push(`${name} ${pct}% < ${(100 * floor).toFixed(0)}%`);
  }
  const weighted = wTotal ? wExact / wTotal : 0;
  console.log(`  加权 exact-match ${(100 * weighted).toFixed(1)}% (下限 ${(100 * WEIGHTED_FLOOR).toFixed(0)}%)`);
  assert.ok(below.length === 0, `精度回归:${below.join('; ')}`);
  assert.ok(weighted >= WEIGHTED_FLOOR, `加权精确匹配 ${(100 * weighted).toFixed(1)}% 低于下限`);
});
