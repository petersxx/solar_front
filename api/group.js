/*
 * ============================================================
 *  api/group.js  —  SSR de meta tags para /artesanias y /ropas
 * ============================================================
 *
 *  Gemelo de api/category.js, pero un nivel más arriba: las dos
 *  páginas de grupo de la portada. index.html es una SPA y los
 *  bots de WhatsApp/Facebook/Google no ejecutan JS, así que si
 *  alguien comparte el link de "Artesanías" esta función sirve el
 *  MISMO index.html pero con <title>, description, canonical y
 *  og:image del grupo.
 *  (vercel.json reescribe /artesanias y /ropas hacia acá)
 *
 *  El reparto de categorías por grupo vive en api/_groups.js.
 *  La foto de portada es la foto fija del grupo ("image" en
 *  _groups.js) si tiene; si no, sale del catálogo: la primera pieza
 *  con foto de alguna categoría del grupo (en Notion no hay dónde
 *  guardar una imagen de grupo).
 * ============================================================
 */

const fs   = require('fs');
const path = require('path');

const { findGroup, groupOf, slugify } = require('./_groups');

const PROD_DB  = '3a4459f1-13f9-81c8-b440-f1ebd658da27';
const BASE_URL = 'https://trama-tienda.vercel.app'; // ← cambiar por el dominio final

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

function replaceMetaContent(html, attr, key, value) {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
  return html.replace(re, `$1${escapeHtml(value)}$2`);
}

module.exports = async function handler(req, res) {
  const baseHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const group = findGroup(req.query.slug);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=50');

  // Grupo inexistente: se sirve el index tal cual y la SPA se
  // encarga (cae en la portada y corrige la barra de direcciones).
  if (!group) return res.status(200).send(baseHtml);

  try {
    const prodData = await notionQuery(PROD_DB, {
      filter: { property: 'Disponible', checkbox: { equals: true } },
    });

    // Piezas del grupo: las de cualquier categoría que le pertenezca.
    // Las que no tienen categoría no entran en ningún grupo (se ven
    // en /coleccion y en el buscador).
    const inGroup = prodData.results.filter(r => {
      const cat = r.properties['Categoría']?.select?.name;
      return cat ? groupOf(slugify(cat)) === group.slug : false;
    });

    let cover = group.image ? `${BASE_URL}${group.image}` : null;
    if (!cover) for (const r of inGroup) {
      const files = r.properties.Foto?.files || [];
      const first = files[0];
      cover = first ? (first.type === 'external' ? first.external.url : first.file.url)
                    : (r.properties['Imagen URL']?.url || null);
      if (cover) break;
    }

    const url   = `${BASE_URL}/${group.slug}`;
    // Para el buscador vale el nombre de catálogo, no el de marca
    const seo = group.seoName || group.name;
    const title = `${seo} | SOLAR GUARANI — Moda y Artesanía Paraguaya`;
    const description = inGroup.length
      ? `${seo}: ${inGroup.length} pieza${inGroup.length === 1 ? '' : 's'} hecha${inGroup.length === 1 ? '' : 's'} a mano en Paraguay. ${group.tagline} Envíos a todo el país, pedidos por WhatsApp.`
      : `${seo} en SOLAR GUARANI. ${group.tagline} Envíos a todo el país, pedidos por WhatsApp.`;

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
