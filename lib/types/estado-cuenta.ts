import { z } from "zod";

import type { MetodoPagoValue } from "@prisma/client";

import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import { estadoCuentaConfig } from "@/lib/config/estado-cuenta";
import { BUSQUEDA_LIBRO_MAX_CHARS, BUSQUEDA_LIBRO_MIN_CHARS, CAMPOS_ORDEN_LIBRO } from "@/lib/config/libro-wallet";
import { esquemaOrdenamiento } from "@/lib/types/ordenamiento-listado";
import type { OrigenLegibleDTO } from "@/lib/types/wallet-origen";
import type { ModoBusquedaLibro } from "@/lib/types/busqueda-por-guia";
import { diaCalendarioSchema } from "@/lib/types/filtro-dias-cr";
import type { DestinoMovimiento } from "@/lib/types/wallet-anulacion";
import type { DesgloseTiendaDTO } from "@/lib/types/wallet-tienda";
import { CHIPS_BODEGA, CHIPS_MENSAJERO, CHIPS_TIENDA, type ChipEstadoCuenta } from "@/lib/utils/estado-cuenta-chips";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §3.2/§6, R16–R25, R81) — EL ESTADO DE CUENTA de una tienda, un mensajero o una
// bodega satelite: contratos de borde.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Montos SIEMPRE STRING escala 2 (R90); fechas `YYYY-MM-DD` del calendario de Costa Rica (R16) con las
// piezas de la 461 (`diaCalendarioSchema`; el servicio convierte con `inicioDelDiaCREnUtc` /
// `inicioDelDiaSiguienteCREnUtc`: `desde` inclusivo, `hasta` cota exclusiva del dia siguiente).
//
// LOS IDENTIFICADORES VIAJAN Y NO SE PINTAN (H6/D1): `cuenta.id`, `ref` y `consolidacionId` son la
// direccion del dato. El NOMBRE del concepto no va aqui: la fila lleva `categoria` y la pantalla la
// rotula con los diccionarios de la 461 (una sola fuente de textos). El ORIGEN si baja compuesto
// (`origen`, 458-D servidor): nombrar su entidad exige leerla, y eso solo lo puede hacer el servidor.

export const TIPOS_DE_CUENTA = ["tienda", "mensajero", "bodega"] as const;
export type TipoDeCuenta = (typeof TIPOS_DE_CUENTA)[number];

const CHIPS = [...new Set<string>([...CHIPS_TIENDA, ...CHIPS_MENSAJERO, ...CHIPS_BODEGA])] as [
  ChipEstadoCuenta,
  ...ChipEstadoCuenta[],
];

const cuentaSchema = z.object({ tipo: z.enum(TIPOS_DE_CUENTA), id: z.string().uuid() }).strict();

/**
 * Los filtros del extracto, comunes a la oficina y a `/mi-wallet`.
 *
 * FICHA 458-D (servidor, R10–R12) — `cierreId`: el cierre elegido en el selector
 * (`cierresDeLaCuentaAction` en la oficina, `listarMisCierresAction` en `/mi-wallet`). Solo forma de
 * identificador (R12: el borde rechaza lo demas); el `WHERE` lo compone SIEMPRE dentro de la cuenta
 * consultada, asi que un cierre de otra cuenta no devuelve ninguna fila. En una bodega no hay cierres
 * de mensajero: el servicio lo rechaza como `validation_error`. Como el chip, filtra FILAS: el saldo
 * corrido sigue siendo el de la cuenta entera (R21) y las tarjetas, las del periodo.
 */
