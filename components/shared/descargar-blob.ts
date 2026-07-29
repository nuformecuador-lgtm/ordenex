/**
 * Feature 148 (T9) — único side effect de descarga del navegador: envuelve un binario
 * ya construido en un `Blob` y lo entrega al usuario con el patrón anchor temporal
 * (mismo que usa `BulkUpload` para la plantilla). Vive en `components/shared/` porque
 * es DOM puro (no React) y lo consumen rutas de dos grupos distintos.
 *
 * R15 — El archivo NUNCA sale del navegador: no hay subida, no hay `fetch`, no hay
 * almacenamiento. El objeto URL se revoca siempre para no filtrar memoria.
 */
export function descargarBlob(
  contenido: BlobPart,
  mime: string,
  fileName: string,
): void {
  const blob = new Blob([contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    // El anchor se adjunta al documento porque Firefox ignora el click de un nodo
    // desconectado; se retira inmediatamente después.
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}
