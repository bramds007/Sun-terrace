// /api/buildings.js — 3DBAG WFS met RD-bbox (EPSG:28992) en WGS84 output (EPSG:4326)
const WFS = 'https://data.3dbag.nl/api/BAG3D/wfs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Verwacht WGS84 bbox in query
  const bboxWgs = (req.query.bbox || '').split(',').map(Number);
  if (bboxWgs.length !== 4 || bboxWgs.some(isNaN)) {
    return res.status(400).json({ error: 'Use ?bbox=lonMin,latMin,lonMax,latMax (WGS84)' });
  }
  const [lonMin, latMin, lonMax, latMax] = bboxWgs;

  // Converteer naar RD (EPSG:28992)
  const [xMin, yMin] = wgs84ToRd(lonMin, latMin);
  const [xMax, yMax] = wgs84ToRd(lonMax, latMax);
  const bboxRd = [Math.min(xMin,xMax), Math.min(yMin,yMax), Math.max(xMin,xMax), Math.max(yMin,yMax)];

  // Vraag WFS met RD-bbox, maar output in WGS84 (srsName)
  const url = `${WFS}?service=WFS&version=2.0.0&request=GetFeature`
    + `&typeNames=lod13&outputFormat=application/json`
    + `&srsName=EPSG:4326`  // output-CRS (frontend wil WGS84)
    + `&bbox=${bboxRd.join(',')},EPSG:28992`; // bbox-CRS

  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`WFS HTTP ${r.status}`);
    const gj = await r.json();

    // Hoogte boven maaiveld (meters)
    for (const f of (gj.features || [])) {
      const p = f.properties || {};
      const hRoof = toNum(p.b3_h_dak_max);
      const hGround = toNum(p.b3_h_maaiveld);
      const h = (hRoof != null && hGround != null) ? Math.max(0, hRoof - hGround) : null;
      f.properties = { ...p, h_m: h };
    }

    return res.status(200).json({ source:'3dbag-wfs', count: gj.features?.length || 0, buildings: gj });
  } catch (e) {
    // liever lege set dan error doorgeven (frontend blijft bruikbaar)
    return res.status(200).json({ source:'3dbag-wfs', error: e.message, buildings: { type:'FeatureCollection', features:[] } });
  }
}

function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }

/* ===== WGS84 -> RD (Rijksdriehoeksmeting) conversie (benadering) =====
   Bron: RDNAPTRANS-formules (vereenvoudigd, goed genoeg voor bbox-conversie).
   Resultaat in meters (x,y) in EPSG:28992.
*/
function wgs84ToRd(lon, lat){
  // referentiepunten
  const phi = lat * Math.PI/180;
  const lam = lon * Math.PI/180;
  const phi0 = 52.15517440 * Math.PI/180;
  const lam0 = 5.38720621  * Math.PI/180;

  const dPhi = (lat  - 52.15517440) / 0.00001;
  const dLam = (lon  - 5.38720621 ) / 0.00001;

  // poly’s uit officiële tabellen (ingekorte set; nauwkeurig tot ca. cm–dm)
  const Kp = [
    [ 3235.65389,  0, 1],
    [-  32.58297,  2, 0],
    [-   0.24750,  0, 2],
    [-  0.84978,   2, 1],
    [-  0.06550,   0, 3],
    [-  0.01709,   2, 2],
    [-  0.00738,   1, 0],
    [  0.00530,    4, 0],
    [-  0.00039,   2, 3],
    [  0.00033,    4, 1],
    [-  0.00012,   0, 1]
  ];
  const Lp = [
    [ 5260.52916, 1, 0],
    [ 105.94684,  1, 1],
    [  2.45656,   1, 2],
    [-  0.81885,  3, 0],
    [  0.05594,   1, 3],
    [-  0.05607,  3, 1],
    [  0.01199,   0, 1],
    [-  0.00256,  2, 0],
    [  0.00128,   1, 4],
    [  0.00022,   0, 2],
    [-  0.00022,  2, 2],
    [  0.00026,   4, 0]
  ];

  let dY = 0, dX = 0;
  for (const [c,p,q] of Kp) dX += c * Math.pow(dPhi, p) * Math.pow(dLam, q);
  for (const [c,p,q] of Lp) dY += c * Math.pow(dPhi, p) * Math.pow(dLam, q);

  // schaal + false easting/northing
  const x = 155000 + dY; // RD-X (oost)
  const y = 463000 + dX; // RD-Y (noord)
  return [x, y];
}
