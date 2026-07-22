import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  Alcance,
  CierreAdminResumenRow,
  ICierresAdminRepository,
  ResolverCierreInput,
  ResolverCierreResult,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletFeedService } from "@/lib/interfaces/services/IWalletFeedService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IWalletTiendaFeedService } from "@/lib/interfaces/services/IWalletTiendaFeedService";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletMensajeroFeedService } from "@/lib/interfaces/services/IWalletMensajeroFeedService";
import type { CierreEstado } from "@/lib/types/cierre";
import type {
  IngresoOrdenexDTO,
  TarifaSnapshotDTO,
} from "@/lib/interfaces/services/ICierreDiaService";
import { CierreDetalleFaltanteError, tarifaDe } from "@/lib/utils/cierre-detalle";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { esRechazoSla, ORIGEN_TIPO_RECHAZO_SLA } from "@/lib/utils/rechazo-sla-flag";

// Estados de ORIGEN que la resolucion NORMAL (aprobar/rechazar) puede transicionar (R12).
// Feature 111/R15 (Q1-B): se RETIRA `vencido` (revierte parcialmente la 41 R19). El approve/
// reject normal opera SOLO sobre `solicitado`: el flujo normal de un `vencido` es que el
// mensajero lo solicite (`vencido -> solicitado`, R6) o que el admin lo destrabe por la
// VALVULA DE ESCAPE (`forzarSolicitudVencido`, R16) y luego lo apruebe/rechace ya como
// `solicitado`. Los totales NO se recalculan (R4).
const ESTADOS_RESOLUBLES: CierreEstado[] = ["solicitado"];

// Feature 111/R16: estados que la VALVULA DE ESCAPE toca. Solo transiciona un `vencido`
// ABANDONADO a `solicitado` (en nombre del mensajero ausente); guardada por estado.
const ESTADO_VENCIDO: CierreEstado = "vencido";
const ESTADO_SOLICITADO: CierreEstado = "solicitado";

// Feature 42/T8: la resolucion del cierre ahora orquesta una transaccion (para alimentar
// la wallet atomicamente al aprobar, R5/R7) -> el cliente necesita `$transaction`.
// Feature 69/T18: el detalle del admin sale del SNAPSHOT -> necesita `cierreDetail`.
type CierresAdminPrismaClient = Pick<
  PrismaClient,
  "cierreDia" | "gestionOrden" | "cierreDetail" | "$transaction"
>;

// Feature 69/T18 (R15) — proyeccion del detalle del cierre YA CREADO: los DESCRIPTIVOS
// congelados de la orden (`WITH_DETALLE` los navegaba VIVOS via `gestion_orden.orden.*`).
// Exportado desde T23: `CierresBodegaAdminRepository` (feature 40) muestra el detalle del
// MISMO cierre_dia ya creado y debe leerlo del MISMO snapshot. Compartir la proyeccion y el
// mapper (y no re-escribirlos) es lo que impide que las dos pantallas de admin diverjan.
export const DETALLE_ADMIN_SELECT = {
  ordenId: true,
  numGuia: true,
  numRemision: true,
  destinatario: true,
  direccion: true,
  producto: true,
  tiendaNombre: true,
  zonaNombre: true,
  provinciaNombre: true,
  cantonNombre: true,
  distritoNombre: true,
  // Entradas de la formula del ingreso + la tarifa congelada (feature 69/R6/R8). El admin
  // ve el desglose completo (flete, IVA, comision) y de que tarifa salio, sin volver a
  // consultar datos VIVOS: el snapshot es la unica fuente (R14).
  montoCobrar: true,
  cobraComision: true,
  esCentral: true,
  tarifaId: true,
  tarifaValorFlete: true,
  tarifaValorFleteGam: true,
  tarifaValorFleteDevuelto: true,
  tarifaValorFleteDevueltoGam: true,
  tarifaComisionCod: true,
  tarifaIvaFlete: true,
  tarifaIvaComisionCod: true,
} as const;

