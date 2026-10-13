#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用生成的可爱牛奶盒吉祥物图，做各尺寸 launcher 图标 + 自适应前景。"""
import os
from PIL import Image, ImageDraw

SRC = "/workspace/.build/icon_cute.jpg"
OUT = "/workspace/.build/milkchat/res"

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}


def base_rgb():
    return Image.open(SRC).convert("RGB")


def cover(im, size):
    return im.resize((size, size), Image.LANCZOS)


def circle_mask(size):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.ellipse((0, 0, size - 1, size - 1), fill=255)
    return m


def main():
    for dens, scale in DENSITIES.items():
        folder = os.path.join(OUT, "mipmap-" + dens)
        os.makedirs(folder, exist_ok=True)

        # 传统方形图标：直接用整图（图本身已含圆角方形底与主体）
        side = int(48 * scale)
        cover(base_rgb(), side).save(os.path.join(folder, "ic_launcher.png"))

        # 圆形图标：圆形遮罩裁剪中心
        r = cover(base_rgb(), side)
        r.putalpha(circle_mask(side))
        r.save(os.path.join(folder, "ic_launcher_round.png"))

        # 自适应图标前景（108dp）：满幅，遮罩会自动裁圆角，主体居中即落在安全区
        fg_side = int(108 * scale)
        cover(base_rgb(), fg_side).save(os.path.join(folder, "ic_launcher_foreground.png"))

        print("mipmap-%s: %dpx / fg %dpx" % (dens, side, fg_side))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())