import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';

// ---- Types ----

type FactionName = 'red' | 'green' | 'blue' | 'neutral';
type SectorAttribute = 'asteroid' | 'neutral_npc' | 'black_hole' | 'rich_minerals' | 'nebula' | 'station';

interface SectorData {
  q: number;
  r: number;
  faction: FactionName;
  attributes: SectorAttribute[];
}

interface IconInfo {
  attr: SectorAttribute;
  wx: number; // world-space x
  wy: number; // world-space y
}

// ---- Constants ----

const HEX_SIZE = 50;
const MAP_HEX_COUNT = 90;
const MAP_SEED = 7531;

const HOVER_SHRINK = 0.87;
const HOVER_LERP = 0.16;
const ICON_HIT_RADIUS = 13; // screen-space px for tooltip trigger

const FACTION_FILL: Record<FactionName, number> = {
  red:     0xd97070,
  green:   0x70c878,
  blue:    0x6890d8,
  neutral: 0x607080,
};

const FACTION_BORDER: Record<FactionName, number> = {
  red:     0xff5555,
  green:   0x44dd66,
  blue:    0x5577ff,
  neutral: 0x445566,
};

const FACTION_LABEL: Record<FactionName, string> = {
  red:     'CRIMSON EMPIRE',
  green:   'VERDANT UNION',
  blue:    'AZURE DOMINION',
  neutral: '',
};

const ATTR_TOOLTIPS: Record<SectorAttribute, string> = {
  asteroid:      'Asteroid Field',
  neutral_npc:   'Neutral Inhabitants',
  black_hole:    'Black Hole',
  rich_minerals: 'Rich Minerals',
  nebula:        'Nebula Cloud',
  station:       'Space Station',
};

const NAMED_FACTIONS: FactionName[] = ['red', 'green', 'blue'];

// Flat-top hexagon: neighbor direction for each edge index 0–5.
// Vertices are at angles 0°,60°,120°,180°,240°,300° (screen-space, y-down).
// Edge i runs from vertex i to vertex (i+1)%6 and faces the neighbor listed here.
const HEX_DIRS: Array<{ q: number; r: number }> = [
  { q:  1, r:  0 }, // edge 0: v0(right) → v1(lower-right)     → neighbor E
  { q:  0, r:  1 }, // edge 1: v1(lower-right) → v2(lower-left) → neighbor S
  { q: -1, r:  1 }, // edge 2: v2(lower-left) → v3(left)        → neighbor SW
  { q: -1, r:  0 }, // edge 3: v3(left) → v4(upper-left)        → neighbor W
  { q:  0, r: -1 }, // edge 4: v4(upper-left) → v5(upper-right) → neighbor N
  { q:  1, r: -1 }, // edge 5: v5(upper-right) → v0(right)      → neighbor NE
];

// ---- Utility ----

function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

/** Flat-top axial → pixel center. */
function hexToPixel(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * 1.5 * q,
    y: HEX_SIZE * Math.sqrt(3) * (r + q * 0.5),
  };
}

/** Pixel → flat-top axial (rounded to nearest hex). */
function pixelToHex(px: number, py: number): { q: number; r: number } {
  const fracQ = (2 / 3) * px / HEX_SIZE;
  const fracR = (-1 / 3 * px + (Math.sqrt(3) / 3) * py) / HEX_SIZE;
  const fracS = -fracQ - fracR;
  let rq = Math.round(fracQ);
  let rr = Math.round(fracR);
  const rs = Math.round(fracS);
  const dq = Math.abs(rq - fracQ);
  const dr = Math.abs(rr - fracR);
  const ds = Math.abs(rs - fracS);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds)        rr = -rq - rs;
  return { q: rq, r: rr };
}

/** Flat-top hex vertices at (cx, cy) with given size; returns flat [x0,y0,x1,y1,...]. */
function hexVerts(cx: number, cy: number, size: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push(cx + size * Math.cos(a), cy + size * Math.sin(a));
  }
  return pts;
}

function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---- Map Generation ----

