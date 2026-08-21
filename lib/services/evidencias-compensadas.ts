import { GESTION_MIME_EXTENSION, type GestionMimeType } from "@/lib/config/gestion";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { EvidenciaArchivo } from "@/lib/interfaces/services/IMisAsignacionesService";

/**
 * Feature 237 (T4.1, D5, R15/R16/R17) — LA SUBIDA COMPENSADA DE EVIDENCIAS, en un solo sitio.
 *
 * ## Por que existe este modulo
 *
 * El encargo de la 237 pedia «reutilizar la maquinaria de `MisAsignacionesService.gestionar`, no
 * escribir una segunda». Al medirlo resulto que YA HABIA DOS: la del panel del mensajero
 * (`MisAsignacionesService.gestionar`, features 119/158) y la de `IncidenteAdminService`
 * (`subirEvidencias`/`compensar`, feature 158), con el mismo bucle secuencial y la misma
 * compensacion. Escribir la de la 237 habrian sido TRES.
 *
 * D5 se firmo como (a): se extrae aqui, se cablean **la 237 y `MisAsignacionesService`**, y
 * `IncidenteAdminService` queda como DEUDA DECLARADA CON DUEÑO (`progress/impl_237.md`). No se
 * arrastra la feature 158 entera dentro de la ficha mas delicada en dinero de la pila: el radio de
 * explosion del diff pesa mas que la tercera unificacion, y el modulo queda listo para que esa
 * migracion sea un commit mecanico.
 *
 * ## Lo unico que cambiaba entre las dos copias
 *
 * El PREFIJO del path (`${resultado}-` en la del mensajero, `incidente-` en la del admin). Va
 * parametrizado, no bifurcado: un `if` por llamador dentro de esta funcion seria la divergencia
 * que se venia a cerrar.
 *
 * ## Modulo PURO respecto de la infraestructura
 *
 * Sin Prisma, sin `next/*`, sin HTTP. Recibe el `IFileStorage` por parametro (inyeccion de
 * dependencia, `docs/architecture.md`) porque quien lo usa ya lo tiene construido y porque asi se
 * prueba con un doble sin red.
 */

/** Una evidencia YA SUBIDA, lista para persistir como fila hija de la gestion. */
export interface EvidenciaSubida {
  storagePath: string;
  contentType: string;
  /** Posicion 0..N-1 en el ORDEN en que llegaron. El 0 es la portada denormalizada (119/R12). */
  indice: number;
}

export interface SubirEvidenciasInput {
  /** Primer segmento del path: agrupa por orden dentro del bucket privado. */
  ordenId: string;
  /**
   * Segundo segmento, para distinguir las fotos de dos actos distintos sobre la MISMA orden
   * (`rechazada-`, `incidente-`, …). Lo elige el llamador; aqui no se decide.
   */
  prefijo: string;
  evidencias: ReadonlyArray<EvidenciaArchivo>;
}

/**
 * R15/R17 — sube 1..N evidencias de forma SECUENCIAL y determinista, acumulando lo ya subido para
 * poder compensar.
 *
 * ⚠️ EL BUCLE ES SECUENCIAL A PROPOSITO Y NO SE «OPTIMIZA» CON `Promise.all` (119/R9/R10). Con
 * `Promise.all`, cuando la subida #k falla no se sabe cuales de las otras N-1 llegaron a
 * completarse —la promesa rechaza y las demas siguen vivas— y la compensacion tendria que
 * adivinar. Con el bucle, `paths` contiene EXACTAMENTE lo subido hasta el fallo. Para el tope de
 * 3 fotos (`gestionConfig.MAX_EVIDENCIAS_POR_GESTION`) el coste de no paralelizar es despreciable.
 *
 * Si falla la #k: se retiran las k-1 ya subidas y el error SE PROPAGA (no es un resultado de
 * dominio). El llamador no recibe nada, asi que no puede persistir a medias.
 *
 * `-i` en el path garantiza unicidad entre las fotos de la MISMA subida, que pueden compartir el
 * `Date.now()`. El `Date.now()` se lee DENTRO del bucle, exactamente como lo hacian las dos copias
 * de origen: sacarlo fuera daria paths distintos de los de hoy y esta extraccion no cambia ni un
 * byte de la conducta observable (T4.2).
 */
export async function subirEvidenciasCompensadas(
  storage: IFileStorage,
  input: SubirEvidenciasInput,
): Promise<{ paths: string[]; evidencias: EvidenciaSubida[] }> {
  const paths: string[] = [];
  const evidencias: EvidenciaSubida[] = [];
  try {
    for (let i = 0; i < input.evidencias.length; i++) {
      const ev = input.evidencias[i];
      const ext = GESTION_MIME_EXTENSION[ev.contentType as GestionMimeType] ?? "bin";
      const path = `${input.ordenId}/${input.prefijo}${Date.now()}-${i}.${ext}`;
      const stored = await storage.upload({
        path,
        bytes: ev.bytes,
        contentType: ev.contentType,
      });
      paths.push(stored);
      evidencias.push({ storagePath: stored, contentType: ev.contentType, indice: i });
    }
  } catch (error) {
    await compensarEvidencias(storage, paths);
    throw error;
  }
  return { paths, evidencias };
}

/**
 * R16 — retira lo ya subido. Se llama desde el `catch` del llamador cuando la PERSISTENCIA falla
 * despues de la subida, y desde aqui mismo cuando falla la subida a medias.
 *
 * `remove` es best-effort por contrato de `IFileStorage` (no lanza ante paths inexistentes), asi
 * que llamarla dos veces sobre el mismo path es inofensivo. La lista vacia no llama a nada: sin
 * esa guarda, un fallo en la PRIMERA subida emitiria un `remove([])` que ensucia el rastro de las
 * suites que cuentan llamadas.
 */
export async function compensarEvidencias(
  storage: IFileStorage,
  paths: readonly string[],
): Promise<void> {
  if (paths.length > 0) await storage.remove([...paths]);
}
