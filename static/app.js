const $ = (id) => document.getElementById(id);

function el(etiqueta, props = {}, ...hijos) {
  const nodo = Object.assign(document.createElement(etiqueta), props);
  nodo.append(...hijos);
  return nodo;
}

function reiniciarAnimacion(nodo, clase) {
  nodo.classList.remove(clase);
  void nodo.offsetWidth;
  nodo.classList.add(clase);
}

function mostrarEstado(id, texto, tipo = "") {
  const nodo = $(id);
  const cambioTipo = nodo.dataset.tipo !== tipo;
  nodo.textContent = texto;
  nodo.dataset.tipo = tipo;
}

function contar(nodo, hasta, duracion = 900) {
  nodo.textContent = hasta;
  const inicio = performance.now();
  const paso = (ahora) => {
    const t = Math.min((ahora - inicio) / duracion, 1);
    nodo.textContent = Math.round(hasta * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

// ---------- Tema ----------

function aplicarTema(tema) {
  // Halloween quedó fuera del rediseño minimalista: quien lo tenía pasa a oscuro
  if (tema !== "claro" && tema !== "oscuro") tema = "oscuro";
  document.documentElement.dataset.tema = tema;
  localStorage.setItem("tema", tema);
  for (const boton of document.querySelectorAll(".tema-btn")) {
    boton.setAttribute("aria-pressed", String(boton.dataset.tema === tema));
  }
}

for (const boton of document.querySelectorAll(".tema-btn")) boton.onclick = () => aplicarTema(boton.dataset.tema);
aplicarTema(document.documentElement.dataset.tema);

// ---------- Pestañas ----------

const tabs = document.querySelectorAll(".tab");

function moverIndicador(tab, animar = true) {
  const indicador = $("indicador");
  if (!animar) indicador.style.transition = "none";
  indicador.style.width = `${tab.offsetWidth}px`;
  indicador.style.transform = `translateX(${tab.offsetLeft}px)`;
  if (!animar) {
    void indicador.offsetWidth;
    indicador.style.transition = "";
  }
}

function activarTab(panel, animar = true) {
  for (const tab of tabs) {
    const activa = tab.dataset.panel === panel;
    tab.setAttribute("aria-selected", activa);
    $(tab.dataset.panel).hidden = !activa;
    if (activa) moverIndicador(tab, animar);
  }
  localStorage.setItem("tab", panel);
}

for (const tab of tabs) tab.onclick = () => activarTab(tab.dataset.panel);
activarTab(["panel-docs", "panel-csv", "panel-config"].includes(localStorage.getItem("tab")) ? localStorage.getItem("tab") : "panel-texto", false);
document.fonts.ready.then(() => moverIndicador(document.querySelector('.tab[aria-selected="true"]'), false));

// ---------- Reglas ----------

let reglas = [];

function rellenarSelect(select, primera, renombre) {
  const valor = renombre && select.value === renombre.de ? renombre.a : select.value;
  select.replaceChildren(...(primera ? [new Option(primera, "")] : []), ...reglas.map((r) => new Option(r, r)));
  if (reglas.includes(valor)) select.value = valor;
}

async function cargarReglas(renombre) {
  reglas = await api("/reglas");
  rellenarSelect($("regla"), null, renombre);
  rellenarSelect($("regla-general"), null, renombre);
  if (tabla) for (const select of tabla.selects) rellenarSelect(select, "Regla general", renombre);
  pintarListaReglas();
}

async function pedirFormato(texto, regla) {
  const r = await fetch("/formatear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texto, regla }),
  });
  const data = await r.json();
  if (!r.ok) {
    const error = new Error(data.detail);
    error.status = r.status;
    throw error;
  }
  return data.html;
}

// ---------- Texto ----------

$("btn").onclick = async () => {
  const tarjeta = $("panel-texto").querySelector(".tarjeta");
  $("btn").disabled = true;
  tarjeta.classList.add("activa");
  mostrarEstado("estado", "Formateando...", "trabajando");
  try {
    const html = await pedirFormato($("entrada").value, $("regla").value);
    $("salida").value = html;
    $("vista").innerHTML = html;
    mostrarEstado("estado", "Listo", "ok");
  } catch (e) {
    mostrarEstado("estado", e.message, "error");
  } finally {
    $("btn").disabled = false;
    tarjeta.classList.remove("activa");
  }
};

$("entrada").onkeydown = (e) => {
  if (e.key === "Enter" && e.ctrlKey && !$("btn").disabled) $("btn").click();
};

$("copiar").onclick = async () => {
  if (!$("salida").value) return mostrarEstado("estado", "Todavía no hay HTML para copiar", "error");
  await navigator.clipboard.writeText($("salida").value);
  mostrarEstado("estado", "Copiado al portapapeles", "ok");
};

// ---------- CSV ----------

// tabla.celdas[fila][columna] = { original, html, regla, estado, error, td, columna }
let tabla = null;
let ocupado = false;
let cancelar = false;

function tonoRegla(regla) {
  let h = 0;
  for (const ch of regla) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// ---------- Código HTML con colores y sangría ----------
// Solo cambia cómo se ve: lo que se copia, se guarda y se exporta sigue siendo el HTML tal cual.
// Se trabaja sobre el texto (no con el DOM) para no "arreglar" en pantalla un HTML que en realidad está mal.

const BLOQUES_HTML = new Set("address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody td tfoot th thead tr ul".split(" "));
const VACIAS_HTML = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
const TOKEN_HTML = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</g;
const ATRIBUTO_HTML = /([^\s=/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

const pieza = (clase, texto) => `<span class="${clase}">${escaparHtml(texto)}</span>`;

function pintarEtiquetaHtml(token, nombre, atributos) {
  const autocierre = /\/\s*>$/.test(token);
  let html = pieza("h-signo", token.startsWith("</") ? "</" : "<") + pieza("h-etiqueta", nombre);
  for (const [, atributo, valor] of atributos.replace(/\/\s*$/, "").matchAll(ATRIBUTO_HTML)) {
    html += " " + pieza("h-atributo", atributo);
    if (valor != null) html += pieza("h-signo", "=") + pieza("h-valor", valor);
  }
  return html + pieza("h-signo", autocierre ? " />" : ">");
}

// Una línea por cada bloque (<p>, <li>, <h2>...); lo que va dentro de un bloque queda en su misma línea
function lineasHtml(html) {
  const lineas = [];
  const conBloquesAdentro = [];
  let actual = null;
  let nivel = 0;
  let saltoPendiente = false;
  const abrirLinea = () => {
    if (actual) actual.html = actual.html.replace(/ $/, "");
    actual = { nivel, html: "" };
    lineas.push(actual);
    saltoPendiente = false;
  };
  const agregar = (html) => {
    if (!actual || saltoPendiente) abrirLinea();
    actual.html += html;
  };

  for (const [token, nombre, atributos] of html.matchAll(TOKEN_HTML)) {
    if (token.startsWith("<!--")) {
      abrirLinea();
      actual.html = pieza("h-comentario", token.replace(/\s+/g, " "));
      saltoPendiente = true;
    } else if (!nombre) {
      let texto = token.replace(/\s+/g, " ");
      if (!actual || saltoPendiente || !actual.html) texto = texto.trimStart();
      if (texto) agregar(escaparHtml(texto));
    } else if (!BLOQUES_HTML.has(nombre.toLowerCase())) {
      agregar(pintarEtiquetaHtml(token, nombre, atributos));
    } else if (token.startsWith("</")) {
      nivel = Math.max(0, nivel - 1);
      if (conBloquesAdentro.pop()) abrirLinea();
      else if (actual) actual.html = actual.html.replace(/ $/, "");
      agregar(pintarEtiquetaHtml(token, nombre, atributos));
      saltoPendiente = true;
    } else {
      if (conBloquesAdentro.length) conBloquesAdentro[conBloquesAdentro.length - 1] = true;
      abrirLinea();
      actual.html = pintarEtiquetaHtml(token, nombre, atributos);
      if (VACIAS_HTML.has(nombre.toLowerCase()) || /\/\s*>$/.test(token)) {
        saltoPendiente = true;
      } else {
        nivel++;
        conBloquesAdentro.push(false);
      }
    }
  }
  return lineas;
}

// Para el editor: colorea sin mover ni un espacio, porque tiene que coincidir carácter por carácter con lo que se escribe
function colorearHtmlExacto(texto) {
  let html = "";
  for (const [token, nombre] of texto.matchAll(TOKEN_HTML)) {
    if (token.startsWith("<!--")) html += pieza("h-comentario", token);
    else if (!nombre) html += escaparHtml(token);
    else html += colorearEtiquetaExacta(token);
  }
  return html;
}

// Una caja por línea para poder numerarlas; una etiqueta partida en dos líneas queda sin colorear
function colorearHtmlConNumeros(texto) {
  return texto.split("\n").map((linea) => `<span class="linea">${colorearHtmlExacto(linea) || " "}</span>`).join("");
}

function colorearEtiquetaExacta(token) {
  const [, apertura, nombre, resto, cierre] = token.match(/^(<\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(\/?>)$/);
  let despuesDeIgual = false;
  const atributos = resto.replace(/("[^"]*"|'[^']*')|(=)|(\s+)|([^\s="']+)/g, (_, valor, igual, espacio, palabra) => {
    if (espacio) return espacio;
    if (igual) {
      despuesDeIgual = true;
      return pieza("h-signo", igual);
    }
    const clase = valor || despuesDeIgual ? "h-valor" : "h-atributo";
    despuesDeIgual = false;
    return pieza(clase, valor ?? palabra);
  });
  return pieza("h-signo", apertura) + pieza("h-etiqueta", nombre) + atributos + pieza("h-signo", cierre);
}

function resaltarHtml(html) {
  return lineasHtml(html).map((l) => "  ".repeat(l.nivel) + l.html).join("\n");
}

// El mismo orden que la vista, pero como texto para el editor (el textContent del coloreado es el HTML original)
const plantillaTexto = document.createElement("template");
function ordenarHtml(html) {
  return lineasHtml(html).map((l) => {
    plantillaTexto.innerHTML = l.html;
    return "  ".repeat(l.nivel) + plantillaTexto.content.textContent;
  }).join("\n");
}

function resaltarHtmlConNumeros(html) {
  return lineasHtml(html).map((l) => `<span class="linea" style="--nivel: ${l.nivel}">${l.html}</span>`).join("");
}

// ---------- Fidelidad: palabras que el modelo agregó o quitó respecto del original ----------

const PALABRA = /[\p{L}\p{N}]+/gu;
// Viñetas y numeración que el formateo convierte en <ul>/<ol>: no cuentan como texto quitado
const MARCA_LISTA = /^[ \t]*(?:[-–•*·]|\d{1,2}[.)])[ \t]+/gm;
const MAX_COMPARACION = 4_000_000;
const ENTIDAD_HTML = /&(?:#\d+|#x[0-9a-f]+|\w+);/gi;
// Palabras iguales que se muestran alrededor de cada cambio, como las líneas de contexto de git
const CONTEXTO_CAMBIO = 6;
const fidelidades = new WeakMap();

// Los bloques separan palabras ("</h2><p>" no debe pegar dos palabras); las etiquetas en línea no
function sinEtiquetas(html) {
  return html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<\/?([a-zA-Z][\w:-]*)[^>]*>/g,
    (_, nombre) => (BLOQUES_HTML.has(nombre.toLowerCase()) || nombre.toLowerCase() === "br" ? " " : ""));
}

function decodificarHtml(texto) {
  if (!texto.includes("&")) return texto;
  plantillaTexto.innerHTML = texto;
  return plantillaTexto.content.textContent;
}

function palabra(texto, inicio) {
  return { texto, clave: texto.toLocaleLowerCase("es"), inicio, fin: inicio + texto.length };
}

// `inicio`/`fin` son posiciones en el texto; `separador` es lo que sigue a la palabra, solo para mostrarla legible
function palabrasTexto(texto) {
  const lista = [...texto.matchAll(PALABRA)].map((m) => palabra(m[0], m.index));
  lista.forEach((p, i) => (p.separador = texto.slice(p.fin, lista[i + 1]?.inicio ?? texto.length).replace(/\s+/g, " ")));
  return lista;
}

// Igual que palabrasTexto, pero con posiciones dentro del código HTML (sin mirar etiquetas ni entidades)
function palabrasHtml(html) {
  const lista = [];
  for (const tramo of html.matchAll(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)) {
    if (tramo[0].startsWith("<")) continue;
    const tapado = tramo[0].replace(ENTIDAD_HTML, (e) => " ".repeat(e.length));
    for (const m of tapado.matchAll(PALABRA)) lista.push(palabra(m[0], tramo.index + m.index));
  }
  lista.forEach((p, i) => {
    const entre = html.slice(p.fin, lista[i + 1]?.inicio ?? html.length);
    p.separador = decodificarHtml(sinEtiquetas(entre)).replace(/\s+/g, " ");
  });
  return lista;
}

// Diferencia por palabras (subsecuencia común más larga):
// [{ tipo: "igual" | "agregada" | "quitada", texto, separador, i (en el original), j (en el HTML) }]
function diferenciaPalabras(antes, despues) {
  const n = antes.length, m = despues.length;
  if (n * m > MAX_COMPARACION) return null;
  const largo = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      largo[i][j] = antes[i].clave === despues[j].clave ? largo[i + 1][j + 1] + 1 : Math.max(largo[i + 1][j], largo[i][j + 1]);
    }
  }
  const partes = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && antes[i].clave === despues[j].clave) {
      partes.push({ ...despues[j], tipo: "igual", i: i++, j: j++ });
    } else if (j < m && (i === n || largo[i][j + 1] >= largo[i + 1][j])) {
      partes.push({ ...despues[j], tipo: "agregada", i, j: j++ });
    } else {
      partes.push({ ...antes[i], tipo: "quitada", i: i++, j });
    }
  }
  return partes;
}

