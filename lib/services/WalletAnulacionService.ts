import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type {
  FilaDeLibroParaAnular,
  FilaDeMensajeroParaAnular,
  IWalletAnulacionDestinoRepository,
} from "@/lib/interfaces/repositories/IWalletAnulacionDestinoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletAnulacionService, RutaAnulacion } from "@/lib/interfaces/services/IWalletAnulacionService";
import type { DestinoMovimiento } from "@/lib/types/wallet-anulacion";

/**
 * FICHA 458-B (design §4.2, R63/R65/R82) — decide por que camino se anula un destino.
 *
 * La 334 decidio no unificar el backend: `origen_tipo` decide que se anula y como, y cada camino
 * tiene su documento, su candado y su efecto. Esta clase NO anula nada: lee la fila (o el documento)
 * y la manda a la action que ya existe (172, 293, 459, 461, 457) o a las nuevas (egresos, cobro por
 * rechazo). La tabla de design §4.2, escrita UNA vez:
 *
 *   caja   egreso con origen `gasto`, indemnizacion con origen `orden_incidente` → egreso_caja
 *          correccion original (`manual`, sin `origen_id`)                        → ajuste_caja
 *          `ingreso_cobro_tienda` (propio o completado)                            → cobro_tienda (el debito)
 *          `egreso_pago_por_cuenta_tienda` / `ingreso_aporte_capital` / `ingreso_abono_tienda` → su documento
 *          `egreso_pago_tienda`                                                    → liquidacion_pago
 *          los dos ingresos del cobro por rechazo (`gestion_orden`)                → rechazo_tienda_cobro
 *          `egreso_pago_mensajero` con origen `ranking_snapshot_fila`              → premio_del_ranking
 *   tienda `cobro_manual` → cobro_tienda (la propia fila); `pago_tienda`, `pago_por_cuenta`, `abono_tienda`
 *          → su documento; los dos debitos del cobro por rechazo → rechazo_tienda_cobro
 *   mensajero `liquidacion` → liquidacion_pago; `premio_ranking` → premio_del_ranking (por su dia)
 *
 * Todo lo demas NO se anula desde aqui (R65), con el motivo dicho: lo que produce un cierre, las
 * salidas reclasificadas de la 459 y los contra-asientos.
 */
export class WalletAnulacionService implements IWalletAnulacionService {
  constructor(private readonly repo: IWalletAnulacionDestinoRepository) {}

  async enrutar(destino: DestinoMovimiento, actor: Actor): Promise<RutaAnulacion> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R82: antes de leer

    if ("documento" in destino) {
      switch (destino.documento) {
        case "liquidacion_pago":
          return { status: "ruta", camino: "liquidacion_pago", id: destino.id };
        case "pago_por_cuenta_tienda":
          return { status: "ruta", camino: "pago_por_cuenta_tienda", id: destino.id };
        case "aporte_capital":
          return { status: "ruta", camino: "aporte_capital", id: destino.id };
        case "abono_tienda":
          return { status: "ruta", camino: "abono_tienda", id: destino.id };
        case "rechazo_tienda_cobro":
          return { status: "ruta", camino: "rechazo_tienda_cobro", id: destino.id };
      }
    }

