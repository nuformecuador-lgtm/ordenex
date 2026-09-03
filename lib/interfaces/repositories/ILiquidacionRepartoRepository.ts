import type { PrismaClient } from "@prisma/client";

// Feature 205 (design §1.1/§5.1, D-D) — contrato del repositorio del ACTO de repartir. Solo
// queries Prisma; sin logica de negocio, sin guardias de rol y sin decidir cuanto se reparte.
// Money-safe: el monto entra y sale como STRING de escala 2, nunca como number.

/**
 * Cliente de transaccion que consume la escritura del reparto. Va acotado con `Pick` (patron
 * `LiquidacionPagoTxClient`): quien lo recibe puede insertar la fila del acto y NADA MAS — en
 * particular, no puede tocar `liquidacion_pago` ni `cierre_dia` desde aqui.
 *
 * Lo satisface tanto el `tx` de un `$transaction` interactivo como el `PrismaClient` completo.
 */
export type LiquidacionRepartoTxClient = Pick<
  PrismaClient,
  // Ficha 362 (R9): el registro del acto, en la MISMA tx que el acto.
  "liquidacionReparto" | "historialAccion" | "usuario"
>;

/**
 * Las CUATRO columnas del acto que decide el emisor. El `id` y el instante los pone la base
 * (`created_at DEFAULT now()`), igual que en `liquidacion_pago`.
 *
 * `montoTotal` es lo COMPROMETIDO en la captura, no la suma de lo que acabo imputandose: las dos
 * cifras coinciden por construccion (o la operacion entera se revierte, R20) y la segunda NO se
 * guarda duplicada — derivarla es una suma sobre `liquidacion_pago`.
 */
export interface CrearLiquidacionRepartoInput {
  claveIdempotencia: string;
  mensajeroId: string;
  montoTotal: string; // STRING 2 dec -> Prisma.Decimal en la impl (money-safe)
  registradoPor: string;
}

/**
 * El acto leido. Lleva `mensajeroId` y `registradoPor` porque el SERVICIO los necesita para
 * reconstruir la respuesta idempotente y para comprobar que el reparto releido es el del
 * mensajero que se pide (R28); el DTO que cruza a la pantalla no emite ningun id de persona
 * (R48) y se compone en el servicio, no aqui.
 */
export interface LiquidacionRepartoDTO {
  id: string;
  claveIdempotencia: string;
  mensajeroId: string;
  montoTotal: string; // STRING 2 dec
  registradoPor: string;
  registradoAt: string; // ISO — instante del registro
}

/**
 * R29 — el choque de `clave_idempotencia` es un RESULTADO, no una excepcion que suba. La barrera
 * es DE DATOS (el `UNIQUE` de la columna): no hay `SELECT` previo que decida si insertar, asi que
 * no hay ventana TOCTOU. Es la MISMA forma que `CrearLiquidacionPagoResult`, y a proposito: quien
 * recibe `clave_repetida` relee el reparto por su clave —FUERA de la transaccion, que en Postgres
 * queda abortada— y responde `ya_registrado` con el resultado original.
 */
export type CrearLiquidacionRepartoResult =
  | { status: "creado"; reparto: LiquidacionRepartoDTO }
  | { status: "clave_repetida" };

export interface ILiquidacionRepartoRepository {
  /**
   * §5.1 — inserta la fila del acto en `tx`, la PRIMERA de la transaccion y antes de mover un
   * centimo; traduce el choque de la clave en `clave_repetida`. **Nunca lanza por ese motivo**:
   * un segundo envio es un desenlace previsto (doble clic, reintento tras un timeout), no un
   * fallo. Cualquier otro error se propaga.
   */
  crear(
    tx: LiquidacionRepartoTxClient,
    input: CrearLiquidacionRepartoInput,
  ): Promise<CrearLiquidacionRepartoResult>;
  /**
   * FICHA 362 (R6/R9) — registra `reparto_anulado`: UNA fila por acto de deshacer un reparto.
   *
   * NO muta `liquidacion_reparto` —esa fila es INMUTABLE (R52)— y no puede: la mutacion que
   * documenta son las N anulaciones de sus `liquidacion_pago` hijos, que ocurren en la MISMA
   * transaccion que este metodo recibe. Existe para que deshacer un reparto de 12 cierres deje
   * UNA linea de auditoria y no doce.
   */
  registrarAnulacion(
    tx: LiquidacionRepartoTxClient,
    input: { repartoId: string; anuladoPor: string; montoAnulado: string },
  ): Promise<void>;
  /**
   * §5.1/R28 — relectura idempotente por la clave del cliente. `null` si esa clave no se uso.
   *
   * Va con el cliente PROPIO del repositorio y no admite `tx`, y eso no es un olvido: la unica
   * situacion que la necesita es el choque de la clave, y en Postgres un error de sentencia deja
   * la transaccion ABORTADA — ninguna lectura posterior sobreviviria dentro de ella. La relectura
   * ocurre necesariamente FUERA.
   */
  obtenerPorClave(claveIdempotencia: string): Promise<LiquidacionRepartoDTO | null>;
}
