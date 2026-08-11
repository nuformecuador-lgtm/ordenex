import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  BeneficiarioBloqueo,
  CierreParaPagoDTO,
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { ICajaPagoTiendaFeedService } from "@/lib/interfaces/services/ICajaPagoTiendaFeedService";
import type {
  AnularPagoServiceResult,
  ILiquidacionService,
  ListarPagosServiceResult,
  LiquidacionTx,
  LiquidacionTxRunner,
  RegistrarPagoServiceResult,
} from "@/lib/interfaces/services/ILiquidacionService";
import type {
  AnulacionDTO,
  AnularPagoInput,
  PagoRegistradoDTO,
  RegistrarPagoMensajeroInput,
  RegistrarPagoTiendaInput,
} from "@/lib/types/liquidacion";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { invalidarAnaliticaFinanciera } from "@/lib/analytics/invalidacion-financiera";
import { cacheNula } from "@/lib/cache/cache-nula";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import {
  descripcionDeAnulacion,
  descripcionDePago,
  medianocheUtcDelDia,
} from "@/lib/utils/descripcion-pago";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { derivarPendienteCierre } from "@/lib/utils/pendiente-cierre";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

/**
 * Señal interna del choque de `clave_idempotencia` (§4.1). NO es un fallo: es el desenlace
 * previsto del doble submit. Se lanza para SALIR de la transaccion —en Postgres, un error de
 * sentencia deja la transaccion abortada y toda sentencia posterior falla— y la relectura del
 * comprobante se hace FUERA, sobre el cliente propio del repositorio.
 *
 * Es privada del modulo a proposito: nadie fuera necesita distinguirla, porque nunca escapa de
 * `registrarPagoTienda`.
 */
class ClaveRepetidaError extends Error {
  constructor() {
    super("liquidacion: clave de idempotencia ya usada");
    this.name = "ClaveRepetidaError";
  }
}

/**
 * T F.2/R75 — la hermana de la anterior para el `UNIQUE(pago_id)` de la anulacion, y existe por
 * la misma razon tecnica: en Postgres un error de sentencia deja la transaccion ABORTADA, asi
 * que no se puede releer el comprobante dentro de ella. Se lanza para salir y la relectura
 * ocurre FUERA. Tampoco escapa nunca de `anularPago`.
 */
class YaAnuladoError extends Error {
  constructor() {
    super("liquidacion: el pago ya estaba anulado");
    this.name = "YaAnuladoError";
  }
}

/**
 * R56 — el comprobante tal y como cruza a la pantalla: el documento MENOS los identificadores
 * internos (`mensajeroId`, `tiendaId`, `cierreId`). El `id` del pago si viaja: es lo que la
 * pantalla necesita para pedir su anulacion, y no se pinta ni se descarga.
 *
 * Se escribe campo a campo, no con un `delete` ni con un spread del resto: asi, el dia que el
 * documento gane una columna interna, esta funcion NO la deja pasar sola.
 */
export function aPagoRegistradoDTO(pago: LiquidacionPagoDTO): PagoRegistradoDTO {
  return {
    id: pago.id,
    monto: pago.monto,
    metodo: pago.metodo,
    referencia: pago.referencia,
    nota: pago.nota,
    fechaPago: pago.fechaPago,
    registradoPorNombre: pago.registradoPorNombre,
    registradoAt: pago.registradoAt,
    anulacion: pago.anulacion,
  };
}

/**
 * T F.2 — el BENEFICIARIO de un pago, derivado de la fila y no de la peticion. La base garantiza
 * el XOR (`liquidacion_pago_beneficiario_check`) y que el cierre acompaña al mensajero y solo a
 * el (`liquidacion_pago_cierre_check`), asi que estas dos formas son las unicas posibles; `null`
 * es el caso que la base ya impide y que aqui se responde sin inventar.
 */
type BeneficiarioDelPago =
  | { tipo: "mensajero"; mensajeroId: string; cierreId: string }
  | { tipo: "tienda"; tiendaId: string };

function beneficiarioDelPago(pago: LiquidacionPagoDTO): BeneficiarioDelPago | null {
  if (pago.mensajeroId !== null && pago.cierreId !== null) {
    return { tipo: "mensajero", mensajeroId: pago.mensajeroId, cierreId: pago.cierreId };
  }
  if (pago.tiendaId !== null) return { tipo: "tienda", tiendaId: pago.tiendaId };
  return null;
}

/**
 * R84/§4.2 — EL MISMO bloqueo que tomaria su pago, derivado del propio beneficiario para que no
 * puedan divergir: la fila del CIERRE si se pago a un mensajero, la del USUARIO si se pago a una
 * tienda. Bloquear otra cosa «porque anular es casi solo leer» dejaria a una anulacion y a un
 * registro simultaneos leyendo el mismo disponible, que es justo lo que R84 existe para impedir.
 */
