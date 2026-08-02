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
import type {
  ILiquidacionService,
  LiquidacionTxRunner,
  RegistrarPagoServiceResult,
} from "@/lib/interfaces/services/ILiquidacionService";
import type {
  PagoRegistradoDTO,
  RegistrarPagoMensajeroInput,
  RegistrarPagoTiendaInput,
} from "@/lib/types/liquidacion";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { descripcionDePago, medianocheUtcDelDia } from "@/lib/utils/descripcion-pago";
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
 * Feature 172 — logica de negocio de la LIQUIDACION. No conoce HTTP ni Prisma: recibe los
 * repositorios y el ejecutor de transacciones por constructor.
 *
 * NO recibe el repositorio de la CAJA PRINCIPAL, y es una decision, no un olvido ([P2]/R40):
 * al aprobar el cierre la caja ya cargo `egreso_pago_mensajero = P`, y emitir
 * `egreso_pago_tienda` restaria de la caja un dinero que nunca entro en ella. Sin la dependencia
 * inyectada no hay forma de escribir alli aunque alguien lo intente.
 */
export class LiquidacionService implements ILiquidacionService {
  constructor(
    private readonly pagoRepo: ILiquidacionPagoRepository,
    private readonly tiendaRepo: IWalletTiendaMovimientoRepository,
    private readonly mensajeroRepo: IPagoMensajeroMovimientoRepository,
    private readonly runTransaction: LiquidacionTxRunner,
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
      return await this.runTransaction(async (tx) => {
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
      return await this.runTransaction(async (tx) => {
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

        return {
          status: "ok",
          pago: aPagoRegistradoDTO(creado.pago),
          restante: disponible.sub(monto).toFixed(2),
        };
      });
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
