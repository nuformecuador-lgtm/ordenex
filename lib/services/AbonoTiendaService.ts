import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { walletComprobanteConfig, type WalletComprobanteConfig } from "@/lib/config/wallet-comprobante";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  AbonoTiendaRegistro,
  IAbonoTiendaRepository,
} from "@/lib/interfaces/repositories/IAbonoTiendaRepository";
import type { ILiquidacionPagoRepository } from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  AbonoTiendaTxRunner,
  AnularAbonoTiendaServiceResult,
  ComprobanteRecibido,
  IAbonoTiendaService,
  ObtenerComprobanteAbonoServiceResult,
  RegistrarAbonoTiendaServiceResult,
} from "@/lib/interfaces/services/IAbonoTiendaService";
import type { ICajaAbonoTiendaFeedService } from "@/lib/interfaces/services/ICajaAbonoTiendaFeedService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { compensarEvidencias } from "@/lib/services/evidencias-compensadas";
import type {
  AbonoTiendaDTO,
  AnularAbonoTiendaInput,
  RegistrarAbonoTiendaInput,
} from "@/lib/types/abono-tienda";
import type { SaldoTiendaDTO } from "@/lib/types/wallet-tienda";
import { problemaDeComprobante, rutaDeComprobante } from "@/lib/utils/comprobante";
import {
  descripcionAbonoEnCaja,
  descripcionAbonoEnTienda,
  descripcionAnulacionAbono,
} from "@/lib/utils/descripcion-abono";
import { medianocheUtcDelDia } from "@/lib/utils/descripcion-pago";
import { fechaCalendarioCR, inicioDelDiaCREnUtc } from "@/lib/utils/fecha-cr";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

const ROL_TIENDA = "adminTienda";

/** R10 — los MISMOS mensajes que el pago de un gasto (`PagoPorCuentaTiendaService`). `inactiva` no se usa (R11, D2). */
const MSG_TIENDA = {
  inexistente: "La tienda no existe",
  rol: "La cuenta elegida no es una tienda",
} as const;

/** Señal interna: el choque de la clave se responde FUERA de la transaccion (que revierte). */
class ClaveRepetidaError extends Error {
  constructor() {
    super("pago de una tienda a Ordenex: clave de idempotencia repetida");
    this.name = "ClaveRepetidaError";
  }
}

class YaAnuladoError extends Error {
  constructor() {
    super("pago de una tienda a Ordenex: ya anulado");
    this.name = "YaAnuladoError";
  }
}

/** R14/R15 — la regla del dinero no se cumple: se sale de la transaccion SIN escribir. */
class SinDeudaError extends Error {
  constructor(readonly saldo: SaldoTiendaDTO) {
    super("pago de una tienda a Ordenex: la tienda no tiene saldo en contra");
    this.name = "SinDeudaError";
  }
}

class ExcedeError extends Error {
  constructor(readonly deuda: string) {
    super("pago de una tienda a Ordenex: el monto supera lo que la tienda debe");
    this.name = "ExcedeError";
  }
}

/** R48 — el DTO: ni la tienda por id, ni la ruta del comprobante, ni la clave. */
export function aAbonoTiendaDTO(r: AbonoTiendaRegistro): AbonoTiendaDTO {
  return {
    id: r.id,
    tiendaNombre: r.tiendaNombre,
    monto: r.monto,
    metodo: r.metodo,
    referencia: r.referencia,
    motivo: r.motivo,
    fechaPago: r.fechaPago,
    registradoPorNombre: r.registradoPorNombre,
    registradoAt: r.registradoAt,
    anulado: r.anulado,
    tieneComprobante: r.comprobantePath !== null,
  };
}

/**
 * FICHA 457 (design §5) — el PAGO DE UNA TIENDA A ORDENEX: una tienda con saldo en contra le entrega
 * dinero a Ordenex. En UNA transaccion: el documento y su historial, el CREDITO en el libro de la tienda
 * y la ENTRADA en la caja como dinero de TERCEROS (DH1), con el MISMO monto y el MISMO instante (R17,
 * R20). Sube «Entro», la cifra principal y «De las tiendas»; NO toca la ganancia ni el capital (R19).
 * Solo con saldo en contra (R14) y hasta lo que la tienda debe (R15), leidos BAJO el candado (R16).
 */
