import http.client
import json
import sys
import urllib.request
from pathlib import Path
from urllib.error import HTTPError, URLError

from limpieza import limpiar_html

MODEL = "qwen2.5:3b"
OLLAMA_URL = "http://localhost:11434"
RULES_DIR = Path(__file__).parent / "rules"
DATOS_DIR = Path(__file__).parent / "datos"
CONFIG = DATOS_DIR / "config.json"
# La primera llamada carga el modelo en memoria y puede tardar bastante más que las siguientes
TIEMPO_MAXIMO = 180
REINTENTOS = 2


class OllamaNoDisponible(Exception):
    """Ollama no está corriendo o no acepta conexiones."""


class OllamaTardo(Exception):
    """Ollama no respondió dentro de TIEMPO_MAXIMO."""


class OllamaFallo(Exception):
    """Ollama respondió con un error (por ejemplo, el modelo no está instalado)."""


def leer_config() -> dict:
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def guardar_config(config: dict) -> None:
    DATOS_DIR.mkdir(exist_ok=True)
    CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def modelo_actual() -> str:
    return leer_config().get("modelo") or MODEL


def modelos_instalados() -> list[str]:
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=5) as r:
            nombres = (m["name"] for m in json.loads(r.read())["models"])
            # Los modelos de embeddings no generan texto
            return sorted(n for n in nombres if "embed" not in n)
    except (URLError, OSError) as e:
        raise OllamaNoDisponible("No se pudo conectar con Ollama. ¿Está corriendo?") from e


def _pedir(payload: dict) -> str:
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIEMPO_MAXIMO) as r:
        return json.loads(r.read())["response"]


def formatear(texto: str, regla: str, modelo: str | None = None) -> str:
    system = (RULES_DIR / f"{regla}.md").read_text(encoding="utf-8")
    modelo = modelo or modelo_actual()
    payload = {
        "model": modelo,
        "system": system,
        "prompt": texto,
        "stream": False,
        "options": {"temperature": 0.1},
        "keep_alive": "10m",
    }
    for intento in range(REINTENTOS + 1):
        try:
            return limpiar_html(_pedir(payload))
        except HTTPError as e:
            try:
                detalle = json.loads(e.read()).get("error", "")
            except ValueError:
                detalle = ""
            if "not found" in detalle:
                raise OllamaFallo(f"El modelo '{modelo}' no está instalado. Instalalo con: ollama pull {modelo}") from e
            # Un 500 de Ollama suele ser pasajero (se quedó sin memoria, recargó el modelo): vale reintentar
            if e.code < 500 or intento == REINTENTOS:
                raise OllamaFallo(f"Ollama respondió con un error: {detalle or e.reason}") from e
        except TimeoutError as e:
            raise OllamaTardo(f"Ollama tardó más de {TIEMPO_MAXIMO} segundos en responder") from e
        except URLError as e:
            if isinstance(e.reason, TimeoutError):
                raise OllamaTardo(f"Ollama tardó más de {TIEMPO_MAXIMO} segundos en responder") from e
            raise OllamaNoDisponible("No se pudo conectar con Ollama. ¿Está corriendo?") from e
        except (ConnectionResetError, http.client.RemoteDisconnected) as e:
            if intento == REINTENTOS:
                raise OllamaNoDisponible("Ollama cortó la conexión varias veces seguidas") from e
    raise AssertionError("inalcanzable")


if __name__ == "__main__":
    # uso: py format.py articule input/texto.txt [output/texto.html]
    sys.stdout.reconfigure(encoding="utf-8")
    regla, archivo = sys.argv[1], sys.argv[2]
    texto = Path(archivo).read_text(encoding="utf-8")
    html = formatear(texto, regla)
    if len(sys.argv) > 3:
        salida = Path(sys.argv[3])
        salida.parent.mkdir(parents=True, exist_ok=True)
        salida.write_text(html, encoding="utf-8")
        print(f"Guardado en {salida}")
    else:
        print(html)
