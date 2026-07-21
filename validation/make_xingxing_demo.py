import math, struct, wave
from pathlib import Path
SR=22050; BEAT=0.5
def freq(m): return 440*2**((m-69)/12)
def tone(m,dur,amp,decay,harm):
    N=int(dur*SR); out=[0.0]*N; f0=freq(m)
    for k,a in harm:
        f=f0*k
        if f>SR/2: continue
        for i in range(N): out[i]+=a*math.sin(2*math.pi*f*i/SR)
    for i in range(N):
        t=i/SR; out[i]*=amp*min(1.0,t/0.01)*math.exp(-t*decay)
    return out

# 旋律(D大调):一闪一闪亮晶晶…  (do=D62)
D=62;E=64;Fs=66;G=67;A=69;B=71
MEL=[(D,1),(D,1),(A,1),(A,1),(B,1),(B,1),(A,2),
     (G,1),(G,1),(Fs,1),(Fs,1),(E,1),(E,1),(D,2),
     (A,1),(A,1),(G,1),(G,1),(Fs,1),(Fs,1),(E,2),
     (A,1),(A,1),(G,1),(G,1),(Fs,1),(Fs,1),(E,2),
     (D,1),(D,1),(A,1),(A,1),(B,1),(B,1),(A,2),
     (G,1),(G,1),(Fs,1),(Fs,1),(E,1),(E,1),(D,2)]
# 和弦(名,拍数)—— 小星星标准配法(D/G/A)
CH={'D':[50,54,57,62],'G':[43,55,59,62],'A':[45,57,61,64]}
CHORDS=[('D',4),('G',2),('D',2),('G',2),('D',2),('A',2),('D',2),
        ('D',2),('G',2),('D',2),('A',2),('D',2),('G',2),('D',2),('A',2),
        ('D',4),('G',2),('D',2),('A',2),('D',2)]

total=sum(b for _,b in MEL)*BEAT
def mkbuf(): return [0.0]*int(total*SR+SR)
def add(buf,s,at):
    st=int(at*SR)
    for i,v in enumerate(s):
        j=st+i
        if j<len(buf): buf[j]+=v

# 旋律轨
mel=mkbuf(); t=0
for m,b in MEL:
    add(mel, tone(m,b*BEAT*0.95,0.5,3.0,[(1,1),(2,0.4),(3,0.15)]), t); t+=b*BEAT
# 和弦轨(柔和、持续)
ch=mkbuf(); t=0
for name,b in CHORDS:
    for m in CH[name]:
        add(ch, tone(m,b*BEAT*0.98,0.16,0.8,[(1,1),(2,0.5),(3,0.25)]), t)
    t+=b*BEAT

def write(buf,path,gain=0.95):
    peak=max(abs(x) for x in buf) or 1
    frames=b"".join(struct.pack('<h',int(max(-1,min(1,x/peak*gain))*30000)) for x in buf)
    with wave.open(str(path),'w') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes(frames)

out=Path('/Users/jerry/Documents/anychord/validation/demo3'); out.mkdir(exist_ok=True)
write(mel, out/'1_只有旋律_这才是小星星的调子.wav')
write(ch,  out/'2_只有和弦_单独听本来就不像歌.wav')
both=[mel[i]*0.62+ch[i]*0.8 for i in range(len(mel))]
write(both, out/'3_旋律加和弦_完整的小星星.wav')
print('时长',round(total,1),'s;写出 3 段')