export class AbonoTiendaService implements IAbonoTiendaService {
  constructor(
    private readonly abonoRepo: IAbonoTiendaRepository,
    private readonly tiendaRepo: Pick<
      IWalletTiendaMovimientoRepository,
      "crearMovimientos" | "agregarSaldoPorTienda"
    >,
    /** R16/R38 — el MISMO candado de tienda que toman el pago de Ordenex a esa tienda y el pago de un gasto. */
    private readonly candado: Pick<ILiquidacionPagoRepository, "bloquearBeneficiario">,
    private readonly usuarioRepo: Pick<IUserRepository, "obtenerCuentaTienda">,
    /** Obligatorio: sin caja no se construye (R65: un credito a una tienda sin contrapartida es lo que D3 prohibia). */
    private readonly caja: ICajaAbonoTiendaFeedService,
    private readonly comprobantes: IFileStorage,
    private readonly urls: ISignedUrlProvider,
    private readonly runTransaction: AbonoTiendaTxRunner,
    private readonly ahora: () => Date = () => new Date(),
    private readonly config: Pick<
      WalletComprobanteConfig,
      "MAX_BYTES" | "SIGNED_URL_TTL_SECONDS"
    > = walletComprobanteConfig,
  ) {}

  /**
   * EL ORDEN ES PARTE DEL REQUISITO (design §5.1):
   *  1. ROL antes de leer nada (R2).
   *  2. ESCALA 2 una vez: el MISMO string va a las cuatro escrituras (R5).
   *  3. La TIENDA, validada en el servidor (R10); el estado NO se exige (R11, D2).
   *  4. Pre-chequeo OPTIMISTA del saldo, sin candado: ahorra subir un archivo que no va a servir. No
   *     sustituye al paso 7.
   *  5. El COMPROBANTE, validado y subido ANTES de la transaccion (R26–R28).
   *  6. Las FECHAS: la real del pago para el documento; el inicio de ese dia en CR para los dos asientos (R20).
   *  7. La TRANSACCION: candado de la tienda ANTES de leer el saldo (R16) → saldo ≥ 0 → `sin_deuda`
   *     (R14); monto > |saldo| → `excede` (R15); documento + historial → credito → entrada en la caja.
   *  8. El saldo DESPUES, derivado (R18): nunca por encima de cero bajo el candado (R66).
   *  9. Ante cualquier desenlace distinto de `ok`, se retira el comprobante subido (R29).
   */
  async registrar(
    input: RegistrarAbonoTiendaInput,
    comprobante: ComprobanteRecibido | null,
    actor: Actor,
  ): Promise<RegistrarAbonoTiendaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R2: antes de leer nada

