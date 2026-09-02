/**
 * Empaqueta la carpeta en UN solo archivo `.html` para mandar por correo o chat.
 *
 * La carpeta (index.html + deck.css + deck.js + assets/) es la versión que se edita: los
 * textos están literales en el HTML y cada imagen es un archivo que se puede reemplazar.
 * El archivo único es la versión que se comparte: lo mismo, pero con el CSS, el JS, las
 * imágenes, el video y las tipografías incrustados como data URI, así abre con doble click
 * desde el escritorio, sin servidor y sin internet.
 *
 * Se edita la carpeta y se vuelve a correr esto. Nunca al revés: el archivo único es una
 * salida, no una fuente.
 *
 *   node empaquetar.mjs
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SALIDA = join(AQUI, 'presentacion-over.html');

/* Las tipografías salen del repo de la presentación en Angular, que ya las trae
 * self-hosted por `@fontsource`. Se incrustan en vez de linkear a Google Fonts porque el
 * archivo tiene que abrir sin red: una sala sin wifi no es un caso raro. */
const FUENTES_DIR = join(AQUI, '..', 'presentacion-overs', 'node_modules', '@fontsource');

const TIPO = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

function dataUri(ruta) {
  const mime = TIPO[extname(ruta).toLowerCase()];
  if (!mime) throw new Error(`No sé qué MIME ponerle a ${ruta}`);
  return `data:${mime};base64,${readFileSync(ruta).toString('base64')}`;
}

/** Una `@font-face` con el archivo incrustado. */
function cara(familia, peso, ruta) {
  return `@font-face{font-family:'${familia}';font-style:normal;font-weight:${peso};font-display:swap;src:url(${dataUri(ruta)}) format('woff2');}`;
}

const fuentes = [
  ...[400, 500, 600, 700, 800].map((p) => cara('Barlow', p, join(FUENTES_DIR, 'barlow', 'files', `barlow-latin-${p}-normal.woff2`))),
  cara(
    'Material Symbols Rounded',
    400,
    join(FUENTES_DIR, 'material-symbols-rounded', 'files', 'material-symbols-rounded-latin-400-normal.woff2')
  )
].join('\n');

let html = readFileSync(join(AQUI, 'index.html'), 'utf8');

// El <link> a Google Fonts se cambia por las caras incrustadas, y las dos hojas externas
// pasan a ser bloques inline.
html = html.replace(/ *<link rel="preconnect"[\s\S]*?<link\s+rel="stylesheet"\s+href="https:\/\/fonts[\s\S]*?\/>\n/, '');
for (const hoja of ['app.css', 'deck.css']) {
  html = html.replace(`<link rel="stylesheet" href="${hoja}" />`, `<style>\n${readFileSync(join(AQUI, hoja), 'utf8')}\n</style>`);
}
html = html.replace('<style>', `<style>\n${fuentes}\n</style>\n    <style>`);
html = html.replace(
  '<script src="deck.js"></script>',
  `<script>\n${readFileSync(join(AQUI, 'deck.js'), 'utf8')}\n</script>`
);

// Todo lo que apunte a `assets/…` —src, poster, data-ampliar— pasa a ser el archivo mismo.
const cache = new Map();
html = html.replace(/assets\/(?:[\w.\-]+\/)?[\w.\-]+\.(?:png|jpe?g|svg)/g, (rel) => {
  if (!cache.has(rel)) cache.set(rel, dataUri(join(AQUI, rel)));
  return cache.get(rel);
});

/* El video NO va como data URI, aunque todo lo demás sí.
 *
 * Con `<video src="data:video/mp4;base64,…">` de 3 MB, Chrome se queda en `networkState:
 * LOADING` para siempre: `readyState` nunca pasa de 0, `duration` queda en null y no tira
 * ningún error — la lámina se queda congelada en el póster sin decir por qué. Es que el
 * reproductor pide rangos del archivo y un `data:` no los sirve.
 *
 * Así que el mp4 viaja como base64 en un bloque de texto y se convierte a Blob URL al
 * abrir la página: un blob sí soporta rangos y el video arranca igual que desde disco. */
const VIDEO = 'assets/demo-ingesta-ia.mp4';
const b64 = readFileSync(join(AQUI, VIDEO)).toString('base64');
html = html.replace(` src="${VIDEO}"`, '');
html = html.replace(
  '<script>',
  `<script type="text/plain" id="video-mp4-b64">${b64}</script>
    <script>
      // base64 -> bytes -> Blob. Byte a byte y no con Array.from sobre el string entero:
      // sobre 3 MB eso ultimo traba la pestana al abrir.
      (() => {
        const cruda = atob(document.getElementById('video-mp4-b64').textContent);
        const bytes = new Uint8Array(cruda.length);
        for (let i = 0; i < cruda.length; i++) bytes[i] = cruda.charCodeAt(i);
        document.querySelector('video.video').src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      })();
    </script>
    <script>`
);

const pendientes = html.match(/["'(]assets\//g);
if (pendientes) throw new Error(`Quedaron ${pendientes.length} referencias a assets/ sin incrustar`);

writeFileSync(SALIDA, html);
console.log(`${SALIDA}  —  ${(statSync(SALIDA).size / 1024 / 1024).toFixed(1)} MB, ${cache.size} archivos incrustados`);
