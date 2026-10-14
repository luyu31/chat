#!/usr/bin/env python3
"""生成 milk.chat 应用图标（milk 盒子 + 聊天气泡）与通知小图标。"""
import os
from PIL import Image, ImageDraw, ImageFont

RES = "/workspace/android/app/res"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def rounded_gradient_bg(size, radius, top, bottom):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(grad)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(top, bottom, y / size) + (255,))
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    return img

def draw_heart(d, cx, cy, s, color):
    r = s
    d.ellipse([cx - r, cy - r, cx + r * 0.05, cy + r * 0.45], fill=color)
    d.ellipse([cx - r * 0.05, cy - r, cx + r, cy + r * 0.45], fill=color)
    d.polygon([(cx - r * 0.97, cy - r * 0.22), (cx + r * 0.97, cy - r * 0.22),
               (cx, cy + r * 1.35)], fill=color)

def make_icon(size=512):
    img = rounded_gradient_bg(512, 116, (255, 253, 247), (255, 228, 238))
    d = ImageDraw.Draw(img)

    # 底部柔影
    d.ellipse([151, 396, 331, 436], fill=(214, 160, 178, 60))

    # 牛奶盒：屋顶（山形顶）
    white = (255, 255, 255, 255)
    d.polygon([(161, 224), (203, 158), (269, 158), (311, 224)], fill=white)
    d.line([(161, 224), (311, 224)], fill=(236, 214, 224, 255), width=3)
    d.line([(203, 158), (269, 158)], fill=(236, 214, 224, 255), width=3)
    # 屋顶折痕
    d.line([(236, 158), (236, 224)], fill=(246, 232, 238, 255), width=3)

    # 盒身
    d.rounded_rectangle([161, 220, 311, 400], radius=16, fill=white)
    d.rectangle([161, 220, 311, 250], fill=white)
    d.rounded_rectangle([161, 220, 311, 400], radius=16, outline=(238, 219, 228, 255), width=3)

    # 蓝色标签带
    d.rectangle([161, 268, 311, 320], fill=(134, 197, 232, 255))
    try:
        f = ImageFont.truetype(FONT_BOLD, 44)
    except Exception:
        f = ImageFont.load_default()
    tb = d.textbbox((0, 0), "milk", font=f)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    d.text((236 - tw / 2 - tb[0], 294 - th / 2 - tb[1]), "milk", font=f, fill=(255, 255, 255, 255))

    # 可爱表情
    eye = (74, 59, 50, 255)
    d.ellipse([206, 342, 222, 358], fill=eye)
    d.ellipse([250, 342, 266, 358], fill=eye)
    d.arc([208, 350, 264, 396], start=20, end=160, fill=eye, width=6)
    # 腮红
    d.ellipse([188, 356, 204, 366], fill=(255, 192, 203, 200))
    d.ellipse([268, 356, 284, 366], fill=(255, 192, 203, 200))

    # 聊天气泡（右上）
    d.rounded_rectangle([318, 84, 442, 156], radius=34, fill=white,
                        outline=(242, 216, 226, 255), width=4)
    d.polygon([(336, 148), (368, 152), (338, 176)], fill=white)
    draw_heart(d, 380, 116, 17, (255, 127, 168, 255))

    return img

