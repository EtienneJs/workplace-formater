@echo off
chcp 65001 >nul
title Formateo a HTML
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo Primera vez: creando el entorno de Python...
    py -m venv .venv || goto error
    .venv\Scripts\python -m pip install -r requirements.txt || goto error
)

where ollama >nul 2>&1
if errorlevel 1 (
    echo AVISO: no se encontro Ollama. Instalalo desde https://ollama.com para poder formatear.
) else (
    ollama list >nul 2>&1 || (
        echo Iniciando Ollama...
        start "Ollama" /min ollama serve
    )
)

echo.
echo La app queda en http://localhost:8000  ^(cerrá esta ventana para apagarla^)
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8000"
.venv\Scripts\python -m uvicorn api:app --port 8000
goto :eof

:error
echo.
echo No se pudo preparar el entorno. Revisá que Python este instalado ^(comando "py"^).
pause
