import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { walletComprobanteConfig, type WalletComprobanteConfig } from "@/lib/config/wallet-comprobante";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { ILiquidacionPagoRepository } from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type {
  IPagoPorCuentaTiendaRepository,
  PagoPorCuentaRegistro,
} from "@/lib/interfaces/repositories/IPagoPorCuentaTiendaRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { ICajaPagoPorCuentaFeedService } from "@/lib/interfaces/services/ICajaPagoPorCuentaFeedService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnularPagoPorCuentaServiceResult,
  ComprobanteRecibido,
  IPagoPorCuentaTiendaService,
  ObtenerComprobanteServiceResult,
  PagoPorCuentaTxRunner,
  RegistrarPagoPorCuentaServiceResult,
} from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import { compensarEvidencias } from "@/lib/services/evidencias-compensadas";
import type {
  AnularPagoPorCuentaTiendaInput,
  PagoPorCuentaTiendaDTO,
  RegistrarPagoPorCuentaTiendaInput,
} from "@/lib/types/pago-por-cuenta-tienda";
import type { SaldoTiendaDTO } from "@/lib/types/wallet-tienda";
import { problemaDeComprobante, rutaDeComprobante } from "@/lib/utils/comprobante";
import { medianocheUtcDelDia } from "@/lib/utils/descripcion-pago";
import {
  descripcionAnulacionPagoPorCuenta,
  descripcionPagoPorCuentaEnCaja,
  descripcionPagoPorCuentaEnTienda,
} from "@/lib/utils/descripcion-pago-por-cuenta";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { instanteDelMovimientoManual } from "@/lib/utils/fecha-movimiento-manual";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

const ROL_TIENDA = "adminTienda";
const ESTADO_TIENDA = "activo";

/** R36 — los MISMOS mensajes que el cobro de un costo (`CobroTiendaService`). */
const MSG_TIENDA = {
  inexistente: "La tienda no existe",
  rol: "La cuenta elegida no es una tienda",
  inactiva: "La tienda no esta activa",
} as const;

/** Señal interna: el choque de la clave se responde FUERA de la transaccion (que revierte). */
class ClaveRepetidaError extends Error {
  constructor() {
    super("pago por cuenta: clave de idempotencia repetida");
    this.name = "ClaveRepetidaError";
  }
}

class YaAnuladoError extends Error {
  constructor() {
    super("pago por cuenta: ya anulado");
    this.name = "YaAnuladoError";
  }
}