function bloqueoDelBeneficiario(beneficiario: BeneficiarioDelPago): BeneficiarioBloqueo {
  return beneficiario.tipo === "mensajero"
    ? { tipo: "cierre", cierreId: beneficiario.cierreId }
    : { tipo: "tienda", tiendaId: beneficiario.tiendaId };
}

/** R74 — el comprobante con su bloque de anulacion recien puesto, sin releerlo de la base. */
function conAnulacion(pago: LiquidacionPagoDTO, anulacion: AnulacionDTO): PagoRegistradoDTO {
  return { ...aPagoRegistradoDTO(pago), anulacion };
}

/**
 * Feature 172 — logica de negocio de la LIQUIDACION. No conoce HTTP ni Prisma: recibe los
 * repositorios y el ejecutor de transacciones por constructor.
 *
 * **Feature 173 (design §4) — lo que cambio, con nombre y apellido.** La 172 escribio aqui que
 * NO recibia el repositorio de la caja principal «porque emitir el egreso del pago a tienda
 * restaria de la caja un dinero que nunca entro en ella». Esa premisa **cayo del lado de la
 * TIENDA**: desde la Tanda B de la 173, aprobar un cierre mete el contra-entrega en la caja, asi
 * que ese dinero SI esta ahi y entregarlo tiene que restar. Del lado del MENSAJERO la premisa
 * sigue viva y no se toca ([P2] = (a), respuesta humana del 2026-08-03): la caja carga
 * `egreso_pago_mensajero = P` al aprobar y la liquidacion al mensajero no la roza.
 *
 * Lo que se inyecta **no** es `IWalletMovimientoRepository` —sabe escribir cualquier categoria,
 * incluida la del mensajero— sino un PUERTO ESTRECHO de dos metodos que no admite ni tipo ni
 * categoria (R23): este servicio no puede EXPRESAR una escritura en la caja que no sea el egreso
 * de un pago a tienda o su reverso. No es «no la llama»: es que no existe el metodo.
 */
export class LiquidacionService implements ILiquidacionService {
  /**
   * `ahora` es el RELOJ, y solo lo usa la anulacion: R77 exige fechar el contraasiento con el
   * dia de la ANULACION —no con el del pago—, asi que hay que preguntar por «hoy». Se inyecta
   * para poder fijarlo en los tests sin tocar el reloj global, y trae default porque un reloj
   * que se olvida de cablear no puede degradar en silencio: `new Date()` es la respuesta
   * correcta en produccion (a diferencia de un repositorio ausente, que si dejaria una deuda
   * invisible — ver la Tanda C, hallazgo 1).
   */
  constructor(
    private readonly pagoRepo: ILiquidacionPagoRepository,
    private readonly tiendaRepo: IWalletTiendaMovimientoRepository,
    private readonly mensajeroRepo: IPagoMensajeroMovimientoRepository,
    private readonly runTransaction: LiquidacionTxRunner,
    /**
     * Feature 173 (R23) — el puerto de la caja. Va SIN valor por defecto a proposito: un
     * puerto que se olvida de cablear y degrada en silencio dejaria pagos a tienda sin su
     * egreso, que es exactamente la deuda invisible que el reloj de abajo explica como
     * inaceptable. Si falta, no compila.
     */
    private readonly caja: ICajaPagoTiendaFeedService,
    private readonly ahora: () => Date = () => new Date(),
    /**
     * Feature 179 (T3.3, R11) — el puerto de la cache de analitica.
     *
     * Este servicio es el que mas ledgers toca de los ocho escritores: el libro del mensajero,
     * el de la tienda y —desde la 173— el egreso de la CAJA que emite `CajaPagoTiendaFeedService`
     * dentro de la misma transaccion. Los tres alimentan el tablero financiero.
     *
     * Default `cacheNula()` para no romper las suites de la 172/173, que construyen este
     * servicio con seis argumentos y no saben nada de cache.
     */
    private readonly cache: IAnaliticaCache = cacheNula(),
  ) {}


