import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { cierreConfig } from "@/lib/config/cierre";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  Alcance,
  CierreAdminResumenRow,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreGrupos } from "@/lib/interfaces/services/ICierreDiaService";
import type {
  AprobarCierreServiceResult,
  CierreAdminResumen,
  CierreDetalleAdminServiceResult,
  ForzarSolicitudVencidoServiceResult,
  ICierresAdminService,
  ListarCierresAdminServiceResult,
  RechazarCierreServiceResult,
} from "@/lib/interfaces/services/ICierresAdminService";
import { toDetalleDTO } from "@/lib/services/CierreDiaService";
import {
  gananciaOrdenex,
  pagoTiendaOrdenex,
  totalesIngresoOrdenex,
} from "@/lib/utils/ingreso-ordenex";
import { desglosarIngresoBodegaPorOrigen } from "@/lib/utils/desglose-rechazos-sla";

// Roles autorizados en el modulo (R1): acceso total (maestro/admin -> bodega central) y el
// adminSatelite (su bodega). Cualquier otro -> forbidden.
const ROL_ADMIN_SATELITE = "adminSatelite";

// Mensaje accionable cuando falta el motivo de rechazo (R11).
const MSG_MOTIVO_REQUERIDO = "El motivo de rechazo es obligatorio.";

// Feature 109 (T3.1, R16): estados del catalogo que consume la LIBERACION de `sin_gestionar` al
// aprobar (destinos de bodega por zona de la orden).
const ESTADO_SIN_GESTIONAR = "sin_gestionar";
const ESTADO_EN_BODEGA = "en_bodega";
const ESTADO_EN_BODEGA_SATELITE = "en_bodega_satelite";

// Metodos de repo consumidos (Pick para dobles de test sin DB/red).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
// Feature 109 (T3.1): + `findEstatusIdByValue` para resolver los estatus destino de la liberacion.
type OrdenRepo = Pick<IOrdenRepository, "findUsuarioZonaId" | "findEstatusIdByValue">;

// Resultado interno de resolver el alcance del actor (R2/R3).
type AlcanceResult =
  | { status: "ok"; alcance: Alcance }
  | { status: "sinZona" } // adminSatelite sin zona (R3)
  | { status: "forbidden" }; // rol invalido (R1)

/**
 * Feature 38 — logica de negocio de "Cierres del dia" del admin (maestro /
 * adminSatelite). Lista los cierres del alcance (rol+zona), muestra el detalle con
 * evidencias firmadas (R7) y transiciona `solicitado` -> aprobado/rechazado con
 * guardia de estado+alcance (R12/R13). No conoce HTTP ni Prisma; testeable con dobles.
 */
export class CierresAdminService implements ICierresAdminService {
  constructor(
    private readonly repo: ICierresAdminRepository,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly signedUrls: ISignedUrlProvider,
  ) {}

  // R1/R2/R3: resuelve el alcance server-side por rol+zona. Acceso total (maestro/admin) ve
  // todos los `bodega_central` (sin filtro de zona); el adminSatelite solo su zona satelite.
  private async resolveAlcance(actor: Actor): Promise<AlcanceResult> {
    if (esAccesoTotal(actor.rol)) {
      return { status: "ok", alcance: { destinoTipo: "bodega_central", destinoZonaId: null } };
    }
    if (actor.rol === ROL_ADMIN_SATELITE) {
      const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
      if (zonaId === null) return { status: "sinZona" }; // R3
      return { status: "ok", alcance: { destinoTipo: "bodega_satelite", destinoZonaId: zonaId } };
    }
    return { status: "forbidden" }; // R1: cualquier otro rol
    // Nota: `zonaRepo.findCentralZonaId()` queda como verificacion defensiva reservada
    // (design §3.1): el destino ya viene resuelto/persistido por la 37; la 38 filtra
    // por destino_tipo/destino_zona_id (columnas indexadas), sin releer la zona central.
  }

