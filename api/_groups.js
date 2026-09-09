/*
 * ============================================================
 *  api/_groups.js  —  Los DOS grupos de la portada
 * ============================================================
 *
 *  La portada no muestra las 13 categorías: muestra dos grupos,
 *  ARTESANÍAS y ROPAS, y cada uno tiene su página con sus
 *  categorías y sus piezas.
 *
 *  ⚠️ POR QUÉ ESTÁ HARDCODEADO ACÁ Y NO EN NOTION
 *  Las categorías no son filas de una base: son las opciones del
 *  select "Categoría" de la base "Productos". Una opción de select
 *  no puede tener propiedades propias, así que no hay dónde
 *  guardar en Notion a qué grupo pertenece cada una sin partir la
 *  arquitectura en dos bases. El reparto vive entonces en este
 *  archivo, que es el ÚNICO lugar donde se toca: lo usan
 *  api/notion.js, api/group.js y api/sitemap.js, y la tienda lo
 *  recibe ya resuelto desde /api/notion (index.html no tiene su
 *  propia copia).
 *
 *  Vercel ignora los archivos de /api que empiezan con "_": este
 *  módulo no es una ruta, es una librería (igual que el
 *  api/_auth.js del admin).
 *
 *  PARA AGREGAR UNA CATEGORÍA NUEVA: crearla en el admin y sumar
 *  su slug a la lista del grupo que corresponda. Si se olvida, no
 *  desaparece: cae en DEFAULT_GROUP (ver groupOf()).
 *  PARA AGREGAR UN GRUPO NUEVO: sumarlo acá y agregar su rewrite
 *  en vercel.json y en dev-server.js (las URLs son limpias,
 *  /artesanias y /ropas, así que cada grupo necesita la suya).
 * ============================================================
 */

// Debe coincidir con slugify() de index.html y del resto de /api
function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/*
 * Los slugs de "cats" son el slugify() del nombre de la opción en
 * Notion: "Ñanduti" → nanduti, "Palo santo" → palo-santo,
 * "Niños" → ninos, "Encaje ju" → encaje-ju.
 */
const GROUPS = [
  {
    slug: 'artesanias',
    name: 'Artesanías',
    // noun: el nombre en singular, para las frases donde el plural
    // del título no encaja ("todas las piezas de artesanía").
    noun: 'artesanía',
    tagline: 'Ñanduti, hamacas, palo santo y todo lo que nace en las manos para quedarse en la casa.',
    cats: ['nanduti', 'hamaca', 'manteles', 'camineros', 'carteras', 'palo-santo', 'recuerdos'],
  },
  {
    slug: 'ropas',
    name: 'Ropas',
    noun: 'ropa',
    // Modelo 3D de la tarjeta de la portada, que rota con el scroll.
    // Si está, reemplaza a la foto de portada calculada del catálogo.
    // Para sacarlo alcanza con borrar esta línea. Ver sección 4c de
    // la bitácora: el .glb no se sirve tal cual como sale del
    // escáner, se comprime antes (19,6 MB → 260 KB).
    model: '/modelos/ropas.glb',
    tagline: 'Aopoi, encaje ju y lienzo: la artesanía paraguaya que no se guarda, se lleva puesta.',
    cats: ['aopoi', 'camisas', 'chombas', 'ninos', 'lienzo', 'encaje-ju'],
  },
];

// Categoría nueva que nadie repartió todavía: antes que dejarla
// invisible (no estaría en ninguna de las dos páginas, y la portada
// ya no lista categorías sueltas), cae en Artesanías.
const DEFAULT_GROUP = 'artesanias';

/* groupOf(catSlug) → slug del grupo al que pertenece una categoría */
function groupOf(catSlug) {
  const g = GROUPS.find(x => x.cats.includes(catSlug));
  return g ? g.slug : DEFAULT_GROUP;
}

/* findGroup(slug) → el grupo, o undefined si esa URL no existe */
function findGroup(slug) {
  return GROUPS.find(g => g.slug === slugify(String(slug || '')));
}

module.exports = { GROUPS, DEFAULT_GROUP, groupOf, findGroup, slugify };
