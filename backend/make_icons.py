"""
TechIntel — PWA Icon Generator
 ==============================
Writes the PNG icons the web app manifest and Android launcher need, with no
third-party imaging dependency: PNG is simple enough (IHDR/IDAT/IEND + zlib) to
emit directly, which keeps the build dependency-free.

The mark mirrors the in-app radar logo: concentric range rings, a sweep wedge,
and a glowing core, on the app's own background colour.

    python -m backend.make_icons
"""

import math
import os
import struct
import zlib

FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend"
)
ICON_DIR = os.path.join(FRONTEND_DIR, "icons")

# Pulled from styles.css `html[data-theme="nebula"]` so the icon matches the app.
BG = (0x07, 0x0A, 0x18)
CYAN = (0x22, 0xD3, 0xEE)
CYAN_DIM = (0x0E, 0x74, 0x90)
VIOLET = (0x8B, 0x5C, 0xF6)

# 2x2 ordered dither looks better than a hard edge at small sizes than a
# supersampled blur, and costs nothing.
SS = 3  # supersampling factor per axis


def _write_png(path, width, height, pixels):
    """Write 8-bit RGBA pixels (a flat bytearray of len w*h*4) to a PNG file."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 (None) for this scanline
        row = pixels[y * width * 4:(y + 1) * width * 4]
        raw.extend(row)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    with open(path, "wb") as fh:
        fh.write(png)
    return len(png)


def png_bytes(width, height, pixels):
    """Return the PNG bytes without touching the filesystem (for ICO embedding)."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * width * 4:(y + 1) * width * 4])

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    return png


def _write_ico(path, images):
    """
    Write a Windows .ico container holding PNG-encoded frames. PNG-in-ICO is
    valid since Vista and lets us reuse the same renderer with zero extra
    tooling (no Pillow, no PIL->ICO conversion). Sizes 16..256.
    ``images`` is a list of (size, png_bytes).
    """
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    blobs = b""
    offset = 6 + 16 * len(images)
    for size, data in images:
        # A 0 byte in the directory means 256 in the icon world.
        dim = 0 if size >= 256 else size
        entries += struct.pack(
            "<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset
        )
        blobs += data
        offset += len(data)
    with open(path, "wb") as fh:
        fh.write(header + entries + blobs)
    return offset


def _lerp(a, b, t):
    return a + (b - a) * t


