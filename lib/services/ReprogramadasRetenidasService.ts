import type { ILiberacionReprogramadaRepository } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type {
  CierreParaRetenidas,
  DestinoDeCierre,
  IReprogramadaRetenidaRepository,
} from "@/lib/interfaces/repositories/IReprogramadaRetenidaRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import {
  mismoAmbito,
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
 * COSTE, medido con `log: query` sobre la siembra de `review_462.md` §3 (2026-09-25):
 *   · `resumen` / `contarPorCierre`: A = `findMany` + 3 relaciones que Prisma carga aparte (4);
 *     B = 1 `$queryRaw`; cierres = 1 + 2 relaciones (3); zona central 0/1; mensajeros 0/1 -> 10.
 *   · `contar` (462/H2): las MISMAS A y B (5) + destinos de cierre SIN relaciones (1) + zona central
 *     0/1 -> 6 o 7. Es lo que la campana paga por sondeo y por admin; no carga nombres ni jornadas
 *     que no muestra. Ninguna consulta por fila (R51).
 * La REGLA (que retiene, a que cierre o mensajero se atribuye, en que ambito cae) es UNA funcion
 * (`ambitoDeRetenida`) para los dos caminos: `contar(a)` y `recortarPorAmbito(resumen(), a).total`
 * coinciden por construccion, y el test de R7 lo mide contra Postgres.
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
    const cierres = indexarPorCierre(await this.retenidasRepo.findCierresQueRetienen(cierreIdsDe(filas)));
    // La zona central se resuelve UNA vez, y solo si hay retenidas sin cierre.
    const centralZonaId = await this.zonaCentralSiHaceFalta(filas);

    // Agrupar por cierre. Un cierre que se APROBO entre la lectura de las candidatas y esta (carrera
    // de segundos) deja de retener en el acto: sus filas se descartan, no se atribuyen (R28/R40).
    const porCierre = new Map<string, { cierre: CierreParaRetenidas; cuantas: number }>();
    const sinCierre: Array<{ fila: RetenidaRow; ambito: AmbitoRetenidas }> = [];
    // `porForma` se cuenta sobre lo ATRIBUIDO, asi `reprogramado + enReparto === total` siempre,
    // tambien cuando la carrera de la aprobacion descarto alguna fila.
    const porForma = { reprogramado: 0, enReparto: 0 };
    for (const fila of filas) {
      const ambito = ambitoDeRetenida(fila, cierres, centralZonaId);
      if (ambito === null) continue;
      if (fila.forma === "reprogramado") porForma.reprogramado += 1;
      else porForma.enReparto += 1;
      if (fila.cierreId === null) {
        sinCierre.push({ fila, ambito });
        continue;
      }
      // `ambitoDeRetenida` ya lanzo si el cierre no existe y devolvio `null` si esta aprobado.
      const cierre = cierres.get(fila.cierreId) as CierreParaRetenidas;
      const grupo = porCierre.get(fila.cierreId) ?? { cierre, cuantas: 0 };
      grupo.cuantas += 1;
      porCierre.set(fila.cierreId, grupo);
    }

    // El grupo «sin cierre enviado», por mensajero asignado, con ambito por la zona de la ORDEN.
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
      porForma,
      cierres: listaCierres,
      sinCierre: gruposSinCierre,
    };
  }

  /**
   * 462/H2 — EL CAMINO LIGERO. Mismas candidatas (A y B), misma atribucion y mismo ambito que
   * `resumen` —la misma `ambitoDeRetenida`—, pero de cada cierre se pide SOLO estado y destino:
   * la cifra no muestra nombres ni jornadas, asi que no los carga (ahorra `usuario` x2 y
   * `gestion_orden` x1 por sondeo). Sin `resumen` en medio: no se construye una lista para tirarla.
   */
  async contar(hoyCR: Date, ambito: AmbitoRetenidas): Promise<number> {
    const filas = await this.retenidas(hoyCR);
    const destinos = indexarPorCierre(await this.retenidasRepo.findDestinoDeCierres(cierreIdsDe(filas)));
    const centralZonaId = await this.zonaCentralSiHaceFalta(filas);
    let total = 0;
    for (const fila of filas) {
      const ambitoFila = ambitoDeRetenida(fila, destinos, centralZonaId);
      if (ambitoFila !== null && mismoAmbito(ambitoFila, ambito)) total += 1;
    }
    return total;
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

  /** La zona central, UNA consulta y solo si hay retenidas sin cierre (su ambito sale de la orden). */
  private async zonaCentralSiHaceFalta(filas: readonly RetenidaRow[]): Promise<string | null> {
    if (!filas.some((f) => f.cierreId === null)) return null;
    return this.zonaRepo.findCentralZonaId();
  }

  /** Grupo «sin cierre enviado» por mensajero; el ambito ya viene resuelto por la zona de la orden (decision 8). */
  private async agruparSinCierre(
    filas: ReadonlyArray<{ fila: RetenidaRow; ambito: AmbitoRetenidas }>,
  ): Promise<MensajeroSinCierre[]> {
    if (filas.length === 0) return [];
    const mensajeroIds = [
      ...new Set(filas.map(({ fila }) => fila.mensajeroAsignadoId).filter((m): m is string => m !== null)),
    ];
    const nombres = new Map(
      (await this.retenidasRepo.findMensajeros(mensajeroIds)).map((m) => [m.id, m.nombre]),
    );
    // Clave de grupo: mensajero + ambito (un mensajero con ordenes en dos zonas son dos grupos).
    const grupos = new Map<string, MensajeroSinCierre>();
    for (const { fila, ambito } of filas) {
      const clave = `${fila.mensajeroAsignadoId ?? ""}|${claveAmbito(ambito)}`;
      const grupo = grupos.get(clave) ?? {
        mensajeroId: fila.mensajeroAsignadoId,
        mensajeroNombre:
          fila.mensajeroAsignadoId === null ? null : (nombres.get(fila.mensajeroAsignadoId) ?? null),
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

/**
 * LA REGLA DE ATRIBUCION Y AMBITO, una sola vez para `resumen` y `contar` (R5/R6/R7):
 *   · sin cierre -> la bodega a la que volvera la ORDEN (`resolverDestinoCierre`, decision 8);
 *   · con cierre `aprobado` -> `null`: dejo de retener (carrera de segundos entre lecturas, R28/R40);
 *   · con cierre en cualquier otro estado -> el destino PERSISTIDO del cierre;
 *   · con un cierre que la base no devuelve (dato imposible, FK) -> LANZA con causa y sin ids (R52).
 */
function ambitoDeRetenida(
  fila: RetenidaRow,
  destinos: ReadonlyMap<string, DestinoDeCierre>,
  centralZonaId: string | null,
): AmbitoRetenidas | null {
  if (fila.cierreId === null) {
    const { destinoTipo, destinoZonaId } = resolverDestinoCierre(fila.zonaId, centralZonaId);
    return destinoTipo === "bodega_central" ? { tipo: "central" } : { tipo: "zona", zonaId: destinoZonaId };
  }
  const cierre = destinos.get(fila.cierreId);
  if (cierre === undefined) {
    // Sin la palabra del estado en plural: la guardia de la 455 la lee como texto visible.
    throw new Error("retenidas (462): una gestion apunta a un cierre que la base no devuelve");
  }
  if (cierre.estado === CIERRE_APROBADO) return null;
  return ambitoDelCierre(cierre);
}

/** Los ids de cierre DISTINTOS de las filas (sin los `null` del grupo «sin cierre»). */
function cierreIdsDe(filas: readonly RetenidaRow[]): string[] {
  return [...new Set(filas.map((f) => f.cierreId).filter((c): c is string => c !== null))];
}

function indexarPorCierre<T extends DestinoDeCierre>(cierres: readonly T[]): Map<string, T> {
  return new Map(cierres.map((c) => [c.cierreId, c]));
}

/** Ambito por el destino PERSISTIDO del cierre: el mismo eje que `CierresAdminService.resolveAlcance`. */
function ambitoDelCierre(c: DestinoDeCierre): AmbitoRetenidas {
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