function generateSectors(seed: number): Map<string, SectorData> {
  const rng = makeLCG(seed);
  const map = new Map<string, SectorData>();

  map.set(hexKey(0, 0), { q: 0, r: 0, faction: 'neutral', attributes: [] });
  const frontier: Array<{ q: number; r: number }> = HEX_DIRS.map(d => ({ q: d.q, r: d.r }));

  while (map.size < MAP_HEX_COUNT && frontier.length > 0) {
    const idx = Math.floor(rng() * frontier.length);
    const [cand] = frontier.splice(idx, 1);
    const k = hexKey(cand.q, cand.r);
    if (map.has(k)) continue;

    let nCount = 0;
    for (const d of HEX_DIRS) {
      if (map.has(hexKey(cand.q + d.q, cand.r + d.r))) nCount++;
    }
    if (nCount === 0) continue;
    if (nCount >= 5 && rng() < 0.80) { frontier.push(cand); continue; }
    if (nCount >= 4 && rng() < 0.50) { frontier.push(cand); continue; }

    map.set(k, { q: cand.q, r: cand.r, faction: 'neutral', attributes: [] });
    for (const d of HEX_DIRS) {
      const nk = hexKey(cand.q + d.q, cand.r + d.r);
      if (!map.has(nk)) frontier.push({ q: cand.q + d.q, r: cand.r + d.r });
    }
  }

  assignFactions(map, rng);
  assignAttributes(map, rng);
  return map;
}

function assignFactions(map: Map<string, SectorData>, rng: () => number): void {
  const sectors = Array.from(map.values());
  const seeds: SectorData[] = [];

  for (const faction of NAMED_FACTIONS) {
    let best: SectorData | null = null;
    let bestDist = -Infinity;
    for (let attempt = 0; attempt < 40; attempt++) {
      const cand = sectors[Math.floor(rng() * sectors.length)];
      if (cand.faction !== 'neutral') continue;
      let minDist = seeds.length === 0 ? 9999 : Infinity;
      for (const s of seeds) {
        minDist = Math.min(minDist, Math.hypot(cand.q - s.q, cand.r - s.r));
      }
      if (minDist > bestDist) { bestDist = minDist; best = cand; }
    }
    if (best) { best.faction = faction; seeds.push(best); }
  }

  const queues = new Map<FactionName, SectorData[]>(
    NAMED_FACTIONS.map((f, i) => [f, [seeds[i]]]),
  );
  const target = Math.floor(sectors.length * 0.22);
  const claimed = new Map<FactionName, number>(NAMED_FACTIONS.map(f => [f, 1]));

  let active = true;
  while (active) {
    active = false;
    for (const faction of NAMED_FACTIONS) {
      const q = queues.get(faction)!;
      if (!q.length || (claimed.get(faction) ?? 0) >= target) continue;
      const hex = q.shift()!;
      for (const d of [...HEX_DIRS].sort(() => rng() - 0.5)) {
        const nb = map.get(hexKey(hex.q + d.q, hex.r + d.r));
        if (nb && nb.faction === 'neutral') {
          nb.faction = faction;
          claimed.set(faction, (claimed.get(faction) ?? 0) + 1);
          q.push(nb);
          active = true;
        }
      }
    }
  }
}

const ATTR_POOL: SectorAttribute[] = [
  'asteroid', 'neutral_npc', 'black_hole', 'rich_minerals', 'nebula', 'station',
];

function assignAttributes(map: Map<string, SectorData>, rng: () => number): void {
  for (const s of map.values()) {
    const n = rng() < 0.35 ? 0 : rng() < 0.55 ? 1 : 2;
    const avail = [...ATTR_POOL];
    const picked: SectorAttribute[] = [];
    for (let i = 0; i < n; i++) {
      picked.push(avail.splice(Math.floor(rng() * avail.length), 1)[0]);
    }
    s.attributes = picked;
  }
}

/** BFS to collect all keys in the same-faction cluster containing startKey. */
function getContiguousTerritory(hexMap: Map<string, SectorData>, startKey: string): string[] {
  const start = hexMap.get(startKey);
  if (!start) return [];
  const faction = start.faction;
  const visited = new Set<string>();
  const queue: string[] = [startKey];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    const s = hexMap.get(key);
    if (!s || s.faction !== faction) continue;
    visited.add(key);
    for (const d of HEX_DIRS) {
      queue.push(hexKey(s.q + d.q, s.r + d.r));
    }
  }
  return Array.from(visited);
}

// ---- Rendering Helpers ----

