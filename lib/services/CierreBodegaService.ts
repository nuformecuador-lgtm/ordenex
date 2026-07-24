import { Prisma } from "@prisma/client";
import type { ICierreBodegaRepository } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";
import type {
  ICierreBodegaService,
  ListarConsolidacionServiceResult,
  SolicitarCierreBodegaServiceResult,
} from "@/lib/interfaces/services/ICierreBodegaService";

// Solo el rol autorizado (R1): el adminSatelite, SIEMPRE acotado a SU zona (el filtro
// por zona vive en el repo, en el WHERE).
const ROL_AUTORIZADO = "adminSatelite";

// Mensajes accionables del gate/precondicion.
const MSG_PENDIENTES =
  "Primero resolve los cierres de tus mensajeros antes de cerrar la bodega."; // R6
const MSG_VACIO = "No hay cierres de mensajero aprobados para consolidar."; // R7
const MSG_DUPLICADO = "Ya tenes un cierre de bodega solicitado pendiente de aprobacion."; // R8
const MSG_SIN_ZONA = "No tenes una zona asignada; contacta a tu administrador."; // R4

// Metodos de repo que consume el service (Pick para dobles de test sin DB/red).
type OrdenRepo = Pick<IOrdenRepository, "findUsuarioZonaId">;

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

// R10: suma exacta de los totales snapshot con Prisma.Decimal (sin parseFloat/Number).
// Serializa a STRING escala 2 (money-safe).
function sumTotales(items: { totales: CierreTotales }[]): CierreTotales {
  let efectivo = new Prisma.Decimal(0);
  let simpe = new Prisma.Decimal(0);
  let transferencia = new Prisma.Decimal(0);
  let general = new Prisma.Decimal(0);
  for (const it of items) {
    efectivo = efectivo.plus(it.totales.efectivo);
    simpe = simpe.plus(it.totales.simpe);
    transferencia = transferencia.plus(it.totales.transferencia);
    general = general.plus(it.totales.general);
  }
  return {
    efectivo: efectivo.toFixed(2),
    simpe: simpe.toFixed(2),
    transferencia: transferencia.toFixed(2),
    general: general.toFixed(2),
  };
}

// Feature 39/R18/R19: suma exacta del pago a mensajeros snapshoteado de los consolidables
// (Prisma.Decimal, sin parseFloat/Number). STRING escala 2 (money-safe). Concepto
// INDEPENDIENTE del dinero recibido (no altera sumTotales).
function sumPagoMensajero(items: { totalPagoMensajero: string }[]): string {
  let total = new Prisma.Decimal(0);
  for (const it of items) {
    total = total.plus(it.totalPagoMensajero);
  }
  return total.toFixed(2);
}

// Feature 56/R17/R18: suma exacta del ingreso de bodega por rechazos snapshoteado de los
// consolidables (Prisma.Decimal, sin parseFloat/Number). STRING escala 2 (money-safe).
// ESPEJO de sumPagoMensajero. Concepto INDEPENDIENTE del dinero recibido y del pago a
// mensajeros: no altera sumTotales ni sumPagoMensajero (R20).
function sumIngresoBodega(items: { totalIngresoBodegaRechazos: string }[]): string {
  let total = new Prisma.Decimal(0);
  for (const it of items) {
    total = total.plus(it.totalIngresoBodegaRechazos);
  }
  return total.toFixed(2);
}

/**
 * Reparto del EFECTIVO entre los pagos a mensajeros. Al mensajero se le paga SOLO con el
 * efectivo de la consolidacion (SINPE/transferencia no son plata en mano en la bodega), y el
 * pago es ATOMICO: o se le paga completo o no se le paga (no hay pago parcial). Con el
 * efectivo insuficiente se paga de MENOR a MAYOR monto, para pagarle a la mayor cantidad
 * posible de mensajeros; lo que queda sin pagar lo debe la central.
 *
 * El sobrante de efectivo NO se reasigna: si tras pagar a los que alcanzan quedan 500 y el
 * siguiente cobra 1500, esos 500 se quedan en la bodega (el pago parcial no existe).
 *
 * Devuelve STRING escala 2 (money-safe): la aritmetica es Prisma.Decimal, nunca number.
 */