  /**
   * R21 — pago a un MENSAJERO, contra el pendiente de UN cierre aprobado. Es el mismo esqueleto
   * de `registrarPagoTienda` —y esta escrito aparte, no factorizado, porque lo que cambia son
   * justo los tres puntos donde una abstraccion prematura se equivocaria: contra que se compara
   * el monto, en que libro se escribe y con que signo.
   *
   *  1. ROL (R1/R6), antes de tocar datos.
   *  2. CANDADO del CIERRE (R83/R85), dentro de la transaccion y antes de leer el pendiente.
   *  3. GUARDIA DEL CIERRE (R20), leida DENTRO de la transaccion y bajo el candado: existe y
   *     esta `aprobado`. Los otros tres estados salen sin escribir nada.
   *  4. Pendiente DERIVADO (§5): `calcularSplitPago(P, E).pendiente − Σ pagos vigentes`.
   *  5. Documento + movimiento `pago`/`liquidacion`, en la MISMA transaccion (R39).
   *
   * El BENEFICIARIO (`mensajeroId`) se toma del CIERRE leido, nunca de la peticion (R5): el
   * cliente elige contra que cierre paga, no a quien se le paga.
   */
  async registrarPagoMensajero(
    input: RegistrarPagoMensajeroInput,
    actor: Actor,
  ): Promise<RegistrarPagoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R1/R5/R6

    const monto = new Prisma.Decimal(input.monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const montoStr = monto.toFixed(2);

    try {
      const resultado: RegistrarPagoServiceResult = await this.runTransaction(async (tx) => {
        // R83/R85: UN solo candado, sobre la fila del CIERRE (el grano exacto de lo que se
        // consume), ANTES de leer el pendiente y ANTES de mirar el estado.
        await this.pagoRepo.bloquearBeneficiario(tx, { tipo: "cierre", cierreId: input.cierreId });

        // R20: la guardia se lee EN LA TRANSACCION. Fuera de ella, el cierre podria cambiar de
        // estado entre la comprobacion y la escritura del pago.
        const cierre = await this.pagoRepo.obtenerCierreParaPago(input.cierreId, tx);
        if (cierre === null) return { status: "no_encontrado" };
        if (cierre.estado !== "aprobado") return { status: "cierre_no_aprobado" };

        // R22/R24/R80: pendiente = min(P, E) del cierre − Σ pagos VIGENTES contra el.
        const pendiente = new Prisma.Decimal(await this.pendienteDelCierre(cierre));

        if (pendiente.lte(0)) return { status: "sin_saldo" }; // R27 [P1]
        if (monto.gt(pendiente)) {
          // R25 [P1]: se rechaza y se informa de cuanto queda, sin escribir nada.
          return { status: "excede", disponible: pendiente.toFixed(2) };
        }

        const creado = await this.pagoRepo.crear(tx, {
          claveIdempotencia: input.claveIdempotencia,
          mensajeroId: cierre.mensajeroId, // R5: el beneficiario sale del CIERRE
          tiendaId: null,
          cierreId: cierre.id, // R21: el pago al mensajero va SIEMPRE atado a un cierre
          monto: montoStr,
          metodo: input.metodo,
          referencia: input.referencia ?? null,
          nota: input.nota ?? null,
          fechaPago: medianocheUtcDelDia(input.fechaPago),
          registradoPor: actor.usuarioId,
        });
        if (creado.status === "clave_repetida") throw new ClaveRepetidaError();

        // R35/R37/R38/R39: el movimiento del libro del mensajero nace del documento.
        await this.mensajeroRepo.crearMovimientos(tx, [
          {
            mensajeroId: cierre.mensajeroId,
            tipo: "pago",
            categoria: "liquidacion",
            monto: montoStr,
            origenTipo: "pago_mensajero", // R38: enlaza el movimiento con su documento…
            origenId: creado.pago.id, //      …y hereda la idempotencia del indice unico parcial
            descripcion: descripcionDePago(input.metodo, input.referencia ?? null),
            registradoPor: actor.usuarioId,
            fechaMovimiento: medianocheUtcDelDia(input.fechaPago), // R37: la fecha REAL del pago
          },
        ]);

        return {
          status: "ok",
          pago: aPagoRegistradoDTO(creado.pago),
          restante: pendiente.sub(monto).toFixed(2), // R24: el resto sigue pendiente
        };
      });
      // R11/R8 — LA INVALIDACION, DESPUES DEL COMMIT Y SOLO SI HUBO ESCRITURA.
      //
      // Las tres operaciones de dinero de este servicio escriben DENTRO de `runTransaction`
      // (`crearMovimientos` en `:225`, `:322`, `:549`, `:565`, mas el egreso de caja de la 173).
      // Llamar a la invalidacion ahi dentro seria invalidar ANTES del commit: entre las dos
      // cosas cabe una lectura concurrente que repuebla la cache con el estado ANTERIOR, y esa
      // entrada vive el TTL entero. Nada falla y la cifra se congela vieja — el peor modo de
      // fallo de esta feature, y por eso R8 tiene requisito y test propios
      // (`cache-financiera-invalidacion-orden.test.ts`).
      //
      // ⚠ VA INLINE, TRES VECES, Y NO EN UN METODO PRIVADO COMPARTIDO. No es descuido: R82/R75
      // de la 172 declara CERRADA la lista de metodos de esta clase —privados incluidos— para
      // que anadir uno obligue a mirar si tiene derecho a existir. Tres lineas iguales cuestan
      // menos que ampliar esa lista, y las ramas que NO escriben (`forbidden`, `sin_saldo`,
      // `cierre_no_aprobado`, `ya_registrado`, `ya_anulado`) no tiran la cache de nadie.
      if (resultado.status === "ok") {
        await invalidarAnaliticaFinanciera(this.cache, "ledger_liquidacion");
      }
      return resultado;
    } catch (error) {
      if (error instanceof ClaveRepetidaError) {
        return this.responderYaRegistrado(input.claveIdempotencia, {
          tipo: "cierre",
          cierreId: input.cierreId,
        });
      }
      throw error;
    }
  }

