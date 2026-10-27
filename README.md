# Vermont School District Builder

A browser-only tool for grouping Vermont's 256 towns into school districts and comparing the result with today's 52 supervisory unions and districts. A sibling of the NYC School District Builder (same layout, engine approach and build).

**Live:** https://spadaroa.github.io/VermontDistricts/

A personal project, not affiliated with the State of Vermont, the Agency of Education or VCGI. The State's own builder is at https://map.vermont.gov/education/district-builder/.

## What it does

- Paint towns into districts (click or drag; whole-SU brush; undo/redo; pan, zoom, pinch).
- Start from real maps: today's SUs; the House Education draft (Feb 2026); the Senate Education map, version 6 (Mar 2026); Act 170 (2026) merger committee groupings and CESAs; the Governor's January 2025 regions; School Boards Association regions; CTE regions; counties. Plus three generated examples.
- Size targets: 2,000+ (Act 170 merger committees), 2,000–4,000 (House draft, Feb 2026), 4,000–8,000 (Act 73 Task Force charge).
- Scorecard and Topline vs. today: districts in the size target, smallest/largest, grand list per student (highest ÷ lowest, share of students within 25% of the state figure), child poverty Theil's H, longest span, districts without a public high school, SUs split, districts in pieces.
- Districts table, shading by town or district average, dashed overlay lines, school dots.
- Auto-balance (simulated annealing, contiguity kept) with weights for size target, equal size, compactness, tax capacity, poverty mix, keeping SUs together; option to move whole SUs only.
- Plan codes (`VT1.…`, also `#plan=<code>` in the URL), town CSV, autosave in the browser.

## Layout

```
prep/build_data.py     Python: raw/ → src/data.json (towns, adjacency, borders, schools, presets)
prep/make_presets.js   Node: runs the optimizer → src/generated.json
src/engine.js          Model, metrics, optimizer (browser + Node)
src/app.js, app.css, body.html   The web app
build.js               Inlines everything into dist/index.html
docs/index.html        Copy of dist/index.html for GitHub Pages
```

## Rebuilding the data

```bash
mkdir -p raw/water raw/cousub && cd raw
curl -O https://s3.us-east-2.amazonaws.com/vtopendata-prd/_Other/Education/VT_School_Geo.json
curl -O https://s3.us-east-2.amazonaws.com/vtopendata-prd/_Other/Education/schools_all.json
curl -o cousub.zip https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_50_cousub_500k.zip && unzip -o cousub.zip -d cousub
for c in 001 007 011 013 019 021; do curl -o w$c.zip https://www2.census.gov/geo/tiger/TIGER2024/AREAWATER/tl_2024_50${c}_areawater.zip && unzip -o w$c.zip -d water; done
for t in b17001 b19013; do curl -s "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-$t.dat" | awk -F'|' 'NR==1 || $1 ~ /^0600000US50/' > acs_$t.dat; done
cd ..
pip install shapely pyshp pyproj
python3 prep/build_data.py raw src
node prep/make_presets.js
node build.js && cp dist/index.html docs/index.html
```

## Method notes

- **Building blocks:** Census 2024 cartographic county subdivisions (towns, cities, gores, grants). Large lakes (TIGER area water > 3 km²) are cut from the drawn outlines only; adjacency uses legal boundaries, so the Champlain Islands connect to the mainland through their water lines.
- **Today's map:** each town's supervisory union/district as coded by VCGI. Kingdom East, Orange East and Montpelier Roxbury are non-contiguous.
- **Act 170 merger groupings** list school districts; they're drawn by town via SU, with Wells and Middletown Springs (Wells Spring), Stratton, and Northfield and Williamstown (Paine Mountain) following their school district. Rivendell and SAU 70 are interstate and ungrouped.
- **House draft map:** the JFO 3/11/2026 analysis lists school districts per new district; translated by SU with overrides where the draft splits an SU (`HOUSE_TOWN` in build_data.py). Poultney and Roxbury are placed where the list is ambiguous; all districts land within 4% of JFO's ADM.
- **Senate map v6:** decoded from its map.vermont.gov district-builder link (`prep/vcgi_url.py`, `prep/senate_v6.url`); grey-area towns keep today's units.
- **Students:** public school students by town of residence, 2024–25 (VCGI), not AOE ADM.
- **Grand list:** equalized education grand list on the Act 73 basis (VCGI).
- **Child poverty:** ACS 2020–2024 5-year, B17001, ages 5–17.
- **High schools:** public schools reporting grades 9–12 enrollment; independent 9–12 schools are counted separately.

## Data sources

VCGI (VT_School_Geo.json, schools_all.json); U.S. Census Bureau (cartographic boundaries, TIGER/Line area water, ACS 5-year summary file); Vermont Legislature, Act 170 of 2026 (H.955), Secs. 2 and 14.
