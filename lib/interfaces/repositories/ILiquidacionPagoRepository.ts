import type { CierreEstado, PrismaClient } from "@prisma/client";
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
 * Cliente para LEER el cierre. Va aparte del de arriba a proposito: `cierre_dia` es una tabla
 * AJENA a esta feature y lo unico que se hace con ella es leer (R42 — ningun snapshot del
 * cierre se toca). Tenerlo en un tipo propio deja escrito que el documento y el cierre son dos
 * accesos distintos, y que el segundo es de solo lectura.
 */
export type LiquidacionCierreTxClient = Pick<PrismaClient, "cierreDia">;

/**
 * Cliente para escribir la ANULACION (T F.1). Va aparte del del documento por la misma razon
 * que el del cierre: son dos tablas distintas y el tipo deja escrito que anular NO abre la
 * puerta de `liquidacionPago`. Quien recibe este cliente puede insertar el contraasiento
 * documental y nada mas — en particular, no puede tocar la fila del pago (R41/R74).
 */
export type LiquidacionAnulacionTxClient = Pick<PrismaClient, "liquidacionAnulacion">;

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
  /**
   * Feature 205 (T2.2, R28) — el ACTO del que nace este pago, o `null` si no nace de ninguno.
   *
   * Es OBLIGATORIO en el input y nullable en la columna, y las dos cosas a la vez son
   * deliberadas: nullable porque un pago contra UN cierre desde `/cierres-admin` no pertenece a
   * ningun reparto (R51, cero backfill); obligatorio en el tipo porque asi TODO camino de
   * escritura tiene que declarar a que grupo pertenece lo que escribe. Un campo opcional dejaria
   * que un escritor futuro se olvidara de atarlo y el reparto quedaria irreconstruible (R28).
   */
  repartoId: string | null;
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
 * R20/R21/R22 — lo MINIMO del cierre que el pago al mensajero necesita, y nada mas:
 *
 * - `estado`: el pago solo entra si esta `aprobado` (R20). Se lee del cierre, no del input.
 * - `mensajeroId`: el BENEFICIARIO sale de aqui, nunca de la peticion (R5/R21). El cliente
 *   manda el cierre; a quien se le paga lo decide el servidor leyendo ese cierre.
 * - `totalPagoMensajero` (P) y `totalEfectivo` (E): los dos SNAPSHOT del propio cierre, que es
 *   de donde `derivarPendienteCierre` saca lo devengado sin tocar el libro (§5).
 *
 * Los dos montos salen como STRING de escala 2 (money-safe), igual que el resto del repo.
 */
export interface CierreParaPagoDTO {
  id: string;
  mensajeroId: string;
  estado: CierreEstado;
  totalPagoMensajero: string; // P — STRING 2 dec (snapshot de la 39)
  totalEfectivo: string; // E — STRING 2 dec (snapshot de la 37)
}

/**
 * Feature 205 (T2.2, R5/R6/R8) — lo mismo de arriba MAS la ANTIGUEDAD, que es lo unico que el
 * reparto necesita y el pago contra un cierre no: `solicitado_at` es el dia TRABAJADO y es el
 * criterio del FIFO de R8 (Q1, design §2.4). NO se emite `resuelto_at`: ordenar por la fecha de
 * aprobacion haria que la prioridad de cobro la fijara la latencia administrativa, y no emitirla
 * es lo que impide que alguien la use por descuido.
 *
 * El pendiente NO viene aqui: se DERIVA en el servicio con `derivarPendienteCierre` a partir de
 * estos dos snapshots y de la Σ de pagos vigentes (R6). Un `pendiente` calculado en el
 * repositorio seria logica de negocio en la capa equivocada, y ademas dos derivaciones distintas
 * del mismo numero.
 */
export interface CierreImputableDTO extends CierreParaPagoDTO {
  solicitadoAt: string; // ISO — la antiguedad de R8 (el dia trabajado)
}