function repartirEfectivo(
  efectivo: string,
  pagos: string[],
): { pagado: string; centralDebe: string } {
  const disponible = new Prisma.Decimal(efectivo);
  // Copia ordenada ascendente: `sort` muta, y `pagos` viene de los consolidables que el
  // caller sigue usando en el orden de la tabla.
  const ordenados = [...pagos].sort((a, b) =>
    new Prisma.Decimal(a).comparedTo(new Prisma.Decimal(b)),
  );
  let pagado = new Prisma.Decimal(0);
  let debe = new Prisma.Decimal(0);
  for (const p of ordenados) {
    const monto = new Prisma.Decimal(p);
    // `lessThanOrEqualTo` sobre el acumulado, no un `restante` que se va pisando: el que no
    // alcanza NO consume efectivo y el siguiente (mas caro) tampoco va a alcanzar, pero se
    // evalua igual para acumular su deuda.
    if (pagado.plus(monto).lessThanOrEqualTo(disponible)) {
      pagado = pagado.plus(monto);
    } else {
      debe = debe.plus(monto);
    }
  }
  return { pagado: pagado.toFixed(2), centralDebe: debe.toFixed(2) };
}

// Neto agregado: dinero recibido (total general) MENOS lo que EFECTIVAMENTE se pago a los
// mensajeros (no lo que se les debe: lo impago lo cubre la central y vive en `centralDebe`).
// Resta exacta con Prisma.Decimal (sin parseFloat/Number), STRING escala 2 (money-safe).
function netoDe(general: string, pagado: string): string {
  return new Prisma.Decimal(general).minus(pagado).toFixed(2);
}

// `true` si el error es una violacion del indice unico parcial (R8): otra solicitud
// concurrente creo el CierreBodega `solicitado` de la zona antes que esta.
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Feature 40 — logica de negocio del "Cierre de bodega" (lado adminSatelite: consolidar
 * + solicitar). Espejo de CierreDiaService (37), un nivel arriba: agrega los cierre_dia
 * `aprobado` de la zona en un CierreBodega con snapshot de totales AGREGADOS (R10). No
 * conoce HTTP ni Prisma; testeable con dobles sin red/DB. El alcance por zona vive en
 * el WHERE del repo (R3).
 */
export class CierreBodegaService implements ICierreBodegaService {
  constructor(
    private readonly repo: ICierreBodegaRepository,
    private readonly ordenRepo: OrdenRepo,
  ) {}

  async listarConsolidacion(actor: Actor): Promise<ListarConsolidacionServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1

    // R3/R4: alcance server-side por la zona del adminSatelite.
    const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
    if (zonaId === null) {
      // R4: sin zona -> modulo vacio con aviso; no se puede solicitar.
      return {
        status: "ok",
        consolidables: [],
        totalesAgregados: ZERO_TOTALES,
        totalPagoMensajeroAgregado: "0.00", // R18: sin zona, nada que agregar
        totalIngresoBodegaRechazosAgregado: "0.00", // feature 56/R17: sin zona, nada que agregar
        totalNetoAgregado: "0.00", // sin zona: 0.00 - 0.00
        totalCentralDebeAgregado: "0.00", // sin zona: nada que pagar, nada que deber
        puedesSolicitar: false,
        motivoBloqueo: MSG_SIN_ZONA,
        cierresBodegaPasados: [],
        sinZona: true,
      };
    }

    // R5/R6 + F1.4-h: SOLO lectura (R23). El filtro por zona/estado vive en el repo.
    const [consolidables, solicitados, cierresBodegaPasados] = await Promise.all([
      this.repo.findCierresDiaConsolidables(zonaId),
      this.repo.contarCierresDiaSolicitados(zonaId),
      this.repo.findCierresBodegaByZona(zonaId),
    ]);

