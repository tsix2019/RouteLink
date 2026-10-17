#!/usr/bin/env python3
"""Build the RouteLink website into website/dist (or --out).

- copies website/src;
- checks src/i18n/{en,zh}.json: same keys, no empty strings, same {{vars}}; every key the HTML and
  the scripts use must exist;
- pre-renders the Chinese text into index.html, so the page reads without JavaScript;
- converts docs/screenshots and the widget previews to WebP under media/ (kept between builds;
  images newer than their source are skipped), and writes the icons and the social preview.

Needs Python 3.10+ and Pillow. Usage: python website/build.py [--out DIR] [--no-images]
"""
import argparse
import html
import json
import re
import shutil
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'website' / 'src'
SCREENSHOTS = ROOT / 'docs' / 'screenshots'
DEFAULT_LANG = 'zh'
LANGS = ('zh', 'en')
VAR = re.compile(r'{{\s*(\w+)\s*}}')


# ---------- i18n ----------

def flatten(tree: dict, prefix: str = '') -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in tree.items():
        path = f'{prefix}{key}'
        if isinstance(value, dict):
            out.update(flatten(value, path + '.'))
        else:
            out[path] = value
    return out


def load_messages() -> dict[str, dict[str, str]]:
    messages = {lang: flatten(json.loads((SRC / 'i18n' / f'{lang}.json').read_text(encoding='utf-8'))) for lang in LANGS}
    errors = []
    base = messages[LANGS[0]]
    for lang in LANGS[1:]:
        other = messages[lang]
        for key in sorted(base.keys() - other.keys()):
            errors.append(f'{lang}: missing {key}')
        for key in sorted(other.keys() - base.keys()):
            errors.append(f'{LANGS[0]}: missing {key}')
        for key in sorted(base.keys() & other.keys()):
            if set(VAR.findall(base[key])) != set(VAR.findall(other[key])):
                errors.append(f'{key}: {{{{vars}}}} differ between {LANGS[0]} and {lang}')
    for lang, msgs in messages.items():
        for key, value in msgs.items():
            if not isinstance(value, str) or not value.strip():
                errors.append(f'{lang}: {key} is empty or not a string')
    if errors:
        raise SystemExit('i18n check failed:\n  ' + '\n  '.join(errors))
    return messages


I18N_TEXT = re.compile(r'(<(\w+)\b[^>]*?\sdata-i18n(-html)?="([^"]+)"[^>]*>)(.*?)(</\2>)', re.S)
I18N_ATTR = re.compile(r'<\w+\b[^>]*?\sdata-i18n-attr="([^"]+)"[^>]*>')
SCRIPT_KEY = re.compile(r"""\bt\(\s*['"]([\w.-]+)['"]""")


def attr_pairs(spec: str) -> list[tuple[str, str]]:
    return [tuple(p.split(':', 1)) for p in spec.split(';') if p.strip()]  # type: ignore[misc]


def used_keys(page: str) -> set[str]:
    keys = {m.group(4) for m in I18N_TEXT.finditer(page)}
    for m in I18N_ATTR.finditer(page):
        keys.update(key for _, key in attr_pairs(m.group(1)))
    for script in (SRC / 'js').glob('*.js'):
        keys.update(SCRIPT_KEY.findall(script.read_text(encoding='utf-8')))
    return keys


def set_attr(tag: str, name: str, value: str) -> str:
    value = html.escape(value, quote=True)
    pattern = re.compile(rf'(\s{re.escape(name)}=")[^"]*(")')
    if pattern.search(tag):
        return pattern.sub(lambda m: f'{m.group(1)}{value}{m.group(2)}', tag, count=1)
    return re.sub(r'\s*(/?)>$', lambda m: f' {name}="{value}"{m.group(1)}>', tag, count=1)


def prerender(page: str, msgs: dict[str, str], version: str) -> str:
    def fill(m: re.Match) -> str:
        open_tag, _, is_html, key, inner, close = m.groups()
        if inner.strip():
            raise SystemExit(f'index.html: element with data-i18n="{key}" must be empty in the source')
        value = msgs[key] if is_html else html.escape(msgs[key], quote=False)
        return f'{open_tag}{value}{close}'

    page = I18N_TEXT.sub(fill, page)

    def fill_attrs(m: re.Match) -> str:
        tag = m.group(0)
        for name, key in attr_pairs(m.group(1)):
            tag = set_attr(tag, name, msgs[key])
        return tag

    page = I18N_ATTR.sub(fill_attrs, page)
    return page.replace('__VERSION__', version)


# ---------- images ----------

def to_webp(job: tuple[str, str, int, int]) -> str:
    from PIL import Image

    src, dest, width, quality = job
    with Image.open(src) as im:
        im.load()
        if im.mode == 'RGBA' and im.getchannel('A').getextrema() == (255, 255):
            im = im.convert('RGB')  # opaque screenshots: no alpha plane in the WebP
        elif im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA' if 'A' in im.getbands() else 'RGB')
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, 'WEBP', quality=quality, method=6)
    return dest


def image_jobs(media: Path) -> list[tuple[str, str, int, int]]:
    jobs = []
    for lang in LANGS:
        for png in sorted((SCREENSHOTS / lang).glob('*.png')):
            jobs.append((png, media / 'shots' / lang / f'{png.stem}.webp', 720, 82))
            jobs.append((png, media / 'shots' / lang / f'{png.stem}-360.webp', 360, 80))
    for png in sorted((SCREENSHOTS / 'luci').glob('*.png')):
        jobs.append((png, media / 'luci' / f'{png.stem}.webp', 1280, 84))
        jobs.append((png, media / 'luci' / f'{png.stem}-640.webp', 640, 80))
    for png in sorted((ROOT / 'assets' / 'images').glob('widget-preview-*.png')):
        jobs.append((png, media / 'widgets' / f'{png.stem}.webp', 720, 86))
    return [
        (str(src), str(dest), width, quality)
        for src, dest, width, quality in jobs
        if not dest.exists() or dest.stat().st_mtime < src.stat().st_mtime
    ]