const filtrosDelExtracto = {
  desde: diaCalendarioSchema.optional(),
  hasta: diaCalendarioSchema.optional(),
  /** Ausente = «Todo». Un chip que no es de ESE tipo de cuenta lo rechaza el servicio (`validation_error`). */
  chip: z.enum(CHIPS).optional(),
  cierreId: z.string().uuid().optional(),
  /**
   * FICHA 463 (design §2.2, R24/R26/R27) — el termino del buscador del libro. Como el chip, filtra
   * FILAS despues de la ventana: el saldo corrido sigue siendo el de la cuenta entera y las tarjetas,
   * las del periodo (R11). Por debajo del minimo es `validation_error` (la pantalla no lo manda).
   */
  q: z.string().trim().min(BUSQUEDA_LIBRO_MIN_CHARS).max(BUSQUEDA_LIBRO_MAX_CHARS).optional(),
  /**
   * FICHA 463 (R33/R34/R40) — el orden del libro: solo por fecha, por defecto lo mas nuevo primero.
   * El default vive AQUI para que el Server Component que pre-lee la pagina 1 la reciba ya en «Mas
   * recientes» sin tocar su `page.tsx` (R47). Solo cambia el `ORDER BY` final, nunca la ventana del
   * corrido (R37).
   */
  ...esquemaOrdenamiento(CAMPOS_ORDEN_LIBRO, "fecha", "desc"),
};

const paginacion = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(estadoCuentaConfig.MAX_PAGE_SIZE).default(estadoCuentaConfig.PAGE_SIZE),
};

const periodoEnOrden = <T extends { desde?: string; hasta?: string }>(v: T) =>
  v.desde === undefined || v.hasta === undefined || v.desde <= v.hasta;
const MENSAJE_PERIODO = { message: "«Desde» no puede ser posterior a «hasta».", path: ["hasta"] };

export const estadoCuentaSchema = z
  .object({ cuenta: cuentaSchema, ...filtrosDelExtracto, ...paginacion })
  .strict()
  .refine(periodoEnOrden, MENSAJE_PERIODO);

export type EstadoCuentaInput = z.infer<typeof estadoCuentaSchema>;

/**
 * FICHA 458-D (servidor, TD.6/R32) — el periodo filtrado ENTERO, para la descarga: los mismos filtros
 * sin `page`/`pageSize` (`.strict()` los rechaza: este modo no pagina). El tope lo aplica el SERVIDOR
 * (`descargaConfig.MAX_FILAS`, patron de la 170): por encima, `limite_excedido` sin ninguna fila.
 */
export const estadoCuentaCompletoSchema = z
  .object({ cuenta: cuentaSchema, ...filtrosDelExtracto })
  .strict()
  .refine(periodoEnOrden, MENSAJE_PERIODO);

export type EstadoCuentaCompletoInput = z.infer<typeof estadoCuentaCompletoSchema>;

/**
 * FICHA 458-D (servidor, R34/R36) — el estado de cuenta de `/mi-wallet`. SIN `cuenta`: la tienda es la
 * de la SESION, resuelta en el servidor. Cualquier clave que nombre una cuenta (`cuenta`, `tiendaId`)
 * muere aqui con `validation_error` sin leer nada (`.strict()`, R36).
 */
export const miEstadoCuentaSchema = z
  .object({ ...filtrosDelExtracto, ...paginacion })
  .strict()
  .refine(periodoEnOrden, MENSAJE_PERIODO);

export type MiEstadoCuentaInput = z.infer<typeof miEstadoCuentaSchema>;

/** El de `/mi-wallet` sin paginar, para su descarga (mismo tope en el servidor). */
export const miEstadoCuentaCompletoSchema = z
  .object({ ...filtrosDelExtracto })
  .strict()
  .refine(periodoEnOrden, MENSAJE_PERIODO);

export type MiEstadoCuentaCompletoInput = z.infer<typeof miEstadoCuentaCompletoSchema>;

/**
 * FICHA 458-D (servidor, R19, 344) — las ORDENES que componen el importe de UNA fila del estado de
 * cuenta de una tienda o de un mensajero, en la oficina. La fila se nombra por su cuenta y su
 * movimiento; el movimiento se lee CON la cuenta en el `WHERE` (uno de otra cuenta = inexistente) y,
 * en la tienda, las ordenes tambien (el cierre mezcla tiendas). Pagina y tope de la ficha 344.
 */
