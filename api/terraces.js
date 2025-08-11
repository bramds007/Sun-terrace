// /api/terraces.js — REST (paging) → DEMO (alleen als echt niks lukt)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const REST_START = 'https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning?_format=json';

  const demo = { type: 'FeatureCollection', features: [
    { type:'Feature', id:'jaren',     properties:{ name:'Café de Jaren (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] } },
    { type:'Feature', id:'waterkant', properties:{ name:'Waterkant (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] } },
    { type:'Feature', id:'thijssen',  properties:{ name:'Café Thijssen (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.88662,52.37688],[4.88674,52.37688],[4.88674,52.37680],[4.88662,52.37680],[4.88662,52.37688]]] } },
    { type:'Feature', id:'brandstof', properties:{ name:'Brandstof (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.89546,52.35636],[4.89564,52.35636],[4.89564,52.35625],[4.89546,52.35625],[4.89546,52.35636]]] } }
  ]};

  const fetchJSON = async url => {
    const r = await fetch(url, { headers: { 'Accept': 'application/geo+json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  const normalize = (fc, nameFields) => {
    fc.features.forEach((f, i) => {
      f.properties = f.properties || {};
      const name = nameFields.map(k => f.properties[k]).find(Boolean);
      f.properties.name = name || `Terras #${i+1}`;
      f.id = f.id || f.properties.identificatie || f.properties.uuid || f.properties.id || i;
    });
    return fc;
  };

  try {
    // REST met paging (max ~20 pagina's)
    let next = REST_START;
    const all = { type: 'FeatureCollection', features: [] };
    let guard = 0;
    while (next && guard++ < 20) {
      const page = await fetchJSON(next);
      if (page?.features?.length) all.features.push(...page.features);

      next = null;
      if (page?.links) {
        const n = page.links.find(l => (l.rel || '').toLowerCase() === 'next');
        if (n?.href) next = n.href;
      }
      if (!next && page?._links?.next?.href) next = page._links.next.href;
      if (!next && page?.next) next = page.next;
    }

    if (all.features.length) {
      const data = normalize(all, ['zaaknaam','naam','bedrijfsnaam','naambedrijf','adres']);
      return res.status(200).json({ source:'rest', count: data.features.length, ...data });
    }
  } catch (e) {
    // laat doorvallen naar demo
  }

  return res.status(200).json({ source:'demo', count: demo.features.length, ...demo });
}
