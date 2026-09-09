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

// Los dos grupos de la portada (ARTESANÍAS / ROPAS) y el reparto de
// las categorías entre ellos. Único lugar donde se define: ver
// api/_groups.js.
const { GROUPS, groupOf, slugify } = require('./_groups');

const HEADERS = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});

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
    // Salen de las opciones del select "Categoría", en su orden de
    // Notion. Se devuelven TODAS, también las vacías: desde que la
    // home es la lista de categorías, filtrar las que no tienen
    // productos dejaría la portada en blanco. La tienda las muestra
    // igual, marcadas como "Próximamente".
    //   count → productos disponibles en esa categoría
    //   cover → foto del primer producto que tenga, para la portada
    //   group → a cuál de los dos grupos pertenece (ver _groups.js)
    const options = schema.properties?.['Categoría']?.select?.options || [];
    const categories = options.map(o => {
      const slug = slugify(o.name);
      const inCat = products.filter(p => p.category === slug);
      return {
        id: o.id,
        name: o.name,
        slug,
        count: inCat.length,
        cover: inCat.find(p => p.img)?.img || null,
        group: groupOf(slug),
      };
    });

    // ── Grupos ───────────────────────────────────────────────
    // Los dos bloques de la portada. Se devuelven SIEMPRE los dos,
    // tengan piezas o no: son la puerta de entrada a la tienda, no
    // un listado de stock. Igual que con las categorías, la foto de
    // portada sale del propio catálogo (la primera pieza con foto
    // del grupo), porque en Notion no hay dónde guardarla.
    //   count    → piezas disponibles en todo el grupo
    //   catCount → categorías del grupo que ya tienen piezas
    const groups = GROUPS.map(g => {
      const cats  = categories.filter(c => c.group === g.slug);
      const count = cats.reduce((n, c) => n + c.count, 0);
      return {
        slug: g.slug,
        name: g.name,
        seoName: g.seoName || g.name,
        noun: g.noun,
        tagline: g.tagline,
        model: g.model || null,
        cats: cats.map(c => c.slug),
        count,
        catCount: cats.filter(c => c.count > 0).length,
        cover: cats.find(c => c.cover)?.cover || null,
      };
    });

    // Caché de 10s en el edge de Vercel (+50s stale-while-revalidate)
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=50');
    res.json({ groups, categories, products });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