  /**
   * R29 — pago a una TIENDA, contra su saldo acumulado. Los pasos, en el orden de `design.md
   * §3.3`, y el orden IMPORTA en los dos primeros:
   *
   *  1. ROL (R1/R2/R5/R6). Va antes de leer NADA: si estuviera despues, el saldo de la tienda
   *     ya habria salido de la base aunque la respuesta fuera `forbidden`. Y se evalua antes de
   *     mirar `input.tiendaId`, porque ningun dato de la peticion puede ampliar el alcance del
   *     actor (R5) — `adminTienda` recibe `forbidden` tambien pidiendo SU PROPIA tienda (R2).
   *  2. CANDADO (R83/R85), dentro de la transaccion y ANTES de leer el disponible. Con P1 =
   *     rechazar el exceso, «monto <= disponible» solo vale si nadie puede leer el mismo
   *     disponible a la vez: con `READ COMMITTED` dos transacciones simultaneas leerian el
   *     mismo saldo, las dos pasarian, y entre las dos se pagaria de mas.
   *  3. Disponible DERIVADO del ledger (nunca un saldo almacenado) y las dos ramas de rechazo.
   *  4. Documento + movimiento, en la MISMA transaccion (R39).
   *  5. **Feature 173 (R18/R19/R20):** y el egreso de la CAJA PRINCIPAL, en esa misma
   *     transaccion y por el mismo `montoStr`. Es la tercera escritura, no un efecto aparte:
   *     si falla, no queda el pago.
   */
  async registrarPagoTienda(
    input: RegistrarPagoTiendaInput,
    actor: Actor,
  ): Promise<RegistrarPagoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R1/R2/R5/R6 — antes de tocar datos

    // Escala 2 fijada UNA vez: el mismo STRING va al documento, al libro y a la resta del
    // restante, asi que documento y libro no pueden discrepar por un redondeo (R39).
    const monto = new Prisma.Decimal(input.monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const montoStr = monto.toFixed(2);

    try {
      const resultado: RegistrarPagoServiceResult = await this.runTransaction(async (tx) => {
        // R83/R85: UN solo candado, sobre la fila de la tienda, ANTES de leer el disponible.
        await this.pagoRepo.bloquearBeneficiario(tx, {
          tipo: "tienda",
          tiendaId: input.tiendaId,
        });

        // R31/R32: el disponible es el saldo a favor DERIVADO del ledger (creditos - debitos),
        // sin filtros: se paga contra el saldo acumulado, no contra un periodo.
        const agregado = await this.tiendaRepo.agregarSaldoPorTienda(input.tiendaId, {});
        const disponible = new Prisma.Decimal(
          derivarSaldoTienda(agregado.creditos, agregado.debitos).saldo,
        );

        if (disponible.lte(0)) return { status: "sin_saldo" }; // R32 [P1]
        if (monto.gt(disponible)) {
          // R31 [P1]: se rechaza y se informa de cuanto queda, sin escribir nada.
          return { status: "excede", disponible: disponible.toFixed(2) };
        }

        const creado = await this.pagoRepo.crear(tx, {
          claveIdempotencia: input.claveIdempotencia,
          mensajeroId: null,
          tiendaId: input.tiendaId, // R29: el pago a una tienda NO lleva cierre (CHECK en la base)
          cierreId: null,
          monto: montoStr,
          metodo: input.metodo,
          referencia: input.referencia ?? null,
          nota: input.nota ?? null,
          fechaPago: medianocheUtcDelDia(input.fechaPago), // R9: fecha REAL, distinta del registro
          registradoPor: actor.usuarioId, // R7: un pago siempre lo registra alguien
        });
        // §4.1: sale de la transaccion (que revierte) y la relectura ocurre fuera.
        if (creado.status === "clave_repetida") throw new ClaveRepetidaError();

        // R36/R37/R38/R39: el debito nace del documento y va en la MISMA transaccion.
        await this.tiendaRepo.crearMovimientos(tx, [
          {
            tiendaId: input.tiendaId,
            tipo: "debito",
            categoria: "pago_tienda",
            monto: montoStr,
            origenTipo: "pago_tienda", // R38: enlaza el movimiento con su documento…
            origenId: creado.pago.id, //      …y hereda la idempotencia del indice unico parcial
            descripcion: descripcionDePago(input.metodo, input.referencia ?? null),
            registradoPor: actor.usuarioId,
            fechaMovimiento: medianocheUtcDelDia(input.fechaPago), // R37: la fecha REAL del pago
          },
        ]);

        // Feature 173 (R18/R19/R20) — TERCERA escritura, misma transaccion: el dinero SALE de
        // la caja principal. Va DESPUES del ledger a proposito, para que el libro de la tienda
        // siga siendo el primero en cuadrar; y con el MISMO `montoStr` ya redondeado, de modo
        // que documento, ledger y caja no puedan discrepar por un centimo.
        //
        // Ni el tipo ni la categoria se nombran aqui: los fija el puerto (R23).
        await this.caja.emitirEgresoDePago(tx, {
          pagoId: creado.pago.id,
          monto: montoStr,
          descripcion: descripcionDePago(input.metodo, input.referencia ?? null),
          registradoPor: actor.usuarioId,
          fechaMovimiento: medianocheUtcDelDia(input.fechaPago), // R20: la fecha REAL del pago
        });

        return {
          status: "ok",
          pago: aPagoRegistradoDTO(creado.pago),
          restante: disponible.sub(monto).toFixed(2),
        };
      });
      // R11/R8 — despues del commit (ver el comentario largo en `registrarPagoMensajero`).
      if (resultado.status === "ok") {
        await invalidarAnaliticaFinanciera(this.cache, "ledger_liquidacion");
      }
      return resultado;
    } catch (error) {
      if (error instanceof ClaveRepetidaError) {
        return this.responderYaRegistrado(input.claveIdempotencia, {
          tipo: "tienda",
          tiendaId: input.tiendaId,
        });
      }
      throw error;
    }
  }