function drawHexPoly(
  gfx: PIXI.Graphics,
  cx: number, cy: number, size: number,
  fill: number, fillAlpha: number,
  lineWidth: number, lineColor: number, lineAlpha: number,
): void {
  gfx.lineStyle(lineWidth, lineColor, lineAlpha);
  gfx.beginFill(fill, fillAlpha);
  const v = hexVerts(cx, cy, size);
  gfx.moveTo(v[0], v[1]);
  for (let i = 2; i < v.length; i += 2) gfx.lineTo(v[i], v[i + 1]);
  gfx.closePath();
  gfx.endFill();
}

function buildStaticHexGraphics(map: Map<string, SectorData>): PIXI.Graphics {
  const gfx = new PIXI.Graphics();
  for (const s of map.values()) {
    const { x, y } = hexToPixel(s.q, s.r);
    // Very subtle grey inner border — just enough to distinguish adjacent cells
    drawHexPoly(gfx, x, y, HEX_SIZE * 0.97,
      FACTION_FILL[s.faction], 0.62,
      0.6, 0x5a6a7a, 0.18);
  }
  return gfx;
}

function buildBorderGraphics(map: Map<string, SectorData>): PIXI.Graphics {
  const gfx = new PIXI.Graphics();
  for (const faction of NAMED_FACTIONS) {
    const color = FACTION_BORDER[faction];
    for (const s of map.values()) {
      if (s.faction !== faction) continue;
      const { x: cx, y: cy } = hexToPixel(s.q, s.r);
      const v = hexVerts(cx, cy, HEX_SIZE * 0.97);
      for (let ei = 0; ei < 6; ei++) {
        const dir = HEX_DIRS[ei];
        const nb = map.get(hexKey(s.q + dir.q, s.r + dir.r));
        if (!nb || nb.faction !== faction) {
          gfx.lineStyle(3.5, color, 1.0);
          const i0 = ei * 2;
          const i1 = ((ei + 1) % 6) * 2;
          gfx.moveTo(v[i0], v[i0 + 1]);
          gfx.lineTo(v[i1], v[i1 + 1]);
        }
      }
    }
  }
  return gfx;
}

function buildLabelContainer(map: Map<string, SectorData>): PIXI.Container {
  const container = new PIXI.Container();
  for (const faction of NAMED_FACTIONS) {
    const hexes = Array.from(map.values()).filter(s => s.faction === faction);
    if (hexes.length < 3) continue;

    const pixels = hexes.map(h => hexToPixel(h.q, h.r));
    const avgX = pixels.reduce((a, p) => a + p.x, 0) / pixels.length;
    const avgY = pixels.reduce((a, p) => a + p.y, 0) / pixels.length;
    const minX = Math.min(...pixels.map(p => p.x));
    const maxX = Math.max(...pixels.map(p => p.x));
    const territoryW = (maxX - minX) + HEX_SIZE * 2;

    const text = new PIXI.Text(FACTION_LABEL[faction], {
      fontFamily: 'monospace',
      fontSize: 72,
      fontWeight: 'bold',
      fill: FACTION_FILL[faction],
      align: 'center',
      letterSpacing: 6,
    });
    text.anchor.set(0.5, 0.5);
    text.position.set(avgX, avgY);
    text.alpha = 0.22;
    text.scale.set(Math.min((territoryW * 0.75) / Math.max(text.width, 1), 0.55));
    container.addChild(text);
  }
  return container;
}

