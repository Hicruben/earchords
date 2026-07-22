"""合成 4 段带完整伴奏(贝斯+和弦+旋律)的测试曲,均为流行歌常用进行。
每段一个已知的和弦序列(ground truth),用于客观验证 EarChords。
"""
import math, struct, wave, json, random
from pathlib import Path

SR = 22050
BEAT = 0.5          # 120 BPM
BEATS_PER_BAR = 4
random.seed(42)

QUAL = {'maj': [0, 4, 7], 'min': [0, 3, 7], 'dom7': [0, 4, 7, 10]}
# 和弦名 -> (根音音级, 类型)
CHORDS = {
    'C': (0, 'maj'), 'D': (2, 'maj'), 'E': (4, 'maj'), 'F': (5, 'maj'), 'G': (7, 'maj'), 'A': (9, 'maj'),
    'Am': (9, 'min'), 'Bm': (11, 'min'), 'F#m': (6, 'min'), 'Em': (4, 'min'), 'Dm': (2, 'min'),
    'A7': (9, 'dom7'), 'D7': (2, 'dom7'), 'E7': (4, 'dom7'), 'G7': (7, 'dom7'),
}

def freq(midi): return 440.0 * 2 ** ((midi - 69) / 12)

def render(midi, dur, amp, decay):
    n = int(dur * SR); out = [0.0] * n
    f0 = freq(midi)
    for k, a in [(1, 1.0), (2, 0.5), (3, 0.3), (4, 0.15), (5, 0.08)]:
        f = f0 * k
        if f > SR / 2: continue
        for i in range(n): out[i] += a * math.sin(2 * math.pi * f * i / SR)
    for i in range(n):
        t = i / SR
        out[i] *= amp * min(1.0, t / 0.006) * math.exp(-t * decay)
    return out

def add(buf, samples, at):
    start = int(at * SR)
    for i, s in enumerate(samples):
        j = start + i
        if j < len(buf): buf[j] += s

def chord_notes(name, octave):
    root_pc, q = CHORDS[name]
    return [root_pc + 12 * octave + iv for iv in QUAL[q]]

def make_song(prog, path):
    total = len(prog) * BEATS_PER_BAR * BEAT
    buf = [0.0] * int(total * SR + SR)
    truth = []
    t = 0.0
    for name in prog:
        bar_start = t
        root_pc, q = CHORDS[name]
        tones = chord_notes(name, 4)          # 和弦音(C4 区)
        bass = root_pc + 12 * 2               # 贝斯(C2 区)
        melody_pool = [n + 12 for n in tones] + [tones[0] + 24]  # 旋律(高八度)
        for beat in range(BEATS_PER_BAR):
            bt = t + beat * BEAT
            # 贝斯:每拍一下(1、3 拍重)
            add(buf, render(bass, BEAT * 0.95, 0.55 if beat % 2 == 0 else 0.4, 3.0), bt)
            # 和弦:整拍块和弦(所有和弦音一起)
            for m in tones:
                add(buf, render(m, BEAT * 0.9, 0.22, 3.5), bt)
            # 旋律:每拍一个和弦音,略随机走动
            mel = random.choice(melody_pool)
            add(buf, render(mel, BEAT * 0.85, 0.32, 4.0), bt)
        truth.append({'bar': len(truth), 'start': round(bar_start, 2), 'chord': name})
        t += BEATS_PER_BAR * BEAT
    # 归一化写 WAV
    peak = max(abs(x) for x in buf) or 1.0
    frames = b"".join(struct.pack("<h", int(max(-1, min(1, x / peak)) * 27000)) for x in buf)
    with wave.open(str(path), 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(frames)
    return truth

SONGS = {
    'pop_axis':   (['C', 'G', 'Am', 'F'] * 2, 'I–V–vi–IV(《四个和弦》流行万能进行)'),
    'canon_d':    (['D', 'A', 'Bm', 'F#m', 'G', 'D', 'G', 'A'], '帕赫贝尔卡农进行(大量流行歌骨架,含小三和弦)'),
    'doowop_50s': (['C', 'Am', 'F', 'G'] * 2, 'I–vi–IV–V(50年代/doo-wop 经典)'),
    'blues_a':    (['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'], 'A 调 12 小节布鲁斯(测七和弦)'),
}

def main():
    out = Path(__file__).parent / 'songs'
    out.mkdir(exist_ok=True)
    manifest = {}
    for key, (prog, desc) in SONGS.items():
        truth = make_song(prog, out / f'{key}.wav')
        manifest[key] = {'desc': desc, 'prog': prog, 'truth': truth}
        print(f'{key}: {desc}  [{len(prog)} 小节] {" ".join(prog)}')
    (Path(__file__).parent / 'songs_manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print('\n写出', len(SONGS), '段 + manifest')

if __name__ == '__main__':
    main()
