// /api/terraces.js — Terrassen-proxy (WFS) + fallback demo, met bron & count
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const apiKey = process.env.AMS_API_KEY || '';
  const headers = { 'Accept': 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const WFS =
    'https://api.data.amsterdam.nl/v1/wfs/horeca/?' +
    'REQUEST=GetFeature&SERVICE=WFS&version=2.0.0' +
    '&typenames=exploitatievergunning-terrasgeometrie' +
    '&BBOX=4.63,52.25,5.06,52.45,urn:ogc:def:crs:EPSG::4326' +
    '&outputformat=geojson&srsName=urn:ogc:def:crs:EPSG::4326' +
    '&count=10000';

  const demo = {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', id:'jaren',     properties:{ name:'Café de Jaren (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] } },
      { type:'Feature', id:'waterkant', properties:{ name:'Waterkant (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] } },
      { type:'Feature', id:'thijssen',  properties:{ name:'Café Thijssen (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.88662,52.37688],[4.88674,52.37688],[4.88674,52.37680],[4.88662,52.37680],[4.88662,52.37688]]] } },
      { type:'Feature', id:'brandstof', properties:{ name:'Brandstof (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.89546,52.35636],[4.89564,52.35636],[4.89564,52.35625],[4.89546,52.35625],[4.89546,52.35636]]] } }
    ]
  };

  try {
    const r = await fetch(WFS, { headers });
    if (!r.ok) {
      // upstream error → demo
      return res.status(200).json({ source:'demo', count: demo.features.length, ...demo });
    }
    const data = await r.json();
    if (!data.features || !Array.isArray(data.features) || data.features.length === 0) {
      return res.status(200).json({ source:'demo', count: demo.features.length, ...demo });
    }

    data.features.forEach((f, i) => {
      f.properties = f.properties || {};
      const name = f.properties.naam || f.properties.bedrijfsnaam || f.properties.zaak || f.properties.naambedrijf || f.properties.zaaknaam || f.properties.adres;
      f.properties.name = name || `Terras #${i + 1}`;
      f.id = f.id || f.properties.identificatie || f.properties.uuid || f.properties.id || i;
    });

    return res.status(200).json({ source:'wfs', count: data.features.length, ...data });
  } catch (e) {
    return res.status(200).json({ source:'demo', count: demo.features.length, ...demo });
  }
}