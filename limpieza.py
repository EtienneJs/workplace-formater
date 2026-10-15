import re
from html import escape
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


def limpiar_html(html: str) -> str:
    """Quita lo que el modelo agrega de más (bloques ```, <html>, <head>, <body>) y todo lo que
    pueda ejecutar código (scripts, iframes, atributos on..., enlaces javascript:)."""
    texto = html.strip()
    bloque = BLOQUE_CODIGO.match(texto)
    if bloque:
        texto = bloque.group(1)
    limpiador = _Limpiador()
    limpiador.feed(texto)
    limpiador.close()
    return "".join(limpiador.partes).strip()
