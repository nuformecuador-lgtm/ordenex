import { Prisma } from "@prisma/client";
import { cierreConfig } from "@/lib/config/cierre";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  CierreGestionPendienteRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  ITarifaZonaMensajeroRepository,
  PagoTarifa,
} from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
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
import { pagoPorResultado } from "@/lib/utils/pago-mensajero";
import { ingresoBodegaPorResultado } from "@/lib/utils/ingreso-bodega";

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
// Feature 39: ademas de la zona (37), el service resuelve el vehiculo del mensajero
// para el resolver de tarifa.
type OrdenRepo = Pick<IOrdenRepository, "findUsuarioZonaId" | "findUsuarioVehiculoId">;

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
    // Feature 39: resolver de la tarifa de pago al mensajero (por zona+vehiculo).
    private readonly tarifaZonaRepo: ITarifaZonaMensajeroRepository,
  ) {}

  /**
   * Feature 39/R1-R4: resuelve la tarifa de pago vigente del mensajero (por su zona +
   * vehiculo, con fallback a la tarifa por defecto de la zona). `null` si el mensajero no
   * tiene zona o la zona no tiene tarifa -> pago 0.00 no bloqueante (R8).
   */
  private async resolveTarifaMensajero(usuarioId: string): Promise<PagoTarifa | null> {
    const zonaId = await this.ordenRepo.findUsuarioZonaId(usuarioId); // R4: zona del MENSAJERO
    if (zonaId === null) return null; // sin zona -> pago 0.00 (R8), no bloquea la vista
    const vehiculoId = await this.ordenRepo.findUsuarioVehiculoId(usuarioId);
    return this.tarifaZonaRepo.resolvePagoTarifa(zonaId, vehiculoId); // R1/R2/R3
  }

  async listarCierreDia(actor: Actor): Promise<ListarCierreDiaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1/R2

    // R2/R3/R10/R18: SOLO lectura (R17). Filtrado por el actor en el repo. Feature 39:
    // resuelve la tarifa de pago del mensajero UNA vez (por zona+vehiculo) para derivar
    // el pago EN VIVO (R10/R11), en paralelo con el resto de lecturas.
    const [gestiones, pendientes, cierresPasados, tarifa] = await Promise.all([
      this.repo.findGestionesPendientes(actor.usuarioId),
      this.repo.contarOrdenesPendientesGestion(actor.usuarioId, ESTADOS_PENDIENTES),
      this.repo.findCierresByMensajero(actor.usuarioId),
      this.resolveTarifaMensajero(actor.usuarioId),
    ]);

    // R10/R11: pago DERIVADO por gestion (money-safe) + total, con la tarifa vigente.
    // Concepto INDEPENDIENTE del dinero recibido (R21): no toca `totales`.
    const { pagoByGestionId, total: totalPagoMensajero } = derivarPagos(gestiones, tarifa);

    // Feature 56/R9/R10: ingreso de bodega por rechazo DERIVADO por gestion + total, con la
    // MISMA tarifa ya resuelta (sin query extra). Concepto INDEPENDIENTE del pago al
    // mensajero (R7b) y del dinero recibido (R20). R23: tarifaFaltante = (tarifa === null).
    const { ingresoByGestionId, total: totalIngresoBodegaRechazos } = derivarIngresoBodega(
      gestiones,
      tarifa,
    );
    const tarifaFaltante = tarifa === null;

    // R5: firma en lote las evidencias (path crudo -> URL firmada de TTL acotado).
    const paths = gestiones
      .map((g) => g.evidenciaStoragePath)
      .filter((p): p is string => p !== null);
    const urlByPath =
      paths.length > 0
        ? await this.signedUrls.createSignedUrls(paths, cierreConfig.SIGNED_URL_TTL_SECONDS)
        : {};

    // R3: agrupa por resultado (las 4 claves siempre presentes). R10: cada DTO expone el
    // pago DERIVADO en vivo (override del snapshot, que aqui es null: gestion sin cerrar).
    const grupos: CierreGrupos = { entregada: [], reprogramada: [], devuelta: [], rechazada: [] };
    for (const g of gestiones) {
      grupos[g.resultado].push(
        toDetalleDTO(
          g,
          urlByPath,
          pagoByGestionId[g.gestionId], // feature 39: pago DERIVADO en vivo (override snapshot)
          ingresoByGestionId[g.gestionId], // feature 56: ingreso DERIVADO en vivo (override snapshot)
          tarifaFaltante, // feature 56/R23: derivado server-side (tarifa === null)
        ),
      );
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

    return {
      status: "ok",
      grupos,
      totales,
      totalPagoMensajero, // R11: separado de `totales` (R21)
      totalIngresoBodegaRechazos, // feature 56/R10: separado de `totales` y del pago al mensajero (R20)
      puedesSolicitar,
      motivoBloqueo,
      cierresPasados,
    };
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

    // R12/R13: snapshot del pago al mensajero con la tarifa vigente en ESTE instante
    // (por zona del mensajero + vehiculo; zonaId ya resuelto). El numero se congela: una
    // edicion posterior de la tarifa (feature 55) NO altera el cierre (R15).
    const vehiculoId = await this.ordenRepo.findUsuarioVehiculoId(actor.usuarioId);
    const tarifa = await this.tarifaZonaRepo.resolvePagoTarifa(zonaId, vehiculoId);
    const { pagoByGestionId, total: totalPagoMensajero } = derivarPagos(gestiones, tarifa);

    // Feature 56/R8/R11/R12: snapshot del ingreso de bodega por rechazos con la MISMA
    // tarifa ya resuelta (sin query extra) y el MISMO destino ya calculado (R8: el ingreso
    // queda atribuido a destinoTipo/destinoZonaId del cierre). El numero se congela: una
    // edicion posterior de la tarifa (feature 55) NO altera el cierre (R14).
    const { ingresoByGestionId, total: totalIngresoBodegaRechazos } = derivarIngresoBodega(
      gestiones,
      tarifa,
    );

    // R13/R14: transaccion todo-o-nada (INSERT + vincular gestiones + snapshot pago + ingreso).
    const cierreId = await this.repo.crearCierre({
      mensajeroId: actor.usuarioId,
      destinoTipo,
      destinoZonaId: zonaId,
      totales,
      pagoByGestionId, // R12: pago snapshoteado por gestion
      totalPagoMensajero, // R13: total snapshoteado
      ingresoByGestionId, // feature 56/R11: ingreso snapshoteado por gestion
      totalIngresoBodegaRechazos, // feature 56/R12: total snapshoteado del ingreso de bodega
    });

    return { status: "ok", cierreId, totales, destinoTipo };
  }
}

