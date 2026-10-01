"""Hydrate only Doreumi web inputs in an existing creator checkout, without git-lfs.

Uses the user's gh authentication in memory. Neither tokens nor signed asset URLs are logged.
Usage: python3 scripts/doreumi/assets-fetch.py --source=/path/to/doreumi-desktop-pet
"""
import argparse
import base64
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
root = pathlib.Path(parser.parse_args().source).resolve()
revision = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
if revision != 'b2cb2a6f7646a298c577a2dbe510a2a75cb9161b':
    raise RuntimeError('Creator revision differs from the approved source pin.')
prefix = 'deliverable/dorms-v86-approved-expression-set/'
registry = json.loads((root / (prefix + 'APPROVED-MANIFEST.json')).read_text())
paths = [
    'deliverable/dorms-v60-final-shoulder/models/basic.glb',
    'deliverable/dorms-v89-v60-neutral-face/data/neutral-position-delta.bin',
    'deliverable/dorms-v89-v60-neutral-face/data/neutral-normal-delta.bin',
    prefix + registry['assets'][0]['model'],
] + [prefix + asset['texture'] for asset in registry['assets']]
for prop in ['megaphone', 'christmas-gift-sack']:
    paths += [f'deliverable/dorms-v48-premium-props/props/{prop}.glb',
              f'deliverable/dorms-v98-badge-integration/data/prop-textures/{prop}.png']
items = []
for relative in paths:
    file = (root / relative).resolve()
    if not file.is_relative_to(root):
        raise RuntimeError('Asset path escapes creator repository.')
    data = file.read_bytes()
    if not data.startswith(b'version https://git-lfs.github.com/spec/v1'):
        continue
    lines = data.decode().splitlines()
    items.append((file, lines[1].split(':', 1)[1], int(lines[2].split()[1])))
if not items:
    print('All selected inputs are hydrated. Run assets-build.mjs to verify approval hashes.')
    raise SystemExit(0)
token = subprocess.check_output(['gh', 'auth', 'token'], text=True).strip()
authorization = base64.b64encode(('x-access-token:' + token).encode()).decode()
request = urllib.request.Request(
    'https://github.com/ainssam/doreumi-desktop-pet.git/info/lfs/objects/batch',
    data=json.dumps({'operation': 'download', 'transfers': ['basic'], 'objects': [
        {'oid': oid, 'size': size} for _, oid, size in items]}).encode(),
    headers={'Authorization': 'Basic ' + authorization,
             'Accept': 'application/vnd.git-lfs+json', 'Content-Type': 'application/vnd.git-lfs+json'},
)
with urllib.request.urlopen(request, timeout=30) as response:
    objects = {obj['oid']: obj for obj in json.load(response)['objects']}
del token, authorization, request

def hydrate(item):
    file, oid, size = item
    action = objects[oid]['actions']['download']
    with urllib.request.urlopen(urllib.request.Request(action['href'], headers=action.get('header', {})), timeout=90) as response:
        data = response.read()
    if len(data) != size or hashlib.sha256(data).hexdigest() != oid:
        raise RuntimeError(f'LFS integrity mismatch: {file.relative_to(root)}')
    file.write_bytes(data)
    return str(file.relative_to(root))

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for index, relative in enumerate(pool.map(hydrate, items), start=1):
        print(f'{index}/{len(items)} verified {relative}', flush=True)
