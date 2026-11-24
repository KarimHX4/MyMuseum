"""Génère les icônes de MyMuseum (PWA + Android). Usage : python3 scripts/make_icons.py"""
from PIL import Image, ImageDraw
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WALL = (92, 24, 37, 255); BRASS = (201, 158, 82, 255); BRASS_D = (156, 113, 40, 255)
MAT = (251, 249, 245, 255); CANVAS = (42, 35, 38, 255); SUN = (230, 186, 98, 255); HILL = (122, 44, 58, 255)

def motif(size, scale=1.0):
    """Cadre doré + tableau, centré, sur fond transparent."""
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    w = S * 0.50 * scale; h = S * 0.62 * scale; cx = cy = S / 2
    x0, y0, x1, y1 = cx - w/2, cy - h/2, cx + w/2, cy + h/2
    fr = S * 0.045 * scale
    d.rectangle([x0, y0, x1, y1], fill=BRASS)
    d.rectangle([x0 + fr*0.35, y0 + fr*0.35, x1 - fr*0.35, y1 - fr*0.35], outline=BRASS_D, width=max(2, int(fr*0.18)))
    m0 = (x0 + fr, y0 + fr, x1 - fr, y1 - fr); d.rectangle(m0, fill=MAT)
    mat = S * 0.035 * scale
    c0 = (m0[0] + mat, m0[1] + mat, m0[2] - mat, m0[3] - mat); d.rectangle(c0, fill=CANVAS)
    cw = c0[2] - c0[0]; ch = c0[3] - c0[1]
    r = cw * 0.17; sx = c0[0] + cw * 0.66; sy = c0[1] + ch * 0.32
    d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=SUN)
    d.polygon([(c0[0], c0[3]), (c0[0], c0[1] + ch*0.70), (c0[0] + cw*0.38, c0[1] + ch*0.50), (c0[0] + cw*0.70, c0[1] + ch*0.72), (c0[2], c0[1] + ch*0.60), (c0[2], c0[3])], fill=HILL)
    return im.resize((size, size), Image.LANCZOS)

def full(size, radius=0.22, circle=False, scale=1.0):
    S = size * 4
    bg = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(bg)
    if circle: d.ellipse([0, 0, S-1, S-1], fill=WALL)
    elif radius: d.rounded_rectangle([0, 0, S-1, S-1], radius=int(S*radius), fill=WALL)
    else: d.rectangle([0, 0, S, S], fill=WALL)
    bg = bg.resize((size, size), Image.LANCZOS)
    bg.alpha_composite(motif(size, scale))
    return bg

icons = os.path.join(ROOT, 'icons'); os.makedirs(icons, exist_ok=True)
full(192).save(os.path.join(icons, 'icon-192.png'))
full(512).save(os.path.join(icons, 'icon-512.png'))
full(512, radius=0, scale=0.8).save(os.path.join(icons, 'maskable-512.png'))
full(1024).save(os.path.join(ROOT, 'icon.png'))

res = os.path.join(ROOT, 'android-res')
for dens, s, fg in [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216), ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]:
    p = os.path.join(res, 'mipmap-' + dens); os.makedirs(p, exist_ok=True)
    full(s).save(os.path.join(p, 'ic_launcher.png'))
    full(s, circle=True, scale=0.9).save(os.path.join(p, 'ic_launcher_round.png'))
    motif(fg, scale=0.72).save(os.path.join(p, 'ic_launcher_foreground.png'))
v = os.path.join(res, 'values'); os.makedirs(v, exist_ok=True)
open(os.path.join(v, 'ic_launcher_background.xml'), 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#5C1825</color>\n</resources>\n')
print('icônes générées')
