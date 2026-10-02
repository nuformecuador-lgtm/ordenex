import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICajaConDetalleService } from "@/lib/interfaces/services/ICajaConDetalleService";
import type { IDetalleEnLoteService } from "@/lib/interfaces/services/IDetalleEnLoteService";
import type { IEstadoCuentaConDetalleService } from "@/lib/interfaces/services/IEstadoCuentaConDetalleService";
import type { IEstadoCuentaService } from "@/lib/interfaces/services/IEstadoCuentaService";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type {
  CajaConDetalleServiceResult,
  DetalleEnLoteServiceResult,
  EstadoCuentaConDetalleServiceResult,
} from "@/lib/types/detalle-en-lote";
import type {
  EstadoCuentaCompletoInput,
  EstadoCuentaDTO,
  MiEstadoCuentaCompletoInput,
} from "@/lib/types/estado-cuenta";
import type { ListarLibroCajaCompletoServicioInput } from "@/lib/types/wallet";

/**
 * Ficha 464 (design §4, R14/R36/R38) — la descarga «Movimientos y detalle por orden» en UNA peticion.
 *
 * Orquestan, no deciden: la hoja de movimientos la lee el servicio de SIEMPRE con la MISMA entrada (los
 * filtros, el termino y el orden de la 463), asi que sus filas y su orden son exactamente los de «Solo
 * los movimientos» (R14). Si esa lectura no es `ok` —tope, rol, cuenta— se devuelve TAL CUAL (R38), sin
 * pedir el detalle. Si es `ok`, el detalle se pide para ESOS movimientos y no para otros (R36): las dos
 * hojas hablan del mismo conjunto porque salen del mismo resultado.
 *
 * DOS clases y no una (design §4 hablaba de un `LibroConDetalleService`): cada composition root inyecta
 * EXACTAMENTE lo que su clase usa, con un constructor sin opcionales. Una sola clase obligaria a la
 * accion de la caja a construir el estado de cuenta (y al reves) solo para satisfacer al constructor.
 */
export class CajaConDetalleService implements ICajaConDetalleService {
  constructor(
    private readonly caja: Pick<IWalletService, "listarMovimientosCompleto">,
    private readonly detalleEnLote: IDetalleEnLoteService,
  ) {}

  async cajaConDetalle(
    input: ListarLibroCajaCompletoServicioInput,
    actor: Actor,
  ): Promise<CajaConDetalleServiceResult> {
    const r = await this.caja.listarMovimientosCompleto(input, actor);
    if (r.status === "limite_excedido") return { ...r, hoja: "movimientos" };
    if (r.status !== "ok") return r;
    const d = await this.detalleEnLote.detallar(
      {
        superficie: "caja",
        movimientos: r.items.map((m) => ({
          id: m.id,
          categoria: m.categoria,
          monto: m.monto,
          origenTipo: m.origenTipo,
          origenId: m.origenId,
        })),
      },
      actor,
    );
    if (d.status !== "ok") return conHojaDetalle(d);
    return { status: "ok", items: r.items, total: r.total, detalle: d.detalle };
  }
}

export class EstadoCuentaConDetalleService implements IEstadoCuentaConDetalleService {
  constructor(
    private readonly estadoCuenta: Pick<IEstadoCuentaService, "leerCompleto" | "leerMiTiendaCompleto">,
    private readonly detalleEnLote: IDetalleEnLoteService,
  ) {}

  async tiendaConDetalle(
    input: EstadoCuentaCompletoInput,
    actor: Actor,
  ): Promise<EstadoCuentaConDetalleServiceResult> {
    // El borde ya lo rechaza; se repite aqui porque el detalle por orden SOLO existe en la tienda (R7).
    if (input.cuenta.tipo !== "tienda") {
      return {
        status: "validation_error",
        fieldErrors: { cuenta: ["El detalle por orden solo existe en el estado de cuenta de una tienda."] },
      };
    }
    const r = await this.estadoCuenta.leerCompleto(input, actor);
    if (r.status === "limite_excedido") return { ...r, hoja: "movimientos" };
    if (r.status !== "ok") return r;
    const d = await this.detalleEnLote.detallar(
      { superficie: "tienda_oficina", tiendaId: r.estado.cuenta.id, movimientoIds: idsDeTienda(r.estado) },
      actor,
    );
    if (d.status !== "ok") return conHojaDetalle(d);
    return { status: "ok", estado: r.estado, detalle: d.detalle };
  }

  async miTiendaConDetalle(
    input: MiEstadoCuentaCompletoInput,
    actor: Actor,
  ): Promise<EstadoCuentaConDetalleServiceResult> {
    const r = await this.estadoCuenta.leerMiTiendaCompleto(input, actor);
    if (r.status === "limite_excedido") return { ...r, hoja: "movimientos" };
    if (r.status !== "ok") return r;
    const d = await this.detalleEnLote.detallar(
      { superficie: "mi_wallet", movimientoIds: idsDeTienda(r.estado) },
      actor,
    );
    if (d.status !== "ok") return conHojaDetalle(d);
    return { status: "ok", estado: r.estado, detalle: d.detalle };
  }
}

/** Los ids del ledger de la tienda de cada fila de la hoja, en su orden (el enlace: `ref.movimientoId`). */
function idsDeTienda(estado: EstadoCuentaDTO): string[] {
  const ids: string[] = [];
  for (const fila of estado.filas) {
    if (fila.ref !== null && "libro" in fila.ref && fila.ref.libro === "tienda") ids.push(fila.ref.movimientoId);
  }
  return ids;
}

/** `limite_excedido` del DETALLE (R39) gana `hoja: "detalle"`; `forbidden` pasa tal cual. */
function conHojaDetalle(
  d: Exclude<DetalleEnLoteServiceResult, { status: "ok" }>,
): { status: "limite_excedido"; hoja: "detalle"; total: number; limite: number } | { status: "forbidden" } {
  return d.status === "limite_excedido" ? { ...d, hoja: "detalle" } : d;
}
