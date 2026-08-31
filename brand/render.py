"""Rasterise the Aarka mark. No dependencies: pure stdlib PNG, 4x4 supersampled."""
import zlib, struct
from math import hypot

INK   = (0x0E, 0x11, 0x16, 255)
AMBER = (0xD9, 0x92, 0x4A, 255)   # ochre
CLEAR = (0, 0, 0, 0)
SS = 4  # samples per axis

def seg_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2))
    return hypot(px - (x1 + t * dx), py - (y1 + t * dy))

def mark_hit(x, y):
    """The mark in its native 120x120 space.

    A solid disc and an open ring, joined and rising. The floor always has value, so it is solid.
    The upside can be worth nothing, so it is a hole.

    The disc is r=28 rather than r=30 on purpose. A solid form carries far more optical weight than
    a hollow one -- at r=30 it held 57% more ink than the ring and the pair read as lopsided. At
    r=28 the two footprints are near enough equal, with the disc still fractionally the heavier of
    the two, which is also true of the thing it stands for."""
    if hypot(x - 41.2, y - 78.8) <= 28.0: return True             # the floor
    if abs(hypot(x - 79.0, y - 41.0) - 26.0) <= 5.5: return True  # the upside
    return False

def payoff_hit(x, y, w, h):
    """Floor and upside payoffs drawn as two lines. x,y in local box space."""
    K = w * 0.46
    # floor: min(S,K) -- rises then caps
    fy = h - min(x, K) * 0.78
    if seg_dist(x, y, 0, h, K, h - K * 0.78) <= 3.0: return True
    if seg_dist(x, y, K, h - K * 0.78, w, h - K * 0.78) <= 3.0: return True
    # upside: max(0, S-K) -- flat then rises
    if seg_dist(x, y, K, h, w, h - (w - K) * 0.78) <= 3.0: return True
    _ = fy
    return False

def write_png(path, w, h, px):
    raw = b"".join(b"\x00" + bytes(v for x in range(w) for v in px[y][x]) for y in range(h))
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    open(path, "wb").write(png)

def blend(bg, fg, a):
    if a <= 0: return bg
    if a >= 1: return fg
    out = []
    ba = bg[3] / 255.0
    oa = a + ba * (1 - a)
    for i in range(3):
        out.append(int(round((fg[i] * a + bg[i] * ba * (1 - a)) / oa)) if oa else 0)
    return (out[0], out[1], out[2], int(round(oa * 255)))

def render_mark(size, bg, fg, pad=0.16):
    """The mark centred on a square canvas, `pad` of the edge left as margin."""
    span = size * (1 - 2 * pad)
    off = size * pad
    rows = []
    for py in range(size):
        row = []
        for px_ in range(size):
            hits = 0
            for sy in range(SS):
                for sx in range(SS):
                    gx = (px_ + (sx + 0.5) / SS - off) / span * 120.0
                    gy = (py + (sy + 0.5) / SS - off) / span * 120.0
                    if mark_hit(gx, gy): hits += 1
            row.append(blend(bg, fg, hits / (SS * SS)))
        rows.append(row)
    return rows

def render_banner(w, h):
    rows = []
    mark_span = h * 0.52
    mark_x, mark_y = h * 0.42, (h - mark_span) / 2
    box_x, box_y = w * 0.42, h * 0.30
    box_w, box_h = w * 0.34, h * 0.40
    for py in range(h):
        row = []
        for px_ in range(w):
            hits = 0
            for sy in range(SS):
                for sx in range(SS):
                    ax, ay = px_ + (sx + 0.5) / SS, py + (sy + 0.5) / SS
                    gx = (ax - mark_x) / mark_span * 120.0
                    gy = (ay - mark_y) / mark_span * 120.0
                    if 0 <= gx <= 120 and 0 <= gy <= 120 and mark_hit(gx, gy):
                        hits += 1; continue
                    lx, ly = ax - box_x, ay - box_y
                    if 0 <= lx <= box_w and 0 <= ly <= box_h and payoff_hit(lx, ly, box_w, box_h):
                        hits += 1
            row.append(blend(INK, AMBER, hits / (SS * SS)))
        rows.append(row)
    return rows

if __name__ == "__main__":
    for s in (400, 1000):
        write_png(f"aarka-avatar-{s}.png", s, s, render_mark(s, INK, AMBER))
        print(f"aarka-avatar-{s}.png")
    write_png("aarka-mark-512.png", 512, 512, render_mark(512, CLEAR, AMBER, pad=0.08))
    print("aarka-mark-512.png  (transparent)")
    write_png("aarka-mark-ink-512.png", 512, 512, render_mark(512, CLEAR, INK, pad=0.08))
    print("aarka-mark-ink-512.png  (transparent)")
    write_png("aarka-banner-1500x500.png", 1500, 500, render_banner(1500, 500))
    print("aarka-banner-1500x500.png")