def make_pixel_icon():
    """像素风：一杯苹果汁 + 大红苹果 + 小青苹果（24×24 网格设计，整数倍缩放）"""
    S = 24
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def P(x, y, c): d.point((x, y), fill=c)
    def R(x0, y0, x1, y1, c): d.rectangle([x0, y0, x1, y1], fill=c)

    # —— 背景：奶油粉 + 棋盘暗角 ——
    BG = (255, 233, 243, 255)
    BG_DOT = (255, 216, 234, 255)
    R(0, 0, S - 1, S - 1, BG)
    for y in range(13, S):
        for x in range(13, S):
            if (x + y) % 2 == 0:
                P(x, y, BG_DOT)
    # 白色十字小星星
    STAR = (255, 255, 255, 255)
    for cx, cy in [(3, 3), (20, 8), (6, 19)]:
        P(cx, cy, STAR)
        P(cx - 1, cy, STAR); P(cx + 1, cy, STAR)
        P(cx, cy - 1, STAR); P(cx, cy + 1, STAR)

    # —— 果汁杯 ——
    OUT = (94, 82, 92, 255)          # 深莓色描边
    BODY = (222, 244, 250, 255)      # 玻璃浅蓝
    JUICE = (255, 168, 64, 255)      # 苹果汁橙黄
    JUICE_HI = (255, 214, 130, 255)  # 果汁高光
    R(4, 6, 12, 6, OUT)              # 杯口
    R(4, 7, 4, 18, OUT)              # 左壁
    R(12, 7, 12, 18, OUT)            # 右壁
    R(5, 7, 11, 18, BODY)            # 玻璃身
    R(5, 9, 11, 18, JUICE)           # 果汁
    R(6, 10, 7, 11, JUICE_HI)        # 液面高光
    P(6, 9, (255, 255, 255, 255))    # 液面白点
    R(5, 19, 11, 19, OUT)            # 杯底
    # 吸管（粉白条纹，斜插）
    STRAW = (255, 143, 171, 255)
    STRAW_D = (232, 110, 140, 255)
    R(10, 3, 11, 3, STRAW)
    P(10, 4, STRAW); P(11, 4, STRAW_D)
    P(10, 5, STRAW)
    P(10, 7, STRAW_D); P(10, 8, STRAW_D)  # 杯内吸管

    # —— 红苹果（大） ——
    RED = (231, 76, 60, 255)
    RED_D = (172, 46, 36, 255)
    RED_HI = (255, 130, 108, 255)
    STEM = (122, 82, 48, 255)
    LEAF = (107, 191, 89, 255)
    d.ellipse([13, 11, 21, 19], fill=RED, outline=RED_D)
    P(17, 11, RED)                   # 顶部凹陷
    P(17, 9, STEM); P(17, 10, STEM)  # 苹果梗
    P(18, 9, LEAF); P(19, 9, LEAF); P(18, 10, LEAF)  # 叶子
    P(14, 13, RED_HI); P(15, 13, RED_HI); P(14, 14, RED_HI)  # 高光

    # —— 青苹果（小，在前侧） ——
    GRN = (124, 200, 80, 255)
    GRN_D = (86, 156, 54, 255)
    GRN_HI = (176, 228, 114, 255)
    d.ellipse([16, 18, 22, 23], fill=GRN, outline=GRN_D)
    P(18, 17, STEM)                  # 小梗
    P(19, 17, LEAF); P(20, 17, LEAF) # 小叶
    P(17, 19, GRN_HI); P(17, 20, GRN_HI)  # 高光

    return img

def make_round(img):
    size = img.size[0]
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    out.paste(img, (0, 0), mask)
    return out

def make_notify_glyph():
    # 纯白色牛奶滴（透明底），用于通知小图标
    s = 96
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = (255, 255, 255, 255)
    d.polygon([(s * 0.5, s * 0.08), (s * 0.26, s * 0.5), (s * 0.74, s * 0.5)], fill=w)
    d.ellipse([s * 0.22, s * 0.34, s * 0.78, s * 0.9], fill=w)
    return img

def main():
    # 像素风主图标：24×24 网格，所有 launcher 尺寸都是 24 的整数倍（NEAREST 保持像素感）
    icon24 = make_pixel_icon()
    mips = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for dpi, px in mips.items():
        assert px % 24 == 0
        folder = os.path.join(RES, "mipmap-" + dpi)
        os.makedirs(folder, exist_ok=True)
        big = icon24.resize((px, px), Image.NEAREST)
        big.save(os.path.join(folder, "ic_launcher.png"))
        make_round(big).save(os.path.join(folder, "ic_launcher_round.png"))
    for dpi, px in mips.items():
        folder = os.path.join(RES, "drawable-" + dpi)
        os.makedirs(folder, exist_ok=True)
        make_notify_glyph().resize((px, px), Image.LANCZOS).save(os.path.join(folder, "ic_stat_notify.png"))
    # 预览大图（给开发者/用户看效果用）
    icon24.resize((480, 480), Image.NEAREST).save("/workspace/android/tools/icon_preview.png")
    print("icons done")

if __name__ == "__main__":
    main()
