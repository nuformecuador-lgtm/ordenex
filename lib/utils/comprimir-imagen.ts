// Comprime/redimensiona una foto en el NAVEGADOR antes de subirla. La evidencia
// de gestion (mis-asignaciones) viaja como File dentro del FormData de un Server
// Action, cuyo body tiene un limite (1 MB por defecto, 5 MB aqui): una foto de
// celular sin comprimir (3-15 MB) lo revienta con un 413. Para una foto de
// evidencia no hace falta resolucion completa, asi que se redimensiona el lado
// largo a `maxLadoLargo` y se recodifica a JPEG con calidad `calidad`, dejando
// la foto en ~200-600 KB.
//
// Comprimir es una OPTIMIZACION, no una validacion: ante cualquier fallo
// (formato no decodable, canvas sin contexto 2d, resultado mas grande que el
// original) se devuelve el archivo ORIGINAL para no bloquear la gestion. La
// cota real de tamano/MIME la sigue imponiendo `gestionarSchema` en cliente y
// el service en el servidor.
//
// UNICA excepcion (feature 316, chat saliente): ahi la llamada no OPTIMIZA, CONVIERTE
// (HEIC/WebP de un iPhone -> JPEG, que es lo unico que Meta acepta), y el original es
// justamente lo que no se puede enviar. Para ese caso existe `devolverOriginalSiMayor: false`
// junto con `saltarSiMenorA: 0`; quien convierte comprueba DESPUES el `type` del File devuelto,
// porque el helper sigue sin lanzar nunca.

export interface ComprimirImagenOptions {
  /** Lado largo maximo en px (se conserva la relacion de aspecto). Default 1600. */
  maxLadoLargo?: number;
  /** Calidad JPEG en [0, 1]. Default 0.8. */
  calidad?: number;
  /** Si el archivo ya pesa <= estos bytes, se devuelve tal cual. Default 1 MB. */
  saltarSiMenorA?: number;
  /**
   * Feature 316: si el re-encode sale MAS GRANDE que el original, ¿devolver el original?
   * `true` (default) = comportamiento historico, para las 4 superficies que solo OPTIMIZAN
   * (GestionarOrdenPanel, ReportarIncidenteModal, GestionarDesdeAyudaModal, PostulacionForm):
   * ahi el original ya era valido y quedarse con el mas pequeño es lo correcto.
   * `false` = la conversion es OBLIGATORIA (HEIC/WebP -> JPEG para enviar por WhatsApp): un JPEG
   * mas grande sigue siendo mejor que un formato que Meta rechaza.
   */
  devolverOriginalSiMayor?: boolean;
}

const DEFAULTS: Required<ComprimirImagenOptions> = {
  maxLadoLargo: 1600,
  calidad: 0.8,
  saltarSiMenorA: 1024 * 1024,
  devolverOriginalSiMayor: true,
};

export async function comprimirImagen(
  file: File,
  options: ComprimirImagenOptions = {},
): Promise<File> {
  const { maxLadoLargo, calidad, saltarSiMenorA, devolverOriginalSiMayor } = {
    ...DEFAULTS,
    ...options,
  };

  // Solo imagenes; si ya es pequena, comprimir no aporta.
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= saltarSiMenorA) return file;

  try {
    // `imageOrientation: "from-image"` respeta la orientacion EXIF de la foto
    // (fotos de celular vienen rotadas por metadato): sin esto la evidencia
    // podria quedar de lado.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const escala = Math.min(1, maxLadoLargo / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", calidad),
    );
    // Sin blob no hay nada que devolver. Y si el re-encode quedo mas grande que el original,
    // se devuelve el original SOLO cuando comprimir es la unica intencion
    // (`devolverOriginalSiMayor`, default historico); cuando la llamada busca CONVERTIR de
    // formato (316), el JPEG mas grande es el resultado bueno.
    if (!blob || (devolverOriginalSiMayor && blob.size >= file.size)) return file;

    const nombre = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nombre, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
