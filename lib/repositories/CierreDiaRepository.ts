import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AnularGestionInput,
  CierreGestionPendienteRow,
  CierreSolicitadoInfo,
  CrearCierreInput,
  GestionDeshacerRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type {
  ITarifaVigentePorTiendaRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { CierrePasadoDTO } from "@/lib/interfaces/services/ICierreDiaService";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";

// El estado que representa una solicitud viva de cierre (R12) y el que crea la 37 por
// defecto (R13). Feature 41/C1: `crearCierre` acepta ademas `vencido` (corte diario).
const ESTADO_SOLICITADO = "solicitado";

// Feature 111/R6/R7: estado del cierre que el corte diario deja "vencido" (mensajero que
// debia cerrar y no solicito). `solicitarCierre` lo transiciona a `solicitado`.
const ESTADO_VENCIDO = "vencido";

// Feature 109/R28 (modelo GLOBAL): estado del cierre RECHAZADO por el admin. Ya NO es terminal:
// BLOQUEA (R29) y es RE-SOLICITABLE (`rechazado -> solicitado`), espejo EXACTO del `vencido`.
const ESTADO_RECHAZADO = "rechazado";

// Feature 41/C1: sentinela interno para forzar el rollback de la tx cuando el UPDATE
// guardado vincula 0 gestiones (carrera). Se captura fuera de la tx -> `crearCierre`
// devuelve null (sin efectos), NO se propaga como error real.
class SinGestionesVinculadas extends Error {}

// Feature 67: sentinela interno del deshacer (mismo patron que SinGestionesVinculadas). Una
// guardia que afecta 0 filas DENTRO de la tx (carrera con `solicitarCierre` / doble submit /
// la orden se movio) fuerza el rollback -> `anularGestionYDevolverAGestion` devuelve `false`
// SIN efectos parciales (R22). NO es un error real: no se propaga.
class NoAnulable extends Error {}

// Feature 69/T10: `cierreDetail` (el snapshot que se puebla en la tx de `crearCierre`) y
// `tarifa` (el resolver batch corre DENTRO de esa misma tx, design §3.1).
type CierrePrismaClient = Pick<
  PrismaClient,
  "gestionOrden" | "orden" | "cierreDia" | "cierreDetail" | "tarifa" | "$transaction"
>;

// Feature 69 (design §3, paso 5) — proyeccion del snapshot: TODO lo que `cierre_detail`
// congela de la orden. Se lee DENTRO de la tx, de las gestiones que el `updateMany`
// REALMENTE vinculo (no de la lista que el service leyo antes).
const SNAPSHOT_SELECT = {
  ordenId: true,
  orden: {
    select: {
      // money-critical (R6): las entradas de la formula.
      montoCobrar: true,
      cobraComision: true,
      zonaId: true,
      tiendaId: true,
      // descriptivos (R7).
      numGuia: true,
      numRemision: true,
      destinatario: true,
      direccion: true,
      producto: true,
      // `esCentral` (R6) + los 5 nombres (R7): se congelan como VALOR, no como FK, porque
      // son mutables (design §2.1).
      zona: { select: { nombre: true, esCentral: true } },
      tienda: { select: { nombre: true } },
      provincia: { select: { nombre: true } },
      canton: { select: { nombre: true } },
      distrito: { select: { nombre: true } },
    },
  },
} as const;

type SnapshotRow = Prisma.GestionOrdenGetPayload<{ select: typeof SNAPSHOT_SELECT }>;

// Money-safe: STRING escala 2 -> Decimal (nunca number/parseFloat), R11. `null` = la tienda
// no tenia tarifa vigente al solicitar (gap R9): las 8 columnas quedan NULL, todas o ninguna.
function tarifaColumnas(t: TarifaVigenteResuelta | null) {
  if (t === null) {
    return {
      tarifaId: null,
      tarifaValorFlete: null,
      tarifaValorFleteGam: null,
      tarifaValorFleteDevuelto: null,
      tarifaValorFleteDevueltoGam: null,
      tarifaComisionCod: null,
      tarifaIvaFlete: null,
      tarifaIvaComisionCod: null,
    };
  }
  return {
    tarifaId: t.tarifaId,
    tarifaValorFlete: new Prisma.Decimal(t.valorFlete),
    tarifaValorFleteGam: new Prisma.Decimal(t.valorFleteGam),
    tarifaValorFleteDevuelto: new Prisma.Decimal(t.valorFleteDevuelto),
    tarifaValorFleteDevueltoGam: new Prisma.Decimal(t.valorFleteDevueltoGam),
    tarifaComisionCod: new Prisma.Decimal(t.comisionCod),
    tarifaIvaFlete: new Prisma.Decimal(t.ivaFlete),
    tarifaIvaComisionCod: new Prisma.Decimal(t.ivaComisionCod),
  };
}

// Proyeccion de una gestion pendiente de cierre con el detalle de la orden via las
// relaciones existentes (patron GestionOrdenRepository.WITH_ASIGNACION). Exportada
// para reuso por CierresAdminRepository (feature 38): mismo detalle de gestion,
// distinto WHERE (cierre_id = X en vez de cierre_id IS NULL).
export const WITH_DETALLE = {
  select: {
    id: true,
    ordenId: true,
    resultado: true,
    montoRecibido: true,
    metodoPago: true,
    motivo: true,
    fechaReprogramacion: true,
    evidenciaStoragePath: true,
    pagoMensajero: true, // feature 39: snapshot del pago al mensajero (reuso 38/40)
    ingresoBodegaRechazo: true, // feature 56: snapshot del ingreso de bodega por rechazo (reuso 38/40)
    orden: {
      select: {
        numGuia: true,
        numRemision: true,
        destinatario: true,
        direccion: true,
        producto: true,
        tienda: { select: { nombre: true } },
        zona: { select: { nombre: true } },
        provincia: { select: { nombre: true } },
        canton: { select: { nombre: true } },
        distrito: { select: { nombre: true } },
      },
    },
  },
} as const;

export type DetalleRow = Prisma.GestionOrdenGetPayload<typeof WITH_DETALLE>;

// Money-safe: Decimal -> string con escala 2 fija (nunca number/parseFloat).
function decimalToString(d: Prisma.Decimal | null): string | null {
  return d === null ? null : d.toFixed(2);
}

// Mapper de la proyeccion WITH_DETALLE a la fila de dominio. Exportado para reuso
// por CierresAdminRepository (feature 38).
export function toPendienteRow(row: DetalleRow): CierreGestionPendienteRow {
  return {
    gestionId: row.id,
    ordenId: row.ordenId,
    numGuia: row.orden.numGuia,
    numRemision: row.orden.numRemision,
    destinatario: row.orden.destinatario,
    direccion: row.orden.direccion,
    zonaNombre: row.orden.zona.nombre,
    provinciaNombre: row.orden.provincia.nombre,
    cantonNombre: row.orden.canton.nombre,
    distritoNombre: row.orden.distrito?.nombre ?? null,
    producto: row.orden.producto,
    tiendaNombre: row.orden.tienda.nombre,
    resultado: row.resultado,
    montoRecibido: decimalToString(row.montoRecibido),
    metodoPago: row.metodoPago,
    motivo: row.motivo,
    fechaReprogramacion: row.fechaReprogramacion
      ? row.fechaReprogramacion.toISOString().slice(0, 10)
      : null,
    evidenciaStoragePath: row.evidenciaStoragePath,
    // Feature 39: snapshot del pago al mensajero (Decimal->string; null si aun sin cerrar
    // o cierre pre-migracion, R22). En la vista EN VIVO (37) el service lo DERIVA aparte.
    pagoMensajero: decimalToString(row.pagoMensajero),
    // Feature 56: snapshot del ingreso de bodega por rechazo (Decimal->string; null si aun
    // sin cerrar o cierre pre-migracion, R21/R22). En la vista EN VIVO (37) el service lo DERIVA.
    ingresoBodegaRechazo: decimalToString(row.ingresoBodegaRechazo),
    // Feature 102/R11: la vista EN VIVO del mensajero (37) NO expone el desglose SLA -> `false`.
    // La clasificacion SLA solo la deriva el detalle del admin (38/40) desde el historial.
    esRechazoSla: false,
  };
}

/**
 * Feature 37 — repositorio del cierre del dia. SOLO queries Prisma (sin logica de
 * negocio: los estados "pendientes" los decide el service y se pasan por parametro;
 * los totales snapshot llegan ya calculados como STRING). `crearCierre` es
 * transaccional y consume las gestiones pendientes con un WHERE guardado.
 */
export class CierreDiaRepository implements ICierreDiaRepository {
  constructor(
    private readonly prisma: CierrePrismaClient,
    // Feature 69 (design §3.1): el resolver de la tarifa vigente, por INTERFAZ (precedente:
    // `CierresAdminRepository` recibe repos y services). `crearCierre` lo invoca DENTRO de su
    // tx para congelar la tarifa (R8). Es el UNICO consumidor del resolver tras la 69: los
    // feeds de wallet dejan de depender de el (leen el snapshot), y ese es justo el cambio
    // que mata el vector "cambio la tarifa entre solicitar y aprobar" (R18).
    private readonly tarifaRepo: ITarifaVigentePorTiendaRepository,
  ) {}

  /** R2/R3: gestiones del mensajero sin cierre (cierre_id IS NULL) + detalle. */
  async findGestionesPendientes(mensajeroId: string): Promise<CierreGestionPendienteRow[]> {
    const rows = await this.prisma.gestionOrden.findMany({
      // R2: nunca gestiones de otro mensajero; R3: solo sin cierre.
      // Feature 67/R13/R14/R15: `anuladaAt: null` = solo gestiones VIGENTES. ESTA lista es la
      // que consumen los 4 grupos (R13), `computeTotales` (R14), `derivarPagos` (39) y
      // `derivarIngresoBodega` (56) (R15), tanto en la vista EN VIVO (`listarCierreDia`) como
      // en el SNAPSHOT (`solicitarCierre` y el corte diario de la 41): un solo filtro cubre
      // los tres requisitos. Usa el indice parcial `gestion_orden_mensajero_pendiente_idx`.
      where: { mensajeroId, cierreId: null, anuladaAt: null },
      orderBy: { createdAt: "desc" },
      ...WITH_DETALLE,
    });
    return rows.map(toPendienteRow);
  }

  /** R10: ordenes asignadas al mensajero (no borradas) en los estados pendientes. */
  async contarOrdenesPendientesGestion(mensajeroId: string, estados: string[]): Promise<number> {
    if (estados.length === 0) return 0;
    return this.prisma.orden.count({
      where: {
        mensajeroAsignadoId: mensajeroId,
        deletedAt: null,
        estatus: { value: { in: estados } },
      },
    });
  }

  /** R12: existe un cierre `solicitado` del mensajero. */
  async existeCierreSolicitado(mensajeroId: string): Promise<boolean> {
    const count = await this.prisma.cierreDia.count({
      where: { mensajeroId, estado: ESTADO_SOLICITADO },
    });
    return count > 0;
  }

  /**
   * Feature 146/R24: proyeccion minima del cierre `solicitado` vigente (id + zona destino +
   * nombre del mensajero) para componer su aviso. Los dos caminos de transicion solo devuelven
   * un booleano, asi que el id del cierre se lee aqui, despues del exito.
   */
  async findCierreSolicitado(mensajeroId: string): Promise<CierreSolicitadoInfo | null> {
    const fila = await this.prisma.cierreDia.findFirst({
      where: { mensajeroId, estado: ESTADO_SOLICITADO },
      orderBy: { createdAt: "desc" },
      select: { id: true, destinoZonaId: true, mensajero: { select: { nombre: true } } },
    });
    if (fila === null) return null;
    return {
      id: fila.id,
      destinoZonaId: fila.destinoZonaId ?? null,
      mensajeroNombre: fila.mensajero?.nombre ?? null,
    };
  }

  /** Feature 111/R6: existe un cierre `vencido` del mensajero (gemelo del anterior). */
  async existeCierreVencido(mensajeroId: string): Promise<boolean> {
    const count = await this.prisma.cierreDia.count({
      where: { mensajeroId, estado: ESTADO_VENCIDO },
    });
    return count > 0;
  }

  /**
   * Feature 111/R6/R7/R8/R21 — transiciona `vencido -> solicitado` con escritura guardada por
   * estado. SOLO reescribe `estado`; NO recalcula ni re-snapshotea los totales money-critical
   * ni re-vincula gestiones (money-safe). 0 filas -> `false` (carrera: ya resuelto/transicionado).
   */
  async transicionarVencidoASolicitado(mensajeroId: string): Promise<boolean> {
    const { count } = await this.prisma.cierreDia.updateMany({
      // R7: anti-TOCTOU — solo transiciona si SIGUE en `vencido` (guardia por estado).
      where: { mensajeroId, estado: ESTADO_VENCIDO },
      // R8: money-safe — cambia UNICAMENTE `estado`. Los totales, pago, ingreso, cierre_id de
      // gestiones, resuelto_por/at y solicitado_at quedan INTACTOS (no es una resolución).
      data: { estado: ESTADO_SOLICITADO },
    });
    return count === 1; // 0 = raced/resuelto -> el service devuelve conflict (R7)
  }

  /** Feature 109/R28 — existe un cierre `rechazado` del mensajero (gemelo de `existeCierreVencido`). */
  async existeCierreRechazado(mensajeroId: string): Promise<boolean> {
    const count = await this.prisma.cierreDia.count({
      where: { mensajeroId, estado: ESTADO_RECHAZADO },
    });
    return count > 0;
  }

  /**
   * Feature 109/R28 — transiciona `rechazado -> solicitado` con escritura guardada por estado
   * (espejo EXACTO de `transicionarVencidoASolicitado`). SOLO reescribe `estado`; NO recalcula ni
   * re-snapshotea los totales money-critical ni re-vincula gestiones (money-safe). 0 filas ->
   * `false` (carrera: ya re-solicitado/resuelto).
   */
  async transicionarRechazadoASolicitado(mensajeroId: string): Promise<boolean> {
    const { count } = await this.prisma.cierreDia.updateMany({
      // Anti-TOCTOU: solo transiciona si SIGUE en `rechazado`.
      where: { mensajeroId, estado: ESTADO_RECHAZADO },
      // Money-safe: cambia UNICAMENTE `estado`. Totales, pago, ingreso, cierre_id de gestiones,
      // resuelto_por/at, motivo_rechazo y solicitado_at quedan INTACTOS (no es una resolucion).
      data: { estado: ESTADO_SOLICITADO },
    });
    return count === 1; // 0 = raced/resuelto -> el service devuelve conflict
  }

  /**
   * R13/R14 + feature 41/C1 (R8/R9/R23): INSERT cierre_dia (estado `solicitado` por
   * defecto o `vencido` para el corte) + vincular gestiones pendientes + snapshot pago,
   * atomico. Devuelve null (rollback) si el UPDATE guardado vincula 0 gestiones.
   */
  async crearCierre(input: CrearCierreInput): Promise<string | null> {
    const {
      mensajeroId,
      destinoTipo,
      destinoZonaId,
      estado = ESTADO_SOLICITADO,
      corteSinGestionar,
      totales,
      pagoByGestionId,
      totalPagoMensajero,
      ingresoByGestionId,
      totalIngresoBodegaRechazos,
    } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cierre = await tx.cierreDia.create({
          data: {
            mensajeroId,
            estado,
            destinoTipo,
            destinoZonaId,
            totalEfectivo: new Prisma.Decimal(totales.efectivo),
            totalSimpe: new Prisma.Decimal(totales.simpe),
            totalTransferencia: new Prisma.Decimal(totales.transferencia),
            totalGeneral: new Prisma.Decimal(totales.general),
            // Feature 39/R13/R14: total snapshot del pago al mensajero, en la misma tx.
            totalPagoMensajero: new Prisma.Decimal(totalPagoMensajero),
            // Feature 56/R12/R13: total snapshot del ingreso de bodega por rechazos, en la misma tx.
            totalIngresoBodegaRechazos: new Prisma.Decimal(totalIngresoBodegaRechazos),
          },
          select: { id: true },
        });

        // Feature 109 (T1.2, R4/R6/R22): CORTE DIARIO — transiciona en la MISMA tx las ordenes que
        // siguen en `en_ruta` del mensajero a `sin_gestionar`, CONSERVANDO
        // `mensajero_asignado_id` (asociacion orden<->cierre por mensajero, Q1: se limpia SOLO al
        // liberar al aprobar, R16) y registrando el cambio por el CHOKE POINT (49) con actor null y
        // `origen_tipo = corte_sin_gestionar`. Pre-SELECT de ids + updateMany GUARDADO por
        // `estatus_id = en_ruta` (money-safe: NO toca prioridad ni totales) -> el append es SOLO
        // de las que efectivamente transicionaron (R6/R8). Ausente el input = flujo 37 sin cambios.
        let sinGestionarTransicionadas = 0;
        if (corteSinGestionar) {
          const { enRepartoEstatusId, sinGestionarEstatusId } = corteSinGestionar;
          const enReparto = await tx.orden.findMany({
            where: {
              mensajeroAsignadoId: mensajeroId,
              estatusId: enRepartoEstatusId,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (enReparto.length > 0) {
            const ids = enReparto.map((o) => o.id);
            const movidas = await tx.orden.updateMany({
              where: { id: { in: ids }, estatusId: enRepartoEstatusId, deletedAt: null },
              data: { estatusId: sinGestionarEstatusId },
            });
            sinGestionarTransicionadas = movidas.count;
            if (movidas.count > 0) {
              await appendCambioEstado(
                tx,
                ids.map((ordenId) => ({
                  ordenId,
                  estatusOrigenId: enRepartoEstatusId, // la guarda garantiza este origen
                  estatusDestinoId: sinGestionarEstatusId,
                  actorUsuarioId: null, // R6: sistema/cron
                  origenTipo: "corte_sin_gestionar", // R6
                })),
              );
            }
          }
        }

        // R13: consume las gestiones pendientes con guardia de propiedad + no-cerradas
        // en el WHERE (concurrencia-segura: solo las cierre_id IS NULL del actor).
        // Feature 41/C1 (R8/R9/R23): si vincula 0 (otra solicitud/corte concurrente las
        // vinculo primero), fuerza el rollback -> crearCierre devuelve null (sin efectos).
        //
        // Feature 67/R16 — PUNTO MONEY-CRITICAL DE LA FEATURE. `anuladaAt: null` NO es una
        // optimizacion: este updateMany es el que VINCULA la gestion al cierre, y los feeds de
        // wallet (`WalletFeedService`/`WalletTiendaFeedService`/`WalletMensajeroFeedService`)
        // leen `gestionOrden.findMany({ where: { cierreId } })` dentro de la tx de aprobacion
        // (`CierresAdminRepository`). Sin este filtro, una gestion DESHECHA recibiria
        // `cierre_id` y la wallet la COBRARIA al aprobar el cierre: exactamente el bug que la
        // feature 67 viene a evitar. No basta con filtrar la lista de la vista (design §3-#2).
        const vinculadas = await tx.gestionOrden.updateMany({
          where: { mensajeroId, cierreId: null, anuladaAt: null },
          data: { cierreId: cierre.id },
        });
        // Feature 41/C1 + feature 109 (R8/R9/R23): guarda "algo paso". El cierre se conserva si
        // vinculo >=1 gestion O (corte diario) transiciono >=1 orden a `sin_gestionar`. Si AMBOS
        // son 0 -> rollback -> null (carrera / no-op real). La 37 (solicitar, sin corteSinGestionar)
        // exige >=1 gestion como antes (sinGestionarTransicionadas queda 0). El `vencido`
        // money-neutral (0 gestiones + >=1 sin_gestionar) YA NO se descarta (R8).
        if (vinculadas.count === 0 && sinGestionarTransicionadas === 0) {
          throw new SinGestionesVinculadas();
        }
        // Feature 39/R12/R14: puebla pago_mensajero por gestion AGRUPADO por valor de pago
        // (F1.4: a lo sumo 2 valores distintos — cobroEntregado para `entregada`, "0.00" para
        // el resto). Guardia por cierreId=nuevo (las que acabamos de vincular). Todo en la tx.
        const idsByPago = new Map<string, string[]>();
        for (const [gestionId, pago] of Object.entries(pagoByGestionId)) {
          const arr = idsByPago.get(pago);
          if (arr) arr.push(gestionId);
          else idsByPago.set(pago, [gestionId]);
        }
        for (const [pago, ids] of idsByPago) {
          await tx.gestionOrden.updateMany({
            where: { id: { in: ids }, cierreId: cierre.id },
            data: { pagoMensajero: new Prisma.Decimal(pago) },
          });
        }
        // Feature 56/R11/R13: puebla ingreso_bodega_rechazo por gestion AGRUPADO por valor
        // (a lo sumo 2 valores distintos — cobroRechazado para `rechazada` que aplica, "0.00"
        // para el resto). Guardia por cierreId=nuevo (las que acabamos de vincular). Todo en
        // la MISMA tx que el INSERT y el pago al mensajero (atomico, R13).
        const idsByIngreso = new Map<string, string[]>();
        for (const [gestionId, ingreso] of Object.entries(ingresoByGestionId)) {
          const arr = idsByIngreso.get(ingreso);
          if (arr) arr.push(gestionId);
          else idsByIngreso.set(ingreso, [gestionId]);
        }
        for (const [ingreso, ids] of idsByIngreso) {
          await tx.gestionOrden.updateMany({
            where: { id: { in: ids }, cierreId: cierre.id },
            data: { ingresoBodegaRechazo: new Prisma.Decimal(ingreso) },
          });
        }

        // Feature 69/R3-R9 — EL SNAPSHOT. Se construye en ESTA tx (R3/R4: todo-o-nada) y
        // DESPUES del updateMany que vincula, leyendo LO QUE LA TX REALMENTE VINCULO
        // (`where: { cierreId }`), NO la lista que el service leyo antes
        // (`findGestionesPendientes`, CierreDiaService:204). Porque: el updateMany no lleva
        // lista de ids, asi que una gestion creada entre la lectura del service y esta tx se
        // vincula IGUAL. Con el patron de la 39/56 eso solo dejaba un pago nulo (inofensivo);
        // aqui dejaria una orden SIN fila de detalle y, sin fallback (R14), la APROBACION
        // abortaria. Leer dentro de la tx elimina la carrera por construccion (design §3).
        //
        // R5: no hace falta filtrar `anuladaAt` — el updateMany de arriba ya solo vincula
        // gestiones vigentes (67/R16), asi que `where: { cierreId }` no puede traer anuladas.
        const gestiones = (await tx.gestionOrden.findMany({
          where: { cierreId: cierre.id },
          select: SNAPSHOT_SELECT,
        })) as SnapshotRow[];

        // R2 — EL GRANO: dedupe por ordenId. Una orden puede acumular varias gestiones
        // vigentes en el mismo cierre (reintentos 46/47); el detalle es de la ORDEN, y el
        // UNIQUE (cierre_id, orden_id) rechazaria la segunda fila.
        const porOrden = new Map<string, SnapshotRow>();
        for (const g of gestiones) if (!porOrden.has(g.ordenId)) porOrden.set(g.ordenId, g);
        const filas = [...porOrden.values()];

        if (filas.length > 0) {
          // R8: la tarifa vigente de cada tienda distinta, EN LA MISMA tx y en UNA query
          // (sin N+1). `null` para una tienda sin tarifa = gap R9: las 8 columnas quedan
          // NULL y el cierre se crea igual (decision (c): el gap NO bloquea).
          const tarifas = await this.tarifaRepo.resolveTarifasPorTiendas(
            tx,
            filas.map((f) => f.orden.tiendaId),
          );
          await tx.cierreDetail.createMany({
            data: filas.map((f) => ({
              cierreId: cierre.id,
              ordenId: f.ordenId,
              // money-critical (R6). `montoCobrar` ya es Decimal|null en origen: se copia
              // tal cual, sin pasar por number (R11).
              montoCobrar: f.orden.montoCobrar,
              cobraComision: f.orden.cobraComision,
              zonaId: f.orden.zonaId,
              tiendaId: f.orden.tiendaId,
              esCentral: f.orden.zona.esCentral,
              ...tarifaColumnas(tarifas.get(f.orden.tiendaId) ?? null),
              // descriptivos (R7).
              numGuia: f.orden.numGuia,
              numRemision: f.orden.numRemision,
              destinatario: f.orden.destinatario,
              direccion: f.orden.direccion,
              producto: f.orden.producto,
              tiendaNombre: f.orden.tienda.nombre,
              zonaNombre: f.orden.zona.nombre,
              provinciaNombre: f.orden.provincia.nombre,
              cantonNombre: f.orden.canton.nombre,
              distritoNombre: f.orden.distrito?.nombre ?? null,
            })),
          });
        }
        return cierre.id;
      });
    } catch (err) {
      // Feature 41/C1: 0 gestiones vinculadas -> null (sin efectos). Cualquier otro
      // error se propaga (no se traga; convenciones de manejo de errores).
      if (err instanceof SinGestionesVinculadas) return null;
      throw err;
    }
  }

  /** R18: cierres del mensajero (mas reciente primero) con totales snapshot. */
  async findCierresByMensajero(mensajeroId: string): Promise<CierrePasadoDTO[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: { mensajeroId },
      orderBy: { solicitadoAt: "desc" },
      select: {
        id: true,
        estado: true,
        destinoTipo: true,
        destinoZonaId: true,
        totalEfectivo: true,
        totalSimpe: true,
        totalTransferencia: true,
        totalGeneral: true,
        totalPagoMensajero: true, // feature 39/R13: total snapshot del pago al mensajero
        totalIngresoBodegaRechazos: true, // feature 56/R12: total snapshot del ingreso de bodega por rechazos
        solicitadoAt: true,
      },
    });
    return rows.map((r) => ({
      cierreId: r.id,
      estado: r.estado,
      destinoTipo: r.destinoTipo,
      destinoZonaId: r.destinoZonaId,
      totales: {
        efectivo: r.totalEfectivo.toFixed(2),
        simpe: r.totalSimpe.toFixed(2),
        transferencia: r.totalTransferencia.toFixed(2),
        general: r.totalGeneral.toFixed(2),
      },
      totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R13: snapshot money-safe STRING
      totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R12: snapshot money-safe STRING
      solicitadoAt: r.solicitadoAt.toISOString(),
    }));
  }

  /**
   * Feature 67 — gestion candidata a deshacerse + estado real de su orden. Devuelve la fila tal
   * cual (sin juzgarla: las guardias viven en el service, `docs/architecture.md`). `null` = no
   * existe -> el service lo trata como `forbidden` (R9: no distingue inexistente de ajena).
   */
  async findGestionParaDeshacer(gestionId: string): Promise<GestionDeshacerRow | null> {
    const row = await this.prisma.gestionOrden.findUnique({
      where: { id: gestionId },
      select: {
        id: true,
        ordenId: true,
        mensajeroId: true, // R9
        resultado: true, // R5
        cierreId: true, // R2
        anuladaAt: true, // R3
        orden: { select: { deletedAt: true, estatusId: true, estatus: { select: { value: true } } } },
      },
    });
    if (row === null) return null;
    return {
      gestionId: row.id,
      ordenId: row.ordenId,
      mensajeroId: row.mensajeroId,
      resultado: row.resultado,
      cierreId: row.cierreId,
      anuladaAt: row.anuladaAt,
      orden: {
        deletedAt: row.orden.deletedAt,
        estatusId: row.orden.estatusId, // R5: id REAL (guardia del UPDATE, sin re-resolver catalogo)
        estatusValue: row.orden.estatus.value,
      },
    };
  }

  /** Feature 67/R4: id de la gestion NO anulada mas reciente de la orden (o null). */
  async findUltimaGestionNoAnuladaId(ordenId: string): Promise<string | null> {
    const row = await this.prisma.gestionOrden.findFirst({
      where: { ordenId, anuladaAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Feature 67/R11/R18-R23 — UNICA escritura del deshacer, en UNA `$transaction` (R22). Las dos
   * escrituras van GUARDADAS en su WHERE (concurrencia-segura, patron `crearCierre`/`recogerLote`):
   * si alguna afecta 0 filas, el sentinela fuerza el rollback -> `false` sin efectos parciales.
   */
  async anularGestionYDevolverAGestion(input: AnularGestionInput): Promise<boolean> {
    const { gestionId, ordenId, mensajeroId, actorUsuarioId, estatusEsperadoId, estatusEnRepartoId } =
      input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1) R11: ANULA con rastro (quien la deshizo + cuando). Guardias: sigue siendo del
        // mensajero autor, sigue SIN cierre y sigue SIN anular (carrera con `solicitarCierre`
        // o doble submit). R12: `data` toca SOLO las dos columnas de anulacion — resultado,
        // monto, metodo, motivo, fecha, evidencia, mensajero autor y created_at quedan INTACTOS.
        const anulada = await tx.gestionOrden.updateMany({
          where: { id: gestionId, mensajeroId, cierreId: null, anuladaAt: null },
          data: { anuladaAt: new Date(), anuladaPor: actorUsuarioId },
        });
        if (anulada.count === 0) throw new NoAnulable();

        // 2) R18/R19: devuelve la orden a `en_ruta` (unico estado desde el que se puede
        // volver a gestionar) y REPONE la asignacion al mensajero autor. `mensajeroAsignadoId`
        // incondicional: es idempotente cuando la asignacion ya era ese mensajero
        // (entregada/reprogramada/rechazada) y repone la que el seguimiento de un reintento
        // limpio (47/R6, `limpiaMensajero: true`). No puede pisar a otro mensajero: una
        // reasignacion habria cambiado el estado y esta misma guardia fallaria.
        // Guardias: la orden sigue EXACTAMENTE en el estado leido (R5) y no esta borrada (R6).
        const movida = await tx.orden.updateMany({
          where: { id: ordenId, estatusId: estatusEsperadoId, deletedAt: null },
          // Feature 76/R23 (W4): al deshacer una gestion se REPONE la asignacion al mensajero
          // autor (reasignacion efectiva) -> estampa `asignado_at = now`.
          data: {
            estatusId: estatusEnRepartoId,
            mensajeroAsignadoId: mensajeroId,
            asignadoAt: new Date(),
          },
        });
        if (movida.count === 0) throw new NoAnulable();

        // 3) R20/R21/R23: CHOKE POINT del historial (49) en la MISMA tx que el cambio de estado.
        // Origen = estado real previo, destino = `en_ruta`, actor = quien deshizo,
        // `gestion_orden_id` = la gestion anulada, `origen_tipo` = `deshacer_gestion` (12.º
        // valor, F1.4-b) para que la linea de tiempo NO lo confunda con una gestion real.
        // Es un APPEND: ninguna fila previa del historial se modifica ni se borra (R23).
        await appendCambioEstado(tx, [
          {
            ordenId,
            estatusOrigenId: estatusEsperadoId,
            estatusDestinoId: estatusEnRepartoId,
            actorUsuarioId, // R20: el mensajero que deshizo
            origenTipo: "deshacer_gestion", // R20/R23
            gestionOrdenId: gestionId, // R20: enlace a la gestion anulada
          },
        ]);
        // R29 (F1.4-c): el puntero `usuario.orden_en_gestion_id` NO se toca. La orden se retoma
        // con `escogerParaGestion` (36), que ya tiene la guardia 1-a-1 idempotente.
        return true;
      });
    } catch (err) {
      // Guardia perdida (carrera) -> false (sin efectos). Cualquier otro error se propaga.
      if (err instanceof NoAnulable) return false;
      throw err;
    }
  }
}
