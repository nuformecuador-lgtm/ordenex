import type { OrdenHistorialOrigenTipo as PrismaOrdenHistorialOrigenTipo } from "@prisma/client";

// Feature 49 (design §1.2, R23) — fuente unica de verdad de los tipos de ORIGEN de una
// transicion de estado, respaldada por el enum Postgres nativo `orden_historial_origen_tipo`
// (patron METODO_PAGO_SEED / WALLET_*_SEED). Son los 12 call-sites de escritura de
// `orden.estatus_id` (design §2), un valor por familia de transicion.
//   - `satisfies readonly PrismaOrdenHistorialOrigenTipo[]` rompe el build si el SEED lista
//     un valor que el enum Prisma NO tiene.
//   - el chequeo `_EnsureExhaustive` rompe el build si el enum gana un valor que el SEED
//     NO lista (conjunto cerrado de los 12 tipos).
export const ORDEN_HISTORIAL_ORIGEN_TIPO_SEED = [
  "carga_masiva", // feature 15/27: estado inicial en createMany
  "creacion_manual", // feature 6: OrdenService.crear (create individual)
  "generacion_guia", // feature 17/30: generarGuiaLote
  "asignacion_bodega", // feature 17: asignarBodegaLote
  "ruteo_satelite", // feature 30: rutearBodegaSateliteLote
  "recepcion_satelite", // feature 33: recibirEnSatelite
  "asignacion_satelite", // feature 34: asignarSateliteLote
  "recoleccion", // feature 36: recogerLote
  "gestion", // feature 36: crearGestionYTransicionar
  "liberacion_reprogramada", // feature 46: liberarOrden (cron)
  "ajuste_estado", // feature 6: OrdenService.actualizar (CRUD generico)
  "deshacer_gestion", // feature 67 (F1.4-b): CierreDiaRepository.anularGestionYDevolverAGestion
  "carga_api", // feature 88 (D7): estado inicial en createManyOrdenesConGuia (canal integrador)
  "liberacion_devuelta_sla", // feature 99: cron SLA, devuelta -> en_bodega_central/en_bodega_satelite (reintento)
  "escalado_devuelta_sla", // feature 99: cron SLA, devuelta -> rechazada (escalado; enlaza gestion sintetica)
  "reprogramacion_tienda", // feature 100: adminTienda reprograma devuelta -> reprogramada (gestion sintetica reprogramada)
  "recuperacion_manual", // feature 100: bodega recupera devuelta -> en_bodega_central/en_bodega_satelite (accion manual del admin)
  "cancelacion_api", // feature 106: cancelacion por API key (OrdenRepository.cancelarViaApi), en_bodega_central/en_ruta_bodega_central -> devolviendo_a_tienda
  "corte_sin_gestionar", // feature 109: corte diario, en_reparto -> sin_gestionar (actor null/cron). NO enlaza gestion; fuera del criterio de intento (160, ver nota abajo)
  "liberacion_sin_gestionar", // feature 109: al APROBAR el cierre, sin_gestionar -> en_bodega_central/en_bodega_satelite (actor admin). NO enlaza gestion; fuera del criterio de intento (160)
  "recepcion_bodega_central", // feature 138: recepcion fisica en bodega central, en_ruta_bodega_central -> en_bodega_central (actor maestro/admin). NO enlaza gestion; fuera del criterio de intento (160)
  "devolucion_rechazada", // feature 139: al APROBAR el cierre, rechazada -> por_devolver/por_devolver_a_tienda (actor admin). NO enlaza gestion; fuera del criterio de intento (160)
] as const satisfies readonly PrismaOrdenHistorialOrigenTipo[];

export type OrdenHistorialOrigenTipo = (typeof ORDEN_HISTORIAL_ORIGEN_TIPO_SEED)[number];