// Feature 69/T18 — lo que aporta la GESTION (que NO se congela: es suyo, no de la orden).
// Feature 102/T2 (R1/R3): + la relacion `historialEstados` ACOTADA al origen SLA (feature 99),
// para DERIVAR `esRechazoSla` por gestion sin columna/migracion nueva. `where` + `take: 1` la
// dejan barata (a lo sumo una fila por gestion); el util `esRechazoSla` es el predicado.
export const GESTION_ADMIN_SELECT = {
  id: true,
  ordenId: true,
  resultado: true,
  montoRecibido: true,
  metodoPago: true,
  motivo: true,
  fechaReprogramacion: true,
  evidenciaStoragePath: true,
  pagoMensajero: true, // feature 39: snapshot del pago al mensajero
  ingresoBodegaRechazo: true, // feature 56: snapshot del ingreso de bodega por rechazo
  historialEstados: {
    where: { origenTipo: ORIGEN_TIPO_RECHAZO_SLA }, // feature 102/R1: solo la fila del cron SLA
    take: 1,
    select: { origenTipo: true },
  },
} as const;

type DetalleAdminRow = Prisma.CierreDetailGetPayload<{ select: typeof DETALLE_ADMIN_SELECT }>;
type GestionAdminRow = Prisma.GestionOrdenGetPayload<{ select: typeof GESTION_ADMIN_SELECT }>;

// Money-safe: Decimal -> string escala 2 fija (nunca number/parseFloat).
function decimalToString(d: Prisma.Decimal | null): string | null {
  return d === null ? null : d.toFixed(2);
}

/**
 * Proyecta la tarifa congelada de la fila al DTO, o `null` si la tienda no tenia tarifa
 * vigente al solicitar (`tarifa_id IS NULL`, gap conocido de la feature 69/R9). Con
 * `tarifa_id` presente el resto no puede ser null (R8: se congelan todas o ninguna), y
 * `tarifaVigente` ya normalizo esos campos a STRING escala 2.
 */
function toTarifaSnapshot(d: DetalleAdminRow): TarifaSnapshotDTO | null {
  const t = tarifaDe(d);
  if (d.tarifaId === null || t === null) return null;
  return {
    tarifaId: d.tarifaId,
    valorFlete: t.valorFlete,
    valorFleteGam: t.valorFleteGam,
    valorFleteDevuelto: t.valorFleteDevuelto,
    valorFleteDevueltoGam: t.valorFleteDevueltoGam,
    comisionCod: t.comisionCod,
    ivaFlete: t.ivaFlete,
    ivaComisionCod: t.ivaComisionCod,
  };
}

/**
 * Deriva el desglose del ingreso de Ordenex de UNA gestion desde el snapshot, con la MISMA
 * `derivarIngresoOrden` que alimenta las wallets al aprobar: si el admin viera una formula
 * y la liquidacion usara otra, el descuadre seria invisible. Por eso aca no se re-implementa
 * nada, solo se serializa lo que la funcion devuelve.
 *
 * Un concepto AUSENTE en el derivado (`undefined`) se emite como `null`: no aplica a este
 * resultado (una entrega no tiene flete de devolucion). Eso es distinto de "0.00", que es un
 * monto real. El `total` suma solo los presentes.
 */
