import json, math, struct, wave
from pathlib import Path
SP = Path('/private/tmp/claude-501/-Users-jerry/7e13a0ee-9e45-470a-acef-e0270bc3ff30/scratchpad')
SR = 22050

# 读原曲
w = wave.open(str(SP/'xingxing.wav'), 'rb')
n = w.getnframes()
raw = w.readframes(n); w.close()
orig = list(struct.unpack('<%dh' % n, raw))
orig = [s/32768.0 for s in orig]

seg = json.loads((SP/'xingxing_seg.json').read_text())
segments = [s for s in seg['segments'] if s['label']]

NOTE={'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}
QUAL={'':[0,4,7],'m':[0,3,7],'7':[0,4,7,10],'maj7':[0,4,7,11],'m7':[0,3,7,10]}
def parse(label):
    # 根音
    root = NOTE[label[:2]] if len(label)>1 and label[1]=='#' else NOTE[label[0]]
    suf = label[len(label[:2]) if (len(label)>1 and label[1]=='#') else 1:]
    return root, QUAL.get(suf, [0,4,7])

def freq(m): return 440*2**((m-69)/12)
def render(m, dur, amp):
    N=int(dur*SR); out=[0.0]*N; f0=freq(m)
    for k,a in [(1,1.0),(2,0.5),(3,0.28),(4,0.14)]:
        f=f0*k
        if f>SR/2: continue
        for i in range(N): out[i]+=a*math.sin(2*math.pi*f*i/SR)
    for i in range(N):
        t=i/SR; out[i]*=amp*min(1.0,t/0.005)*math.exp(-t*2.2)
    return out

def make_backing(shift):
    buf=[0.0]*len(orig)
    for s in segments:
        root,ivs=parse(s['label']); root=(root+shift)%12
        mids=[48+root+iv for iv in ivs]+[36+root]
        t=s['start']
        while t < s['end']-0.05:
            for m in mids:
                samp=render(m, min(0.7, s['end']-t), 0.18)
                st=int(t*SR)
                for i,v in enumerate(samp):
                    j=st+i
                    if j<len(buf): buf[j]+=v
            t+=0.75  # 每 0.75s 重击一次
    return buf

def mix_and_write(backing, path):
    out=[orig[i]*0.62 + backing[i]*0.75 for i in range(len(orig))]
    peak=max(abs(x) for x in out) or 1.0
    out=[x/peak*0.95 for x in out]
    frames=b"".join(struct.pack('<h', int(max(-1,min(1,x))*30000)) for x in out)
    with wave.open(str(path),'w') as ww:
        ww.setnchannels(1); ww.setsampwidth(2); ww.setframerate(SR); ww.writeframes(frames)

out_dir = Path('/Users/jerry/chord-demo/verify')
out_dir.mkdir(exist_ok=True)
mix_and_write(make_backing(0),  out_dir/'A_小星星_扒出的和弦.wav')
mix_and_write(make_backing(6),  out_dir/'B_小星星_故意配错的和弦.wav')
print('A(正确):', ' '.join(s['label'] for s in segments))
print('B(错误): 全部根音+6半音(三全音),最刺耳')
print('写出 verify/A_*.wav 和 verify/B_*.wav')
