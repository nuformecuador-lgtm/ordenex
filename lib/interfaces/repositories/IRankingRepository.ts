import type { ConteoPorMensajero } from "@/lib/types/ranking";

// Feature 76 (design §3) — contrato del repositorio de agregacion del ranking DIARIO. SOLO
// queries Prisma; sin logica de negocio. El rango del dia (CR) lo calcula el SERVICE y lo
// pasa como `desde`/`hasta` para que el repo NO dependa de `Date.now()` (testeable). El
// filtro es half-open: `asignado_at`/`created_at` en [desde, hasta).
//
// FEATURE 246 (T6.1, D7 firmada el 2026-08-20 EN CONTRA de la recomendacion del spec) — EL
// DENOMINADOR PASA A CONTAR POR DIA DE REPARTO. Y con ese cambio entran en la MISMA consulta las
// DOS convenciones de fecha que este repo tiene vivas, que es donde esto se puede hacer mal:
//
//   - `fecha_reparto` es `DATE`      -> medianoche UTC de la fecha CR (`fechaComoDate`/`startOfDayCR`).
//   - `asignado_at` es `timestamp`   -> `...T06:00:00.000Z` (`inicioDelDiaCREnUtc`, features 144/166).
//
// Mezclarlas desplaza el dia SEIS HORAS, y este repo ya cerro esa ficha una vez (la 166: una
// entrega de las 19:00 CR contaba para el dia siguiente). Por eso los tres valores los calcula EL
// LLAMADOR y NINGUNO se deriva de otro dentro del repositorio: derivar `diaReparto` restandole seis
// horas a `desde` seria exactamente la segunda definicion del dia que design §3 prohibe.

export interface IRankingRepository {
  /**
   * R1: numerador = entregas exitosas HOY(CR) por mensajero. Cuenta gestiones
   * `resultado = entregada`, VIGENTES (`anulada_at IS NULL`, feature 67) y con
   * `created_at ∈ [desde, hasta)`, agrupadas por `mensajeroId` (quien ACTUO la entrega).
   *
   * Feature 246 (R39): NO CAMBIA. El numerador sigue anclado a `gestion_orden.created_at`, y tiene
   * que seguir estandolo: es lo unico que no recibe escrituras tardias, y el snapshot del dia se
   * congela a las 02:00 CR del dia siguiente sin poder reescribirse despues (design §10-F).
   */
  contarEntregadasPorMensajero(desde: Date, hasta: Date): Promise<ConteoPorMensajero[]>;
  /**
   * R36/R37/R38/R43: denominador = ordenes de un mensajero cuyo DIA DE REPARTO es ese dia.
   *
   * Son DOS ramas DISJUNTAS, y las dos hacen falta:
   *   (a) `fecha_reparto = diaReparto`  — la orden reservada para ESE dia (R36/R38);
   *   (b) `fecha_reparto IS NULL` Y `asignado_at ∈ [desde, hasta)` — el RESPALDO para las ordenes
   *       que no tienen dia de reparto, que son todas las anteriores al despliegue (R37/R43).
   *
   * @param desde  cota INFERIOR (inclusiva) del respaldo, contra `asignado_at` (`timestamp`,
   *               convencion 144/166: `...T06:00:00.000Z`).
   * @param hasta  cota SUPERIOR (exclusiva) del respaldo, misma convencion.
   * @param diaReparto  el dia, como `DATE` (medianoche UTC de la fecha CR, convencion 46).
   *                    OBLIGATORIO y sin default: un default dejaria al ranking en vivo y al
   *                    snapshot contando distinto sin que nadie se entere, que es justo lo que R41
   *                    prohibe. Que ganarlo rompa el typecheck en todos los dobles ES la señal.
   */
  contarAsignadasPorMensajero(
    desde: Date,
    hasta: Date,
    diaReparto: Date,
  ): Promise<ConteoPorMensajero[]>;
}
