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
| **总计(29 首,871s)** | **86.6%** | **83.3%** |
| 摇滚(5) | 94.4% | 94.4% |
| 唱作 SS(6) | 92.8% | 92.8% |
| bossa nova(7) | 83.0% | 82.3% |
| 放克(5) | 84.4% | 76.4% |
| 爵士(6) | 72.2% | 66.2% |

> 数字为分析窗宽 `win=0.65s`(用本数据集 + 合成精确真值 + 真实语料三方共同校准的
> 泛化增益,较旧的 1.0s 三者一致提升)后的结果。

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

## 提取前端对比(2026-07,重要负结果)

误差归因显示 GuitarSet 上主误差是**根音混淆 14.2%**(下属/属/关系调),性质错仅
2.1%(属七校准已解决)。为验证"换更好的提取前端能否突破",在同一 29 首上跑了
经典**频谱 CQT-chroma 前端**(cross_check.py 的 librosa 独立实现,Chordino 一系的
经典 DSP 路线):

| 提取前端 | GuitarSet MajMin-WCSR |
|---|---|
| **Basic Pitch 神经音符转录(现管线)** | **83.3%** |
| librosa CQT-chroma(经典 DSP) | 60.2% |
| Basic Pitch 原始逐帧激活直接建 chroma | 46.2%*(*per-window 无 Viterbi 对比,音符 chroma 同法 65.8%) |

第二条负结果:跳过音符检测、直接用神经网络的连续逐帧 pitch 激活建 chroma 反而
**更差**(46.2% vs 音符 65.8%)——原始激活含谐波/部分激活/噪声,Basic Pitch 的
音符检测(阈值+分组)是有价值的去噪。**"音符→chroma"是现管线的优势,不是信息损失。**

**结论:现有 Basic Pitch 提取已显著优于经典 DSP 频谱前端,不是短板。** 因此
HPSS / CQT-chroma 这类经典前端替换**不是**提高准度的路子(会更差)。剩余根音混淆
是"已强于经典方法"之后的硬残差,冲深度学习 SOTA(85–92%)需**紧凑的神经和弦
模型**(CNN/Transformer 直接从音频出和弦)——这与"浏览器端、无后端、隐私优先"的
架构有根本张力(需可在浏览器内跑的小模型 + 训练数据),是重大架构决策,非参数或
经典 DSP 可达。已排除的廉价/经典路子:extBonus、窗宽(两者是真增益)、bassEmphasis、
EMIT_GAIN、hop、调内先验、CQT 前端、逐帧激活 chroma。

**已用实测穷尽所有可自主验证的替代提取/表示路径,现管线在其架构内已近最优。**
冲深度 SOTA(85–92%)只剩一条路:**训练一个紧凑神经和弦模型**(像 Basic Pitch
那样 ~1MB、TF.js 浏览器内跑、音频不出设备,故不破坏隐私/无后端架构),用
GuitarSet/Isophonics/Billboard 的和弦标注训练。这是一次真实的 ML 投入(训练数据 +
管线 + 转 TF.js 集成),非参数或 DSP 可达,需维护者决策启动。

## 待补(需外部资源)

- **Isophonics(Beatles/Queen)**:和弦识别的黄金难基准,标准 majmin WCSR。
  `eval_mirex.mjs` 已支持 `.lab` 格式,但音频受版权保护,需另行提供才能跑。
- **McGill Billboard**:全混音流行歌基准,更接近本工具的真实输入分布。