// Agrupa las palabras distintas seguidas en cambios, cada uno con su contexto.
// La clave identifica el cambio aunque se edite otra parte del HTML: así se recuerda si se aceptó.
function agruparCambios(partes) {
  const cambios = [];
  for (let k = 0; k < partes.length; k++) {
    if (partes[k].tipo === "igual") continue;
    const desde = k;
    while (k < partes.length && partes[k].tipo !== "igual") k++;
    const tramo = partes.slice(desde, k);
    let inicioContexto = desde;
    while (inicioContexto > 0 && desde - inicioContexto < CONTEXTO_CAMBIO && partes[inicioContexto - 1].tipo === "igual") inicioContexto--;
    let finContexto = k;
    while (finContexto < partes.length && finContexto - k < CONTEXTO_CAMBIO && partes[finContexto].tipo === "igual") finContexto++;
    const quitadas = tramo.filter((p) => p.tipo === "quitada");
    const agregadas = tramo.filter((p) => p.tipo === "agregada");
    const previa = partes[desde - 1] ?? null;
    const siguiente = partes[k] ?? null;
    cambios.push({
      clave: [quitadas, agregadas, [previa ?? {}], [siguiente ?? {}]].map((l) => l.map((p) => p.clave ?? "").join(" ")).join("|"),
      quitadas, agregadas, previa, siguiente,
      antes: partes.slice(inicioContexto, desde),
      despues: partes.slice(k, finContexto),
      cortadoAntes: inicioContexto > 0,
      cortadoDespues: finContexto < partes.length,
    });
    k--;
  }
  return cambios;
}

// null si la celda no está formateada o el texto es demasiado largo para comparar
function fidelidad(celda) {
  if (celda.html == null) return null;
  const guardada = fidelidades.get(celda);
  if (guardada && guardada.html === celda.html && guardada.original === celda.original) return guardada.resultado;
  const origen = celda.original.replace(MARCA_LISTA, "");
  const antes = palabrasTexto(origen);
  const partes = diferenciaPalabras(antes, palabrasHtml(celda.html));
  const resultado = partes && { origen, antes, partes, cambios: agruparCambios(partes) };
  fidelidades.set(celda, { html: celda.html, original: celda.original, resultado });
  return resultado;
}

function cambioAceptado(celda, cambio) {
  return celda.aceptados.includes(cambio.clave);
}

function cambiosPendientes(celda) {
  return fidelidad(celda)?.cambios.filter((c) => !cambioAceptado(celda, c)) ?? [];
}

// La celda tiene diferencias que nadie revisó todavía
function paraRevisar(celda) {
  return cambiosPendientes(celda).length > 0;
}

function resumenPalabras(lista) {
  const unicas = [...new Set(lista)];
  const muestra = unicas.slice(0, 8).map((p) => `«${p}»`).join(", ");
  return unicas.length > 8 ? `${muestra} y ${unicas.length - 8} más` : muestra;
}

function etiquetaFidelidad(celda) {
  const pendientes = cambiosPendientes(celda);
  if (!pendientes.length) return null;
  const agregadas = pendientes.flatMap((c) => c.agregadas.map((p) => p.texto));
  const quitadas = pendientes.flatMap((c) => c.quitadas.map((p) => p.texto));
  const titulo = [
    agregadas.length && `Agregó: ${resumenPalabras(agregadas)}`,
    quitadas.length && `Quitó: ${resumenPalabras(quitadas)}`,
  ].filter(Boolean).join("\n");
  const texto = [agregadas.length && `+${agregadas.length}`, quitadas.length && `−${quitadas.length}`].filter(Boolean).join(" ");
  return el("span", {
    className: "etiqueta aviso",
    textContent: `⚠ ${texto}`,
    title: `El texto no coincide con el original. Revisalo en la pestaña «Cambios».\n${titulo}`,
  });
}

// ---------- Rechazar un cambio: devolver al HTML el texto del original ----------

const BLOQUE_VACIO = /<(strong|b|em|i|u|span|h[1-6]|p|li|ul|ol)\b[^>]*>\s*<\/\1>\s*/gi;
const CIERRE_BLOQUE_HTML = /<\/(p|li|h[1-6]|ul|ol|blockquote|div|table)>/gi;

function sinBloquesVacios(html) {
  let antes;
  do {
    antes = html;
    html = html.replace(BLOQUE_VACIO, "");
  } while (html !== antes);
  return html;
}

// Rango a borrar para quitar un texto agregado: si es un rótulo al comienzo de un bloque
// («Requisito N°1: …») se lleva también los dos puntos; si no, el espacio que lo separa de la palabra anterior
function rangoAQuitar(html, desde, hasta) {
  const anterior = html.slice(0, desde).trimEnd();
  if (!anterior || anterior.endsWith(">")) {
    return [desde, hasta + html.slice(hasta).match(/^[^\S\n]*[:;,.]?[^\S\n]*/)[0].length];
  }
  while (desde > 0 && /[^\S\n]/.test(html[desde - 1])) desde--;
  return [desde, hasta];
}

// Lo quitado empezaba en otra línea del original: va como bloque propio después del bloque anterior
function insertarBloques(html, lineas, posicion) {
  CIERRE_BLOQUE_HTML.lastIndex = posicion;
  const cierre = posicion > 0 ? CIERRE_BLOQUE_HTML.exec(html) : null;
  const enLista = cierre?.[1].toLowerCase() === "li";
  const apertura = enLista ? "<li>" : (html.match(/<p\b[^>]*>/i)?.[0] ?? "<p>");
  const bloques = lineas.map((l) => `${apertura}${escaparHtml(l)}</${enLista ? "li" : "p"}>`).join("\n");
  const donde = cierre ? cierre.index + cierre[0].length : 0;
  return cierre ? `${html.slice(0, donde)}\n${bloques}${html.slice(donde)}` : `${bloques}\n${html}`;
}

function rechazarCambio(celda, cambio) {
  const { origen, antes } = fidelidad(celda);
  const { quitadas, agregadas, previa, siguiente } = cambio;
  const html = celda.html;
  const textoOriginal = quitadas.length ? origen.slice(quitadas[0].inicio, quitadas.at(-1).fin) : "";
  const enLinea = textoOriginal.replace(/\s+/g, " ");

  if (agregadas.length) {
    // Tramos de palabras agregadas sin etiquetas en medio (un título inventado y la palabra siguiente son dos)
    const tramos = [[agregadas[0]]];
    for (const p of agregadas.slice(1)) {
      const ultimo = tramos.at(-1);
      if (html.slice(ultimo.at(-1).fin, p.inicio).includes("<")) tramos.push([p]);
      else ultimo.push(p);
    }
    // El texto original va en el tramo pegado al texto que siguió igual; los demás tramos se borran
    const destino = enLinea ? (siguiente ? tramos.length - 1 : 0) : -1;
    let nuevo = html;
    for (let t = tramos.length - 1; t >= 0; t--) {
      let desde = tramos[t][0].inicio, hasta = tramos[t].at(-1).fin;
      if (t !== destino) [desde, hasta] = rangoAQuitar(nuevo, desde, hasta);
      nuevo = nuevo.slice(0, desde) + (t === destino ? escaparHtml(enLinea) : "") + nuevo.slice(hasta);
    }
    return sinBloquesVacios(nuevo);
  }

  // Solo se borró texto: vuelve con los signos que lo seguían («Específicas:», «… importante.»)
  const finQuitado = quitadas.at(-1).fin;
  const conSignos = origen.slice(quitadas[0].inicio, finQuitado + origen.slice(finQuitado).match(/^[^\s\p{L}\p{N}]*/u)[0].length);
  const separadorPrevio = previa ? origen.slice(antes[previa.i].fin, quitadas[0].inicio) : "\n";
  if (separadorPrevio.includes("\n")) {
    const lineas = conSignos.split("\n").map((l) => l.trim()).filter(Boolean);
    return insertarBloques(html, lineas, previa ? previa.fin : 0);
  }
  if (siguiente && !html.slice(previa.fin, siguiente.inicio).includes("<")) {
    const tramo = origen.slice(antes[previa.i].fin, antes[siguiente.i].inicio).replace(/\s+/g, " ");
    return html.slice(0, previa.fin) + escaparHtml(tramo) + html.slice(siguiente.inicio);
  }
  // La primera línea va pegada a la palabra anterior; las siguientes, como bloques propios
  const [primera, ...resto] = conSignos.split("\n");
  const lineas = resto.map((l) => l.trim()).filter(Boolean);
  let donde = previa.fin, agregado;
  if (separadorPrevio.trim()) {
    // "oración." + " Segunda oración importante."
    donde += html.slice(previa.fin).match(/^[^\s<]*/)[0].length;
    agregado = primera;
  } else {
    // "puntaje" + " PAES" + "." que ya estaba en el HTML
    agregado = primera.replace(/[^\p{L}\p{N}]+$/u, "");
  }
  agregado = ` ${escaparHtml(agregado.replace(/\s+/g, " ").trim())}`;
  const nuevo = html.slice(0, donde) + agregado + html.slice(donde);
  return lineas.length ? insertarBloques(nuevo, lineas, donde + agregado.length) : nuevo;
}

function rechazarCambios(celda, cambios) {
  const claves = new Set(cambios.map((c) => c.clave));
  const fallidos = new Set();
  // Se recalcula la diferencia después de cada uno: las posiciones en el HTML cambian. De atrás hacia adelante.
  for (let vueltas = 0; vueltas < 200; vueltas++) {
    const cambio = cambiosPendientes(celda).findLast((c) => claves.has(c.clave) && !fallidos.has(c.clave));
    if (!cambio) break;
    const html = rechazarCambio(celda, cambio);
    if (html === celda.html) fallidos.add(cambio.clave);
    else celda.html = html;
  }
  pintarCelda(celda);
  if (fallidos.size) mostrarEstado("estado-csv", "Algún cambio no se pudo deshacer solo: corregilo con «Editar HTML»", "aviso");
}

function aceptarCambios(celda, cambios) {
  celda.aceptados = [...new Set([...celda.aceptados, ...cambios.map((c) => c.clave)])];
  pintarCelda(celda);
}

function botonDiff(texto, clase, titulo, accion) {
  const boton = el("button", { type: "button", className: `diff-boton ${clase}`, textContent: texto, title: titulo, disabled: ocupado });
  boton.onclick = accion;
  return boton;
}

function lineaDiff(cambio, tipo) {
  const quitada = tipo === "quitada";
  const palabrasCambio = quitada ? cambio.quitadas : cambio.agregadas;
  const texto = el("span", { className: "diff-texto" });
  if (cambio.cortadoAntes) texto.append("… ");
  for (const p of cambio.antes) texto.append(p.texto, p.separador || " ");
  palabrasCambio.forEach((p, k) => {
    texto.append(el(quitada ? "del" : "ins", { textContent: p.texto }));
    if (k < palabrasCambio.length - 1 || cambio.despues.length) texto.append(p.separador || " ");
  });
  for (const p of cambio.despues) texto.append(p.texto, p.separador || " ");
  if (cambio.cortadoDespues) texto.append("…");
  return el("div", { className: `diff-linea ${tipo}` },
    el("span", { className: "diff-signo", textContent: quitada ? "−" : "+", ariaHidden: "true" }), texto);
}