function drawSingleIcon(gfx: PIXI.Graphics, attr: SectorAttribute, ix: number, iy: number, R: number): void {
  switch (attr) {
    case 'asteroid':
      gfx.lineStyle(0);
      gfx.beginFill(0xaa9977, 1);
      gfx.drawEllipse(ix, iy, R * 1.15, R * 0.85);
      gfx.endFill();
      gfx.beginFill(0x887755, 1);
      gfx.drawEllipse(ix + R * 0.35, iy - R * 0.2, R * 0.45, R * 0.35);
      gfx.endFill();
      break;

    case 'neutral_npc':
      gfx.lineStyle(0);
      gfx.beginFill(0x99bbff, 1);
      gfx.drawCircle(ix - R * 0.45, iy, R * 0.65);
      gfx.drawCircle(ix + R * 0.45, iy, R * 0.65);
      gfx.endFill();
      gfx.lineStyle(1.5, 0xffffff, 0.6);
      gfx.moveTo(ix - R * 0.1, iy);
      gfx.lineTo(ix + R * 0.1, iy);
      gfx.lineStyle(0);
      break;

    case 'black_hole':
      gfx.lineStyle(0);
      gfx.beginFill(0x080010, 1);
      gfx.drawCircle(ix, iy, R * 0.65);
      gfx.endFill();
      gfx.lineStyle(2, 0xff2244, 0.9);
      gfx.drawCircle(ix, iy, R);
      gfx.lineStyle(1, 0xff6677, 0.4);
      gfx.drawCircle(ix, iy, R * 1.3);
      gfx.lineStyle(0);
      break;

    case 'rich_minerals':
      gfx.lineStyle(0);
      gfx.beginFill(0xffdd33, 1);
      gfx.moveTo(ix,            iy - R);
      gfx.lineTo(ix + R * 0.65, iy);
      gfx.lineTo(ix,            iy + R * 0.55);
      gfx.lineTo(ix - R * 0.65, iy);
      gfx.closePath();
      gfx.endFill();
      gfx.beginFill(0xffaa11, 0.6);
      gfx.moveTo(ix,            iy - R);
      gfx.lineTo(ix + R * 0.65, iy);
      gfx.lineTo(ix,            iy);
      gfx.closePath();
      gfx.endFill();
      break;

    case 'nebula':
      gfx.lineStyle(0);
      gfx.beginFill(0xcc88ff, 0.65);
      gfx.drawCircle(ix - R * 0.45, iy + R * 0.25, R * 0.7);
      gfx.drawCircle(ix + R * 0.45, iy + R * 0.25, R * 0.7);
      gfx.drawCircle(ix,            iy - R * 0.2,  R * 0.75);
      gfx.endFill();
      break;

    case 'station':
      gfx.lineStyle(0);
      gfx.beginFill(0xddeeff, 1);
      gfx.drawRect(ix - R * 0.75, iy - R * 0.75, R * 1.5, R * 1.5);
      gfx.endFill();
      gfx.beginFill(0x334455, 1);
      gfx.drawRect(ix - R * 0.18, iy - R * 0.75, R * 0.36, R * 0.55);
      gfx.endFill();
      gfx.beginFill(0x6699cc, 0.8);
      gfx.drawRect(ix - R * 0.55, iy - R * 0.2, R * 0.35, R * 0.35);
      gfx.drawRect(ix + R * 0.2,  iy - R * 0.2, R * 0.35, R * 0.35);
      gfx.endFill();
      break;
  }
}

/** Build the always-visible icon layer; also returns icon world positions for hit-testing. */
function buildIconGraphics(map: Map<string, SectorData>): { gfx: PIXI.Graphics; iconInfos: IconInfo[] } {
  const gfx = new PIXI.Graphics();
  const iconInfos: IconInfo[] = [];
  const R = 6;
  const spacing = 16;

  for (const s of map.values()) {
    if (s.attributes.length === 0) continue;
    const { x: cx, y: cy } = hexToPixel(s.q, s.r);
    const total = (s.attributes.length - 1) * spacing;
    let ix = cx - total / 2;
    const iy = cy + HEX_SIZE * 0.38;

    for (const attr of s.attributes) {
      iconInfos.push({ attr, wx: ix, wy: iy });
      drawSingleIcon(gfx, attr, ix, iy, R);
      ix += spacing;
    }
  }
  return { gfx, iconInfos };
}

function buildStarBackground(width: number, height: number, rng: () => number): PIXI.Graphics {
  const gfx = new PIXI.Graphics();
  for (let i = 0; i < 280; i++) {
    const sz = rng() * 1.3 + 0.3;
    const alpha = rng() * 0.5 + 0.15;
    gfx.beginFill(0xffffff, alpha);
    gfx.drawCircle(rng() * width, rng() * height, sz);
    gfx.endFill();
  }
  return gfx;
}

// ---- Component ----