    const montoStr = new Prisma.Decimal(input.monto)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2);
    const monto = new Prisma.Decimal(montoStr);

    const cuenta = await this.usuarioRepo.obtenerCuentaTienda(input.tiendaId);
    if (cuenta === null) return errorDeCampo("tiendaId", MSG_TIENDA.inexistente);
    if (cuenta.rol !== ROL_TIENDA) return errorDeCampo("tiendaId", MSG_TIENDA.rol);

    // 4. Pre-chequeo optimista (sin candado): la respuesta definitiva la da el paso 7.
    const previo = await this.saldoDe(input.tiendaId);
    const reglaPrevia = reglaDelDinero(previo, monto);
    if (reglaPrevia !== null) return reglaPrevia;

    let ruta: string | null = null;
    if (comprobante !== null) {
      const problema = problemaDeComprobante(
        { type: comprobante.contentType, size: comprobante.bytes.byteLength },
        this.config,
      );
      if (problema !== null) return errorDeCampo("comprobante", problema);
      try {
        ruta = await this.comprobantes.upload({
          path: rutaDeComprobante("abono_tienda", comprobante.contentType),
          bytes: comprobante.bytes,
          contentType: comprobante.contentType,
        });
      } catch {
        return { status: "comprobante_no_guardado" }; // R28: sin comprobante guardado no hay registro
      }
    }

    const id = randomUUID();
    // R20 (461 T2/R73): el credito y la entrada se fechan con el MISMO instante, el inicio del dia en
    // Costa Rica de la fecha REAL del pago (06:00Z); el documento conserva el dia calendario (@db.Date).
    const fechaMovimiento = inicioDelDiaCREnUtc(input.fechaPago);
    const fechaPago = medianocheUtcDelDia(input.fechaPago);
    const datosDescripcion = {
      motivo: input.motivo,
      metodo: input.metodo,
      referencia: input.referencia ?? null,
    };

    let exito = false;
    try {
      const abono = await this.runTransaction(async (tx) => {
        // R16: la MISMA fila `usuario` que bloquean `registrarPagoTienda` y `PagoPorCuentaTiendaService`.
        await this.candado.bloquearBeneficiario(tx, { tipo: "tienda", tiendaId: input.tiendaId });
        // R14/R15 BAJO el candado: dos operaciones simultaneas no pueden evaluarse sobre el mismo saldo.
        const saldo = await this.saldoDe(input.tiendaId);
        const regla = reglaDelDinero(saldo, monto);
        if (regla !== null) {
          if (regla.status === "sin_deuda") throw new SinDeudaError(regla.saldo);
          throw new ExcedeError(regla.deuda);
        }

        const creado = await this.abonoRepo.crear(tx, {
          id,
          claveIdempotencia: input.claveIdempotencia,
          tiendaId: input.tiendaId,
          monto: montoStr,
          metodo: input.metodo,
          referencia: input.referencia ?? null,
          motivo: input.motivo,
          fechaPago,
          comprobantePath: ruta,
          comprobanteContentType: ruta === null ? null : (comprobante?.contentType ?? null),
          registradoPor: actor.usuarioId,
        });
        if (creado.status === "clave_repetida") throw new ClaveRepetidaError();

        await this.tiendaRepo.crearMovimientos(tx, [
          {
            tiendaId: input.tiendaId,
            tipo: "credito",
            categoria: "abono_tienda",
            monto: montoStr,
            origenTipo: "abono_tienda",
            origenId: id,
            descripcion: descripcionAbonoEnTienda(datosDescripcion),
            registradoPor: actor.usuarioId,
            fechaMovimiento,
          },
        ]);
        // R17/R19: la ENTRADA de terceros en la caja, en la MISMA transaccion y con el MISMO string e
        // instante. Ni el tipo ni la categoria se nombran aqui: los fija el puerto (R22).
        await this.caja.emitirIngresoDeAbono(tx, {
          abonoId: id,
          monto: montoStr,
          descripcion: descripcionAbonoEnCaja(creado.abono.tiendaNombre, datosDescripcion),
          registradoPor: actor.usuarioId,
          fechaMovimiento,
        });
        return creado.abono;
      });
      exito = true;
      return { status: "ok", abono: aAbonoTiendaDTO(abono), saldo: await this.saldoDe(input.tiendaId) };
    } catch (error) {
      if (error instanceof SinDeudaError) return { status: "sin_deuda", saldo: error.saldo };
      if (error instanceof ExcedeError) return { status: "excede", deuda: error.deuda };
      if (error instanceof ClaveRepetidaError) {
        // R25: el pago ORIGINAL y el saldo actual de la tienda DE ESE pago.
        const original = await this.abonoRepo.obtenerPorClave(input.claveIdempotencia);
        if (original === null) {
          throw new Error("pago de una tienda a Ordenex: clave repetida sin documento que releer");
        }
        return {
          status: "ya_registrado",
          abono: aAbonoTiendaDTO(original),
          saldo: await this.saldoDe(original.tiendaId),
        };
      }
      throw error;
    } finally {
      // R29: si no quedo registrado ESTE pago, el comprobante que se subio no pertenece a nada.
      if (!exito && ruta !== null) await compensarEvidencias(this.comprobantes, [ruta]);
    }
  }

  /**
   * R31–R39 — la anulacion. El documento se lee FUERA de la transaccion (es inmutable y hace falta
   * saber su tienda para tomar el candado); el monto del contra-asiento es el DEL DOCUMENTO (R34); los
   * dos asientos se fechan con el MISMO instante: el inicio del dia de la anulacion en CR (R32). El
   * comprobante NO se toca (R33).
   */
  async anular(input: AnularAbonoTiendaInput, actor: Actor): Promise<AnularAbonoTiendaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R37: antes de leer el pago

    const abono = await this.abonoRepo.obtenerPorId(input.abonoId);
    if (abono === null) return { status: "no_encontrado" }; // R37

    const instante = inicioDelDiaCREnUtc(fechaCalendarioCR(this.ahora())); // R32
    const datosDescripcion = {
      motivo: abono.motivo,
      metodo: abono.metodo,
      referencia: abono.referencia,
    };

    try {
      await this.runTransaction(async (tx) => {
        await this.candado.bloquearBeneficiario(tx, { tipo: "tienda", tiendaId: abono.tiendaId }); // R38
        const anulada = await this.abonoRepo.anular(tx, {
          abonoId: abono.id,
          motivo: input.motivo,
          anuladoPor: actor.usuarioId,
        });
        if (anulada.status === "ya_anulado") throw new YaAnuladoError();

        await this.tiendaRepo.crearMovimientos(tx, [
          {
            tiendaId: abono.tiendaId,
            tipo: "debito",
            categoria: "abono_tienda_anulado",
            monto: abono.monto, // R34: el monto DEL DOCUMENTO, nunca uno de la peticion
            origenTipo: "abono_tienda",
            origenId: abono.id,
            descripcion: descripcionAnulacionAbono(descripcionAbonoEnTienda(datosDescripcion)),
            registradoPor: actor.usuarioId,
            fechaMovimiento: instante,
          },
        ]);
        await this.caja.emitirReversoDeAbono(tx, {
          abonoId: abono.id,
          monto: abono.monto,
          descripcion: descripcionAnulacionAbono(
            descripcionAbonoEnCaja(abono.tiendaNombre, datosDescripcion),
          ),
          registradoPor: actor.usuarioId,
          fechaMovimiento: instante,
        });
      });
    } catch (error) {
      if (error instanceof YaAnuladoError) return { status: "ya_anulado" }; // R36
      throw error;
    }
    return { status: "ok", saldo: await this.saldoDe(abono.tiendaId) }; // R38: puede volver a ser negativo
  }

  /**
   * R42–R44 — el enlace temporal del comprobante. Acceso total: cualquiera. La tienda DUEÑA: el suyo
   * (DH3). A una tienda que pide un pago ajeno o inexistente se le responde lo MISMO (`no_encontrado`,
   * R43). Cualquier otro rol: `forbidden`, antes de leer.
   */
  async obtenerComprobante(abonoId: string, actor: Actor): Promise<ObtenerComprobanteAbonoServiceResult> {
    const esTienda = actor.rol === ROL_TIENDA;
    if (!esAccesoTotal(actor.rol) && !esTienda) return { status: "forbidden" };

    const abono = await this.abonoRepo.obtenerPorId(abonoId);
    if (abono === null) return { status: "no_encontrado" };
    if (esTienda && abono.tiendaId !== actor.usuarioId) return { status: "no_encontrado" };
    if (abono.comprobantePath === null) return { status: "sin_comprobante" }; // R44
    const url = await this.urls.createSignedUrl(abono.comprobantePath, this.config.SIGNED_URL_TTL_SECONDS);
    return { status: "ok", url };
  }

  private async saldoDe(tiendaId: string): Promise<SaldoTiendaDTO> {
    const agregado = await this.tiendaRepo.agregarSaldoPorTienda(tiendaId, {});
    return derivarSaldoTienda(agregado.creditos, agregado.debitos);
  }
}

/**
 * R14/R15/R66 — la regla del dinero, PURA: `null` si el pago cabe; si no, la respuesta. La deuda es el
 * valor absoluto del saldo en contra, STRING escala 2. Mutacion 6 de design §13 (`>` → `>=`): pagar
 * EXACTAMENTE la deuda tiene que dejar el saldo en 0,00, no rechazarse.
 */
function reglaDelDinero(
  saldo: SaldoTiendaDTO,
  monto: Prisma.Decimal,
): { status: "sin_deuda"; saldo: SaldoTiendaDTO } | { status: "excede"; deuda: string } | null {
  const actual = new Prisma.Decimal(saldo.saldo);
  if (actual.gte(0)) return { status: "sin_deuda", saldo };
  const deuda = actual.abs();
  if (monto.gt(deuda)) return { status: "excede", deuda: deuda.toFixed(2) };
  return null;
}

function errorDeCampo(
  campo: string,
  mensaje: string,
): { status: "validation_error"; fieldErrors: Record<string, string[]> } {
  return { status: "validation_error", fieldErrors: { [campo]: [mensaje] } };
}
