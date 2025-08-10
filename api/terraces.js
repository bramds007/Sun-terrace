// /api/terraces.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const WFS = "https://api.data.amsterdam.nl/v1/wfs/horeca/?REQUEST=GetFeature&SERVICE=WFS&version=2.0.0&count=5000&typenames=exploitatievergunning-terrasgeometrie&BBOX=4.58565,52.03560,5.31360,52.48769,urn:ogc:def:crs:EPSG::4326&outputformat=geojson&srsName=urn:ogc:def:crs:EPSG::4326";
  try {
    const r = await fetch(WFS, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) return res.status(r.status).json({ error: 'Upstream error', status: r.status });
    const data = await r.json();
    data.features?.forEach((f, i) => {
      f.properties = f.properties || {};
      const name = f.properties.naam || f.properties.bedrijfsnaam || f.properties.zaak || f.properties.naambedrijf;
      f.properties.name = name || `Terras #${i+1}`;
      f.properties.id = f.properties.identificatie || f.properties.uuid || f.id || i;
      f.id = f.properties.id;
    });
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Proxy failed', detail: String(e) });
  }
}