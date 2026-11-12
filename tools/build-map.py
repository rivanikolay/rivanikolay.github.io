"""Builds the data for the hero map: python3 tools/build-map.py

Downloads swisstopo open data for the See-Gaster region and writes
  assets/map/dem.png    heights on a 40 m grid, in decimetres (red = high byte, green = low byte)
  assets/map/water.json lake shores, rivers, canals and streams (VECTOR25), in metres from the grid's top-left corner
Source: Federal Office of Topography swisstopo.
"""
import json
import struct
import time
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

E0, E1, N0, N1, STEP = 2698400, 2720800, 1222600, 1238200, 40
COLS, ROWS = (E1 - E0) // STEP + 1, (N1 - N0) // STEP + 1
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'map'
API = 'https://api3.geo.admin.ch/rest/services'


def get(url):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=60) as res:
                return json.load(res)
        except Exception as err:  # the service occasionally drops a request
            last = err
            time.sleep(1.5 * (attempt + 1))
    raise last


def height_row(r):
    n = N1 - r * STEP
    geom = json.dumps({'type': 'LineString', 'coordinates': [[E0, n], [E1, n]]})
    pts = get(f'{API}/profile.json?' + urllib.parse.urlencode(
        {'geom': geom, 'sr': 2056, 'nb_points': COLS, 'distinct_points': 'true'}))
    if len(pts) != COLS:
        raise ValueError(f'row {r} has {len(pts)} points')
    return [round(p['alts']['COMB'] * 10) for p in pts]


def write_png(path, width, height, pixel_rows):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

    raw = bytearray()
    prev = bytes(width * 3)
    for row in pixel_rows:
        raw.append(2)  # "Up" filter: neighbouring rows of a height model are nearly the same
        raw += bytes((b - p) & 255 for b, p in zip(row, prev))
        prev = row
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(bytes(raw), 9)))
        f.write(chunk(b'IEND', b''))


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    length = (dx * dx + dy * dy) ** .5 or 1
    idx, dmax = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / length
        if d > dmax:
            idx, dmax = i, d
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def water_tile(box, depth=0):
    """The identify service returns at most 200 features, so busy tiles are split in four."""
    q = urllib.parse.urlencode({
        'geometry': ','.join(map(str, box)), 'geometryType': 'esriGeometryEnvelope',
        'layers': 'all:ch.swisstopo.vec25-gewaessernetz_referenz', 'mapExtent': f'{E0},{N0},{E1},{N1}',
        'imageDisplay': '1300,1000,96', 'tolerance': 0, 'returnGeometry': 'true',
        'geometryFormat': 'geojson', 'sr': 2056, 'limit': 200})
    res = get(f'{API}/all/MapServer/identify?' + q)['results']
    if len(res) >= 200 and depth < 4:
        e0, n0, e1, n1 = box
        em, nm = (e0 + e1) // 2, (n0 + n1) // 2
        return [f for b in ([e0, n0, em, nm], [em, n0, e1, nm], [e0, nm, em, n1], [em, nm, e1, n1])
                for f in water_tile(b, depth + 1)]
    return res


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    with ThreadPoolExecutor(6) as pool:
        rows = list(pool.map(height_row, range(ROWS)))
    write_png(OUT / 'dem.png', COLS, ROWS,
              [bytes(c for v in row for c in (v >> 8, v & 255, 0)) for row in rows])

    boxes = [[e, n, min(e + 4000, E1), min(n + 4000, N1)] for e in range(E0, E1, 4000) for n in range(N0, N1, 4000)]
    features = {}
    with ThreadPoolExecutor(4) as pool:
        for res in pool.map(water_tile, boxes):
            for f in res:
                features[f['featureId']] = f

    kinds = {'See': 'lake', 'Seeinsel': 'lake', 'Fluss': 'river', 'Kanal': 'canal', 'Bach': 'stream'}
    waters = []
    for f in features.values():
        kind = kinds.get(f['properties'].get('objectval'))
        g = f['geometry']
        lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']] if g['type'] == 'LineString' else []
        if not kind:
            continue
        for line in lines:
            pts = simplify([[round(x), round(y)] for x, y, *_ in line], 6 if kind != 'stream' else 10)
            if sum(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** .5 for a, b in zip(pts, pts[1:])) < 80:
                continue
            if all(x < E0 or x > E1 or y < N0 or y > N1 for x, y in pts):
                continue
            waters.append({'k': kind, 'p': [c for x, y in pts for c in (x - E0, N1 - y)]})

    meta = {'e0': E0, 'n1': N1, 'step': STEP, 'cols': COLS, 'rows': ROWS, 'lake': 405.9,
            'source': 'Federal Office of Topography swisstopo'}
    with open(OUT / 'water.json', 'w') as f:
        json.dump({'grid': meta, 'waters': waters}, f, separators=(',', ':'))
    print(f'dem.png {COLS}x{ROWS}, {len(waters)} water lines')


if __name__ == '__main__':
    main()