def font(size: int):
    from PIL import ImageFont

    for path in (
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        'C:/Windows/Fonts/segoeuib.ttf',
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return None


def rounded(im, radius: int):
    from PIL import Image, ImageDraw

    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius, fill=255)
    out = im.convert('RGBA')
    out.putalpha(mask)
    return out


def phone(shot: Path, width: int, bezel: str):
    """A screenshot in a simple rounded frame, for the social preview."""
    from PIL import Image

    with Image.open(shot) as im:
        screen = im.convert('RGB').resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    pad = max(6, width // 36)
    frame = Image.new('RGBA', (width + pad * 2, screen.height + pad * 2), (0, 0, 0, 0))
    body = rounded(Image.new('RGB', frame.size, bezel), round(frame.width * 0.15))
    frame.alpha_composite(body)
    frame.alpha_composite(rounded(screen, round(width * 0.13)), (pad, pad))
    return frame


def social_preview(dest: Path) -> None:
    from PIL import Image, ImageDraw, ImageFilter

    w, h = 1200, 630
    bg = Image.new('RGB', (w, h))
    px = ImageDraw.Draw(bg)
    for x in range(w):  # the icon's blue -> teal, left to right
        t = x / (w - 1)
        px.line([(x, 0), (x, h)], fill=(round(10 + t * 10), round(91 + t * 109), round(255 - t * 55)))
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((620, -260, 1420, 540), fill=(255, 255, 255, 70))
    bg = Image.alpha_composite(bg.convert('RGBA'), glow.filter(ImageFilter.GaussianBlur(120)))

    back = phone(SCREENSHOTS / 'en' / 'android-devices-dark.png', 250, '#111418').rotate(8, Image.BICUBIC, expand=True)
    front = phone(SCREENSHOTS / 'en' / 'ios-overview-light.png', 270, '#1c1f24').rotate(-6, Image.BICUBIC, expand=True)
    for layer, pos in ((back, (880, 70)), (front, (660, 40))):
        shadow = Image.new('RGBA', bg.size, (0, 0, 0, 0))
        shadow.paste((0, 20, 60, 110), (pos[0] + 20, pos[1] + 30), layer.getchannel('A'))
        bg = Image.alpha_composite(bg, shadow.filter(ImageFilter.GaussianBlur(24)))
        bg.alpha_composite(layer, pos)

    with Image.open(ROOT / 'assets' / 'images' / 'icon.png') as icon:
        icon = rounded(icon.convert('RGB').resize((132, 132), Image.LANCZOS), 30)
    ring = rounded(Image.new('RGB', (140, 140), 'white'), 34)
    bg.alpha_composite(ring, (76, 156))
    bg.alpha_composite(icon, (80, 160))
    draw = ImageDraw.Draw(bg)
    title, sub = font(84), font(36)
    if title and sub:
        draw.text((76, 330), 'RouteLink', font=title, fill='white')
        draw.text((80, 440), 'OpenWrt in your pocket', font=sub, fill=(255, 255, 255, 230))
        draw.text((80, 492), 'iOS  ·  Android  ·  English / Chinese', font=sub, fill=(255, 255, 255, 200))
    bg.convert('RGB').save(dest, 'PNG', optimize=True)


def icons(out: Path, media: Path) -> None:
    from PIL import Image

    shutil.copyfile(ROOT / 'assets' / 'icon' / 'routelink.svg', out / 'favicon.svg')
    with Image.open(ROOT / 'assets' / 'images' / 'icon.png') as icon:
        icon.convert('RGB').resize((180, 180), Image.LANCZOS).save(media / 'icon-180.png', optimize=True)
        icon.convert('RGB').resize((512, 512), Image.LANCZOS).save(media / 'icon-512.png', optimize=True)


# ---------- main ----------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--out', type=Path, default=ROOT / 'website' / 'dist')
    parser.add_argument('--no-images', action='store_true', help='skip the WebP conversion (media/ must exist)')
    args = parser.parse_args()
    out: Path = args.out.resolve()

    messages = load_messages()
    page = (SRC / 'index.html').read_text(encoding='utf-8')
    missing = sorted(k for k in used_keys(page) if k not in messages[DEFAULT_LANG])
    if missing:
        raise SystemExit('i18n keys used but not defined:\n  ' + '\n  '.join(missing))

    # everything but media/ is rebuilt from scratch
    out.mkdir(parents=True, exist_ok=True)
    for child in out.iterdir():
        if child.name != 'media':
            shutil.rmtree(child) if child.is_dir() else child.unlink()
    shutil.copytree(SRC, out, dirs_exist_ok=True)
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    (out / 'index.html').write_text(prerender(page, messages[DEFAULT_LANG], version), encoding='utf-8')

    media = out / 'media'
    media.mkdir(exist_ok=True)
    if not args.no_images:
        jobs = image_jobs(media)
        if jobs:
            with ProcessPoolExecutor() as pool:
                for _ in pool.map(to_webp, jobs, chunksize=4):
                    pass
        print(f'{len(jobs)} images converted')
        icons(out, media)
        social_preview(media / 'og.png')
    elif not (media / 'shots').exists():
        raise SystemExit('--no-images needs a previous build with images')
    else:
        shutil.copyfile(ROOT / 'assets' / 'icon' / 'routelink.svg', out / 'favicon.svg')
    print(f'built {out} (v{version}, {len(messages[DEFAULT_LANG])} strings)')


if __name__ == '__main__':
    sys.exit(main())
