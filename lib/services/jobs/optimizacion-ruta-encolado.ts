// Feature 92 (design §4, R16-R19) — encolado del job de reoptimizacion de ruta desde los
// writers del mensajero, con el patron TRANSACTIONAL OUTBOX: la insercion del job va
// DENTRO de la transaccion del writer (4.º parametro `tx` de `IJobRepository.enqueue`). Si
// la transaccion del writer revierte, el job desaparece con ella: no hay reoptimizacion de
// una recogida que no ocurrio.
//
// ══════════════════════════════════════════════════════════════════════════════════════
// §4.1 — DOS ESPACIOS DE CLAVES DISJUNTOS. ESTO ES NORMATIVO, NO ESTILO.
// ══════════════════════════════════════════════════════════════════════════════════════
// El problema real: `JobRepository.enqueue` hace `ON CONFLICT ("dedupe_key") DO NOTHING`.
// Si el disparo INMEDIATO (gestion) compartiera espacio de claves con el disparo con
// DEBOUNCE (recogida), un debounce en vuelo TRAGARIA el inmediato EN SILENCIO: sin error,
// sin log, sin job. El mensajero registraria una entrega y su ruta no se recalcularia.
//
// Se resuelve con dos namespaces que NUNCA colisionan: `:debounce:` y `:inmediato:`.
//
// El precio es que el job de debounce en vuelo TAMBIEN correra al vencer su minuto, y no
// se puede cancelar: `IJobRepository` no expone cancelacion (verificado) y NO se le anade
// (design §4.1, alternativa D descartada — ampliar un contrato compartido con las features
// 90 y 91 por un caso que se resuelve en el handler). Por eso existe R20: la guarda de
// obsolescencia de `OptimizacionRutaService` completa el job SIN llamar al proveedor si
// una optimizacion posterior al evento ya cubrio el trabajo. Coste evitado sin
// infraestructura nueva.
//
// ══════════════════════════════════════════════════════════════════════════════════════
// §4.2 — LA VENTANA TEMPORAL DE LA CLAVE DE DEBOUNCE ES OBLIGATORIA (R18).
// ══════════════════════════════════════════════════════════════════════════════════════
// Sin ella, `optimizacion_ruta:<mensajeroId>:debounce` quedaria ocupada PARA SIEMPRE por
// la primera fila `done`: el indice unico de `dedupe_key` NO esta acotado por estado y las
// filas completadas no se purgan. La segunda recogida del mensajero —y todas las demas,
// para siempre— se descartarian en silencio. Es la trampa exacta que documento el gate
// F1.4-Q4 de la feature 91.
import type { IJobRepository, JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";

/** Prefijo del `dedupe_key` (patron `DEDUPE_PREFIX` de liberar-reprogramadas / 91). */
export const DEDUPE_PREFIX = "optimizacion_ruta";

/**
 * Limite de intentos de este tipo de job. Se queda en el default de la cola (5), a
 * diferencia de la geocodificacion (8): fallar aqui NO pierde datos —la ruta anterior se
 * conserva (R27)— y el proximo evento del mensajero encolara otro job de todas formas.
 * Insistir mas solo gastaria llamadas facturadas.
 */
export const OPTIMIZACION_MAX_INTENTOS = 5;

/** Duracion de la ventana de agrupacion, en ms. Fija: define el ESPACIO de claves. */
const VENTANA_MS = 60_000;

/**
 * R17/R18 — clave del disparo con DEBOUNCE. La ventana se calcula sobre el `runAfter`
 * (el instante en que el job DEBE correr), no sobre `now`: dos recogidas cuyo `runAfter`
 * cae en el mismo minuto producen la misma clave, la segunda se descarta y el job corre
 * en el `runAfter` de la PRIMERA — que es exactamente la semantica pedida.
 *
 * Efecto de borde honesto: si el segundo evento cae cerca del final de la ventana, el
 * debounce EFECTIVO para ese segundo evento puede ser menor a 60 s (nunca mayor a 120 s).
 * Se acepta: nunca dispara de mas y nunca deja de disparar.
 */
export function dedupeKeyDebounce(mensajeroId: string, runAfter: Date): string {
  const ventana = Math.floor(runAfter.getTime() / VENTANA_MS);
  return `${DEDUPE_PREFIX}:${mensajeroId}:debounce:${ventana}`;
}

/**
 * R19 — clave del disparo INMEDIATO. Namespace distinto del debounce (§4.1) MAS un
 * componente unico por evento: nunca colisiona con nada, asi que la gestion del mensajero
 * SIEMPRE inserta su fila y SIEMPRE corre sin delay.
 */
export function dedupeKeyInmediato(mensajeroId: string, eventoId: string): string {
  return `${DEDUPE_PREFIX}:${mensajeroId}:inmediato:${eventoId}`;
}

/**
 * R16: encola la reoptimizacion DIFERIDA `debounceS` segundos, dentro de la transaccion
 * del writer. Recoger 8 paquetes seguidos produce UN job, no ocho.
 *
 * El payload lleva SOLO el `mensajeroId` — ni coordenadas ni direcciones (regla de PII
 * heredada de la 91). El handler releera todo lo que necesite.
 */
export async function encolarOptimizacionDebounce(
  repo: IJobRepository,
  tx: JobTxClient | undefined,
  mensajeroId: string,
  opts: { ahora: Date; debounceS: number },
): Promise<void> {
  const runAfter = new Date(opts.ahora.getTime() + opts.debounceS * 1000);
  await repo.enqueue(
    "optimizacion_ruta",
    { mensajeroId },
    {
      runAfter,
      dedupeKey: dedupeKeyDebounce(mensajeroId, runAfter),
      maxIntentos: OPTIMIZACION_MAX_INTENTOS,
    },
    tx,
  );
}

/**
 * R19: encola la reoptimizacion SIN delay, dentro de la transaccion del writer. El
 * `eventoId` es el id de la `gestion_orden` recien creada en esa misma transaccion: unico
 * por evento y disponible sin generar nada nuevo.
 */
export async function encolarOptimizacionInmediata(
  repo: IJobRepository,
  tx: JobTxClient | undefined,
  mensajeroId: string,
  eventoId: string,
): Promise<void> {
  await repo.enqueue(
    "optimizacion_ruta",
    { mensajeroId },
    {
      dedupeKey: dedupeKeyInmediato(mensajeroId, eventoId),
      maxIntentos: OPTIMIZACION_MAX_INTENTOS,
    },
    tx,
  );
}