function bloqueCambio(celda, cambio, n, total) {
  const aceptado = cambioAceptado(celda, cambio);
  const q = cambio.quitadas.length, a = cambio.agregadas.length;
  const cabecera = el("div", { className: "diff-cabecera" },
    el("code", { className: "diff-posicion", textContent: `@@ ${n + 1} de ${total} @@` }),
    el("span", { className: "diff-resumen" },
      q ? el("span", { className: "menos", textContent: `−${q}` }) : "",
      a ? el("span", { className: "mas", textContent: `+${a}` }) : ""),
    el("span", { className: "diff-tipo", textContent: !q ? "agregó" : !a ? "quitó" : "cambió" }),
    el("span", { className: "espacio" }));
  if (aceptado) {
    cabecera.append(
      el("span", { className: "diff-estado", textContent: "✓ Aceptado" }),
      botonDiff("Deshacer", "deshacer", "Volver a dejar este cambio pendiente", () => {
        celda.aceptados = celda.aceptados.filter((c) => c !== cambio.clave);
        pintarCelda(celda);
      }));
  } else {
    cabecera.append(
      botonDiff("✕ Rechazar", "rechazar", "Descartar el cambio del modelo y volver al texto original", () => rechazarCambios(celda, [cambio])),
      botonDiff("✓ Aceptar", "aceptar", "Quedarse con el cambio del modelo", () => aceptarCambios(celda, [cambio])));
  }
  const bloque = el("section", { className: `diff-cambio${aceptado ? " aceptado" : ""}` }, cabecera);
  if (q) bloque.append(lineaDiff(cambio, "quitada"));
  if (a) bloque.append(lineaDiff(cambio, "agregada"));
  return bloque;
}

function pintarCambios(cuerpo, celda) {
  const { partes, cambios } = fidelidad(celda);
  const scroll = cuerpo.scrollTop;
  const completoAbierto = cuerpo.querySelector(".diff-completo")?.open ?? false;
  cuerpo.replaceChildren();
  if (!cambios.length) {
    cuerpo.append(el("p", { className: "cambios-ok", textContent: "✓ El HTML tiene exactamente las mismas palabras que el original" }));
    return;
  }
  const pendientes = cambios.filter((c) => !cambioAceptado(celda, c));
  const barra = el("div", { className: "diff-barra" },
    el("span", {
      className: `diff-total${pendientes.length ? "" : " listo"}`,
      textContent: pendientes.length
        ? `${pendientes.length} de ${cambios.length} ${cambios.length === 1 ? "cambio pendiente" : "cambios pendientes"}`
        : `✓ ${cambios.length === 1 ? "El cambio está aceptado" : `Los ${cambios.length} cambios están aceptados`}`,
    }),
    el("span", { className: "espacio" }));
  if (pendientes.length > 1) {
    barra.append(
      botonDiff("✕ Rechazar todos", "rechazar", "Volver al texto original en todos los cambios pendientes", () => rechazarCambios(celda, pendientes)),
      botonDiff("✓ Aceptar todos", "aceptar", "Quedarse con todos los cambios pendientes del modelo", () => aceptarCambios(celda, pendientes)));
  }
  const lista = el("div", { className: "diff-lista" });
  cambios.forEach((cambio, n) => lista.append(bloqueCambio(celda, cambio, n, cambios.length)));

  const texto = el("p", { className: "cambios-texto" });
  for (const p of partes) {
    texto.append(p.tipo === "igual" ? p.texto : el(p.tipo === "agregada" ? "ins" : "del", { textContent: p.texto }), p.separador || " ");
  }
  const completo = el("details", { className: "diff-completo", open: completoAbierto },
    el("summary", { textContent: "Ver el texto completo con los cambios" }), texto);
  const leyenda = el("p", { className: "cambios-leyenda", textContent: "Se ignoran etiquetas, mayúsculas, signos y la numeración de listas" });
  cuerpo.append(barra, lista, completo, leyenda);
  cuerpo.scrollTop = scroll;
}

function reglaDeColumna(c) {
  return tabla.selects[c].value || $("regla-general").value;
}

// La celda de la tabla muestra unas pocas líneas: maquetar el texto entero de miles de celdas es lo que hace lenta la tabla
const MAX_VISTA_PREVIA = 600;

function recortarTexto(texto) {
  return texto.length > MAX_VISTA_PREVIA ? `${texto.slice(0, MAX_VISTA_PREVIA)}…` : texto;
}

// Se corta fuera de una etiqueta; las que quedan abiertas las cierra el navegador al interpretar el HTML
function recortarHtml(html) {
  if (html.length <= MAX_VISTA_PREVIA) return html;
  const cierre = html.indexOf(">", MAX_VISTA_PREVIA), apertura = html.indexOf("<", MAX_VISTA_PREVIA);
  if (cierre >= 0 && (apertura < 0 || cierre < apertura)) return html.slice(0, cierre + 1);
  const espacio = html.slice(MAX_VISTA_PREVIA).search(/\s/);
  return espacio < 0 ? html : `${html.slice(0, MAX_VISTA_PREVIA + espacio)}…`;
}

function pintarCelda(celda) {
  const verCodigo = $("ver-codigo").getAttribute("aria-pressed") === "true";
  const contenido = el("div", { className: "contenido" });
  if (celda.html != null && !verCodigo) {
    contenido.classList.add("html");
    contenido.innerHTML = recortarHtml(celda.html);
  } else if (celda.html != null) {
    contenido.classList.add("codigo");
    contenido.innerHTML = resaltarHtml(recortarHtml(celda.html));
  } else {
    contenido.textContent = recortarTexto(celda.original);
  }

  const pie = el("div", { className: "pie" });
  const etiqueta = etiquetaCelda(celda);
  if (etiqueta) pie.append(etiqueta);
  const aviso = celda.estado ? null : etiquetaFidelidad(celda);
  if (aviso) pie.append(aviso);
  celda.td.classList.toggle("revisar", Boolean(aviso));

  const apagado = ocupado || modoCeldas;
  if (celda.original.trim()) {
    const formatear = el("button", { className: "btn chico", textContent: "Formatear", title: "Formatear esta celda con la regla de su columna", disabled: apagado });
    formatear.onclick = () => formatearCeldas([celda]);
    pie.append(formatear);
  }
  if (celda.html != null) {
    const original = el("button", { className: "btn chico", textContent: "Original", title: "Volver al texto original", disabled: apagado });
    original.onclick = () => {
      Object.assign(celda, { html: null, regla: null, estado: null });
      pintarCelda(celda);
    };
    pie.append(original);
  }

  celda.td.classList.toggle("trabajando", celda.estado === "trabajando");
  celda.td.classList.toggle("excluida", !tabla.config[celda.columna].incluir);
  celda.td.replaceChildren(contenido, pie);
  if (celda === celdaAbierta) pintarModalCelda();
  programarVistaJson();
  programarGuardado();
}

function etiquetaCelda(celda) {
  if (celda.estado === "trabajando") return el("span", { className: "etiqueta trabajando girando", textContent: "formateando" });
  if (celda.estado === "error") return el("span", { className: "etiqueta error", textContent: "error", title: celda.error });
  if (!celda.regla) return null;
  const etiqueta = el("span", { className: "etiqueta regla", textContent: celda.regla, title: `Formateado con la regla "${celda.regla}"` });
  etiqueta.style.setProperty("--tono", tonoRegla(celda.regla));
  return etiqueta;
}

// ---------- Visor de celda ----------

let celdaAbierta = null;
let modoCelda = "vista";
// Mientras se edita: qué se edita ("original" o "codigo") y el texto con el que arrancó, para saber si hay cambios
let edicionCelda = null;
let pidiendoInstruccion = false;

function abrirCelda(celda) {
  celdaAbierta = celda;
  edicionCelda = null;
  const verCodigo = $("ver-codigo").getAttribute("aria-pressed") === "true";
  // Al recorrer con las flechas revisando cambios, seguir en esa pestaña
  const revisando = $("modal-celda").open && modoCelda === "cambios";
  modoCelda = celda.html == null ? "original" : revisando ? "cambios" : verCodigo ? "codigo" : "vista";
  pintarModalCelda();
  if (!$("modal-celda").open) $("modal-celda").showModal();
}

function pintarModalCelda() {
  const celda = celdaAbierta;
  const tieneHtml = celda.html != null;
  if (!tieneHtml) modoCelda = "original";

  const excluida = !tabla.filas[celda.fila].incluir || !tabla.config[celda.columna].incluir;
  $("celda-titulo").textContent = tabla.columnas[celda.columna];
  $("celda-subtitulo").textContent =
    `Fila ${celda.fila + 1} de ${tabla.filas.length}` + (excluida ? " · no se exporta al JSON" : "");
  $("celda-etiqueta").replaceChildren(...[etiquetaCelda(celda), etiquetaFidelidad(celda)].filter(Boolean));

  const editando = edicionCelda != null;
  for (const boton of document.querySelectorAll("#celda-vistas .subtab")) {
    boton.setAttribute("aria-selected", String(boton.dataset.modo === modoCelda));
    boton.disabled = editando || (boton.dataset.modo !== "original" && !tieneHtml);
  }
  $("celda-cuerpo").hidden = editando;
  $("celda-editor-marco").hidden = !editando;
  $("celda-ayuda-flechas").hidden = editando;
  const editandoCodigo = edicionCelda?.tipo === "codigo";
  $("celda-editor-marco").classList.toggle("codigo", editandoCodigo);
  $("celda-editor").classList.toggle("codigo", editandoCodigo);
  $("celda-editor").spellcheck = !editandoCodigo;
  if (editandoCodigo) actualizarResaltadoEditor();
  for (const id of ["celda-editar", "celda-copiar", "celda-restaurar", "celda-formatear"]) $(id).hidden = editando;
  $("celda-cancelar-edicion").hidden = $("celda-guardar-edicion").hidden = !editando;
  const sobre = edicionCelda?.tipo ?? (modoCelda === "original" ? "original" : "codigo");
  $("celda-instruccion").placeholder = sobre === "original"
    ? "Pedile al modelo un cambio en el texto original, por ej.: «corregí la ortografía»"
    : "Pedile al modelo un cambio en el HTML, por ej.: «quitá el título» o «poné en negrita los requisitos»";
  $("celda-instruccion").disabled = $("celda-aplicar").disabled = ocupado || pidiendoInstruccion;
  if (editando && edicionCelda.propuesta) {
    $("celda-info").textContent = "Propuesta del modelo: revisala y guardá, o pedí otro cambio encima · Esc la descarta";
    return;
  }
  if (editando) {
    $("celda-info").textContent = edicionCelda.tipo === "original" && tieneHtml
      ? "Editando el texto original · el HTML formateado no cambia hasta que lo vuelvas a formatear · Ctrl + Enter para guardar"
      : `Editando ${edicionCelda.tipo === "original" ? "el texto original" : "el código HTML"} · Ctrl + Enter para guardar · Esc para cancelar`;
    return;
  }
  $("celda-editar-txt").textContent = modoCelda === "original" ? "Editar texto" : "Editar HTML";
  $("celda-editar").disabled = ocupado;

  const cuerpo = $("celda-cuerpo");
  const texto = modoCelda === "original" ? celda.original : celda.html;
  cuerpo.className = `celda-cuerpo ${modoCelda}`;
  const comparable = tieneHtml && fidelidad(celda) != null;
  $("celda-copiar").hidden = modoCelda === "cambios";
  if (modoCelda === "cambios" && !comparable) {
    cuerpo.textContent = "El texto es demasiado largo para comparar palabra por palabra";
  } else if (modoCelda === "cambios") {
    pintarCambios(cuerpo, celda);
  } else if (!texto.trim()) {
    cuerpo.classList.add("vacia");
    cuerpo.textContent = "La celda está vacía";
  } else if (modoCelda === "vista") {
    cuerpo.innerHTML = celda.html;
  } else if (modoCelda === "codigo") {
    cuerpo.innerHTML = resaltarHtmlConNumeros(celda.html);
  } else {
    cuerpo.textContent = texto;
  }

  $("celda-info").textContent = celda.estado === "error" ? `Error: ${celda.error}` : `${texto.length} caracteres`;
  $("celda-restaurar").hidden = !tieneHtml;
  $("celda-formatear").hidden = !celda.original.trim();
  $("celda-formatear").textContent = tieneHtml ? "Volver a formatear" : "Formatear";
  $("celda-restaurar").disabled = $("celda-formatear").disabled = ocupado;
}

