"""Prepare square, metadata-free LP tiles; source files are never modified."""
from pathlib import Path
from PIL import Image, ImageOps
from io import BytesIO
import json, sys, shutil

root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
base = root / 'assets/lp/collage'
out = base / 'generated'
if out.exists(): shutil.rmtree(out)
out.mkdir(parents=True)
manifest = {}
for group, count in [('attic-insulation/before', 8), ('attic-insulation/after', 8), ('removal/before', 8), ('removal/after', 8)]:
    folder = base / group
    folder.mkdir(parents=True, exist_ok=True)
    files = [folder / f'{n:02}.jpg' for n in range(1, count + 1) if (folder / f'{n:02}.jpg').is_file()]
    if not files:
        manifest[group] = {'placeholder': count, 'images': []}
        continue
    visible = files[:len(files) // 4 * 4]
    tiles = []
    for source in visible:
        with Image.open(source) as original:
            oriented = ImageOps.exif_transpose(original).convert('RGB')
            square = ImageOps.fit(oriented, (240, 240), method=Image.Resampling.LANCZOS, centering=(.5, .5))
            clean = Image.new('RGB', square.size)
            clean.paste(square)
            for quality in range(80, 19, -5):
                buffer = BytesIO()
                clean.save(buffer, 'WEBP', quality=quality, method=6)
                if buffer.tell() <= 18000: break
            if buffer.tell() > 18000: raise RuntimeError(f'Tile exceeds budget: {source}')
            target = out / group / (source.stem + '.webp')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(buffer.getvalue())
            tiles.append(str(target.relative_to(root / 'assets')))
    manifest[group] = {'placeholder': 0, 'images': tiles}
(root / 'data').mkdir(exist_ok=True)
(root / 'data/lp-collage-manifest.json').write_text(json.dumps(manifest, indent=2))
print('Prepared LP collages: ' + ', '.join(f'{k}: {len(v["images"])} photos, {v["placeholder"]} placeholders' for k,v in manifest.items()))
