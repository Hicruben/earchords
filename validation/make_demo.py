"""生成一个更像歌的 demo:C-G-Am-F 分解和弦 + 低音,重复两遍。"""
import math, struct, wave
from synth import NOTE, midi_to_freq, SR

def note(freq, dur, amp=1.0):
    n = int(dur * SR); out = [0.0]*n
    for k, a in [(1,1.0),(2,0.5),(3,0.28),(4,0.14),(5,0.07)]:
        f = freq*k
        if f > SR/2: continue
        for i in range(n): out[i] += a*math.sin(2*math.pi*f*i/SR)
    for i in range(n):
        t = i/SR; out[i] *= amp*min(1.0, t/0.005)*math.exp(-t*3.2)
    return out

# 和弦定义:根音 + 三和弦音(MIDI)
CHORDS = {
    "C":  [48, 60, 64, 67],
    "G":  [43, 62, 67, 71],
    "Am": [45, 60, 64, 69],
    "F":  [41, 60, 65, 69],
}
PROG = ["C","G","Am","F"] * 2
BEAT = 0.5  # 每拍
buf = []
for name in PROG:
    root, *triad = CHORDS[name]
    # 一小节 4 拍:低音-和弦-和弦分解
    pattern = [root, triad[0], triad[1], triad[2], root, triad[1], triad[2], triad[0]]
    for p in pattern:
        buf.extend(note(midi_to_freq(p), BEAT, 0.6))

peak = max(abs(x) for x in buf) or 1.0
frames = b"".join(struct.pack("<h", int(max(-1,min(1,x/peak))*28000)) for x in buf)
with wave.open("/Users/jerry/chordsnap/public/demo.wav","w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(frames)
print(f"demo.wav: {len(buf)/SR:.1f}s, 进行 {' '.join(PROG)}")
