import json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parent
assets=json.loads((root.parent/'dorms-v86-approved-expression-set/APPROVED-MANIFEST.json').read_text(encoding='utf-8'))['assets']
sheet=Image.new('RGB',(1440,6*260),'#f7faff');draw=ImageDraw.Draw(sheet);font=ImageFont.truetype('C:/Windows/Fonts/malgun.ttf',17)
for i,a in enumerate(assets):
    im=Image.open(a['qa']['front']['path']).convert('RGB');im.thumbnail((240,230));x=i%6*240;y=i//6*260;sheet.paste(im,(x+(240-im.width)//2,y));draw.text((x+6,y+234),a['label']+' / '+a['id'],font=font,fill='#142d46')
(root/'evidence').mkdir(exist_ok=True);sheet.save(root/'evidence/approved-source-sheet.jpg')
