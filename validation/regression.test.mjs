// 识别回归护栏:改 chords.js / music.js 后,npm test 会在真实歌曲上自动报警。
//
// 为什么需要它:music.test.mjs 只测合成 chroma / 清晰三和弦,改一个 prior 很容易
// 在合成音频上涨、却在真实录音上悄悄掉链子(品类通病)。这里对每首有人工
// requiredChords 标注的真实歌,用已入库的 notes 重跑 detectChords,断言所有
// 人工要求的和弦仍以 MIREX 等价规则出现。requiredChords 是人工标注(不来自模型),
// 所以这是对真实素材的准确率底线,不是模型自证。
//
// 数据来源:validation/real_analysis/<歌>.json(含 notes)+ validation/references/<歌>.json。
// 真实音频不入库,但 notes 与人工标注入库,故此护栏对 fresh clone 也能跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectChords, chordByLabel } from '../src/chords.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REF_DIR = join(HERE, 'references');
const ANALYSIS_DIR = join(HERE, 'real_analysis');

// MIREX 等价:同根音且共享 ≥3 个音级即算命中(与 score_batch.mjs 的 compatible 一致)。
// 真实录音常把谱面三和弦弹成七和弦(Gm vs Gm7),不应判失败。
function compatible(want, labels) {
  const wc = chordByLabel(want);
  if (!wc) return labels.has(want);
  for (const l of labels) {
    if (l === want) return true;
    const lc = chordByLabel(l);
    if (!lc || lc.root !== wc.root) continue;
    let shared = 0;
    for (const pc of wc.pcSet) if (lc.pcSet.has(pc)) shared++;
    if (shared >= 3) return true;
  }
  return false;
}

// 收集有 requiredChords 人工标注、且有对应 notes 分析的歌曲
function corpus() {
  if (!existsSync(REF_DIR) || !existsSync(ANALYSIS_DIR)) return [];
  const out = [];
  for (const f of readdirSync(REF_DIR).filter((n) => n.endsWith('.json')).sort()) {
    const ref = JSON.parse(readFileSync(join(REF_DIR, f)));
    if (!Array.isArray(ref.requiredChords) || !ref.requiredChords.length) continue;
    const analysisPath = join(ANALYSIS_DIR, basename(f, '.json') + '.json');
    if (!existsSync(analysisPath)) continue;
    const analysis = JSON.parse(readFileSync(analysisPath));
    if (!Array.isArray(analysis.notes) || !analysis.notes.length) continue;
    out.push({ name: basename(f, '.json'), ref, notes: analysis.notes, duration: analysis.duration });
  }
  return out;
}

const songs = corpus();

// 允许极少数已知偏难曲目未命中(密集全混音品类通病),但为整体设一条硬底线,
// 防止某次改动导致真实语料大面积回归。当前基线为全部命中,阈值给出安全余量。
const MIN_PASS_RATE = 0.9;

test('真实语料:重跑 detectChords 仍能覆盖人工 requiredChords(回归底线)', () => {
  if (!songs.length) {
    // fresh clone 若未带 real_analysis 也不应让 CI 变红,仅跳过。
    console.warn('  (无真实语料可测:缺 real_analysis/ 或 references/ 的 requiredChords)');
    return;
  }
  const failures = [];
  for (const song of songs) {
    const { segments } = detectChords(song.notes, song.duration);
    const labels = new Set(segments.map((s) => s.label).filter(Boolean));
    const missing = song.ref.requiredChords.filter((c) => !compatible(c, labels));
    if (missing.length) failures.push(`${song.name}: 缺 ${missing.join(',')}`);
  }
  const passRate = (songs.length - failures.length) / songs.length;
  const pct = (100 * passRate).toFixed(1);
  console.log(`  真实语料 ${songs.length} 首,requiredChords 覆盖 ${songs.length - failures.length}/${songs.length}(${pct}%)`);
  for (const f of failures) console.log(`    ✗ ${f}`);
  assert.ok(
    passRate >= MIN_PASS_RATE,
    `真实语料 requiredChords 覆盖率 ${pct}% 低于底线 ${(100 * MIN_PASS_RATE).toFixed(0)}%(疑似识别回归):\n  ${failures.join('\n  ')}`,
  );
});