// Feature 67 (design §4.2, F1.4-a) — FAMILIAS de transicion que enlazan una gestion: una fila
// de historial con uno de estos `origen_tipo` SIEMPRE nace con `gestion_orden_id` poblado
// (`crearGestionYTransicionar` / `anularGestionYDevolverAGestion`, verificado). Fuente unica
// del predicado que desambigua la NULIDAD del enlace en el derivador de intentos:
//   - `gestion_orden_id IS NULL` + origen FUERA de esta familia = la transicion nunca vino de
//     una gestion (p. ej. `ajuste_estado`) -> CUENTA como intento (R25).
//   - `gestion_orden_id IS NULL` + origen DENTRO de esta familia = imposible al escribir ->
//     fila HUERFANA (la gestion se borro) -> NO cuenta (R26).
// El `satisfies` rompe el build si un valor deja de existir en el enum.
//
// AVISO (feature 160): las notas de abajo se escribieron cuando el criterio de intento era
// "destino = `devuelta`" a secas, y por eso concluian con "destino != `devuelta` -> no altera
// `contarIntentos`". Esa RAZON ya no es suficiente. El criterio vigente (160/R1, design §1.1) es:
//
//     (destino = `devuelta`)  OR  (destino = `reprogramada` AND origen_tipo = `gestion`)
//
// La CONCLUSION de cada nota sigue siendo cierta —ninguna de esas familias produce el par
// (`reprogramada`, `gestion`)— pero el razonamiento correcto es el de arriba, no "destino !=
// devuelta". Quien agregue una familia nueva debe comprobar AMBAS ramas, no solo la primera.
//
// Feature 99 (design §1.4): los dos valores nuevos NO entran aqui a proposito.
//   - `liberacion_devuelta_sla` (devuelta -> en_bodega_central/en_bodega_satelite) NUNCA enlaza una
//     gestion (`gestion_orden_id` siempre NULL), y su destino no es `devuelta`.
//   - `escalado_devuelta_sla` (devuelta -> rechazada) SI enlaza la gestion sintetica de la
//     Option A, pero su destino es `rechazada`, NO `devuelta`.
// Ninguno de los dos transiciona HACIA `devuelta` ni HACIA `reprogramada`, asi que no cae en
// NINGUNA de las dos ramas del criterio (160/R1) y dejarlos fuera de esta familia no altera
// `contarIntentos`.
//
// Feature 100 (design §1.1): los dos valores nuevos TAMPOCO entran aqui, por el mismo criterio.
//   - `reprogramacion_tienda` (devuelta -> reprogramada) SI enlaza una gestion sintetica
//     (`resultado = reprogramada`) y su destino SI es `reprogramada`, pero NO es `gestion`, asi que
//     la rama B del criterio (160/R1b/R2) lo deja fuera: la fila `devuelta` de esa misma orden
//     sigue VIGENTE y ya aporto ese intento (`reprogramarDesdeDevuelta` no anula la gestion
//     previa) — contarlo seria DOBLE CONTEO. Ademas su fila SIEMPRE nace con `gestion_orden_id`
//     poblado, con lo que la disambiguacion por-nulidad que aporta esta familia nunca se ejerce
//     sobre ella: dejarla fuera de ORIGEN_TIPOS_CON_GESTION es INOCUO (mismo precedente que
//     `escalado_devuelta_sla` de la 99).
//   - `recuperacion_manual` (devuelta -> en_bodega_central/en_bodega_satelite) NUNCA enlaza una gestion
//     (`gestion_orden_id` siempre NULL, molde de `liberacion_devuelta_sla`) y su destino no es
//     `devuelta` ni `reprogramada`.
//
// Feature 109 (design §2.2, R12): los dos valores nuevos TAMPOCO entran aqui, por el mismo criterio.
//   - `corte_sin_gestionar` (en_reparto -> sin_gestionar) y `liberacion_sin_gestionar`
//     (sin_gestionar -> en_bodega_central/en_bodega_satelite) NUNCA enlazan una gestion (nacen con
//     `gestion_orden_id = NULL`) y sus destinos no son `devuelta` ni `reprogramada`, asi que jamas
//     caen en el conteo de intentos. Dejarlos fuera es INOCUO.
//
// Feature 138/139: `recepcion_bodega_central` (en_ruta_bodega_central -> en_bodega_central,
// devolviendo_a_bodega_central -> por_devolver_a_tienda) y `devolucion_rechazada`
// (rechazada -> por_devolver/por_devolver_a_tienda) tampoco enlazan gestion y sus destinos no son
// `devuelta` ni `reprogramada`: fuera de las dos ramas del criterio.
export const ORIGEN_TIPOS_CON_GESTION = [
  "gestion",
  "deshacer_gestion",
] as const satisfies readonly OrdenHistorialOrigenTipo[];

