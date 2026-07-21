# 交叉验证:用 librosa 独立实现经典 CQT-chroma + HMM 管线识别真实歌曲,
# 与 ChordSnap 的分析结果(validation/real_analysis/*.json)做时间轴对照。
# 前端完全不同(librosa 直接从音频算 CQT chroma,Chordsnap 走 Basic Pitch
# 神经转录),解码各自独立 —— 两边一致的部分可视为高置信,不一致的列出供排查。
# 用法:validation/.venv/bin/python validation/cross_check.py [歌曲名前缀]
import json
import sys
from pathlib import Path

import numpy as np
import librosa
from scipy.ndimage import median_filter

ROOT = Path(__file__).parent
REAL = ROOT / "real"
ANALYSIS = ROOT / "real_analysis"

SR = 22050
HOP = 512
GRID = 0.1  # 对照时间分辨率(秒)

PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
      "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}

MAJ_QUALITIES = {"", "7", "maj7", "6", "add9"}
MIN_QUALITIES = {"m", "m7", "m6"}

# 24 个 maj/min 二值模板 + N.C.(索引 24)
TEMPLATES = []
for root in range(12):
    TEMPLATES.append((root, "maj", {root % 12, (root + 4) % 12, (root + 7) % 12}))
for root in range(12):
    TEMPLATES.append((root, "min", {root % 12, (root + 3) % 12, (root + 7) % 12}))
NC = 24
FIFTH_W = [1.0, 0.55, 0.3, 0.16, 0.09, 0.05, 0.04]


def build_templates_matrix():
    m = np.zeros((24, 12))  # 24 个 maj/min 模板(N.C. 无模板,发射分单独给)
    for i, (_, _, pcs) in enumerate(TEMPLATES):
        for pc in pcs:
            m[i, pc] = 1.0
    return m


def fifth_distance(r1, r2):
    d = ((r2 - r1) * 7) % 12
    return min(d, 12 - d)


def build_transitions(p_stay=0.9):
    roots = [t[0] for t in TEMPLATES] + [None]
    quals = [t[1] for t in TEMPLATES] + [None]
    m = np.zeros((25, 25))
    for a in range(25):
        for b in range(25):
            if a == b:
                m[a, b] = p_stay
            elif a == NC or b == NC:
                m[a, b] = (1 - p_stay) * 0.25
            else:
                w = FIFTH_W[fifth_distance(roots[a], roots[b])]
                if quals[a] == quals[b]:
                    w *= 1.5
                m[a, b] = (1 - p_stay) * 0.75 * w
        m[a] /= m[a].sum()
    return np.log(m)


def librosa_chords(path, duration):
    """返回 GRID 网格上的 (root, 'maj'|'min') 或 None —— 完全独立的实现"""
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    chroma = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP, bins_per_octave=36)
    chroma = median_filter(chroma, size=(1, 7))  # 时间维中值滤波去毛刺
    tmpl = build_templates_matrix()
    # 发射:余弦相似度(log 域);N.C. 与能量挂钩
    norm = np.linalg.norm(chroma, axis=0) + 1e-9
    tn = np.linalg.norm(tmpl, axis=1) + 1e-9
    sim = (tmpl @ chroma) / np.outer(tn, norm)  # 24 x T
    energy = np.clip(norm / np.median(norm[norm > 1e-6]), 0, 3)
    emit = np.vstack([6.0 * (sim - 0.55), np.full(sim.shape[1], -1.5) - 2.0 * energy])  # 25 x T
    log_t = build_transitions()
    # Viterbi
    T = emit.shape[1]
    dp = emit[:, 0].copy()
    back = np.zeros((T, 25), dtype=np.int8)
    for t in range(1, T):
        cand = dp[:, None] + log_t  # 25 x 25
        back[t] = np.argmax(cand, axis=0)
        dp = cand.max(axis=0) + emit[:, t]
    path = np.zeros(T, dtype=np.int8)
    path[-1] = int(np.argmax(dp))
    for t in range(T - 2, -1, -1):
        path[t] = back[t + 1, path[t + 1]]
    # 映射到 GRID 网格
    n = int(duration / GRID) + 1
    out = [None] * n
    times = librosa.frames_to_time(np.arange(T), sr=SR, hop_length=HOP)
    for i, st in enumerate(path):
        gi = int(times[i] / GRID)
        if gi < n:
            out[gi] = None if st == NC else (TEMPLATES[st][0], TEMPLATES[st][1])
    return out


