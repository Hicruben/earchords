// 批量分析:把真实歌曲目录里的音频全部跑一遍浏览器同款模型 + 和弦识别。
// 用法:npm run analyze:batch -- [音频目录] [输出目录]
//   默认 音频目录 = validation/real,输出目录 = validation/real_analysis
// 已存在的输出会跳过(可断点续跑);加 --force 重跑全部。
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { analyzeFile, getModel } from './lib_analyze.mjs';

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.opus']);
const args = process.argv.slice(2).filter((a) => a !== '--force');
const force = process.argv.includes('--force');
const inputDir = args[0] || 'validation/real';
const outputDir = args[1] || 'validation/real_analysis';

if (!existsSync(inputDir)) {
  mkdirSync(inputDir, { recursive: true });
  console.error(`Created ${inputDir} — drop song files (mp3/wav/m4a/flac/ogg) there and re-run.`);
  process.exit(0);
}
mkdirSync(outputDir, { recursive: true });

const files = readdirSync(inputDir)
  .filter((f) => AUDIO_EXT.has(extname(f).toLowerCase()))
  .sort();
if (!files.length) {
  console.error(`No audio files in ${inputDir}. Drop songs there and re-run.`);
  process.exit(0);
}

console.error(`Analyzing ${files.length} file(s) from ${inputDir} → ${outputDir}`);
const model = getModel();
let done = 0;
let failed = 0;
for (const file of files) {
  const out = join(outputDir, basename(file, extname(file)) + '.json');
  if (!force && existsSync(out)) {
    console.error(`skip  ${file} (already analyzed)`);
    continue;
  }
  try {
    // keepNotes:保存音符事件,之后改解码器可用 redecode.mjs 秒级重跑,不必重新推理
    const result = await analyzeFile(join(inputDir, file), { model, keepNotes: true });
    writeFileSync(out, JSON.stringify(result, null, 2));
    done++;
    console.error(`ok    ${file} — ${result.segments.length} segments, key ${result.key?.name || '?'}, ${result.tempo?.bpm || '?'} BPM`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${file}: ${err.message}`);
  }
}
console.error(`Batch complete: ${done} analyzed, ${failed} failed, ${files.length - done - failed} skipped.`);
