import difflib
import re
import unicodedata
from html import escape, unescape
from html.parser import HTMLParser

# Se quitan junto con todo lo que tienen adentro
CON_CONTENIDO = {"script", "style", "iframe", "object", "applet", "noscript", "template", "head", "title", "svg", "math", "frameset"}
# Se quita la etiqueta pero se conserva el texto de adentro
ENVOLTORIOS = {"html", "body", "form", "button", "select", "option", "textarea", "label"}
# Etiquetas sin cierre que se descartan
VACIAS = {"meta", "link", "base", "input", "embed", "frame", "param", "source", "track"}

ATRIBUTOS_URL = {"href", "src", "action", "formaction", "xlink:href", "background", "poster", "cite", "data"}
ESQUEMA_PELIGROSO = re.compile(r"(javascript|vbscript|data):", re.I)
IMAGEN_EMBEBIDA = re.compile(r"data:image/(png|gif|jpe?g|webp);", re.I)
ESTILO_PELIGROSO = re.compile(r"expression\s*\(|javascript:|behavior\s*:", re.I)
BLOQUE_CODIGO = re.compile(r"^```[\w-]*\s*\n?(.*?)\n?```$", re.S)

ENCABEZADO = re.compile(r"<(h[1-6])\b[^>]*>(.*?)</\1>[ \t]*\n?", re.S | re.I)
PRIMER_PARRAFO = re.compile(r"<p\b[^>]*>", re.I)
# Un título de verdad es corto; con más palabras es un párrafo que el modelo envolvió en <hN>
MAX_PALABRAS_TITULO = 15
# Tolera que el modelo corrija una errata en el título sin darlo por inventado
PARECIDO_MINIMO = 0.85

PALABRA = re.compile(r"[^\W_]+")
ENTIDAD = re.compile(r"&(?:#\d+|#x[0-9a-f]+|\w+);", re.I)
ETIQUETA = re.compile(r"<(/?)([a-zA-Z][\w-]*)\b[^>]*>")
MARCA_LISTA = re.compile(r"^[ \t]*(?:[-–•*·]|\d{1,2}[.)])[ \t]+", re.M)
# Una palabra casi igual a la original es una errata del modelo ("Amisión" por "Admisión")
PARECIDO_ERRATA = 0.8
# Una línea perdida así de corta y sin punto final es un título (si no era un ítem de lista)
MAX_PALABRAS_TITULO_PERDIDO = 6
PRIMER_ENCABEZADO = re.compile(r"<(h[1-6])\b", re.I)
# Para dar una línea perdida por presente en otro lugar del HTML: con menos palabras tiene que ser un
# bloque entero ("Específicas:" no está solo porque "específicas" aparezca dentro de otra oración)
MIN_PALABRAS_SUBCADENA = 5
SEPARADOR_BLOQUES = re.compile(r"</?(?:p|li|h[1-6]|ul|ol|div|blockquote|td|th|br)\b[^>]*>", re.I)
LISTAS = {"ul", "ol"}
# Bloques que no pueden ir sueltos dentro de <ul>/<ol> (solo dentro de un <li>)
FUERA_DE_LISTA = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote", "div", "pre"}
CIERRE_BLOQUE = re.compile(r"</(?:p|ul|ol|h[1-6]|table|blockquote|div|pre)>", re.I)
# Rótulos inventados en negrita ("<strong>Requisito N°1:</strong>"): la apertura justo antes y el cierre justo después
APERTURA_DESTACADO = re.compile(r"<(strong|b|em)\b[^>]*>\s*$", re.I)
CIERRE_DESTACADO = re.compile(r"[^<\w]*</(strong|b|em)>[ \t]*", re.I)
# El mismo rótulo sin negrita: palabras inventadas al comienzo de un ítem o párrafo, terminadas en ":"
INICIO_BLOQUE = re.compile(r"<(?:li|p)\b[^>]*>\s*$", re.I)
DOS_PUNTOS = re.compile(r"[ \t]*:[ \t]*")
MAX_PALABRAS_ROTULO = 6