  /**
   * T F.2 (R69-R71, R76, R77, R81, R82, R84) — ANULA un pago añadiendo su CONTRAASIENTO. El pago
   * no se borra ni se edita: sigue en la tabla, en el libro y en la lista de comprobantes, ahora
   * marcado con su motivo, su actor y su instante (R74).
   *
   * Los pasos, y por que estan en este orden:
   *
   *  1. ROL (R81), antes de leer nada. Los mismos que pagan: `maestro` y `admin`.
   *  2. EL PAGO SE LEE SERVER-SIDE (R70). De aqui —y de ningun sitio mas— salen el monto del
   *     reverso, el beneficiario y el libro en el que se escribe. La peticion solo trae el
   *     `pagoId` y el motivo: si el cliente pudiera dictar el monto, anular seria una via para
   *     escribir cualquier cifra en un libro de dinero. Se lee FUERA de la transaccion a
   *     proposito: hace falta saber a quien se le pago para saber QUE fila bloquear, y la fila
   *     del pago es INMUTABLE, asi que no puede quedarse obsoleta entre esta lectura y el
   *     candado. Lo que si puede cambiar —la anulacion y el disponible— se lee y se escribe
   *     dentro.
   *  3. CANDADO (R84/R85): UNO, el mismo que tomaria su pago.
   *  4. Disponible leido BAJO el candado (R83) y proyectado con el contraasiento ya aplicado:
   *     es el valor EXACTO al que vuelve el beneficiario (R71).
   *  5. Anulacion + contraasiento en la MISMA transaccion (R39): o quedan los dos, o ninguno.
   *
   * **Se anula ENTERO (R76)** —el monto es el del pago, no hay por donde pedir una parte— y
   * **no hay forma de anular una anulacion (R82)**: el segundo intento choca con el
   * `UNIQUE(pago_id)` y responde `ya_anulado`, y no existe ningun metodo que borre esa fila.
   *
   * **Feature 173 (R24-R27), y sustituye a lo que aqui decia la 172.** La 172 escribio «la caja
   * principal no recibe ni una llamada (R40): si al pagar no se emitio egreso, al anular no hay
   * nada que revertir». Ahora al pagar a una TIENDA si se emite egreso, asi que al anular si hay
   * que devolverlo: el contraasiento del ledger va acompañado de un `ingreso` de la caja por el
   * mismo monto, fechado el DIA DE LA ANULACION (R25) y de naturaleza TERCEROS, de modo que
   * anular no sube la ganancia de Ordenex ni un centimo (R26). La rama del MENSAJERO sigue sin
   * tocar la caja, exactamente igual que antes (R27, [P2]).
   */
  async anularPago(input: AnularPagoInput, actor: Actor): Promise<AnularPagoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R81 — antes de leer nada