    // R10: totales agregados exactos (suma con Prisma.Decimal de los snapshots).
    const totalesAgregados = sumTotales(consolidables);
    // R18: total agregado del pago a mensajeros (suma snapshot, separada de totalesAgregados).
    const totalPagoMensajeroAgregado = sumPagoMensajero(consolidables);
    // Feature 56/R17: total agregado del ingreso de bodega por rechazos (suma snapshot,
    // separada de totalesAgregados y del pago a mensajeros).
    const totalIngresoBodegaRechazosAgregado = sumIngresoBodega(consolidables);
    // Reparto del efectivo entre los pagos a mensajeros (atomico, de menor a mayor). El
    // agregado `totalPagoMensajeroAgregado` NO cambia: sigue siendo lo que se les debe en
    // total; esto solo decide cuanto de eso se puede pagar hoy y cuanto queda a la central.
    const { pagado, centralDebe } = repartirEfectivo(
      totalesAgregados.efectivo,
      consolidables.map((c) => c.totalPagoMensajero),
    );
    const totalCentralDebeAgregado = centralDebe;
    // Neto agregado DERIVADO: total general - lo EFECTIVAMENTE pagado.
    const totalNetoAgregado = netoDe(totalesAgregados.general, pagado);

    // R6/R7: gate de "Solicitar cierre de bodega" con motivo accionable.
    let puedesSolicitar = true;
    let motivoBloqueo: string | null = null;
    if (solicitados > 0) {
      puedesSolicitar = false;
      motivoBloqueo = MSG_PENDIENTES; // R6
    } else if (consolidables.length === 0) {
      puedesSolicitar = false;
      motivoBloqueo = MSG_VACIO; // R7
    }

    return {
      status: "ok",
      consolidables,
      totalesAgregados,
      totalPagoMensajeroAgregado, // R18
      totalIngresoBodegaRechazosAgregado, // feature 56/R17
      totalNetoAgregado,
      totalCentralDebeAgregado,
      puedesSolicitar,
      motivoBloqueo,
      cierresBodegaPasados,
      sinZona: false,
    };
  }

  async solicitarCierreBodega(actor: Actor): Promise<SolicitarCierreBodegaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1

    // R4: sin zona -> no se crea; mensaje accionable.
    const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
    if (zonaId === null) {
      return { status: "validation_error", fieldErrors: { zona: [MSG_SIN_ZONA] } };
    }

    // R6: precondicion — sin cierre_dia de la zona pendientes de resolver.
    if ((await this.repo.contarCierresDiaSolicitados(zonaId)) > 0) {
      return { status: "conflict", motivo: MSG_PENDIENTES };
    }

    // R7: no se cierra una bodega vacia.
    const consolidables = await this.repo.findCierresDiaConsolidables(zonaId);
    if (consolidables.length === 0) return { status: "conflict", motivo: MSG_VACIO };

    // R8: a lo sumo un cierre de bodega `solicitado` por zona a la vez.
    if (await this.repo.existeCierreBodegaSolicitado(zonaId)) {
      return { status: "conflict", motivo: MSG_DUPLICADO };
    }

    // R10: snapshot de totales agregados (mismo calculo que listarConsolidacion).
    const totales = sumTotales(consolidables);
    // R19: snapshot del pago agregado a mensajeros (mismo calculo que listarConsolidacion).
    const totalPagoMensajero = sumPagoMensajero(consolidables);
    // Feature 56/R18: snapshot del ingreso agregado de bodega por rechazos (mismo calculo).
    const totalIngresoBodegaRechazos = sumIngresoBodega(consolidables);

    // R9: transaccion todo-o-nada (INSERT + vincular). Si una solicitud concurrente
    // gano la carrera, el indice unico parcial lanza P2002 -> conflict (R8).
    try {
      const cierreBodegaId = await this.repo.crearCierreBodega({
        zonaId,
        solicitadoPor: actor.usuarioId,
        cierreDiaIds: consolidables.map((c) => c.cierreDiaId),
        totales,
        totalPagoMensajero, // R19: snapshot agregado en la misma tx
        totalIngresoBodegaRechazos, // feature 56/R18: snapshot agregado en la misma tx
      });
      return { status: "ok", cierreBodegaId, totales };
    } catch (e) {
      if (isUniqueViolation(e)) return { status: "conflict", motivo: MSG_DUPLICADO }; // R8
      throw e;
    }
  }
}