function moverCelda(df, dc) {
  const ocultando = $("ocultar-excluidas").getAttribute("aria-pressed") === "true";
  let { fila: f, columna: c } = celdaAbierta;
  c = Math.min(Math.max(c + dc, 0), tabla.columnas.length - 1);
  if (df) {
    let siguiente = f + df;
    while (ocultando && tabla.filas[siguiente] && !tabla.filas[siguiente].incluir) siguiente += df;
    if (tabla.filas[siguiente]) f = siguiente;
  }
  const celda = tabla.celdas[f][c];
  if (celda === celdaAbierta) return;
  abrirCelda(celda);
  celda.td.scrollIntoView({ block: "nearest", inline: "nearest" });
}

for (const boton of document.querySelectorAll("#celda-vistas .subtab")) {
  boton.onclick = () => {
    modoCelda = boton.dataset.modo;
    pintarModalCelda();
  };
}

$("celda-copiar").onclick = async () => {
  const celda = celdaAbierta;
  await navigator.clipboard.writeText(modoCelda === "original" ? celda.original : celda.html);
  $("celda-copiar").textContent = "Copiado ✓";
  setTimeout(() => ($("celda-copiar").textContent = "Copiar"), 1500);
};

$("celda-restaurar").onclick = () => {
  Object.assign(celdaAbierta, { html: null, regla: null, estado: null, error: null, aceptados: [] });
  pintarCelda(celdaAbierta);
};

$("celda-formatear").onclick = () => formatearCeldas([celdaAbierta]);

$("celda-editar").onclick = () => {
  const tipo = modoCelda === "original" ? "original" : "codigo";
  const texto = tipo === "original" ? celdaAbierta.original : ordenarHtml(celdaAbierta.html);
  edicionCelda = { tipo, inicial: texto };
  modoCelda = tipo;
  $("celda-editor").value = texto;
  pintarModalCelda();
  $("celda-editor").focus();
  $("celda-editor").setSelectionRange(0, 0);
  $("celda-editor").scrollTop = 0;
};

function actualizarResaltadoEditor() {
  const editor = $("celda-editor");
  const resaltado = $("celda-editor-resaltado");
  resaltado.innerHTML = colorearHtmlConNumeros(editor.value);
  resaltado.scrollTop = editor.scrollTop;
  resaltado.scrollLeft = editor.scrollLeft;
}

$("celda-editor").addEventListener("input", () => {
  if (edicionCelda?.tipo === "codigo") actualizarResaltadoEditor();
});
$("celda-editor").addEventListener("scroll", () => {
  $("celda-editor-resaltado").scrollTop = $("celda-editor").scrollTop;
  $("celda-editor-resaltado").scrollLeft = $("celda-editor").scrollLeft;
});

function guardarEdicionCelda() {
  const celda = celdaAbierta;
  const valor = $("celda-editor").value;
  if (edicionCelda.tipo === "original") {
    celda.original = valor;
    celda.td.classList.toggle("vacia", !valor.trim());
    if (!valor.trim()) marcarCelda(celda, false);
  } else if (valor.trim()) {
    celda.html = valor;
  } else {
    // Borrar todo el HTML equivale a volver al texto original
    Object.assign(celda, { html: null, regla: null });
    modoCelda = "original";
  }
  edicionCelda = null;
  actualizarBotonCeldas();
  pintarCelda(celda);
}

async function salirDeEdicionCelda() {
  if ($("celda-editor").value !== edicionCelda.inicial) {
    const descartar = await dialogoRef({
      titulo: "Descartar cambios",
      mensaje: "Hiciste cambios en esta celda que todavía no guardaste. ¿Querés descartarlos?",
      aceptar: "Descartar",
      peligro: true,
    });
    if (!descartar) return false;
  }
  edicionCelda = null;
  pintarModalCelda();
  return true;
}

// El resultado del modelo se carga en el editor para revisarlo antes de guardar
$("celda-instruccion-form").onsubmit = async (e) => {
  e.preventDefault();
  const instruccion = $("celda-instruccion").value.trim();
  if (!instruccion || pidiendoInstruccion) return $("celda-instruccion").focus();
  const celda = celdaAbierta;
  const tipo = edicionCelda?.tipo ?? (modoCelda === "original" ? "original" : "codigo");
  const texto = edicionCelda ? $("celda-editor").value : tipo === "original" ? celda.original : celda.html;
  if (!texto.trim()) {
    $("celda-info").textContent = "No hay texto al que aplicarle el cambio";
    return;
  }

  pidiendoInstruccion = true;
  pintarModalCelda();
  $("celda-instruccion-form").classList.add("pidiendo");
  $("celda-aplicar").textContent = "Pidiendo...";
  $("celda-info").textContent = `El modelo está aplicando: «${instruccion}»`;
  try {
    const { resultado } = await api("/instruccion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto, instruccion, es_html: tipo === "codigo" }),
    });
    // Si mientras tanto se cerró el visor o se pasó a otra celda, el resultado ya no corresponde
    if (celdaAbierta !== celda) return;
    if (!edicionCelda) {
      edicionCelda = { tipo, inicial: texto };
      modoCelda = tipo;
    }
    edicionCelda.propuesta = true;
    $("celda-editor").value = tipo === "codigo" ? ordenarHtml(resultado) : resultado;
    $("celda-instruccion").value = "";
  } catch (error) {
    if (celdaAbierta === celda) $("celda-info").textContent = `Error: ${error.message}`;
    return;
  } finally {
    pidiendoInstruccion = false;
    $("celda-instruccion-form").classList.remove("pidiendo");
    $("celda-aplicar").textContent = "Pedir cambio";
    $("celda-instruccion").disabled = $("celda-aplicar").disabled = ocupado;
  }
  pintarModalCelda();
  $("celda-editor").focus();
};

$("celda-guardar-edicion").onclick = guardarEdicionCelda;
$("celda-cancelar-edicion").onclick = salirDeEdicionCelda;

async function cerrarCelda() {
  if (edicionCelda && !(await salirDeEdicionCelda())) return;
  $("modal-celda").close();
}

$("celda-cerrar").onclick = cerrarCelda;

$("modal-celda").onclick = (e) => {
  if (e.target === $("modal-celda")) cerrarCelda();
};
// Esc mientras se edita cancela la edición en vez de cerrar el visor
$("modal-celda").oncancel = (e) => {
  if (!edicionCelda) return;
  e.preventDefault();
  salirDeEdicionCelda();
};
$("modal-celda").onclose = () => {
  celdaAbierta = null;
  edicionCelda = null;
};
$("modal-celda").onkeydown = (e) => {
  if (edicionCelda) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key.toLowerCase() === "s")) {
      e.preventDefault();
      guardarEdicionCelda();
    }
    return;
  }
  if (e.target.matches("input, textarea")) return;
  const movimiento = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (!movimiento) return;
  e.preventDefault();
  moverCelda(...movimiento);
};

function pintarFila(f) {
  const { incluir, tr, interruptor } = tabla.filas[f];
  interruptor.checked = incluir;
  tr.classList.toggle("excluida", !incluir);
}

function actualizarSeleccion() {
  const total = tabla.filas.length;
  const filas = tabla.filas.filter((fila) => fila.incluir).length;
  $("todas-filas").checked = filas === total;
  $("todas-filas").indeterminate = filas > 0 && filas < total;
  const ocultando = $("ocultar-excluidas").getAttribute("aria-pressed") === "true";
  $("contador-ocultas").textContent = total - filas;
  $("contador-ocultas").hidden = !ocultando || filas === total;
  programarVistaJson();
  programarGuardado();
}

// `valor` puede ser un booleano o una función que recibe el estado actual (para invertir)
function cambiarFilas(indices, valor) {
  for (const f of indices) {
    tabla.filas[f].incluir = valor;
    pintarFila(f);
  }
  actualizarSeleccion();
}

function cambiarColumnas(indices, valor) {
  for (const c of indices) {
    if (valor === tabla.config[c].incluir) continue;
    tabla.config[c].incluir = valor;
    pintarColumna(c);
  }
  actualizarSeleccion();
}

function rango(a, b) {
  const [desde, hasta] = a < b ? [a, b] : [b, a];
  return Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
}

let arrastre = null;
let ultimaFila = null;

function terminarArrastre() {
  arrastreCeldas = null;
  if (!arrastre) return;
  arrastre = null;
  $("contenedor-csv").classList.remove("arrastrando");
}
window.addEventListener("pointerup", terminarArrastre);
window.addEventListener("pointercancel", terminarArrastre);

function celdaDeFila(f, ...hijos) {
  const td = el("td", { className: "col-fila", title: "Clic: incluir o excluir · Arrastrá para marcar varias · Shift + clic: rango" }, ...hijos);
  td.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (modoCeldas) {
      empezarSeleccionCeldas({ fila: f, columna: 0 }, e.shiftKey, "filas");
      if (td.hasPointerCapture(e.pointerId)) td.releasePointerCapture(e.pointerId);
      return;
    }
    const valor = !tabla.filas[f].incluir;
    cambiarFilas(e.shiftKey && ultimaFila != null ? rango(ultimaFila, f) : [f], valor);
    ultimaFila = f;
    arrastre = { valor, ultima: f };
    $("contenedor-csv").classList.add("arrastrando");
    // En pantallas táctiles el puntero queda capturado y no llegarían los pointerenter de las otras filas
    if (td.hasPointerCapture(e.pointerId)) td.releasePointerCapture(e.pointerId);
  };
  td.onpointerenter = () => {
    if (arrastreCeldas) arrastrarCeldasHasta({ fila: f, columna: arrastreCeldas.ultimo.columna });
    if (!arrastre) return;
    cambiarFilas(rango(arrastre.ultima, f), arrastre.valor);
    arrastre.ultima = ultimaFila = f;
  };
  // El clic del mouse ya se resolvió en pointerdown; el de teclado (detail 0) sigue de largo al interruptor
  td.onclick = (e) => {
    if (e.detail !== 0) e.preventDefault();
  };
  return td;
}

// ---------- Modo selección de celdas ----------

let modoCeldas = false;
const seleccionadas = new Set();
let anclaCelda = null;
// { tipo, valor, desde, ultimo, previas }: la zona entre `desde` y el punto actual toma `valor`; el resto vuelve a `previas`.
// `tipo` dice si la zona es un rectángulo de celdas, filas completas, columnas completas o toda la tabla
let arrastreCeldas = null;

function actualizarBotonCeldas() {
  $("contador-celdas").textContent = seleccionadas.size;
  $("formatear-seleccion").disabled = ocupado || !seleccionadas.size;
  $("limpiar-celdas").disabled = !seleccionadas.size;
  if (tabla) pintarCabecerasSeleccion();
}

function marcarCelda(celda, valor) {
  if (valor) seleccionadas.add(celda);
  else seleccionadas.delete(celda);
  celda.td.classList.toggle("seleccionada", valor);
}

function ocultandoExcluidas() {
  return $("ocultar-excluidas").getAttribute("aria-pressed") === "true";
}

function seleccionable(celda, ocultando = ocultandoExcluidas()) {
  // Las vacías no tienen nada que formatear: marcarlas solo inflaría el contador
  return /\S/.test(celda.original) && !(ocultando && !tabla.filas[celda.fila].incluir);
}

function celdasEntre(a, b) {
  const ocultando = ocultandoExcluidas();
  const celdas = [];
  for (const f of rango(a.fila, b.fila)) {
    for (const c of rango(a.columna, b.columna)) {
      if (seleccionable(tabla.celdas[f][c], ocultando)) celdas.push(tabla.celdas[f][c]);
    }
  }
  return celdas;
}

function celdasDeZona(tipo, desde, hasta) {
  const filaFinal = tabla.filas.length - 1;
  const columnaFinal = tabla.config.length - 1;
  if (tipo === "filas") return celdasEntre({ fila: desde.fila, columna: 0 }, { fila: hasta.fila, columna: columnaFinal });
  if (tipo === "columnas") return celdasEntre({ fila: 0, columna: desde.columna }, { fila: filaFinal, columna: hasta.columna });
  if (tipo === "todo") return celdasEntre({ fila: 0, columna: 0 }, { fila: filaFinal, columna: columnaFinal });
  return celdasEntre(desde, hasta);
}

function arrastrarCeldasHasta(punto) {
  const { tipo, valor, desde, previas } = arrastreCeldas;
  arrastreCeldas.ultimo = { fila: punto.fila, columna: punto.columna };
  const zona = new Set(celdasDeZona(tipo, desde, punto));
  for (const fila of tabla.celdas) {
    for (const c of fila) {
      const elegida = zona.has(c) ? valor : previas.has(c);
      if (elegida !== seleccionadas.has(c)) marcarCelda(c, elegida);
    }
  }
  actualizarBotonCeldas();
}