class _Limpiador(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.partes: list[str] = []
        self.saltando = 0

    def _abrir(self, tag: str, attrs: list[tuple[str, str | None]], autocierre: str) -> str:
        limpios = []
        for nombre, valor in attrs:
            if nombre.startswith("on") or nombre == "srcdoc":
                continue
            if valor is None:
                limpios.append(f" {nombre}")
                continue
            # Los navegadores ignoran espacios y saltos dentro de las URL ("java\tscript:" sigue siendo javascript:)
            compacto = re.sub(r"[\x00-\x20]", "", valor)
            if nombre in ATRIBUTOS_URL and ESQUEMA_PELIGROSO.match(compacto):
                if not (nombre == "src" and IMAGEN_EMBEBIDA.match(compacto)):
                    continue
            if nombre == "style" and ESTILO_PELIGROSO.search(compacto):
                continue
            limpios.append(f' {nombre}="{escape(valor, quote=True)}"')
        return f"<{tag}{''.join(limpios)}{autocierre}>"

    def _visible(self, tag: str) -> bool:
        return not self.saltando and tag not in VACIAS and tag not in ENVOLTORIOS and tag not in CON_CONTENIDO

    def handle_starttag(self, tag, attrs):
        if tag in CON_CONTENIDO:
            self.saltando += 1
        elif self._visible(tag):
            self.partes.append(self._abrir(tag, attrs, ""))

    def handle_startendtag(self, tag, attrs):
        if self._visible(tag):
            self.partes.append(self._abrir(tag, attrs, " /"))

    def handle_endtag(self, tag):
        if tag in CON_CONTENIDO:
            self.saltando = max(0, self.saltando - 1)
        elif self._visible(tag):
            self.partes.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.saltando:
            self.partes.append(data)

    def handle_entityref(self, name):
        if not self.saltando:
            self.partes.append(f"&{name};")

    def handle_charref(self, name):
        if not self.saltando:
            self.partes.append(f"&#{name};")


def quitar_bloque_codigo(texto: str) -> str:
    texto = texto.strip()
    bloque = BLOQUE_CODIGO.match(texto)
    return bloque.group(1).strip() if bloque else texto


def limpiar_html(html: str) -> str:
    """Quita lo que el modelo agrega de más (bloques ```, <html>, <head>, <body>) y todo lo que
    pueda ejecutar código (scripts, iframes, atributos on..., enlaces javascript:)."""
    limpiador = _Limpiador()
    limpiador.feed(quitar_bloque_codigo(html))
    limpiador.close()
    return "".join(limpiador.partes).strip()


def _normalizar(texto: str) -> str:
    texto = unescape(re.sub(r"<[^>]+>", "", texto))
    texto = unicodedata.normalize("NFD", texto.lower())
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    texto = re.sub(r"^[\s#*\-•\d.)]+", "", texto)
    return re.sub(r"\s+", " ", texto).strip(" :.;*")


def corregir_titulos(html: str, original: str) -> str:
    """Los modelos tienden a inventar títulos para "ordenar" el texto. Un encabezado se conserva
    solo si es una línea que ya estaba en el original; si es una oración larga pasa a párrafo,
    y si no estaba en el original se quita."""
    lineas = {_normalizar(linea) for linea in original.splitlines()} - {""}
    parrafo = PRIMER_PARRAFO.search(html)
    apertura = parrafo.group(0) if parrafo else "<p>"

    def revisar(m: re.Match) -> str:
        contenido = m.group(2).strip()
        texto = _normalizar(contenido)
        if len(texto.split()) > MAX_PALABRAS_TITULO or re.search(r"[.!?]\s*$", unescape(re.sub(r"<[^>]+>", "", contenido))):
            return f"{apertura}{contenido}</p>\n"
        if texto in lineas or any(difflib.SequenceMatcher(None, texto, l).ratio() >= PARECIDO_MINIMO for l in lineas):
            return m.group(0)
        return ""

    return ENCABEZADO.sub(revisar, html).strip()


def cerrar_listas(html: str) -> str:
    """Los modelos a veces meten párrafos dentro de <ul> sin <li> o no cierran la lista.
    Se cierra la lista antes de ese bloque y se descarta el cierre que sobra después."""
    salida: list[str] = []
    abiertas: list[str] = []
    pos = 0
    for m in ETIQUETA.finditer(html):
        salida.append(html[pos:m.start()])
        pos = m.end()
        cierre, tag = m.group(1), m.group(2).lower()
        if not cierre and tag in FUERA_DE_LISTA:
            while abiertas and abiertas[-1] in LISTAS:
                salida.append(f"</{abiertas.pop()}>\n")
        if tag in LISTAS or tag == "li":
            if not cierre:
                abiertas.append(tag)
            elif tag in abiertas:
                while abiertas.pop() != tag:
                    pass
            else:
                continue
        salida.append(m.group(0))
    salida.append(html[pos:])
    salida.extend(f"\n</{tag}>" for tag in reversed(abiertas))
    return "".join(salida).strip()


def _sin_tildes(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")


def _palabras_html(html: str) -> list[tuple[str, int, int]]:
    """(palabra, inicio, fin) de cada palabra del texto visible, con su posición en el HTML."""
    palabras = []
    for m in re.finditer(r"<[^>]*>|[^<]+", html):
        if m.group(0).startswith("<"):
            continue
        # Las entidades (&amp;) no son palabras: se tapan sin mover las posiciones
        texto = ENTIDAD.sub(lambda e: " " * len(e.group(0)), m.group(0))
        palabras.extend((p.group(0), m.start() + p.start(), m.start() + p.end()) for p in PALABRA.finditer(texto))
    return palabras


def _como_la_generada(original: str, generada: str) -> str:
    if generada.isupper() and len(generada) > 1:
        return original.upper()
    if generada[0].isupper():
        return original[0].upper() + original[1:]
    return original


def _tildes(texto: str) -> int:
    return len(unicodedata.normalize("NFD", texto)) - len(_sin_tildes(texto))


def _es_errata(original: str, generada: str) -> bool:
    o, g = _sin_tildes(original.lower()), _sin_tildes(generada.lower())
    if o == g:
        # Solo cambian tildes: si el modelo las agregó es una corrección; si las quitó, una errata
        return _tildes(generada) < _tildes(original)
    return min(len(o), len(g)) >= 4 and difflib.SequenceMatcher(None, o, g).ratio() >= PARECIDO_ERRATA


def restaurar_texto(html: str, original: str) -> str:
    """Repara lo que el modelo copió mal del original: palabras con erratas vuelven a su forma
    original, las frases que se saltó dentro de un párrafo se reponen y las líneas completas
    que se saltó se reinsertan en su lugar (como título si son cortas y sin punto final)."""
    lineas_originales = MARCA_LISTA.sub("", original).splitlines()
    # (palabra, línea, inicio y fin dentro de la línea)
    originales = [(p.group(0), n, p.start(), p.end())
                  for n, linea in enumerate(lineas_originales) for p in PALABRA.finditer(linea)]
    generadas = _palabras_html(html)
    comparacion = difflib.SequenceMatcher(
        None, [o[0].lower() for o in originales], [g[0].lower() for g in generadas], autojunk=False)
    texto_generado = _normalizar(html)
    bloques_generados = {_normalizar(b) for b in SEPARADOR_BLOQUES.split(html)} - {""}

    def ya_esta(n: int) -> bool:
        linea = _normalizar(lineas_originales[n])
        if linea in bloques_generados:
            return True
        return len(linea.split()) >= MIN_PALABRAS_SUBCADENA and linea in texto_generado

    parrafo = PRIMER_PARRAFO.search(html)
    apertura = parrafo.group(0) if parrafo else "<p>"
    encabezado = PRIMER_ENCABEZADO.search(html)
    nivel_titulo = encabezado.group(1).lower() if encabezado else "h2"
    items_de_lista = {n for n, linea in enumerate(original.splitlines()) if MARCA_LISTA.match(linea)}

    def es_titulo(n: int) -> bool:
        linea = lineas_originales[n].strip()
        return (n not in items_de_lista and not re.search(r"[.:;!?]$", linea)
                and len(PALABRA.findall(linea)) <= MAX_PALABRAS_TITULO_PERDIDO)

    def contenido(n: int) -> str:
        return escape(re.sub(r"\s+", " ", lineas_originales[n]).strip(), quote=False)

    def dentro_de_item(pos: int) -> int:
        """Posición del <li> que contiene a `pos`, o -1."""
        inicio = html.rfind("<li", 0, pos)
        return inicio if inicio != -1 and html.find("</li>", inicio, pos) == -1 else -1

    palabras_por_linea: dict[int, int] = {}
    for o in originales:
        palabras_por_linea[o[1]] = palabras_por_linea.get(o[1], 0) + 1

    cambios: list[tuple[int, int, str]] = []
    for op, i1, i2, j1, j2 in comparacion.get_opcodes():
        if op == "insert":
            # Palabras que no están en el original y forman un destacado entero: un rótulo inventado
            desde, hasta = generadas[j1][1], generadas[j2 - 1][2]
            apertura_destacado = APERTURA_DESTACADO.search(html, max(0, desde - 60), desde)
            cierre_destacado = CIERRE_DESTACADO.match(html, hasta)
            if (apertura_destacado and cierre_destacado
                    and apertura_destacado.group(1).lower() == cierre_destacado.group(1).lower()):
                cambios.append((apertura_destacado.start(), cierre_destacado.end(), ""))
            elif j2 - j1 <= MAX_PALABRAS_ROTULO and INICIO_BLOQUE.search(html, max(0, desde - 80), desde):
                dos_puntos = DOS_PUNTOS.match(html, hasta)
                if dos_puntos:
                    cambios.append((desde, dos_puntos.end(), ""))
            continue
        if op != "replace" and op != "delete":
            continue
        hueco = originales[i1:i2]

        # Frase salteada en medio de una línea: se repone el tramo original entre las palabras vecinas,
        # siempre que en el HTML esas vecinas estén en el mismo bloque (sin etiquetas entre ellas)
        if op == "delete" and 0 < i1 and i2 < len(originales) and 0 < j1 < len(generadas):
            previa, siguiente = originales[i1 - 1], originales[i2]
            if previa[1] == siguiente[1] and all(o[1] == previa[1] for o in hueco):
                desde, hasta = generadas[j1 - 1][2], generadas[j1][1]
                if "<" not in html[desde:hasta]:
                    tramo = re.sub(r"\s+", " ", lineas_originales[previa[1]][previa[3]:siguiente[2]])
                    cambios.append((desde, hasta, escape(tramo, quote=False)))
                    continue

        # Líneas del original que faltan enteras (en un mismo hueco puede haber además una errata)
        en_hueco: dict[int, int] = {}
        for o in hueco:
            en_hueco[o[1]] = en_hueco.get(o[1], 0) + 1
        # Las líneas sin letras (numeraciones sueltas como "1.") se pueden quitar
        faltantes = [n for n in sorted(en_hueco)
                     if en_hueco[n] == palabras_por_linea[n]
                     and re.search(r"[^\W\d_]", lineas_originales[n])
                     and not ya_esta(n)]
        resto = [o[0] for o in hueco if o[1] not in faltantes]
        if len(resto) == j2 - j1:
            for o, (g, inicio, fin) in zip(resto, generadas[j1:j2]):
                if _es_errata(o, g):
                    cambios.append((inicio, fin, _como_la_generada(o, g)))
        if not faltantes:
            continue
        # Si lo que sigue es un ítem de lista, lo perdido era un ítem más de esa lista
        # (salvo títulos y líneas que presentan la lista: "Documentación requerida:")
        item_siguiente = dentro_de_item(generadas[j1][1]) if j1 < len(generadas) else -1
        if item_siguiente != -1 and not any(es_titulo(n) or lineas_originales[n].strip().endswith(":") for n in faltantes):
            nuevos = "".join(f"<li>{contenido(n)}</li>\n" for n in faltantes)
            cambios.append((item_siguiente, item_siguiente, nuevos))
            continue
        nuevos = "".join(
            f"\n<{nivel_titulo}>{contenido(n)}</{nivel_titulo}>" if es_titulo(n) else f"\n{apertura}{contenido(n)}</p>"
            for n in faltantes)
        if j1 == 0:
            cambios.append((0, 0, nuevos.lstrip("\n") + "\n"))
        else:
            cierre = CIERRE_BLOQUE.search(html, generadas[j1 - 1][2])
            donde = cierre.end() if cierre else len(html)
            cambios.append((donde, donde, nuevos))

    for inicio, fin, nuevo in sorted(cambios, key=lambda c: (c[0], c[1]), reverse=True):
        html = html[:inicio] + nuevo + html[fin:]
    return html
