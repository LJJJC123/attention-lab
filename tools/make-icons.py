# Generates the PWA icon set from the app's own palette.
#
# Written as a throwaway script rather than committed as an asset pipeline:
# the mark is three concentric shapes (a central ring, a peripheral dot, and a
# hairline horizon) which is literally what the training stage asks you to
# compare. Only python's stdlib is used so it runs anywhere.
#
#   python tools/make-icons.py
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')

BG = (0x1A, 0x17, 0x12)      # paper-0, matches --paper-0
AMBER = (0xF0, 0xB4, 0x54)   # accent, warm amber 78deg
DIM = (0x6B, 0x60, 0x4E)


def png(width, height, pixels):
    """Minimal RGBA PNG writer. pixels: list of rows, each a list of (r,g,b,a)."""
    raw = b''.join(b'\x00' + bytes(v for px in row for v in px) for row in pixels)

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def blend(dst, src, a):
    return tuple(round(d + (s - d) * a) for d, s in zip(dst, src))


def draw(size, maskable=False):
    """The mark: a ring at centre, one dot up-left of it, a hairline below.

    maskable icons must keep their content inside the central 80% safe zone,
    because Android crops to whatever shape the launcher uses.
    """
    s = size
    cx = cy = s / 2
    # maskable art shrinks to ~72% so the crop never clips the ring
    k = 0.72 if maskable else 1.0
    ring_r = 0.20 * s * k
    ring_w = 0.052 * s * k
    dot_r = 0.062 * s * k
    # the peripheral stimulus sits up-and-left, the bearing the engine uses
    px = cx - 0.30 * s * k
    py = cy - 0.30 * s * k
    horizon = cy + 0.30 * s * k
    line_w = max(1.0, 0.012 * s * k)

    corner = 0.22 * s if not maskable else 0.0  # rounded square; maskable = full bleed
    radius = corner

    rows = []
    for y in range(s):
        row = []
        for x in range(s):
            # background with optional rounded corners
            if radius > 0:
                dx = max(radius - x, x - (s - radius), 0)
                dy = max(radius - y, y - (s - radius), 0)
                if math.hypot(dx, dy) > radius:
                    row.append((0, 0, 0, 0))
                    continue
            rgb = BG

            d_ring = abs(math.hypot(x - cx, y - cy) - ring_r)
            if d_ring < ring_w / 2:
                rgb = blend(rgb, AMBER, 1.0)
            d_dot = math.hypot(x - px, y - py)
            if d_dot < dot_r:
                rgb = blend(rgb, AMBER, 1.0)
            if abs(y - horizon) < line_w / 2 and abs(x - cx) < 0.26 * s * k:
                rgb = blend(rgb, DIM, 1.0)

            row.append((rgb[0], rgb[1], rgb[2], 255))
        rows.append(row)
    return rows


def main():
    targets = [
        ('icon-192.png', 192, False),
        ('icon-512.png', 512, False),
        # iOS ignores the manifest and wants a PNG apple-touch-icon
        ('apple-touch-icon.png', 180, False),
        ('icon-maskable-512.png', 512, True),
    ]
    for name, size, maskable in targets:
        path = os.path.join(OUT, name)
        with open(path, 'wb') as f:
            f.write(png(size, size, draw(size, maskable)))
        print('wrote', os.path.relpath(path), size)


if __name__ == '__main__':
    main()
