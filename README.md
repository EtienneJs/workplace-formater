# Formateo a HTML

Convierte texto y columnas de un CSV a HTML usando reglas escritas en Markdown y un modelo local de [Ollama](https://ollama.com). Todo corre en tu computadora: no se envía nada a internet ni se gastan tokens.

## Requisitos

- Python 3.11 o superior (comando `py` en Windows).
- Ollama instalado, con al menos un modelo: `ollama pull qwen2.5:3b`.

## Cómo usarla

Doble clic en `iniciar.bat`. La primera vez crea el entorno e instala las dependencias; después abre la app en <http://localhost:8000>. Para apagarla, cerrá la ventana negra.

A mano:

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn api:app --port 8000
```

## Qué hay en cada carpeta

| Carpeta | Contenido |
| --- | --- |
| `rules/` | Las reglas (`.md`). Se editan desde la pestaña Configuración. |
| `referencias/` | Los JSON de referencia guardados. |
| `datos/` | La sesión de la tabla (se guarda sola) y el modelo elegido. No se versiona. |
| `static/` | La interfaz (HTML, CSS y JavaScript). |

## Desde la línea de comandos

```powershell
.venv\Scripts\python format.py articule input/texto.txt output/texto.html
```