function empezarSeleccionCeldas(punto, conShift, tipo = "celdas") {
  const rangoDesdeAncla = conShift && anclaCelda;
  const inicial = celdasDeZona(tipo, punto, punto);
  arrastreCeldas = {
    tipo,
    valor: rangoDesdeAncla ? true : !inicial.every((c) => seleccionadas.has(c)),
    desde: rangoDesdeAncla ? anclaCelda : punto,
    previas: new Set(seleccionadas),
  };
  if (!rangoDesdeAncla) anclaCelda = { fila: punto.fila, columna: punto.columna };
  arrastrarCeldasHasta(punto);
}

// En modo selección, los títulos de columna y la esquina eligen celdas en vez de abrir sus controles
function seleccionarDesdeCabecera(th, tipo, punto) {
  th.onpointerdown = (e) => {
    if (!modoCeldas || e.button !== 0 || e.target.closest("label, input, select, button")) return;
    e.preventDefault();
    empezarSeleccionCeldas(punto(), e.shiftKey, tipo);
    if (th.hasPointerCapture(e.pointerId)) th.releasePointerCapture(e.pointerId);
  };
  th.onpointerenter = () => {
    if (arrastreCeldas) arrastrarCeldasHasta(punto());
  };
}

// Una fila o columna está «completa» si todas sus celdas elegibles están marcadas (y tiene al menos una)
function pintarCabecerasSeleccion() {
  const ocultando = ocultandoExcluidas();
  const elegiblesFila = new Array(tabla.filas.length).fill(0), marcadasFila = new Array(tabla.filas.length).fill(0);
  const elegiblesColumna = new Array(tabla.config.length).fill(0), marcadasColumna = new Array(tabla.config.length).fill(0);
  for (const fila of tabla.celdas) {
    for (const celda of fila) {
      if (!seleccionable(celda, ocultando)) continue;
      elegiblesFila[celda.fila]++;
      elegiblesColumna[celda.columna]++;
      if (!seleccionadas.has(celda)) continue;
      marcadasFila[celda.fila]++;
      marcadasColumna[celda.columna]++;
    }
  }
  tabla.filas.forEach((fila, f) => fila.tr.firstChild.classList.toggle("seleccionada", elegiblesFila[f] > 0 && marcadasFila[f] === elegiblesFila[f]));
  tabla.config.forEach((conf, c) => conf.th.classList.toggle("seleccionada", elegiblesColumna[c] > 0 && marcadasColumna[c] === elegiblesColumna[c]));
}

// En modo selección solo se formatea con «Formatear celdas»: los botones sueltos se apagan para no mezclar
function actualizarBotonesFormatear() {
  document.querySelectorAll("#cuerpo-csv td.celda button, #cabecera-csv .formatear-columna")
    .forEach((b) => (b.disabled = ocupado || modoCeldas));
}

function limpiarSeleccionCeldas() {
  for (const celda of [...seleccionadas]) marcarCelda(celda, false);
  anclaCelda = null;
  actualizarBotonCeldas();
}

function cambiarModoCeldas(activo) {
  modoCeldas = activo;
  $("modo-celdas").setAttribute("aria-pressed", String(activo));
  $("contenedor-csv").classList.toggle("modo-celdas", activo);
  $("formatear-tabla").hidden = activo;
  $("formatear-seleccion").hidden = $("limpiar-celdas").hidden = !activo;
  $("ayuda-filas").hidden = activo;
  actualizarBotonesFormatear();
  if (activo) {
    mostrarEstado("estado-csv", "Clic en celdas, números de fila o títulos de columna para elegirlos · Arrastrá para marcar varios · Shift + clic marca un rango · Esc para salir");
  } else {
    limpiarSeleccionCeldas();
    mostrarEstado("estado-csv", "");
  }
  actualizarBotonCeldas();
}

$("modo-celdas").onclick = () => cambiarModoCeldas(!modoCeldas);
$("limpiar-celdas").onclick = limpiarSeleccionCeldas;

$("formatear-seleccion").onclick = async () => {
  // En el orden de la tabla, no en el que se fueron eligiendo
  const elegidas = tabla.celdas.flat().filter((c) => seleccionadas.has(c));
  const listas = await formatearCeldas(elegidas);
  // Las que fallaron o no se alcanzaron a procesar quedan marcadas para reintentar
  for (const celda of listas) marcarCelda(celda, false);
  actualizarBotonCeldas();
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modoCeldas && !document.querySelector("dialog[open]")) cambiarModoCeldas(false);
});

function interruptorChico(onchange, titulo) {
  const input = el("input", { type: "checkbox", checked: true });
  input.onchange = () => onchange(input.checked);
  return [input, el("label", { className: "interruptor", title: titulo }, input, el("span", { className: "deslizador" }))];
}

function pintarTodo() {
  for (const fila of tabla.celdas) for (const celda of fila) pintarCelda(celda);
}

function pintarCabeceraColumna(c) {
  const { incluir, clave, th, interruptor } = tabla.config[c];
  interruptor.checked = incluir;
  th.classList.toggle("excluida", !incluir);
  const codigo = el("code", { textContent: clave });
  if (referencia.claves.length) {
    const coincide = referencia.claves.some((k) => k.clave === clave);
    codigo.classList.add(coincide ? "coincide" : "no-coincide");
    codigo.title = coincide ? "Coincide con el JSON de referencia" : "No existe en el JSON de referencia";
  }
  th.querySelector(".clave-json").replaceChildren(...(incluir ? ["JSON: ", codigo] : ["No se exporta al JSON"]));
  pintarClavesReferencia();
  programarGuardado();
}

function pintarColumna(c) {
  pintarCabeceraColumna(c);
  const excluida = !tabla.config[c].incluir;
  for (const fila of tabla.celdas) fila[c].td.classList.toggle("excluida", excluida);
  actualizarSeleccion();
}

const ICONO_ENGRANAJE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;

// `restaurar` aplica una sesión guardada antes del primer pintado, para no pintar la tabla dos veces
function mostrarTabla(data, nombreArchivo, restaurar) {
  tabla = {
    columnas: data.columnas,
    separador: data.separador,
    nombreArchivo,
    selects: [],
    config: [],
    filas: [],
    celdas: [],
  };

  ultimaFila = null;
  seleccionadas.clear();
  anclaCelda = null;
  const [todas, interruptorTodas] = interruptorChico(
    (valor) => cambiarFilas(tabla.filas.map((_, f) => f), valor),
    "Incluir todas las filas en el JSON",
  );
  todas.id = "todas-filas";
  const esquina = el("th", { className: "col-fila" }, interruptorTodas, el("div", { className: "clave-json", textContent: "Filas" }));
  seleccionarDesdeCabecera(esquina, "todo", () => ({ fila: 0, columna: 0 }));
  const filaCabecera = el("tr", {}, esquina);

  data.columnas.forEach((nombre, c) => {
    const select = el("select", { title: "Regla para esta columna" });
    select.add(new Option("Regla general", ""));
    for (const r of reglas) select.add(new Option(r, r));
    select.onchange = programarGuardado;
    tabla.selects.push(select);

    const boton = el("button", {
      className: "btn chico formatear-columna",
      textContent: "Formatear",
      title: "Formatear las celdas pendientes de esta columna (se omiten las filas excluidas)",
    });
    boton.onclick = () => formatearIncluidas(tabla.celdas.map((fila) => fila[c]), `la columna "${nombre}"`);

    const interruptor = el("input", { type: "checkbox", checked: true });
    interruptor.onchange = () => cambiarColumnas([c], interruptor.checked);

    const engranaje = el("button", { className: "btn-icono", title: "Configurar columna", innerHTML: ICONO_ENGRANAJE });
    engranaje.onclick = () => abrirConfigColumna(c);

    const th = el("th", {},
      el("div", { className: "cabecera-col" },
        el("label", { className: "interruptor", title: "Incluir en el JSON" }, interruptor, el("span", { className: "deslizador" })),
        el("span", { className: "nombre", textContent: nombre }),
        engranaje,
      ),
      el("div", { className: "clave-json" }),
      el("div", { className: "acciones" }, select, boton),
    );
    seleccionarDesdeCabecera(th, "columnas", () => ({ fila: arrastreCeldas?.ultimo.fila ?? 0, columna: c }));
    tabla.config.push({ incluir: true, clave: nombre, th, interruptor });
    filaCabecera.append(th);
  });
  $("cabecera-csv").replaceChildren(filaCabecera);

  const filas = data.filas.map((valores, i) => {
    const [interruptor, etiqueta] = interruptorChico((valor) => {
      cambiarFilas([i], valor);
      ultimaFila = i;
    }, "Incluir esta fila en el JSON");
    const tr = el("tr", {}, celdaDeFila(i, etiqueta, el("div", { className: "num-fila", textContent: i + 1 })));
    tabla.filas.push({ incluir: true, tr, interruptor });
    tabla.celdas.push(data.columnas.map((_, c) => {
      const td = el("td", { className: (valores[c] ?? "").trim() ? "celda" : "celda vacia" });
      tr.append(td);
      const celda = { original: valores[c] ?? "", html: null, regla: null, estado: null, error: null, aceptados: [], td, fila: i, columna: c };
      td.onclick = (e) => {
        // Si el usuario estaba seleccionando texto, no abrir el visor
        if (modoCeldas || e.target.closest("button") || getSelection().toString()) return;
        abrirCelda(celda);
      };
      td.onpointerdown = (e) => {
        if (!modoCeldas || e.button !== 0 || e.target.closest("button")) return;
        e.preventDefault();
        empezarSeleccionCeldas(celda, e.shiftKey);
        if (td.hasPointerCapture(e.pointerId)) td.releasePointerCapture(e.pointerId);
      };
      td.onpointerenter = () => {
        if (arrastreCeldas) arrastrarCeldasHasta(celda);
      };
      return celda;
    }));
    return tr;
  });
  $("cuerpo-csv").replaceChildren(...filas);

  restaurar?.();
  tabla.config.forEach((_, c) => pintarCabeceraColumna(c));
  pintarTodo();
  tabla.filas.forEach((_, f) => pintarFila(f));
  actualizarSeleccion();
  $("seleccion-csv").hidden = false;
  $("zona-csv").classList.add("compacta");
  $("zona-titulo").textContent = nombreArchivo;
  const numFilas = el("span", { className: "numero", textContent: "0" });
  const numColumnas = el("span", { className: "numero", textContent: "0" });
  $("zona-detalle").replaceChildren(numFilas, " filas · ", numColumnas, " columnas · hacé clic o arrastrá otro archivo para cambiarlo");
  contar(numFilas, data.filas.length);
  contar(numColumnas, data.columnas.length);
  actualizarBotonCeldas();
  $("controles-csv").hidden = false;
  $("contenedor-csv").hidden = false;
  mostrarEstado("estado-csv", "");
}

$("ocultar-excluidas").onclick = () => {
  const activo = $("ocultar-excluidas").getAttribute("aria-pressed") !== "true";
  $("ocultar-excluidas").setAttribute("aria-pressed", String(activo));
  $("contenedor-csv").classList.toggle("ocultar-excluidas", activo);
  actualizarSeleccion();
};

function bloquear(valor) {
  ocupado = valor;
  document.querySelectorAll("#contenedor-csv button, #contenedor-csv select, #controles-csv button:not(#ver-json, #ver-referencia, #ver-codigo), #controles-csv select")
    .forEach((n) => (n.disabled = valor));
  $("zona-csv").classList.toggle("deshabilitada", valor);
  $("panel-csv").querySelector(".tarjeta").classList.toggle("activa", valor);
  $("detener").hidden = !valor;
  $("detener").disabled = false;
  $("progreso").hidden = !valor;
  if (celdaAbierta) pintarModalCelda();
  actualizarBotonCeldas();
  actualizarBotonesFormatear();
}

function avanzar(hechas, total) {
  $("progreso-barra").style.width = `${(hechas / total) * 100}%`;
}

