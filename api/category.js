/*
 * ============================================================
 *  api/category.js  —  SSR de meta tags para /categoria/:slug
 * ============================================================
 *
 *  Gemelo de api/product.js, pero para las páginas de categoría.
 *  index.html es una SPA y los bots de WhatsApp/Facebook/Google
 *  no ejecutan JS: si alguien comparte el link de una categoría,
 *  esta función sirve el MISMO index.html pero con <title> y
 *  meta tags (OG/Twitter/canonical) de esa categoría puntual.
 *  (vercel.json reescribe /categoria/:slug hacia acá)
 *
 *  Las categorías no son una base aparte: son las opciones del
 *  select "Categoría" de la base "Productos", así que hay que
 *  leer el esquema de la base para conocerlas.
 * ============================================================
 */

const fs   = require('fs');
const path = require('path');

const PROD_DB  = '3a4459f1-13f9-81c8-b440-f1ebd658da27';
const BASE_URL = 'https://trama-tienda.vercel.app'; // ← cambiar por el dominio final

// Debe coincidir con slugify() de index.html, api/notion.js y api/sitemap.js
function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const HEADERS = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});

async function notionQuery(dbId, body = {}) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
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

async function getSchema() {
  const res = await fetch(`https://api.notion.com/v1/databases/${PROD_DB}`, { headers: HEADERS() });
  if (!res.ok) throw new Error(`Notion error ${res.status}`);
  return res.json();
}

function replaceMetaContent(html, attr, key, value) {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
  return html.replace(re, `$1${escapeHtml(value)}$2`);
}

module.exports = async function handler(req, res) {
  const baseHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const slugParam = slugify(String(req.query.slug || ''));

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=50');

  try {
    const [schema, prodData] = await Promise.all([
      getSchema(),
      notionQuery(PROD_DB, { filter: { property: 'Disponible', checkbox: { equals: true } } }),
    ]);

    const options = schema.properties?.['Categoría']?.select?.options || [];
    const cat = options.find(o => slugify(o.name) === slugParam);

    // Categoría inexistente: se sirve el index tal cual (la SPA
    // redirige sola a la home al no encontrar el slug).
    if (!cat) return res.status(200).send(baseHtml);

    // Productos de la categoría, para el conteo y la foto de portada
    const inCat = prodData.results.filter(
      r => slugify(r.properties['Categoría']?.select?.name || '') === slugParam
    );

    let cover = null;
    for (const r of inCat) {
      const files = r.properties.Foto?.files || [];
      const first = files[0];
      cover = first ? (first.type === 'external' ? first.external.url : first.file.url)
                    : (r.properties['Imagen URL']?.url || null);
      if (cover) break;
    }

    const url   = `${BASE_URL}/categoria/${slugParam}`;
    const title = `${cat.name} | SOLAR GUARANI — Moda y Artesanía Paraguaya`;
    const description = inCat.length
      ? `${cat.name}: ${inCat.length} pieza${inCat.length === 1 ? '' : 's'} de artesanía paraguaya hecha a mano en SOLAR GUARANI. Envíos a todo el país, pedidos por WhatsApp.`
      : `${cat.name} en SOLAR GUARANI: moda y artesanía paraguaya hecha a mano. Envíos a todo el país, pedidos por WhatsApp.`;

    let html = baseHtml.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
    html = replaceMetaContent(html, 'name', 'description', description);
    html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);
    html = replaceMetaContent(html, 'property', 'og:url', url);
    html = replaceMetaContent(html, 'property', 'og:title', title);
    html = replaceMetaContent(html, 'property', 'og:description', description);
    html = replaceMetaContent(html, 'name', 'twitter:title', title);
    html = replaceMetaContent(html, 'name', 'twitter:description', description);
    if (cover) {
      html = replaceMetaContent(html, 'property', 'og:image', cover);
      html = replaceMetaContent(html, 'name', 'twitter:image', cover);
    }

    return res.status(200).send(html);
  } catch (err) {
    console.error(err);
    return res.status(200).send(baseHtml);
  }
};