const GalaxyMapView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const w = el.clientWidth;
    const h = el.clientHeight;

    const app = new PIXI.Application({
      width: w, height: h,
      backgroundColor: 0x050814,
      antialias: true,
      autoStart: true,
      powerPreference: 'high-performance',
    });
    el.appendChild(app.view as HTMLCanvasElement);

    // Star background (screen-fixed, not part of mapContainer)
    app.stage.addChild(buildStarBackground(w, h, makeLCG(9999)));

    const hexMap = generateSectors(MAP_SEED);
    const sectorList = Array.from(hexMap.values());

    const mapContainer = new PIXI.Container();
    app.stage.addChild(mapContainer);

    // Center map
    const allPixels = sectorList.map(s => hexToPixel(s.q, s.r));
    const mapCx = allPixels.reduce((a, p) => a + p.x, 0) / allPixels.length;
    const mapCy = allPixels.reduce((a, p) => a + p.y, 0) / allPixels.length;
    mapContainer.position.set(w / 2 - mapCx, h / 2 - mapCy);

    // Layer order:
    //   allHexGfx   – static fills + inner grid lines (never changes)
    //   allBorderGfx – static faction borders (never changes)
    //   eraserSlot  – unscaled background-colour hexes that hide the static territory
    //   territorySlot – PIXI.Container scaled as ONE object around territory centroid
    //   labelContainer – faction name labels (stay fixed above any scale)
    //   iconGfx     – attribute icons (always on top)
    mapContainer.addChild(buildStaticHexGraphics(hexMap));
    mapContainer.addChild(buildBorderGraphics(hexMap));

    // Fixed-position slot containers keep layer order stable while contents are swapped.
    const eraserSlot = new PIXI.Container();
    mapContainer.addChild(eraserSlot);
    const territorySlot = new PIXI.Container();
    mapContainer.addChild(territorySlot);

    mapContainer.addChild(buildLabelContainer(hexMap));

    const { gfx: iconGfx, iconInfos } = buildIconGraphics(hexMap);
    mapContainer.addChild(iconGfx);

    // ---- Tooltip ----
    const tooltipDiv = document.createElement('div');
    tooltipDiv.style.cssText = [
      'position:fixed', 'pointer-events:none',
      'background:rgba(2,10,22,0.92)', 'border:1px solid #2a3e52',
      'color:#aabbcc', 'font-family:monospace', 'font-size:11px',
      'padding:3px 8px', 'border-radius:3px', 'z-index:1300',
      'display:none', 'white-space:nowrap', 'letter-spacing:0.05em',
    ].join(';');
    document.body.appendChild(tooltipDiv);

    // ---- Hover state ----
    let hoveredKey: string | null = null;
    let hoveredTerritory: string[] = [];
    let hoverScale = 1.0;
    let zoom = 1.0;

    // Live reference to the scaled territory container (updated on territory change).
    let activeTerritoryContainer: PIXI.Container | null = null;
    // Live reference to the root-hex highlight Graphics inside the territory container.
    let activeRootHighlight: PIXI.Graphics | null = null;

    /** Replace eraser + territory slot contents with visuals for a new territory. */
    function buildTerritoryObjects(territory: string[], rootKey: string): void {
      // --- Eraser: opaque background hexes at original positions ---
      // Sits below the territory container (unscaled) so it hides the static fills/borders.
      const eraserGfx = new PIXI.Graphics();
      for (const key of territory) {
        const s = hexMap.get(key)!;
        const { x, y } = hexToPixel(s.q, s.r);
        // 1.02× covers the 3.5 px faction border line without touching neighbour fills.
        eraserGfx.beginFill(0x050814, 1);
        eraserGfx.lineStyle(0);
        const v = hexVerts(x, y, HEX_SIZE * 1.02);
        eraserGfx.moveTo(v[0], v[1]);
        for (let vi = 2; vi < v.length; vi += 2) eraserGfx.lineTo(v[vi], v[vi + 1]);
        eraserGfx.closePath();
        eraserGfx.endFill();
      }
      eraserSlot.removeChildren().forEach(c => c.destroy());
      eraserSlot.addChild(eraserGfx);

      // --- Territory container: ALL territory visuals, scaled as one object ---
      // Compute centroid; pivot + position set there so scale.set() scales around it.
      let sumX = 0, sumY = 0;
      for (const key of territory) {
        const s = hexMap.get(key)!;
        const p = hexToPixel(s.q, s.r);
        sumX += p.x; sumY += p.y;
      }
      const centX = sumX / territory.length;
      const centY = sumY / territory.length;

      const tSet = new Set(territory);
      const faction = hexMap.get(rootKey)!.faction;
      const isFaction = faction !== 'neutral';

      const tc = new PIXI.Container();
      tc.pivot.set(centX, centY);
      tc.position.set(centX, centY);
      tc.scale.set(hoverScale); // match current animation state (avoids pop on territory change)

      // Hex fills + outer faction borders (static within the container)
      const fillsGfx = new PIXI.Graphics();
      for (const key of territory) {
        const s = hexMap.get(key)!;
        const { x, y } = hexToPixel(s.q, s.r);
        drawHexPoly(fillsGfx, x, y, HEX_SIZE * 0.97,
          FACTION_FILL[s.faction], 0.62,
          0.6, 0x5a6a7a, 0.18);
        if (isFaction) {
          const verts = hexVerts(x, y, HEX_SIZE * 0.97);
          for (let ei = 0; ei < 6; ei++) {
            const nk = hexKey(s.q + HEX_DIRS[ei].q, s.r + HEX_DIRS[ei].r);
            if (!tSet.has(nk)) {
              fillsGfx.lineStyle(3.5, FACTION_BORDER[faction], 1.0);
              const i0 = ei * 2, i1 = ((ei + 1) % 6) * 2;
              fillsGfx.moveTo(verts[i0], verts[i0 + 1]);
              fillsGfx.lineTo(verts[i1], verts[i1 + 1]);
            }
          }
        }
      }
      tc.addChild(fillsGfx);

      // Separate Graphics for the root hex highlight so it can be cheaply redrawn
      // when the cursor moves to a different hex within the same territory.
      const rootGfx = new PIXI.Graphics();
      tc.addChild(rootGfx);
      activeRootHighlight = rootGfx;
      updateRootHighlight(rootKey);

      territorySlot.removeChildren().forEach(c => (c as PIXI.Container).destroy({ children: true }));
      territorySlot.addChild(tc);
      activeTerritoryContainer = tc;
    }

    /** Redraw only the root hex outline (cheap — no territory rebuild). */
    function updateRootHighlight(rootKey: string): void {
      if (!activeRootHighlight) return;
      const s = hexMap.get(rootKey);
      if (!s) return;
      const { x, y } = hexToPixel(s.q, s.r);
      activeRootHighlight.clear();
      activeRootHighlight.lineStyle(1.5, 0xffffff, 0.45);
      activeRootHighlight.beginFill(0, 0);
      const v = hexVerts(x, y, HEX_SIZE * 0.97);
      activeRootHighlight.moveTo(v[0], v[1]);
      for (let vi = 2; vi < v.length; vi += 2) activeRootHighlight.lineTo(v[vi], v[vi + 1]);
      activeRootHighlight.closePath();
      activeRootHighlight.endFill();
    }

    /** Clear territory visuals and reset state. */
    function clearTerritoryObjects(): void {
      eraserSlot.removeChildren().forEach(c => c.destroy());
      territorySlot.removeChildren().forEach(c => (c as PIXI.Container).destroy({ children: true }));
      activeTerritoryContainer = null;
      activeRootHighlight = null;
    }

    // Ticker: purely updates the container scale — zero graphics operations per frame.
    app.ticker.add(() => {
      const target = hoveredKey ? HOVER_SHRINK : 1.0;
      hoverScale += (target - hoverScale) * HOVER_LERP;
      if (activeTerritoryContainer) {
        activeTerritoryContainer.scale.set(hoverScale);
        // Once the un-hover animation finishes, clean up the objects.
        if (!hoveredKey && hoverScale > 0.999) clearTerritoryObjects();
      }
    });

    // ---- Pan / Zoom ----
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let panOrigin = { x: 0, y: 0 };
    const MIN_ZOOM = 0.3;
    const MAX_ZOOM = 3.0;

    const canvas = app.view as HTMLCanvasElement;

    const onMouseDown = (e: MouseEvent): void => {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      panOrigin = { x: mapContainer.position.x, y: mapContainer.position.y };
      canvas.style.cursor = 'grabbing';
      tooltipDiv.style.display = 'none';
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (isPanning) {
        mapContainer.position.set(
          panOrigin.x + (e.clientX - panStart.x),
          panOrigin.y + (e.clientY - panStart.y),
        );
        tooltipDiv.style.display = 'none';
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const lx = (sx - mapContainer.position.x) / zoom;
      const ly = (sy - mapContainer.position.y) / zoom;

      // Hex hover
      const { q, r } = pixelToHex(lx, ly);
      const newKey = hexKey(q, r);
      const newHover = hexMap.has(newKey) ? newKey : null;

      if (newHover !== hoveredKey) {
        if (newHover) {
          const newTerritory = getContiguousTerritory(hexMap, newHover);
          const newTSet = new Set(newTerritory);

          // Moving within the same contiguous territory: only update root highlight.
          // DO NOT reset hoverScale — the shrink animation continues uninterrupted.
          const sameTerritory =
            newTerritory.length === hoveredTerritory.length &&
            hoveredTerritory.every(k => newTSet.has(k));

          if (sameTerritory) {
            hoveredKey = newHover;
            updateRootHighlight(newHover);
          } else {
            // New territory: rebuild visuals, keep current hoverScale (no pop).
            hoveredKey = newHover;
            hoveredTerritory = newTerritory;
            hoverScale = 1.0;
            buildTerritoryObjects(newTerritory, newHover);
          }
        } else {
          // Mouse left all hexes: let ticker animate scale back to 1.0 then clean up.
          hoveredKey = null;
          hoveredTerritory = [];
        }
        canvas.style.cursor = newHover ? 'pointer' : 'default';
      }

      // Icon tooltip hit-test (world → screen: screen = mapContainer.pos + world * zoom)
      const mpx = mapContainer.position.x;
      const mpy = mapContainer.position.y;
      let tooltipShown = false;
      for (const info of iconInfos) {
        const screenIconX = mpx + info.wx * zoom;
        const screenIconY = mpy + info.wy * zoom;
        if (Math.hypot(sx - screenIconX, sy - screenIconY) < ICON_HIT_RADIUS) {
          tooltipDiv.textContent = ATTR_TOOLTIPS[info.attr];
          tooltipDiv.style.left = `${e.clientX + 14}px`;
          tooltipDiv.style.top  = `${e.clientY - 24}px`;
          tooltipDiv.style.display = 'block';
          tooltipShown = true;
          break;
        }
      }
      if (!tooltipShown) tooltipDiv.style.display = 'none';
    };

    const onMouseUp = (): void => {
      isPanning = false;
      canvas.style.cursor = hoveredKey ? 'pointer' : 'default';
    };

    const onMouseLeave = (): void => {
      isPanning = false;
      tooltipDiv.style.display = 'none';
      hoveredKey = null;
      hoveredTerritory = [];
      canvas.style.cursor = 'default';
      // Ticker will animate scale back to 1.0 and then call clearTerritoryObjects().
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.91;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      mapContainer.position.x = mx - (mx - mapContainer.position.x) * (newZoom / zoom);
      mapContainer.position.y = my - (my - mapContainer.position.y) * (newZoom / zoom);
      zoom = newZoom;
      mapContainer.scale.set(zoom);
    };

    const onResize = (): void => { app.renderer.resize(el.clientWidth, el.clientHeight); };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      tooltipDiv.remove();
      app.destroy(true, { children: true, texture: true, baseTexture: true });
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        backgroundColor: '#050814',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
          color: '#7799bb', fontFamily: 'monospace', fontSize: 16,
          letterSpacing: '0.25em', textTransform: 'uppercase',
          userSelect: 'none', pointerEvents: 'none', zIndex: 10,
        }}
      >
        Galaxy Map
      </div>

      <div
        style={{
          position: 'absolute', bottom: 20, right: 20, zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: 4,
          backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid #223344',
          borderRadius: 4, padding: '8px 12px', pointerEvents: 'none',
        }}
      >
        {([['#d97070', 'Crimson Empire'], ['#70c878', 'Verdant Union'], ['#6890d8', 'Azure Dominion'], ['#607080', 'Neutral']] as const).map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: color, flexShrink: 0 }} />
            <span style={{ color: '#99aabb', fontFamily: 'monospace', fontSize: 11 }}>{label}</span>
          </div>
        ))}
      </div>


      <div
        style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          color: '#445566', fontFamily: 'monospace', fontSize: 11,
          userSelect: 'none', pointerEvents: 'none', zIndex: 10,
        }}
      >
        Scroll to zoom · Drag to pan · Hover a sector to inspect
      </div>

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default GalaxyMapView;
