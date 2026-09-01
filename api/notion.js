/*
 * ============================================================
 *  api/notion.js  —  Proxy entre la web y Notion (SOLAR GUARANI)
 * ============================================================
 *
 *  La web NO puede hablar con Notion directamente desde el
 *  navegador (CORS + el token debe quedar en el servidor).
 *  Esta Vercel Serverless Function hace de intermediario:
 *
 *    Navegador  →  /api/notion  →  Notion API  →  Navegador
 *
 *  A DIFERENCIA del template JAKAY'U, acá hay UNA SOLA base
 *  de datos: "Productos". Las categorías no tienen base propia,
 *  son las opciones del campo "Categoría" (tipo select) de esa
 *  misma base. El admin y la tienda comparten esta base, por lo
 *  que todo cambio del admin se refleja acá en tiempo real
 *  (el caché es de apenas 10 segundos).
 * ============================================================
 */

// ── ID de la base de datos única en Notion ──────────────────
const PROD_DB = '3a4459f1-13f9-81c8-b440-f1ebd658da27'; // Base "Productos" (SOLAR GUARANI)

const HEADERS = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/*
 * notionQuery(body) — consulta la base de Productos juntando
 * todas las páginas de resultados (Notion pagina de a 100).
 */
async function notionQuery(body = {}) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${PROD_DB}/query`, {
      method: 'POST',
      headers: HEADERS(),
      body: JSON.stringify(cursor ? { ...body, start_cursor: cursor } : body),
    });
    if (!res.ok) throw new Error(`Notion error ${res.status}`);
    const d = await res.json();
    results.push(...d.results);
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);
  return { results };
}

/*
 * getSchema() — trae el esquema de la base para conocer TODAS
 * las opciones del select "Categoría" en su orden original.
 */
async function getSchema() {
  const res = await fetch(`https://api.notion.com/v1/databases/${PROD_DB}`, {
    headers: HEADERS(),
  });
  if (!res.ok) throw new Error(`Notion error ${res.status}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  try {
    const [schema, prodData] = await Promise.all([
      getSchema(),
      notionQuery({
        filter: { property: 'Disponible', checkbox: { equals: true } },
        sorts:  [{ property: 'Nombre', direction: 'ascending' }],
      }),
    ]);

    // ── Productos ────────────────────────────────────────────
    const products = prodData.results.map(r => {
      const p = r.properties;

      // Imágenes: campo "Foto" (files) o, si está vacío, "Imagen URL"
      const fotoFiles = p.Foto?.files || [];
      const imgs = fotoFiles.map(f =>
        f.type === 'external' ? f.external.url : f.file.url
      );
      if (imgs.length === 0 && p['Imagen URL']?.url) imgs.push(p['Imagen URL'].url);

      const catName = p['Categoría']?.select?.name || '';

      return {
        id:          r.id,
        name:        p.Nombre.title[0]?.plain_text              || '',
        category:    catName ? slugify(catName) : '',
        price:       p.Precio?.number                           || 0,
        description: p['Descripción']?.rich_text[0]?.plain_text || '',
        badge:       p.Badge?.rich_text[0]?.plain_text          || null,
        img:         imgs[0] || null,
        imgs,
        sizes:       (p.Talles?.multi_select || []).map(t => t.name),
        destacado:   p.Destacado?.checkbox                      || false,
        stock:       p.Stock?.number                            ?? null,
        priceOld:    p['Precio anterior']?.number               || null,
      };
    });

    // ── Categorías ───────────────────────────────────────────
    // Salen de las opciones del select "Categoría" (en su orden
    // de Notion). Solo mostramos las que tienen productos
    // disponibles para no renderizar pestañas vacías.
    const usedSlugs = new Set(products.map(p => p.category).filter(Boolean));
    const options = schema.properties?.['Categoría']?.select?.options || [];
    const categories = options
      .map(o => ({ id: o.id, name: o.name, slug: slugify(o.name) }))
      .filter(c => usedSlugs.has(c.slug));

    // Caché de 10s en el edge de Vercel (+50s stale-while-revalidate)
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=50');
    res.json({ categories, products });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
