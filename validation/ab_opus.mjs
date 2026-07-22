// A/B:对同一首歌,"直接解析(=上传路径)" vs "opus 转码后解析(=抓取播放音频的压缩步骤)"
// 算两条路解析出的和弦逐段一致率,量化"抓取播放音频 是否 = 上传"。
import { analyzeFile, getModel } from './lib_analyze.mjs';
import { chordByLabel } from '../src/chords.js';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const dir = process.argv[2];
const tmp = process.argv[3] || '/tmp/ab_opus';
spawnSync('mkdir', ['-p', tmp]);
const PC = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
const rootOf = (l) => { const m=/^([A-G][#b]?)/.exec(l||''); return m?PC[m[1]]:null; };

// opus 转码(matches MediaRecorder: webm/opus ~128k)
function toOpus(input, out) {
  const r = spawnSync('ffmpeg', ['-y','-v','error','-i',input,'-c:a','libopus','-b:a','128k',out], { maxBuffer: 1<<26 });
  if (r.status !== 0) throw new Error(r.stderr?.toString() || 'ffmpeg opus failed');
}
// 以 A(直接)为参照,B(opus)时间重叠加权的一致率
function agree(a, b) {
  let total=0, exact=0, root=0;
  for (const sa of a) {
    if (!sa.label) continue;
    const dur = sa.end - sa.start; if (dur<=0) continue; total += dur;
    for (const sb of b) {
      const ov = Math.min(sa.end, sb.end) - Math.max(sa.start, sb.start);
      if (ov <= 0) continue;
      if (sb.label === sa.label) exact += ov;
      if (sb.label && rootOf(sb.label) === rootOf(sa.label)) root += ov;
    }
  }
  return { exact: total?exact/total:0, root: total?root/total:0, seconds: total };
}

const model = getModel();
const files = readdirSync(dir).filter(f => /\.(wav|mp3|flac|m4a)$/i.test(f)).sort();
let wE=0, wR=0, wT=0;
console.log('逐首:直接 vs opus 的和弦一致率(以直接解析为参照)');
for (const f of files) {
  const name = basename(f).replace(/\.[^.]+$/,'');
  const orig = join(dir, f);
  const opus = join(tmp, name + '.webm');
  toOpus(orig, opus);
  const A = await analyzeFile(orig, { model });   // 直接(上传路径)
  const B = await analyzeFile(opus, { model });   // opus(抓取路径的压缩步骤)
  const s = agree(A.segments, B.segments);
  wE += s.exact*s.seconds; wR += s.root*s.seconds; wT += s.seconds;
  console.log(`  ${name}: exact ${(s.exact*100).toFixed(1)}%  root ${(s.root*100).toFixed(1)}%  (keyA ${A.key?.name||'?'} / keyB ${B.key?.name||'?'}, ${s.seconds.toFixed(0)}s)`);
}
console.log('—'.repeat(20));
console.log(`加权总(${wT.toFixed(0)}s): exact ${(100*wE/wT).toFixed(1)}%  ·  root ${(100*wR/wT).toFixed(1)}%`);
console.log('(exact=完全同名和弦, root=根音相同; 越接近 100% 表示 opus 压缩越不影响扒谱)');
