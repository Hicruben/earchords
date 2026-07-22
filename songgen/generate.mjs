// 手工列表模式:读 songgen/songs.json(带现成分析路径)-> 生成静态和弦页。
// 批量自动化见 pipeline.mjs(yt-dlp 抓音频 -> 引擎 -> 页)。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSongPage, cleanChart, SITE } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const songs = JSON.parse(readFileSync(join(HERE, 'songs.json'), 'utf8'));
for (const meta of songs) {
  const analysis = JSON.parse(readFileSync(resolve(HERE, meta.analysis), 'utf8'));
  writeFileSync(join(HERE, 'out', `${meta.slug}.html`), renderSongPage(meta, analysis));
  console.log(`✓ ${meta.slug}.html  (key ${analysis.key?.name}, ${cleanChart(analysis.segments, analysis.duration).main.length} chords)`);
}
console.log(`\n生成完成 -> songgen/out/  (URL 形如 ${SITE}/<slug>)`);
