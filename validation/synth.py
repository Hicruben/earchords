"""合成已知和弦的测试音频。

带谐波 + ADSR 衰减包络,比纯正弦更接近真实乐器音色(Basic Pitch 是在真实
乐器上训练的,纯正弦反而不像它见过的分布)。每个测试用例输出一个 WAV +
一份 ground truth(和弦序列 + 每个和弦的起止时间)。
"""
import json
import struct
import wave
from pathlib import Path

SR = 22050
CHORD_DUR = 2.0  # 每个和弦时长(秒)

# 音名 -> MIDI 音高(第 4 八度)
NOTE = {"C": 60, "C#": 61, "D": 62, "D#": 63, "E": 64, "F": 65,
        "F#": 66, "G": 67, "G#": 68, "A": 69, "A#": 70, "B": 71}

# 和弦类型 -> 相对根音的半音程
QUALITY = {
    "maj": [0, 4, 7], "min": [0, 3, 7], "dom7": [0, 4, 7, 10],
    "maj7": [0, 4, 7, 11], "min7": [0, 3, 7, 10],
}


def midi_to_freq(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def chord_midi(root, quality, octave=0, inversion=0):
    base = NOTE[root] + 12 * octave
    notes = [base + iv for iv in QUALITY[quality]]
    for _ in range(inversion):
        notes = notes[1:] + [notes[0] + 12]
    return notes


def render_note(freq, dur, sr=SR):
    import math
    n = int(dur * sr)
    out = [0.0] * n
    # 谐波:基频 + 前几次谐波,幅度递减(类似钢琴/吉他)
    harmonics = [(1, 1.0), (2, 0.5), (3, 0.3), (4, 0.15), (5, 0.08)]
    for k, amp in harmonics:
        f = freq * k
        if f > sr / 2:
            continue
        for i in range(n):
            out[i] += amp * math.sin(2 * math.pi * f * i / sr)
    # ADSR 简化:快起音 + 指数衰减
    for i in range(n):
        t = i / sr
        env = min(1.0, t / 0.01) * math.exp(-t * 1.5)
        out[i] *= env
    return out


def render_chord(midis, dur):
    voices = [render_note(midi_to_freq(m), dur) for m in midis]
    n = len(voices[0])
    mix = [sum(v[i] for v in voices) / len(voices) for i in range(n)]
    return mix


def write_wav(samples, path):
    peak = max(abs(s) for s in samples) or 1.0
    frames = b"".join(struct.pack("<h", int(max(-1, min(1, s / peak)) * 30000)) for s in samples)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(frames)


# 测试用例:(名称, [(根音, 类型, 八度偏移, 转位), ...])
CASES = {
    "01_basic_triads": [("C", "maj", 0, 0), ("A", "min", 0, 0), ("F", "maj", 0, 0), ("G", "maj", 0, 0)],
    "02_pop_progression": [("C", "maj", 0, 0), ("G", "maj", 0, 0), ("A", "min", 0, 0), ("F", "maj", 0, 0)],
    "03_sevenths": [("C", "maj7", 0, 0), ("D", "min7", 0, 0), ("G", "dom7", 0, 0), ("C", "maj7", 0, 0)],
    "04_inversions": [("C", "maj", 0, 1), ("F", "maj", 0, 2), ("G", "dom7", 0, 1), ("C", "maj", 0, 0)],
    "05_jazz_ii_v_i": [("D", "min7", 0, 0), ("G", "dom7", 0, 0), ("C", "maj7", 0, 0), ("A", "min7", 0, 0)],
}


def label(root, quality):
    q = {"maj": "", "min": "m", "dom7": "7", "maj7": "maj7", "min7": "m7"}[quality]
    return root + q


def main():
    out = Path(__file__).parent / "audio"
    out.mkdir(exist_ok=True)
    truth = {}
    for name, chords in CASES.items():
        samples = []
        segments = []
        t = 0.0
        for root, quality, octv, inv in chords:
            midis = chord_midi(root, quality, octv, inv)
            samples.extend(render_chord(midis, CHORD_DUR))
            segments.append({"start": round(t, 3), "end": round(t + CHORD_DUR, 3),
                             "label": label(root, quality),
                             "pitch_classes": sorted({m % 12 for m in midis})})
            t += CHORD_DUR
        write_wav(samples, out / f"{name}.wav")
        truth[name] = segments
        print(f"  {name}: {' '.join(s['label'] for s in segments)}")
    (Path(__file__).parent / "truth.json").write_text(json.dumps(truth, indent=2))
    print(f"写出 {len(CASES)} 个 WAV + truth.json")


if __name__ == "__main__":
    main()
