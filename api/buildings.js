// /api/buildings.js — haalt gebouwen uit OpenStreetMap (Overpass API) binnen WGS84 bbox
// Zet 'height' of 'building:levels' om naar h_m (meters). Geeft GeoJSON terug.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Verwacht bbox=lonMin,latMin,lonMax,latMax (WGS84)
  const bbox = (req.query.bbox || '').split(',').map(Number);
  if (bbox.length !== 4 || bbox.some(isNaN)) {
    return res.status(400).json({ error: 'Use ?bbox=lonMin,latMin,lonMax,latMax (WGS84)' });
  }
  const [lonMin, latMin, lonMax, latMax] = bbox;

  // Overpass QL: alle building ways/relations binnen bbox, met tags en geometrie
  // NB: we houden het compact en vragen alleen wat we nodig hebben.
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

    // Hoogteveld h_m toevoegen uit tags.height of tags["building:levels"]
    for (const f of fc.features) {
      const tags = f.properties?.tags || {};
      let h = parseHeight(tags.height);
      if (h == null) {
        const lvl = toNum(tags["building:levels"]);
        if (lvl != null) h = lvl * 3.2; // ruwe schatting: 3.2 m per verdieping
      }
      f.properties = { ...f.properties, h_m: (h != null ? h : null) };
    }

    return res.status(200).json({
      source: 'osm-overpass',
      count: fc.features.length,
      buildings: fc
    });
  } catch (e) {
    // Fallback: lege set zodat frontend blijft draaien (valt dan terug op "globale zon")
    return res.status(200).json({
      source: 'osm-overpass',
      error: e.message,
      buildings: { type:'FeatureCollection', features:[] }
    });
  }
}

// ---- Helpers ----

// Converteer Overpass JSON naar GeoJSON FeatureCollection
function overpassToGeoJSON(data) {
  const fc = { type: 'FeatureCollection', features: [] };
  const nodes = new Map();
  if (Array.isArray(data.elements)) {
    for (const el of data.elements) {
      if (el.type === 'node') nodes.set(el.id, [el.lon, el.lat]);
    }
    for (const el of data.elements) {
      if (el.type === 'way' && Array.isArray(el.geometry)) {
        const coords = el.geometry.map(p => [p.lon, p.lat]);
        // sluit polygon indien open
        if (coords.length >= 3 && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
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
      } else if (el.type === 'relation' && el.tags && el.tags.type === 'multipolygon' && Array.isArray(el.members)) {
        // eenvoudige multipolygon reconstructie (alle outer-ways samenvoegen)
        const outers = el.members.filter(m => m.role === 'outer' && m.type === 'way' && Array.isArray(m.geometry));
        if (outers.length) {
          const polys = [];
          for (const m of outers) {
            const coords = m.geometry.map(p => [p.lon, p.lat]);
            if (coords.length >= 3 && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
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
  }
  return fc;
}

// 'height' kan strings bevatten zoals "12", "12.5", "12 m" of "40ft"
function parseHeight(v) {
  if (!v || typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  // meters met of zonder "m"
  let m = s.match(/^([\d.,]+)\s*m?$/);
  if (m) return toNum(m[1]);
  // feet -> meters
  m = s.match(/^([\d.,]+)\s*ft?$/);
  if (m) {
    const ft = toNum(m[1]);
    return ft != null ? ft * 0.3048 : null;
  }
  return null;
}
function toNum(x) {
  if (x == null) return null;
  const n = Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