// R4/R5/R6: arma el DTO de detalle; la evidencia se expone SOLO firmada (R5).
// Exportado para reuso por CierresAdminService (feature 38): el detalle admin usa el
// MISMO mapper de gestion -> DTO (reuso F1.4-b).
// Feature 39: `pagoMensajero` opcional. En la vista EN VIVO del mensajero (37) se pasa el
// pago DERIVADO (override, R10). En el detalle admin (38/40) NO se pasa y se usa el
// snapshot `g.pagoMensajero` leido de la columna (R16). Nunca se mezcla con montoRecibido.
// Feature 56: `ingresoBodegaRechazo` opcional (mismo patron que `pagoMensajero`): en la
// vista EN VIVO (37) se pasa el ingreso DERIVADO (override, R9); en el detalle admin (38/40)
// NO se pasa y se usa el snapshot `g.ingresoBodegaRechazo` leido de la columna (R15/R19).
// `tarifaFaltante` (R23, F1.4-Q6): derivado server-side del `tarifa === null` en la vista
// EN VIVO; en el detalle admin (snapshot, sin re-resolver tarifa) es `false` por defecto.
export function toDetalleDTO(
  g: CierreGestionPendienteRow,
  urlByPath: Record<string, string>,
  pagoMensajero?: string | null,
  ingresoBodegaRechazo?: string | null,
  tarifaFaltante = false,
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
    pagoMensajero: pagoMensajero !== undefined ? pagoMensajero : g.pagoMensajero,
    ingresoBodegaRechazo:
      ingresoBodegaRechazo !== undefined ? ingresoBodegaRechazo : g.ingresoBodegaRechazo,
    tarifaFaltante,
  };
}

// Feature 39/R10-R13: pago al mensajero por gestion (DERIVADO/snapshot segun uso) + total,
// con la tarifa ya resuelta. Solo `entregada` paga `cobroEntregado`; el resto 0.00 (F1.4).
// Suma money-safe con Prisma.Decimal (R9). Reuso por listarCierreDia (en vivo) y
// solicitarCierre (congela el snapshot). Separado del dinero recibido (R21).
function derivarPagos(
  gestiones: CierreGestionPendienteRow[],
  tarifa: PagoTarifa | null,
): { pagoByGestionId: Record<string, string>; total: string } {
  const pagoByGestionId: Record<string, string> = {};
  let total = new Prisma.Decimal(0);
  for (const g of gestiones) {
    const pago = pagoPorResultado(g.resultado, tarifa);
    pagoByGestionId[g.gestionId] = pago;
    total = total.plus(pago);
  }
  return { pagoByGestionId, total: total.toFixed(2) };
}

// Feature 56/R9-R12: ingreso de BODEGA por rechazo por gestion (DERIVADO/snapshot segun
// uso) + total, con la MISMA tarifa ya resuelta para el pago (sin query extra). ESPEJO de
// `derivarPagos`: solo `rechazada` con tarifa que aplica genera ingreso; el resto 0.00
// (F1.4-Q1/Q2). Suma money-safe con Prisma.Decimal (R7). Reuso por listarCierreDia (en
// vivo, R9/R10) y solicitarCierre (congela el snapshot, R11/R12). Concepto INDEPENDIENTE
// del pago al mensajero (R7b) y del dinero recibido (R20).
function derivarIngresoBodega(
  gestiones: CierreGestionPendienteRow[],
  tarifa: PagoTarifa | null,
): { ingresoByGestionId: Record<string, string>; total: string } {
  const ingresoByGestionId: Record<string, string> = {};
  let total = new Prisma.Decimal(0);
  for (const g of gestiones) {
    const ingreso = ingresoBodegaPorResultado(g.resultado, tarifa);
    ingresoByGestionId[g.gestionId] = ingreso;
    total = total.plus(ingreso);
  }
  return { ingresoByGestionId, total: total.toFixed(2) };
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