export const ordenesDeFilaSchema = z
  .object({
    cuenta: z.object({ tipo: z.enum(["tienda", "mensajero"]), id: z.string().uuid() }).strict(),
    movimientoId: z.string().uuid(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(detalleMovimientoConfig.MAX_PAGE_SIZE)
      .default(detalleMovimientoConfig.DEFAULT_PAGE_SIZE),
    /**
     * FICHA 469 (design §4.1, R25–R29) — el termino del libro, para destacar la guia buscada. Mismo
     * esquema que `q` (recortado, minimo y maximo de `lib/config/libro-wallet`). La pantalla lo manda SOLO
     * si la ultima lectura del libro volvio con `modoBusqueda === "guia"`; si el termino no identifica
     * ninguna orden del alcance, el detalle sale igual que sin el (R28).
     */
    resaltar: z.string().trim().min(BUSQUEDA_LIBRO_MIN_CHARS).max(BUSQUEDA_LIBRO_MAX_CHARS).optional(),
  })
  .strict();

export type OrdenesDeFilaInput = z.infer<typeof ordenesDeFilaSchema>;

/** Quien le debe a quien (R18). La pantalla compone la frase con sus textos. */
export type SentidoDelSaldo =
  | "ordenex_debe" // saldo a favor del titular (tienda / mensajero)
  | "cuenta_debe" // la tienda le debe a Ordenex (saldo en contra)
  | "por_entregar" // la bodega tiene efectivo por entregar
  | "en_cero";

/** R57 — quien registro la fila: una persona, o una accion automatica (con quien la decidio). */
export interface RegistroDTO {
  nombre: string | null;
  automatico: {
    accion: "aprobacion_cierre" | "plantilla_gasto_fijo" | "cobro_por_rechazo" | "incidente" | "premio_del_ranking" | "sistema";
    por: string | null;
  } | null;
}

/** R25/R71/R72 — la anulacion de una fila ORIGINAL, decidida en el servidor. */
export interface AnulacionDeFilaDTO {
  /** `null` = anulada por una via de antes de la 458 sin constancia («motivo no registrado», R72). */
  motivo: string | null;
  por: string | null;
  /** Dia CR de la anulacion. */
  fecha: string | null;
  /**
   * FICHA 458-D (revision m3, R25 en `/mi-wallet`) — la hora de pared de Costa Rica («HH:mm») de la
   * anulacion; `null` junto con `fecha`. La tienda ve «Anulado por Ordenex» con el dia y la hora, sin
   * el nombre de la persona (decision del leader, 2026-09-26).
   */
  hora: string | null;
}

export interface FilaEstadoCuentaDTO {
  /** El destino para «Ver» / «Anular…» / comprobante. `null` en las filas de una bodega. */
  ref: DestinoMovimiento | null;
  /** Solo bodega: la consolidacion (marcar/desmarcar recibido). Viaja, no se pinta. */
  consolidacionId: string | null;
  /** Dia CR del movimiento (R16). */
  fecha: string;
  categoria: string;
  origenTipo: string;
  /**
   * FICHA 458-D (servidor, R6–R8) — el origen con su ENTIDAD (el cierre con su dia y, para la oficina,
   * su mensajero; el pago con su dia y metodo; la guia…) y, si el rol que mira accede a esa pantalla,
   * el enlace. Lo compone `OrigenLegibleService` (458-A) con el diccionario del libro. El id viaja SOLO
   * en `enlace.href`. `null` solo en las filas de una bodega (su origen es la consolidacion, que ya
   * nombra el chip Declarado/Recibido).
   */
  origen: OrigenLegibleDTO | null;
  /**
   * FICHA 458-D (servidor) — el METODO y la REFERENCIA del documento de pago de la fila ORIGINAL: el
   * pago de la 172 (a una tienda o a un mensajero), el pago de un gasto de la tienda (459) y el pago
   * de la tienda a Ordenex (457). `null` en toda otra fila (cierres, cobros, correcciones,
   * contra-asientos). `referencia` es texto libre tal como se guardo (`null` si no se dio).
   */
  pago: { metodo: MetodoPagoValue; referencia: string | null } | null;
  /** Descripcion / motivo del movimiento, tal como se guardo (texto libre). */
  descripcion: string | null;
  registro: RegistroDTO;
  /** En contra del titular, o `null`. STRING escala 2. */
  cargo: string | null;
  /** A favor del titular, o `null`. STRING escala 2. */
  abono: string | null;
  /** R21 — el saldo de la cuenta COMPLETA inmediatamente despues de esta fila, sea cual sea el chip. */
  saldoCorrido: string;
  chip: ChipEstadoCuenta;
  anulacion: AnulacionDeFilaDTO | null;
  esContraAsiento: boolean;
  tieneComprobante: boolean;
  /** R65 — se ofrece «Anular…» (original, vigente y no nacida de un cierre). */
  anulable: boolean;
  naceDeUnCierre: boolean;
}

export interface EstadoCuentaDTO {
  cuenta: { tipo: TipoDeCuenta; id: string; nombre: string };
  /** R18 — el saldo HOY de la cuenta entera (sin periodo), con su signo y su sentido. */
  saldoActual: string;
  signo: "positivo" | "negativo" | "cero";
  sentido: SentidoDelSaldo;
  /** R20 — el saldo al terminar el dia CR anterior a `desde` ("0.00" sin `desde`). */
  saldoInicial: string;
  /** D3 — abonos y cargos del periodo SIN los pares anulados dentro del periodo. */
  abonos: string;
  cargos: string;
  /** R22 — saldoInicial ± abonos/cargos: el saldo al terminar el periodo. */
  saldoFinal: string;
  /**
   * FICHA 458-D (cierre, 172 R55/N1) — el RESUMEN DE TRES CIFRAS de `/mi-wallet` («A tu favor»,
   * «Cargos de Ordenex», «Ya pagado»): la cuenta ENTERA de la tienda, sin periodo, chip ni cierre,
   * clasificada por `derivarDesgloseTienda` (la MISMA funcion que la cabecera del maestro, 171) y
   * leida en la MISMA transaccion que el saldo actual. El servicio AFIRMA `resumen.saldo ===
   * saldoActual` antes de responder. Son cifras BRUTAS (N1: el pago anulado sigue en «Ya pagado» y su
   * devolucion en «A tu favor»); el saldo sale exacto. `null` en toda lectura que no sea la de la
   * propia tienda (`leerMiTienda{,Completo}`).
   */
  resumen: DesgloseTiendaDTO | null;
  filas: FilaEstadoCuentaDTO[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * FICHA 469 (design §2.4, R21/R23) — como resolvio el servidor el termino (`q`): `guia` (solo los
   * movimientos a los que esa orden aporta) o `texto` (la busqueda de la 463). AUSENTE si la lectura no
   * llevaba termino. En la bodega satelite es siempre `texto` (R36).
   */
  modoBusqueda?: ModoBusquedaLibro;
}

export type VerEstadoCuentaResult =
  | { status: "ok"; estado: EstadoCuentaDTO }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

/**
 * FICHA 458-D (servidor, TD.6/R32) — el periodo filtrado ENTERO. En `ok`, `estado.filas` son TODAS las
 * del periodo y el chip/cierre (`page` 1, `pageSize` = `total`); por encima del tope, `limite_excedido`
 * con SOLO los conteos: nunca un archivo al que le falten filas.
 */
export type VerEstadoCuentaCompletoResult =
  | Exclude<VerEstadoCuentaResult, { status: "ok" }>
  | { status: "ok"; estado: EstadoCuentaDTO }
  | { status: "limite_excedido"; total: number; limite: number };
