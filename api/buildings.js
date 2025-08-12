// /api/buildings.js — 3DBAG WFS (EPSG:4326) binnen bbox, voegt hoogte h_m toe
const WFS = 'https://data.3dbag.nl/api/BAG3D/wfs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const bbox = (req.query.bbox || '').split(',').map(Number);
  if (bbox.length !== 4 || bbox.some(isNaN)) {
    return res.status(400).json({ error: 'Missing or invalid bbox param. Use ?bbox=lonMin,latMin,lonMax,latMax' });
  }

  const url = `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=lod13&outputFormat=application/json&srsName=EPSG:4326&bbox=${bbox.join(',')},EPSG:4326`;

  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`WFS HTTP ${r.status}`);
    const gj = await r.json();

    for (const f of (gj.features || [])) {
      const p = f.properties || {};
      const hRoof = num(p.b3_h_dak_max);
      const hGround = num(p.b3_h_maaiveld);
      const h = (hRoof!=null && hGround!=null) ? Math.max(0, hRoof - hGround) : null;
      f.properties = { ...p, h_m: h };
    }

    return res.status(200).json({ source:'3dbag-wfs', count: gj.features?.length||0, buildings: gj });
  } catch (e) {
    return res.status(500).json({ source:'3dbag-wfs', error: e.message });
  }
}

function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
