// Feature 179 (T1.4, design §5.1) — EL UNICO PUNTO DE INVALIDACION DEL DOMINIO FINANCIERO.
//
// Modulo PURO: sin Next, sin Prisma, sin `process.env`. Ningun escritor de ledger importa
// `next/cache` (R21) —`revalidateTag` LANZA `Invariant: static generation store missing` fuera
// de un request (`revalidate.js:104-107`) y tumbaria las suites unitarias de la liquidacion y de
// los cierres, que hoy corren sin runtime de Next— y ninguno compone el array de tags por su
// cuenta: un escritor no puede invalidar «casi bien».
//
// ═══ DESVIACION DECLARADA DE R11 DE LA 128 (D4, humano 2026-08-10) ══════════════════════════
//
// R11 de la 128 dice, textualmente, que una invalidacion fallida DEBE hacer fallar al llamador.
// **AQUI SE HACE LO CONTRARIO, A PROPOSITO Y CON MOTIVO.**
//
//   - En la 128 el llamador era un JOB IDEMPOTENTE con backoff y dead-letter (`JobQueueService`),
//     donde fallar es exactamente lo correcto: el reintento es gratis y no lo ve nadie.
//   - Aqui el llamador es una SERVER ACTION DE CARA A UN MAESTRO, sobre una escritura de dinero
//     **ya confirmada**. Fallar no reintenta nada: solo miente sobre lo que ocurrio, le dice al
//     usuario que la aprobacion del cierre fallo cuando el dinero ya se movio, y provoca
//     reintentos manuales sobre una operacion hecha.
//
// El dano de no propagar queda ACOTADO por el TTL (una hora, `ANALITICA_CACHE_TTL_SEGUNDOS`) y
// **con senal**: el fallo se registra por el canal de errores con su origen (R16/R24). Los dos
// extremos —mentir sobre la operacion, y callar sobre la cache— tienen su test y los dos son
// rojo (`tests/unit/analytics/cache-financiera-invalidacion-fallo.test.ts`).
//
// **El unico sitio donde R11 de la 128 sigue aplicando tal cual es el handler del job de R27**:
// ahi el llamador vuelve a ser un job, y ahi la invalidacion fallida SI debe fallar. Por eso ese
// camino NO pasa por esta funcion.
//
// Esto se escribe aqui, y no solo en el spec, porque **una desviacion no declarada de un
// requisito ajeno es una contradiccion silenciosa entre dos specs**: el siguiente que compare
// R11 de la 128 con este codigo tiene que encontrar el motivo, no la sorpresa.
//
// ═══ Y POR QUE LA INVALIDACION VA DESPUES DEL COMMIT (R8) ═══════════════════════════════════
// Esta funcion no sabe de transacciones y no debe saber: la llama la pieza que POSEE la
// transaccion, justo despues de que confirme. Invalidar DENTRO de la `tx` abriria una ventana en
// la que una lectura concurrente repuebla la cache con el estado ANTERIOR, y esa entrada vive el
// TTL entero. Nada falla; la cifra se congela vieja. Es el peor modo de fallo de esta feature.

import { TAGS_FINANCIERA } from "@/lib/analytics/cache-tags";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import type { IAnaliticaCache, OrigenInvalidacion } from "@/lib/interfaces/external/IAnaliticaCache";

/**
 * Lo que se registra cuando la invalidacion falla. **Origen y tags, y NADA MAS** (R16/R24): sin
 * PII y sin ids de dominio. Ni tienda, ni mensajero, ni cierre, ni usuario — el registro sirve
 * para saber CUAL invalidador no llego, no QUE fila lo disparo.
 */
export class InvalidacionFinancieraFallida extends Error {
  constructor(
    readonly origen: OrigenInvalidacion,
    readonly tags: readonly string[],
    readonly causa: unknown,
  ) {
    super(`analitica: fallo la invalidacion de cache [origen=${origen}] [tags=${tags.join(",")}]`);
    this.name = "InvalidacionFinancieraFallida";
  }
}

/**
 * Invalida el dominio `financiera` entero (D1: un solo tag de dominio).
 *
 * NO PROPAGA (D4/R16): la escritura del ledger ya confirmo, asi que la operacion de dinero
 * devuelve exito porque OCURRIO. El fallo deja constancia por el canal de errores.
 *
 * ⚠ NO es un `catch` vacio, y la diferencia es el requisito entero: callar sobre la cache es una
 * de las dos mutaciones que R16 pone rojas; la otra es propagar.
 *
 * `logger` entra por parametro (patron del repo) para que el test pueda leer la constancia sin
 * espiar la consola.
 */
export async function invalidarAnaliticaFinanciera(
  cache: IAnaliticaCache,
  origen: OrigenInvalidacion,
  logger: ErrorLogger = defaultLogger,
): Promise<void> {
  try {
    await cache.invalidar(origen, TAGS_FINANCIERA);
  } catch (error) {
    logger.logError(new InvalidacionFinancieraFallida(origen, TAGS_FINANCIERA, error));
  }
}
