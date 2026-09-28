"""Validate the generated PWA icons: real PNG structure, expected dimensions,
and that the radar geometry actually rendered (rings + core present, corners
transparent on the standard icon, opaque on the maskable one)."""
import os
import struct
import sys
import zlib

ICON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "icons")

EXPECTED = {
    "icon-192.png": 192,
    "icon-512.png": 512,
    "maskable-512.png": 512,
    "apple-touch-icon.png": 180,
    "favicon-32.png": 32,
}

failures = []


def read_png(path):
    with open(path, "rb") as fh:
        data = fh.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "bad PNG signature"
    pos = 8
    idat = b""
    w = h = None
    chunks = []
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + length]
        (crc,) = struct.unpack(">I", data[pos + 8 + length:pos + 12 + length])
        assert crc == (zlib.crc32(tag + payload) & 0xFFFFFFFF), f"CRC mismatch in {tag}"
        chunks.append(tag.decode())
        if tag == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", payload[:10])
            assert depth == 8, f"expected 8-bit, got {depth}"
            assert ctype == 6, f"expected RGBA (6), got {ctype}"
        elif tag == b"IDAT":
            idat += payload
        pos += 12 + length
    assert chunks[0] == "IHDR" and chunks[-1] == "IEND", f"chunk order wrong: {chunks}"
    raw = zlib.decompress(idat)
    stride = w * 4
    assert len(raw) == h * (stride + 1), "raw scanline length mismatch"
    # Un-filter (all our filter bytes are 0/None, but verify rather than assume).
    rows = []
    for y in range(h):
        off = y * (stride + 1)
        assert raw[off] == 0, f"unexpected filter type {raw[off]} on row {y}"
        rows.append(raw[off + 1:off + 1 + stride])
    return w, h, rows


def px(rows, x, y):
    r = rows[y]
    return r[x * 4], r[x * 4 + 1], r[x * 4 + 2], r[x * 4 + 3]


def check(cond, label):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        failures.append(label)


for name, size in EXPECTED.items():
    path = os.path.join(ICON_DIR, name)
    print(f"\n== {name} ==")
    if not os.path.exists(path):
        check(False, "file exists")
        continue
    w, h, rows = read_png(path)
    check((w, h) == (size, size), f"dimensions {w}x{h} == {size}x{size}")

    c = size // 2
    # Core should be bright cyan-ish.
    core = px(rows, c, c)
    check(core[3] > 0 and core[1] > 150 and core[2] > 150, f"core is bright cyan {core}")

    # A ring should exist somewhere between the core and the edge.
    ring_hits = 0
    for i in range(c + 2, size - 2):
        p = px(rows, c, i)
        if p[3] > 0 and p[2] > 120 and p[1] > 100:
            ring_hits += 1
    check(ring_hits > 3, f"outer ring rendered ({ring_hits} lit px)")

    # The sweep wedge should light the upper-right quadrant.
    wr, wg, wb, wa = px(rows, int(c * 1.35), int(c * 0.65))
    check(wa > 0 and (wr + wg + wb) > 60, f"sweep wedge lit upper-right {(wr, wg, wb, wa)}")

    if name == "maskable-512.png":
        corner = px(rows, 1, 1)
        check(corner[3] == 255, f"maskable fills corners (alpha={corner[3]})")
    else:
        corner = px(rows, 0, 0)
        check(corner[3] == 0, f"standard icon has transparent corner (alpha={corner[3]})")
        mid_edge = px(rows, c, 1)
        check(mid_edge[3] > 0, "rounded-square edge is opaque at mid-top")

print("\n== manifest references resolve ==")
import json
manifest = json.load(open(os.path.join(os.path.dirname(ICON_DIR), "manifest.json"), encoding="utf-8"))
for icon in manifest["icons"]:
    p = os.path.join(ICON_DIR, os.path.basename(icon["src"]))
    check(os.path.exists(p), f"{icon['src']} exists")
    declared = icon["sizes"].split("x")[0]
    check(declared == str(EXPECTED[os.path.basename(icon["src"])]), f"{icon['src']} size matches manifest")

purposes = {i.get("purpose", "any") for i in manifest["icons"]}
check("maskable" in purposes, "manifest declares a maskable icon (required for Android)")

# ---------------------------------------------------------------------------
# Windows .ico (desktop EXE): valid container, PNG-encoded frames, sizes match
# ---------------------------------------------------------------------------
print("\n== techintel.ico (desktop EXE) ==")
ico_path = os.path.join(ICON_DIR, "techintel.ico")
if os.path.exists(ico_path):
    with open(ico_path, "rb") as fh:
        ico = fh.read()
    reserved, ico_type, count = struct.unpack("<HHH", ico[:6])
    check(reserved == 0 and ico_type == 1, f"ICO header valid (type={ico_type})")
    check(count >= 3, f"{count} frames embedded (want >=3)")
    ok_frames = 0
    for i in range(count):
        w, h, colors, _res, planes, bpp, size, offset = struct.unpack(
            "<BBBBHHII", ico[6 + 16 * i:22 + 16 * i]
        )
        w = 256 if w == 0 else w
        h = 256 if h == 0 else h
        frame = ico[offset:offset + size]
        if frame[:8] == b"\x89PNG\r\n\x1a\n" and (w, h) in {(16, 16), (32, 32), (48, 48), (256, 256)}:
            ok_frames += 1
    check(ok_frames == count, f"all {count} ICO frames are valid PNGs at expected sizes")
else:
    check(False, "techintel.ico exists")

# ---------------------------------------------------------------------------
# Android launcher mipmaps: all 5 density buckets, both icon names
# ---------------------------------------------------------------------------
print("\n== Android launcher mipmaps ==")
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
aroot = os.path.join(ICON_DIR, "android")
for density, size in DENSITIES.items():
    for stem in ("ic_launcher", "ic_launcher_round"):
        p = os.path.join(aroot, f"mipmap-{density}", f"{stem}.png")
        if not os.path.exists(p):
            check(False, f"{stem}.png ({density}) exists")
            continue
        w, h, _ = read_png(p)
        check((w, h) == (size, size), f"{stem}.png ({density}) is {size}x{size}")
    fg = os.path.join(aroot, f"mipmap-{density}", "ic_launcher_foreground.png")
    fg_size = FOREGROUND_SIZES[density]
    if os.path.exists(fg):
        w, h, _ = read_png(fg)
        check((w, h) == (fg_size, fg_size), f"ic_launcher_foreground.png ({density}) is {fg_size}x{fg_size}")
    else:
        check(False, f"ic_launcher_foreground.png ({density}) exists")

print(f"\n{'ALL ICON CHECKS PASSED' if not failures else str(len(failures)) + ' FAILURES'}")
sys.exit(1 if failures else 0)
