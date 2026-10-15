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
  if (cambioTipo && texto) reiniciarAnimacion(nodo, "aparecer");
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
  reiniciarAnimacion($(panel), "aparecer");
  localStorage.setItem("tab", panel);
}

for (const tab of tabs) tab.onclick = () => activarTab(tab.dataset.panel);
activarTab(["panel-csv", "panel-config"].includes(localStorage.getItem("tab")) ? localStorage.getItem("tab") : "panel-texto", false);
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
    reiniciarAnimacion($("salida"), "aparecer");
    reiniciarAnimacion($("vista"), "aparecer");
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

function reglaDeColumna(c) {
  return tabla.selects[c].value || $("regla-general").value;
}

function pintarCelda(celda) {
  const verCodigo = $("ver-codigo").getAttribute("aria-pressed") === "true";
  const contenido = el("div", { className: "contenido" });
  if (celda.html != null && !verCodigo) {
    contenido.classList.add("html");
    contenido.innerHTML = celda.html;
  } else if (celda.html != null) {
    contenido.classList.add("codigo");
    contenido.textContent = celda.html;
  } else {
    contenido.textContent = celda.original;
  }

  const pie = el("div", { className: "pie" });
  const etiqueta = etiquetaCelda(celda);
  if (etiqueta) pie.append(etiqueta);

  if (celda.original.trim()) {
    const formatear = el("button", { className: "btn chico", textContent: "Formatear", title: "Formatear esta celda con la regla de su columna" });
    formatear.onclick = () => formatearCeldas([celda]);
    pie.append(formatear);
  }
  if (celda.html != null) {
    const original = el("button", { className: "btn chico", textContent: "Original", title: "Volver al texto original" });
    original.onclick = () => {
      Object.assign(celda, { html: null, regla: null, estado: null });
      pintarCelda(celda);
    };
    pie.append(original);
  }

  celda.td.classList.toggle("trabajando", celda.estado === "trabajando");
  celda.td.classList.toggle("excluida", !tabla.config[celda.columna].incluir);
  celda.td.replaceChildren(contenido, pie);
  celda.td.querySelectorAll("button").forEach((b) => (b.disabled = ocupado));
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

function abrirCelda(celda) {
  celdaAbierta = celda;
  const verCodigo = $("ver-codigo").getAttribute("aria-pressed") === "true";
  modoCelda = celda.html == null ? "original" : verCodigo ? "codigo" : "vista";
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
  $("celda-etiqueta").replaceChildren(etiquetaCelda(celda) ?? "");

  for (const boton of document.querySelectorAll("#celda-vistas .subtab")) {
    boton.setAttribute("aria-selected", String(boton.dataset.modo === modoCelda));
    boton.disabled = boton.dataset.modo !== "original" && !tieneHtml;
  }

  const cuerpo = $("celda-cuerpo");
  const texto = modoCelda === "original" ? celda.original : celda.html;
  cuerpo.className = `celda-cuerpo ${modoCelda}`;
  if (!texto.trim()) {
    cuerpo.classList.add("vacia");
    cuerpo.textContent = "La celda está vacía";
  } else if (modoCelda === "vista") {
    cuerpo.innerHTML = celda.html;
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
  Object.assign(celdaAbierta, { html: null, regla: null, estado: null, error: null });
  pintarCelda(celdaAbierta);
};

$("celda-formatear").onclick = () => formatearCeldas([celdaAbierta]);
$("celda-cerrar").onclick = () => $("modal-celda").close();

$("modal-celda").onclick = (e) => {
  if (e.target === $("modal-celda")) $("modal-celda").close();
};
$("modal-celda").onclose = () => {
  celdaAbierta = null;
};
$("modal-celda").onkeydown = (e) => {
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
  const columnas = tabla.config.filter((conf) => conf.incluir).length;
  $("todas-filas").checked = filas === total;
  $("todas-filas").indeterminate = filas > 0 && filas < total;
  $("contador-filas").textContent = `${filas}/${total}`;
  $("contador-columnas").textContent = `${columnas}/${tabla.config.length}`;
  const ocultando = $("ocultar-excluidas").getAttribute("aria-pressed") === "true";
  $("contador-ocultas").textContent = total - filas;
  $("contador-ocultas").hidden = !ocultando || filas === total;
  programarVistaJson();
  programarGuardado();
}

// `valor` puede ser un booleano o una función que recibe el estado actual (para invertir)
function cambiarFilas(indices, valor) {
  for (const f of indices) {
    tabla.filas[f].incluir = typeof valor === "function" ? valor(tabla.filas[f].incluir) : valor;
    pintarFila(f);
  }
  actualizarSeleccion();
}

function cambiarColumnas(indices, valor) {
  for (const c of indices) {
    const nuevo = typeof valor === "function" ? valor(tabla.config[c].incluir) : valor;
    if (nuevo === tabla.config[c].incluir) continue;
    tabla.config[c].incluir = nuevo;
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
    const valor = !tabla.filas[f].incluir;
    cambiarFilas(e.shiftKey && ultimaFila != null ? rango(ultimaFila, f) : [f], valor);
    ultimaFila = f;
    arrastre = { valor, ultima: f };
    $("contenedor-csv").classList.add("arrastrando");
    // En pantallas táctiles el puntero queda capturado y no llegarían los pointerenter de las otras filas
    if (td.hasPointerCapture(e.pointerId)) td.releasePointerCapture(e.pointerId);
  };
  td.onpointerenter = () => {
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
  for (const fila of tabla.celdas) pintarCelda(fila[c]);
  actualizarSeleccion();
}

const ICONO_ENGRANAJE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;

function mostrarTabla(data, nombreArchivo) {
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
  const [todas, interruptorTodas] = interruptorChico(
    (valor) => cambiarFilas(tabla.filas.map((_, f) => f), valor),
    "Incluir todas las filas en el JSON",
  );
  todas.id = "todas-filas";
  const filaCabecera = el("tr", {}, el("th", { className: "col-fila" }, interruptorTodas, el("div", { className: "clave-json", textContent: "Filas" })));

  data.columnas.forEach((nombre, c) => {
    const select = el("select", { title: "Regla para esta columna" });
    select.add(new Option("Regla general", ""));
    for (const r of reglas) select.add(new Option(r, r));
    select.onchange = programarGuardado;
    tabla.selects.push(select);

    const boton = el("button", {
      className: "btn chico",
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
    tabla.config.push({ incluir: true, clave: nombre, th, interruptor });
    filaCabecera.append(th);
  });
  $("cabecera-csv").replaceChildren(filaCabecera);

  const filas = data.filas.map((valores, i) => {
    const [interruptor, etiqueta] = interruptorChico((valor) => {
      cambiarFilas([i], valor);
      ultimaFila = i;
    }, "Incluir esta fila en el JSON");
    const tr = el("tr", { className: "aparecer" },
      celdaDeFila(i, etiqueta, el("div", { className: "num-fila", textContent: i + 1 })));
    tr.style.animationDelay = `${Math.min(i, 15) * 40}ms`;
    tr.addEventListener("animationend", (e) => {
      if (e.target === tr) tr.classList.remove("aparecer");
    });
    tabla.filas.push({ incluir: true, tr, interruptor });
    tabla.celdas.push(data.columnas.map((_, c) => {
      const td = el("td", { className: "celda" });
      tr.append(td);
      const celda = { original: valores[c] ?? "", html: null, regla: null, estado: null, error: null, td, fila: i, columna: c };
      td.onclick = (e) => {
        // Si el usuario estaba seleccionando texto, no abrir el visor
        if (e.target.closest("button") || getSelection().toString()) return;
        abrirCelda(celda);
      };
      return celda;
    }));
    return tr;
  });
  $("cuerpo-csv").replaceChildren(...filas);

  data.columnas.forEach((_, c) => pintarColumna(c));
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
  $("controles-csv").hidden = false;
  $("contenedor-csv").hidden = false;
  reiniciarAnimacion($("controles-csv"), "aparecer");
  reiniciarAnimacion($("contenedor-csv"), "aparecer");
  mostrarEstado("estado-csv", "");
}

for (const boton of document.querySelectorAll("[data-seleccion]")) {
  boton.onclick = () => {
    const valor = { todas: true, ninguna: false, invertir: (actual) => !actual }[boton.dataset.accion];
    if (boton.dataset.seleccion === "filas") cambiarFilas(tabla.filas.map((_, f) => f), valor);
    else cambiarColumnas(tabla.config.map((_, c) => c), valor);
  };
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
}

function avanzar(hechas, total) {
  $("progreso-barra").style.width = `${(hechas / total) * 100}%`;
}

async function formatearCeldas(celdas) {
  if (ocupado) return;
  const pendientes = celdas.filter((c) => c.original.trim());
  if (!pendientes.length) return mostrarEstado("estado-csv", "No hay celdas con texto para formatear", "error");

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
        Object.assign(celda, { regla, estado: null, error: null });
        reiniciarAnimacion(celda.td, "recien");
        setTimeout(() => celda.td.classList.remove("recien"), 1200);
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
    if (cancelar) {
      mostrarEstado("estado-csv", `Detenido: ${hechas} de ${pendientes.length} celdas procesadas`);
    } else if (errores) {
      mostrarEstado("estado-csv", `${hechas} celdas procesadas, ${errores} con error`, "error");
    } else {
      mostrarEstado("estado-csv", `Listo: ${hechas} ${hechas === 1 ? "celda formateada" : "celdas formateadas"}`, "ok");
    }
  } catch (e) {
    mostrarEstado("estado-csv", e.message, "error");
  } finally {
    bloquear(false);
    pintarTodo();
  }
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
      .map(({ fila, columna, html, regla }) => ({ fila, columna, html, regla })),
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
    mostrarTabla({ columnas: sesion.columnas, filas: sesion.filas, separador: sesion.separador }, sesion.nombreArchivo);
    if (reglas.includes(sesion.reglaGeneral)) $("regla-general").value = sesion.reglaGeneral;
    sesion.config.forEach(({ incluir, clave, regla }, c) => {
      Object.assign(tabla.config[c], { incluir, clave });
      if (reglas.includes(regla)) tabla.selects[c].value = regla;
    });
    sesion.filasIncluidas.forEach((incluir, f) => (tabla.filas[f].incluir = incluir));
    for (const { fila, columna, html, regla } of sesion.formateadas) {
      Object.assign(tabla.celdas[fila][columna], { html, regla });
    }
    tabla.columnas.forEach((_, c) => pintarColumna(c));
    tabla.filas.forEach((_, f) => pintarFila(f));
    actualizarSeleccion();
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
  if (tabla) pintarTodo();
};

$("restaurar").onclick = () => {
  for (const celda of tabla.celdas.flat()) Object.assign(celda, { html: null, regla: null, estado: null, error: null });
  pintarTodo();
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
  if (estabaCerrado) reiniciarAnimacion($("cajon-json"), "entrar-cajon");
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
    reiniciarAnimacion($("regla-panel"), "aparecer");
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
