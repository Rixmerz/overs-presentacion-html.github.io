# Presentación OVER — versión HTML

La misma presentación que vive en `../presentacion-overs` (Angular 21), pasada a HTML, CSS
y JavaScript planos. Sin build, sin Node para verla, sin dependencias.

## Qué archivo usar

| Para | Archivo |
|---|---|
| **Mostrarla o mandarla** | `presentacion-over.html` — uno solo, 10,6 MB, con todo adentro (imágenes, video y tipografías). Doble click y anda, sin servidor y sin internet. |
| **Editarla** | La carpeta: `index.html` + `deck.css` + `deck.js` + `assets/`. |

El archivo único es una **salida**, no una fuente: se edita la carpeta y se regenera con

```bash
node empaquetar.mjs
```

## Cómo se usa la presentación

Igual que el original: `→` / `espacio` avanza, `←` retrocede, `O` abre el índice,
`F` pantalla completa, `Esc` cierra lo que esté abierto. `#portada`, `#admin`, `#ruta`… en
la URL saltan directo a esa lámina.

## Las ocho láminas

`Portada · Qué es · Antes → Después · Ingesta con IA (video) · Administrador de Over ·
Resultados · Hoja de ruta · Cierre`

Tres tienen **pasos internos**, y ninguna con controles propios: la misma flecha con la que
se avanza la presentación los recorre, y sólo cuando se agotan cambia de lámina.

| Lámina | Pasos |
|---|---|
| **Qué es** | el texto → el correo en grande → el PDF que el correo enlaza |
| **Antes → Después** | el coverflow de catorce condicionados → el formato único → los seis en fila |
| **Hoja de ruta** | una card por vez: la acerca, y después abre lo suyo (la de disponibilidad muestra además la tarificación encima) |

## El video de la ingesta, montado

La grabación son 56,4 s de pantalla completa a 1600×818, y tiene tres actos:

| Tramo del video | Qué pasa | Velocidad |
|---|---|---|
| 0,0 – 9,4 s | elegir el PDF entre los muchos de la carpeta | 3,4× → 2,3× |
| 9,4 – 38,6 s | Gemini corriendo los seis pasos del pipeline | 3× |
| 38,6 – 56,4 s | el canvas ya hidratado: bandas, rutas y el PDF real al lado | 0,7× → 1× |

El pipeline se queda en 3×: son 29 s de barras de progreso y a velocidad real la lámina se
vuelve una espera. Pero el instante en que el canvas aparece relleno baja a 0,7× —es el
golpe de efecto de la lámina— y todo lo que sigue, que es lo que hay para explicar, corre a
tiempo real. El loop dura 33 s, de los cuales **19 son el editor ya procesado** (antes eran
6).

Encima corre el **montaje**: veinticuatro planos que dicen a qué parte del cuadro mirar y
cuánto acercar — la lista de PDFs, los pasos que van cambiando de estado, las fechas que
salieron del PDF, la banda con su comisión, las rutas operativas, y al final la tabla del
editor y la del PDF juntas, con el mismo 4 % en las dos.

Las dos pistas viven en `deck.js`, en las tablas `VELOCIDAD` y `MONTAJE`. Para mover un
plano se toca una fila —`[tiempo del video, escala, foco x, foco y]`, con el foco en
fracción del cuadro—; entre fila y fila se interpola. La escala nunca baja de 1 y el
desplazamiento se recorta a `[1-escala, 0]`: así no aparece borde negro por más pegado al
costado que esté el foco.

## Qué se conservó y qué no

El contenido está: los textos, los catorce condicionados reales, el correo, el grafo de la
hoja de ruta, el video de la ingesta, el visor a pantalla completa, el índice y el teclado.

Las dos UI que en el original eran **componentes de Angular embebidos** —el administrador
de OVERs y el buscador de comisión— acá son el **DOM real de esos componentes**, volcado
del app corriendo: mismas clases, mismos datos, mismo marcado. Se ven idénticas porque
literalmente lo son. Lo que no viaja es la lógica (no hay backend ni Angular), así que se
les devolvió a mano el gesto que cada lámina enseña:

- **Administrador**: el buscador de la tabla filtra los 18 OVERs de verdad, y el lápiz de
  cualquier fila abre el editor.
- **Editor**: se abre con un OVER ya cargado — la aerolínea, la vigencia, las seis bandas
  con sus comisiones y el PDF al lado. Es el punto de esa lámina: editar un OVER no es
  llenar un formulario en blanco, es revisar lo que la IA dejó puesto.
- **Buscador**: abre en popup con SCL → MIA precargado y apretar *Buscar* revela las tres
  cards escalonadas — AC 9%, DL 8%, AA 8%, el mismo trío del correo y del semáforo.

Lo demás (crear, editar, eliminar) es marcado inerte: se ve, no hace nada.

La **barra de navegación** de la lámina del administrador es lo único recreado a mano, con
las nueve secciones reales: en el deck de Angular el shell se había quitado, así que no
había DOM de dónde volcarla.

## Cuatro trampas que ya se pagaron

