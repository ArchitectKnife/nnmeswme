# BURGER SKIN: batch PNG -> WebP conversion for verified Steam item images (maintainer tool, needs Pillow).
# Usage: python webp.py <list.tsv> <quality>
# list.tsv lines: <src.png>\t<dst.webp>. Keeps the alpha channel, never upscales, keeps the original resolution.
import sys, os
from PIL import Image

def main():
    lst, q = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 82
    ok = bad = 0
    with open(lst, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if not line:
                continue
            src, dst = line.split('\t')
            try:
                im = Image.open(src)
                im.load()
                if im.mode not in ('RGBA', 'RGB'):
                    im = im.convert('RGBA')
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                im.save(dst, 'WEBP', quality=q, method=6, alpha_quality=95)
                print('OK\t%s\t%dx%d\t%d' % (dst, im.width, im.height, os.path.getsize(dst)))
                ok += 1
            except Exception as e:  # report and continue, the caller marks the image as missing
                print('ERR\t%s\t%s' % (dst, e))
                bad += 1
    print('DONE\t%d\t%d' % (ok, bad))

main()
