// Feature 192 — dobles compartidos por los tests unitarios del servicio del tablero.
//
// NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.

import type { ITableroDiaCache } from "@/lib/interfaces/external/ITableroDiaCache";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  EntregasEnHora,
  FilaConteoMensajero,
  FiltroAlcanceTablero,
  ITableroDiaRepository,
  PaginaDetalle,
  PaginaOrdenesDelDia,
} from "@/lib/interfaces/repositories/ITableroDiaRepository";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { TableroDiaService } from "@/lib/services/TableroDiaService";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { VentanaDiaCR } from "@/lib/utils/ventana-dia-cr";

export interface LlamadaConteo {
  readonly ventana: VentanaDiaCR;
  readonly filtro: FiltroAlcanceTablero;
}

export interface LlamadaDetalle extends LlamadaConteo {
  readonly mensajeroId: string;
  readonly pagina: PaginaDetalle;
}

/**
 * Repositorio de mentira que APUNTA lo que le piden. Devuelve filas en funcion del filtro,
 * para que un test pueda comprobar que dos actores de alcance distinto reciben CONTENIDO
 * distinto — no basta con contar llamadas.
 */
export class RepositorioDoble implements ITableroDiaRepository {
  readonly conteos: LlamadaConteo[] = [];
  readonly detalles: LlamadaDetalle[] = [];
  /** Feature 258 — las llamadas a la serie por hora, apuntadas igual que las otras dos. */
  readonly ritmos: LlamadaConteo[] = [];

  constructor(
    private readonly filasPorFiltro: (filtro: FiltroAlcanceTablero) => FilaConteoMensajero[] = () =>
      [],
    private readonly paginaPorFiltro: (
      filtro: FiltroAlcanceTablero,
      mensajeroId: string,
    ) => PaginaOrdenesDelDia = () => ({ filas: [], total: 0 }),
    private readonly ritmoPorFiltro: (filtro: FiltroAlcanceTablero) => EntregasEnHora[] = () => [],
  ) {}

  async contarPorMensajero(
    ventana: VentanaDiaCR,
    filtro: FiltroAlcanceTablero,
  ): Promise<readonly FilaConteoMensajero[]> {
    this.conteos.push({ ventana, filtro });
    return this.filasPorFiltro(filtro);
  }

  async listarOrdenesDelDia(
    ventana: VentanaDiaCR,
    filtro: FiltroAlcanceTablero,
    mensajeroId: string,
    pagina: PaginaDetalle,
  ): Promise<PaginaOrdenesDelDia> {
    this.detalles.push({ ventana, filtro, mensajeroId, pagina });
    return this.paginaPorFiltro(filtro, mensajeroId);
  }

  /**
   * Feature 258 — el HISTOGRAMA por hora. Devuelve solo las horas CON entregas, como el
   * repositorio real: si el doble rellenara los huecos, el test de "sin huecos" del servicio
   * estaria comprobando el doble en vez de `acumularPorHora`.
   */
  async contarEntregasPorHora(
    ventana: VentanaDiaCR,
    filtro: FiltroAlcanceTablero,
  ): Promise<readonly EntregasEnHora[]> {
    this.ritmos.push({ ventana, filtro });
    return this.ritmoPorFiltro(filtro);
  }
}

/** Una fila de conteo consistente con la identidad de ocho sumandos de R25. */
export function fila(
  mensajeroId: string,
  mensajeroNombre: string,
  parciales: Partial<Omit<FilaConteoMensajero, "mensajeroId" | "mensajeroNombre" | "asignadas">> = {},
): FilaConteoMensajero {
  const base = {
    entregadas: 0,
    reprogramadas: 0,
    devueltas: 0,
    rechazadas: 0,
    incidentes: 0,
    sinRecoger: 0,
    enReparto: 0,
    otros: 0,
    ...parciales,
  };
  const asignadas =
    base.entregadas +
    base.reprogramadas +
    base.devueltas +
    base.rechazadas +
    base.incidentes +
    base.sinRecoger +
    base.enReparto +
    base.otros;
  return { mensajeroId, mensajeroNombre, asignadas, ...base };
}

/* -------------------------------------------------------------------------- */
/* Feature 260 — los dos colaboradores nuevos del servicio                     */
/* -------------------------------------------------------------------------- */

/**
 * FEATURE 260 (B6) — hidratador de mentira que APUNTA con que ids y con que filtro lo
 * llamaron. Que apunte el FILTRO no es un lujo: R11 exige que el recorte de alcance viaje
 * TAMBIEN a la hidratacion, y contar llamadas no lo demostraria.
 */
export class OrdenesDoble implements Pick<IOrdenRepository, "findListItemsByIds"> {
  readonly llamadas: { ids: readonly string[]; filtro: FiltroAlcanceTablero }[] = [];

  constructor(private readonly itemsPorId: ReadonlyMap<string, OrdenListItemDTO> = new Map()) {}

  async findListItemsByIds(
    ids: readonly string[],
    filtro: FiltroAlcanceTablero,
  ): Promise<OrdenListItemDTO[]> {
    this.llamadas.push({ ids: [...ids], filtro });
    // Devuelve en un orden DISTINTO del pedido a proposito (invertido): asi el test del orden
    // preservado (R4) mide al servicio y no al doble.
    return [...ids]
      .reverse()
      .map((id) => this.itemsPorId.get(id))
      .filter((item): item is OrdenListItemDTO => item !== undefined);
  }
}

/** El derivador de intentos, con el mismo contrato del real: las ordenes sin intentos NO vienen. */
export class HistorialDoble implements Pick<IOrdenHistorialService, "contarIntentosEnLote"> {
  readonly llamadas: string[][] = [];

  constructor(private readonly porOrden: ReadonlyMap<string, number> = new Map()) {}

  async contarIntentosEnLote(ordenIds: string[]): Promise<Map<string, number>> {
    this.llamadas.push([...ordenIds]);
    const salida = new Map<string, number>();
    for (const id of ordenIds) {
      const intentos = this.porOrden.get(id);
      if (intentos !== undefined) salida.set(id, intentos);
    }
    return salida;
  }
}

/**
 * FEATURE 260 (B6) — el servicio con los colaboradores por defecto.
 *
 * Existe para que los tests que NO miran el detalle (conteos, cache, ritmo) no tengan que
 * enumerar tres dobles. Los que SI lo miran construyen `TableroDiaService` a mano con sus
 * propios dobles: ahi los colaboradores son el objeto de la prueba, no ruido.
 */
export function servicioDelTablero(
  repo: ITableroDiaRepository,
  cache?: ITableroDiaCache,
): TableroDiaService {
  const ordenes = new OrdenesDoble();
  const historial = new HistorialDoble();
  return cache === undefined
    ? new TableroDiaService(repo, ordenes, historial)
    : new TableroDiaService(repo, ordenes, historial, cache);
}
