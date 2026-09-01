/*
 * ============================================================
 *  api/product.js  —  SSR de meta tags para /producto/:slug
 * ============================================================
 *
 *  index.html es una SPA; los bots de WhatsApp/Facebook/etc.
 *  no ejecutan JS, así que cuando comparten un link de producto
 *  esta función sirve el mismo index.html pero con <title> y
 *  meta tags (OG/Twitter/canonical) del producto puntual.
 *  (vercel.json reescribe /producto/:slug hacia acá)
 * ============================================================
 */

const fs   = require('fs');
const path = require('path');

const PROD_DB  = '3a4459f1-13f9-81c8-b440-f1ebd658da27';
const BASE_URL = 'https://trama-tienda.vercel.app'; // ← cambiar por el dominio final
const DEFAULT_IMG = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=80';

// Debe coincidir con slugify()/productSlug() de index.html y api/sitemap.js
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

async function notionQuery(dbId, body = {}) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
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
  const slugParam = String(req.query.slug || '');
  const shortId = slugParam.split('-').pop() || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=50');

  try {
    const prodData = await notionQuery(PROD_DB, {
      filter: { property: 'Disponible', checkbox: { equals: true } },
    });

    const match = prodData.results.find(r => r.id.replace(/-/g, '').endsWith(shortId));
    if (!match) {
      return res.status(200).send(baseHtml);
    }

    const p = match.properties;
    const name = p.Nombre.title[0]?.plain_text || 'SOLAR GUARANI';

    const fotoFiles = p.Foto?.files || [];
    const imgs = fotoFiles.map(f => (f.type === 'external' ? f.external.url : f.file.url));
    if (imgs.length === 0 && p['Imagen URL']?.url) imgs.push(p['Imagen URL'].url);
    const img = imgs[0] || DEFAULT_IMG;

    const rawDesc = (p['Descripción']?.rich_text[0]?.plain_text || '').replace(/\s+/g, ' ').trim();
    const description = (rawDesc || `Comprá ${name} en SOLAR GUARANI, moda y artesanía paraguaya. Envíos a todo el Paraguay.`).slice(0, 160);

    const canonicalSlug = `${slugify(name)}-${match.id.replace(/-/g, '').slice(-8)}`;
    const url = `${BASE_URL}/producto/${canonicalSlug}`;
    const title = `${name} | SOLAR GUARANI — Moda y Artesanía Paraguaya`;

    let html = baseHtml.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
    html = replaceMetaContent(html, 'name', 'description', description);
    html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);
    html = replaceMetaContent(html, 'property', 'og:url', url);
    html = replaceMetaContent(html, 'property', 'og:title', title);
    html = replaceMetaContent(html, 'property', 'og:description', description);
    html = replaceMetaContent(html, 'property', 'og:image', img);
    html = replaceMetaContent(html, 'name', 'twitter:title', title);
    html = replaceMetaContent(html, 'name', 'twitter:description', description);
    html = replaceMetaContent(html, 'name', 'twitter:image', img);

    return res.status(200).send(html);
  } catch (err) {
    console.error(err);
    return res.status(200).send(baseHtml);
  }
};