/**
 * Feature 160 (D1, design §1.2/§1.3, R1b/R2) — familias de ORIGEN que, con destino
 * `reprogramada`, cuentan como INTENTO de entrega.
 *
 * Es una lista de **INCLUSION**, no de exclusion, y eso es un REQUISITO (R1), no un gusto:
 * con una lista negra (`origen_tipo NOT IN ('reprogramacion_tienda')`) cualquier familia
 * FUTURA que produzca `reprogramada` empezaria a contar sola, subiria el conteo, adelantaria
 * el escalado del cron SLA (99) y cobraria un `cobroRechazado` (56) antes de tiempo — en
 * silencio. Con la lista blanca, una familia nueva NO cuenta hasta que alguien lo decida aqui
 * explicitamente. Contar de menos retrasa el escalado (inofensivo); contar de mas es dinero
 * mal cobrado. Mismo razonamiento con el que la 67 resolvio las filas huerfanas.
 *
 * Por que SOLO `gestion`: el mapa cerrado de la 140 tiene EXACTAMENTE dos aristas con destino
 * `reprogramada`.
 *   - `#13` `en_reparto -> reprogramada` (familia `gestion`, mensajero): el mensajero FUE, no
 *     entrego y acordo nueva fecha. Es una VISITA real -> CUENTA.
 *   - `#22` `devuelta -> reprogramada` (familia `reprogramacion_tienda`, adminTienda): tramite
 *     de escritorio sobre una orden YA devuelta. `GestionOrdenRepository.reprogramarDesdeDevuelta`
 *     NO anula la gestion `devuelta` previa, asi que esa fila sigue vigente y YA conto el
 *     intento: contar tambien esta seria DOBLE CONTEO -> NO cuenta.
 * `deshacer_gestion` es la otra familia de `ORIGEN_TIPOS_CON_GESTION`, pero su unico destino
 * declarado es `en_reparto`: nunca produce `reprogramada`.
 *
 * El `satisfies` rompe el build si un valor deja de existir en el enum.
 */
export const ORIGEN_TIPOS_REPROGRAMADA_INTENTO = [
  "gestion",
] as const satisfies readonly OrdenHistorialOrigenTipo[];

// Exhaustividad frente al enum Prisma: si `OrdenHistorialOrigenTipo` gana un valor que no
// esta en el SEED, `Exclude<...>` deja de ser `never` y el build rompe.
type _EnsureExhaustive = Exclude<
  PrismaOrdenHistorialOrigenTipo,
  OrdenHistorialOrigenTipo
> extends never
  ? true
  : never;
const _exhaustive: _EnsureExhaustive = true;
void _exhaustive;

// Feature 49 (design §4.4) — DTO de UNA entrada de la linea de tiempo, ya resuelta a
// valores legibles (no UUIDs internos): `estatusOrigenValue` NULL = creacion (R1/R20);
// `actorNombre` NULL = sistema/cron (R21); `motivo` NULL cuando la transicion no viene de
// una gestion con motivo (R22). Ordenadas cronologicamente por el service (R26).
export interface OrdenHistorialEntradaDTO {
  estatusOrigenValue: string | null;
  estatusDestinoValue: string;
  origenTipo: OrdenHistorialOrigenTipo;
  actorNombre: string | null;
  motivo: string | null;
  createdAt: Date;
}
