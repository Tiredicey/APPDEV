import numpy as np, subprocess, sys
from multiprocessing import Pool

W, H = int(sys.argv[1]), int(sys.argv[2])
OUT = sys.argv[3]
FPS = 30
BPM = 140
BEATS = 28
T = BEATS * 60.0 / BPM
N = int(round(T * FPS))
SUB = 3
SHUTTER = 0.5
PANELS_U = 18
PANELS_V = 4
F = 0.55

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
X = (xs - W / 2 + 0.5) / H
Y = (ys - H / 2 + 0.5) / H
R0 = np.sqrt(X * X + Y * Y) + 1e-4
TH0 = np.arctan2(Y, X)
VIG = (1.0 - 0.55 * np.clip(R0 / 0.95, 0, 1) ** 2.2).astype(np.float32)

rng = np.random.default_rng(140)
NP = 520
p_r = np.sqrt(rng.uniform(0.04, 0.8, NP)).astype(np.float32)
p_phi = rng.uniform(0, 2 * np.pi, NP).astype(np.float32)
p_z = rng.uniform(0, BEATS, NP).astype(np.float32)
p_b = rng.uniform(0.35, 1.0, NP).astype(np.float32)
p_warm = rng.uniform(0, 1, NP) < 0.12

def h2(a, b):
    v = np.sin(a * 12.9898 + b * 78.233) * 43758.5453
    return (v - np.floor(v)).astype(np.float32)

def heart(beat_phase):
    lub = np.exp(-((beat_phase - 0.02) / 0.05) ** 2)
    dub = 0.6 * np.exp(-((beat_phase - 0.30) / 0.06) ** 2)
    return lub + dub

def cam(t):
    b = t * BPM / 60.0
    ph = b - np.floor(b)
    surge = 0.10 * np.sin(2 * np.pi * ph) / (2 * np.pi)
    z = b + surge
    roll = 0.10 * np.sin(2 * np.pi * t / T) + 0.035 * np.sin(4 * np.pi * t / T + 1.3)
    sx = 0.006 * np.sin(2 * np.pi * 3 * t / T) + 0.004 * heart(ph) * np.sin(2 * np.pi * 7 * t / T)
    sy = 0.006 * np.cos(2 * np.pi * 2 * t / T)
    return z, roll, sx, sy, ph

