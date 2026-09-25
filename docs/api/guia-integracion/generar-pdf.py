#!/usr/bin/env python3
"""Genera el PDF de la guía de integración a partir de `guia-integracion.html`.

Uso:
    python docs/api/guia-integracion/generar-pdf.py [ruta/del/salida.pdf]

Sin argumento escribe `guia-integracion.pdf` al lado del HTML. Requisitos: Chrome o Edge
instalados (se imprime con el navegador en modo headless; los pies de página salen de las
reglas `@page` del propio HTML) y, opcionalmente, `pypdf` o `pymupdf` para contar páginas.

Antes de imprimir valida que TODOS los bloques `<pre>` que parecen JSON sean JSON válido:
un ejemplo mal formado aborta la generación. Los bloques `curl …` y los que contienen
placeholders angulares (`<ordenId>`, `<host-de-storage>`) se validan tras sustituirlos.
"""
from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
HTML = AQUI / "guia-integracion.html"

NAVEGADORES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "google-chrome",
    "chromium",
    "msedge",
]


def navegador() -> str:
    for candidato in NAVEGADORES:
        if Path(candidato).is_file():
            return candidato
        encontrado = shutil.which(candidato)
        if encontrado:
            return encontrado
    raise SystemExit("No se encontró Chrome ni Edge. Instala uno o ajusta NAVEGADORES.")


def bloques_pre(texto: str) -> list[str]:
    crudos = re.findall(r"<pre>(.*?)</pre>", texto, flags=re.S)
    return [html.unescape(re.sub(r"<[^>]+>", "", b)) for b in crudos]


def validar_json(texto: str) -> int:
    validados = 0
    for i, bloque in enumerate(bloques_pre(texto), start=1):
        cuerpo = bloque.strip()
        if cuerpo.startswith("curl") or cuerpo.startswith("Authorization:"):
            continue
        # Fragmentos con placeholders angulares: se sustituyen por un texto plano.
        candidato = re.sub(r"<[^<>\"]+>", "x", cuerpo)
        # Un fragmento de objeto (`"pagination": {...}`) se envuelve para validarlo.
        if not candidato.startswith("{") and not candidato.startswith("["):
            candidato = "{" + candidato + "}"
        try:
            json.loads(candidato)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Bloque <pre> #{i} no es JSON válido: {exc}\n---\n{cuerpo[:400]}")
        validados += 1
    return validados


def contar_paginas(pdf: Path) -> int | None:
    try:
        from pypdf import PdfReader  # type: ignore

        return len(PdfReader(str(pdf)).pages)
    except Exception:
        try:
            import fitz  # type: ignore

            return len(fitz.open(str(pdf)))
        except Exception:
            return None


def main() -> None:
    salida = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else AQUI / "guia-integracion.pdf"
    texto = HTML.read_text(encoding="utf-8")
    n = validar_json(texto)
    print(f"JSON: {n} bloques válidos")

    exe = navegador()
    url = HTML.resolve().as_uri()
    cmd = [
        exe,
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={salida}",
        url,
    ]
    resultado = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if not salida.is_file():
        raise SystemExit(f"El navegador no escribió el PDF.\n{resultado.stderr[-2000:]}")
    paginas = contar_paginas(salida)
    print(f"PDF: {salida} ({salida.stat().st_size} bytes" + (f", {paginas} páginas)" if paginas else ")"))


if __name__ == "__main__":
    main()
