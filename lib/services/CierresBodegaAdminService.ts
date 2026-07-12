import { cierreConfig } from "@/lib/config/cierre";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { ICierresBodegaAdminRepository } from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreGrupos } from "@/lib/interfaces/services/ICierreDiaService";
import type {
  CierreBodegaDetalleCierre,
  CierreBodegaResumen,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type {
  AprobarCierreBodegaServiceResult,
  CierreBodegaDetalleServiceResult,
  ICierresBodegaAdminService,
  ListarCierresBodegaAdminServiceResult,
  RechazarCierreBodegaServiceResult,
} from "@/lib/interfaces/services/ICierresBodegaAdminService";
import { toDetalleDTO } from "@/lib/services/CierreDiaService";

// Solo el rol autorizado (R2): el maestro (bodega central). El alcance del maestro es
// "todos los cierres de bodega" (van a la central), sin filtro de zona.
const ROL_AUTORIZADO = "maestro";

// Mensaje accionable cuando falta el motivo de rechazo (R17).
const MSG_MOTIVO_REQUERIDO = "El motivo de rechazo es obligatorio.";

/**
 * Feature 40 — logica de negocio de "Cierres de bodega" del maestro (aprobar /
 * rechazar). Espejo de CierresAdminService (38), aplicado a CierreBodega. Lista la cola
 * + historico, muestra el detalle agregado con evidencias firmadas (R12) y transiciona
 * `solicitado` -> aprobado/rechazado con guardia de estado (R18). No conoce HTTP ni
 * Prisma; testeable con dobles. Totales = snapshot, nunca recomputa (R13).
 */
export class CierresBodegaAdminService implements ICierresBodegaAdminService {
  constructor(
    private readonly repo: ICierresBodegaAdminRepository,
    private readonly signedUrls: ISignedUrlProvider,
  ) {}

  async listarCierresBodegaAdmin(
    actor: Actor,
  ): Promise<ListarCierresBodegaAdminServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R2

    // R23: SOLO lectura. R15: partir por estado (solicitado vs resuelto).
    const rows = await this.repo.findCierresBodega();
    const pendientes: CierreBodegaResumen[] = [];
    const historico: CierreBodegaResumen[] = [];
    for (const row of rows) {
      const resumen = toResumen(row); // R13: totales snapshot (string) sin recomputar
      if (row.estado === "solicitado") pendientes.push(resumen);
      else historico.push(resumen);
    }
    return { status: "ok", pendientes, historico };
  }

  async verCierreBodegaDetalle(
    cierreBodegaId: string,
    actor: Actor,
  ): Promise<CierreBodegaDetalleServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R2

    const found = await this.repo.findCierreBodegaConDetalle(cierreBodegaId);
    if (found === null) return { status: "no_encontrada" }; // R19

    // R12: firma en LOTE las evidencias de TODAS las gestiones de todos los cierre_dia
    // (path crudo -> URL firmada de TTL acotado). Nunca se expone el storage_path.
    const paths = found.cierresDia
      .flatMap((cd) => cd.gestiones.map((g) => g.evidenciaStoragePath))
      .filter((p): p is string => p !== null);
    const urlByPath =
      paths.length > 0
        ? await this.signedUrls.createSignedUrls(paths, cierreConfig.SIGNED_URL_TTL_SECONDS)
        : {};

    // R11: por cada cierre_dia, agrupa sus gestiones por resultado (4 claves siempre)
    // con el mapper reuso 37. Totales = snapshot del cierre_dia (R13).
    const cierres: CierreBodegaDetalleCierre[] = found.cierresDia.map((cd) => {
      const grupos: CierreGrupos = {
        entregada: [],
        reprogramada: [],
        devuelta: [],
        rechazada: [],
      };
      for (const g of cd.gestiones) {
        grupos[g.resultado].push(toDetalleDTO(g, urlByPath));
      }
      return {
        cierreDiaId: cd.resumen.cierreDiaId,
        mensajeroId: cd.resumen.mensajeroId,
        mensajeroNombre: cd.resumen.mensajeroNombre,
        totales: cd.resumen.totales,
        totalPagoMensajero: cd.resumen.totalPagoMensajero, // R20: snapshot por cierre_dia, sin recomputar
        grupos,
      };
    });

    // R11/R13: cabecera con totales agregados snapshot.
    return { status: "ok", cierre: toResumen(found.cierre), cierres };
  }

  async aprobarCierreBodega(
    cierreBodegaId: string,
    actor: Actor,
  ): Promise<AprobarCierreBodegaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R2

    // R16/R18-R20: transicion guardada. Aprobar limpia motivoRechazo (null).
    const res = await this.repo.resolverCierreBodega({
      id: cierreBodegaId,
      nuevoEstado: "aprobado",
      resueltoPor: actor.usuarioId, // R20
      motivoRechazo: null,
    });
    if (res === "updated") return { status: "ok", cierreBodegaId, estado: "aprobado" }; // R16
    if (res === "conflict") return { status: "conflict" }; // R18
    return { status: "no_encontrada" }; // fuera_de_alcance (R19)
  }

  async rechazarCierreBodega(
    cierreBodegaId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarCierreBodegaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R2

    // R17 (defensa): el borde ya valido con zod, pero el service re-exige motivo no
    // vacio antes de tocar el repo.
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      return { status: "validation_error", fieldErrors: { motivo: [MSG_MOTIVO_REQUERIDO] } };
    }

    // R17-R20: transicion guardada; persiste el motivo con el cierre.
    const res = await this.repo.resolverCierreBodega({
      id: cierreBodegaId,
      nuevoEstado: "rechazado",
      resueltoPor: actor.usuarioId, // R20
      motivoRechazo: motivoLimpio,
    });
    if (res === "updated") return { status: "ok", cierreBodegaId, estado: "rechazado" }; // R17
    if (res === "conflict") return { status: "conflict" }; // R18
    return { status: "no_encontrada" }; // fuera_de_alcance (R19)
  }
}

// Row cruda -> resumen de dominio. La fila ya trae los totales como STRING (R13) y las
// marcas de tiempo en ISO; el service no recomputa nada (snapshot money-critical).
function toResumen(row: CierreBodegaResumenRow): CierreBodegaResumen {
  return {
    cierreBodegaId: row.cierreBodegaId,
    zonaId: row.zonaId,
    zonaNombre: row.zonaNombre,
    solicitadoPorId: row.solicitadoPorId,
    solicitadoPorNombre: row.solicitadoPorNombre,
    estado: row.estado,
    totales: row.totales,
    totalPagoMensajero: row.totalPagoMensajero, // R20: snapshot agregado, sin recomputar
    cantidadCierres: row.cantidadCierres,
    solicitadoAt: row.solicitadoAt,
    resueltoAt: row.resueltoAt,
    motivoRechazo: row.motivoRechazo,
  };
}
