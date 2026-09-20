#!/usr/bin/env python3
"""Generates the macOS DMG installer background (build/background.png + build/background@2x.png).

Concept: a RANSOM "ransom note". The two install targets sit on the same red panels as the
in-game notification, a trail of gold coins leads from the app to Applications, and the price
is 0 gold. Everything is drawn from the project's own (credited) game assets.

Requires Pillow (`pip install pillow`); only needed to REGENERATE the images, which are committed.
Usage: python3 scripts/make-dmg-background.py [--preview]   (preview writes build/preview.png)
"""
import os, random, sys
from PIL import Image, ImageDraw, ImageFont, ImageChops

W, H, S = 660, 400, 2                     # window size in points, and render scale (2 = retina)
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'assets')
BUILD = os.path.join(HERE, '..', 'build')
RED, GOLD, WHITE, BLACK = (248, 43, 28), (255, 207, 37), (255, 255, 255), (0, 0, 0)
random.seed(666)

# Centres of the two Finder icons: keep in sync with dmg.contents in package.json.
APP_X, APPS_X, ICON_Y = 170, 490, 218

def px(v): return int(round(v * S))
def box(x0, y0, x1, y1): return [px(x0), px(y0), px(x1), px(y1)]

def font(size, bold=True):
    for path in ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
                 '/System/Library/Fonts/Menlo.ttc', 'C:/Windows/Fonts/consolab.ttf']:
        if os.path.exists(path):
            return ImageFont.truetype(path, px(size))
    return ImageFont.load_default()

def asset(name): return Image.open(os.path.join(ASSETS, name)).convert('RGBA')

def with_alpha(img, a):
    img = img.copy(); img.putalpha(img.getchannel('A').point(lambda v: int(v * a))); return img