    const pago = await this.pagoRepo.obtenerPorId(input.pagoId); // R70: SERVER-SIDE
    if (pago === null) return { status: "no_encontrado" };

    const beneficiario = beneficiarioDelPago(pago);
    if (beneficiario === null) return { status: "no_encontrado" };

    // R70/R76: el monto del contraasiento es el del PAGO, entero. Escala fijada una vez, igual
    // que al registrar, para que documento y libro no puedan discrepar por un redondeo.
    const monto = new Prisma.Decimal(pago.monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const montoStr = monto.toFixed(2);
    // R77: el contraasiento se fecha el dia de la ANULACION, no el del pago. El precedente es
    // `reversarEgreso`, que no reabre fechas pasadas: entre el pago y su anulacion, un informe
    // por rango vera el pago aplicado, que es la semantica contable habitual.
    const fechaAnulacion = medianocheUtcDelDia(fechaCalendarioCR(this.ahora()));

    try {
      const resultado: AnularPagoServiceResult = await this.runTransaction(async (tx) => {
        // R84/R85: UN solo candado, el mismo que tomaria su pago, ANTES de leer el disponible.
        await this.pagoRepo.bloquearBeneficiario(tx, bloqueoDelBeneficiario(beneficiario));

        const restante = await this.restanteTrasAnular(tx, beneficiario, monto);
        if (restante === null) return { status: "no_encontrado" };

        const anulada = await this.pagoRepo.anular(tx, {
          pagoId: pago.id,
          motivo: input.motivo,
          anuladoPor: actor.usuarioId, // R73
        });
        // R75: sale de la transaccion (que revierte) y la relectura ocurre fuera.
        if (anulada.status === "ya_anulado") throw new YaAnuladoError();

        await this.escribirContraasiento(tx, beneficiario, {
          pago,
          monto: montoStr,
          fechaMovimiento: fechaAnulacion,
          registradoPor: actor.usuarioId,
        });

        return { status: "ok", pago: conAnulacion(pago, anulada.anulacion), restante };
      });
      // R11/R8 — despues del commit (ver el comentario largo en `registrarPagoMensajero`).
      if (resultado.status === "ok") {
        await invalidarAnaliticaFinanciera(this.cache, "ledger_liquidacion");
      }
      return resultado;
    } catch (error) {
      if (error instanceof YaAnuladoError) return this.responderYaAnulado(pago.id);
      throw error;
    }
  }

