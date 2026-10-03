import type { ICierreAporteRepository } from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { IOrdenIdentificadaRepository } from "@/lib/interfaces/repositories/IOrdenIdentificadaRepository";
import type { IBusquedaPorGuiaService } from "@/lib/interfaces/services/IBusquedaPorGuiaService";
import type { BusquedaResuelta, ParDeGuia, SuperficieConGuia } from "@/lib/types/busqueda-por-guia";
import {
  FUENTE_CAJA,
  FUENTE_MENSAJERO,
  FUENTE_TIENDA,
  criterioDeFuente,
  type CriterioDeAporte,
  type FuenteDeAporte,
} from "@/lib/utils/aporte-por-orden";

/**
 * Una guia: solo cifras, sin cero inicial (la guia VISIBLE es `String(num_guia)`, asi que «0123» no es la
 * guia 123: R3, comparacion completa) y como mucho 9 cifras, que caben siempre en el `int4` de la columna
 * (un termino de 10 cifras no revienta la consulta: simplemente no escribe la rama de la guia).
 */
const GUIA = /^[1-9]\d{0,8}$/;

/** El catalogo de reparto de cada superficie: la MISMA tabla que decide el detalle de sus filas. */
function catalogoDe(superficie: SuperficieConGuia): Readonly<Record<string, FuenteDeAporte>> {
  if (superficie.tipo === "caja") return FUENTE_CAJA;
  if (superficie.tipo === "tienda") return FUENTE_TIENDA;
  return FUENTE_MENSAJERO;
}

/**
 * La clave ESTRUCTURAL de un criterio: dos conceptos con el mismo criterio (flete e IVA de flete, por
 * ejemplo) comparten UNA consulta. No interpreta el criterio: lo serializa entero, asi que un campo nuevo
 * del criterio entra en la clave solo.
 */
function claveDeCriterio(c: CriterioDeAporte): string {
  return JSON.stringify({ ...c, resultados: [...c.resultados].sort() });
}

/**
 * FICHA 469 (design §2.1–§2.3) — los conceptos que la busqueda por guia alcanza en una superficie,
 * agrupados por criterio. NO hay ninguna lista de conceptos escrita en esta ficha: sale del catalogo
 * vigente (R12) — cuando el catalogo cambie, la busqueda lo hereda —, y lo que el catalogo deja
 * `sin_reparto` (el pago tomado del efectivo del mensajero, R13) queda fuera solo.
 *
 * Exportada para que el test recorra los tres catalogos contra ella (T5).
 */
export function gruposDeCriterio(
  superficie: SuperficieConGuia,
): Array<{ criterio: CriterioDeAporte; categorias: string[] }> {
  const grupos = new Map<string, { criterio: CriterioDeAporte; categorias: string[] }>();
  for (const [categoria, fuente] of Object.entries(catalogoDe(superficie))) {
    const criterio = criterioDeFuente(fuente);
    if (criterio === null) continue; // `sin_reparto`: esa fila no lista ordenes, no se busca por guia
    const clave = claveDeCriterio(criterio);
    const grupo = grupos.get(clave);
    if (grupo === undefined) grupos.set(clave, { criterio, categorias: [categoria] });
    else grupo.categorias.push(categoria);
  }
  return [...grupos.values()];
}

/** El `tiendaId` del alcance: el MISMO con que el detalle de una fila de esa superficie acota sus ordenes. */
function tiendaDe(superficie: SuperficieConGuia): string | undefined {
  return superficie.tipo === "tienda" ? superficie.tiendaId : undefined;
}

function claveDePar(p: ParDeGuia): string {
  return p.origenTipo === "cierre_dia" ? `${p.origenTipo}|${p.origenId}|${p.categoria}` : `${p.origenTipo}|${p.origenId}`;
}

/**
 * FICHA 469 (design §2) — la busqueda por guia del libro de la wallet, en TRES pasos:
 *
 *  1. **Identificar** las ordenes del alcance cuya guia o remision es el termino (R2–R7). Ninguna ⇒ modo
 *     `texto`, la busqueda de la 463 tal cual (R5/R6).
 *  2. **Los movimientos repartibles a los que aportan** (R8–R13): por cada criterio del catalogo de la
 *     superficie, `CierreAporteRepository.cierresDondeAporta` —el `WHERE` del detalle de una fila, R34—
 *     sobre los cierres en que esas ordenes aparecen. Cada cierre devuelto da un par por categoria del
 *     grupo, con `origen_tipo = 'cierre_dia'`: la MISMA condicion que `fuenteDeMovimiento` (un ajuste con
 *     la misma categoria no se reparte y no sale).
 *  3. **Los movimientos de una sola orden** (R14, pregunta abierta 1 aprobada): el cobro por rechazo y la
 *     indemnizacion por incidente de esas ordenes, y sus anulaciones, por su origen. Sin dinero: se
 *     compara el origen de la fila con un id, igual que «A quién».
 *
 * Este servicio no escribe ni una operacion de dinero ni una condicion del criterio: decide QUE pares
 * pedir y los deduplica (R15).
 */
export class BusquedaPorGuiaService implements IBusquedaPorGuiaService {
  constructor(
    private readonly ordenes: IOrdenIdentificadaRepository,
    private readonly aportes: Pick<ICierreAporteRepository, "cierresDondeAporta">,
  ) {}

  async identificar(f: { termino: string; tiendaId?: string }): Promise<string[]> {
    const termino = f.termino.trim();
    if (termino === "") return [];
    const guia = GUIA.test(termino) ? Number.parseInt(termino, 10) : undefined;
    const ordenes = await this.ordenes.identificar({
      termino,
      ...(guia !== undefined ? { guia } : {}),
      ...(f.tiendaId !== undefined ? { tiendaId: f.tiendaId } : {}),
    });
    return [...new Set(ordenes.map((o) => o.ordenId))];
  }

  async resolver(f: { termino: string; superficie: SuperficieConGuia }): Promise<BusquedaResuelta> {
    const tiendaId = tiendaDe(f.superficie);
    const ordenIds = await this.identificar({ termino: f.termino, ...(tiendaId !== undefined ? { tiendaId } : {}) });
    if (ordenIds.length === 0) return { modo: "texto", termino: f.termino };

    const alcance = { ordenIds, ...(tiendaId !== undefined ? { tiendaId } : {}) };
    const [candidatos, gestiones, incidentes] = await Promise.all([
      this.ordenes.cierresDeOrdenes(alcance),
      this.ordenes.gestionesConCobroPorRechazo(alcance),
      this.ordenes.incidentesDeOrdenes(ordenIds),
    ]);

    const pares = new Map<string, ParDeGuia>();
    const anadir = (p: ParDeGuia) => pares.set(claveDePar(p), p);

    if (candidatos.length > 0) {
      const grupos = gruposDeCriterio(f.superficie);
      const casados = await Promise.all(
        grupos.map((g) =>
          this.aportes.cierresDondeAporta({ criterio: g.criterio, pares: candidatos, ...(tiendaId !== undefined ? { tiendaId } : {}) }),
        ),
      );
      grupos.forEach((g, i) => {
        for (const cierreId of new Set(casados[i].map((c) => c.cierreId))) {
          for (const categoria of g.categorias) anadir({ origenTipo: "cierre_dia", origenId: cierreId, categoria });
        }
      });
    }
    for (const origenId of gestiones) anadir({ origenTipo: "gestion_orden", origenId });
    for (const origenId of incidentes) anadir({ origenTipo: "orden_incidente", origenId });

    return { modo: "guia", termino: f.termino, ordenIds, pares: [...pares.values()] };
  }
}
