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