// Devuelve las celdas que se formatearon bien
async function formatearCeldas(celdas) {
  const listas = [];
  if (ocupado) return listas;
  const pendientes = celdas.filter((c) => c.original.trim());
  if (!pendientes.length) {
    mostrarEstado("estado-csv", "No hay celdas con texto para formatear", "error");
    return listas;
  }

  cancelar = false;
  bloquear(true);
  avanzar(0, pendientes.length);
  let hechas = 0, errores = 0;
  try {
    for (const celda of pendientes) {
      if (cancelar) break;
      const regla = reglaDeColumna(celda.columna);
      mostrarEstado("estado-csv",
        `Formateando ${hechas + 1} de ${pendientes.length} · columna "${tabla.columnas[celda.columna]}" · regla "${regla}"`,
        "trabajando");
      celda.estado = "trabajando";
      pintarCelda(celda);
      try {
        celda.html = await pedirFormato(celda.original, regla);
        Object.assign(celda, { regla, estado: null, error: null, aceptados: [] });
        listas.push(celda);
      } catch (e) {
        Object.assign(celda, { estado: "error", error: e.message });
        errores++;
        // 503: Ollama apagado; 502: modelo no instalado. Seguir solo repetiría el mismo error en cada celda.
        if (e.status === 503 || e.status === 502) {
          pintarCelda(celda);
          throw e;
        }
      }
      pintarCelda(celda);
      hechas++;
      avanzar(hechas, pendientes.length);
    }
    const revisar = listas.filter(paraRevisar).length;
    const aviso = revisar
      ? ` · ⚠ ${revisar} ${revisar === 1 ? "tiene" : "tienen"} palabras agregadas o quitadas: revisalas en la pestaña «Cambios»`
      : "";
    if (cancelar) {
      mostrarEstado("estado-csv", `Detenido: ${hechas} de ${pendientes.length} celdas procesadas${aviso}`);
    } else if (errores) {
      mostrarEstado("estado-csv", `${hechas} celdas procesadas, ${errores} con error${aviso}`, "error");
    } else {
      mostrarEstado("estado-csv", `Listo: ${hechas} ${hechas === 1 ? "celda formateada" : "celdas formateadas"}${aviso}`, revisar ? "aviso" : "ok");
    }
  } catch (e) {
    mostrarEstado("estado-csv", e.message, "error");
  } finally {
    bloquear(false);
    // Cada celda ya se pintó al terminar; solo puede quedar colgada la que estaba en curso al cortar
    for (const celda of pendientes) {
      if (celda.estado !== "trabajando") continue;
      celda.estado = null;
      pintarCelda(celda);
    }
  }
  return listas;
}

// ---------- Sesión: el progreso de la tabla se guarda solo y se recupera al volver ----------

const VERSION_SESION = 1;
let temporizadorGuardado = null;
let guardadoPendiente = false;

function programarGuardado() {
  if (!tabla) return;
  guardadoPendiente = true;
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = setTimeout(guardarSesion, 800);
}

// keepalive deja terminar el pedido aunque se cierre la pestaña (solo con cuerpos de hasta ~64 KB)
window.addEventListener("pagehide", () => {
  if (!guardadoPendiente || !tabla) return;
  fetch("/sesion", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datosSesion()),
    keepalive: true,
  }).catch(() => {});
});

function datosSesion() {
  return {
    version: VERSION_SESION,
    nombreArchivo: tabla.nombreArchivo,
    separador: tabla.separador,
    columnas: tabla.columnas,
    filas: tabla.celdas.map((fila) => fila.map((c) => c.original)),
    reglaGeneral: $("regla-general").value,
    config: tabla.config.map(({ incluir, clave }, c) => ({ incluir, clave, regla: tabla.selects[c].value })),
    filasIncluidas: tabla.filas.map((f) => f.incluir),
    formateadas: tabla.celdas.flat()
      .filter((c) => c.html != null)
      .map(({ fila, columna, html, regla, aceptados }) => ({ fila, columna, html, regla, ...(aceptados.length && { aceptados }) })),
  };
}

async function guardarSesion() {
  guardadoPendiente = false;
  try {
    await api("/sesion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datosSesion()),
    });
    const hora = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
    $("guardado-csv").textContent = `Progreso guardado ${hora}`;
    $("guardado-csv").classList.remove("error");
  } catch (e) {
    $("guardado-csv").textContent = `No se pudo guardar el progreso: ${e.message}`;
    $("guardado-csv").classList.add("error");
  }
}

async function recuperarSesion() {
  let sesion;
  try {
    sesion = await api("/sesion");
  } catch {
    return;
  }
  if (!sesion || sesion.version !== VERSION_SESION || tabla) return;
  try {
    mostrarTabla({ columnas: sesion.columnas, filas: sesion.filas, separador: sesion.separador }, sesion.nombreArchivo, () => {
      if (reglas.includes(sesion.reglaGeneral)) $("regla-general").value = sesion.reglaGeneral;
      sesion.config.forEach(({ incluir, clave, regla }, c) => {
        Object.assign(tabla.config[c], { incluir, clave });
        if (reglas.includes(regla)) tabla.selects[c].value = regla;
      });
      sesion.filasIncluidas.forEach((incluir, f) => (tabla.filas[f].incluir = incluir));
      for (const { fila, columna, html, regla, aceptados, aceptado } of sesion.formateadas) {
        const celda = Object.assign(tabla.celdas[fila][columna], { html, regla, aceptados: aceptados ?? [] });
        // Sesiones anteriores guardaban «Dar por buena» para la celda entera
        if (aceptado) celda.aceptados = fidelidad(celda)?.cambios.map((c) => c.clave) ?? [];
      }
    });
    const n = sesion.formateadas.length;
    mostrarEstado("estado-csv",
      `Se recuperó el trabajo de "${sesion.nombreArchivo}" · ${n} ${n === 1 ? "celda formateada" : "celdas formateadas"}`, "ok");
  } catch (e) {
    mostrarEstado("estado-csv", `No se pudo recuperar el trabajo anterior: ${e.message}`, "error");
  }
}

async function cargarCsv(archivo) {
  if (!archivo || ocupado) return;
  const hechas = tabla ? tabla.celdas.flat().filter((c) => c.html != null).length : 0;
  if (hechas) {
    const seguir = await dialogoRef({
      titulo: "Reemplazar la tabla",
      mensaje: `Tenés ${hechas} ${hechas === 1 ? "celda formateada" : "celdas formateadas"} en "${tabla.nombreArchivo}". `
        + `Si cargás "${archivo.name}", ese trabajo se pierde. Si lo necesitás, descargá antes el CSV o el JSON.`,
      aceptar: "Cargar igual",
      peligro: true,
    });
    if (!seguir) return;
  }
  mostrarEstado("estado-csv", "Cargando...", "trabajando");
  try {
    const datos = new FormData();
    datos.append("archivo", archivo);
    const r = await fetch("/csv", { method: "POST", body: datos });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail);
    mostrarTabla(data, archivo.name);
  } catch (e) {
    mostrarEstado("estado-csv", e.message, "error");
  }
}

$("archivo-csv").onchange = () => {
  cargarCsv($("archivo-csv").files[0]);
  $("archivo-csv").value = "";
};

const zona = $("zona-csv");
zona.ondragover = (e) => {
  e.preventDefault();
  zona.classList.add("encima");
};
zona.ondragleave = () => zona.classList.remove("encima");
zona.ondrop = (e) => {
  e.preventDefault();
  zona.classList.remove("encima");
  cargarCsv(e.dataTransfer.files[0]);
};

// Formatea solo las celdas incluidas en el JSON que todavía no tienen resultado.
// Si ya están todas listas, pregunta si se quieren volver a formatear.
async function formatearIncluidas(celdas, alcance) {
  if (ocupado) return;
  const incluidas = celdas.filter((c) => tabla.filas[c.fila].incluir && tabla.config[c.columna].incluir && c.original.trim());
  if (!incluidas.length) {
    return mostrarEstado("estado-csv", `No hay celdas incluidas con texto en ${alcance} (las filas y columnas excluidas se omiten)`, "error");
  }
  const pendientes = incluidas.filter((c) => c.html == null);
  if (pendientes.length) return formatearCeldas(pendientes);
  const rehacer = await dialogoRef({
    titulo: "Ya está todo formateado",
    mensaje: `Las ${incluidas.length} celdas incluidas de ${alcance} ya están formateadas. ¿Querés volver a formatearlas?`,
    aceptar: "Volver a formatear",
  });
  if (rehacer) formatearCeldas(incluidas);
}

$("formatear-tabla").onclick = () => formatearIncluidas(tabla.celdas.flat(), "la tabla");

$("detener").onclick = () => {
  cancelar = true;
  $("detener").disabled = true;
  mostrarEstado("estado-csv", "Deteniendo después de la celda actual...", "trabajando");
};

$("ver-codigo").onclick = () => {
  const activo = $("ver-codigo").getAttribute("aria-pressed") !== "true";
  $("ver-codigo").setAttribute("aria-pressed", String(activo));
  // Solo cambian las celdas formateadas: las demás muestran el texto original en las dos vistas
  if (tabla) for (const fila of tabla.celdas) for (const celda of fila) if (celda.html != null) pintarCelda(celda);
};

$("restaurar").onclick = () => {
  for (const celda of tabla.celdas.flat()) {
    if (celda.html == null && !celda.estado) continue;
    Object.assign(celda, { html: null, regla: null, estado: null, error: null, aceptados: [] });
    pintarCelda(celda);
  }
  mostrarEstado("estado-csv", "Se restauraron los textos originales", "ok");
};

function descargar(contenido, tipo, extension) {
  const blob = new Blob([contenido], { type: tipo });
  el("a", {
    href: URL.createObjectURL(blob),
    download: tabla.nombreArchivo.replace(/\.csv$/i, "") + "-formateado." + extension,
  }).click();
}

$("descargar").onclick = () => {
  const campo = (v) => `"${String(v).replaceAll('"', '""')}"`;
  const lineas = [
    tabla.columnas.map(campo).join(tabla.separador),
    ...tabla.celdas.map((fila) => fila.map((c) => campo(c.html ?? c.original)).join(tabla.separador)),
  ];
  descargar("\ufeff" + lineas.join("\r\n"), "text/csv;charset=utf-8", "csv");
};

function clavesRepetidas() {
  const claves = tabla.config.filter((c) => c.incluir).map((c) => c.clave);
  return [...new Set(claves.filter((clave, i) => claves.indexOf(clave) !== i))];
}

function construirJson() {
  const columnas = tabla.config.map((conf, c) => ({ ...conf, c })).filter((conf) => conf.incluir);
  const filas = tabla.celdas.filter((_, f) => tabla.filas[f].incluir);
  if (!columnas.length) return { error: "No hay columnas activas para exportar al JSON" };
  if (!filas.length) return { error: "No hay filas activas para exportar al JSON" };
  const repetidas = clavesRepetidas();
  if (repetidas.length) {
    return { error: `Hay columnas con el mismo nombre en el JSON: ${repetidas.join(", ")}. Cambiá alguno con el engranaje.` };
  }
  const datos = filas.map((fila) =>
    Object.fromEntries(columnas.map(({ clave, c }) => [clave, fila[c].html ?? fila[c].original])));
  return { datos, resumen: `${filas.length} de ${tabla.filas.length} filas · ${columnas.length} de ${tabla.columnas.length} columnas` };
}

$("descargar-json").onclick = () => {
  const { datos, error, resumen } = construirJson();
  if (error) return mostrarEstado("estado-csv", error, "error");
  descargar(JSON.stringify(datos, null, 2), "application/json;charset=utf-8", "json");
  mostrarEstado("estado-csv", `JSON descargado: ${resumen}`, "ok");
};

// ---------- Vista previa del JSON ----------

const MAX_FILAS_VISTA = 100;
let vistaPendiente = false;

function escaparHtml(texto) {
  return texto.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function resaltarJson(texto) {
  return escaparHtml(texto).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (token, cadena, dosPuntos) => {
      if (cadena) return dosPuntos ? `<span class="j-clave">${cadena}</span>${dosPuntos}` : `<span class="j-texto">${cadena}</span>`;
      return `<span class="j-literal">${token}</span>`;
    },
  );
}

function vistaJsonVisible() {
  return !$("cajon-json").hidden && !$("cajon-vista").hidden;
}

function actualizarVistaJson() {
  vistaPendiente = false;
  if (!vistaJsonVisible() || !tabla) return;
  const { datos, error, resumen } = construirJson();
  $("copiar-json").disabled = $("descargar-json-cajon").disabled = Boolean(error);
  if (error) {
    $("json-resumen").textContent = "";
    $("json-vista").replaceChildren(el("div", { className: "json-error", textContent: error }));
    return;
  }
  const recortado = datos.length > MAX_FILAS_VISTA;
  $("json-resumen").textContent = resumen + (recortado ? ` · mostrando las primeras ${MAX_FILAS_VISTA}` : "");
  $("json-vista").innerHTML = resaltarJson(JSON.stringify(recortado ? datos.slice(0, MAX_FILAS_VISTA) : datos, null, 2));
}

function programarVistaJson() {
  if (vistaPendiente || !vistaJsonVisible()) return;
  vistaPendiente = true;
  requestAnimationFrame(actualizarVistaJson);
}