def paste_center(dst, img, cx, cy, size, alpha=1.0, angle=0):
    im = img.resize((px(size), px(size)), Image.LANCZOS)
    if angle: im = im.rotate(angle, resample=Image.BICUBIC, expand=True)
    if alpha < 1: im = with_alpha(im, alpha)
    dst.alpha_composite(im, (px(cx) - im.width // 2, px(cy) - im.height // 2))

def glitch_text(d, xy, text, f, anchor='la'):
    x, y = xy
    d.text((px(x - 1.5), px(y)), text, font=f, fill=(0, 255, 255), anchor=anchor)   # cyan ghost
    d.text((px(x + 1.5), px(y)), text, font=f, fill=(255, 0, 40), anchor=anchor)    # red ghost
    d.text((px(x), px(y)), text, font=f, fill=WHITE, anchor=anchor)

# ---------------------------------------------------------------- background layer
def make_background():
    size = (px(W), px(H))
    img = Image.composite(Image.new('RGB', size, (62, 0, 6)), Image.new('RGB', size, (18, 0, 0)),
                          Image.linear_gradient('L').resize(size)).convert('RGBA')
    # static
    noise = Image.effect_noise(size, 46)
    red_noise = Image.merge('RGB', (noise.point(lambda v: int(v * 0.32)), Image.new('L', size, 0), Image.new('L', size, 0)))
    img = Image.alpha_composite(img, ImageChops.add(img.convert('RGB'), red_noise).convert('RGBA'))
    # the game's own red vignette
    vig = Image.open(os.path.join(ASSETS, 'red_vignette.gif'))
    vig.seek(7); vig = with_alpha(vig.convert('RGBA').resize(size, Image.LANCZOS), 0.85)
    img.alpha_composite(vig)
    # looming face watermark
    face = asset('ransom_attack.png')
    paste_center(img, face, W / 2, H * 0.62, 500, alpha=0.30)
    # scanlines
    sl = Image.new('RGBA', size, (0, 0, 0, 0)); sd = ImageDraw.Draw(sl)
    for y in range(0, size[1], px(3)):
        sd.line([(0, y), (size[0], y)], fill=(0, 0, 0, 46), width=max(1, S))
    img.alpha_composite(sl)
    # glitch: displaced horizontal bands + red channel split
    out = img.copy()
    for _ in range(11):
        y0 = random.randint(0, size[1] - px(16)); h = random.randint(px(2), px(15))
        dx = random.choice([-1, 1]) * random.randint(px(6), px(30))
        band = img.crop((0, y0, size[0], y0 + h)); out.paste(band, (dx, y0)); out.paste(band, (dx - size[0] * (1 if dx > 0 else -1), y0))
    r, g, b, a = out.split()
    r = ImageChops.offset(r, px(3), 0)
    return Image.merge('RGBA', (r, g, b, a))

# ---------------------------------------------------------------- UI layer
def panel(d, x0, y0, x1, y1, fill=RED, border=WHITE, bw=2):
    d.rectangle(box(x0, y0, x1, y1), fill=fill, outline=border, width=px(bw))

def draw_ui(img):
    d = ImageDraw.Draw(img)
    # top notification panel (same look as the in-game window)
    panel(d, 20, 16, 640, 100)
    paste_center(img, asset('ransom_idle.png'), 62, 58, 74)
    glitch_text(d, (108, 24), 'PAY THE RANSOM', font(31))
    d.text((px(110), px(66)), 'DRAG RANS0M ONTO APPLICATIONS TO INSTALL', font=font(12.5), fill=WHITE)
    d.text((px(110), px(83)), 'BEFORE THE TIMER RUNS OUT.', font=font(10.5, False), fill=(255, 220, 215))

    # icon plates: light enough that Finder's dark labels stay readable
    for cx in (APP_X, APPS_X):
        panel(d, cx - 64, ICON_Y - 66, cx + 64, ICON_Y + 84, bw=2)
    # trail of gold coins leading to Applications
    coin = asset('Gold.png')
    n = 5
    for i in range(n):
        t = i / (n - 1)
        paste_center(img, coin, 250 + i * 33, ICON_Y - 4 + (-1) ** i * 4, 20 + 10 * t, angle=(i * 37) % 60 - 30)
    d.polygon([(px(405), px(ICON_Y - 17)), (px(425), px(ICON_Y - 4)), (px(405), px(ICON_Y + 9))], fill=WHITE)
    d.text((px(330), px(ICON_Y + 30)), 'PRICE: 0 GOLD', font=font(12), fill=GOLD, anchor='ma')
    d.text((px(330), px(ICON_Y + 46)), '(drag to pay)', font=font(9.5, False), fill=(255, 190, 180), anchor='ma')

    # bottom HUD, mirroring the in-game timer + gold boxes
    panel(d, 20, 332, 190, 374, fill=RED)
    d.text((px(105), px(353)), 'TIME: 00:59', font=font(20), fill=BLACK, anchor='mm')
    panel(d, 470, 332, 640, 374, fill=BLACK, border=GOLD)
    d.text((px(488), px(353)), '0', font=font(24), fill=GOLD, anchor='lm')
    paste_center(img, coin, 610, 353, 30)
    d.text((px(330), px(347)), 'INSTALL NOW. IT\'S FREE.', font=font(11), fill=WHITE, anchor='mm')
    d.text((px(330), px(388)), 'unofficial fan port  ·  RANS0M by Ixar  ·  not affiliated with LSPLASH',
           font=font(8.5, False), fill=(200, 110, 105), anchor='mm')
    return img

def main():
    os.makedirs(BUILD, exist_ok=True)
    img = draw_ui(make_background()).convert('RGB')
    img.save(os.path.join(BUILD, 'background@2x.png'), optimize=True)
    img.resize((W, H), Image.LANCZOS).save(os.path.join(BUILD, 'background.png'), optimize=True)
    print(f'wrote build/background.png ({W}x{H}) and build/background@2x.png ({W*S}x{H*S})')
    if '--preview' in sys.argv:                       # mock Finder icons + labels to check readability
        prev = img.convert('RGBA'); pd = ImageDraw.Draw(prev)
        paste_center(prev, asset('../build/icon.png') if False else Image.open(os.path.join(BUILD, 'icon.png')).convert('RGBA'), APP_X, ICON_Y, 96)
        pd.rounded_rectangle(box(APPS_X - 44, ICON_Y - 40, APPS_X + 44, ICON_Y + 34), radius=px(10), fill=(64, 156, 235))
        lab = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', px(13))
        pd.text((px(APP_X), px(ICON_Y + 64)), 'RANS0M', font=lab, fill=BLACK, anchor='mm')
        pd.text((px(APPS_X), px(ICON_Y + 64)), 'Applications', font=lab, fill=BLACK, anchor='mm')
        prev.convert('RGB').save(os.path.join(BUILD, 'preview.png'))
        print('wrote build/preview.png (mock-up only; not shipped)')

if __name__ == '__main__':
    main()
