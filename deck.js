/* Presentación OVER — la lógica que en el original vivía en `PresentacionPageComponent`.
 *
 * Son cuatro cosas, y ninguna necesita un framework: qué lámina se ve, el visor de
 * imágenes a pantalla completa, el índice y el teclado. El estado son tres variables;
 * las signals de Angular se traducen a llamar `pintar()` después de cambiarlas.
 *
 * El orden de las láminas NO está acá: sale del DOM, leyendo los `<section data-id>` en el
 * orden en que están escritos. Así reordenar la presentación es mover un bloque de HTML y
 * nada más — no hay una lista que mantener sincronizada con el markup.
 */
(() => {
  const secciones = [...document.querySelectorAll('.lamina[data-id]')];
  const laminas = secciones.map((s) => ({
    id: s.dataset.id,
    titulo: s.dataset.titulo,
    oscura: s.dataset.oscura === 'true',
    el: s
  }));

  const deck = document.querySelector('.deck');
  const barra = document.querySelector('.rail i');
  const hudIdx = document.querySelector('.hud__idx');
  const btnPrev = document.querySelector('.hud button[data-ir="prev"]');
  const btnNext = document.querySelector('.hud button[data-ir="next"]');
  const video = document.querySelector('video.video');

  let indice = 0;
  let indiceAbierto = false;
  /** Imagen abierta a pantalla completa, o null. */
  let ampliado = null;
  /** En el visor: false ajusta la hoja a la pantalla, true la muestra a su ancho real. */
  let tamanoReal = false;

  /* ── láminas ────────────────────────────────────────────────────────── */

  function ir(i, sentido) {
    const siguiente = Math.max(0, Math.min(laminas.length - 1, i));
    if (siguiente === indice) return;
    const atras = sentido === 'atras' || siguiente < indice;
    /* La lámina que se va es la actual ANTES de mover el índice.
     *
     * Antes se la buscaba con `find(l => !l.el.hidden)`, y eso tenía un bug de verdad: si la
     * animación de salida anterior todavía corría, su lámina seguía visible, así que había
     * DOS visibles y `find` —que recorre en orden del DOM— devolvía la de índice más bajo.
     * Al cambiar de dirección esa era justamente la lámina que estaba ENTRANDO: se la
     * desvanecía y se la ocultaba, y la presentación quedaba en blanco. Es exactamente el
     * caso de "avanzar varias y volver" y el de "retroceder y después avanzar". */
    const anterior = laminas[indice].el;
    indice = siguiente;
    // `replaceState` y no `location.hash`: avanzar diez láminas dejaba diez entradas en el
    // historial, y el botón atrás del navegador no salía nunca de la presentación.
    history.replaceState(null, '', `${location.pathname}${location.search}#${laminas[indice].id}`);
    transicion(anterior, atras);
  }

  /* ── el cambio de lámina, como transformación ────────────────────────────
   *
   * Primero se probó con la View Transitions API, que es la vía corta. No sirve acá: el
   * navegador descarta la transición entera cuando `document.visibilityState` no es
   * `visible` —una ventana tapada, un segundo monitor apagado, una pantalla compartida— y
   * eso es exactamente el escenario de una presentación. Falla en silencio, sin error.
   *
   * Esto es FLIP, y no depende de ninguna API nueva: se miden los elementos ANTES del
   * cambio (First), se aplica el cambio (Last), se los devuelve a mano a donde estaban con
   * un transform (Invert) y se los suelta (Play). El navegador anima entre los dos estados.
   *
   * Lo que lo hace leer como transformación y no como fundido es que se miden POR PAPEL:
   * el epígrafe de una lámina y el de la siguiente son elementos distintos del DOM, pero
   * cumplen la misma función, así que se los trata como el mismo y se ve viajar de una
   * posición a la otra. */

  /** Los papeles que se persiguen de una lámina a la otra. */
  const PAPELES = {
    epigrafe: '.epigrafe',
    titular: 'h1, h2',
    bajada: '.bajada'
  };

  const DURACION = 620;

  function medirPapeles(seccion) {
    const medidas = {};
    if (!seccion) return medidas;
    for (const [papel, sel] of Object.entries(PAPELES)) {
      const el = seccion.querySelector(sel);
      if (el) medidas[papel] = el.getBoundingClientRect();
    }
    return medidas;
  }

  function volar(seccion, antes) {
    for (const [papel, sel] of Object.entries(PAPELES)) {
      const el = seccion.querySelector(sel);
      const a = antes[papel];
      if (!el || !a || !a.width) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      // La escala sale del ancho y se aplica a los dos ejes: el titular de la portada y el
      // de una lámina interior tienen cuerpos muy distintos, y sin escalar el texto salta
      // de tamaño al llegar en vez de crecer por el camino.
      const s = b.width ? a.width / b.width : 1;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(s - 1) < 0.02) continue;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.35 },
          { transform: 'none', opacity: 1 }
        ],
        { duration: DURACION, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' }
      );
    }
  }

  /**
   * La lámina que sale no desaparece de golpe: se queda encima, corrida hacia el lado
   * contrario al que se avanza, y se apaga. Es lo que le da sentido de dirección al gesto —
   * sin eso, ir y volver se ven exactamente igual.
   *
   * Va `position: absolute` porque durante el cruce hay DOS láminas visibles, y como
   * hermanas en el flex del deck se repartirían el alto y las dos saltarían de tamaño.
   */
  /**
   * La animación de salida en curso de cada lámina.
   *
   * Hace falta poder cancelarla. Si se avanza y se retrocede rápido, la lámina que estaba
   * saliendo vuelve a ser la actual mientras su animación sigue viva; al terminar, esa
   * animación la ocultaba —y con `fill: both` la dejaba además en opacidad 0—, así que la
   * lámina correcta quedaba en pantalla pero invisible: la presentación se veía vacía.
   */
  const saliendo = new WeakMap();

  /**
   * Suelta cualquier animación de salida que quede sobre la lámina.
   *
   * `cancel()` y no `finish()`: la animación tiene `fill: both`, y una animación con fill
   * sigue imponiendo el valor de su último fotograma —opacidad 0— indefinidamente, esté
   * corriendo o ya terminada. Cancelarla es la única forma de devolverle al elemento el
   * estilo de la hoja.
   *
   * Se recorre `getAnimations()` en vez de fiarse sólo del registro: una animación que ya
   * terminó fue borrada del registro por su propio `then`, pero su fill sigue puesto. Ése
   * era el blanco que aparecía al volver a una lámina por la que ya se había pasado.
   */
  function cancelarSalida(seccion) {
    saliendo.delete(seccion);
    for (const anim of seccion.getAnimations()) {
      // Sólo las de salida: la de entrada (`entrar`, de la hoja) tiene nombre y no se toca.
      if (!anim.animationName) anim.cancel();
    }
    seccion.classList.remove('lamina--saliendo');
  }

  function despedir(seccion, atras) {
    if (!seccion) return;
    cancelarSalida(seccion);
    seccion.classList.add('lamina--saliendo');
    const anim = seccion.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: `translateX(${atras ? 4 : -4}rem) scale(0.97)` }
      ],
      { duration: DURACION * 0.8, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'both' }
    );
    saliendo.set(seccion, anim);
    anim.finished
      .then(() => {
        // Sólo se oculta si sigue siendo la que se estaba yendo. Entre medio pudo volver a
        // ser la lámina actual.
        if (saliendo.get(seccion) !== anim) return;
        saliendo.delete(seccion);
        seccion.classList.remove('lamina--saliendo');
        seccion.hidden = true;
        // Y se suelta el fill. Ya está oculta, así que no hay parpadeo — y sin esto la
        // lámina arrastra la opacidad 0 del último fotograma para siempre.
        anim.cancel();
      })
      .catch(() => {
        /* cancelada: la lámina volvió a estar en pantalla y no hay nada que ocultar */
      });
  }

  function transicion(anterior, atras) {
    const entrante = laminas[indice].el;
    const antes = medirPapeles(anterior);

    /* Sin animación en dos casos: movimiento reducido, y ventana fuera de vista.
     *
     * El segundo no es cortesía, es correccion: `volar()` y `despedir()` usan `fill: both`, y
     * con la ventana en segundo plano las animaciones no avanzan — se quedarían clavadas en
     * su primer fotograma, o sea el titular corrido y a opacidad 0.35 y la lámina saliente
     * encima. Nadie está mirando, así que se cambia sin animar y el resultado es correcto. */
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.visibilityState !== 'visible') {
      pintar();
      return;
    }

    // `conservar` deja la saliente visible: la oculta `despedir()` cuando termina de
    // animarse. Ocultándola acá no habría nada que animar — que es lo que pasaba antes,
    // porque `pintar` ignoraba este argumento.
    pintar(anterior);
    document.documentElement.dataset.sentido = atras ? 'atras' : 'adelante';
    despedir(anterior, atras);
    volar(entrante, antes);
  }

  /**
   * Avanzar y retroceder no cambian de lámina a ciegas.
   *
   * Una lámina puede tener pasos propios —el cubo de las fases tiene seis caras— y en ese
   * caso la flecha tiene que recorrerlos antes de saltar. Se avisa con un evento cancelable
   * sobre la sección: si alguien lo cancela, es porque consumió el gesto. Así el deck no
   * necesita saber nada de lo que cada lámina tenga adentro.
   */
  function pedirPaso(sentido) {
    const ev = new CustomEvent(`deck:${sentido}`, { cancelable: true });
    return !laminas[indice].el.dispatchEvent(ev);
  }

  function avanzar() {
    if (pedirPaso('avanzar')) return;
    ir(indice + 1, 'adelante');
  }

  function retroceder() {
    if (pedirPaso('retroceder')) return;
    ir(indice - 1, 'atras');
  }

  /**
   * Deja en pantalla la lámina actual y oculta las demás.
   *
   * `conservar` es la lámina que se está yendo: se la deja visible para que su animación de
   * salida se vea. Cualquier OTRA lámina se oculta y se le cancela la salida pendiente —
   * si no, esa animación terminaría después y volvería a ocultar una lámina que quizás ya
   * es la actual.
   */
  function pintar(conservar) {
    laminas.forEach((l, i) => {
      const visible = i === indice;
      if (visible || l.el !== conservar) {
        // Si venía saliendo, se corta la salida: sin esto termina y la oculta de nuevo, o
        // la deja con la opacidad 0 que dejó su `fill: both`.
        cancelarSalida(l.el);
      }
      /* La lámina que YA estaba visible al cargar —la portada— no pasa por la rama de abajo,
       * así que su `animation: entrar` de la hoja queda armada. Con la ventana en segundo
       * plano esa animación no avanza y su `fill: both` la deja en opacidad 0: el archivo
       * abierto sin foco mostraba la portada en blanco. */
      if (visible && !l.el.hidden && document.visibilityState !== 'visible') {
        l.el.style.animation = 'none';
        l.el.dataset.entrada = 'si';
      }
      if (visible && l.el.hidden) {
        l.el.hidden = false;
        // La animación de entrada corría al montarse la lámina. Acá la lámina no se monta:
        // ya estaba en el DOM, así que hay que reiniciar la animación a mano. Leer
        // `offsetWidth` entre quitar y poner la clase fuerza el reflow que lo hace efectivo.
        // La animación de entrada se rearma SÓLO con la ventana a la vista.
        //
        // `.lamina` nace en `opacity: 0` y llega a 1 por la animación `entrar`, que tiene
        // `fill: both`. Un navegador con la ventana oculta o en segundo plano congela las
        // animaciones: la de entrada se queda en su primer fotograma y, por el fill, la
        // lámina se queda en opacidad 0 — invisible, y para siempre, porque al volver el
        // foco la animación reanuda desde donde estaba pero nadie la vio empezar.
        //
        // Es exactamente el blanco que aparecía al cambiar de lámina con el foco en otra
        // ventana (compartir pantalla, un clic fuera del navegador a mitad de la charla).
        // Sin ventana a la vista no hay entrada que mostrar, así que no se arma ninguna.
        if (document.visibilityState === 'visible') {
          l.el.style.animation = 'none';
          void l.el.offsetWidth;
          l.el.style.animation = '';
        } else {
          l.el.style.animation = 'none';
        }
        /* Señal de "esta lámina acaba de entrar", para lo que tenga que animarse adentro
         * (hoy: las barras del embudo de resultados).
         *
         * Va en el cuadro SIGUIENTE a propósito. La lámina venía en `display: none`, así que
         * su contenido no tenía estilo calculado: puesta en el mismo cuadro, el navegador no
         * ve dos estados entre los que interpolar y la transición no corre — las barras
         * aparecerían ya crecidas. Un cuadro de espera es lo que le da el punto de partida. */
        if (document.visibilityState === 'visible') {
          requestAnimationFrame(() => {
            if (!l.el.hidden) l.el.dataset.entrada = 'si';
          });
        } else {
          // `requestAnimationFrame` no se dispara con la ventana oculta, así que por esa vía
          // el atributo no llegaría nunca y las barras del embudo quedarían en largo cero.
          // Sin ventana a la vista tampoco hay transición que escalonar: se pone directo.
          l.el.dataset.entrada = 'si';
        }
      } else if (!visible && l.el !== conservar) {
        l.el.hidden = true;
        // Se rearma para la próxima entrada: si quedara puesto, volver a la lámina la
        // mostraría con las barras ya crecidas y sin recorrido.
        delete l.el.dataset.entrada;
      }
    });

    deck.classList.toggle('deck--oscura', laminas[indice].oscura);
    barra.style.width = `${((indice + 1) / laminas.length) * 100}%`;
    hudIdx.textContent = `${indice + 1}/${laminas.length}`;
    btnPrev.disabled = indice === 0;
    btnNext.disabled = indice === laminas.length - 1;

    // El video arrancaba solo al aparecer la lámina y se destruía al salir. Con todas las
    // láminas en el DOM hay que hacerlo explícito, o sigue corriendo por detrás.
    if (video) {
      if (laminas[indice].id === 'ingesta') void video.play().catch(() => {});
      else video.pause();
    }
  }

  /* El video corre a 3x.
   *
   * Son 56 segundos de una grabacion de pantalla: a velocidad normal la lamina se queda
   * quieta demasiado tiempo y hay que narrar sobre esperas. A 3x el pipeline completo pasa
   * en menos de 19 segundos y se lee como un proceso, no como una espera.
   *
   * Se vuelve a fijar en cada `play` porque algunos navegadores devuelven `playbackRate` a
   * 1 al cargar metadatos o al reiniciar el loop, y el montaje del CSS —que dura
   * exactamente 56.4/3 segundos— quedaria desfasado del video. */
  const VELOCIDAD = 3;

  if (video) {
    const acelerar = () => {
      video.playbackRate = VELOCIDAD;
      video.defaultPlaybackRate = VELOCIDAD;
    };
    acelerar();
    ['loadedmetadata', 'play', 'seeked'].forEach((e) => video.addEventListener(e, acelerar));
  }

  /* ── visor a pantalla completa ──────────────────────────────────────── */

  const visor = document.querySelector('.visor');
  const visorT = visor.querySelector('.visor__t');
  const visorImg = visor.querySelector('.visor__hoja img');
  const visorHoja = visor.querySelector('.visor__hoja');
  const btnReal = visor.querySelector('[data-visor="real"]');

  /**
   * Abre el visor creciendo **desde el elemento que se apretó**.
   *
   * Sin eso el salto desconcierta: la pantalla cambia entera y no queda rastro de dónde
   * salió la imagen. Se guardan tres números —desplazamiento en x, en y, y escala inicial—
   * relativos al centro de la pantalla, que es el punto de reposo del visor, y los consume
   * la animación de CSS como variables.
   */
  function medirOrigen(el) {
    if (!(el instanceof HTMLElement)) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2 - window.innerWidth / 2),
      y: Math.round(r.top + r.height / 2 - window.innerHeight / 2),
      // Acotada: un botón muy chico daría una escala diminuta y la apertura se vería como
      // una explosión en vez de como una tarjeta que se abre.
      escala: Math.min(0.55, Math.max(0.16, r.width / window.innerWidth))
    };
  }

  function aplicarOrigen(caja, o) {
    if (!o) {
      caja.style.removeProperty('--ox');
      caja.style.removeProperty('--oy');
      caja.style.removeProperty('--oe');
      return;
    }
    caja.style.setProperty('--ox', `${o.x}px`);
    caja.style.setProperty('--oy', `${o.y}px`);
    caja.style.setProperty('--oe', String(o.escala));
  }

  /** La segunda hoja: la que se solapa sobre la primera cuando el recorrido la pide. */
  const visorSobre = visor.querySelector('.visor__sobre');

  function ponerHoja(src, titulo, sobre) {
    tamanoReal = false;
    ampliado = { src, titulo, sobre };
    visorImg.src = src;
    visorImg.alt = titulo;
    visorT.textContent = titulo;
    visorHoja.classList.remove('visor__hoja--real');
    visorHoja.classList.remove('visor__hoja--sobre');
    btnReal.textContent = 'Tamaño real';

    /* La segunda hoja se PREPARA acá pero no se muestra: la revela `revelarSobre()` cuando
       el recorrido llega a ese paso. Si no hay segunda, se le quita la fuente para que no
       quede una imagen vieja lista para aparecer en la próxima apertura. */
    if (!visorSobre) return;
    if (sobre && sobre.src) {
      visorSobre.src = sobre.src;
      visorSobre.alt = sobre.titulo || '';
      visorSobre.hidden = false;
    } else {
      visorSobre.hidden = true;
      visorSobre.removeAttribute('src');
    }
  }

  /**
   * Revela la hoja de encima. Devuelve `false` si esta apertura no tenía una.
   *
   * La clase va en el cuadro SIGUIENTE a propósito: la imagen viene de `hidden`, o sea sin
   * estilo calculado, así que puesta en el mismo cuadro el navegador no tiene dos estados
   * entre los que interpolar y aparecería de golpe, sin transición.
   */
  function revelarSobre() {
    if (!visorSobre || visorSobre.hidden) return false;
    if (ampliado && ampliado.sobre && ampliado.sobre.titulo) visorT.textContent = ampliado.sobre.titulo;
    /* El cuadro de espera sólo hace falta si hay transición que correr. Con la ventana en
       segundo plano `requestAnimationFrame` no se dispara, así que por esa vía la clase no
       llegaba nunca y la hoja de encima no aparecía. */
    if (document.visibilityState === 'visible') requestAnimationFrame(() => visorHoja.classList.add('visor__hoja--sobre'));
    else visorHoja.classList.add('visor__hoja--sobre');
    return true;
  }

  // Lo usa el recorrido de la hoja de ruta, que vive en otro módulo.
  visor.revelarSobre = revelarSobre;

  function ampliar(src, titulo, origen, sobre) {
    /* Si el visor YA está abierto, la hoja se cambia con un cruce y no de golpe.
     *
     * Pasa en el recorrido de la lámina 2: la flecha abre el correo y la siguiente lo
     * reemplaza por el PDF que el correo enlaza. Cambiando el `src` a secas, el corte es
     * seco y no se entiende que una cosa lleva a la otra. Con el cruce se lee como que el
     * documento sale del correo.
     *
     * Se hace en dos tiempos porque es UNA sola etiqueta `<img>`: primero se apaga la hoja
     * que está, después se cambia la fuente, y recién entonces entra la nueva. */
    const yaAbierto = !visor.hidden;
    const puedeAnimar = document.visibilityState === 'visible' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (yaAbierto && puedeAnimar) {
      const sale = visorImg.animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'scale(0.96) translateY(1.2rem)' }
        ],
        { duration: 240, easing: 'cubic-bezier(0.4, 0, 0.8, 1)', fill: 'both' }
      );
      sale.finished
        .then(() => {
          ponerHoja(src, titulo, sobre);
          const entra = visorImg.animate(
            [
              { opacity: 0, transform: 'scale(1.04) translateY(-1.2rem)' },
              { opacity: 1, transform: 'none' }
            ],
            { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' }
          );
          // Se sueltan las dos: con `fill: both` la última se queda imponiendo su fotograma
          // final para siempre, y la próxima apertura arrancaría con la hoja invisible.
          entra.finished.then(() => {
            sale.cancel();
            entra.cancel();
          });
        })
        .catch(() => ponerHoja(src, titulo, sobre));
      return;
    }

    aplicarOrigen(visor, medirOrigen(origen));
    ponerHoja(src, titulo, sobre);
    visor.hidden = false;
  }

  function cerrarAmpliado() {
    ampliado = null;
    visor.hidden = true;
  }

  btnReal.addEventListener('click', () => {
    tamanoReal = !tamanoReal;
    visorHoja.classList.toggle('visor__hoja--real', tamanoReal);
    btnReal.textContent = tamanoReal ? 'Ajustar a la pantalla' : 'Tamaño real';
  });
  visor.querySelectorAll('[data-cerrar="visor"]').forEach((b) => b.addEventListener('click', cerrarAmpliado));

  // Cualquier cosa con `data-ampliar` abre el visor. Así agregar una imagen nueva es un
  // atributo en el HTML y no una línea acá.
  document.querySelectorAll('[data-ampliar]').forEach((b) => {
    b.addEventListener('click', (e) =>
      /* `getAttribute` y no `dataset`: en `data-ampliar-2` el guion va seguido de un DÍGITO,
         y la conversión a camelCase sólo se aplica a guion + letra. O sea que la propiedad no
         es `dataset.ampliar2` sino `dataset['ampliar-2']` — leerla como `ampliar2` devolvía
         `undefined` y la segunda hoja no se cargaba nunca. */
      ampliar(b.dataset.ampliar, b.dataset.titulo || '', e.currentTarget, {
        src: b.getAttribute('data-ampliar-2') || '',
        titulo: b.getAttribute('data-titulo-2') || ''
      })
    );
  });

  /* ── índice ─────────────────────────────────────────────────────────── */

  const indiceEl = document.querySelector('.indice');
  const indiceOl = indiceEl.querySelector('ol');

  laminas.forEach((l, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span>${i + 1}</span>`;
    b.append(l.titulo);
    b.addEventListener('click', () => {
      ir(i);
      abrirIndice(false);
    });
    li.append(b);
    indiceOl.append(li);
  });

  function abrirIndice(v) {
    indiceAbierto = v;
    indiceEl.hidden = !v;
    if (v) {
      [...indiceOl.querySelectorAll('button')].forEach((b, i) => b.classList.toggle('actual', i === indice));
    }
  }

  document.querySelector('.indice__fondo').addEventListener('click', () => abrirIndice(false));
  hudIdx.addEventListener('click', () => abrirIndice(true));

  /* ── navegación ─────────────────────────────────────────────────────── */

  btnPrev.addEventListener('click', retroceder);
  btnNext.addEventListener('click', avanzar);

  document.addEventListener('keydown', (e) => {
    /* Con el visor abierto, las flechas cambiaban de lámina por detrás y al cerrarlo la
     * presentación aparecía en otro lugar. Escape cierra; todo lo demás se descarta.
     *
     * La excepción es el visor que abrió el propio RECORRIDO de una lámina (hoy: el PDF que
     * enlaza el correo, en la lámina 2). Ahí el visor no es algo que alguien abrió al
     * margen: es un paso de la lámina, así que la flecha tiene que seguir andando o el
     * recorrido queda encerrado y sólo se sale con Escape. Lo marca `data-flujo`. */
    const delFlujo = visor.dataset.flujo === 'si';
    if (ampliado && !delFlujo) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cerrarAmpliado();
      }
      return;
    }

    // Los componentes embebidos tienen inputs. Si el foco esta en uno, las flechas y la
    // barra espaciadora son del input y no del deck: sin esto, escribir en el filtro del
    // administrador cambiaba de lamina.
    const a = document.activeElement;
    const escribiendo = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.getAttribute('role') === 'combobox');

    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        if (escribiendo) return;
        e.preventDefault();
        avanzar();
        break;
      case ' ':
        if (escribiendo) return;
        e.preventDefault();
        avanzar();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        if (escribiendo) return;
        e.preventDefault();
        retroceder();
        break;
      case 'Home':
        ir(0);
        break;
      case 'End':
        ir(laminas.length - 1);
        break;
      case 'f':
      case 'F':
        if (escribiendo) return;
        void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
        break;
      case 'o':
      case 'O':
        if (escribiendo) return;
        abrirIndice(!indiceAbierto);
        break;
      case 'Escape':
        abrirIndice(false);
        break;
    }
  });

  /* ── arranque: el deep link por fragmento (#ruta, #admin, …) ────────── */

  function leerHash() {
    const i = laminas.findIndex((l) => l.id === location.hash.replace('#', ''));
    if (i >= 0) {
      indice = i;
      pintar();
    }
  }

  /* Red de seguridad al recuperar el foco.
   *
   * Si la ventana se ocultó a mitad de una animación, ésta quedó congelada y la lámina
   * puede estar a media opacidad o corrida de su sitio. Al volver se sueltan las
   * animaciones de la lámina actual: cancelarlas la devuelve a su estilo de la hoja, que es
   * el estado final que corresponde. La entrada ya no tiene nada que contar. */
  /**
   * Marca la raíz mientras la ventana no está a la vista.
   *
   * De esa marca cuelga la regla que apaga TODAS las animaciones de entrada (ver deck.css).
   * Hace falta porque no alcanza con cuidar la lámina: sus hijos tienen animaciones propias
   * —las cards del grafo, las aristas, las hojas del abanico—, con `fill: both` y retardos
   * escalonados. Congeladas antes de arrancar, se quedan en `opacity: 0` para siempre.
   */
  function marcarVisibilidad() {
    const raiz = document.documentElement;
    if (document.visibilityState === 'visible') delete raiz.dataset.sinAnimacion;
    else raiz.dataset.sinAnimacion = 'si';
  }

  marcarVisibilidad();

  document.addEventListener('visibilitychange', () => {
    marcarVisibilidad();
    if (document.visibilityState !== 'visible') return;
    /* Al volver, lo que quedó a medio camino se suelta: cancelar una animación devuelve al
       elemento su estilo de la hoja, que es el estado final que corresponde. La entrada ya
       no tiene nada que contar. Se recorre el subárbol porque las animaciones que importan
       están en los hijos, no en la lámina. */
    const actual = laminas[indice].el;
    actual.style.animation = 'none';
    actual.dataset.entrada = 'si';
    for (const anim of actual.getAnimations({ subtree: true })) anim.cancel();
  });

  window.addEventListener('hashchange', leerHash);
  pintar();
  leerHash();
})();

/* ══════════════════════════════════════════════════════════════════════════
   Los dos componentes embebidos.

   El marcado es el DOM real del app en Angular, volcado tal cual, así que se ve idéntico.
   Lo que no viaja es la lógica: no hay backend, no hay signals, no hay router. En vez de
   dejarlos como una foto muerta, acá se les devuelve el gesto que cada uno enseña —
   apretar "Buscar" y que aparezcan las cards; escribir en el filtro y que la tabla se
   recorte. Es lo mínimo para que la lámina muestre CÓMO se usa y no sólo cómo se ve.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  /* ── el popup del buscador ────────────────────────────────────────────── */

  const popup = document.querySelector('[data-popup="buscador"]');
  if (!popup) return;

  const resultados = popup.querySelector('.mock-resultados');
  const btnBuscar = [...popup.querySelectorAll('button')].find((b) => /Buscar/.test(b.textContent));

  function abrirBuscador(origen) {
    // Cada apertura arranca de cero: si quedaran los resultados de la vez anterior, el
    // gesto que la lámina promete —apretar Buscar y que aparezcan— no se podría repetir
    // delante de la audiencia.
    resultados.hidden = true;
    const r = origen instanceof HTMLElement ? origen.getBoundingClientRect() : null;
    if (r) {
      popup.style.setProperty('--ox', `${Math.round(r.left + r.width / 2 - innerWidth / 2)}px`);
      popup.style.setProperty('--oy', `${Math.round(r.top + r.height / 2 - innerHeight / 2)}px`);
      popup.style.setProperty('--oe', String(Math.min(0.55, Math.max(0.16, r.width / innerWidth))));
    }
    popup.hidden = false;
  }

  document.querySelectorAll('[data-abre-buscador]').forEach((b) => b.addEventListener('click', (e) => abrirBuscador(e.currentTarget)));
  popup.querySelectorAll('[data-cierra-popup]').forEach((b) => b.addEventListener('click', () => (popup.hidden = true)));

  // El volcado trae los <form> de verdad del componente. Sin backend detras, apretar
  // "Buscar" hacia submit: la pagina se recargaba con ?origin=SCL&destination=MIA y la
  // presentacion volvia a empezar en medio de la demo.
  popup.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));
  popup.querySelectorAll('button:not([type])').forEach((b) => (b.type = 'button'));

  if (btnBuscar) {
    btnBuscar.addEventListener('click', () => {
      resultados.hidden = false;
      // Las cards entran escalonadas. La búsqueda real tarda, y una aparición instantánea
      // se lee como que la lista ya estaba ahí en vez de como un resultado.
      resultados.querySelectorAll('.commission-card').forEach((c, i) => {
        c.style.animation = 'none';
        void c.offsetWidth;
        c.style.animation = `entrar 0.42s cubic-bezier(0.2, 0.7, 0.2, 1) ${i * 90}ms both`;
      });
      resultados.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  /* ── el filtro de la tabla del administrador ──────────────────────────── */

  const admin = document.querySelector('.marco-app');
  const filtro = admin && admin.querySelector('input[type="text"], input:not([type])');
  if (filtro) {
    const filas = [...admin.querySelectorAll('tbody tr')];
    const campo = filtro.closest('.mat-mdc-form-field');
    const etiqueta = campo && campo.querySelector('.mdc-floating-label');

    // La etiqueta flotante de Material la mueve Angular, no el CSS. Sin esto el texto que
    // se escribe queda encima de "Buscar por codigo OVER...", ilegible. Son las dos clases
    // que Material pone al enfocar: subir la etiqueta y dejar de esconder el placeholder.
    const flotar = () => {
      const activa = document.activeElement === filtro || filtro.value !== '';
      if (etiqueta) etiqueta.classList.toggle('mdc-floating-label--float-above', activa);
      if (campo) campo.classList.toggle('mat-form-field-hide-placeholder', !activa);
    };
    filtro.addEventListener('focus', flotar);
    filtro.addEventListener('blur', flotar);

    filtro.addEventListener('input', () => {
      flotar();
      const q = filtro.value.trim().toLowerCase();
      filas.forEach((f) => (f.hidden = q !== '' && !f.textContent.toLowerCase().includes(q)));
    });
  }

  /* Escape cierra el popup, y mientras está abierto el deck no navega: si no, al cerrarlo
     la presentación aparecía en otra lámina.
     La excepción es el popup que abrió el propio RECORRIDO de la hoja de ruta: ahí no es
     algo que alguien abrió al margen, es un paso de la lámina, así que la flecha tiene que
     seguir andando o el recorrido queda encerrado y sólo se sale con Escape. */
  document.addEventListener(
    'keydown',
    (e) => {
      if (popup.hidden) return;
      if (e.key === 'Escape') popup.hidden = true;
      if (popup.dataset.flujo === 'si' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) return;
      e.stopImmediatePropagation();
    },
    true
  );
})();

/* ══════════════════════════════════════════════════════════════════════════
   El antes / después de los condicionados (lámina 5).

   La lámina tiene dos estados y ningún control propio: el primero es el anillo girando con
   los catorce documentos, y la misma flecha con la que se avanza la presentación lo cierra
   sobre el formato único. Recién en el segundo avance se cambia de lámina.

   Antes esto eran dos pestañas que había que ir a apretar. El gesto importa: cerrar el
   anillo con la flecha hace que la estandarización se vea COMO un movimiento —todo eso se
   convierte en esto— en vez de como dos vistas que se alternan.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  const zona = document.querySelector('.docs3d');
  if (!zona) return;

  const seccion = zona.closest('.lamina');
  const cifra = seccion.querySelector('.cifra');
  /* Tres pasos, no dos: el anillo con los catorce originales, el formato único solo, y
     recién después el abanico con todos en ese formato. Primero se entiende QUE hay un
     formato; después, que TODAS lo comparten. Juntos, la segunda idea se pierde dentro de
     la primera. */
  const VISTAS = ['antes', 'despues', 'abanico'];
  let i = 0;

  /**
   * El titular, animado de un estado al otro con FLIP.
   *
   * Los cuatro hijos son los MISMOS nodos en los dos estados —sólo cambian de celda—, así
   * que se miden antes, se cambia la celda, se los devuelve a mano a donde estaban y se los
   * suelta. El navegador anima entre las dos posiciones y el 18 se ve partirse.
   *
   * Sin esto el cambio de `grid-area` es instantáneo: las celdas no se pueden transicionar.
   */
  function titularFlip(estado) {
    if (!cifra || cifra.dataset.estado === estado) return;
    const hijos = [...cifra.querySelectorAll('.cifra__d, .cifra__p')];
    const antes = new Map(hijos.map((el) => [el, el.getBoundingClientRect()]));
    // El 1 de abajo es una COPIA que no existe en el estado "antes", así que no tiene
    // posición previa propia: sale volando desde el 1 de arriba. Eso es lo que hace que se
    // lea como que se desprende de él en vez de aparecer de la nada.
    const copia = cifra.querySelector('.cifra__uno2');
    const original = cifra.querySelector('.cifra__uno');
    if (copia && original) antes.set(copia, antes.get(original));

    cifra.dataset.estado = estado;

    for (const el of hijos) {
      const a = antes.get(el);
      const b = el.getBoundingClientRect();
      if (!a || !b.width) continue;
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 760,
        easing: 'cubic-bezier(0.4, 0, 0.15, 1)',
        fill: 'both'
      });
    }
  }

  function mostrar(n) {
    i = Math.max(0, Math.min(VISTAS.length - 1, n));
    const vista = VISTAS[i];
    zona.dataset.vista = vista;
    // El desfile sólo tiene sentido en la primera vista: cerrado el conjunto, seguir
    // recalculando posiciones por cuadro es trabajo que no se ve.
    if (typeof deslizar === 'function') deslizar(vista === 'antes' && !quieto && !seccion.hidden);
    // El titular sólo distingue antes / después: el abanico es una profundización del
    // después, no un tercer encabezado.
    titularFlip(vista === 'antes' ? 'antes' : 'despues');
    const panel = vista === 'antes' ? 'antes' : 'despues';
    seccion.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== panel));
  }

  seccion.addEventListener('deck:avanzar', (e) => {
    if (i >= VISTAS.length - 1) return;
    e.preventDefault();
    mostrar(i + 1);
  });

  seccion.addEventListener('deck:retroceder', (e) => {
    if (i <= 0) return;
    e.preventDefault();
    mostrar(i - 1);
  });

  /* Al entrar de frente se abre en el anillo; al entrar retrocediendo, en el formato único.
     Si no, volver desde la lámina siguiente mostraría la apertura en vez del cierre, y el
     recorrido hacia atrás dejaría de ser el inverso del de ida. */
  new MutationObserver(() => {
    if (seccion.hidden) return;
    mostrar(document.documentElement.dataset.sentido === 'atras' ? VISTAS.length - 1 : 0);
  }).observe(seccion, { attributes: true, attributeFilter: ['hidden'] });

  /* ── el coverflow ──────────────────────────────────────────────────────
   *
   * Las catorce fichas se colocan por su distancia al centro. Esa distancia es un número
   * decimal que avanza con el tiempo, no un índice entero: por eso el conjunto se DESLIZA
   * en vez de saltar de una ficha a la otra.
   *
   * Se calcula por cuadro en JS y no con `@keyframes` porque cada ficha necesita una
   * posición distinta y dependiente de las demás; en CSS serían catorce animaciones
   * desfasadas a mano, imposibles de ajustar sin rehacerlas todas.
   */
  const fichas = [...zona.querySelectorAll('.doc3d')];
  const N = fichas.length;
  const SEGUNDOS_POR_FICHA = 3.2;

  /* La geometría del coverflow, en fracciones del ancho de una ficha. */
  const LADO = 0.66; // separación de la primera ficha de cada lado
  const APILADO = 0.17; // lo que se corre cada ficha siguiente: se van solapando
  const ANGULO = 58; // giro de las de los costados, hacia adentro
  const PROFUNDIDAD = 0.5; // cuánto se hunden hacia el fondo
  const VISIBLES = 5; // más allá de esto no se dibujan: son ruido y cuestan cuadros

  let corriendo = false;
  let inicio = 0;
  /** Dónde está el desfile ahora, para poder redibujarlo sin esperar el próximo cuadro. */
  let actualCentro = 0;

  /** El contenedor de las fichas. Su ancho es la unidad de toda la geometría. */
  const pista = zona.querySelector('.cover');

  function colocar(centro) {
    /* `offsetWidth` del CONTENEDOR, no `getBoundingClientRect()` de una ficha.
     *
     * Dos bugs en una línea, los dos reales:
     *
     * - `getBoundingClientRect()` devuelve la caja YA TRANSFORMADA. La ficha que se medía
     *   está rotada 58° y escalada 0.8 cuando le toca estar en un costado, así que su caja
     *   medía ~140 px en vez de los 325 de layout — y como la unidad alimenta todos los
     *   desplazamientos, el carrusel entero se encogía y se estiraba al girar. En un hard
     *   refresh la ficha arranca al frente, sin rotar, y la medida salía bien: de ahí que
     *   pareciera aleatorio y que recargando se arreglara.
     * - El `|| 300` de respaldo entraba en cuanto la lámina estaba oculta (ancho 0), y
     *   dibujaba la primera vuelta con una unidad inventada.
     *
     * `offsetWidth` es el ancho de layout: ignora los transforms de los hijos. Y sin
     * respaldo mágico: si todavía no hay layout, no se dibuja este cuadro y se espera al
     * siguiente. */
    const ancho = pista ? pista.offsetWidth : 0;
    if (!ancho) return;
    for (let n = 0; n < N; n++) {
      // Distancia al centro, dando la vuelta por el camino corto: así la ficha que sale por
      // un lado reaparece por el otro y el desfile no tiene principio ni fin.
      let o = n - centro;
      if (o > N / 2) o -= N;
      if (o < -N / 2) o += N;

      const a = Math.abs(o);
      const signo = Math.sign(o);
      const cerca = Math.min(a, 1); // 0 en el centro, 1 ya en el costado
      const lejos = Math.max(0, a - 1); // cuántas fichas más allá de la primera del lado

      const x = signo * (LADO * cerca + APILADO * Math.min(lejos, VISIBLES)) * ancho;
      const z = -PROFUNDIDAD * Math.min(a, VISIBLES) * ancho;
      const ry = -signo * ANGULO * cerca;
      const s = 1 - 0.05 * Math.min(a, VISIBLES);

      const est = fichas[n].style;
      est.setProperty('--x', `${x.toFixed(1)}px`);
      est.setProperty('--z', `${z.toFixed(1)}px`);
      est.setProperty('--ry', `${ry.toFixed(2)}deg`);
      est.setProperty('--s', s.toFixed(3));
      est.setProperty('--o', a > VISIBLES ? '0' : (1 - 0.11 * Math.min(a, VISIBLES)).toFixed(2));
      // La de más al frente tapa a las de atrás. Sin esto el navegador las apila por orden
      // del DOM y las de los costados se dibujan encima de la del centro.
      est.setProperty('--capa', String(Math.round(100 - a * 10)));
      // El rótulo sólo en la del centro, y se desvanece a medida que se va.
      est.setProperty('--rotulo', a < 0.6 ? (1 - a / 0.6).toFixed(2) : '0');
    }
  }

  function cuadro(t) {
    if (!corriendo) return;
    if (!inicio) inicio = t;
    actualCentro = (((t - inicio) / 1000 / SEGUNDOS_POR_FICHA) % N + N) % N;
    colocar(actualCentro);
    requestAnimationFrame(cuadro);
  }

  function deslizar(activo) {
    if (activo === corriendo) return;
    corriendo = activo;
    if (activo) {
      inicio = 0;
      requestAnimationFrame(cuadro);
    }
  }

  // Con movimiento reducido el desfile no corre: se deja la primera ficha al frente y las
  // demás a los lados, que es la misma imagen sin nada moviéndose.
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  colocar(0);

  /* Al cambiar el tamaño de la ventana cambia el ancho de la ficha —lo fija el alto
     disponible— así que la geometría se recalcula. Con el desfile corriendo se corregiría
     solo en el cuadro siguiente, pero con movimiento reducido no hay cuadro siguiente. */
  addEventListener('resize', () => colocar(actualCentro));

  mostrar(0);
  if (!quieto) deslizar(true);
})();

/* ══════════════════════════════════════════════════════════════════════════
   Lámina 2 — los dos pasos.

   La lámina abre con el texto. La flecha abre el correo en grande, la siguiente lo cambia
   por el PDF que el correo enlaza, y la tercera cierra y pasa de lámina.

   Los dos pasos NO reimplementan el visor: aprietan los mismos botones `data-ampliar` que
   lo abren a mano, así el gesto de la flecha y el del mouse recorren el mismo camino. Y el
   segundo paso no cierra antes de abrir — `ampliar()` cambia la imagen y el título en el
   visor que ya está abierto, así que el PDF reemplaza al correo sin parpadeo.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  const seccion = document.querySelector('.lamina[data-id="contexto"]');
  if (!seccion) return;

  const visor = document.querySelector('.visor');
  const pasos = [seccion.querySelector('[data-paso-correo]'), seccion.querySelector('[data-paso-pdf]')].filter(Boolean);
  if (!visor || !pasos.length) return;

  /** 0 = sólo el texto. 1 = el correo en grande. 2 = el PDF. */
  let paso = 0;

  function abrir(n) {
    pasos[n - 1].click();
    // Marca de "este visor lo abrió el recorrido": el deck deja pasar las flechas en vez de
    // quedarse encerrado esperando un Escape.
    visor.dataset.flujo = 'si';
  }

  function cerrar() {
    if (visor.hidden) return;
    delete visor.dataset.flujo;
    visor.querySelector('[data-cerrar="visor"]').click();
  }

  function mostrar(n) {
    paso = Math.max(0, Math.min(pasos.length, n));
    if (paso === 0) cerrar();
    else abrir(paso);
  }

  seccion.addEventListener('deck:avanzar', (e) => {
    if (paso >= pasos.length) {
      // Agotados los pasos, la flecha cambia de lámina — pero primero se cierra el visor, o
      // quedaría flotando sobre la lámina siguiente.
      cerrar();
      paso = 0;
      return;
    }
    e.preventDefault();
    mostrar(paso + 1);
  });

  seccion.addEventListener('deck:retroceder', (e) => {
    if (paso <= 0) return;
    e.preventDefault();
    mostrar(paso - 1);
  });

  /* Se sale de la lámina: el visor no puede quedar abierto encima de la siguiente, y el
     recorrido se rearma para la próxima visita. */
  new MutationObserver(() => {
    if (!seccion.hidden) return;
    cerrar();
    paso = 0;
  }).observe(seccion, { attributes: true, attributeFilter: ['hidden'] });
})();

/* ══════════════════════════════════════════════════════════════════════════
   Lámina 7 — el recorrido de la hoja de ruta.

   La lámina abre con el grafo completo. Cada avance se detiene en una card: primero la
   ACERCA —crece y las otras se atenúan— y recién después abre lo que esa card tiene detrás,
   sea una imagen o el buscador real. Agotadas las cuatro, la flecha cambia de lámina.

   El acercamiento no es adorno: son cuatro cards repartidas por el lienzo y sin un gesto
   que diga cuál se está narrando, la audiencia no sabe dónde mirar antes de que se abra
   algo a pantalla completa. Y al alejarse, la card vuelve a su sitio: el grafo se recompone
   y se entiende que se sigue en el mismo mapa.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  const seccion = document.querySelector('.lamina[data-id="ruta"]');
  if (!seccion) return;

  const grafo = seccion.querySelector('.grafo');
  const cards = [...seccion.querySelectorAll('.grafo__nodo')];
  const visor = document.querySelector('.visor');
  const popup = document.querySelector('[data-popup="buscador"]');
  if (!grafo || !cards.length) return;

  /* Las paradas del recorrido.
   *
   * No es una por card: la card que declara una segunda imagen (`data-ampliar-2`) se lleva
   * DOS paradas — una para abrir la primera hoja y otra para revelar la que se solapa
   * encima. Se arma acá, leyendo el marcado, así que sumar una segunda imagen a otra card
   * es un atributo en el HTML y nada más. */
  const paradas = [];
  cards.forEach((card, i) => {
    paradas.push({ card: i, sobre: false });
    if (card.querySelector('[data-ampliar-2]')) paradas.push({ card: i, sobre: true });
  });

  /** 0 = el grafo completo. 1..n = detenido en la parada n-1. */
  let paso = 0;
  let pendiente = null;

  const puedeAnimar = () =>
    document.visibilityState === 'visible' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

  function cerrarTodo() {
    if (visor && !visor.hidden) {
      delete visor.dataset.flujo;
      visor.querySelector('[data-cerrar="visor"]').click();
    }
    if (popup && !popup.hidden) {
      delete popup.dataset.flujo;
      popup.hidden = true;
    }
  }

  function enfocar(n) {
    // `n` es 1..cards.length, o 0 para ninguna.
    grafo.dataset.enfocada = n ? String(n - 1) : '';
    cards.forEach((c, i) => c.classList.toggle('grafo__nodo--enfocada', n > 0 && i === n - 1));
  }

  function mostrar(n) {
    clearTimeout(pendiente);
    const previo = paso;
    paso = Math.max(0, Math.min(paradas.length, n));
    if (paso === 0) {
      cerrarTodo();
      enfocar(0);
      return;
    }

    const parada = paradas[paso - 1];
    const anterior = previo > 0 ? paradas[previo - 1] : null;

    /* Avanzar DENTRO de la misma card —de la primera hoja a la que se solapa— no reabre
       nada: el visor ya está en pantalla con la hoja de encima preparada, y sólo hay que
       revelarla. Cerrar y volver a abrir haría parpadear la pantalla completa a mitad de un
       gesto que quiere leerse como continuo. */
    if (parada.sobre && anterior && anterior.card === parada.card && visor.revelarSobre && visor.revelarSobre()) return;

    cerrarTodo();
    enfocar(parada.card + 1);

    /* Se abre DESPUÉS del acercamiento, no a la vez.
     * Juntos, lo que crece queda tapado por lo que se abre encima y el gesto se pierde: no
     * se llega a ver cuál card se está mostrando. La espera es la del acercamiento. */
    const abrir = () => {
      const accion = cards[parada.card].querySelector('.hito__accion');
      if (!accion) return;
      accion.click();
      // Marca de "esto lo abrió el recorrido": el deck deja pasar las flechas en vez de
      // quedarse encerrado esperando un Escape.
      if (visor && !visor.hidden) visor.dataset.flujo = 'si';
      if (popup && !popup.hidden) popup.dataset.flujo = 'si';
      // Se entró directo a la parada de la hoja de encima (retrocediendo, por ejemplo): se
      // revela sin esperar otra flecha.
      if (parada.sobre && visor.revelarSobre) visor.revelarSobre();
    };
    if (puedeAnimar()) pendiente = setTimeout(abrir, 620);
    else abrir();
  }

  seccion.addEventListener('deck:avanzar', (e) => {
    if (paso >= paradas.length) {
      // Agotadas las cards, la flecha cambia de lámina — pero primero se cierra lo que haya
      // abierto y el grafo vuelve a su estado completo.
      mostrar(0);
      return;
    }
    e.preventDefault();
    mostrar(paso + 1);
  });

  seccion.addEventListener('deck:retroceder', (e) => {
    if (paso <= 0) return;
    e.preventDefault();
    mostrar(paso - 1);
  });

  /* Se sale de la lámina: nada puede quedar abierto encima de la siguiente, y el recorrido
     se rearma para la próxima visita. */
  new MutationObserver(() => {
    if (!seccion.hidden) return;
    clearTimeout(pendiente);
    cerrarTodo();
    paso = 0;
    enfocar(0);
  }).observe(seccion, { attributes: true, attributeFilter: ['hidden'] });
})();

/* ══════════════════════════════════════════════════════════════════════════
   El lápiz del administrador abre el editor (lámina del administrador).

   El administrador embebido es el DOM del componente real, así que sus botones existen pero
   no hacen nada — no hay router ni backend detrás. El lápiz es el único que importa para la
   demo: es el gesto que cuenta la lámina, "de la lista al editor", así que se le devuelve.

   Lo que abre es también el componente real, volcado con un OVER ya cargado: los campos
   vienen rellenos y las seis bandas están en su tabla. El punto de la lámina es justamente
   ése — editar un OVER no es llenar un formulario en blanco, es revisar lo que la IA dejó
   puesto.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  const popup = document.querySelector('[data-popup="editor"]');
  const admin = document.querySelector('.marco-app');
  if (!popup || !admin) return;

  function abrir(origen) {
    /* El popup crece desde el lápiz que se apretó, igual que el visor: sin eso el editor
       aparece de golpe y no se entiende de qué fila salió. */
    if (origen instanceof HTMLElement) {
      const r = origen.getBoundingClientRect();
      popup.style.setProperty('--ox', `${Math.round(r.left + r.width / 2 - innerWidth / 2)}px`);
      popup.style.setProperty('--oy', `${Math.round(r.top + r.height / 2 - innerHeight / 2)}px`);
      popup.style.setProperty('--oe', String(Math.min(0.55, Math.max(0.16, r.width / innerWidth))));
    }
    popup.hidden = false;
  }

  const cerrar = () => (popup.hidden = true);

  /* Delegado en el contenedor y no botón por botón: la tabla se filtra en vivo, así que las
     filas se ocultan y se muestran; enganchando cada lápiz al cargar, una fila que vuelve
     de un filtro seguiría respondiendo, pero es más frágil de lo necesario. */
  admin.addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn || btn.classList.contains('json') || btn.classList.contains('delete')) return;
    e.preventDefault();
    abrir(btn);
  });

  popup.querySelectorAll('[data-cierra-editor]').forEach((b) => b.addEventListener('click', cerrar));

  /* El editor volcado trae sus propios `<form>`: sin backend, un submit recargaría la página
     y la presentación volvería a empezar en medio de la demo. */
  popup.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));
  popup.querySelectorAll('button:not([type])').forEach((b) => (b.type = 'button'));

  /* Escape cierra, y mientras está abierto el deck no navega: al cerrarlo la presentación
     aparecería en otra lámina. */
  document.addEventListener(
    'keydown',
    (e) => {
      if (popup.hidden) return;
      if (e.key === 'Escape') cerrar();
      e.stopImmediatePropagation();
    },
    true
  );
})();
