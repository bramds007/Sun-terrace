// /api/buildings.js — OSM (Overpass) binnen WGS84 bbox, met mirrors+retries, robuuste hoogtes en debug.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://z.overpass-api.de/api/interpreter"
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const bbox = (req.query.bbox || '').split(',').map(Number);
  if (bbox.length !== 4 || bbox.some(isNaN)) {
    return res.status(400).json({ source:'osm-overpass', error: 'Use ?bbox=lonMin,latMin,lonMax,latMax (WGS84)' });
  }
  const [lonMin, latMin, lonMax, latMax] = bbox;

  // primary query
  const ql = buildQL(latMin, lonMin, latMax, lonMax);

  // try each endpoint
  let fc = null, usedEndpoint = null, errMsgs = [];
  for (const ep of OVERPASS_ENDPOINTS) {
    const out = await runOverpass(ep, ql).catch(e => ({ error: e.message }));
    if (out?.fc) { fc = out.fc; usedEndpoint = ep; break; }
    errMsgs.push(`${ep}: ${out?.error || 'unknown error'}`);
  }

  // if still empty or failed, try a padded bbox (slightly larger around the viewport)
  let paddedTried = null;
  if (!fc || (fc.features.length === 0)) {
    const pad = padBbox({ lonMin, latMin, lonMax, latMax }, 0.0025); // ~250 m
    paddedTried = `${pad.lonMin},${pad.latMin},${pad.lonMax},${pad.latMax}`;
    const qlPad = buildQL(pad.latMin, pad.lonMin, pad.latMax, pad.lonMax);
    for (const ep of OVERPASS_ENDPOINTS) {
      const out = await runOverpass(ep, qlPad).catch(e => ({ error: e.message }));
      if (out?.fc && out.fc.features.length) { fc = out.fc; usedEndpoint = ep; break; }
      errMsgs.push(`(padded) ${ep}: ${out?.error || 'unknown error'}`);
    }
  }

  // Always respond with a known shape so de frontend-debug nooit "-" toont
  if (!fc) {
    return res.status(200).json({
      source: 'osm-overpass',
      error: errMsgs.join(' | '),
      buildings: emptyFC(),
      stats: { used_height:0, used_levels:0, used_default:0, skipped_too_low:0 },
      debug: { bbox, paddedTried, endpoint: usedEndpoint, notes:'no fc from any endpoint' }
    });
  }

  // hoogte invullen + filter
  let cHeight=0, cLevels=0, cDefault=0, cLow=0;
  const out = { type:'FeatureCollection', features:[] };
  for (const f of fc.features) {
    const tags = f.properties?.tags || {};
    let h = parseHeight(tags.height);
    if (h == null) {
      const lvl = toNum(tags["building:levels"]) ?? toNum(tags.levels);
      if (lvl != null) h = lvl * 3.2; // ~3.2 m/verdieping
    }
    if (h != null) {
      if (parseHeight(tags.height) != null) cHeight++; else cLevels++;
    } else {
      h = 10; // voorzichtige default
      cDefault++;
    }
    if (h < 3) { cLow++; continue; }
    f.properties = { ...f.properties, h_m: h };
    out.features.push(f);
  }

  return res.status(200).json({
    source: 'osm-overpass',
    count: out.features.length,
    buildings: out,
    stats: { used_height:cHeight, used_levels:cLevels, used_default:cDefault, skipped_too_low:cLow },
    debug: { bbox, paddedTried, endpoint: usedEndpoint, errors: errMsgs.slice(0,3) }
  });
}

/* ------------ helpers ------------- */
function buildQL(latMin, lonMin, latMax, lonMax) {
  return `
    [out:json][timeout:25];
    (
      way["building"](${latMin},${lonMin},${latMax},${lonMax});
      relation["building"](${latMin},${lonMin},${latMax},${lonMax});
    );
    out tags geom;
  `.trim();
}

async function runOverpass(endpoint, ql) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ data: ql })
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  const fc = overpassToGeoJSON(json);
  return { fc };
}

function overpassToGeoJSON(data) {
  const fc = { type:'FeatureCollection', features:[] };
  if (!Array.isArray(data.elements)) return fc;

  // Ways
  for (const el of data.elements) {
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      const coords = el.geometry.map(p => [p.lon, p.lat]);
      if (coords.length >= 3 && (coords[0][0] !== coords.at(-1)[0] || coords[0][1] !== coords.at(-1)[1])) coords.push(coords[0]);
      if (coords.length >= 4) {
        fc.features.push({
          type:'Feature',
          id:`way.${el.id}`,
          properties:{ id: el.id, type:'way', tags: el.tags || {} },
          geometry:{ type:'Polygon', coordinates:[coords] }
        });
      }
    }
  }
  // Relations (multipolygon)
  for (const el of data.elements) {
    if (el.type === 'relation' && el.tags && el.tags.type === 'multipolygon' && Array.isArray(el.members)) {
      const outers = el.members.filter(m => m.role === 'outer' && m.type === 'way' && Array.isArray(m.geometry));
      if (!outers.length) continue;
      const polys = [];
      for (const m of outers) {
        const coords = m.geometry.map(p => [p.lon, p.lat]);
        if (coords.length >= 3 && (coords[0][0] !== coords.at(-1)[0] || coords[0][1] !== coords.at(-1)[1])) coords.push(coords[0]);
        if (coords.length >= 4) polys.push(coords);
      }
      if (polys.length) {
        fc.features.push({
          type:'Feature',
          id:`rel.${el.id}`,
          properties:{ id: el.id, type:'relation', tags: el.tags || {} },
          geometry: polys.length === 1 ? { type:'Polygon', coordinates:[polys[0]] }
                                       : { type:'MultiPolygon', coordinates: polys.map(r => [r]) }
        });
      }
    }
  }
  return fc;
}

function parseHeight(v){
  if (!v || typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  let m = s.match(/^([\d.,]+)\s*m?$/); if (m) return toNum(m[1]);     // meters
  m = s.match(/^([\d.,]+)\s*ft?$/); if (m) { const ft=toNum(m[1]); return ft!=null?ft*0.3048:null; } // feet
  return null;
}
function toNum(x){ if (x==null) return null; const n = Number(String(x).replace(',','.')); return Number.isFinite(n)?n:null; }

function padBbox(b, padDeg){
  return {
    lonMin: b.lonMin - padDeg,
    latMin: b.latMin - padDeg,
    lonMax: b.lonMax + padDeg,
    latMax: b.latMax + padDeg
  };
}

function emptyFC(){ return { type:'FeatureCollection', features:[] }; }