  /**
   * R49/R56/R74 (T C.1) — los comprobantes de UN cierre.
   *
   * Tres decisiones, las tres deliberadas:
   *
   *  1. **El gate va primero y es el MISMO de registrar** ([P3]/R1): un rol sin acceso total
   *     recibe `forbidden` ANTES de que la lista salga de la base. Un listado de comprobantes
   *     dice quien cobro, cuanto y como; es la misma superficie de dinero, no «solo lectura».
   *  2. **El DTO se recorta con `aPagoRegistradoDTO`**, que escribe campo a campo: el documento
   *     lleva `mensajeroId`/`tiendaId`/`cierreId` para el servicio, y ninguno de los tres cruza
   *     (R56). El unico uuid que viaja es el `id` del pago, que es lo que la pantalla necesita
   *     para pedir su anulacion.
   *  3. **La lista trae los ANULADOS** (R74). Es el repositorio quien no filtra por vigencia
   *     —a diferencia de las sumas, que si lo hacen (R80)—, y aqui no se vuelve a filtrar: un
   *     pago anulado deja de descontar, pero no deja de verse, entero y marcado.
   */
  async listarPagosDeCierre(cierreId: string, actor: Actor): Promise<ListarPagosServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R1/R6 — antes de leer nada
    const pagos = await this.pagoRepo.listarPorCierre(cierreId);
    return { status: "ok", pagos: pagos.map(aPagoRegistradoDTO) };
  }

  /**
   * R50/R56/R74 (T C.1) — los comprobantes de UNA tienda, con el mismo criterio que los del
   * cierre. Sin cierre de por medio: los pagos a una tienda van contra su saldo acumulado.
   */
  async listarPagosDeTienda(tiendaId: string, actor: Actor): Promise<ListarPagosServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R1/R2/R6
    const pagos = await this.pagoRepo.listarPorTienda(tiendaId);
    return { status: "ok", pagos: pagos.map(aPagoRegistradoDTO) };
  }

  /**
   * T F.2/R71 — a cuanto vuelve el disponible del beneficiario UNA VEZ aplicado el
   * contraasiento. Se lee bajo el candado (R83) y **no se estima**: se vuelve a pasar por la
   * MISMA derivacion que usa el registro, con el efecto del reverso ya metido en la entrada.
   *
   *  - mensajero: el pago que se esta anulando todavia cuenta como vigente en la agregacion, asi
   *    que se descuenta de ella y el pendiente se deriva con `derivarPendienteCierre`. Resultado:
   *    exactamente el pendiente que habia ANTES de ese pago.
   *  - tienda: el contraasiento es un CREDITO por el mismo monto, asi que el saldo se deriva de
   *    los creditos del ledger MAS ese credito. Igual de exacto, y por la misma via.
   *
   * `null` = el cierre del pago ya no existe (imposible: la FK va `ON DELETE RESTRICT`); se
   * responde `no_encontrado` en vez de inventar una cifra.
   */
  private async restanteTrasAnular(
    tx: LiquidacionTx,
    beneficiario: BeneficiarioDelPago,
    monto: Prisma.Decimal,
  ): Promise<string | null> {
    if (beneficiario.tipo === "mensajero") {
      const cierre = await this.pagoRepo.obtenerCierreParaPago(beneficiario.cierreId, tx);
      if (cierre === null) return null;
      const pagados = await this.pagoRepo.sumarVigentesPorCierre([cierre.id]);
      const vigentes = new Prisma.Decimal(pagados[cierre.id] ?? "0.00").sub(monto);
      return derivarPendienteCierre(
        cierre.totalPagoMensajero,
        cierre.totalEfectivo,
        vigentes.lt(0) ? new Prisma.Decimal(0) : vigentes,
      );
    }

    const agregado = await this.tiendaRepo.agregarSaldoPorTienda(beneficiario.tiendaId, {});
    const creditos = new Prisma.Decimal(agregado.creditos).add(monto);
    return derivarSaldoTienda(creditos, agregado.debitos).saldo;
  }

  /**
   * T F.2/§6.2 (R69/R77) — EL CONTRAASIENTO: mismo monto, signo opuesto, mismo documento.
   *
   * | Pago original | Contraasiento | Efecto |
   * | --- | --- | --- |
   * | mensajero `pago`/`liquidacion` | `devengo`/`ajuste_devengo` | la cuenta por pagar vuelve a subir |
   * | tienda `debito`/`pago_tienda` | `credito`/`ajuste_credito` | el saldo a favor vuelve a subir |
   *
   * Las dos categorias YA existian, reservadas para esto («correccion compensatoria inmutable»),
   * y los dos CHECK de la migracion estan escritos para dejar pasar EXACTAMENTE estos dos pares:
   * `ajuste_devengo` solo casa con `devengo` y `ajuste_credito` solo con `credito`. Elegir otro
   * par no daria un saldo raro — daria un INSERT rechazado por la base, a proposito (R60).
   *
   * `origenTipo`/`origenId` son los DEL PAGO, no de la anulacion, y eso es lo que da idempotencia
   * gratis: el indice unico parcial de cada libro es `(origen_tipo, origen_id, <beneficiario>,
   * categoria)`, y el pago ya ocupo esa clave con OTRA categoria. Los dos caben y ninguno puede
   * duplicarse. Ademas es lo que hace que el filtro por cierre del desglose (R52) traiga el
   * contraasiento junto a su pago.
   */
  private async escribirContraasiento(
    tx: LiquidacionTx,
    beneficiario: BeneficiarioDelPago,
    reverso: {
      pago: LiquidacionPagoDTO;
      monto: string;
      fechaMovimiento: Date;
      registradoPor: string;
    },
  ): Promise<void> {
    const descripcion = descripcionDeAnulacion(reverso.pago.metodo, reverso.pago.referencia);

    if (beneficiario.tipo === "mensajero") {
      await this.mensajeroRepo.crearMovimientos(tx, [
        {
          mensajeroId: beneficiario.mensajeroId,
          tipo: "devengo",
          categoria: "ajuste_devengo",
          monto: reverso.monto,
          origenTipo: "pago_mensajero", // el del PAGO (R38)
          origenId: reverso.pago.id,
          descripcion,
          registradoPor: reverso.registradoPor,
          fechaMovimiento: reverso.fechaMovimiento, // R77: el dia de la ANULACION
        },
      ]);
      return;
    }

    await this.tiendaRepo.crearMovimientos(tx, [
      {
        tiendaId: beneficiario.tiendaId,
        tipo: "credito",
        categoria: "ajuste_credito",
        monto: reverso.monto,
        origenTipo: "pago_tienda", // el del PAGO (R38)
        origenId: reverso.pago.id,
        descripcion,
        registradoPor: reverso.registradoPor,
        fechaMovimiento: reverso.fechaMovimiento, // R77
      },
    ]);

    // Feature 173 (R24/R25/R26/R29) — y el dinero VUELVE a la caja principal, en la misma
    // transaccion y por el mismo monto. Es una fila NUEVA: nada se borra ni se edita.
    //
    // Solo en esta rama: si el `if` de arriba se llevo el caso del mensajero con su `return`,
    // aqui abajo ya no hay forma de llegar con un pago a mensajero. Que la categoria del reverso
    // no sea `ingreso_ajuste` —que subiria la ganancia— lo garantiza el puerto, no este metodo.
    await this.caja.emitirReversoDeAnulacion(tx, {
      pagoId: reverso.pago.id,
      monto: reverso.monto,
      descripcion,
      registradoPor: reverso.registradoPor,
      fechaMovimiento: reverso.fechaMovimiento, // R25: el dia de la ANULACION
    });
  }

  /**
   * R75 — la respuesta del SEGUNDO intento: el comprobante ya anulado y cero filas nuevas.
   *
   * Se relee por id porque el bloque de anulacion que hay que devolver (motivo, actor, instante)
   * lo escribio la otra llamada, no esta. `no_encontrado` cubre el caso imposible-en-teoria (un
   * choque de unicidad sin anulacion que lo explique): mejor un estado explicito que un
   * `ya_anulado` con el bloque vacio, que la pantalla pintaria como un pago vigente.
   */
  private async responderYaAnulado(pagoId: string): Promise<AnularPagoServiceResult> {
    const pago = await this.pagoRepo.obtenerPorId(pagoId);
    if (pago === null || pago.anulacion === null) return { status: "no_encontrado" };
    return { status: "ya_anulado", pago: aPagoRegistradoDTO(pago) };
  }

  /**
   * §5/R22/R24/R80 — lo que de ESE cierre sigue sin entregarse. La suma de pagos vigentes se
   * lee con el cliente propio del repositorio (no con el `tx`), igual que el saldo de la
   * tienda: el candado del cierre ya se tomo, asi que una segunda transaccion no puede leer
   * esta cifra hasta que la primera confirme.
   *
   * `?? "0.00"`: el repositorio devuelve una entrada por cada id pedido, pero un doble podria
   * no hacerlo; ante la duda, cero pagado — que es lo que hace que el tope de [P1] siga siendo
   * el pendiente completo y nunca uno inventado.
   */
  private async pendienteDelCierre(cierre: CierreParaPagoDTO): Promise<string> {
    const pagados = await this.pagoRepo.sumarVigentesPorCierre([cierre.id]);
    return derivarPendienteCierre(
      cierre.totalPagoMensajero,
      cierre.totalEfectivo,
      pagados[cierre.id] ?? "0.00",
    );
  }

  /**
   * R43/R47 — la respuesta idempotente: el MISMO comprobante y cero filas nuevas.
   *
   * El restante se recalcula sobre el beneficiario DEL PAGO ENCONTRADO, no sobre el de la
   * peticion: si alguien reusara una clave ya consumida apuntando a otro cierre o a otra
   * tienda, la cifra que devolvemos seguiria siendo la de aquello a lo que de verdad se pago.
   * El beneficiario de la peticion solo actua de respaldo.
   *
   * `no_encontrado` es el caso imposible-en-teoria (choque de clave sin fila que lo explique) y
   * se responde sin inventar: mejor un estado explicito que un `ok` que nadie puede auditar.
   */
  private async responderYaRegistrado(
    claveIdempotencia: string,
    deLaPeticion: BeneficiarioBloqueo,
  ): Promise<RegistrarPagoServiceResult> {
    const pago = await this.pagoRepo.obtenerPorClave(claveIdempotencia);
    if (pago === null) return { status: "no_encontrado" };

    const restante = await this.restanteDe(pago, deLaPeticion);
    if (restante === null) return { status: "no_encontrado" };

    return { status: "ya_registrado", pago: aPagoRegistradoDTO(pago), restante };
  }

  /** Lo que queda disponible tras el pago ya registrado, segun contra que dinero fuera. */
  private async restanteDe(
    pago: LiquidacionPagoDTO,
    deLaPeticion: BeneficiarioBloqueo,
  ): Promise<string | null> {
    const cierreId =
      pago.cierreId ?? (deLaPeticion.tipo === "cierre" ? deLaPeticion.cierreId : null);
    if (cierreId !== null) {
      const cierre = await this.pagoRepo.obtenerCierreParaPago(cierreId);
      return cierre === null ? null : this.pendienteDelCierre(cierre);
    }

    const tiendaId =
      pago.tiendaId ?? (deLaPeticion.tipo === "tienda" ? deLaPeticion.tiendaId : null);
    if (tiendaId === null) return null;
    const agregado = await this.tiendaRepo.agregarSaldoPorTienda(tiendaId, {});
    return derivarSaldoTienda(agregado.creditos, agregado.debitos).saldo;
  }
}