def _mix(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return (
        int(round(_lerp(c1[0], c2[0], t))),
        int(round(_lerp(c1[1], c2[1], t))),
        int(round(_lerp(c1[2], c2[2], t))),
    )


def render_icon(size, maskable=False):
    """
    Render one icon at ``size``x``size``.

    ``maskable`` insets the mark to ~62% of the canvas and fills the whole
    square, because Android crops maskable icons to a circle and will eat any
    detail that reaches the edges.
    """
    n = size * SS
    # Accumulators for supersampling, then averaged down per output pixel.
    acc = [[[0, 0, 0, 0] for _ in range(size)] for _ in range(size)]

    # Geometry in normalised units (0..1) so it scales to any size.
    # Ring and core widths have a minimum pixel width, otherwise a 32px favicon
    # renders its rings sub-pixel and the whole mark collapses into a blob.
    min_px = 1.7 / size
    if maskable:
        cx = cy = 0.5
        outer_r = 0.30            # comfortably inside the 0.5 safe zone
        ring_w = max(0.016, min_px)
        core_r = max(0.055, min_px * 2.6)
        corner = 1.0              # full-bleed background
    else:
        cx = cy = 0.5
        outer_r = 0.40
        ring_w = max(0.020, min_px)
        core_r = max(0.075, min_px * 3.2)
        corner = 0.5              # rounded-square badge

    ring_radii = [outer_r, outer_r * 0.68, outer_r * 0.40]

    for sy in range(n):
        v = (sy + 0.5) / n
        for sx in range(n):
            u = (sx + 0.5) / n
            dx, dy = u - cx, v - cy
            r = math.hypot(dx, dy)

            # --- background ---
            # Rounded-square mask for the standard icon.
            if corner < 1.0:
                rr = 0.22
                qx = abs(u - 0.5) - (0.5 - rr)
                qy = abs(v - 0.5) - (0.5 - rr)
                outside = (max(qx, 0) ** 2 + max(qy, 0) ** 2) > rr * rr and (
                    qx > 0 or qy > 0
                )
                if outside:
                    continue
            color = BG
            alpha = 255

            # --- subtle radial vignette toward the corners ---
            glow = max(0.0, 1.0 - (r / 0.75))
            if glow > 0:
                color = _mix(color, (0x0D, 0x1B, 0x3A), glow * 0.85)

            # --- radar sweep wedge ---
            ang = (math.degrees(math.atan2(dy, dx)) + 360.0) % 360.0
            wedge_half = 26.0
            delta = min(abs(ang - 40.0), 360.0 - abs(ang - 40.0))
            if delta < wedge_half and r < outer_r:
                fade = (1.0 - delta / wedge_half) * (1.0 - r / outer_r)
                color = _mix(color, CYAN, 0.55 * fade)

            # --- concentric range rings ---
            for ri, rr_ in enumerate(ring_radii):
                dist = abs(r - rr_)
                if dist < ring_w * 0.5:
                    # Antialias the ring edge across the supersample footprint.
                    edge = 1.0 - (dist / (ring_w * 0.5))
                    tint = CYAN if ri == 0 else CYAN_DIM
                    color = _mix(color, tint, 0.85 * min(1.0, edge * 1.4))

            # --- glowing core ---
            if r < core_r:
                t = r / core_r
                color = _mix(color, CYAN, 0.95)
            elif r < core_r * 2.1:
                t = 1.0 - (r - core_r) / (core_r * 1.1)
                color = _mix(color, VIOLET, 0.5 * t)

            # Accumulate
            px = sx // SS
            py = sy // SS
            cell = acc[py][px]
            cell[0] += color[0]
            cell[1] += color[1]
            cell[2] += color[2]
            cell[3] += alpha

    # Downsample
    out = bytearray(size * size * 4)
    samples = SS * SS
    i = 0
    for y in range(size):
        for x in range(size):
            cell = acc[y][x]
            out[i] = cell[0] // samples
            out[i + 1] = cell[1] // samples
            out[i + 2] = cell[2] // samples
            out[i + 3] = cell[3] // samples
            i += 4
    return out


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
        ("favicon-32.png", 32, False),
    ]
    print(f"Writing PWA icons -> {ICON_DIR}")
    for name, size, maskable in targets:
        px = render_icon(size, maskable=maskable)
        path = os.path.join(ICON_DIR, name)
        nbytes = _write_png(path, size, size, px)
        print(f"  {name:24s} {size}x{size}  {nbytes/1024:6.1f} KB  maskable={maskable}")

    # Windows .ico for the desktop EXE (PNG-encoded frames, Vista+).
    ico_frames = [
        (16, png_bytes(16, 16, render_icon(16))),
        (32, png_bytes(32, 32, render_icon(32))),
        (48, png_bytes(48, 48, render_icon(48))),
        (256, png_bytes(256, 256, render_icon(256))),
    ]
    ico_path = os.path.join(ICON_DIR, "techintel.ico")
    _write_ico(ico_path, ico_frames)
    print(f"  {'techintel.ico':24s} {len(ico_frames)} frames      (Windows EXE icon)")

    # Android launcher icons: legacy PNGs at every density bucket. Capacitor's
    # generated project references @mipmap/ic_launcher and ic_launcher_round;
    # the build patches those with these files.
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    # The adaptive-icon foreground layer is drawn on a 108dp canvas; at each
    # density bucket that is exactly 108/162/216/324/432 px. The maskable render
    # keeps the radar inset inside the ~66% safe zone Android masks to a circle.
    foreground_sizes = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    aroot = os.path.join(ICON_DIR, "android")
    print(f"Writing Android launcher icons -> {aroot}")
    for density, size in densities.items():
        res = os.path.join(aroot, f"mipmap-{density}")
        os.makedirs(res, exist_ok=True)
        px = render_icon(size)
        for stem in ("ic_launcher", "ic_launcher_round"):
            p = os.path.join(res, f"{stem}.png")
            _write_png(p, size, size, px)
            print(f"  {stem}.png ({density}, {size}x{size})  -> mipmap-{density}")
        fg = os.path.join(res, "ic_launcher_foreground.png")
        fg_size = foreground_sizes[density]
        _write_png(fg, fg_size, fg_size, render_icon(fg_size, maskable=True))
        print(f"  ic_launcher_foreground.png ({density}, {fg_size}x{fg_size}, maskable)")


if __name__ == "__main__":
    main()
