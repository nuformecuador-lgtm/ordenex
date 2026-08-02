import type { PrismaClient } from "@prisma/client";
import type { AnulacionDTO, MetodoLiquidacion } from "@/lib/types/liquidacion";

// Feature 172 (design §3.1) — contrato del repositorio del DOCUMENTO del pago. Solo queries
// Prisma; sin logica de negocio, sin guardias de rol y sin decidir cuanto se puede pagar.
// Money-safe: los montos entran y salen como STRING de escala 2, nunca como number.

/**
 * Cliente de transaccion que consumen las escrituras y el candado: `liquidacionPago` para el
 * documento y `$queryRaw` para el `SELECT … FOR UPDATE` de §4.2. Lo satisface tanto el `tx` de
 * un `$transaction` interactivo como el `PrismaClient` completo.
 */
export type LiquidacionPagoTxClient = Pick<PrismaClient, "liquidacionPago" | "$queryRaw">;

/**
 * §4.2 [P1] — QUE fila se bloquea, y el grano difiere a proposito:
 *
 * - pago a un mensajero: la fila de `cierre_dia`. Lo que se consume es el pendiente de UN
 *   cierre, asi que dos pagos a cierres distintos del mismo mensajero no se estorban, y no se
 *   toca `usuario`, que es fila caliente (sesiones, perfil).
 * - pago a una tienda: la fila de `usuario`. Lo que se consume es el saldo de la tienda
 *   entera; no hay unidad mas fina que bloquear.
 *
 * La anulacion (Tanda F) tomara EXACTAMENTE el mismo bloqueo que tomaria su pago (R84).
 */
export type BeneficiarioBloqueo =
  | { tipo: "tienda"; tiendaId: string }
  | { tipo: "cierre"; cierreId: string };

/**
 * Las 10 columnas del documento (R7): monto, metodo, referencia, nota, fecha real, el
 * beneficiario (XOR mensajero/tienda), el cierre cuando lo hay, el actor y la clave de
 * idempotencia. El instante de registro lo pone la base (`created_at DEFAULT now()`, R9).
 *
 * `fechaPago` viaja como `Date` —medianoche UTC del dia, `medianocheUtcDelDia`— porque la
 * columna es `@db.Date`; el STRING `YYYY-MM-DD` es cosa del borde.
 */
export interface CrearLiquidacionPagoInput {
  claveIdempotencia: string;
  mensajeroId: string | null;
  tiendaId: string | null;
  cierreId: string | null;
  monto: string; // STRING 2 dec -> Prisma.Decimal en la impl (money-safe)
  metodo: MetodoLiquidacion;
  referencia: string | null;
  nota: string | null;
  fechaPago: Date;
  registradoPor: string;
}

/**
 * El documento leido, con los NOMBRES ya resueltos (R56: la frontera no emite ids de personas)
 * y el bloque de anulacion si existe (R74). `anulacion === null` es lo que significa VIGENTE:
 * el estado se DERIVA de que exista la fila, no de un flag (design §2.2).
 *
 * Lleva `mensajeroId`/`tiendaId`/`cierreId` porque el SERVICIO los necesita para saber contra
 * que dinero va el pago; el DTO que cruza a la pantalla (`PagoRegistradoDTO`) los deja fuera.
 */
export interface LiquidacionPagoDTO {
  id: string;
  mensajeroId: string | null;
  tiendaId: string | null;
  cierreId: string | null;
  monto: string; // STRING 2 dec
  metodo: MetodoLiquidacion;
  referencia: string | null;
  nota: string | null;
  fechaPago: string; // "YYYY-MM-DD" — fecha REAL del pago
  registradoPorNombre: string;
  registradoAt: string; // ISO — instante de registro
  anulacion: AnulacionDTO | null;
}

/**
 * §4.1/R43/R44/R47 — el conflicto de `clave_idempotencia` es un RESULTADO, no una excepcion que
 * suba. La barrera es de datos (el `UNIQUE` de la columna): no hay `SELECT` previo que decida
 * si insertar, asi que no hay ventana TOCTOU. Quien recibe `clave_repetida` relee el pago por
 * su clave y responde `ya_registrado` con el MISMO comprobante.
 */
export type CrearLiquidacionPagoResult =
  | { status: "creado"; pago: LiquidacionPagoDTO }
  | { status: "clave_repetida" };

export interface ILiquidacionPagoRepository {
  /**
   * §4.2 (R83/R85) — `SELECT … FOR UPDATE` sobre la fila del beneficiario, DENTRO de `tx` y
   * ANTES de leer el disponible. Un candado tomado despues de la lectura no serializa nada.
   * UNO por operacion (R85): al no haber dos recursos que ordenar, no existe orden de
   * adquisicion capaz de producir un interbloqueo. Se libera al cerrar la transaccion.
   */
  bloquearBeneficiario(tx: LiquidacionPagoTxClient, objetivo: BeneficiarioBloqueo): Promise<void>;
  /** R7/R9: inserta el documento en `tx`; traduce el choque de la clave en `clave_repetida`. */
  crear(
    tx: LiquidacionPagoTxClient,
    input: CrearLiquidacionPagoInput,
  ): Promise<CrearLiquidacionPagoResult>;
  /** §4.1: relectura idempotente por la clave del cliente. `null` si esa clave no se uso. */
  obtenerPorClave(claveIdempotencia: string): Promise<LiquidacionPagoDTO | null>;
  /** R70: el pago leido SERVER-SIDE por su id (lo que necesita la anulacion). */
  obtenerPorId(id: string): Promise<LiquidacionPagoDTO | null>;
  /**
   * §5/R80 — Σ de los pagos VIGENTES de cada cierre pedido, en UNA consulta para toda la
   * pagina. «Vigente» = SIN fila en `liquidacion_anulacion`. Devuelve una entrada por CADA id
   * pedido: los cierres sin pagos vienen con `"0.00"`, para que el caller no tenga que
   * distinguir «no hay» de «no lo pedi».
   */
  sumarVigentesPorCierre(cierreIds: string[]): Promise<Record<string, string>>;
  /** §5/R80: Σ de los pagos VIGENTES de una tienda (sin cierre: contra el saldo acumulado). */
  sumarVigentesPorTienda(tiendaId: string): Promise<string>;
  /** R49: los comprobantes de un cierre, anulados incluidos y marcados (R74). */
  listarPorCierre(cierreId: string): Promise<LiquidacionPagoDTO[]>;
  /** R50: los comprobantes de una tienda, anulados incluidos y marcados (R74). */
  listarPorTienda(tiendaId: string): Promise<LiquidacionPagoDTO[]>;
}
