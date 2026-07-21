# ChordSnap 仓库指南

## 项目概览

ChordSnap 是一个纯浏览器端的"从音频扒和弦"工具站:用户上传任意歌曲,在本地用
Spotify Basic Pitch 神经网络扒出音符事件,再做和弦识别,生成可跟弹的和弦谱。
支持转调、变调夹、变速不变调(50%–100%)、吉他/钢琴/尤克里里指法图、A-B 段落
循环、导出文本谱、明暗双主题。音频全程不离开用户设备,无后端、无数据库,构建
产物是纯静态站,可部署到任意静态托管。落地页 UI 文案为英文(`index.html`
`lang="en"`,含 SEO 用 TDK / OG / how-it-works / FAQ),代码注释以中文为主。

## 技术栈与运行时架构

- **Vite 5 + 浏览器原生 ES modules**,无前端框架。入口 `index.html` → `src/main.js`。
- **@spotify/basic-pitch ^1.0.1 + @tensorflow/tfjs ^3.21.0**:浏览器内音高检测。
  模型静态资源在 `public/model/`(`model.json` + `group1-shard1of1.bin`,约 0.9MB),
  按需 lazy-load(首次分析时才加载,见 `src/audio.js` 的 `getModel()`)。
- **和弦识别为自研**:chroma 向量 + 余弦相似度模板匹配 + 调内先验 + 最低音根音
  证据 + 扩展音证据,再经 **HMM/Viterbi 全局最优序列解码**(145 状态:12 根音 ×
  12 性质 + N.C.,自环 + 五度圈转移先验)输出和弦路径(`src/chords.js`)。
  模板打分逻辑移植自已验证的 Python 版;Viterbi 解码是 2026-07 的架构升级,
  替代了原先的时间维众数平滑(fixtures 加权精确匹配 85.0% → 97.5%)。
- 播放用 `<audio preservesPitch>` 实现变速不变调;requestAnimationFrame 驱动
  和弦谱同步与波形/频谱可视化。

## 目录结构与模块划分

- `index.html` — 单页入口(上传视图、和弦谱视图、SEO 支撑文本)。
- `src/main.js`(~940 行)— UI 编排:上传/分析流程、编号小节和弦谱、播放控制、
  转调/变调夹/变速/A-B 循环/导出/主题切换。
- `src/audio.js` — 音频管线:任意格式解码 → `OfflineAudioContext` 重采样为
  22050Hz 单声道 → Basic Pitch 推理(onset 阈值 0.5、frame 阈值 0.3、最短音符
  约 11 帧)。导出 `analyzeFile(file, onStage)`,返回 `{notes, duration, peaks}`。
- `src/chords.js` — 和弦识别核心:12 根音 × 12 种性质的模板库(`QUALITIES`)、
  窗口 chroma 聚合(时长×振幅加权、低音区加权、最低音 bassPc 提取)、
  `scoreAllChords` 余弦匹配 + 根音强调 + 低音根音证据 + 扩展音证据 + 常见和弦
  先验 + 调内先验、`detectChords`(细窗逐格打分 → **Viterbi 解码** → 合并 →
  吸收碎段 → 装饰音变体吸收)、`transposeLabel`。调试可用 `debugWindow`
  (查看任意时间窗的候选和弦得分)。
- `src/music.js` — 乐理:Krumhansl-Schmuckler 调性检测、自相关速度估计、
  按调选择升/降号拼写(`SHARP`/`FLAT`)。
- `src/diagrams.js` — 指法图 SVG:钢琴完全由音程计算;吉他/尤克里里用可移动
  把位形状计算(开放和弦手工校准 + 横按兜底 + 点击切换替代把位),配色走 CSS
  变量自适应明暗主题。
- `src/chordplayer.js` — Web Audio 合成"跟弹和弦"(柔和电钢/pad 音色),让用户
  靠听觉校验识别结果。
