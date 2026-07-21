# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

本仓库的权威指南是 `AGENTS.md`(项目概览、架构、全部命令、validation 用法、代码风格、提交前检查清单),完整内容如下导入,修改仓库约定时改 `AGENTS.md` 即可,不要在两处重复维护:

@AGENTS.md

## 对 Claude 最重要的几条(摘要,详情见上)

- **识别准确率是核心风险**:改 `src/chords.js` / `src/music.js` / `src/audio.js` 的识别逻辑后,必须跑验证并报告准确率前后对比。快速迭代路径:改解码逻辑 → `npm run redecode`(对已存 notes 重跑 detectChords,秒级)→ `npm run score:batch`;合成 fixtures 用 `validation/.venv/bin/python validation/evaluate.py`。
- `npm run analyze` / `analyze:batch` 需要模型服务在跑(通常 `npm run dev`;`vite preview` 只绑 IPv6,4173 端口要用 `localhost` 而非 `127.0.0.1`)。
- Python 一律用 `validation/.venv/bin/python`(系统 python3 没装 basic-pitch);pip 用 `validation/.venv/bin/python -m pip`(pip 脚本 shebang 是旧路径)。
- `dist/` 是构建产物,不要手改;无 vite.config、无 linter/formatter,改动保持与周边代码一致,不要顺手格式化。
- 隐私红线:不引入任何把用户音频发出设备的代码。