Si algo de esto se vuelve a tocar, conviene saberlas — las cuatro cuestan horas de encontrar:

**Una animación con `fill: both` no se suelta sola.** Sigue imponiendo su último fotograma
para siempre, incluso terminada. La animación de salida de las láminas deja `opacity: 0`, y
al volver a una lámina por la que ya se había pasado quedaba en blanco. Sólo `cancel()` la
libera — `finish()` no.

**Las animaciones se congelan con la ventana en segundo plano.** `.lamina` nace en
`opacity: 0` y llega a 1 por animación, así que una lámina que cambia sin foco quedaba
invisible de forma permanente: compartir pantalla o un clic fuera del navegador a mitad de
la charla alcanzaba. Por lo mismo se descartó la View Transitions API, que directamente
descarta la transición cuando `visibilityState` no es `visible`, sin avisar. El deck ahora
sólo arma la entrada con la ventana a la vista y suelta lo que quedó a medias al volver.

**Un montaje escrito en CSS no puede seguir a un video de velocidad variable.** Los
acercamientos eran una animación de `@keyframes` de duración fija. En cuanto la grabación
dejó de correr a una sola velocidad, la animación se desfasó en el primer tramo lento, y
con `loop` el desfase se acumulaba vuelta a vuelta. Ahora el cuadro se recalcula en cada
frame a partir de `video.currentTime`, que es lo único que se mantiene en fase — y de paso
un `seek`, un `pause` o volver de una pestaña en segundo plano dejan la imagen correcta
sin resincronizar nada. Detalle que explica por qué nadie lo había notado: el
`@keyframes montaje-video` que el CSS invocaba **no existía en ninguna hoja**, así que el
acercamiento llevaba tiempo sin correr.

**`loading="lazy"` acá carga MÁS tarde, no antes.** Las veinte imágenes de la lámina de
estandarización lo traían. El deck tiene todas las láminas en el DOM con `hidden`, y una
imagen oculta no está «cerca del viewport»: el navegador no la baja hasta que la lámina
aparece, o sea justo cuando hay que verla. Medido con la portada activa y la página cargada
hace rato: **0 de 20 bajadas**. Como las fichas del coverflow tienen tamaño propio
(`.doc3d` es absoluta con `inset: 0`) y fondo blanco, no había salto de layout — se veían
catorce hojas en blanco. Sin el atributo: 20 de 20 en ~250 ms. El atributo resuelve el
problema de una página larga con scroll, que no es el de un deck de ocho láminas que se
recorre entero; la carga se dirige desde `deck.js` (`precargar`), que además decodifica con
`decode()` y ordena por cercanía a la lámina actual.

Ojo con dos cosas al verificar esto: `requestIdleCallback` **no dispara con la pestaña
oculta** —ni con su `timeout`, igual que las animaciones—, por eso la precarga lleva un
`setTimeout` de respaldo; y el navegador cachea `deck.js` y `deck.css`, que se referencian
sin `?v=`, así que recargar el HTML con un query no alcanza para probar un cambio en el JS
(`transferSize: 0` en `performance.getEntriesByType('resource')` lo delata). Lo más rápido
es levantar el servidor en otro puerto.

## Los archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Las ocho láminas, con los textos literales. Es lo que se edita. |
| `componente-editor.html` | El volcado del editor, ya incrustado en `index.html`. |
| `deck.css` | El SCSS del deck compilado, más el núcleo de Codex (paleta, `box-sizing`, `1rem = 10px`). |
| `deck.js` | Navegación, visor, índice, teclado, y el comportamiento de los dos componentes. |
| `app.css` | Volcado literal de las hojas del app en Angular (Codex + Material + los estilos del administrador y del buscador). **No editar a mano.** |
| `componente-admin.html` / `componente-buscador.html` | Los volcados de DOM, ya incrustados dentro de `index.html`. Se guardan para poder re-incrustarlos si se recapturan. |
| `assets/` | Imágenes, video y logos. `condicionados/` y `homogeneos/` son la primera página de cada PDF, convertida con `pdftoppm`. |
| `empaquetar.mjs` | Arma `presentacion-over.html`. |

## Si hay que recapturar los componentes

Se levanta el original (`cd ../presentacion-overs && npm start`), se abre la lámina o el
popup correspondiente y se vuelca `outerHTML` del componente más `document.styleSheets`.
Dos cosas que se pagan si se olvidan:

- **El CSS hay que volcarlo dos veces**, una con el administrador en pantalla y otra con el
  buscador abierto: Angular solo tiene inyectados los estilos de los componentes montados,
  así que un volcado único deja al otro sin estilo.
- **Los valores de los inputs son propiedades, no atributos.** Sin hacer
  `input.setAttribute('value', input.value)` antes de serializar, el volcado sale con los
  campos vacíos.
- Los logos de aerolínea salen de un CDN que no siempre es alcanzable; se apuntan a
  `assets/airline-logos/`. Al recrear el `<img>` hay que **conservarle el atributo
  `_ngcontent-…` del buscador**, o la regla que lo dimensiona no matchea y el logo desborda
  la card.
