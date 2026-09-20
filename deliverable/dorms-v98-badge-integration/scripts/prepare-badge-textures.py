"""Extract and resize original embedded badge base colors; never edits V97 assets."""
import io,json,struct,hashlib
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1];source_root=root.parent/'dorms-v97-badge-collection';manifest=json.loads((source_root/'integration-manifest.json').read_text(encoding='utf-8'));out=root/'data/badge-textures';out.mkdir(parents=True,exist_ok=True);report={}
for item in manifest['entries']:
    source=source_root/item['model'];raw=source.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);image_desc=doc['images'][0];view=doc['bufferViews'][image_desc['bufferView']];start=28+length+view.get('byteOffset',0);encoded=raw[start:start+view['byteLength']];image=Image.open(io.BytesIO(encoded)).convert('RGB');original=image.size;image.thumbnail((2048,2048),Image.Resampling.LANCZOS);target=out/f"{item['id']}.png";image.save(target)
    report[item['id']]={'source':str(source),'sourceSHA256':hashlib.sha256(raw).hexdigest(),'originalSize':original,'runtimeSize':image.size,'runtime':str(target),'runtimeSHA256':hashlib.sha256(target.read_bytes()).hexdigest(),'operation':'embedded original RGB, Lanczos resize only; no repaint or geometry edit'}
(root/'reports/badge-textures.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'count':len(report),'sizes':{k:v['runtimeSize'] for k,v in report.items()}}))