function toIngresoOrdenex(g: GestionAdminRow, d: DetalleAdminRow): IngresoOrdenexDTO {
  const tarifa = tarifaDe(d);
  const montoCobrar = decimalToString(d.montoCobrar);
  const derivado = derivarIngresoOrden(
    {
      resultado: g.resultado,
      esCentral: d.esCentral,
      montoCobrar,
      cobraComision: d.cobraComision,
    },
    tarifa,
  );
  let total = new Prisma.Decimal(0);
  for (const monto of Object.values(derivado)) {
    if (monto !== undefined) total = total.plus(monto);
  }
  const opt = (v: Prisma.Decimal | undefined): string | null =>
    v === undefined ? null : v.toFixed(2);
  // Agrupa un concepto con su IVA. Si NINGUNO de los dos aplica -> `null` (el concepto no
  // existe para este resultado), no "0.00": eso es lo que distingue "no aplica" de un cero.
  const conIva = (
    base: Prisma.Decimal | undefined,
    iva: Prisma.Decimal | undefined,
  ): string | null => {
    if (base === undefined && iva === undefined) return null;
    return (base ?? new Prisma.Decimal(0)).plus(iva ?? 0).toFixed(2);
  };
  return {
    montoCobrar,
    cobraComision: d.cobraComision,
    esCentral: d.esCentral,
    flete: opt(derivado.ingreso_flete),
    ivaFlete: opt(derivado.ingreso_iva_flete),
    fleteDevolucion: opt(derivado.ingreso_flete_devolucion),
    ivaFleteDevolucion: opt(derivado.ingreso_iva_flete_devolucion),
    comisionCod: opt(derivado.ingreso_comision_cod),
    ivaComisionCod: opt(derivado.ingreso_iva_comision_cod),
    fleteConIva: conIva(derivado.ingreso_flete, derivado.ingreso_iva_flete),
    fleteDevolucionConIva: conIva(
      derivado.ingreso_flete_devolucion,
      derivado.ingreso_iva_flete_devolucion,
    ),
    comisionConIva: conIva(derivado.ingreso_comision_cod, derivado.ingreso_iva_comision_cod),
    total: total.toFixed(2),
    tarifa: toTarifaSnapshot(d),
  };
}

/**
 * Feature 69/T18 (R15) — compone gestion + snapshot en el MISMO DTO que devolvia
 * `toPendienteRow` (la UI no cambia). La gestion aporta lo suyo (`resultado`, `montoRecibido`,
 * evidencia, snapshots 39/56); `cierre_detail` aporta lo de la ORDEN, CONGELADO.
 */
export function toPendienteRowDesdeSnapshot(
  g: GestionAdminRow,
  d: DetalleAdminRow,
): CierreGestionPendienteRow {
  return {
    gestionId: g.id,
    ordenId: g.ordenId,
    numGuia: d.numGuia,
    numRemision: d.numRemision,
    destinatario: d.destinatario,
    direccion: d.direccion,
    zonaNombre: d.zonaNombre,
    provinciaNombre: d.provinciaNombre,
    cantonNombre: d.cantonNombre,
    distritoNombre: d.distritoNombre,
    producto: d.producto,
    tiendaNombre: d.tiendaNombre,
    resultado: g.resultado,
    montoRecibido: decimalToString(g.montoRecibido),
    metodoPago: g.metodoPago,
    motivo: g.motivo,
    fechaReprogramacion: g.fechaReprogramacion
      ? g.fechaReprogramacion.toISOString().slice(0, 10)
      : null,
    evidenciaStoragePath: g.evidenciaStoragePath,
    pagoMensajero: decimalToString(g.pagoMensajero),
    ingresoBodegaRechazo: decimalToString(g.ingresoBodegaRechazo),
    // Feature 102/R1/R9: `true` si la gestion tiene una transicion del cron SLA enlazada
    // (`historialEstados` ya viene acotado a ese origen por `GESTION_ADMIN_SELECT`).
    esRechazoSla: esRechazoSla(g.historialEstados),
    ingresoOrdenex: toIngresoOrdenex(g, d),
  };
}

// Proyeccion de la cabecera de un cierre (join a mensajero/zona para nombres).
const CIERRE_RESUMEN_SELECT = {
  id: true,
  mensajeroId: true,
  estado: true,
  destinoTipo: true,
  destinoZonaId: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  totalPagoMensajero: true, // feature 39/R17: snapshot total del pago al mensajero
  totalIngresoBodegaRechazos: true, // feature 56/R16: snapshot total del ingreso de bodega por rechazos
  solicitadoAt: true,
  resueltoAt: true,
  motivoRechazo: true,
  mensajero: { select: { nombre: true } },
  destinoZona: { select: { nombre: true } },
} as const;

type CierreResumenRow = Prisma.CierreDiaGetPayload<{ select: typeof CIERRE_RESUMEN_SELECT }>;