- `src/visuals.js` — 发光播放头波形进度条 + 频谱柱可视化(canvas,读 CSS 变量)。
- `src/ambient.js` — 全屏环境动效(波场 hero / CTA 波形 / 扫描转盘),遵守
  `prefers-reduced-motion`。
- `src/style.css` + `src/premium.css` — 全局样式,均由 `main.js` 顶部 import。
- `public/` — 模型文件与 `demo.wav` 演示音频;Vite 构建时原样拷入 `dist/`。
- `dist/` — 构建产物,**不要手改**(`dist/assets/` 为 Vite 生成)。
- `validation/` — 准确率验证与 fixtures(见下)。
- `seo-radar/` — 独立的竞品 sitemap 监控脚本(见下)。
- 无 `vite.config.js`(全部用 Vite 默认配置),无 linter / formatter 配置。

## 构建、开发与测试命令

```bash
npm install              # 安装锁定的 JS 依赖
npm run dev              # Vite 开发服务器,http://localhost:5173
npm run build            # 生产构建到 dist/(纯静态)
npm run preview          # 本地预览生产构建
npm test                 # node --test validation/*.test.mjs(JS 乐理/识别回归)
npm run analyze -- <audio> [output.json]
                         # 用浏览器同款模型在 Node 中分析真实音频;
                         # 需先保持 npm run dev 运行(脚本默认从
                         # http://127.0.0.1:5173/model/model.json 拉模型,
                         # 可用环境变量 CHORDSNAP_MODEL_URL 覆盖)
npm run verify:reference -- <analysis.json> [reference.json]
                         # 把 analyze 结果与 validation/references/ 下的
                         # 参考标注(默认 ni-buzhidao.json)做对照
npm run analyze:batch -- [音频目录] [输出目录]
                         # 批量分析真实歌曲(默认 validation/real →
                         # validation/real_analysis,已分析的自动跳过,--force 重跑);
                         # 同样需要模型服务(见上,4173 端口注意用 localhost 而非
                         # 127.0.0.1,vite preview 只绑 IPv6)
npm run score:batch -- [分析目录] [标注目录]
                         # 批量评分:分析结果对照 validation/references/ 下同名
                         # <歌名>.json 标注;支持粗粒度字段(durationSeconds/key/bpm/
                         # requiredChords/segmentCount)与细粒度 segments 时间轴,
                         # 输出逐首结果 + 时间重叠加权的 exact/root 匹配率。
                         # 等价规则:调性接受关系大小调;requiredChords 接受 MIREX
                         # 规则(共享 ≥3 音级,如谱面 Gm 对录音 Gm7)
npm run redecode -- [分析目录]
                         # 对已保存 notes 的分析 JSON 重跑 detectChords(不重新
                         # 推理);改 chords.js 解码逻辑后用它秒级迭代再 score:batch
validation/.venv/bin/python validation/evaluate.py
                         # 用 Python Basic Pitch 对 validation/audio/*.wav 跑
                         # 和弦识别,对照 validation/truth.json 输出精确匹配率
                         # 与音级召回率(需用自带 .venv,里面装了 basic-pitch;
                         # 系统 python3 没装)
python3 seo-radar/radar.py --report
                         # 汇总最近 7 天竞品 sitemap 新增(仅标准库,Python 3.9+)
```

## 验证(validation/)目录

识别准确率是这个项目的核心风险,改动 `src/chords.js` / `src/music.js` /
`src/audio.js` 的识别逻辑后必须跑验证并报告准确率变化:

- `music.test.mjs` — Node 内置 test runner 的 JS 回归测试(`npm test`),覆盖
  `matchChroma`、`detectKey`、`estimateTempo`、`detectChords`。
- `synth.py` — 合成带谐波 + ADSR 包络的测试音频(纯正弦不像 Basic Pitch 见过
  的分布),输出 WAV + ground truth。
- `audio/` + `truth.json` — 5 组合成 fixtures(基础三和弦、流行进行、七和弦、
  转位、爵士 ii-V-I)及逐段标准答案。`evaluate.py` 用已知时间分段评分,隔离
  "分段检测"这一独立风险,只测和弦识别本身。