function abrirCajon(abrir, vista) {
  const estabaCerrado = $("cajon-json").hidden;
  $("cajon-json").hidden = !abrir;
  document.body.classList.toggle("con-cajon", abrir);
  for (const boton of document.querySelectorAll(".subtab[data-vista]")) boton.setAttribute("aria-selected", boton.dataset.vista === vista);
  $("cajon-vista").hidden = vista !== "vista";
  $("cajon-referencia").hidden = vista !== "referencia";
  $("ver-json").setAttribute("aria-pressed", abrir && vista === "vista");
  $("ver-referencia").setAttribute("aria-pressed", abrir && vista === "referencia");
  if (!abrir) return;
  actualizarVistaJson();
  pintarClavesReferencia();
}

function alternarCajon(vista) {
  const abierto = !$("cajon-json").hidden && !$(vista === "vista" ? "cajon-vista" : "cajon-referencia").hidden;
  abrirCajon(!abierto, vista);
}

$("ver-json").onclick = () => alternarCajon("vista");
$("ver-referencia").onclick = () => alternarCajon("referencia");
for (const boton of document.querySelectorAll(".subtab[data-vista]")) boton.onclick = () => abrirCajon(true, boton.dataset.vista);
$("cerrar-json").onclick = () => abrirCajon(false);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("cajon-json").hidden && !document.querySelector("dialog[open]")) abrirCajon(false);
});

$("descargar-json-cajon").onclick = () => $("descargar-json").click();

$("copiar-json").onclick = async () => {
  const { datos } = construirJson();
  await navigator.clipboard.writeText(JSON.stringify(datos, null, 2));
  $("copiar-json").textContent = "Copiado";
  setTimeout(() => ($("copiar-json").textContent = "Copiar"), 1500);
};

// ---------- Configuración de columna ----------

let columnaEditando = null;

function ejemploColumna(c) {
  const celda = tabla.celdas.map((fila) => fila[c]).find((celda) => celda.original.trim());
  const valor = celda ? celda.html ?? celda.original : "";
  return valor.length > 60 ? valor.slice(0, 60) + "…" : valor;
}

function actualizarVistaModal() {
  const clave = $("modal-clave").value.trim() || "…";
  $("modal-vista").textContent = $("modal-incluir").checked
    ? JSON.stringify({ [clave]: ejemploColumna(columnaEditando) }, null, 2)
    : "(esta columna no se exporta)";
  pintarSugerencias();
}

function pintarSugerencias() {
  if (!referencia.claves.length) return $("modal-sugerencias").replaceChildren();
  const actual = $("modal-clave").value.trim();
  const chips = referencia.claves.map(({ clave, ejemplo }) => {
    const usadaPor = tabla.config.findIndex((conf, c) => c !== columnaEditando && conf.incluir && conf.clave === clave);
    const chip = el("button", {
      type: "button",
      className: "chip",
      textContent: clave,
      title: usadaPor >= 0 ? `Ya la usa la columna "${tabla.columnas[usadaPor]}"` : `Ejemplo: ${ejemplo}`,
    });
    chip.classList.toggle("usada", usadaPor >= 0);
    chip.classList.toggle("actual", clave === actual);
    chip.onclick = () => {
      $("modal-clave").value = clave;
      $("modal-error").textContent = "";
      actualizarVistaModal();
    };
    return chip;
  });
  const enReferencia = referencia.claves.find((k) => k.clave === actual);
  $("modal-sugerencias").replaceChildren(
    el("span", { className: "titulo-campo sugerencias-titulo", textContent: "Claves del JSON de referencia" }),
    el("div", { className: "chips" }, ...chips),
    ...(enReferencia ? [el("p", { className: "ref-valor" }, "Valor en la referencia: ", el("code", { textContent: recortar(enReferencia.ejemplo, 80) }))] : []),
  );
}

function abrirConfigColumna(c) {
  columnaEditando = c;
  $("modal-nombre").textContent = tabla.columnas[c];
  $("modal-clave").value = tabla.config[c].clave;
  $("modal-incluir").checked = tabla.config[c].incluir;
  $("modal-error").textContent = "";
  actualizarVistaModal();
  $("modal-columna").showModal();
  $("modal-clave").select();
}

$("modal-clave").oninput = actualizarVistaModal;
$("modal-incluir").onchange = actualizarVistaModal;
$("modal-cancelar").onclick = () => $("modal-columna").close();
$("modal-restablecer").onclick = () => {
  $("modal-clave").value = tabla.columnas[columnaEditando];
  $("modal-incluir").checked = true;
  $("modal-error").textContent = "";
  actualizarVistaModal();
};

$("modal-columna").onclick = (e) => {
  if (e.target === $("modal-columna")) $("modal-columna").close();
};

$("form-columna").onsubmit = (e) => {
  const clave = $("modal-clave").value.trim();
  const incluir = $("modal-incluir").checked;
  const repetida = incluir && tabla.config.some((conf, c) => c !== columnaEditando && conf.incluir && conf.clave === clave);
  const error = !clave ? "El nombre no puede quedar vacío" : repetida ? `Ya hay otra columna activa que se llama "${clave}" en el JSON` : "";
  if (error) {
    e.preventDefault();
    $("modal-error").textContent = error;
    reiniciarAnimacion($("modal-error"), "sacudir");
    return;
  }
  Object.assign(tabla.config[columnaEditando], { clave, incluir });
  pintarColumna(columnaEditando);
};

// ---------- JSON de referencia ----------

const CLAVE_REFERENCIA = "json-referencia";
const CLAVE_REFERENCIA_ACTUAL = "referencia-actual";
let referencia = { claves: [], objetos: 0, error: null };
let temporizadorReferencia = null;
let referenciasGuardadas = [];
let referenciaActual = "";
let textoGuardado = "";

function recortar(texto, largo) {
  return texto.length > largo ? texto.slice(0, largo) + "…" : texto;
}

function analizarReferencia(texto) {
  if (!texto.trim()) return { claves: [], objetos: 0, error: null };
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (e) {
    return { claves: [], objetos: 0, error: "JSON inválido: " + e.message };
  }
  const esObjeto = (v) => v && typeof v === "object" && !Array.isArray(v);
  const objetos = Array.isArray(datos) ? datos.filter(esObjeto) : esObjeto(datos) ? [datos] : [];
  if (!objetos.length) return { claves: [], objetos: 0, error: "El JSON tiene que ser un objeto o una lista de objetos" };
  const claves = new Map();
  for (const objeto of objetos) {
    for (const [clave, valor] of Object.entries(objeto)) {
      if (!claves.has(clave)) claves.set(clave, typeof valor === "string" ? valor : JSON.stringify(valor));
    }
  }
  return { claves: [...claves].map(([clave, ejemplo]) => ({ clave, ejemplo })), objetos: objetos.length, error: null };
}

function procesarReferencia() {
  const texto = $("ref-texto").value;
  localStorage.setItem(CLAVE_REFERENCIA, texto);
  referencia = analizarReferencia(texto);
  if (tabla) tabla.config.forEach((_, c) => pintarCabeceraColumna(c));
  pintarClavesReferencia();
  actualizarCambios();
}

function pintarClavesReferencia() {
  if (referencia.error) {
    mostrarEstado("ref-estado", referencia.error, "error");
    return $("ref-claves").replaceChildren();
  }
  if (!referencia.claves.length) {
    mostrarEstado("ref-estado", "");
    return $("ref-claves").replaceChildren();
  }
  let asignadas = 0;
  const filas = referencia.claves.map(({ clave, ejemplo }) => {
    const c = tabla ? tabla.config.findIndex((conf) => conf.incluir && conf.clave === clave) : -1;
    if (c >= 0) asignadas++;
    return el("div", { className: "ref-clave" },
      el("code", { textContent: clave }),
      el("span", { className: "ref-ejemplo", textContent: ejemplo, title: ejemplo }),
      el("span", {
        className: "etiqueta " + (c >= 0 ? "ref-asignada" : "ref-libre"),
        textContent: c >= 0 ? tabla.columnas[c] : "sin asignar",
        title: c >= 0 ? `Asignada a la columna "${tabla.columnas[c]}" del CSV` : "Ninguna columna activa usa esta clave",
      }),
    );
  });
  const total = referencia.claves.length;
  mostrarEstado("ref-estado",
    `${total} ${total === 1 ? "clave" : "claves"} · ${asignadas} ${asignadas === 1 ? "asignada" : "asignadas"}` +
      (referencia.objetos > 1 ? ` · ${referencia.objetos} objetos` : ""),
    asignadas === total ? "ok" : "");
  $("ref-claves").replaceChildren(...filas);
}

$("ref-texto").oninput = () => {
  mostrarEstado("ref-mensaje", "");
  clearTimeout(temporizadorReferencia);
  temporizadorReferencia = setTimeout(procesarReferencia, 300);
};

$("ref-ordenar").onclick = () => {
  try {
    $("ref-texto").value = JSON.stringify(JSON.parse($("ref-texto").value), null, 2);
    procesarReferencia();
  } catch {
    reiniciarAnimacion($("ref-estado"), "sacudir");
  }
};

$("ref-limpiar").onclick = () => {
  $("ref-texto").value = "";
  procesarReferencia();
};

// ---------- Referencias guardadas ----------

