// /api/terraces.js — Terrassen-proxy (Amsterdam WFS) + fallback demo
export default async function handler(req, res) {
  // CORS (zodat je ook direct kunt testen in de browser)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Amsterdam API key (in Vercel: Settings → Environment Variables → AMS_API_KEY)
  const apiKey = process.env.AMS_API_KEY || '';
  const headers = { 'Accept': 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  // WFS terrassen (exploitatievergunning-terrasgeometrie) — GeoJSON
  // BBOX: ruwweg regio Amsterdam (lon/lat in EPSG:4326)
  const WFS =
    'https://api.data.amsterdam.nl/v1/wfs/horeca/?' +
    'REQUEST=GetFeature&SERVICE=WFS&version=2.0.0' +
    '&typenames=exploitatievergunning-terrasgeometrie' +
    '&BBOX=4.63,52.25,5.06,52.45,urn:ogc:def:crs:EPSG::4326' +
    '&outputformat=geojson&srsName=urn:ogc:def:crs:EPSG::4326' +
    '&count=10000';

  // Fallback demo-data (4 polygonen) als de echte API niets geeft
  const demo = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'jaren',
        properties: { name: 'Café de Jaren (demo)' },
        geometry: { type: 'Polygon', coordinates: [[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] }
      },
      {
        type: 'Feature',
        id: 'waterkant',
        properties: { name: 'Waterkant (demo)' },
        geometry: { type: 'Polygon', coordinates: [[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] }
      },
      {
        type: 'Feature',
        id: 'thijssen',
        properties: { name: 'Café Thijssen (demo)' },
        geometry: { type: 'Polygon', coordinates: [[[4.88662,52.37688],[4.88674,52.37688],[4.88674,52.37680],[4.88662,52.37680],[4.88662,52.37688]]] }
      },
      {
        type: 'Feature',
        id: 'brandstof',
        properties: { name: 'Brandstof (demo)' },
        geometry: { type: 'Polygon', coordinates: [[[4.89546,52.35636],[4.89564,52.35636],[4.89564,52.35625],[4.89546,52.35625],[4.89546,52.35636]]] }
      }
    ]
  };

  try {
    const r = await fetch(WFS, { headers });
    if (!r.ok) {
      // Upstream fout → geef demo terug i.p.v. kapot gaan
      return res.status(200).json(demo);
    }

    const data = await r.json();

    // Soms geeft WFS CRSs/metadata terug maar 0 features — behandel dat als "geen data"
    if (!data.features || !Array.isArray(data.features) || data.features.length === 0) {
      return res.status(200).json(demo);
    }

    // Normaliseer naam/ids
    data.features.forEach((f, i) => {
      f.properties = f.properties || {};
      const name =
        f.properties.naam ||
        f.properties.bedrijfsnaam ||
        f.properties.zaak ||
        f.properties.naambedrijf ||
        f.properties.zaaknaam ||
        f.properties.adres;
      f.properties.name = name || `Terras #${i + 1}`;
      f.id = f.id || f.properties.identificatie || f.properties.uuid || f.properties.id || i;
    });

    return res.status(200).json(data);
  } catch (e) {
    // Netwerk/parse error → demo teruggeven
    return res.status(200).json(demo);
  }
}