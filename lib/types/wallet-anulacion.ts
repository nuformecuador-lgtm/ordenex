import { z } from "zod";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §4.2/§6, R63–R73, R82) — LA ANULACION UNIFORME: contratos de borde.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Un movimiento anulable se nombra por su DESTINO, nunca por un monto: o la fila de un libro
// (`{ libro, movimientoId }`) o el documento que la produjo (`{ documento, id }`). El servidor lee
// el original, decide por que camino se anula y lee el monto de ahi. Ningun schema de este archivo
// admite un importe: todos son `.strict()`, asi que un `monto` colado es `validation_error`.
//
// Los identificadores VIAJAN (son la direccion del dato) pero nunca se pintan ni se piden al
// usuario (H6 / D1): el cliente los recibe en la fila y los devuelve tal cual.

/** El destino de una accion sobre un movimiento: la fila de un libro o su documento. */
export const destinoMovimientoSchema = z.union([
  z
    .object({
      libro: z.enum(["caja", "tienda", "mensajero"]),
      movimientoId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      documento: z.enum([
        "liquidacion_pago",
        "pago_por_cuenta_tienda",
        "aporte_capital",
        "abono_tienda",
        "rechazo_tienda_cobro",
      ]),
      id: z.string().uuid(),
    })
    .strict(),
]);

export type DestinoMovimiento = z.infer<typeof destinoMovimientoSchema>;

/** R64 — anular: el destino y un motivo no vacio. Sin monto (R70 de la 172; lo lee el servidor). */
export const anularMovimientoSchema = z
  .object({
    destino: destinoMovimientoSchema,
    motivo: z.string().trim().min(1, "El motivo de la anulación es obligatorio."),
  })
  .strict();

export type AnularMovimientoInput = z.infer<typeof anularMovimientoSchema>;

/**
 * El camino por el que se anula un destino. Es lo que decide la action a la que se enruta (la 334
 * decidio no unificar el backend: `origen_tipo` decide que se anula y como). Viaja en la respuesta
 * para que la pantalla refresque lo que toca; nunca se pinta.
 */
export type CaminoAnulacion =
  | "egreso_caja" // sueldo, gasto de Ordenex, gasto fijo cobrado, indemnizacion (458-B)
  | "ajuste_caja" // correccion de caja (461)
  | "cobro_tienda" // cobro de Ordenex a una tienda (461)
  | "pago_por_cuenta_tienda" // pago de un gasto de una tienda (459)
  | "aporte_capital" // saldo inicial o aporte (459)
  | "abono_tienda" // pago de una tienda a Ordenex (457)
  | "liquidacion_pago" // pago de Ordenex a una tienda o a un mensajero (172)
  | "rechazo_tienda_cobro" // cobro por rechazo aprobado (458-B)
  | "premio_del_ranking"; // premio del ranking (293); no se llama `premio_ranking` para no confundirse con la categoria (guardia premio-ranking-alcance)

/** Por que un destino existente no se puede anular (R65). Texto para la pantalla en 458-C. */
export type MotivoNoAnulable =
  | "contra_asiento" // es la anulacion de otro movimiento
  | "nace_de_un_cierre" // lo produjo la aprobacion de un cierre
  | "reclasificado" // salida de un cobro reclasificado (459)
  | "no_aprobado" // un cobro por rechazo que no esta aprobado
  | "sin_linea_de_caja" // el cobro por rechazo no tiene su ingreso en la caja
  | "no_es_anulable"; // cualquier otra fila (automatica sin documento)

/**
 * El resultado NORMALIZADO de anular por la accion unica. Cada camino tiene el suyo (`not_found`,
 * `no_encontrado`, `already_reversed`…); aqui se reducen a una sola forma. Ninguna rama de error
 * viaja con filas ni importes.
 */
export type AnularMovimientoResult =
  | { status: "ok"; camino: CaminoAnulacion }
  | { status: "ya_anulado"; camino: CaminoAnulacion }
  | { status: "no_encontrado" }
  | { status: "no_anulable"; motivo: MotivoNoAnulable }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

// ── El camino nuevo de los egresos (D13) ────────────────────────────────────────────────────

/** Anular un egreso de caja sin documento propio: el movimiento ORIGINAL y el motivo. */
export const anularEgresoCajaSchema = z
  .object({
    movimientoId: z.string().uuid(),
    motivo: z.string().trim().min(1, "El motivo de la anulación es obligatorio."),
  })
  .strict();

export type AnularEgresoCajaInput = z.infer<typeof anularEgresoCajaSchema>;

export type AnularEgresoCajaResult =
  | { status: "ok" }
  | { status: "ya_anulado" }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

// ── El camino nuevo del cobro por rechazo (D7) ──────────────────────────────────────────────

/** Anular un cobro por rechazo aprobado: el COBRO (`rechazo_tienda_cobro.id`) y el motivo. */
export const anularCobroRechazoTiendaSchema = z
  .object({
    cobroId: z.string().uuid(),
    motivo: z.string().trim().min(1, "El motivo de la anulación es obligatorio."),
  })
  .strict();

export type AnularCobroRechazoTiendaInput = z.infer<typeof anularCobroRechazoTiendaSchema>;

export type AnularCobroRechazoTiendaResult =
  | {
      status: "ok";
      /** El flete anulado (el monto de su linea en la caja), STRING escala 2. */
      montoFlete: string;
      /** El IVA anulado, o `null` si el cobro no tenia IVA (una tarifa con 0 % no deja linea). */
      montoIva: string | null;
      /** `true` si la tienda tenia los debitos y recibio sus creditos espejo. */
      creditosEnLaTienda: boolean;
    }
  | { status: "ya_anulado" }
  | { status: "no_encontrado" }
  | { status: "no_anulable"; motivo: Extract<MotivoNoAnulable, "no_aprobado" | "sin_linea_de_caja"> }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
