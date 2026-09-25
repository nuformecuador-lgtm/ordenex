import type { ILiberacionReprogramadaRepository } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type {
  CierreParaRetenidas,
  IReprogramadaRetenidaRepository,
} from "@/lib/interfaces/repositories/IReprogramadaRetenidaRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import {
  recortarPorAmbito,
  type AmbitoRetenidas,
  type CierreQueRetiene,
  type IReprogramadasRetenidasService,
  type MensajeroSinCierre,
  type ResumenRetenidas,
  type RetenidaRow,
} from "@/lib/interfaces/services/IReprogramadasRetenidasService";
// FEATURE 276 — LA REGLA, importada y no reescrita (R3): «sigue retenida» en la Forma A es
// exactamente `!puedeLiberarse`, la misma puerta que aplican el reloj, el timbre 315 y la 371.
import { puedeLiberarse } from "@/lib/services/LiberacionReprogramadaService";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";
// ⚠️ DOS conversiones distintas para DOS convenciones distintas, y confundirlas es el off-by-one de
// seis horas que este repo ya pago (166/413): `hoyCR` llega en convencion `@db.Date` (medianoche UTC
// de la fecha CR) y su texto sale con los getters UTC (`fechaRepartoComoTexto`); los `created_at` de
// cierres y gestiones son INSTANTES y su dia CR sale de `fechaCalendarioCR`. El test unitario del
// servicio afirma el primero con un `hoyCR` a las 00:00Z, que `fechaCalendarioCR` leeria como el dia
// ANTERIOR.
import { fechaRepartoComoTexto } from "@/lib/utils/dia-reparto";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
// FEATURE 271 — el derivador UNICO de la jornada de un cierre (R61): ninguna superficie la calcula
// por su cuenta.
import { derivarJornada } from "@/lib/utils/jornada-cierre";

/** El unico estado de cierre que suelta una reprogramada. Mismo literal que `CIERRE_APROBADO` (276). */
const CIERRE_APROBADO = "aprobado";

type LiberacionRepo = Pick<ILiberacionReprogramadaRepository, "findOrdenesLiberables">;
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;

/**
 * FICHA 462 (T1.4, design §2.3) — EL PUNTO UNICO DEL CONTEO de las reprogramadas retenidas. Las
 * cuatro superficies (campana, push, marca por cierre, franja de `/ordenes`) leen de aqui (R7).
 *
 * No conoce Prisma, HTTP ni el reloj: `hoyCR` entra como argumento (`startOfDayCR(now)` lo pone el
 * borde, igual que los tres disparadores de la liberacion), y los repositorios entran por
 * constructor. SOLO LECTURA (R8): este archivo no escribe nada, y una guardia lo afirma.
 *
 * COSTE por `resumen`: A = 1 `findMany` + la carga agrupada de Prisma; B = 1 `$queryRaw`; cierres =
 * 1 `findMany`; mensajeros sin cierre = 0 o 1; zona central = 0 o 1. Ninguna por fila (R51).
 * `contar` y `contarPorCierre` derivan de `resumen` en memoria: una llamada, las mismas consultas.
 */
export class ReprogramadasRetenidasService implements IReprogramadasRetenidasService {
  constructor(
    private readonly liberacionRepo: LiberacionRepo,
    private readonly retenidasRepo: IReprogramadaRetenidaRepository,
    private readonly zonaRepo: ZonaRepo,
  ) {}

