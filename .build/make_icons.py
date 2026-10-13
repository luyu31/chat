#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用应用自带的像素心形 logo 生成各尺寸 launcher 图标。"""
import os
from PIL import Image, ImageDraw

SRC = "/tmp/dl/favicon.bin"
OUT = "/workspace/.build/milkchat/res"

# dp -> px
DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}


def load_heart():
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    px = im.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            lum = (r + g + b) / 3.0
            if lum >= 246:
                a = 0
            elif lum >= 198:
                a = int(255 * (246 - lum) / 48.0)
            else:
                a = 255
            if a > 0:
                op[x, y] = (r, g, b, a)
    return out


def trim(im):
    bbox = im.getbbox()  # 基于 alpha 通道
    return im.crop(bbox) if bbox else im


def fit(heart, box_px):
    """等比缩放到 box_px 见方以内"""
    w, h = heart.size
    scale = min(box_px / w, box_px / h)
    return heart.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def gradient(size, top=(255, 255, 255), bottom=(255, 225, 236)):
    g = Image.new("RGB", (1, size), top)
    for y in range(size):
        t = y / max(1, size - 1)
        g.putpixel((0, y), (
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
        ))
    return g.resize((size, size))


def rounded_mask(size, radius, circle=False):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    if circle:
        d.ellipse((0, 0, size - 1, size - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def main():
    heart = trim(load_heart())
    print("heart size:", heart.size)

    for dens, scale in DENSITIES.items():
        folder = os.path.join(OUT, "mipmap-" + dens)
        os.makedirs(folder, exist_ok=True)

        # ---- 传统方形图标（带圆角 + 渐变底） ----
        side = int(48 * scale)
        bg = gradient(side).convert("RGBA")
        bg.putalpha(rounded_mask(side, int(side * 0.22)))
        art = fit(heart, int(side * 0.78))
        bg.alpha_composite(art, ((side - art.width) // 2, (side - art.height) // 2))
        bg.save(os.path.join(folder, "ic_launcher.png"))

        # ---- 圆形图标 ----
        circ = gradient(side).convert("RGBA")
        circ.putalpha(rounded_mask(side, 0, circle=True))
        art2 = fit(heart, int(side * 0.70))
        circ.alpha_composite(art2, ((side - art2.width) // 2, (side - art2.height) // 2))
        circ.save(os.path.join(folder, "ic_launcher_round.png"))

        # ---- 自适应图标前景（108dp，透明底，内容在安全区内） ----
        fg_side = int(108 * scale)
        fg = Image.new("RGBA", (fg_side, fg_side), (0, 0, 0, 0))
        art3 = fit(heart, int(fg_side * 0.58))
        fg.alpha_composite(art3, ((fg_side - art3.width) // 2, (fg_side - art3.height) // 2))
        fg.save(os.path.join(folder, "ic_launcher_foreground.png"))

        print("mipmap-%s: %dpx / fg %dpx" % (dens, side, fg_side))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())