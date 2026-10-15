import csv
import io
import json
import re
from pathlib import Path
from typing import Annotated, Any

from fastapi import Body, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from format import (
    DATOS_DIR,
    RULES_DIR,
    OllamaFallo,
    OllamaNoDisponible,
    OllamaTardo,
    formatear,
    guardar_config,
    leer_config,
    modelo_actual,
    modelos_instalados,
)

STATIC_DIR = Path(__file__).parent / "static"
REFERENCIAS_DIR = Path(__file__).parent / "referencias"
REFERENCIAS_DIR.mkdir(exist_ok=True)
SESION = DATOS_DIR / "sesion.json"

app = FastAPI(title="Formateo a HTML")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class Pedido(BaseModel):
    texto: str
    regla: str


class Respuesta(BaseModel):
    html: str


class TablaCsv(BaseModel):
    columnas: list[str]
    filas: list[list[str]]
    separador: str


class ContenidoRegla(BaseModel):
    contenido: str


class Renombrar(BaseModel):
    nuevo: str


class Configuracion(BaseModel):
    modelo: str
    modelos: list[str]
    ollama: bool


class CambioConfig(BaseModel):
    modelo: str


def decodificar(datos: bytes) -> str:
    # Excel en español suele guardar los CSV en cp1252 en lugar de UTF-8
    try:
        return datos.decode("utf-8-sig")
    except UnicodeDecodeError:
        return datos.decode("cp1252")


@app.get("/", include_in_schema=False)
def inicio():
    return FileResponse(STATIC_DIR / "index.html")


def validar_nombre(nombre: str) -> str:
    # Sin puntos ni barras, para que el nombre no pueda salir de su carpeta
    if not re.fullmatch(r"[\w\- ]{1,60}", nombre) or nombre != nombre.strip():
        raise HTTPException(400, "Nombre inválido: usá letras, números, espacios, guiones o guiones bajos (máximo 60)")
    return nombre


def ruta_regla(nombre: str) -> Path:
    return RULES_DIR / f"{validar_nombre(nombre)}.md"


@app.get("/reglas")
def reglas() -> list[str]:
    return sorted((p.stem for p in RULES_DIR.glob("*.md")), key=str.lower)


@app.get("/reglas/{nombre}")
def leer_regla(nombre: str) -> ContenidoRegla:
    ruta = ruta_regla(nombre)
    if not ruta.exists():
        raise HTTPException(404, f"No existe la regla '{nombre}'")
    return ContenidoRegla(contenido=ruta.read_text(encoding="utf-8"))


@app.put("/reglas/{nombre}")
def guardar_regla(nombre: str, datos: ContenidoRegla) -> dict:
    try:
        ruta_regla(nombre).write_text(datos.contenido, encoding="utf-8")
    except OSError:
        raise HTTPException(400, f"No se pudo guardar la regla '{nombre}'")
    return {"ok": True}


@app.post("/reglas/{nombre}/renombrar")
def renombrar_regla(nombre: str, datos: Renombrar) -> dict:
    origen, destino = ruta_regla(nombre), ruta_regla(datos.nuevo)
    if not origen.exists():
        raise HTTPException(404, f"No existe la regla '{nombre}'")
    # En Windows "Regla" y "regla" son el mismo archivo: eso es un cambio de mayúsculas, no un choque
    if destino.exists() and nombre.lower() != datos.nuevo.lower():
        raise HTTPException(409, f"Ya existe una regla llamada '{datos.nuevo}'")
    origen.rename(destino)
    return {"ok": True}


@app.delete("/reglas/{nombre}")
def borrar_regla(nombre: str) -> dict:
    ruta_regla(nombre).unlink(missing_ok=True)
    return {"ok": True}


@app.post("/formatear")
def formatear_endpoint(p: Pedido) -> Respuesta:
    if p.regla not in reglas():
        raise HTTPException(404, f"No existe la regla '{p.regla}'")
    if not p.texto.strip():
        raise HTTPException(400, "El texto está vacío")
    try:
        return Respuesta(html=formatear(p.texto, p.regla))
    except OllamaNoDisponible as e:
        raise HTTPException(503, str(e))
    except OllamaFallo as e:
        raise HTTPException(502, str(e))
    except OllamaTardo as e:
        raise HTTPException(504, str(e))


@app.get("/config")
def ver_config() -> Configuracion:
    try:
        instalados = modelos_instalados()
    except OllamaNoDisponible:
        instalados = []
    return Configuracion(modelo=modelo_actual(), modelos=instalados, ollama=bool(instalados))


@app.put("/config")
def cambiar_config(datos: CambioConfig) -> dict:
    modelo = datos.modelo.strip()
    if not modelo:
        raise HTTPException(400, "Elegí un modelo")
    guardar_config({**leer_config(), "modelo": modelo})
    return {"ok": True}


@app.get("/sesion")
def leer_sesion() -> Any:
    try:
        return json.loads(SESION.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


@app.put("/sesion")
def guardar_sesion(datos: Annotated[Any, Body()]) -> dict:
    DATOS_DIR.mkdir(exist_ok=True)
    # Se escribe aparte y después se reemplaza, para no dejar el archivo a medias si algo se corta
    temporal = SESION.with_suffix(".tmp")
    temporal.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
    temporal.replace(SESION)
    return {"ok": True}


@app.delete("/sesion")
def borrar_sesion() -> dict:
    SESION.unlink(missing_ok=True)
    return {"ok": True}


@app.post("/csv")
async def leer_csv(archivo: UploadFile) -> TablaCsv:
    texto = decodificar(await archivo.read())
    if not texto.strip():
        raise HTTPException(400, "El CSV está vacío")
    cabecera = texto.lstrip().splitlines()[0]
    separador = max(",;\t", key=cabecera.count)
    lector = csv.reader(io.StringIO(texto, newline=""), delimiter=separador)
    filas = [f for f in lector if any(c.strip() for c in f)]
    columnas, *resto = filas
    return TablaCsv(columnas=columnas, filas=resto, separador=separador)


def ruta_referencia(nombre: str) -> Path:
    return REFERENCIAS_DIR / f"{validar_nombre(nombre)}.json"


@app.get("/referencias")
def listar_referencias() -> list[str]:
    return sorted((p.stem for p in REFERENCIAS_DIR.glob("*.json")), key=str.lower)


@app.get("/referencias/{nombre}")
def leer_referencia(nombre: str) -> Any:
    ruta = ruta_referencia(nombre)
    if not ruta.exists():
        raise HTTPException(404, f"No existe la referencia '{nombre}'")
    return json.loads(ruta.read_text(encoding="utf-8"))


@app.put("/referencias/{nombre}")
def guardar_referencia(nombre: str, datos: Annotated[Any, Body()]) -> dict:
    try:
        ruta_referencia(nombre).write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        raise HTTPException(400, f"No se pudo guardar con el nombre '{nombre}'")
    return {"ok": True}


@app.delete("/referencias/{nombre}")
def borrar_referencia(nombre: str) -> dict:
    ruta_referencia(nombre).unlink(missing_ok=True)
    return {"ok": True}
