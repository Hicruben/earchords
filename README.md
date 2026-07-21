# ChordSnap

浏览器端的"从音频扒和弦"工具站。上传任意歌曲 → 本地跑 Basic Pitch 神经网络扒音符
→ 和弦识别 → 可跟弹的和弦谱(转调 / 变调夹 / 变速不变调 / 吉他·钢琴·尤克里里指法图)。
音频全程不离开用户设备,零服务器成本 —— 适合 AdSense / 订阅变现。

## 技术栈

- **Vite** + 原生 JS(无框架,构建产物为纯静态站,可部署到任何静态托管)
- **@spotify/basic-pitch**(+ TensorFlow.js):浏览器内音高检测,模型在 `public/model/`
- 和弦识别:自研 chroma 向量 + 余弦相似度模板匹配 + 时间维众数平滑(`src/chords.js`)
- 播放:`<audio preservesPitch>` 实现变速不变调;requestAnimationFrame 驱动和弦谱同步

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/,纯静态
npm run preview    # 本地预览生产构建
```

## 部署

`npm run build` 后把 `dist/` 整个目录传到任意静态托管(Cloudflare Pages / Vercel /
Netlify / 自己的 Nginx)。无后端、无数据库。注意 `dist/model/`(~0.9MB 模型)和
`dist/demo.wav` 必须一起上传。

## 功能

- 上传音频 → 和弦谱(浏览器内,音频不外传)
- **调性检测**(Krumhansl-Schmuckler)+ 调内先验提升准确率 + 按调升/降号拼写
- **速度检测**(自相关)+ **小节制专业和弦谱**(编号小节,4/行)
- 转调 / 变调夹 / 变速不变调(50%–100%)/ 跟随滚动
- 吉他·钢琴·尤克里里指法图,吉他/尤克**点击切换替代把位**(含横按绘制)
- **A-B 段落循环**(shift + 点两个小节)
- 键盘:`space` 播放、`←/→` 上/下一个和弦
- **导出**:复制文本谱 / 打印友好样式
- 明暗双主题、响应式

## 关键文件

- `src/chords.js` — 和弦识别核心(chroma 余弦匹配 + 调内先验 + 分段 + 转调)
- `src/music.js` — 调性检测(K-S)、速度估计、升降号拼写
- `src/audio.js` — 解码 22050Hz 单声道 + Basic Pitch 推理(按需 lazy-load)
- `src/diagrams.js` — 吉他/钢琴/尤克里里指法图(SVG,开放和弦手工校准 + 可移动横按兜底 + 替代把位)
- `src/main.js` — UI 编排、小节谱、播放、转调/变调夹/变速/循环/导出/主题
- `validation/` — 准确率验证脚本(Python,含装了 basic-pitch 的 .venv;和弦识别对照测试、A/B 听感验证音频合成)
- `seo-radar/` — 竞品 sitemap 监控脚本(选词领先指标)

工作目录:`~/Documents/anychord`

## 已知边界 / 下一步

- **准确率**:合成音频与清晰单乐器/弹唱录音准确率高;密集全混音流行歌较难(品类通病),
  会以 N.C. 或近似和弦呈现。上线前建议用真实歌曲做主观测试。
- **自动分段**:当前用"细窗识别 + 众数平滑 + 合并",非严格节拍对齐。可加节拍检测进一步提升。
- **SEO**:落地页已含 how-it-works / FAQ 支撑文本 + TDK + OG。下一步做多落地页
  (针对 "chords from audio / chord finder / 各乐器" 等新词变体)扩关键词覆盖。
- **变现**:接 AdSense 前用哥飞工具箱 73 项预检自查;工具页 RPM 偏低,可加 Pro(批量/导出)。
