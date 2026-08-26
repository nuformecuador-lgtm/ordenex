import type { FuenteEmbebida } from "@/lib/pdf/etiquetas-fuente-registro";

// Feature 282 (T8) — EL UNICO sitio del navegador donde se cruza el borde de la
// carga diferida de la fuente de la etiqueta.
//
// Por que un `import()` dinamico y no un import estatico: el artefacto son ~22 KB
// de base64 que solo hacen falta cuando el usuario abre el modal «Imprimir
// etiquetas». Con un import estatico entrarian en el bundle inicial de
// `/ordenes`, que es una pantalla de listado que la mayoria de sesiones abre sin
// imprimir nada (R13). La guardia
// `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` comprueba que
// ningun otro modulo de `app/` lo nombra: si alguien añadiera un import estatico
// en cualquier sitio, el `+0 KB` de carga inicial dejaria de ser cierto sin que
// nadie lo notara.
//
// En el SERVIDOR el mecanismo es el contrario —import estatico del mismo
// artefacto en `lib/pdf/etiquetas-pdf-lote.ts`— porque alli no hay bundle que
// engordar y si hay un modo de fallo real que evitar: leer un archivo suelto en
// tiempo de ejecucion depende del trazado del despliegue y reventaria solo en
// produccion (R23).

/** Mensaje que el modal muestra al usuario cuando esto falla (R16). */
export const ERROR_FUENTE_ETIQUETA =
  "No se pudo preparar la tipografía de la etiqueta. Inténtalo de nuevo.";

/**
 * Carga el artefacto de fuente. El resultado lo cachea el propio grafo de
 * modulos del navegador: `import()` de un modulo ya evaluado no vuelve a pedir
 * la red, asi que abrir el modal dos veces no descarga dos veces (R13).
 *
 * El fallo se envuelve con contexto porque quien lo va a leer es el modal, no
 * quien escribio esta linea: un `ChunkLoadError` pelado en la consola no le dice
 * nada al operador de bodega que esta intentando imprimir.
 */
export async function cargarFuenteEtiqueta(): Promise<FuenteEmbebida> {
  try {
    const modulo = await import("@/lib/pdf/etiquetas-fuente");
    return modulo.fuenteEtiqueta;
  } catch (causa) {
    throw new Error(ERROR_FUENTE_ETIQUETA, { cause: causa });
  }
}

/**
 * Familias de respaldo del importe en la vista previa: si la fuente embebida no
 * llega, el navegador cae a la tipografia del sistema y el importe se sigue
 * leyendo (R33). No es la del PDF, y por eso la paridad exacta solo existe
 * cuando `asegurarFuenteEnPantalla` ha resuelto.
 */
export const RESPALDO_FAMILIA_MONTO = "ui-sans-serif, system-ui, sans-serif";

/** `base64` -> bytes. `atob` esta en todo navegador y tambien en jsdom. */
function bytesDeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binario = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/**
 * Feature 282 (T27, R31) — Registra en el navegador la MISMA fuente que jsPDF
 * embebe en el PDF, **desde los mismos bytes**, y devuelve el nombre de familia
 * con el que quedo registrada (o `null` si esta plataforma no puede).
 *
 * Por que `FontFace` y no una `@font-face` de CSS con un `.woff2` en `public/`:
 * eso seria una SEGUNDA COPIA del archivo —otro formato, otro peso, otra
 * actualizacion que olvidar— y la paridad pasaria a depender de que las dos
 * copias siguieran siendo la misma fuente. Aqui la paridad es por construccion:
 * los bytes que se registran en pantalla son los mismos que `registrarFuente`
 * mete en el `/FontFile2` del documento (R31).
 *
 * Se devuelve `cara.family` y no `fuente.nombre` a proposito: quien pinte el
 * importe usa el identificador REALMENTE registrado, no uno paralelo que podria
 * derivar del anterior sin que nadie lo viera.
 *
 * Idempotente **sin estado de modulo**: pregunta a `document.fonts`, que es el
 * registro de verdad. Una cache propia mentiria si alguien retirara la familia,
 * y ademas sobreviviria entre tests dando verdes por inercia.
 *
 * Si falla (bytes ilegibles, plataforma sin la API) NO se propaga como un fallo
 * de la pantalla: la vista previa se pinta con la tipografia del sistema (R33).
 * La descarga es la que falla de forma visible (R16), y esa es otra ruta.
 */
export async function asegurarFuenteEnPantalla(
  fuente: FuenteEmbebida,
): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const conjunto: FontFaceSet | undefined = document.fonts;
  if (!conjunto || typeof FontFace === "undefined") return null;

  for (const registrada of conjunto) {
    if (registrada.family === fuente.nombre) return registrada.family;
  }

  const cara = new FontFace(fuente.nombre, bytesDeBase64(fuente.base64));
  // Se carga ANTES de añadirla: si los bytes no sirven, no queda registrada una
  // familia que luego no pintaria nada.
  await cara.load();
  conjunto.add(cara);
  return cara.family;
}
