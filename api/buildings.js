// /api/buildings.js — OSM (Overpass) binnen WGS84 bbox
// Robuuste h_m: height -> levels*3.2 -> default 10m. Filter h_m >= 3m.
// Retourneert GeoJSON + stats, zodat je kunt zien of de hoogtes goed zijn.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const bbox = (req.query.bbox || '').split(',').map(Number);
  if (bbox.length !== 4 || bbox.some(isNaN)) {
    return res.status(400).json({ error: 'Use ?bbox=lonMin,latMin,lonMax,latMax (WGS84)' });
  }
  const [lonMin, latMin, lonMax, latMax] = bbox;

  // Overpass QL: buildings (ways + relations) met geometrie
  const ql = `
    [out:json][timeout:25];
    (
      way["building"](${latMin},${lonMin},${latMax},${lonMax});
      relation["building"](${latMin},${lonMin},${latMax},${lonMax});
    );
    out tags geom;
  `.trim();

  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ data: ql })
    });
    if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);

    const json = await r.json();
    const fc = overpassToGeoJSON(json);

    // Hoogte invullen + filter
    let cHeight=0, cLevels=0, cDefault=0, cNull=0;
    const out = { type: 'FeatureCollection', features: [] };

    for (const f of fc.features) {
      const tags = f.properties?.tags || {};
      let h = parseHeight(tags.height);
      if (h == null) {
        const lvl = toNum(tags["building:levels"]) ?? toNum(tags.levels);
        if (lvl != null) h = lvl * 3.2; // ruwe schatting per verdieping
      }
      if (h != null) {
        if (parseHeight(tags.height) != null) cHeight++;
        else cLevels++;
      } else {
        // Voorzichtige default op 10 m zodat grote blokkades meetellen
        h = 10;
        cDefault++;
      }

      // reject écht lage dingen (tuinhuisjes / erfafscheidingen)
      if (h < 3) { cNull++; continue; }

      f.properties = { ...f.properties, h_m: h };
      out.features.push(f);
    }

    return res.status(200).json({
      source: 'osm-overpass',
      count: out.features.length,
      buildings: out,
      stats: { used_height:cHeight, used_levels:cLevels, used_default:cDefault, skipped_too_low:cNull }
    });
  } catch (e) {
    return res.status(200).json({
      source: 'osm-overpass',
      error: e.message,
      buildings: { type:'FeatureCollection', features:[] }
    });
  }
}

/* ---------- Helpers ---------- */

function overpassToGeoJSON(data) {
  const fc = { type: 'FeatureCollection', features: [] };
  if (!Array.isArray(data.elements)) return fc;

  // Ways -> Polygon
  for (const el of data.elements) {
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      const coords = el.geometry.map(p => [p.lon, p.lat]);
      if (coords.length >= 3 && (coords[0][0] !== coords.at(-1)[0] || coords[0][1] !== coords.at(-1)[1])) {
        coords.push(coords[0]);
      }
      if (coords.length >= 4) {
        fc.features.push({
          type: 'Feature',
          id: `way.${el.id}`,
          properties: { id: el.id, type: 'way', tags: el.tags || {} },
          geometry: { type: 'Polygon', coordinates: [coords] }
        });
      }
    }
  }
  // Relations (multipolygon)
  for (const el of data.elements) {
    if (el.type === 'relation' && el.tags && el.tags.type === 'multipolygon' && Array.isArray(el.members)) {
      const outers = el.members.filter(m => m.role === 'outer' && m.type === 'way' && Array.isArray(m.geometry));
      if (outers.length) {
        const polys = [];
        for (const m of outers) {
          const coords = m.geometry.map(p => [p.lon, p.lat]);
          if (coords.length >= 3 && (coords[0][0] !== coords.at(-1)[0] || coords[0][1] !== coords.at(-1)[1])) {
            coords.push(coords[0]);
          }
          if (coords.length >= 4) polys.push(coords);
        }
        if (polys.length) {
          fc.features.push({
            type: 'Feature',
            id: `rel.${el.id}`,
            properties: { id: el.id, type: 'relation', tags: el.tags || {} },
            geometry: polys.length === 1
              ? { type: 'Polygon', coordinates: [polys[0]] }
              : { type: 'MultiPolygon', coordinates: polys.map(r => [r]) }
          });
        }
      }
    }
  }
  return fc;
}

// "12", "12.5", "12 m", "40ft"
function parseHeight(v) {
  if (!v || typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  let m = s.match(/^([\d.,]+)\s*m?$/);           // meters
  if (m) return toNum(m[1]);
  m = s.match(/^([\d.,]+)\s*ft?$/);              // feet
  if (m) { const ft = toNum(m[1]); return ft!=null ? ft*0.3048 : null; }
  return null;
}
function toNum(x){ if (x==null) return null; const n=Number(String(x).replace(',','.')); return Number.isFinite(n)?n:null; }
