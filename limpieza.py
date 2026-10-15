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
