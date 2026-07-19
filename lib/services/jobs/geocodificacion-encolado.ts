// Feature 91 (design §6) — encolado del job de geocodificacion desde los writers de
// direccion, con el patron TRANSACTIONAL OUTBOX: la insercion del job va DENTRO de la
// transaccion del writer (4.º parametro `tx` de `IJobRepository.enqueue`, que la 90 anadio
// explicitamente para 91/92). Si la transaccion del writer revierte, el job desaparece con
// ella (R7): no hay ventana con una orden sin job, ni un job sin su orden.
import type { IJobRepository, JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import { construirQueryDireccion, hashDireccion } from "@/lib/geo/direccion-query";

/**
 * R34 (gate F1.4-Q3): limite de intentos PROPIO de este tipo de job, por encima del
 * default de la cola (5). Con el backoff base de 60 s de la 90, sube la tolerancia a un
 * corte del proveedor o de su facturacion de ~15 min a ~4 h antes del dead-letter.
 * Es NORMATIVO, no un default sugerido.
 */
export const GEOCODIFICACION_MAX_INTENTOS = 8;

/** Prefijo del `dedupe_key` (patron `DEDUPE_PREFIX` de liberar-reprogramadas). */
export const DEDUPE_PREFIX = "geocodificacion";

/**
 * Clave de idempotencia del job de geocodificacion (R12/R13, decision Q4).
 *
 * ⚠️ LOS DOS COMPONENTES SON OBLIGATORIOS. NO simplificar a `geocodificacion:${ordenId}`:
 *  - el indice unico de `dedupe_key` es `UNIQUE ... WHERE dedupe_key IS NOT NULL`
 *    (migracion de la 90, :39): NO esta acotado por estado del job;
 *  - las filas de `jobs` no se purgan al completarse, asi que la fila `done` del primer
 *    encolado sigue ocupando la clave para siempre;
 *  - => corregir la direccion de una orden ya geocodificada chocaria con esa fila y el
 *    `ON CONFLICT DO NOTHING` descartaria el encolado EN SILENCIO: sin error, sin log,
 *    sin job. La orden conservaria para siempre las coordenadas de la direccion mala.
 *
 * Tampoco vale la huella sola: dos ordenes distintas con la misma direccion colisionan
 * y solo una recibiria coordenadas (rompe R6).
 */
export function dedupeKeyGeocodificacion(ordenId: string, hash: string): string {
  return `${DEDUPE_PREFIX}:${ordenId}:${hash.slice(0, 8)}`;
}

/**
 * R9/R12/R14: encola el job DENTRO de la transaccion del writer. No-op si la direccion no
 * es geocodificable (null, vacia o solo espacios).
 *
 * La huella se calcula sobre la direccion LIBRE, no sobre la consulta completa: los
 * nombres de catalogo no se leen aqui (obligaria a un join extra en cada writer) y lo que
 * identifica el cambio a re-geocodificar es la direccion que el usuario escribio.
 */
export async function encolarGeocodificacion(
  repo: IJobRepository,
  tx: JobTxClient,
  orden: { id: string; direccion: string | null },
): Promise<void> {
  // R9: se encola SOLO si hay direccion libre con contenido tras normalizar (gate
  // F1.4-Q5). `construirQueryDireccion` devuelve null exactamente en ese caso; se le pasa
  // el catalogo vacio porque aqui solo importa la geocodificabilidad de la direccion.
  const query = construirQueryDireccion({
    direccion: orden.direccion,
    distritoNombre: null,
    cantonNombre: "",
    provinciaNombre: "",
  });
  if (query === null) return;

  const hash = hashDireccion(orden.direccion ?? "");
  await repo.enqueue(
    "geocodificacion",
    { ordenId: orden.id }, // R14: SOLO el id. Nunca la direccion (dato personal).
    {
      dedupeKey: dedupeKeyGeocodificacion(orden.id, hash),
      maxIntentos: GEOCODIFICACION_MAX_INTENTOS, // R34
    },
    tx, // R7: dentro de la transaccion del writer (outbox)
  );
}