/**
 * Feature 205 (T3.1, R36 — enmienda de negocio) — CUANTOS cierres del mensajero quedan fuera del
 * reparto por no estar `aprobado`, agrupados por el estado que los deja fuera: «9 rechazados,
 * 3 solicitados».
 *
 * **Es un CONTEO por estado, y nunca una lista.** Es una decision de negocio, no una
 * optimizacion: el aviso de R36 existe para transmitir «hay dinero que no estas pagando aqui, y
 * por que», no para inventariar. El inventario ya vive en `/cierres-admin`, que es adonde lleva
 * el enlace de la pantalla. La primera version devolvia una fila por cierre y **no tenia tope**:
 * un mensajero con dos años de cierres rechazados se los llevaba todos a la previsualizacion.
 * Asi queda acotado **POR CONSTRUCCION** —el tamaño depende del numero de valores de
 * `CierreEstado`, que es un puñado, no del numero de cierres— y por eso no hace falta ningun
 * `take` ni recorte que pueda quedarse corto.
 *
 * **LO QUE SE PIERDE, y se acepta a sabiendas:** con un conteo ya no se puede nombrar un cierre
 * concreto en el aviso. Antes viajaba tambien `solicitadoAt`, literalmente «para nombrarlo en
 * pantalla», y ya no viaja. Es el precio de que la respuesta este acotada, y esta pagado a
 * proposito. **Devolver otra vez la lista para poder nombrarlos deshace la decision, no arregla
 * un olvido**: quien necesite el detalle abre `/cierres-admin`.
 *
 * **NO lleva ningun monto, y esa ausencia sigue siendo el diseño** (design §7.2/§10.2): un
 * cierre no aprobado no ha devengado nada todavia —el libro del mensajero se escribe AL APROBAR—
 * y la 172 enseña `null` como su pendiente a proposito. Sin montos aqui no hay forma de que una
 * cifra inventada llegue a la pantalla por descuido. Un conteo no es un monto.
 *
 * El `estado` viaja porque R36 exige decir POR QUE quedan fuera: «no aparecen» y «aparecen como
 * rechazados» son dos cosas distintas para quien mira si le pagaron todo.
 */
