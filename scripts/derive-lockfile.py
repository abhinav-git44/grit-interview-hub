"""Derive package-lock.json (v3) for this project from a larger, already-resolved npm lockfile.
Used because the build machine had no registry access; every entry keeps its real `resolved` URL and `integrity` hash.
Usage: python3 scripts/derive-lockfile.py <source package-lock.json> > package-lock.json"""
import json, sys, os
src = json.load(open(sys.argv[1]))['packages']
pkg = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'package.json')))
roots = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
dev_only = set(pkg.get('devDependencies', {}))

def find(name, from_path):
    # npm resolution: walk up nested node_modules folders, then the top level
    p = from_path
    while True:
        cand = (p + '/node_modules/' if p else 'node_modules/') + name
        if cand in src: return cand
        if not p: return None
        idx = p.rfind('/node_modules/')
        p = p[:idx] if idx >= 0 else ''

out, prod = {}, set()
def walk(path, is_prod):
    if path in out:
        if is_prod: prod.add(path)
        return
    out[path] = dict(src[path])
    if is_prod: prod.add(path)
    meta = src[path]
    for dep in {**meta.get('dependencies', {}), **meta.get('optionalDependencies', {}), **meta.get('peerDependencies', {})}:
        if dep in meta.get('peerDependenciesMeta', {}) and meta['peerDependenciesMeta'][dep].get('optional'): continue
        r = find(dep, path)
        if r: walk(r, is_prod)

for name, ver in roots.items():
    path = 'node_modules/' + name
    if path not in src: sys.exit(f'missing {name}')
    if src[path].get('version') != ver: sys.exit(f'{name}: lock has {src[path].get("version")}, package.json pins {ver}')
    walk(path, name not in dev_only)
# re-walk prod roots so shared deps are marked prod
for name in pkg.get('dependencies', {}): walk('node_modules/' + name, True)
for path, entry in out.items():
    entry.pop('dev', None); entry.pop('peer', None)
    if path not in prod: entry['dev'] = True
root = {'name': pkg['name'], 'version': pkg['version'], 'dependencies': pkg.get('dependencies', {}), 'devDependencies': pkg.get('devDependencies', {}), 'engines': pkg.get('engines', {})}
lock = {'name': pkg['name'], 'version': pkg['version'], 'lockfileVersion': 3, 'requires': True, 'packages': {'': root, **dict(sorted(out.items()))}}
print(json.dumps(lock, indent=2))