function toResumenRow(r: CierreResumenRow): CierreAdminResumenRow {
  return {
    cierreId: r.id,
    mensajeroId: r.mensajeroId,
    mensajeroNombre: r.mensajero.nombre,
    estado: r.estado,
    destinoTipo: r.destinoTipo,
    destinoZonaId: r.destinoZonaId,
    destinoZonaNombre: r.destinoZona.nombre,
    totales: {
      efectivo: r.totalEfectivo.toFixed(2),
      simpe: r.totalSimpe.toFixed(2),
      transferencia: r.totalTransferencia.toFixed(2),
      general: r.totalGeneral.toFixed(2),
    },
    totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R17: snapshot money-safe STRING
    totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R16: snapshot money-safe STRING
    solicitadoAt: r.solicitadoAt.toISOString(),
    resueltoAt: r.resueltoAt ? r.resueltoAt.toISOString() : null,
    motivoRechazo: r.motivoRechazo,
  };
}

// WHERE del alcance: siempre por destino_tipo; por destino_zona_id SOLO si el alcance
// lo acota (adminSatelite). El maestro (destinoZonaId null) ve todos los central.
function alcanceWhere(alcance: Alcance): { destinoTipo: Alcance["destinoTipo"]; destinoZonaId?: string } {
  return {
    destinoTipo: alcance.destinoTipo,
    ...(alcance.destinoZonaId !== null ? { destinoZonaId: alcance.destinoZonaId } : {}),
  };
}

/**
 * Feature 38 — repositorio de "Cierres del dia" del admin. SOLO queries Prisma. El
 * ALCANCE (rol+zona destino) va SIEMPRE en el WHERE (R2/R13), nunca en memoria.
 *
 * Feature 69/T18 (R15): el detalle de un cierre YA CREADO se compone del SNAPSHOT
 * (`cierre_detail`) + la gestion, y devuelve el MISMO DTO (`CierreGestionPendienteRow`): la UI
 * no cambia. Ya NO reusa `WITH_DETALLE`/`toPendienteRow` de la 37 — esos siguen existiendo
 * para la vista EN VIVO (`findGestionesPendientes`: gestiones con `cierre_id IS NULL`, que por
 * definicion no tienen snapshot). R16 = no romper eso.
 */
export class CierresAdminRepository implements ICierresAdminRepository {
  constructor(
    private readonly prisma: CierresAdminPrismaClient,
    // Feature 42/T8: dependencias del enganche a la wallet (por inyeccion, no logica en el
    // repo: el repo orquesta la tx, el feed construye los movimientos, el repo de wallet
    // los inserta idempotentemente).
    private readonly walletMovimientoRepo: IWalletMovimientoRepository,
    private readonly walletFeedService: IWalletFeedService,
    // Feature 43/T10: enganche al LEDGER por tienda (por inyeccion, misma tx). El feed
    // construye los movimientos por tienda (credito COD + debitos por concepto) y el repo de
    // tienda los inserta idempotentemente EN LA MISMA tx que la 42 (atomico, R5/R7/R12/R13).
    private readonly walletTiendaMovimientoRepo: IWalletTiendaMovimientoRepository,
    private readonly walletTiendaFeedService: IWalletTiendaFeedService,
    // Feature 44/T10: enganche al LIBRO del pago por mensajero (por inyeccion, misma tx). El
    // feed construye los movimientos (devengo + pago) Y el egreso egreso_pago_mensajero de la
    // caja 42 (F1.4-Qa=SI, R17); el repo del libro los inserta idempotentemente y el egreso se
    // inserta con el repo de la 42, TODO en la MISMA tx que 42/43 (atomico, R5/R7/R11/R12).
    private readonly pagoMensajeroMovimientoRepo: IPagoMensajeroMovimientoRepository,
    private readonly walletMensajeroFeedService: IWalletMensajeroFeedService,
  ) {}