def shade(t):
    z_cam, roll, sx, sy, ph = cam(t)
    Xs, Ys = X - sx, Y - sy
    r = np.sqrt(Xs * Xs + Ys * Ys) + 1e-4
    th = np.arctan2(Ys, Xs) + roll
    depth = F / r
    v = depth + z_cam
    u = (th / (2 * np.pi)) * PANELS_U
    iu = np.floor(u)
    vv = v * PANELS_V
    iv = np.floor(vv)
    ivm = np.mod(iv, BEATS * PANELS_V)
    ium = np.mod(iu, PANELS_U)
    fu = u - iu
    fv = vv - iv
    pid = h2(ium, ivm)
    seam = np.minimum(np.minimum(fu, 1 - fu) * 26, 1.0) * np.minimum(np.minimum(fv, 1 - fv) * 22 * np.clip(depth, 0.5, 4), 1.0)
    ring_f = v - np.floor(v)
    ringd = np.minimum(ring_f, 1 - ring_f)
    ring = np.clip(1 - ringd / 0.045, 0, 1)
    ring_edge = np.clip(1 - np.abs(ringd - 0.05) / 0.012, 0, 1)
    hole = (pid < 0.13) & (ring < 0.01)
    detail = h2(np.floor(u * 4), np.mod(np.floor(vv * 3), BEATS * PANELS_V * 3))
    base = 0.16 + 0.10 * pid + 0.04 * detail
    hull = base * seam
    hull = hull * (1 - ring) + (0.36 + 0.1 * pid) * ring + 0.25 * ring_edge
    key = 0.55 + 0.45 * np.cos(th - 2.2)
    fog = np.exp(-depth / 2.4)
    lum = hull * key * fog
    col = np.stack([lum * 0.80, lum * 0.92, lum * 1.05], -1)
    sd = np.mod(np.floor((th0 := TH0 + roll) * 900 / (2 * np.pi)), 900)
    sr = np.floor(R0 * 400)
    st = h2(sd, sr)
    stars = np.where(st > 0.9965, (st - 0.9965) / 0.0035, 0.0).astype(np.float32)
    planet = np.clip(np.cos(th - 0.9), 0, 1) ** 6 * np.clip(r * 1.6, 0, 1)
    space = np.stack([stars * 0.9 + planet * 0.30, stars * 0.95 + planet * 0.18, stars + planet * 0.10], -1)
    col = np.where(hole[..., None], space * (0.6 + 0.4 * fog[..., None]), col)
    lamp_u = np.mod(iu, 6) == 2
    lamp = lamp_u & (np.abs(fu - 0.5) < 0.16) & (ringd < 0.03)
    hb = heart(ph)
    glow_amt = (0.35 + 0.65 * hb) * fog
    col[..., 0] += np.where(lamp, 1.1 * glow_amt, 0)
    col[..., 1] += np.where(lamp, 0.22 * glow_amt, 0)
    halo = np.exp(-((ringd / 0.12) ** 2)) * lamp_u * fog * (0.10 + 0.14 * hb)
    col[..., 0] += halo * 0.9
    col[..., 1] += halo * 0.2
    core = np.exp(-(r / 0.05) ** 2) * 0.10
    col += core[..., None] * np.array([0.5, 0.75, 1.0], np.float32)
    pz = np.mod(p_z - z_cam, BEATS) + 0.05
    sxp = (p_r * F / pz) * np.cos(p_phi - roll) + sx
    syp = (p_r * F / pz) * np.sin(p_phi - roll) + sy
    px = (sxp * H + W / 2).astype(np.int32)
    py = (syp * H + H / 2).astype(np.int32)
    ok = (px >= 1) & (px < W - 1) & (py >= 1) & (py < H - 1) & (pz > 0.12)
    bri = (p_b * np.exp(-pz / 3.0) * 1.4).astype(np.float32)
    buf = np.zeros((H, W), np.float32)
    rad = np.clip((1.2 / pz), 0, 3).astype(np.int32)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            m = ok & ((np.abs(dx) + np.abs(dy)) <= rad)
            np.add.at(buf, (py[m] + dy, px[m] + dx), bri[m])
    wb = np.zeros((H, W), np.float32)
    mw = ok & p_warm
    np.add.at(wb, (py[mw], px[mw]), bri[mw] * 1.5)
    col += buf[..., None] * np.array([0.75, 0.82, 0.9], np.float32)
    col += wb[..., None] * np.array([1.0, 0.96, 0.76], np.float32)
    return col

def frame(i):
    acc = np.zeros((H, W, 3), np.float32)
    for s in range(SUB):
        t = (i + SHUTTER * (s / SUB - 0.5)) / FPS
        acc += shade(t % T)
    acc /= SUB
    acc *= VIG[..., None]
    acc = acc / (1 + acc * 0.6) * 1.35
    g = np.random.default_rng(1000 + i).normal(0, 0.012, (H, W, 1)).astype(np.float32)
    acc = np.clip(acc + g, 0, 1) ** (1 / 1.15)
    return (acc * 255 + 0.5).astype(np.uint8).tobytes()

if __name__ == "__main__":
    enc = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-crf", sys.argv[4] if len(sys.argv) > 4 else "20", "-pix_fmt", "yuv420p", "-g", str(FPS * 2), "-movflags", "+faststart", "-an", OUT], stdin=subprocess.PIPE)
    with Pool(int(__import__("os").environ.get("PROCS", "1"))) as p:
        for k, fb in enumerate(p.imap(frame, range(N), chunksize=4)):
            enc.stdin.write(fb)
            if k % 30 == 0:
                print(k, flush=True)
    enc.stdin.close()
    enc.wait()
    print("done", N, T)