async function api(url, opciones = {}) {
  const r = await fetch(url, opciones);
  const data = await r.json();
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Error ${r.status}`);
  return data;
}

const urlReferencia = (nombre) => `/referencias/${encodeURIComponent(nombre)}`;

function normalizarJson(texto) {
  try {
    return JSON.stringify(JSON.parse(texto));
  } catch {
    return texto.trim();
  }
}

function hayCambios() {
  return normalizarJson($("ref-texto").value) !== normalizarJson(textoGuardado);
}

function actualizarCambios() {
  const sucio = hayCambios() && Boolean(referenciaActual || $("ref-texto").value.trim());
  $("ref-cambios").hidden = !sucio;
  $("ref-cambios").textContent = referenciaActual ? "Cambios sin guardar" : "Sin guardar";
}

function elegirReferencia(nombre) {
  referenciaActual = nombre;
  localStorage.setItem(CLAVE_REFERENCIA_ACTUAL, nombre);
  $("ref-lista").value = nombre;
  $("ref-eliminar").disabled = !nombre;
}

async function cargarListaReferencias() {
  referenciasGuardadas = await api("/referencias");
  $("ref-lista").replaceChildren(
    new Option("— Nueva referencia —", ""),
    ...referenciasGuardadas.map((nombre) => new Option(nombre, nombre)),
  );
  elegirReferencia(referenciasGuardadas.includes(referenciaActual) ? referenciaActual : "");
}

function validarNombre(nombre) {
  if (!nombre) return "Escribí un nombre";
  if (!/^[\p{L}\p{N}_\- ]{1,60}$/u.test(nombre)) return "Usá solo letras, números, espacios, guiones o guiones bajos (máximo 60)";
  return "";
}

function dialogoRef({ titulo, mensaje = "", conNombre = false, valor = "", aceptar = "Aceptar", peligro = false }) {
  return new Promise((resolve) => {
    const dialogo = $("modal-ref");
    // Se resuelve en la tarea siguiente: el envío del form cierra el diálogo después del submit,
    // y quien espera puede querer reabrirlo enseguida.
    const terminar = (valor) => setTimeout(() => resolve(valor));
    const cancelar = () => {
      dialogo.close();
      terminar(null);
    };
    $("modal-ref-titulo").textContent = titulo;
    $("modal-ref-mensaje").textContent = mensaje;
    $("modal-ref-mensaje").hidden = !mensaje;
    $("modal-ref-nombre").hidden = !conNombre;
    $("modal-ref-nombre").value = valor;
    $("modal-ref-error").textContent = "";
    $("modal-ref-error").hidden = !conNombre;
    $("modal-ref-aceptar").textContent = aceptar;
    $("modal-ref-aceptar").className = `btn ${peligro ? "peligro-lleno" : "primario"}`;
    $("form-ref").onsubmit = (e) => {
      const nombre = $("modal-ref-nombre").value.trim();
      const error = conNombre ? validarNombre(nombre) : "";
      if (error) {
        e.preventDefault();
        $("modal-ref-error").textContent = error;
        reiniciarAnimacion($("modal-ref-error"), "sacudir");
        return;
      }
      terminar(conNombre ? nombre : true);
    };
    $("modal-ref-cancelar").onclick = cancelar;
    dialogo.onclick = (e) => {
      if (e.target === dialogo) cancelar();
    };
    dialogo.onclose = () => {
      if (!dialogo.open) terminar(null);
    };
    dialogo.showModal();
    if (conNombre) $("modal-ref-nombre").select();
  });
}

async function confirmarDescarte() {
  if (!$("ref-cambios").hidden) {
    return dialogoRef({
      titulo: "Descartar cambios",
      mensaje: `Hay cambios sin guardar${referenciaActual ? ` en "${referenciaActual}"` : ""}. ¿Querés descartarlos?`,
      aceptar: "Descartar",
      peligro: true,
    });
  }
  return true;
}

async function abrirReferencia(nombre) {
  try {
    const texto = nombre ? JSON.stringify(await api(urlReferencia(nombre)), null, 2) : "";
    textoGuardado = texto;
    $("ref-texto").value = texto;
    elegirReferencia(nombre);
    procesarReferencia();
    mostrarEstado("ref-mensaje", "");
  } catch (e) {
    mostrarEstado("ref-mensaje", e.message, "error");
  }
}

async function guardarReferencia(nombre) {
  let datos;
  try {
    datos = JSON.parse($("ref-texto").value);
  } catch {
    mostrarEstado("ref-mensaje", "No se puede guardar: el JSON no es válido", "error");
    return reiniciarAnimacion($("ref-mensaje"), "sacudir");
  }
  try {
    await api(urlReferencia(nombre), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    textoGuardado = $("ref-texto").value;
    referenciaActual = nombre;
    await cargarListaReferencias();
    actualizarCambios();
    mostrarEstado("ref-mensaje", `Guardada como "${nombre}"`, "ok");
  } catch (e) {
    mostrarEstado("ref-mensaje", e.message, "error");
  }
}

async function guardarNueva() {
  const nombre = await dialogoRef({
    titulo: "Guardar referencia",
    mensaje: "Elegí un nombre para esta referencia.",
    conNombre: true,
    aceptar: "Guardar",
  });
  if (!nombre) return;
  const existente = referenciasGuardadas.find((n) => n.toLowerCase() === nombre.toLowerCase());
  if (existente) {
    const reemplazar = await dialogoRef({
      titulo: "Reemplazar referencia",
      mensaje: `Ya existe una referencia llamada "${existente}". ¿Querés reemplazarla?`,
      aceptar: "Reemplazar",
      peligro: true,
    });
    if (!reemplazar) return;
  }
  await guardarReferencia(existente ?? nombre);
}

$("ref-lista").onchange = async () => {
  const nombre = $("ref-lista").value;
  if (!(await confirmarDescarte())) {
    $("ref-lista").value = referenciaActual;
    return;
  }
  await abrirReferencia(nombre);
};

$("ref-guardar").onclick = () => (referenciaActual ? guardarReferencia(referenciaActual) : guardarNueva());

$("ref-eliminar").onclick = async () => {
  const nombre = referenciaActual;
  if (!nombre) return;
  const confirmar = await dialogoRef({
    titulo: "Eliminar referencia",
    mensaje: `¿Eliminar "${nombre}"? El JSON queda en el cuadro, sin guardar, por si lo necesitás.`,
    aceptar: "Eliminar",
    peligro: true,
  });
  if (!confirmar) return;
  try {
    await api(urlReferencia(nombre), { method: "DELETE" });
    textoGuardado = "";
    referenciaActual = "";
    await cargarListaReferencias();
    actualizarCambios();
    mostrarEstado("ref-mensaje", `Se eliminó "${nombre}"`, "ok");
  } catch (e) {
    mostrarEstado("ref-mensaje", e.message, "error");
  }
};

async function iniciarReferencias() {
  referenciaActual = localStorage.getItem(CLAVE_REFERENCIA_ACTUAL) ?? "";
  $("ref-texto").value = localStorage.getItem(CLAVE_REFERENCIA) ?? "";
  procesarReferencia();
  try {
    await cargarListaReferencias();
    if (referenciaActual) textoGuardado = JSON.stringify(await api(urlReferencia(referenciaActual)), null, 2);
  } catch (e) {
    mostrarEstado("ref-mensaje", e.message, "error");
  }
  actualizarCambios();
}

iniciarReferencias();

// ---------- Configuración: reglas ----------

const CLAVE_REGLA_ABIERTA = "regla-abierta";
const PLANTILLA_REGLA = `Convertí el texto que recibas a HTML.

Reglas:
- Devolvé solo el HTML, sin explicaciones ni bloques de código.
- No inventes contenido: usá únicamente el texto recibido.
`;

let reglaActual = "";
let reglaGuardada = "";

const urlRegla = (nombre) => `/reglas/${encodeURIComponent(nombre)}`;
const hayCambiosRegla = () => Boolean(reglaActual) && $("regla-texto").value !== reglaGuardada;
const existeRegla = (nombre, salvo = "") =>
  reglas.find((r) => r !== salvo && r.toLowerCase() === nombre.toLowerCase());

function pintarListaReglas() {
  const lista = $("lista-reglas");
  lista.replaceChildren(
    ...reglas.map((nombre) => {
      const boton = el("button", { className: "item-regla", type: "button", title: nombre },
        el("span", { className: "item-nombre", textContent: nombre }));
      boton.dataset.nombre = nombre;
      boton.setAttribute("aria-current", String(nombre === reglaActual));
      boton.onclick = () => elegirRegla(nombre);
      return boton;
    }),
  );
  if (!reglas.length) lista.append(el("p", { className: "ayuda lista-vacia", textContent: "Todavía no hay reglas." }));
  actualizarCambiosRegla();
}

function actualizarCambiosRegla() {
  const cambios = hayCambiosRegla();
  $("regla-cambios").hidden = !cambios;
  $("regla-descartar").hidden = !cambios;
  $("regla-guardar").disabled = !cambios;
  for (const item of document.querySelectorAll(".item-regla")) {
    item.classList.toggle("con-cambios", cambios && item.dataset.nombre === reglaActual);
  }
  const texto = $("regla-texto").value;
  const lineas = texto ? texto.split("\n").length : 0;
  $("regla-info").textContent = `${lineas} ${lineas === 1 ? "línea" : "líneas"} · ${texto.length} caracteres`;
}

function mostrarEditorRegla() {
  $("regla-vacia").hidden = Boolean(reglaActual);
  $("regla-panel").hidden = !reglaActual;
  $("regla-titulo").textContent = reglaActual;
  if (reglaActual) localStorage.setItem(CLAVE_REGLA_ABIERTA, reglaActual);
  else localStorage.removeItem(CLAVE_REGLA_ABIERTA);
  pintarListaReglas();
}

async function abrirRegla(nombre) {
  try {
    const { contenido } = await api(urlRegla(nombre));
    reglaActual = nombre;
    reglaGuardada = contenido;
    $("regla-texto").value = contenido;
    mostrarEditorRegla();
  } catch (e) {
    mostrarEstado("regla-estado", e.message, "error");
  }
}

async function confirmarDescarteRegla() {
  if (!hayCambiosRegla()) return true;
  return dialogoRef({
    titulo: "Descartar cambios",
    mensaje: `Hay cambios sin guardar en "${reglaActual}". ¿Querés descartarlos?`,
    aceptar: "Descartar",
    peligro: true,
  });
}

async function elegirRegla(nombre) {
  if (nombre === reglaActual || !(await confirmarDescarteRegla())) return;
  mostrarEstado("regla-estado", "");
  await abrirRegla(nombre);
}

async function guardarRegla() {
  if (!hayCambiosRegla()) return;
  const contenido = $("regla-texto").value;
  if (!contenido.trim()) {
    mostrarEstado("regla-estado", "La regla no puede quedar vacía", "error");
    return;
  }
  try {
    await api(urlRegla(reglaActual), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contenido }),
    });
    reglaGuardada = contenido;
    actualizarCambiosRegla();
    mostrarEstado("regla-estado", `Se guardó "${reglaActual}"`, "ok");
  } catch (e) {
    mostrarEstado("regla-estado", e.message, "error");
  }
}

$("regla-texto").oninput = actualizarCambiosRegla;
$("regla-texto").onkeydown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    guardarRegla();
  }
};
$("regla-guardar").onclick = guardarRegla;
$("regla-descartar").onclick = () => {
  $("regla-texto").value = reglaGuardada;
  actualizarCambiosRegla();
};

$("regla-nueva").onclick = async () => {
  if (!(await confirmarDescarteRegla())) return;
  const nombre = await dialogoRef({
    titulo: "Nueva regla",
    mensaje: "Elegí un nombre. Se guarda como un archivo .md en la carpeta rules/.",
    conNombre: true,
    aceptar: "Crear",
  });
  if (!nombre) return;
  const existente = existeRegla(nombre);
  if (existente) {
    mostrarEstado("regla-estado", `Ya existe una regla llamada "${existente}"`, "error");
    return;
  }
  try {
    await api(urlRegla(nombre), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contenido: PLANTILLA_REGLA }),
    });
    await cargarReglas();
    await abrirRegla(nombre);
    $("regla-texto").focus();
    mostrarEstado("regla-estado", `Se creó "${nombre}"`, "ok");
  } catch (e) {
    mostrarEstado("regla-estado", e.message, "error");
  }
};

$("regla-renombrar").onclick = async () => {
  const anterior = reglaActual;
  const nombre = await dialogoRef({
    titulo: "Renombrar regla",
    mensaje: "Las columnas que usaban esta regla pasan a usar el nombre nuevo.",
    conNombre: true,
    valor: anterior,
    aceptar: "Renombrar",
  });
  if (!nombre || nombre === anterior) return;
  const existente = existeRegla(nombre, anterior);
  if (existente) {
    mostrarEstado("regla-estado", `Ya existe una regla llamada "${existente}"`, "error");
    return;
  }
  try {
    await api(`${urlRegla(anterior)}/renombrar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nuevo: nombre }),
    });
    reglaActual = nombre;
    await cargarReglas({ de: anterior, a: nombre });
    mostrarEditorRegla();
    mostrarEstado("regla-estado", `"${anterior}" ahora se llama "${nombre}"`, "ok");
  } catch (e) {
    mostrarEstado("regla-estado", e.message, "error");
  }
};

$("regla-eliminar").onclick = async () => {
  const nombre = reglaActual;
  const confirmar = await dialogoRef({
    titulo: "Eliminar regla",
    mensaje: `¿Eliminar "${nombre}"? Se borra el archivo rules/${nombre}.md y no se puede deshacer.`,
    aceptar: "Eliminar",
    peligro: true,
  });
  if (!confirmar) return;
  try {
    await api(urlRegla(nombre), { method: "DELETE" });
    reglaActual = "";
    reglaGuardada = "";
    $("regla-texto").value = "";
    await cargarReglas();
    mostrarEditorRegla();
    mostrarEstado("regla-estado", `Se eliminó "${nombre}"`, "ok");
  } catch (e) {
    mostrarEstado("regla-estado", e.message, "error");
  }
};

window.addEventListener("beforeunload", (e) => {
  if (hayCambiosRegla()) e.preventDefault();
});

async function iniciarReglas() {
  try {
    await cargarReglas();
  } catch (e) {
    mostrarEstado("regla-estado", e.message, "error");
    return;
  }
  const guardada = localStorage.getItem(CLAVE_REGLA_ABIERTA);
  if (reglas.includes(guardada)) await abrirRegla(guardada);
  else if (reglas.length) await abrirRegla(reglas[0]);
  else mostrarEditorRegla();
}

$("regla-general").onchange = programarGuardado;

// ---------- Configuración: modelo ----------

let modeloGuardado = "";

function actualizarBotonModelo() {
  $("modelo-guardar").disabled = !$("modelo").value || $("modelo").value === modeloGuardado;
}

async function cargarModelos() {
  try {
    const { modelo, modelos, ollama } = await api("/config");
    const lista = modelos.includes(modelo) ? modelos : [modelo, ...modelos];
    $("modelo").replaceChildren(...lista.map((m) => new Option(m, m)));
    $("modelo").value = modeloGuardado = modelo;
    if (!ollama) mostrarEstado("modelo-estado", "No se pudo conectar con Ollama: no se ven los modelos instalados", "error");
    else if (!modelos.includes(modelo)) mostrarEstado("modelo-estado", `"${modelo}" no está instalado en Ollama`, "error");
    else mostrarEstado("modelo-estado", `${modelos.length} ${modelos.length === 1 ? "modelo instalado" : "modelos instalados"}`);
  } catch (e) {
    mostrarEstado("modelo-estado", e.message, "error");
  }
  actualizarBotonModelo();
}

$("modelo").onchange = actualizarBotonModelo;
$("modelo-actualizar").onclick = cargarModelos;
$("modelo-guardar").onclick = async () => {
  const modelo = $("modelo").value;
  try {
    await api("/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelo }),
    });
    modeloGuardado = modelo;
    actualizarBotonModelo();
    mostrarEstado("modelo-estado", `Ahora se usa "${modelo}"`, "ok");
  } catch (e) {
    mostrarEstado("modelo-estado", e.message, "error");
  }
};

cargarModelos();
iniciarReglas().then(recuperarSesion);