  /** R2/R4/R5/R8/R9: cierres del alcance, mas reciente primero, totales -> string. */
  async findCierresByAlcance(alcance: Alcance): Promise<CierreAdminResumenRow[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: alcanceWhere(alcance), // R2/R13: filtro por alcance en el WHERE, usa el indice [destinoTipo, destinoZonaId]
      orderBy: { solicitadoAt: "desc" },
      select: CIERRE_RESUMEN_SELECT,
    });
    return rows.map(toResumenRow);
  }

  /**
   * R6/R7/R9/R13: cierre (solo si casa el alcance) + sus gestiones. Feature 69/T18 (R15/R19):
   * el detalle se compone del SNAPSHOT + la gestion, en el MISMO DTO.
   */
  async findCierreByIdEnAlcance(
    cierreId: string,
    alcance: Alcance,
  ): Promise<{ cierre: CierreAdminResumenRow; gestiones: CierreGestionPendienteRow[] } | null> {
    const cierre = await this.prisma.cierreDia.findFirst({
      where: { id: cierreId, ...alcanceWhere(alcance) }, // R13: guardia de alcance en el WHERE
      select: CIERRE_RESUMEN_SELECT,
    });
    if (cierre === null) return null; // R13: no existe o de otra bodega/zona (no se distingue)

    // Feature 69/T18 (R15): el detalle de un cierre YA CREADO sale del SNAPSHOT, no de la
    // orden VIVA. Antes esto reusaba `WITH_DETALLE`, que navegaba `gestion_orden.orden.*`: el
    // admin veia los valores de HOY, no los del cierre que esta revisando.
    // R19 sale de aqui gratis: una orden con `deleted_at` sigue mostrandose, y ahora por
    // diseño y no por el accidente de que `WITH_DETALLE` no filtraba `deletedAt`.
    const [gestiones, detalle] = await Promise.all([
      this.prisma.gestionOrden.findMany({
        where: { cierreId }, // R6: gestiones vinculadas a ESTE cierre
        orderBy: { createdAt: "desc" },
        select: GESTION_ADMIN_SELECT,
      }),
      this.prisma.cierreDetail.findMany({
        where: { cierreId },
        select: DETALLE_ADMIN_SELECT,
      }),
    ]);
    const byOrden = new Map(detalle.map((d) => [d.ordenId, d]));
    return {
      cierre: toResumenRow(cierre),
      // Grano: N gestiones de una orden comparten su UNICA fila congelada.
      // Sin fallback (R14/decision (a)): si falta la fila, es un error DURO, no un silencio
      // que muestre datos vivos disfrazados de congelados.
      gestiones: gestiones.map((g) => {
        const d = byOrden.get(g.ordenId);
        if (d === undefined) throw new CierreDetalleFaltanteError(cierreId, g.ordenId);
        return toPendienteRowDesdeSnapshot(g, d);
      }),
    };
  }

  /**
   * R10-R15 + feature 42/T8 (R5/R7): transicion atomica guardada. Envuelta en
   * `$transaction`: mantiene el `updateMany` guardado (estado resoluble + alcance) y, SOLO
   * si la aprobacion se aplico (count===1 Y nuevoEstado==='aprobado'), alimenta la wallet
   * con los movimientos de ingreso del cierre en la MISMA tx (atomico: si el insert falla,
   * la aprobacion hace rollback). La alimentacion es IDEMPOTENTE (skipDuplicates -> ON
   * CONFLICT DO NOTHING, R6/R13): re-aprobar o un vencido->aprobado no duplica (R12). Un
   * `rechazado` NO alimenta. La distincion count===0 (conflict vs fuera_de_alcance) queda
   * igual.
   */
  async resolverCierre(input: ResolverCierreInput): Promise<ResolverCierreResult> {
    const { cierreId, alcance, nuevoEstado, resueltoPor, motivoRechazo } = input;
    const alcanceGuard = alcanceWhere(alcance);

    const count = await this.prisma.$transaction(async (tx) => {
      // R12/R13 + feature 41/E1 (R19): aplica SOLO si sigue en un estado resoluble
      // (`solicitado` o `vencido`) Y casa el alcance (guardia en WHERE).
      const res = await tx.cierreDia.updateMany({
        where: { id: cierreId, estado: { in: ESTADOS_RESOLUBLES }, ...alcanceGuard },
        data: {
          estado: nuevoEstado,
          resueltoPor,
          resueltoAt: new Date(),
          motivoRechazo,
        },
      });

      // R5/R7: solo al APROBAR y si se aplico, construir e insertar los movimientos de
      // ingreso EN LA MISMA TX (todo-o-nada). `rechazado` no toca la wallet.
      if (res.count === 1 && nuevoEstado === "aprobado") {
        const movs = await this.walletFeedService.construirMovimientosDeIngreso(cierreId, tx);
        await this.walletMovimientoRepo.crearMovimientos(tx, movs); // R6/R13: idempotente
        // Feature 43/T10 (R5/R7/R12/R13): TRAS alimentar la 42, alimenta el LEDGER por tienda
        // en la MISMA tx (todo-o-nada: si falla, rollback de la aprobacion Y de la 42).
        const movsTienda = await this.walletTiendaFeedService.construirMovimientosPorTienda(
          cierreId,
          tx,
        );
        await this.walletTiendaMovimientoRepo.crearMovimientos(tx, movsTienda); // R6/R13: idempotente
        // Feature 44/T10 (R5/R7/R11/R12/R17): TRAS 42 y 43, alimenta el LIBRO del pago por
        // mensajero EN LA MISMA tx (todo-o-nada). El feed lee el cierre una vez y devuelve el
        // libro (devengo + pago) Y el egreso egreso_pago_mensajero=P para la caja 42 (Qa=SI).
        const movsMensajero = await this.walletMensajeroFeedService.construirMovimientosDePago(
          cierreId,
          tx,
        );
        await this.pagoMensajeroMovimientoRepo.crearMovimientos(tx, movsMensajero.libro); // R6/R12: idempotente
        // Qa (R17): el egreso del costo total P se inserta con el repo de la 42, idempotente por
        // el constraint existente (origen_tipo, origen_id, categoria) -> un egreso por cierre. Se
        // toca la caja 42 SOLO si hay egreso (P>0); si P=0 el feed no lo emite y no se re-inserta.
        if (movsMensajero.egresoCaja.length > 0) {
          await this.walletMovimientoRepo.crearMovimientos(tx, movsMensajero.egresoCaja);
        }
      }
      return res.count;
    });

    if (count === 1) return "updated";

    // count 0: distinguir "ya resuelto" (existe en alcance) de "fuera de alcance".
    const enAlcance = await this.prisma.cierreDia.count({
      where: { id: cierreId, ...alcanceGuard },
    });
    return enAlcance > 0 ? "conflict" : "fuera_de_alcance"; // R12 vs R13
  }

  /**
   * Feature 111/R16 — VALVULA DE ESCAPE. `updateMany` guardado por estado (`vencido`) + alcance;
   * SOLO cambia `estado` (money-safe, R16/R21: no toca snapshot ni `resuelto_por`/`resuelto_at`).
   * `count === 0` -> `conflict` (existe en alcance pero ya no es `vencido`) o `fuera_de_alcance`.
   * NO alimenta wallets ni corre en $transaction: no es una resolucion (no mueve dinero), solo
   * reencamina el `vencido` al flujo normal de aprobacion. El desbloqueo ocurre al APROBAR (R18).
   */
  async forzarSolicitudVencido(cierreId: string, alcance: Alcance): Promise<ResolverCierreResult> {
    const alcanceGuard = alcanceWhere(alcance);

    // R16: guardia por estado ('vencido') + alcance en el WHERE (anti-TOCTOU). SOLO `estado`.
    const res = await this.prisma.cierreDia.updateMany({
      where: { id: cierreId, estado: ESTADO_VENCIDO, ...alcanceGuard },
      data: { estado: ESTADO_SOLICITADO },
    });
    if (res.count === 1) return "updated";

    // count 0: distinguir "existe en alcance pero ya no es vencido" (conflict) de "fuera de
    // alcance / inexistente" (fuera_de_alcance) — mismo patron que `resolverCierre`.
    const enAlcance = await this.prisma.cierreDia.count({
      where: { id: cierreId, ...alcanceGuard },
    });
    return enAlcance > 0 ? "conflict" : "fuera_de_alcance";
  }
}
