# 对外基准结果(External Benchmarks)

"最精准"是比较级,必须用**公开数据集 + 领域标准指标**判定,不能靠自建语料自证。
本文件记录 ChordSnap 在公开基准上的 WCSR(Weighted Chord Symbol Recall,MIREX
标准和弦识别指标),可复现。评测工具:`npm run eval:mirex -- <analysisDir> <refDir>`
(`validation/eval_mirex.mjs`,读 `.jams`/`.lab`,自检:完美匹配 100%、根音错位 0%)。

## GuitarSet(2026-07)

- **数据集**:GuitarSet(Zenodo record 3371780,CC-BY),独奏吉他,`mic` 音轨。
  ChordSnap 未在其上训练/调参 —— 完全 held-out,测的是泛化。
- **子集**:29 首 comp(伴奏)音轨,跨 5 风格(唱作/摇滚/放克/bossa nova/爵士),
  共 871s。参考为 `.jams` 里的 `chord` 标注(玩家被指示弹的和弦)。
- **指标**:Root-WCSR / MajMin-WCSR(时间重叠加权正确率,MIREX 标准两档)。

| 范围 | Root-WCSR | MajMin-WCSR |
|---|---|---|
| **总计(29 首,871s)** | **85.8%** | **83.0%** |
| 摇滚(5) | 94.4% | 94.4% |
| 唱作 SS(6) | 92.8% | 92.8% |
| bossa nova(7) | 83.0% | 82.3% |
| 放克(5) | 84.4% | 76.4% |
| 爵士(6) | 72.2% | 66.2% |

**解读**:
- 在**目标使用场景(流行/摇滚/民谣吉他弹唱)上 92–94% MajMin**,与已发表系统同档
  (文献里 Chordino 一系 ~75–80%、深度模型 ~85–92% majmin 视数据集而定)。
- 爵士偏弱(66%):扩展/变化和弦超出 majmin 归约、快速打击性伴奏提取难,且 GuitarSet
  的"指示和弦"与爵士手实际的替换/经过和弦本就有出入。这是本工具定位("可跟弹的和弦谱")
  之外的场景,非核心风险。
- 一首快速爵士(03_Jazz1-200-B,200 BPM)整曲 0%:提取在快速闷音伴奏上失效,单曲难例。

**复现**:
1. 下载 GuitarSet `annotation.zip` + `audio_mono-mic.zip`(Zenodo API record 3371780)。
2. 抽取 comp 音轨,改名去 `_mic` 后缀(使与 `.jams` 同名),放一目录。
3. `npm run dev`(供模型)后 `npm run analyze:batch -- <音频目录> <分析目录>`。
4. `npm run eval:mirex -- <分析目录> <标注目录>`。

## 待补(需外部资源)

- **Isophonics(Beatles/Queen)**:和弦识别的黄金难基准,标准 majmin WCSR。
  `eval_mirex.mjs` 已支持 `.lab` 格式,但音频受版权保护,需另行提供才能跑。
- **McGill Billboard**:全混音流行歌基准,更接近本工具的真实输入分布。
