// /api/terraces.js — REST (zonder speciale headers) + paging + debug
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const START = 'https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning?_format=json';

  const demo = { type:'FeatureCollection', features:[
    { type:'Feature', id:'jaren',     properties:{ name:'Café de Jaren (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] } },
    { type:'Feature', id:'waterkant', properties:{ name:'Waterkant (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] } },
    { type:'Feature', id:'thijssen',  properties:{ name:'Café Thijssen (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.88662,52.37688],[4.88674,52.37688],[4.88674,52.37680],[4.88662,52.37680],[4.88662,52.37688]]] } },
    { type:'Feature', id:'brandstof', properties:{ name:'Brandstof (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.89546,52.35636],[4.89564,52.35636],[4.89564,52.35625],[4.89546,52.35625],[4.89546,52.35636]]] } }
  ]};

  const fetchJSON = async (url) => {
    const r = await fetch(url);            // <-- geen Accept header
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };

  const normalize = (fc) => {
    fc.features.forEach((f,i)=>{
      f.properties = f.properties || {};
      const name = f.properties.zaaknaam || f.properties.naam || f.properties.bedrijfsnaam || f.properties.naambedrijf || f.properties.adres;
      f.properties.name = name || `Terras #${i+1}`;
      f.id = f.id || f.properties.identificatie || f.properties.uuid || f.properties.id || i;
    });
    return fc;
  };

  try {
    let next = START;
    const all = { type:'FeatureCollection', features:[] };
    let guard = 0;

    while (next && guard++ < 30) {
      const page = await fetchJSON(next);
      if (page?.features?.length) all.features.push(...page.features);

      // vind volgende pagina (meerdere varianten geprobeerd)
      next = null;
      if (page?.links) {
        const n = page.links.find(l => (l.rel || '').toLowerCase() === 'next');
        if (n?.href) next = n.href;
      }
      if (!next && page?._links?.next?.href) next = page._links.next.href;
      if (!next && typeof page?.next === 'string') next = page.next;
    }

    if (all.features.length) {
      const data = normalize(all);
      return res.status(200).json({ source:'rest', count:data.features.length, ...data });
    } else {
      return res.status(200).json({ source:'demo', reason:'rest-empty', count:demo.features.length, ...demo });
    }
  } catch (e) {
    return res.status(200).json({ source:'demo', reason:String(e), count:demo.features.length, ...demo });
  }
}
