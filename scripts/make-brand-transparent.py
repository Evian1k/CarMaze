#!/usr/bin/env python3
"""CARMAZE brand asset pipeline — transparency pass.

The official emblem artwork is a perfect circle centred in the source PNG on a
near-black studio background. This script ONLY removes the outside-of-circle
background (the transparency requirement of the brand spec); it never redraws,
recolors or distorts the artwork itself.

Outputs (RGBA, transparent outside the emblem):
  public/brand/carmaze-logo.png        (master, 1254px)
  public/brand/carmaze-logo-512.png
  public/brand/carmaze-logo-256.png
  public/brand/carmaze-logo-128.png
  public/brand/carmaze-logo-96.png
  public/brand/carmaze-logo-64.png
"""
from PIL import Image, ImageDraw, ImageFilter
import os

BRAND = "/home/z/my-project/public/brand"
SRC = os.path.join(BRAND, "carmaze-logo-source.png")   # 1254px master (opaque)
OUT_MASTER = os.path.join(BRAND, "carmaze-logo.png")

SIZES = [512, 256, 128, 96, 64]


def find_circle(im: Image.Image):
    """Locate the gold ring bounding box to find centre + radius."""
    w, h = im.size
    px = im.convert("RGB").load()
    cx, cy = w // 2, h // 2

    def is_ring(x, y):
        r, g, b = px[x, y]
        # gold ring / bright rim pixels are clearly brighter than the bg
        return (r > 90 and g > 70) or (g > 70 and b > 60 and r > 60)

    # scan from each edge toward the centre along both axes
    left = next((x for x in range(w) if is_ring(x, cy)), None)
    right = next((x for x in range(w - 1, -1, -1) if is_ring(x, cy)), None)
    top = next((y for y in range(h) if is_ring(cx, y)), None)
    bottom = next((y for y in range(h - 1, -1, -1) if is_ring(cx, y)), None)
    if None in (left, right, top, bottom):
        raise SystemExit("could not locate emblem ring")
    cx_f = (left + right) / 2
    cy_f = (top + bottom) / 2
    r_f = max(right - left, bottom - top) / 2
    return cx_f, cy_f, r_f


def main():
    src = Image.open(SRC).convert("RGB")
    w, h = src.size
    cx, cy, radius = find_circle(src)
    print(f"emblem centre=({cx:.1f},{cy:.1f}) radius={radius:.1f} on {w}x{h}")

    # Feathered circular mask: opaque inside the ring, transparent outside.
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    pad = 4  # keep the gold ring fully intact
    d.ellipse([cx - radius - pad, cy - radius - pad, cx + radius + pad, cy + radius + pad], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(2.0))

    rgba = src.convert("RGBA")
    rgba.putalpha(mask)
    rgba.save(OUT_MASTER, optimize=True)
    print(f"wrote {OUT_MASTER}")

    for s in SIZES:
        im = rgba.resize((s, s), Image.LANCZOS)
        p = os.path.join(BRAND, f"carmaze-logo-{s}.png")
        im.save(p, optimize=True)
        print(f"wrote {p}")


if __name__ == "__main__":
    main()
