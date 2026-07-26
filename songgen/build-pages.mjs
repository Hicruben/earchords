// 从保存的分析结果重新渲染所有歌曲页(不重新推理)。
// 数据源:songgen/analysis/<slug>.json = { meta, analysis }
// 改模板(render.mjs)后跑这个即可秒级重生成所有页;再 `npm run build` 打包上线。
// 用法:node songgen/build-pages.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSongPage } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ANALYSIS = join(HERE, 'analysis');
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

if (!existsSync(ANALYSIS)) {
  console.error('✗ songgen/analysis/ 不存在。先跑 pipeline(会保存分析),或手动放入 <slug>.json');
  process.exit(1);
}

const files = readdirSync(ANALYSIS).filter((f) => f.endsWith('.json'));
let n = 0;
for (const f of files) {
  const { meta, analysis } = JSON.parse(readFileSync(join(ANALYSIS, f), 'utf8'));
  writeFileSync(join(OUT, `${meta.slug}.html`), renderSongPage(meta, analysis));
  n++;
  console.log(`✓ ${meta.slug}.html`);
}
console.log(`\n重渲染 ${n} 页 -> songgen/out/`);
