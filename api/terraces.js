// /api/terraces.js — proxy met API key + REST GeoJSON endpoint
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const headers = { 'Accept': 'application/json' };
  const apiKey = process.env.AMS_API_KEY;
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const REST = 'https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning?_format=geojson';

  try {
    const r = await fetch(REST, { headers });
    if (!r.ok) return res.status(r.status).json({ error: 'Upstream error', status: r.status });

    const data = await r.json();
    data.features?.forEach((f, i) => {
      f.properties = f.properties || {};
      const name = f.properties.zaaknaam || f.properties.naam || f.properties.bedrijfsnaam || f.properties.naambedrijf || f.properties.adres;
      f.properties.name = name || `Terras #${i+1}`;
      f.id = f.properties.id || f.id || i;
    });

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Proxy failed', detail: String(e) });
  }
}