- `make_songs.py` + `songs_manifest.json` + `songs/` — 带完整伴奏(贝斯+和弦+
  旋律)的整曲合成与标准答案。
- **`synth.test.mjs` + `synth_analysis/` + `synth_references/` — 端到端逐小节精度
  回归网(接入 `npm test`,精度的第一道防线)**。`songs/` 顶层 4 首合成整曲
  (pop_axis / canon_d / doowop_50s / blues_a)有 manifest 精确时间轴真值,
  `synth_references/` 由其转成 `segments`,`synth_analysis/` 是保留 notes 的分析
  结果。测试对 notes 重跑 `detectChords` 算时间重叠加权 exact-match,per-song +
  加权下限断言。**改 `chords.js` 识别参数必须先跑 `npm test` 看这条**:它抓得到
  合成 fixtures / 真实粗检抓不到的性质错(如属七被压成三和弦)。当前基线:
  blues_a 62%、pop/canon/doo-wop 92-94%、加权 82.9%。迭代循环:改 `chords.js` →
  `npm run redecode -- validation/synth_analysis` → `npm run score:batch --
  validation/synth_analysis validation/synth_references`。
  **精度路线图(2026-07 探明)**:合成曲残余 ~7% 误差是**边界时序**(固定 0.25s
  hop 的滞后),标签本身对。已排除的廉价路子:调内先验是承重墙(削它会按下葫芦
  浮起瓢)、细化 hop 与 `P_STAY` 耦合反而更差。**下一个高杠杆是 beat-synchronous
  解码**:`music.js` 新增并测试了 `estimateBeats`(梳状滤波求节拍相位,合成曲
  <16ms 恢复网格)。原型验证:把和弦边界吸附到**小节线/强拍**(非每一拍)在合成
  精确真值上是干净的 **+5.2(82.9%→88.1%)**;吸到每一拍只有 +1.3 且伤部分歌
  (会吸到 offbeat)。**尚未接入生产解码器**——真实歌有前奏/散拍/速度漂移且强拍
  相位未知,而边界时序无法用现有粗检验证,需先有细粒度真实真值(见 `seed:reference`
  脚手架)才能确认不倒退。这是通往"最准"的下一个大动作,但需要真实细粒度标注解锁。
- `make_demo.py` / `make_xingxing_demo.py` / `mix_verify.py` — 生成 demo 音频与
  A/B 听感验证音频(`demo3/`、`verify/`)。注意 `mix_verify.py`、`extract_all.py`
  是历史一次性脚本,里面硬编码了 `/private/tmp/...` 绝对路径,不能直接在别处运行。
- `extract_notes.py` / `extract_all.py` — 用 Python basic-pitch 抽音符事件。
- `references/ni-buzhidao.json` — 真实歌曲的人工参考标注,配合
  `verify:reference` 使用。
- `lib_analyze.mjs` — 共享分析管线(ffmpeg 解码 → Basic Pitch → detectChords),
  `analyze_song.mjs` 与 `batch_analyze.mjs` 都走它,改识别参数只需改一处。
- `real/` + `real_analysis/` — 真实歌曲语料与批量分析输出(歌曲文件不入库)。
  每首歌的标注放 `references/<音频文件名去扩展名>.json`,`score:batch` 按文件名
  配对;`segments` 字段(细粒度时间轴)用于算准确率,粗粒度字段用于结构校验。
- `.venv/` 是本地 Python 虚拟环境(装了 basic-pitch),**不要提交**。
  pip 脚本的 shebang 指向旧路径(`/Users/jerry/chord-demo/...`),调用一律用
  `validation/.venv/bin/python -m pip`(python 本体正常)。
