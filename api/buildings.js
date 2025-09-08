// /api/buildings.js — OSM (Overpass) binnen WGS84 bbox, mirrors+retries, h_m afleiding
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
    return res.status(400).json({ source:'osm-overpass', error:'Use ?bbox=lonMin,latMin,lonMax,latMax (WGS84)' });
  }
  const [lonMin, latMin, lonMax, latMax] = bbox;

  const ql = buildQL(latMin, lonMin, latMax, lonMax);

  let fc = null, usedEndpoint = null, errors = [];
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const out = await runOverpass(ep, ql);
      if (out?.features?.length >= 0) { fc = out; usedEndpoint = ep; break; }
    } catch (e) { errors.push(`${ep}: ${e.message}`); }
  }

  if (!fc) {
    return res.status(200).json({
      source:'osm-overpass', error: errors.join(' | '),
      buildings: { type:'FeatureCollection', features:[] }, stats:{used_height:0,used_levels:0,used_default:0,skipped_too_low:0},
      debug:{ bbox, endpoint:null }
    });
  }

  // Hoogte: height -> levels*3.2 -> default 10m. Filter <3m weg.
  let cH=0,cL=0,cD=0,cSkip=0;
  const out = { type:'FeatureCollection', features:[] };
  for (const f of fc.features) {
    const tags = f.properties?.tags || {};
    let h = parseHeight(tags.height);
    if (h == null) {
      const lv = toNum(tags["building:levels"]) ?? toNum(tags.levels);
      if (lv != null) h = lv * 3.2;
    }
    if (h != null) { if (parseHeight(tags.height)!=null) cH++; else cL++; }
    else { h = 10; cD++; }
    if (h < 3) { cSkip++; continue; }

    f.properties = { ...f.properties, h_m: h };
    out.features.push(f);
  }

  return res.status(200).json({
    source:'osm-overpass',
    count: out.features.length,
    buildings: out,
    stats:{ used_height:cH, used_levels:cL, used_default:cD, skipped_too_low:cSkip },
    debug:{ bbox, endpoint: usedEndpoint }
  });
}

/* helpers */
function buildQL(latMin, lonMin, latMax, lonMax){
  return `
    [out:json][timeout:25];
    (
      way["building"](${latMin},${lonMin},${latMax},${lonMax});
      relation["building"](${latMin},${lonMin},${latMax},${lonMax});
    );
    out tags geom;
  `.trim();
}
async function runOverpass(endpoint, ql){
  const r = await fetch(endpoint, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ data: ql })
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  return overpassToGeoJSON(json);
}
function overpassToGeoJSON(data){
  const fc = { type:'FeatureCollection', features:[] };
  if (!Array.isArray(data.elements)) return fc;
  for (const el of data.elements) {
    if (el.type==='way' && Array.isArray(el.geometry)) {
      const coords = el.geometry.map(p => [p.lon,p.lat]);
      if (coords.length>=3 && (coords[0][0]!==coords.at(-1)[0] || coords[0][1]!==coords.at(-1)[1])) coords.push(coords[0]);
      if (coords.length>=4) fc.features.push({ type:'Feature', id:`way.${el.id}`, properties:{ id:el.id, type:'way', tags: el.tags||{} }, geometry:{ type:'Polygon', coordinates:[coords] } });
    }
  }
  for (const el of data.elements) {
    if (el.type==='relation' && el.tags && el.tags.type==='multipolygon' && Array.isArray(el.members)) {
      const outers = el.members.filter(m=>m.role==='outer' && m.type==='way' && Array.isArray(m.geometry));
      if (!outers.length) continue;
      const polys=[];
      for (const m of outers) {
        const c = m.geometry.map(p=>[p.lon,p.lat]);
        if (c.length>=3 && (c[0][0]!==c.at(-1)[0] || c[0][1]!==c.at(-1)[1])) c.push(c[0]);
        if (c.length>=4) polys.push(c);
      }
      if (polys.length) {
        fc.features.push({
          type:'Feature', id:`rel.${el.id}`, properties:{ id:el.id, type:'relation', tags: el.tags||{} },
          geometry: polys.length===1 ? { type:'Polygon', coordinates:[polys[0]] } : { type:'MultiPolygon', coordinates: polys.map(r=>[r]) }
        });
      }
    }
  }
  return fc;
}
function parseHeight(v){
  if (!v || typeof v!=='string') return null;
  const s=v.trim().toLowerCase();
  let m=s.match(/^([\d.,]+)\s*m?$/); if(m) return toNum(m[1]);
  m=s.match(/^([\d.,]+)\s*ft?$/); if(m){ const ft=toNum(m[1]); return ft!=null?ft*0.3048:null; }
  return null;
}
function toNum(x){ if(x==null) return null; const n=Number(String(x).replace(',','.')); return Number.isFinite(n)?n:null; }
