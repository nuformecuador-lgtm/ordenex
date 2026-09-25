import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { walletComprobanteConfig, type WalletComprobanteConfig } from "@/lib/config/wallet-comprobante";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  AporteCapitalRegistro,
  IAporteCapitalRepository,
} from "@/lib/interfaces/repositories/IAporteCapitalRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  AnularAporteCapitalServiceResult,
  AporteCapitalTxRunner,
  IAporteCapitalService,
  ObtenerComprobanteAporteServiceResult,
  RegistrarAporteCapitalServiceResult,
} from "@/lib/interfaces/services/IAporteCapitalService";
import type { ICajaAporteCapitalFeedService } from "@/lib/interfaces/services/ICajaAporteCapitalFeedService";
import type { ComprobanteRecibido } from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { compensarEvidencias } from "@/lib/services/evidencias-compensadas";
import type {
  AnularAporteCapitalInput,
  AporteCapitalDTO,
  RegistrarAporteCapitalInput,
} from "@/lib/types/aporte-capital";
import { problemaDeComprobante, rutaDeComprobante } from "@/lib/utils/comprobante";
import { medianocheUtcDelDia } from "@/lib/utils/descripcion-pago";
import { esFechaCalendarioValida, fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { instanteDelMovimientoManual } from "@/lib/utils/fecha-movimiento-manual";

class ClaveRepetidaError extends Error {
  constructor() {
    super("aporte de capital: clave de idempotencia repetida");
    this.name = "ClaveRepetidaError";
  }
}

class YaHaySaldoInicialError extends Error {
  constructor() {
    super("aporte de capital: ya hay un saldo inicial vigente");
    this.name = "YaHaySaldoInicialError";
  }
}

class YaAnuladoError extends Error {
  constructor() {
    super("aporte de capital: ya anulado");
    this.name = "YaAnuladoError";
  }
}

const ETIQUETA_CLASE = { saldo_inicial: "Saldo inicial", aporte: "Aporte de capital" } as const;

/** R58/R100 — sin ids de usuario, sin clave y sin ruta del comprobante. */
export function aAporteCapitalDTO(r: AporteCapitalRegistro): AporteCapitalDTO {
  return {
    id: r.id,
    clase: r.clase,
    monto: r.monto,
    motivo: r.motivo,
    fecha: r.fecha,
    registradoPorNombre: r.registradoPorNombre,
    registradoAt: r.registradoAt,
    anulado: r.anulado,
    tieneComprobante: r.comprobantePath !== null,
  };
}

/**
 * FICHA 459 (design §6.2) — el SALDO INICIAL o APORTE DE CAPITAL: dinero de Ordenex que entra a la
 * caja y NO es ganancia. Mismo molde que el pago por cuenta, sin tienda y con el candado de «un
 * solo saldo inicial vigente» (R70). Sube la cifra principal y el capital; no toca la ganancia,
 * «De las tiendas» ni ningun saldo de tienda (R72). R27: NUNCA propone ni calcula un importe.
 */
export class AporteCapitalService implements IAporteCapitalService {
  constructor(
    private readonly aporteRepo: IAporteCapitalRepository,
    private readonly caja: ICajaAporteCapitalFeedService,
    private readonly cajaLectura: Pick<IWalletMovimientoRepository, "primerDiaDeLaCaja">,
    private readonly comprobantes: IFileStorage,
    private readonly urls: ISignedUrlProvider,
    private readonly runTransaction: AporteCapitalTxRunner,
    private readonly ahora: () => Date = () => new Date(),
    private readonly config: Pick<
      WalletComprobanteConfig,
      "MAX_BYTES" | "SIGNED_URL_TTL_SECONDS"
    > = walletComprobanteConfig,
  ) {}

  async registrar(
    input: RegistrarAporteCapitalInput,
    comprobante: ComprobanteRecibido | null,
    actor: Actor,
  ): Promise<RegistrarAporteCapitalServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R76: antes de leer nada

    const montoStr = new Prisma.Decimal(input.monto)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2);

    // R69 (y P7): dia que existe y no posterior a hoy CR. SIN ventana hacia atras.
    if (!esFechaCalendarioValida(input.fecha)) {
      return errorDeCampo("fecha", "Esa fecha no existe en el calendario.");
    }
    if (input.fecha > fechaCalendarioCR(this.ahora())) {
      return errorDeCampo("fecha", "La fecha no puede ser posterior a hoy.");
    }
    // R71: el saldo inicial no puede ser POSTERIOR al primer dia de la caja sin capital.
    if (input.clase === "saldo_inicial") {
      const primerDia = await this.cajaLectura.primerDiaDeLaCaja({ excluirCapital: true });
      if (primerDia !== null && input.fecha > primerDia) {
        return errorDeCampo(
          "fecha",
          `El saldo inicial no puede ser posterior al ${primerDia}, el primer dia con movimientos en la caja.`,
        );
      }
    }

    let ruta: string | null = null;
    if (comprobante !== null) {
      const problema = problemaDeComprobante(
        { type: comprobante.contentType, size: comprobante.bytes.byteLength },
        this.config,
      );
      if (problema !== null) return errorDeCampo("comprobante", problema);
      try {
        ruta = await this.comprobantes.upload({
          path: rutaDeComprobante("aporte_capital", comprobante.contentType),
          bytes: comprobante.bytes,
          contentType: comprobante.contentType,
        });
      } catch {
        return { status: "comprobante_no_guardado" };
      }
    }

    const id = randomUUID();
    const fechaMovimiento = instanteDelMovimientoManual(input.fecha, this.ahora());

    let exito = false;
    try {
      const aporte = await this.runTransaction(async (tx) => {
        if (input.clase === "saldo_inicial") {
          // R70: el candado ANTES de mirar si ya hay uno; dos registros simultaneos se serializan.
          await this.aporteRepo.bloquearSaldoInicial(tx);
          if (await this.aporteRepo.haySaldoInicialVigente(tx)) throw new YaHaySaldoInicialError();
        }
        const creado = await this.aporteRepo.crear(tx, {
          id,
          claveIdempotencia: input.claveIdempotencia,
          clase: input.clase,
          monto: montoStr,
          motivo: input.motivo,
          fecha: medianocheUtcDelDia(input.fecha),
          comprobantePath: ruta,
          comprobanteContentType: ruta === null ? null : (comprobante?.contentType ?? null),
          registradoPor: actor.usuarioId,
        });
        if (creado.status === "clave_repetida") throw new ClaveRepetidaError();
        await this.caja.emitirIngresoDeCapital(tx, {
          aporteId: id,
          monto: montoStr,
          descripcion: ETIQUETA_CLASE[input.clase],
          registradoPor: actor.usuarioId,
          ...(fechaMovimiento !== undefined ? { fechaMovimiento } : {}),
        });
        return creado.aporte;
      });
      exito = true;
      return { status: "ok", aporte: aAporteCapitalDTO(aporte) };
    } catch (error) {
      if (error instanceof YaHaySaldoInicialError) return { status: "ya_hay_saldo_inicial" };
      if (error instanceof ClaveRepetidaError) {
        const original = await this.aporteRepo.obtenerPorClave(input.claveIdempotencia);
        if (original === null) {
          throw new Error("aporte de capital: clave repetida sin documento que releer");
        }
        return { status: "ya_registrado", aporte: aAporteCapitalDTO(original) };
      }
      throw error;
    } finally {
      if (!exito && ruta !== null) await compensarEvidencias(this.comprobantes, [ruta]);
    }
  }

  /** R74/R75 — la anulacion: su fila, su historial y la salida de capital, fechada HOY (el instante). */
  async anular(
    input: AnularAporteCapitalInput,
    actor: Actor,
  ): Promise<AnularAporteCapitalServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    const aporte = await this.aporteRepo.obtenerPorId(input.aporteId);
    if (aporte === null) return { status: "no_encontrado" };

    const instante = this.ahora();
    try {
      await this.runTransaction(async (tx) => {
        const anulada = await this.aporteRepo.anular(tx, {
          aporteId: aporte.id,
          motivo: input.motivo,
          anuladoPor: actor.usuarioId,
        });
        if (anulada.status === "ya_anulado") throw new YaAnuladoError();
        await this.caja.emitirReversoDeCapital(tx, {
          aporteId: aporte.id,
          monto: aporte.monto, // el monto DEL DOCUMENTO
          descripcion: `Anulación · ${ETIQUETA_CLASE[aporte.clase]}`,
          registradoPor: actor.usuarioId,
          fechaMovimiento: instante,
        });
      });
    } catch (error) {
      if (error instanceof YaAnuladoError) return { status: "ya_anulado" };
      throw error;
    }
    return { status: "ok" };
  }

  /** R57 — solo acceso total; el comprobante de un saldo inicial o aporte no es de ninguna tienda. */
  async obtenerComprobante(
    aporteId: string,
    actor: Actor,
  ): Promise<ObtenerComprobanteAporteServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };
    const aporte = await this.aporteRepo.obtenerPorId(aporteId);
    if (aporte === null) return { status: "no_encontrado" };
    if (aporte.comprobantePath === null) return { status: "sin_comprobante" };
    const url = await this.urls.createSignedUrl(
      aporte.comprobantePath,
      this.config.SIGNED_URL_TTL_SECONDS,
    );
    return { status: "ok", url };
  }
}

function errorDeCampo(
  campo: string,
  mensaje: string,
): { status: "validation_error"; fieldErrors: Record<string, string[]> } {
  return { status: "validation_error", fieldErrors: { [campo]: [mensaje] } };
}