  async resumen(hoyCR: Date): Promise<ResumenRetenidas> {
    const filas = await this.retenidas(hoyCR);

    // Los cierres, EN LOTE: una consulta para todos los ids distintos.
    const cierreIds = [...new Set(filas.map((f) => f.cierreId).filter((c): c is string => c !== null))];
    const cierres = new Map(
      (await this.retenidasRepo.findCierresQueRetienen(cierreIds)).map((c) => [c.cierreId, c]),
    );

    // Agrupar por cierre. Un cierre que se APROBO entre la lectura de las candidatas y esta (carrera
    // de segundos) deja de retener en el acto: sus filas se descartan, no se atribuyen (R28/R40).
    const porCierre = new Map<string, { cierre: CierreParaRetenidas; cuantas: number }>();
    const sinCierre: RetenidaRow[] = [];
    for (const fila of filas) {
      if (fila.cierreId === null) {
        sinCierre.push(fila);
        continue;
      }
      const cierre = cierres.get(fila.cierreId);
      if (cierre === undefined) {
        // Dato imposible (FK): la gestion apunta a un cierre que no existe. Se falla con causa y
        // sin identificadores (R52), nunca se cuenta «a ojo».
        throw new Error(
          "reprogramadas retenidas: una gestion apunta a un cierre que la base no devuelve",
        );
      }
      if (cierre.estado === CIERRE_APROBADO) continue;
      const grupo = porCierre.get(fila.cierreId) ?? { cierre, cuantas: 0 };
      grupo.cuantas += 1;
      porCierre.set(fila.cierreId, grupo);
    }

    // El grupo «sin cierre enviado», por mensajero asignado, con ambito por la zona de la ORDEN.
    // La zona central se resuelve UNA vez, y solo si hace falta.
    const gruposSinCierre = await this.agruparSinCierre(sinCierre);

    const listaCierres: CierreQueRetiene[] = [...porCierre.values()].map(({ cierre, cuantas }) => ({
      cierreId: cierre.cierreId,
      mensajeroId: cierre.mensajeroId,
      mensajeroNombre: cierre.mensajeroNombre,
      estado: cierre.estado,
      jornadaCR: jornadaDe(cierre),
      ambito: ambitoDelCierre(cierre),
      cuantas,
    }));
    listaCierres.sort(compararCierres);

    // `total` cuenta lo ATRIBUIDO (cierres no aprobados + sin cierre): si una fila se descarto por
    // la carrera de arriba, no entra ni aqui ni en `porForma`.
    const total =
      listaCierres.reduce((acc, c) => acc + c.cuantas, 0) +
      gruposSinCierre.reduce((acc, m) => acc + m.cuantas, 0);

    return {
      diaCR: fechaRepartoComoTexto(hoyCR),
      total,
      porForma: recontarPorForma(filas, porCierre, sinCierre),
      cierres: listaCierres,
      sinCierre: gruposSinCierre,
    };
  }

  async contar(hoyCR: Date, ambito: AmbitoRetenidas): Promise<number> {
    return recortarPorAmbito(await this.resumen(hoyCR), ambito).total;
  }

  async contarPorCierre(hoyCR: Date, cierreIds: readonly string[]): Promise<Map<string, number>> {
    const pedidos = new Set(cierreIds);
    const marca = new Map<string, number>();
    if (pedidos.size === 0) return marca;
    for (const c of (await this.resumen(hoyCR)).cierres) {
      if (pedidos.has(c.cierreId) && c.cuantas > 0) marca.set(c.cierreId, c.cuantas);
    }
    return marca;
  }

  /**
   * Las DOS formas, normalizadas a `RetenidaRow`. Disjuntas por construccion: A exige `reprogramado`
   * y B exige `en_reparto`; una orden no puede estar en las dos.
   */
  private async retenidas(hoyCR: Date): Promise<RetenidaRow[]> {
    // [A] Reuso literal de las candidatas del reloj (46/276) y de su puerta. NEGAR `puedeLiberarse`
    // ES R3 por construccion: para un mismo conjunto y un mismo hoy, esto es el `esperandoCierre`.
    const formaA: RetenidaRow[] = (await this.liberacionRepo.findOrdenesLiberables(hoyCR))
      .filter((o) => !puedeLiberarse(o))
      .map((o) => ({
        ordenId: o.id,
        zonaId: o.zonaId,
        mensajeroAsignadoId: o.mensajeroAsignadoId,
        gestionId: null,
        cierreId: o.gestionCierreId,
        forma: "reprogramado" as const,
      }));
    // [B] La gestion pendiente de la 454, por el predicado unico (R4), en una consulta.
    const formaB: RetenidaRow[] = (await this.retenidasRepo.findRetenidasEnReparto(hoyCR)).map(
      (r) => ({
        ordenId: r.ordenId,
        zonaId: r.zonaId,
        mensajeroAsignadoId: r.mensajeroAsignadoId,
        gestionId: r.gestionId,
        cierreId: r.cierreId,
        forma: "en_reparto" as const,
      }),
    );
    return [...formaA, ...formaB];
  }

