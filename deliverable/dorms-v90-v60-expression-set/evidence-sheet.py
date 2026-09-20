import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
assets = json.loads((root.parent / 'dorms-v86-approved-expression-set/APPROVED-MANIFEST.json').read_text(encoding='utf-8'))['assets']
font = ImageFont.truetype('C:/Windows/Fonts/malgun.ttf', 17)
for view in ('front', 'quarter', 'side'):
    sheet = Image.new('RGB', (1440, 6 * 220), '#f7faff')
    draw = ImageDraw.Draw(sheet)
    for i, asset in enumerate(assets):
        file = root / 'evidence/expressions' / f"{asset['id']}-{view}.png"
        if not file.exists():
            raise FileNotFoundError(file)
        im = Image.open(file).convert('RGB')
        im.thumbnail((240, 170))
        x, y = i % 6 * 240, i // 6 * 220
        sheet.paste(im, (x + (240 - im.width) // 2, y))
        draw.text((x + 6, y + 174), asset['label'], font=font, fill='#142d46')
        draw.text((x + 6, y + 195), asset['id'], font=font, fill='#142d46')
    sheet.save(root / 'evidence' / f'v60-{view}-sheet.jpg')

sheet = Image.new('RGB', (1080, 4 * 280), '#f7faff')
draw = ImageDraw.Draw(sheet)
for row, (expression, action) in enumerate((('thinking', 'HeadTilt'), ('cheering', 'Cheer'), ('greeting_smile', 'Wave'), ('teary', 'Walk'))):
    for col, progress in enumerate((0, 35, 70)):
        im = Image.open(root / 'evidence' / f'{expression}-{action}-{progress}.png').convert('RGB')
        im.thumbnail((360, 250))
        sheet.paste(im, (col * 360, row * 280))
        draw.text((col * 360 + 6, row * 280 + 252), f'{expression} / {action} / {progress}%', font=font, fill='#142d46')
sheet.save(root / 'evidence/action-sheet.jpg')