    switch (destino.libro) {
      case "caja": {
        const fila = await this.repo.filaDeCaja(destino.movimientoId);
        return fila === null ? { status: "no_encontrado" } : this.rutaDeCaja(fila);
      }
      case "tienda": {
        const fila = await this.repo.filaDeTienda(destino.movimientoId);
        return fila === null ? { status: "no_encontrado" } : this.rutaDeTienda(fila);
      }
      case "mensajero": {
        const fila = await this.repo.filaDeMensajero(destino.movimientoId);
        return fila === null ? { status: "no_encontrado" } : this.rutaDeMensajero(fila);
      }
    }
  }

  private async rutaDeCaja(f: FilaDeLibroParaAnular): Promise<RutaAnulacion> {
    if (f.tipo === "egreso" && f.origenTipo === "gasto") return ruta("egreso_caja", f.id);
    if (f.categoria === "egreso_indemnizacion" && f.origenTipo === "orden_incidente") {
      return ruta("egreso_caja", f.id);
    }
    if (
      (f.categoria === "ingreso_ajuste" || f.categoria === "egreso_ajuste") &&
      f.origenTipo === "manual" &&
      f.origenId === null
    ) {
      return ruta("ajuste_caja", f.id);
    }
    if (f.origenTipo === "cierre_dia") return noAnulable("nace_de_un_cierre");
    if (f.origenTipo === "cobro_manual_reclasificado") return noAnulable("reclasificado");
    if (f.origenId === null) return noAnulable("no_es_anulable");
    const doc = f.origenId;
    if (
      f.categoria === "ingreso_cobro_tienda" &&
      (f.origenTipo === "cobro_tienda" || f.origenTipo === "cobro_tienda_completado")
    ) {
      return ruta("cobro_tienda", doc);
    }
    if (f.categoria === "egreso_pago_por_cuenta_tienda" && f.origenTipo === "pago_por_cuenta_tienda") {
      return ruta("pago_por_cuenta_tienda", doc);
    }
    if (f.categoria === "ingreso_aporte_capital" && f.origenTipo === "aporte_capital") {
      return ruta("aporte_capital", doc);
    }
    if (f.categoria === "ingreso_abono_tienda" && f.origenTipo === "abono_tienda") {
      return ruta("abono_tienda", doc);
    }
    if (f.categoria === "egreso_pago_tienda" && f.origenTipo === "pago_tienda") {
      return ruta("liquidacion_pago", doc);
    }
    if (
      (f.categoria === "ingreso_flete_devolucion" || f.categoria === "ingreso_iva_flete_devolucion") &&
      f.origenTipo === "gestion_orden"
    ) {
      return this.rutaDeRechazo(doc);
    }
    if (f.categoria === "egreso_pago_mensajero" && f.origenTipo === "ranking_snapshot_fila") {
      return ruta("premio_del_ranking", doc);
    }
    // Lo que queda con `origen_id` es un contra-asiento: el reverso de un egreso, de un cobro, de un
    // pago, de un aporte, del cobro por rechazo o de un premio (R65).
    return noAnulable("contra_asiento");
  }

  private async rutaDeTienda(f: FilaDeLibroParaAnular): Promise<RutaAnulacion> {
    if (f.categoria === "cobro_manual" && f.origenTipo === "manual") return ruta("cobro_tienda", f.id);
    if (f.origenTipo === "cierre_dia") return noAnulable("nace_de_un_cierre");
    if (f.origenId === null) return noAnulable("no_es_anulable");
    const doc = f.origenId;
    if (f.categoria === "pago_tienda" && f.origenTipo === "pago_tienda") return ruta("liquidacion_pago", doc);
    if (f.categoria === "pago_por_cuenta" && f.origenTipo === "pago_por_cuenta_tienda") {
      return ruta("pago_por_cuenta_tienda", doc);
    }
    if (f.categoria === "abono_tienda" && f.origenTipo === "abono_tienda") return ruta("abono_tienda", doc);
    if (
      (f.categoria === "flete_devolucion" || f.categoria === "iva_flete_devolucion") &&
      f.origenTipo === "gestion_orden"
    ) {
      return this.rutaDeRechazo(doc);
    }
    if (f.origenTipo === "cobro_manual_reclasificado") return noAnulable("reclasificado");
    return noAnulable("contra_asiento");
  }

  private async rutaDeMensajero(f: FilaDeMensajeroParaAnular): Promise<RutaAnulacion> {
    if (f.categoria === "liquidacion" && f.origenTipo === "pago_mensajero" && f.origenId !== null) {
      return ruta("liquidacion_pago", f.origenId);
    }
    // El premio (293) se reconoce por `premio_dia`, que SOLO llevan el premio (devengo) y su reverso
    // (pago) — ver `db/schema.prisma`. El devengo se anula por la fila del podio; el reverso no.
    if (f.premioDia !== null) {
      if (f.tipo !== "devengo") return noAnulable("contra_asiento");
      const filaId = await this.repo.filaDelPodio(f.mensajeroId, f.premioDia);
      return filaId === null ? { status: "no_encontrado" } : ruta("premio_del_ranking", filaId);
    }
    if (f.categoria === "ajuste_devengo" || f.categoria === "ajuste_pago") return noAnulable("contra_asiento");
    if (f.origenTipo === "cierre_dia") return noAnulable("nace_de_un_cierre");
    return noAnulable("no_es_anulable");
  }

  private async rutaDeRechazo(gestionId: string): Promise<RutaAnulacion> {
    const cobroId = await this.repo.cobroRechazoDeGestion(gestionId);
    return cobroId === null ? { status: "no_encontrado" } : ruta("rechazo_tienda_cobro", cobroId);
  }
}

function ruta(camino: Extract<RutaAnulacion, { status: "ruta" }>["camino"], id: string): RutaAnulacion {
  return { status: "ruta", camino, id };
}

function noAnulable(motivo: Extract<RutaAnulacion, { status: "no_anulable" }>["motivo"]): RutaAnulacion {
  return { status: "no_anulable", motivo };
}
