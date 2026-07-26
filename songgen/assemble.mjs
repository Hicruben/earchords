// 构建后装配:把 songgen/out/ 的静态 SEO 页接进 Vite 产物(dist/)。
// 每页写成 dist/<slug>/index.html —— 让 earchords.com/<slug> 这种干净 URL 直接命中,
// 无需服务器重写规则(Netlify / Vercel / Cloudflare Pages / GitHub Pages 通用)。
// 另生成 sitemap.xml + robots.txt 供搜索引擎收录。
// 用法:node songgen/assemble.mjs   (由 `npm run build` 在 vite build 之后自动调用)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { SITE } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const DIST = join(HERE, '..', 'dist');
const SRC = join(HERE, '..', 'src');

if (!existsSync(DIST)) {
  console.error('✗ dist/ 不存在 —— 先跑 `vite build`。');
  process.exit(1);
}

// 打包歌曲页互动脚本(含 chords/diagrams/chordplayer 依赖)。
// 用内容 hash 命名 -> 每次改逻辑上线自动破缓存(否则固定路径老用户会拿到旧 JS)。
mkdirSync(join(DIST, 'assets'), { recursive: true });
const built = await esbuild.build({
  entryPoints: [join(SRC, 'songpage.js')],
  bundle: true, format: 'esm', minify: true, target: 'es2020',
  write: false,
  logLevel: 'silent',
});
const bundleJs = built.outputFiles[0].contents;
const bundleHash = createHash('sha256').update(bundleJs).digest('hex').slice(0, 8);
const bundleName = `songpage-${bundleHash}.js`;
writeFileSync(join(DIST, 'assets', bundleName), bundleJs);
console.log(`✓ 打包 songpage -> dist/assets/${bundleName}`);

const pages = readdirSync(OUT).filter((f) => f.endsWith('.html'));
const slugs = [];
for (const file of pages) {
  const slug = file.replace(/\.html$/, '');
  const dir = join(DIST, slug);
  mkdirSync(dir, { recursive: true });
  const html = readFileSync(join(OUT, file), 'utf8')
    .replace('/assets/songpage.js', `/assets/${bundleName}`);
  writeFileSync(join(dir, 'index.html'), html);
  slugs.push(slug);
}

// sitemap:首页 + 两个工具页(高优先级)+ 歌曲页
const toolSlugs = new Set(['piano-chord-finder', 'chord-identifier']);
const urls = [
  { loc: `${SITE}/`, priority: '1.0', changefreq: 'weekly' },
  ...slugs.map((s) => ({
    loc: `${SITE}/${s}`,
    priority: toolSlugs.has(s) ? '0.8' : '0.7',
    changefreq: 'monthly',
  })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemap);

writeFileSync(
  join(DIST, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
);

console.log(`✓ 装配 ${slugs.length} 个静态页 -> dist/<slug>/index.html`);
console.log(`✓ sitemap.xml (${urls.length} URL) + robots.txt`);
