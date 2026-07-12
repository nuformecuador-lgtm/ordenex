import { Prisma } from "@prisma/client";
import { cierreConfig } from "@/lib/config/cierre";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  CierreGestionPendienteRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreTotales,
  ICierreDiaService,
  ListarCierreDiaServiceResult,
  SolicitarCierreServiceResult,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreDestinoTipo } from "@/lib/types/cierre";

// Solo el rol autorizado en el modulo (R1/R2): el mensajero, SIEMPRE acotado a su
// propio `usuario.id` (el filtro por mensajero vive en el repo, en el WHERE).
const ROL_AUTORIZADO = "mensajero";

// R10: estados de una orden asignada que aun cuenta como "pendiente de gestion".
// Mientras el mensajero tenga alguna en estos estados, no puede cerrar.
const ESTADOS_PENDIENTES = ["en_espera_aceptacion", "en_reparto"];

// Mensajes accionables del gate/precondicion (R10/R11) y del ruteo (R12/R16).
const MSG_PENDIENTES = "Tenes ordenes sin gestionar; gestionalas antes de cerrar."; // R10
const MSG_VACIO = "No tenes gestiones pendientes de cierre."; // R11
const MSG_DUPLICADO = "Ya tenes un cierre solicitado pendiente de aprobacion."; // R12
const MSG_SIN_ZONA = "No tenes una zona asignada; contacta a tu administrador."; // R16

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran
// como Pick para dobles de test sin DB/red (patron RecepcionSateliteService).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
type OrdenRepo = Pick<IOrdenRepository, "findUsuarioZonaId">;

/**
 * Feature 37 — logica de negocio del "Cierre del dia" del mensajero. Lista el
 * detalle del dia + totales (money-safe con Prisma.Decimal), firma evidencias (R5)
 * y crea la solicitud de cierre con destino derivado por zona (R15) y snapshot de
 * totales (R14). No conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 */
export class CierreDiaService implements ICierreDiaService {
  constructor(
    private readonly repo: ICierreDiaRepository,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly signedUrls: ISignedUrlProvider,
  ) {}

  async listarCierreDia(actor: Actor): Promise<ListarCierreDiaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1/R2

    // R2/R3/R10/R18: SOLO lectura (R17). Filtrado por el actor en el repo.
    const [gestiones, pendientes, cierresPasados] = await Promise.all([
      this.repo.findGestionesPendientes(actor.usuarioId),
      this.repo.contarOrdenesPendientesGestion(actor.usuarioId, ESTADOS_PENDIENTES),
      this.repo.findCierresByMensajero(actor.usuarioId),
    ]);

    // R5: firma en lote las evidencias (path crudo -> URL firmada de TTL acotado).
    const paths = gestiones
      .map((g) => g.evidenciaStoragePath)
      .filter((p): p is string => p !== null);
    const urlByPath =
      paths.length > 0
        ? await this.signedUrls.createSignedUrls(paths, cierreConfig.SIGNED_URL_TTL_SECONDS)
        : {};

    // R3: agrupa por resultado (las 4 claves siempre presentes).
    const grupos: CierreGrupos = { entregada: [], reprogramada: [], devuelta: [], rechazada: [] };
    for (const g of gestiones) {
      grupos[g.resultado].push(toDetalleDTO(g, urlByPath));
    }

    // R7/R8/R9: totales por metodo con Prisma.Decimal (exactos al centavo).
    const totales = computeTotales(gestiones);

    // R10/R11: gate de "Solicitar cierre" con motivo accionable.
    let puedesSolicitar = true;
    let motivoBloqueo: string | null = null;
    if (pendientes > 0) {
      puedesSolicitar = false;
      motivoBloqueo = MSG_PENDIENTES; // R10
    } else if (gestiones.length === 0) {
      puedesSolicitar = false;
      motivoBloqueo = MSG_VACIO; // R11
    }

