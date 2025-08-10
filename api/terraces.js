// /api/terraces.js — Amsterdam terrassen via WFS (brede BBOX) of REST, met key
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const apiKey = process.env.AMS_API_KEY || '';
  const headers = { 'Accept': 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  // Brede BBOX rond groot-Amsterdam (EPSG:4326 lon,lat)
  const WFS =
    'https://api.data.amsterdam.nl/v1/wfs/horeca/?' +
    'SERVICE=WFS&REQUEST=GetFeature&version=2.0.0' +
    '&typenames=exploitatievergunning-terrasgeometrie' +
    '&BBOX=4.55,52.20,5.10,52.50,urn:ogc:def:crs:EPSG::4326' +
    '&outputformat=geojson&srsName=urn:ogc:def:crs:EPSG::4326' +
    '&count=10000';

  // Alternatief REST endpoint (sommige accounts zien hier sneller data)
  const REST = 'https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning?_format=geojson';

  const demo = {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', id:'jaren',     properties:{ name:'Café de Jaren (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] } },
      { type:'Feature', id:'waterkant', properties:{ name:'Waterkant (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] } },
      { type:'Feature', id:'thijssen',  properties:{ name:'Café Thijssen (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.88662,52.37688],[4.88674,52.37688],[4.88674,52.37680],[4.88662,52.37680],[4.88662,52.37688]]] } },
      { type:'Feature', id:'brandstof', properties:{ name:'Brandstof (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.89546,52.35636],[4.89564,52.35636],[4.89564,52.35625],[4.89546,52.35625],[4.89546,52.35636]]] } }
    ]
  };

  async function fetchJSON(url) {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }

  try {
    // 1) Probeer WFS (breed gebied)
    let data = await fetchJSON(WFS);
    if (data?.features?.length) {
      data.features.forEach((f, i) => {
        f.properties = f.properties || {};
        const name = f.properties.naam || f.properties.bedrijfsnaam || f.properties.zaak || f.properties.naambedrijf || f.properties.zaaknaam || f.properties.adres;
        f.properties.name = name || `Terras #${i + 1}`;
        f.id = f.id || f.properties.identificatie || f.properties.uuid || f.properties.id || i;
      });
      return res.status(200).json({ source:'wfs', count: data.features.length, ...data });
    }

    // 2) Zo niet: probeer REST
    data = await fetchJSON(REST);
    if (data?.features?.length) {
      data.features.forEach((f, i) => {
        f.properties = f.properties || {};
        const name = f.properties.zaaknaam || f.properties.naam || f.properties.bedrijfsnaam || f.properties.naambedrijf || f.properties.adres;
        f.properties.name = name || `Terras #${i + 1}`;
        f.id = f.id || f.properties.identificatie || f.properties.uuid || f.properties.id || i;
      });
      return res.status(200).json({ source:'rest', count: data.features.length, ...data });
    }

    // 3) Nog steeds niets → demo met reden
    return res.status(200).json({ source:'demo(wfs-empty)', count: demo.features.length, ...demo });
  } catch (e) {
    // API niet bereikbaar of 401 → demo
    return res.status(200).json({ source:'demo(error)', error:String(e), count: demo.features.length, ...demo });
  }
}