// 批量评分:把 real_analysis/ 下的分析结果与 references/ 下的同名标注对照。
// 用法:npm run score:batch -- [分析目录] [标注目录]
// 标注文件命名:<音频去掉扩展名>.json,支持两级(可只写粗粒度):
//   粗粒度(沿用 verify_reference 的字段):durationSeconds/key/bpm/requiredChords/segmentCount
//   细粒度:"segments":[{"start":0,"end":2.4,"label":"C"}, ...]
//     按时间重叠加权打分,报告 精确匹配率 / 根音匹配率(N.C. 段不计分)。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chordByLabel } from '../src/chords.js';

const [analysisDir = 'validation/real_analysis', refDir = 'validation/references'] = process.argv.slice(2);

if (!existsSync(analysisDir)) {
  console.error(`No analysis directory ${analysisDir} — run npm run analyze:batch first.`);
  process.exit(1);
}

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function rootOf(label) {
  const m = /^([A-G][#b]?)/.exec(label || '');
  return m ? PC[m[1]] : null;
}

// 细粒度:时间重叠加权的标签匹配
function scoreSegments(analysis, ref) {
  let total = 0;
  let exact = 0;
  let root = 0;
  for (const rs of ref.segments) {
    const dur = rs.end - rs.start;
    if (dur <= 0 || !rs.label || rs.label === 'N.C.') continue;
    total += dur;
    for (const as of analysis.segments) {
      const ov = Math.min(rs.end, as.end) - Math.max(rs.start, as.start);
      if (ov <= 0) continue;
      if (as.label === rs.label) exact += ov;
      if (as.label && rootOf(as.label) === rootOf(rs.label)) root += ov;
    }
  }
  if (!total) return null;
  return { exact: exact / total, root: root / total, seconds: total };
}

// 粗粒度:结构检查,返回 {fails, notes}(fails 空 = 通过;notes 为等价通过说明)
function checkCoarse(analysis, ref) {
  const fails = [];
  const notes = [];
  if (ref.durationSeconds && !(analysis.duration >= ref.durationSeconds[0] && analysis.duration <= ref.durationSeconds[1])) {
    fails.push(`duration ${analysis.duration.toFixed(1)}s`);
  }
  if (ref.key) {
    if (!analysis.key) fails.push('no key detected');
    else if (analysis.key.tonic !== ref.key.tonic || analysis.key.mode !== ref.key.mode) {
      // 关系大小调等价:两者音级集合相同,谱面常按调号记谱,判为通过(标注说明)
      const relTonic = (ref.key.tonic + (ref.key.mode === 'major' ? 9 : 3)) % 12;
      const relMode = ref.key.mode === 'major' ? 'minor' : 'major';
      if (analysis.key.tonic === relTonic && analysis.key.mode === relMode) {
        notes.push(`key ${analysis.key.name} = relative of reference`);
      } else {
        fails.push(`tonic ${analysis.key.name}`);
      }
    }
  }
  if (ref.bpm && !(analysis.tempo?.bpm >= ref.bpm[0] && analysis.tempo?.bpm <= ref.bpm[1])) {
    fails.push(`tempo ${analysis.tempo?.bpm || '?'}`);
  }
  if (ref.requiredChords) {
    const labels = new Set(analysis.segments.map((s) => s.label).filter(Boolean));
    // MIREX 等价:两个和弦共享 ≥3 个音级即算命中
    // (真实录音常把谱面三和弦弹成七和弦,如 Gm vs Gm7,不应判失败)
    const compatible = (want) => {
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
    };
    const missing = ref.requiredChords.filter((c) => !compatible(c));
    if (missing.length) fails.push(`missing ${missing.join(',')}`);
  }
  if (ref.segmentCount && !(analysis.segments.length >= ref.segmentCount[0] && analysis.segments.length <= ref.segmentCount[1])) {
    fails.push(`segments ${analysis.segments.length}`);
  }
  return { fails, notes };
}

const refs = readdirSync(refDir).filter((f) => f.endsWith('.json')).sort();
const rows = [];
let noAnalysis = 0;
let wExact = 0;
let wRoot = 0;
let wTotal = 0;
let coarsePass = 0;
let coarseScored = 0;

for (const refFile of refs) {
  const name = basename(refFile, '.json');
  const ref = JSON.parse(readFileSync(join(refDir, refFile)));
  const analysisPath = join(analysisDir, name + '.json');
  if (!existsSync(analysisPath)) { noAnalysis++; continue; }
  const analysis = JSON.parse(readFileSync(analysisPath));
  const row = { name, title: ref.title || name };

  if (Array.isArray(ref.segments) && ref.segments.length) {
    const s = scoreSegments(analysis, ref);
    if (s) {
      row.fine = s;
      wExact += s.exact * s.seconds;
      wRoot += s.root * s.seconds;
      wTotal += s.seconds;
    }
  }
  const hasCoarse = ref.durationSeconds || ref.key || ref.bpm || ref.requiredChords || ref.segmentCount;
  if (hasCoarse) {
    coarseScored++;
    const { fails, notes } = checkCoarse(analysis, ref);
    row.fails = fails;
    row.notes = notes;
    if (!fails.length) coarsePass++;
  }
  rows.push(row);
}

if (!rows.length) {
  console.log(noAnalysis
    ? `No analysis JSONs matched any of the ${refs.length} reference(s). Run npm run analyze:batch first.`
    : `No references found in ${refDir}.`);
  process.exit(0);
}

console.log('per-song results:');
for (const r of rows) {
  const bits = [];
  if (r.fine) bits.push(`exact ${(r.fine.exact * 100).toFixed(1)}% · root ${(r.fine.root * 100).toFixed(1)}%`);
  if (r.fails) bits.push(r.fails.length ? `coarse FAIL (${r.fails.join('; ')})` : 'coarse pass');
  if (r.notes?.length) bits.push(`(${r.notes.join('; ')})`);
  console.log(`  ${r.name}: ${bits.join(' · ') || 'nothing to score'}`);
}
console.log('—'.repeat(20));
if (wTotal) {
  console.log(`overlap-weighted across ${wTotal.toFixed(0)}s of annotated audio:`);
  console.log(`  exact-match ${(100 * wExact / wTotal).toFixed(1)}% · root-match ${(100 * wRoot / wTotal).toFixed(1)}%`);
}
if (coarseScored) console.log(`coarse checks: ${coarsePass}/${coarseScored} songs pass`);
if (noAnalysis) console.log(`(${noAnalysis} reference(s) have no matching analysis yet)`);