    return { status: "ok", grupos, totales, puedesSolicitar, motivoBloqueo, cierresPasados };
  }

  async solicitarCierre(actor: Actor): Promise<SolicitarCierreServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1

    // R10: precondicion — sin ordenes pendientes de gestion.
    const pendientes = await this.repo.contarOrdenesPendientesGestion(
      actor.usuarioId,
      ESTADOS_PENDIENTES,
    );
    if (pendientes > 0) return { status: "conflict", motivo: MSG_PENDIENTES };

    // R12: a lo sumo un cierre `solicitado` por mensajero a la vez.
    if (await this.repo.existeCierreSolicitado(actor.usuarioId)) {
      return { status: "conflict", motivo: MSG_DUPLICADO };
    }

    // R11: no se cierra un dia vacio.
    const gestiones = await this.repo.findGestionesPendientes(actor.usuarioId);
    if (gestiones.length === 0) return { status: "conflict", motivo: MSG_VACIO };

    // R15/R16: ruteo por la zona del mensajero (server-side).
    const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
    if (zonaId === null) {
      // R16: sin zona -> no se crea el cierre; mensaje accionable.
      return { status: "validation_error", fieldErrors: { zona: [MSG_SIN_ZONA] } };
    }
    // R15 + design §6 (feature 55 pendiente): si findCentralZonaId() devuelve null,
    // NINGUN mensajero clasifica como central -> fallback SEGURO a bodega_satelite
    // con su propia zona (no lanzar). La clasificacion a central empieza a funcionar
    // en runtime cuando la 55 marque la zona central.
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    const destinoTipo: CierreDestinoTipo =
      centralZonaId !== null && zonaId === centralZonaId ? "bodega_central" : "bodega_satelite";

    // R14: snapshot de totales calculado en este instante (mismo calculo que 3.1.4).
    const totales = computeTotales(gestiones);

    // R13: transaccion todo-o-nada (INSERT + vincular gestiones pendientes).
    const cierreId = await this.repo.crearCierre({
      mensajeroId: actor.usuarioId,
      destinoTipo,
      destinoZonaId: zonaId,
      totales,
    });

    return { status: "ok", cierreId, totales, destinoTipo };
  }
}

// R4/R5/R6: arma el DTO de detalle; la evidencia se expone SOLO firmada (R5).
// Exportado para reuso por CierresAdminService (feature 38): el detalle admin usa el
// MISMO mapper de gestion -> DTO (reuso F1.4-b).
export function toDetalleDTO(
  g: CierreGestionPendienteRow,
  urlByPath: Record<string, string>,
): CierreDetalleGestion {
  return {
    gestionId: g.gestionId,
    ordenId: g.ordenId,
    numGuia: g.numGuia,
    numRemision: g.numRemision,
    destinatario: g.destinatario,
    direccion: g.direccion,
    zonaNombre: g.zonaNombre,
    provinciaNombre: g.provinciaNombre,
    cantonNombre: g.cantonNombre,
    distritoNombre: g.distritoNombre,
    producto: g.producto,
    tiendaNombre: g.tiendaNombre,
    resultado: g.resultado,
    montoRecibido: g.montoRecibido,
    metodoPago: g.metodoPago,
    motivo: g.motivo,
    fechaReprogramacion: g.fechaReprogramacion,
    evidenciaUrl: g.evidenciaStoragePath ? (urlByPath[g.evidenciaStoragePath] ?? null) : null,
  };
}

// R7/R8/R9: suma con Prisma.Decimal (exacto). Solo `entregada` con montoRecibido
// aporta; reprogramada/devuelta/rechazada cuentan $0 (R8). Serializa a STRING (R9).
function computeTotales(gestiones: CierreGestionPendienteRow[]): CierreTotales {
  let efectivo = new Prisma.Decimal(0);
  let simpe = new Prisma.Decimal(0);
  let transferencia = new Prisma.Decimal(0);
  for (const g of gestiones) {
    if (g.resultado !== "entregada" || g.montoRecibido === null) continue; // R8
    const monto = new Prisma.Decimal(g.montoRecibido);
    switch (g.metodoPago) {
      case "efectivo":
        efectivo = efectivo.plus(monto);
        break;
      case "SIMPE":
        simpe = simpe.plus(monto);
        break;
      case "transferencia":
        transferencia = transferencia.plus(monto);
        break;
      default:
        break; // entregada sin metodo (dato inconsistente): no suma (defensivo)
    }
  }
  const general = efectivo.plus(simpe).plus(transferencia);
  return {
    efectivo: efectivo.toFixed(2),
    simpe: simpe.toFixed(2),
    transferencia: transferencia.toFixed(2),
    general: general.toFixed(2),
  };
}