  /** Grupo «sin cierre enviado» por mensajero; ambito por la zona de la orden (decision 8). */
  private async agruparSinCierre(filas: RetenidaRow[]): Promise<MensajeroSinCierre[]> {
    if (filas.length === 0) return [];
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    const mensajeroIds = [
      ...new Set(filas.map((f) => f.mensajeroAsignadoId).filter((m): m is string => m !== null)),
    ];
    const nombres = new Map(
      (await this.retenidasRepo.findMensajeros(mensajeroIds)).map((m) => [m.id, m.nombre]),
    );
    // Clave de grupo: mensajero + ambito (un mensajero con ordenes en dos zonas son dos grupos).
    const grupos = new Map<string, MensajeroSinCierre>();
    for (const f of filas) {
      const { destinoTipo, destinoZonaId } = resolverDestinoCierre(f.zonaId, centralZonaId);
      const ambito: AmbitoRetenidas =
        destinoTipo === "bodega_central" ? { tipo: "central" } : { tipo: "zona", zonaId: destinoZonaId };
      const clave = `${f.mensajeroAsignadoId ?? ""}|${claveAmbito(ambito)}`;
      const grupo = grupos.get(clave) ?? {
        mensajeroId: f.mensajeroAsignadoId,
        mensajeroNombre:
          f.mensajeroAsignadoId === null ? null : (nombres.get(f.mensajeroAsignadoId) ?? null),
        ambito,
        cuantas: 0,
      };
      grupo.cuantas += 1;
      grupos.set(clave, grupo);
    }
    return [...grupos.values()].sort(
      (a, b) => b.cuantas - a.cuantas || (a.mensajeroNombre ?? "").localeCompare(b.mensajeroNombre ?? ""),
    );
  }
}

/** Ambito por el destino PERSISTIDO del cierre: el mismo eje que `CierresAdminService.resolveAlcance`. */
function ambitoDelCierre(c: CierreParaRetenidas): AmbitoRetenidas {
  return c.destinoTipo === "bodega_central"
    ? { tipo: "central" }
    : { tipo: "zona", zonaId: c.destinoZonaId };
}

/** La jornada del cierre con el derivador unico de la 271, a partir de fechas ya cargadas. */
function jornadaDe(c: CierreParaRetenidas): string | null {
  return derivarJornada({
    diasCRDeGestiones: c.gestionesCreatedAt.map((d) => fechaCalendarioCR(d)),
    diaCRDeCreacion: fechaCalendarioCR(c.createdAt),
  });
}

function claveAmbito(a: AmbitoRetenidas): string {
  return a.tipo === "central" ? "central" : a.zonaId;
}

/** Mas retenidas primero; luego jornada ascendente (sin jornada al final); luego mensajero. */
function compararCierres(a: CierreQueRetiene, b: CierreQueRetiene): number {
  if (a.cuantas !== b.cuantas) return b.cuantas - a.cuantas;
  if (a.jornadaCR !== b.jornadaCR) {
    if (a.jornadaCR === null) return 1;
    if (b.jornadaCR === null) return -1;
    return a.jornadaCR < b.jornadaCR ? -1 : 1;
  }
  return a.mensajeroNombre.localeCompare(b.mensajeroNombre);
}

/**
 * `porForma` recontado sobre lo ATRIBUIDO: las filas cuyo cierre esta en `porCierre` (no aprobado)
 * mas las sin cierre. Asi `porForma.reprogramado + porForma.enReparto === total` siempre, tambien
 * cuando la carrera de la aprobacion descarto alguna fila.
 */
function recontarPorForma(
  filas: RetenidaRow[],
  porCierre: Map<string, unknown>,
  sinCierre: RetenidaRow[],
): { reprogramado: number; enReparto: number } {
  const sinCierreSet = new Set(sinCierre);
  const porForma = { reprogramado: 0, enReparto: 0 };
  for (const f of filas) {
    const atribuida = f.cierreId === null ? sinCierreSet.has(f) : porCierre.has(f.cierreId);
    if (!atribuida) continue;
    if (f.forma === "reprogramado") porForma.reprogramado += 1;
    else porForma.enReparto += 1;
  }
  return porForma;
}