/** R58/R100 — el DTO: ni la tienda por id, ni la ruta del comprobante. */
export function aPagoPorCuentaDTO(r: PagoPorCuentaRegistro): PagoPorCuentaTiendaDTO {
  return {
    id: r.id,
    tiendaNombre: r.tiendaNombre,
    beneficiario: r.beneficiario,
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
 * FICHA 459 (design §6.1) — el PAGO POR CUENTA de una tienda: Ordenex saca dinero de la caja para
 * pagarle a un tercero en nombre de la tienda. En UNA transaccion: el documento y su historial,
 * el cargo en el libro de la tienda y la salida en la caja, con el MISMO monto y el MISMO instante
 * (R29). Baja la caja y «De las tiendas», baja el saldo de la tienda y NO toca la ganancia (R39).
 */
export class PagoPorCuentaTiendaService implements IPagoPorCuentaTiendaService {
  constructor(
    private readonly pagoRepo: IPagoPorCuentaTiendaRepository,
    private readonly tiendaRepo: Pick<
      IWalletTiendaMovimientoRepository,
      "crearMovimientos" | "agregarSaldoPorTienda"
    >,
    /** R42 — el MISMO candado de tienda que toma el pago de Ordenex a esa tienda. */
    private readonly candado: Pick<ILiquidacionPagoRepository, "bloquearBeneficiario">,
    private readonly usuarioRepo: Pick<IUserRepository, "obtenerCuentaTienda">,
    /** Obligatorio: sin caja no se construye (un pago por cuenta sin salida seria F1 otra vez). */
    private readonly caja: ICajaPagoPorCuentaFeedService,
    private readonly comprobantes: IFileStorage,
    private readonly urls: ISignedUrlProvider,
    private readonly runTransaction: PagoPorCuentaTxRunner,
    private readonly ahora: () => Date = () => new Date(),
    private readonly config: Pick<
      WalletComprobanteConfig,
      "MAX_BYTES" | "SIGNED_URL_TTL_SECONDS"
    > = walletComprobanteConfig,
  ) {}

  /**
   * EL ORDEN ES PARTE DEL REQUISITO (design §6.1):
   *  1. ROL antes de leer nada (R38).
   *  2. ESCALA 2 una vez: el MISMO string va a las cuatro escrituras.
   *  3. La TIENDA, validada en el servidor (R36).
   *  4. El COMPROBANTE, validado y subido ANTES de la transaccion (R54–R56).
   *  5. La TRANSACCION: candado de la tienda ANTES de escribir (R42) → documento + historial →
   *     cargo en la tienda → salida en la caja.
   *  6. El saldo DESPUES, derivado; puede ser negativo (R40).
   *  7. Ante cualquier desenlace distinto de `ok`, se retira el comprobante subido (R56).
   */
  async registrar(
    input: RegistrarPagoPorCuentaTiendaInput,
    comprobante: ComprobanteRecibido | null,
    actor: Actor,
  ): Promise<RegistrarPagoPorCuentaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R38: antes de leer nada

    const montoStr = new Prisma.Decimal(input.monto)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2);

    const cuenta = await this.usuarioRepo.obtenerCuentaTienda(input.tiendaId);
    if (cuenta === null) return errorDeCampo("tiendaId", MSG_TIENDA.inexistente);
    if (cuenta.rol !== ROL_TIENDA) return errorDeCampo("tiendaId", MSG_TIENDA.rol);
    if (cuenta.estado !== ESTADO_TIENDA) return errorDeCampo("tiendaId", MSG_TIENDA.inactiva);

    let ruta: string | null = null;
    if (comprobante !== null) {
      const problema = problemaDeComprobante(
        { type: comprobante.contentType, size: comprobante.bytes.byteLength },
        this.config,
      );
      if (problema !== null) return errorDeCampo("comprobante", problema);
      try {
        ruta = await this.comprobantes.upload({
          path: rutaDeComprobante("pago_por_cuenta_tienda", comprobante.contentType),
          bytes: comprobante.bytes,
          contentType: comprobante.contentType,
        });
      } catch {
        return { status: "comprobante_no_guardado" }; // R56: sin comprobante no hay registro
      }
    }

    const id = randomUUID();
    // R29/R35: el MISMO instante para el cargo y para la salida. Con un dia anterior, su inicio CR
    // (ficha 334). Con «hoy», el reloj del servicio y NO el DEFAULT de la columna: design §6.1
    // suponia que el `DEFAULT now()` daba el mismo valor a las dos filas de la transaccion, pero
    // Prisma rellena `@default(now())` en el CLIENTE, fila a fila — medido contra Postgres: 4 ms de
    // diferencia entre el cargo y la salida (`pago-por-cuenta-tienda.test.ts`).
    const ahora = this.ahora();
    const fechaMovimiento = instanteDelMovimientoManual(input.fecha, ahora) ?? ahora;
    const fechaPago = medianocheUtcDelDia(input.fecha ?? fechaCalendarioCR(ahora));
    const datosDescripcion = {
      beneficiario: input.beneficiario,
      motivo: input.motivo,
      metodo: input.metodo,
      referencia: input.referencia ?? null,
    };

    let exito = false;
    try {
      const pago = await this.runTransaction(async (tx) => {
        await this.candado.bloquearBeneficiario(tx, { tipo: "tienda", tiendaId: input.tiendaId });
        const creado = await this.pagoRepo.crear(tx, {
          id,
          claveIdempotencia: input.claveIdempotencia,
          tiendaId: input.tiendaId,
          beneficiario: input.beneficiario,
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
            tipo: "debito",
            categoria: "pago_por_cuenta",
            monto: montoStr,
            origenTipo: "pago_por_cuenta_tienda",
            origenId: id,
            descripcion: descripcionPagoPorCuentaEnTienda(datosDescripcion),
            registradoPor: actor.usuarioId,
            fechaMovimiento,
          },
        ]);
        await this.caja.emitirEgresoDePagoPorCuenta(tx, {
          pagoId: id,
          monto: montoStr,
          descripcion: descripcionPagoPorCuentaEnCaja(creado.pago.tiendaNombre, datosDescripcion),
          registradoPor: actor.usuarioId,
          fechaMovimiento,
        });
        return creado.pago;
      });
      exito = true;
      return { status: "ok", pago: aPagoPorCuentaDTO(pago), saldo: await this.saldoDe(input.tiendaId) };
    } catch (error) {
      if (error instanceof ClaveRepetidaError) {
        const original = await this.pagoRepo.obtenerPorClave(input.claveIdempotencia);
        if (original === null) {
          throw new Error("pago por cuenta: clave repetida sin documento que releer");
        }
        return {
          status: "ya_registrado",
          pago: aPagoPorCuentaDTO(original),
          saldo: await this.saldoDe(original.tiendaId),
        };
      }
      throw error;
    } finally {
      // R41/R56: si no quedo registrado ESTE pago, el comprobante que se subio no pertenece a nada.
      if (!exito && ruta !== null) await compensarEvidencias(this.comprobantes, [ruta]);
    }
  }

  /**
   * R46–R52 — la anulacion. El documento se lee FUERA de la transaccion (es inmutable y hace falta
   * saber su tienda para tomar el candado); el monto del contra-asiento es el DEL DOCUMENTO; los
   * dos asientos se fechan con el MISMO instante de la anulacion (R47). El comprobante NO se toca.
   */
  async anular(
    input: AnularPagoPorCuentaTiendaInput,
    actor: Actor,
  ): Promise<AnularPagoPorCuentaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R38: antes de leer nada

    const pago = await this.pagoRepo.obtenerPorId(input.pagoId);
    if (pago === null) return { status: "no_encontrado" }; // R51

    const instante = this.ahora();
    const datosDescripcion = {
      beneficiario: pago.beneficiario,
      motivo: pago.motivo,
      metodo: pago.metodo,
      referencia: pago.referencia,
    };

    try {
      await this.runTransaction(async (tx) => {
        await this.candado.bloquearBeneficiario(tx, { tipo: "tienda", tiendaId: pago.tiendaId });
        const anulada = await this.pagoRepo.anular(tx, {
          pagoId: pago.id,
          motivo: input.motivo,
          anuladoPor: actor.usuarioId,
        });
        if (anulada.status === "ya_anulado") throw new YaAnuladoError();

        await this.tiendaRepo.crearMovimientos(tx, [
          {
            tiendaId: pago.tiendaId,
            tipo: "credito",
            categoria: "pago_por_cuenta_anulado",
            monto: pago.monto, // R46: el monto DEL DOCUMENTO, nunca uno de la peticion
            origenTipo: "pago_por_cuenta_tienda",
            origenId: pago.id,
            descripcion: descripcionAnulacionPagoPorCuenta(
              descripcionPagoPorCuentaEnTienda(datosDescripcion),
            ),
            registradoPor: actor.usuarioId,
            fechaMovimiento: instante,
          },
        ]);
        await this.caja.emitirReversoDePagoPorCuenta(tx, {
          pagoId: pago.id,
          monto: pago.monto,
          descripcion: descripcionAnulacionPagoPorCuenta(
            descripcionPagoPorCuentaEnCaja(pago.tiendaNombre, datosDescripcion),
          ),
          registradoPor: actor.usuarioId,
          fechaMovimiento: instante,
        });
      });
    } catch (error) {
      if (error instanceof YaAnuladoError) return { status: "ya_anulado" }; // R50
      throw error;
    }
    return { status: "ok", saldo: await this.saldoDe(pago.tiendaId) };
  }

  /**
   * R57 — el enlace temporal del comprobante. Acceso total: cualquiera. La tienda DUEÑA: el suyo.
   * A una tienda que pide un pago ajeno o inexistente se le responde lo MISMO (`no_encontrado`).
   * Cualquier otro rol: `forbidden`, antes de leer.
   */
  async obtenerComprobante(pagoId: string, actor: Actor): Promise<ObtenerComprobanteServiceResult> {
    const esTienda = actor.rol === ROL_TIENDA;
    if (!esAccesoTotal(actor.rol) && !esTienda) return { status: "forbidden" };

    const pago = await this.pagoRepo.obtenerPorId(pagoId);
    if (pago === null) return { status: "no_encontrado" };
    if (esTienda && pago.tiendaId !== actor.usuarioId) return { status: "no_encontrado" };
    if (pago.comprobantePath === null) return { status: "sin_comprobante" };
    const url = await this.urls.createSignedUrl(
      pago.comprobantePath,
      this.config.SIGNED_URL_TTL_SECONDS,
    );
    return { status: "ok", url };
  }

  private async saldoDe(tiendaId: string): Promise<SaldoTiendaDTO> {
    const agregado = await this.tiendaRepo.agregarSaldoPorTienda(tiendaId, {});
    return derivarSaldoTienda(agregado.creditos, agregado.debitos);
  }
}

function errorDeCampo(
  campo: string,
  mensaje: string,
): { status: "validation_error"; fieldErrors: Record<string, string[]> } {
  return { status: "validation_error", fieldErrors: { [campo]: [mensaje] } };
}
