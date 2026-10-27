"""Decode a map.vermont.gov district-builder share link (V8 format) into {district name: [TOWNGEOID,...]}."""
import base64, zlib, json, sys, urllib.parse
B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
def b62(s):
    n = 0
    for c in s: n = n * 62 + B62.index(c)
    return n
def decode(data, geo_json):
    obj = {f['properties']['OBJECTID']: f['properties']['TOWNGEOID'] for f in json.load(open(geo_json))['features']}
    raw = base64.urlsafe_b64decode(data + '=' * (-len(data) % 4))
    s = zlib.decompress(raw).decode()
    parts = s.split('|'); assert parts[0] == 'V8', parts[0]
    out = []
    for entry in parts[2].split(';'):
        i, name, towns = (entry.split(',') + ['', ''])[:3]
        ids = []
        for run in filter(None, towns.split('.')):
            if '~' in run:
                a, l = run.split('~'); a = b62(a); ids += range(a, a + b62(l) + 1)
            else: ids.append(b62(run))
        out.append((urllib.parse.unquote(name), [obj[k] for k in ids]))
    return urllib.parse.unquote(parts[1]), out
if __name__ == '__main__':
    name, ds = decode(sys.argv[1], sys.argv[2])
    print(name); [print(n, len(t)) for n, t in ds]