- `cross_check.py` — 零人工标注的交叉验证:venv 里的 librosa 独立实现
  CQT-chroma + HMM(与产品前端完全独立),对照 `real_analysis/` 输出两边
  时间轴一致率;`python validation/cross_check.py [歌名前缀]`,带前缀时
  打印最长的若干不一致段。该参考系统在干净合成音频上对真值 96%,可作
  可信第二意见。注:madmom 与 py3.11 不兼容(装不上);essentia 的
  NNLSChroma 封装有坑(chroma 输出全零),均勿再浪费时间。
  **重要教训(2026-07):cross_check 在真实全混音上太吵,不能当调优标尺**——
  librosa 自身在密集流行歌上会大幅出错(如"小酒窝"模型对上公开乐谱、librosa 却
  判成整首错,一致率仅 2.9%),拿它调参会把模型往 librosa 的噪声带偏。真实歌的
  可靠真值是公开乐谱(人工 `references`);合成整曲/fixtures 才是可信精度标尺。
- **参考真值的 concert-key 纪律**:模型从音频听到的是**实际发声音高**,不是乐谱
  上的 capo 手型。建真实歌 `references` 时,凡带变调夹的原声歌必须把和弦/调性
  转成 concert pitch,并用升号拼写(`PC_NAME`)。别信单一乐谱站的 capo 标注——
  用 Hooktheory/SongBPM 等按音频分析的源交叉确认(例:Let Her Go 实际发声是
  G 大调不是 D)。错的参考比没有更糟,会污染验证。英文歌参考的 `_source` 字段
  注明了来源与核对时间。

已知边界:合成音频与清晰弹唱录音准确率高;密集全混音流行歌较难(品类通病),
会以 N.C. 或近似和弦呈现。自动分段是"细窗识别 + 众数平滑 + 合并",非严格节拍
对齐。

## seo-radar(独立子项目)

监控竞品站 sitemap 的新增 URL(竞品新增页面 = 刚验证过的新词,是零成本选词
领先指标)。只依赖 Python 3.9+ 标准库。`sites.txt` 一行一个 `名称=sitemap地址`;
每个站的已知 URL 快照存 `state/*.json`;新增写入 `reports/YYYY-MM-DD.md` 并打印。
首次运行只建基线,第二次起才有 diff。部署方式:整目录 `scp` 到服务器加 crontab
每天跑(见 `seo-radar/README.md`)。

## 代码风格约定

- JavaScript:两空格缩进、分号、单引号、`camelCase` 函数/变量、`UPPER_SNAKE_CASE`
  常量。模块保持单一职责,可复用的乐理逻辑用具名导出。注释以中文为主,保留
  现有的中英双语注释(尤其解释乐理行为的)。
- Python:四空格缩进、`snake_case`、`UPPER_SNAKE_CASE` 模块常量。
- 无 formatter / linter;改动保持与周边代码一致,不要做顺手格式化。
- 提交信息:短祈使句、带明确范围(如 `fix: preserve chord timing during
  transpose`);此仓库无历史 git 约定可循。

## 提交前检查清单

1. `npm run build` 通过。
2. `npm test` 全绿。
3. `npm run preview` 里实测上传/demo 播放,以及受影响的控件(转调、变调夹、
   变速、A-B 循环、指法图)。
4. 识别逻辑变更:跑 `evaluate.py` / `verify:reference`,在 PR 中报告准确率前后对比。
5. UI 变更:附截图。
6. 不要提交:`.venv/`、`.DS_Store`、`node_modules/`、`dist/`、任何密钥。

## 部署

`npm run build` 后把 `dist/` 整个目录传到任意静态托管(Cloudflare Pages /
Vercel / Netlify / 自有 Nginx)。无后端、无数据库。注意 `dist/model/`(约 0.9MB
模型)和 `dist/demo.wav` 必须一起上传,否则首次分析和 demo 按钮会失败。

## 安全与隐私

- 核心卖点是隐私:音频解码与推理全部在浏览器内完成,不引入任何把用户音频
  发出设备的代码(无上传 API、无分析埋点收集音频)。
- 依赖很少(仅 basic-pitch / tfjs / vite),新增依赖前先确认确有必要。
- 仓库不含任何密钥;不要提交凭证、`.env` 类文件。
