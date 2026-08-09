// Feature 192 — dobles compartidos por los tests unitarios del servicio del tablero.
//
// NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.

import type {
  FilaConteoMensajero,
  FiltroAlcanceTablero,
  ITableroDiaRepository,
  PaginaDetalle,
  PaginaOrdenesDelDia,
} from "@/lib/interfaces/repositories/ITableroDiaRepository";
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

  constructor(
    private readonly filasPorFiltro: (filtro: FiltroAlcanceTablero) => FilaConteoMensajero[] = () =>
      [],
    private readonly paginaPorFiltro: (
      filtro: FiltroAlcanceTablero,
      mensajeroId: string,
    ) => PaginaOrdenesDelDia = () => ({ ordenes: [], total: 0 }),
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