  async listarCierresAdmin(actor: Actor): Promise<ListarCierresAdminServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") {
      return { status: "ok", pendientes: [], historico: [], sinZona: true }; // R3
    }

    // R2: el filtro por alcance vive en el repo (WHERE), nunca en memoria.
    const rows = await this.repo.findCierresByAlcance(scope.alcance);

    // R4/R5 + feature 41/E2 (R20): partir por estado. Los estados RESOLUBLES
    // (`solicitado` y `vencido`) van a la cola de pendientes; los resueltos
    // (`aprobado`/`rechazado`) al historico. El `vencido` viaja con su `estado` en el
    // resumen, para que el frontend lo etiquete diferenciado dentro de la cola (R20).
    const pendientes: CierreAdminResumen[] = [];
    const historico: CierreAdminResumen[] = [];
    for (const row of rows) {
      const resumen = toResumen(row); // R8/R9: totales snapshot (string) sin recomputar
      if (row.estado === "solicitado" || row.estado === "vencido") pendientes.push(resumen);
      else historico.push(resumen);
    }
    return { status: "ok", pendientes, historico, sinZona: false };
  }

  async verCierreDetalle(
    cierreId: string,
    actor: Actor,
  ): Promise<CierreDetalleAdminServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    // Sin zona no hay alcance valido: cualquier cierre esta, por definicion, fuera de
    // alcance (no se puede consultar sin acotar). R13: no_encontrada, sin filtrar.
    if (scope.status === "sinZona") return { status: "no_encontrada" };

    // R13: la guardia de alcance va en el WHERE del repo; null si no casa (no se
    // distingue "no existe" de "otra bodega/zona").
    const found = await this.repo.findCierreByIdEnAlcance(cierreId, scope.alcance);
    if (found === null) return { status: "no_encontrada" };

    // R7: firma en lote las evidencias (path crudo -> URL firmada de TTL acotado).
    const paths = found.gestiones
      .map((g) => g.evidenciaStoragePath)
      .filter((p): p is string => p !== null);
    const urlByPath =
      paths.length > 0
        ? await this.signedUrls.createSignedUrls(paths, cierreConfig.SIGNED_URL_TTL_SECONDS)
        : {};

    // R6: agrupa por resultado (4 claves siempre presentes) con el mapper reuso 37.
    const grupos: CierreGrupos = { entregada: [], reprogramada: [], devuelta: [], rechazada: [] };
    for (const g of found.gestiones) {
      grupos[g.resultado].push(toDetalleDTO(g, urlByPath));
    }

    // Totales por concepto del cierre: se suman desde el MISMO desglose por orden que ve el
    // admin en las tablas, no por una consulta aparte que podria no cuadrar con ellas.
    const totalesIngreso = totalesIngresoOrdenex(found.gestiones);

    // Ganancia DERIVADA: el ingreso bruto MENOS lo que se le debe al mensajero. El pago sale
    // del snapshot del cierre (no se recomputa, R4); el ingreso, del desglose por orden.
    const resumen = toResumen(found.cierre);
    const ganancia = gananciaOrdenex(totalesIngreso.total, resumen.totalPagoMensajero);

    // Pago a la tienda DERIVADO: lo RECIBIDO (total general) menos lo que Ordenex le factura
    // sobre esa plata. Sale de otra resta que la ganancia: parte de lo cobrado, no del bruto.
    const pagoTienda = pagoTiendaOrdenex(
      resumen.totales.general,
      totalesIngreso.fleteConIva,
      totalesIngreso.comisionConIva,
    );

    // Feature 102/R4-R8/R10: desglose SLA/manual del ingreso de bodega por rechazos, particionando
    // los montos por gestion YA snapshoteados por su clasificacion (esRechazoSla). SOLO LECTURA
    // (R6/R16): el `total` se LEE del snapshot del cierre (no se recomputa); la particion asegura
    // `sla + manual === total` (R5). El alcance satelite recibe este mismo desglose (R10).
    const desglose = desglosarIngresoBodegaPorOrigen(found.gestiones);
    const desgloseIngresoBodegaRechazos = {
      sla: desglose.totalSla,
      manual: desglose.totalManual,
      total: resumen.totalIngresoBodegaRechazos, // snapshot leido (R6), no recomputado
    };

    return {
      status: "ok",
      cierre: resumen,
      grupos,
      totalesIngreso,
      desgloseIngresoBodegaRechazos,
      ganancia,
      pagoTienda,
    };
  }

  async aprobarCierre(cierreId: string, actor: Actor): Promise<AprobarCierreServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") return { status: "no_encontrada" }; // R13

    // Feature 109 (T3.1, R16): resuelve la config de la LIBERACION de `sin_gestionar` (estatus
    // destino por zona + zona central). Se pasa SOLO al aprobar; el repo la corre DENTRO de la tx,
    // guardada por `estatus_id = sin_gestionar` (no-op si el cierre no tiene ordenes congeladas,
    // R20). Si el catalogo no tiene los estados (seed pendiente) -> undefined (no libera, defensivo).
    const [sinGestionarEstatusId, enBodegaEstatusId, enBodegaSateliteEstatusId, centralZonaId] =
      await Promise.all([
        this.ordenRepo.findEstatusIdByValue(ESTADO_SIN_GESTIONAR),
        this.ordenRepo.findEstatusIdByValue(ESTADO_EN_BODEGA),
        this.ordenRepo.findEstatusIdByValue(ESTADO_EN_BODEGA_SATELITE),
        this.zonaRepo.findCentralZonaId(),
      ]);
    const liberacionSinGestionar =
      sinGestionarEstatusId !== null &&
      enBodegaEstatusId !== null &&
      enBodegaSateliteEstatusId !== null
        ? { sinGestionarEstatusId, enBodegaEstatusId, enBodegaSateliteEstatusId, centralZonaId }
        : undefined;

    // R10/R12-R15: transicion guardada. Aprobar limpia motivoRechazo (null).
    const res = await this.repo.resolverCierre({
      cierreId,
      alcance: scope.alcance,
      nuevoEstado: "aprobado",
      resueltoPor: actor.usuarioId, // R14
      motivoRechazo: null,
      liberacionSinGestionar, // feature 109/R16: libera `sin_gestionar` en la misma tx
    });
    if (res === "updated") return { status: "ok", cierreId, estado: "aprobado" };
    if (res === "conflict") return { status: "conflict" }; // R12
    return { status: "no_encontrada" }; // fuera_de_alcance (R13)
  }

  async rechazarCierre(
    cierreId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarCierreServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1

    // R11 (defensa): el borde ya valido con zod, pero el service re-exige motivo no
    // vacio antes de tocar el repo.
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      return { status: "validation_error", fieldErrors: { motivo: [MSG_MOTIVO_REQUERIDO] } };
    }

    if (scope.status === "sinZona") return { status: "no_encontrada" }; // R13

    // R11-R15: transicion guardada; persiste el motivo con el cierre.
    const res = await this.repo.resolverCierre({
      cierreId,
      alcance: scope.alcance,
      nuevoEstado: "rechazado",
      resueltoPor: actor.usuarioId, // R14
      motivoRechazo: motivoLimpio,
    });
    if (res === "updated") return { status: "ok", cierreId, estado: "rechazado" };
    if (res === "conflict") return { status: "conflict" }; // R12
    return { status: "no_encontrada" }; // fuera_de_alcance (R13)
  }

  async forzarSolicitudVencido(
    cierreId: string,
    actor: Actor,
  ): Promise<ForzarSolicitudVencidoServiceResult> {
    // R16: acotada al alcance del admin (rol+zona destino), MISMO resolver que aprobar/rechazar.
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") return { status: "no_encontrada" }; // R13

    // R16: transicion guardada por estado ('vencido') + alcance en el repo. Money-safe (R21):
    // NO recalcula el snapshot ni toca `resuelto_por`/`resuelto_at`. R18: NO desbloquea; el
    // desbloqueo ocurre al APROBAR el `solicitado` resultante (que registra la auditoria, R17).
    const res = await this.repo.forzarSolicitudVencido(cierreId, scope.alcance);
    if (res === "updated") return { status: "ok", cierreId, estado: "solicitado" };
    if (res === "conflict") return { status: "conflict" }; // ya no es `vencido`
    return { status: "no_encontrada" }; // fuera_de_alcance / inexistente (R13)
  }
}

// Row cruda -> resumen de dominio. La fila ya trae los totales como STRING (R9) y las
// marcas de tiempo en ISO; el service no recomputa nada (R8, snapshot money-critical).
function toResumen(row: CierreAdminResumenRow): CierreAdminResumen {
  return {
    cierreId: row.cierreId,
    mensajeroId: row.mensajeroId,
    mensajeroNombre: row.mensajeroNombre,
    estado: row.estado,
    destinoTipo: row.destinoTipo,
    destinoZonaId: row.destinoZonaId,
    destinoZonaNombre: row.destinoZonaNombre,
    totales: row.totales,
    totalPagoMensajero: row.totalPagoMensajero, // R17: snapshot, sin recomputar
    totalIngresoBodegaRechazos: row.totalIngresoBodegaRechazos, // feature 56/R16: snapshot, sin recomputar
    solicitadoAt: row.solicitadoAt,
    resueltoAt: row.resueltoAt,
    motivoRechazo: row.motivoRechazo,
  };
}