export interface CierresNoAprobadosPorEstadoDTO {
  estado: CierreEstado;
  cantidad: number; // CARDINAL: cuenta cierres, no dinero
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

/**
 * T F.1 (R73) — las TRES columnas de la anulacion que decide el emisor. El `id` y el instante
 * los pone la base (`created_at DEFAULT now()`), igual que en el pago.
 *
 * **NO lleva monto** y no es un olvido: el del contraasiento se lee del pago original en el
 * servidor (R70). Un `monto` aqui seria la puerta por la que el cliente dictaria cuanto se
 * devuelve al libro, es decir, una via para escribir cualquier cifra.
 *
 * Tampoco lleva nada que permita anular a MEDIAS (R76): se anula el pago entero o no se anula.
 */
export interface AnularLiquidacionPagoInput {
  pagoId: string;
  motivo: string;
  anuladoPor: string;
}

/**
 * R75 — el segundo intento de anular el mismo pago es un RESULTADO, no una excepcion que suba:
 * es un desenlace previsto (dos pestañas, doble clic, un reintento tras un timeout), no un
 * fallo. Quien lo recibe responde `ya_anulado` con el comprobante ya anulado.
 *
 * La barrera es DE DATOS —el `UNIQUE(pago_id)` de `liquidacion_anulacion`—, no un `if` previo:
 * no hay `SELECT` que decida si insertar, asi que no hay ventana TOCTOU entre comprobar y
 * escribir. Es la misma forma que `CrearLiquidacionPagoResult` da a la clave de idempotencia.
 */
export type AnularLiquidacionPagoResult =
  | { status: "anulado"; anulacion: AnulacionDTO }
  | { status: "ya_anulado" };

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
  /**
   * R20/R21/R22 — lee el cierre contra el que se paga. `null` si no existe.
   *
   * **`tx` no es un adorno.** La guardia de R20 («el cierre esta aprobado») solo vale si se lee
   * DENTRO de la misma transaccion y DESPUES del candado: leida fuera, un cierre podria cambiar
   * de estado entre la comprobacion y la escritura del pago. Por eso el camino del registro
   * pasa SIEMPRE el `tx`, y hay un test que afirma que es el mismo objeto que recibe el candado.
   *
   * Sin `tx` (cliente propio del repositorio) queda la relectura de la rama IDEMPOTENTE, que
   * ocurre necesariamente fuera: en Postgres, el choque de la clave deja la transaccion
   * abortada y ninguna sentencia posterior sobreviviria dentro de ella.
   *
   * SOLO LEE (R42): en este repositorio no existe ningun metodo que escriba en `cierre_dia`.
   */
  obtenerCierreParaPago(
    cierreId: string,
    tx?: LiquidacionCierreTxClient,
  ): Promise<CierreParaPagoDTO | null>;
  /**
   * Feature 205 (T2.2, R5/R6/R8) — los cierres `aprobado` de UN mensajero, ordenados
   * `solicitado_at ASC, id ASC`.
   *
   * **SIN `take`/`LIMIT`, y es una decision, no un olvido** (design §2.5.6). El tope de R53 acota
   * la ESCRITURA (cuantos cierres se bloquean y se tocan), no la LECTURA: la previsualizacion
   * necesita TODOS los imputables para poder decir cuantos quedan fuera de la ventana y cuanto
   * suman (R56), y el aviso de deuda no imputable de R37 se mide contra el total. Son filas de
   * `cierre_dia` de un solo mensajero, leidas sin bloqueo.
   *
   * **El `estado: aprobado` va en el WHERE** (mitad de R5): un cierre `solicitado`, `rechazado` o
   * `vencido` no ha devengado nada todavia y no puede recibir un pago. La otra mitad —«pendiente
   * > 0»— NO se puede expresar aqui, porque el pendiente se DERIVA de los pagos vigentes (R6):
   * la resuelve el servicio.
   *
   * **El `orderBy` es EFICIENCIA, no la verdad del orden.** El criterio de R8 vive en
   * `ordenarCierresFifo` (`lib/utils/reparto-liquidacion-mensajero.ts`), que reordena lo que
   * reciba: asi el determinismo se prueba sin base de datos (R17) y no depende de que dos sitios
   * escriban el mismo `ORDER BY`. Aqui se ordena igual para que el motor entregue las filas ya
   * casi en su sitio.
   *
   * `tx` opcional por el mismo motivo que en `obtenerCierreParaPago`: la relectura bajo bloqueo
   * (R23) tiene que ocurrir DENTRO de la transaccion; la previsualizacion (R35) ocurre fuera.
   *
   * SOLO LEE (R26): no existe en esta clase ningun metodo que escriba en `cierre_dia`.
   */
  listarCierresImputables(
    mensajeroId: string,
    tx?: LiquidacionCierreTxClient,
  ): Promise<CierreImputableDTO[]>;
  /**
   * Feature 205 (T3.1, R36 — enmienda de negocio) — CUANTOS cierres del mensajero NO estan
   * `aprobado`, agrupados por estado. Solo salen los estados que tienen al menos un cierre, y el
   * orden es por `estado` para que dos llamadas iguales pinten igual.
   *
   * Es el complemento EXACTO de `listarCierresImputables`: aquel filtra `estado = aprobado`,
   * este `estado != aprobado`. Los dos juntos son todos los cierres del mensajero y ninguno se
   * cuenta dos veces — que es lo que R36 pide («que no desaparezcan en silencio»).
   *
   * **El conteo lo hace la BASE, con un `groupBy`, y eso es la mitad del contrato.** Traer las
   * filas y contarlas en el proceso daria el mismo numero y dejaria intacto el problema que esta
   * enmienda cierra: N filas sin tope viajando desde la base. Lo acotado no es lo que se devuelve,
   * es lo que se lee. Hay un test que exige el `groupBy` y que `findMany` NO se llame.
   *
   * **No emite montos** (`CierresNoAprobadosPorEstadoDTO`): ver el DTO. **No admite `tx`**: la
   * unica situacion que lo necesita es la PREVISUALIZACION, que ocurre fuera de toda transaccion
   * (R35); un parametro opcional invitaria a usarlo dentro de la escritura, donde no pinta nada.
   *
   * SOLO LEE (R26).
   */
  contarCierresNoAprobadosPorEstado(
    mensajeroId: string,
  ): Promise<CierresNoAprobadosPorEstadoDTO[]>;
  /**
   * Feature 205 (T2.2, R28) — los pagos de UN reparto, que es como se reconstruye el resultado
   * original de un reparto repetido en vez de inferirlo.
   *
   * Trae tambien los ANULADOS, igual que `listarPorCierre` y por el mismo motivo (R74): un pago
   * anulado deja de descontar pero no deja de verse. Quien necesite solo los vigentes filtra por
   * su `anulacion`.
   */
  listarPorReparto(repartoId: string): Promise<LiquidacionPagoDTO[]>;
  /**
   * T F.1 (R73/R75) — inserta la ANULACION en `tx`, traduciendo el choque del `UNIQUE(pago_id)`
   * en `ya_anulado`. **Nunca lanza por ese motivo**: un segundo intento es un desenlace
   * previsto, no un fallo. Cualquier otro error se propaga.
   *
   * ANULAR ES AÑADIR, JAMAS BORRAR NI EDITAR (R69/R41/R74): este metodo escribe UNA fila en
   * `liquidacion_anulacion` y no toca `liquidacion_pago` — el pago sigue intacto y visible con
   * todos sus datos. El estado «anulado» se DERIVA de que exista esta fila (design §2.2), asi
   * que no hay ningun flag que pueda quedar desincronizado con el contraasiento del libro.
   */
  anular(
    tx: LiquidacionAnulacionTxClient,
    input: AnularLiquidacionPagoInput,
  ): Promise<AnularLiquidacionPagoResult>;
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