def parse_ours(label):
    if not label:
        return None
    if len(label) > 1 and label[1] in "#b":
        name, q = label[:2], label[2:]
    else:
        name, q = label[0], label[1:]
    if q in MAJ_QUALITIES:
        return (PC[name], "maj")
    if q in MIN_QUALITIES:
        return (PC[name], "min")
    return None  # sus/dim/aug 不参与 majmin 对照


def ours_grid(analysis, duration):
    n = int(duration / GRID) + 1
    out = [None] * n
    for s in analysis["segments"]:
        parsed = parse_ours(s.get("label"))
        for gi in range(int(s["start"] / GRID), min(n, int(s["end"] / GRID) + 1)):
            out[gi] = parsed
    return out


def compare(name, audio_path, show_diff=False):
    analysis_path = ANALYSIS / (name + ".json")
    if not analysis_path.exists():
        return None
    analysis = json.loads(analysis_path.read_text())
    duration = analysis["duration"]
    a = ours_grid(analysis, duration)
    b = librosa_chords(audio_path, duration)
    total = root_ok = majmin_ok = 0
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    fmt = lambda v: "N.C." if v is None else names[v[0]] + ("m" if v[1] == "min" else "")
    # 收集不一致的连续段
    diffs = []
    cur = None
    for i, (x, y) in enumerate(zip(a, b)):
        same = (x is not None and y is not None and x[0] == y[0])
        if same:
            if cur:
                diffs.append(cur)
                cur = None
            continue
        if cur is None:
            cur = [i, i, x, y]
        else:
            cur[1] = i
    if cur:
        diffs.append(cur)
    for x, y in zip(a, b):
        if x is None or y is None:
            continue
        total += 1
        if x[0] == y[0]:
            root_ok += 1
            if x[1] == y[1]:
                majmin_ok += 1
    if show_diff:
        diffs.sort(key=lambda d: d[1] - d[0], reverse=True)
        for d in diffs[:4]:
            dur = (d[1] - d[0] + 1) * GRID
            if dur >= 2:
                print(f"    不一致 {d[0]*GRID:6.1f}s–{d[1]*GRID:6.1f}s ({dur:4.1f}s): 我们={fmt(d[2])} vs 参考={fmt(d[3])}")
    if not total:
        return None
    return root_ok / total, majmin_ok / total, total * GRID


def main():
    prefix = sys.argv[1] if len(sys.argv) > 1 else ""
    rows = []
    for audio in sorted(REAL.iterdir()):
        if audio.suffix.lower() not in (".mp3", ".flac", ".wav", ".m4a"):
            continue
        name = audio.stem
        if prefix and not name.startswith(prefix):
            continue
        r = compare(name, audio, show_diff=bool(prefix))
        if r:
            rows.append((name, *r))
            print(f"{name}: root一致 {r[0]*100:.1f}% · majmin一致 {r[1]*100:.1f}% (对照 {r[2]:.0f}s)", flush=True)
    if rows:
        w = sum(r[3] for r in rows)
        print("—" * 20)
        print(f"加权一致率:root {sum(r[1]*r[3] for r in rows)/w*100:.1f}% · "
              f"majmin {sum(r[2]*r[3] for r in rows)/w*100:.1f}% ({len(rows)} 首)")


if __name__ == "__main__":
    main()
