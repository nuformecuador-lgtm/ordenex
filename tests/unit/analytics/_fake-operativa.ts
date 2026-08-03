import { vi } from "vitest";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import type { DimensionAnalitica } from "@/lib/analytics/types";
import type {
  CuboRollup,
  EtiquetaEstatus,
  IAnaliticaOperativaRollupRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import type {
  AgingPorEstadoFila,
  CubosDelDiaEnCurso,
  IAnaliticaOperativaVivaRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaVivaRepository";
import { AnaliticaOperativaService } from "@/lib/services/AnaliticaOperativaService";
import type { ContadorIntentos } from "@/lib/services/AnaliticaOperativaService";

// Feature 126 — dobles compartidos por los tests unitarios de la 126.
//
// NO acaba en `.test.ts`: vitest no lo recoge como suite.
//
// ⚠ LA CONSULTA NO SE FORJA. `ConsultaAnalitica` lleva una marca `unique symbol` no exportada
// (feature 122/R16) y un `as ConsultaAnalitica` seria exactamente el forjador que R28 hace
// detectable. Aqui se construye por el camino REAL, `prepararConsultaAnalitica`, con un actor
// y un filtro de verdad: asi cada test ejercita tambien el recorte de la 122 en vez de darlo
// por hecho.
//
// Es el archivo hermano de `_fake-prisma-dinero.ts`, que es de la 127 y la 126 NO toca (R3).

/** Reloj congelado de todos los tests. Un martes cualquiera, 15:00 UTC = 09:00 CR. */
export const AHORA = new Date("2026-08-03T15:00:00.000Z");

/** La fecha calendario CR de `AHORA`. El dia EN CURSO: nunca esta en el rollup (D6). */
export const HOY_CR = "2026-08-03";

export const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
export const TIENDA: ActorAnalitica = { usuarioId: "u-tienda", rol: "adminTienda" };
export const SATELITE: ActorAnalitica = { usuarioId: "u-sat", rol: "adminSatelite", zonaId: "z1" };
export const MENSAJERO: ActorAnalitica = { usuarioId: "u-men", rol: "mensajero" };

/**
 * Construye una `ConsultaAnalitica` de verdad. Lanza si la preparacion no concede: un test
 * que se equivoque de rol o de metrica debe fallar RUIDOSAMENTE y no seguir con un objeto a
 * medias.
 */
export function consultaDe(
  metricaId: string,
  actor: ActorAnalitica = MAESTRO,
  raw: unknown = { rango: "dia" },
  now: Date = AHORA,
): ConsultaAnalitica {
  const r = prepararConsultaAnalitica(raw, actor, metricaId, now);
  if (r.status !== "ok") {
    throw new Error(`la preparacion de "${metricaId}" no concedio: ${JSON.stringify(r)}`);
  }
  return r.consulta;
}

/** Cubo con todas las medidas a cero; los tests sobrescriben solo lo que les importa. */
export function cubo(parcial: Partial<CuboRollup> & { fecha: string }): CuboRollup {
  return {
    zonaId: "z1",
    tiendaId: "t1",
    mensajeroId: "m1",
    estatusId: "e-entregada",
    causaDevolucion: null,
    ordenesCreadas: 0,
    ordenesEstadoStock: 0,
    entregas: 0,
    devoluciones: 0,
    rechazos: 0,
    reprogramaciones: 0,
    incidentes: 0,
    primerIntentoOk: 0,
    segCicloAcum: BigInt(0),
    segCicloN: 0,
    ...parcial,
  };
}

export interface RollupFalso extends IAnaliticaOperativaRollupRepository {
  readonly llamadasAgregar: { consulta: ConsultaAnalitica; granos: readonly DimensionAnalitica[] }[];
}

/** Repositorio del rollup falso: devuelve lo que le den y CUENTA sus llamadas (R26). */
export function rollupFalso(
  cubos: readonly CuboRollup[],
  etiquetas: ReadonlyMap<string, EtiquetaEstatus> = new Map(),
): RollupFalso {
  const llamadasAgregar: { consulta: ConsultaAnalitica; granos: readonly DimensionAnalitica[] }[] =
    [];
  return {
    llamadasAgregar,
    async agregarCubos(consulta, granos) {
      llamadasAgregar.push({ consulta, granos });
      return cubos;
    },
    async etiquetasDeEstatus() {
      return etiquetas;
    },
  };
}

/** Repositorio vivo falso. Por defecto NO devuelve nada: el dia en curso sale vacio. */
export function vivaFalso(
  opciones: {
    aging?: readonly AgingPorEstadoFila[];
    intradia?: CubosDelDiaEnCurso;
  } = {},
): IAnaliticaOperativaVivaRepository {
  return {
    async agingPorEstado() {
      return opciones.aging ?? [];
    },
    async cubosDelDiaEnCurso() {
      return opciones.intradia ?? { cubos: [], entregasVigentes: [] };
    },
  };
}

/** Contador de intentos falso: ninguna orden tiene intentos previos (todas primer intento). */
export function intentosFalso(mapa: Map<string, number> = new Map()): ContadorIntentos {
  return { contarIntentosEnLote: vi.fn(async (): Promise<Map<string, number>> => mapa) };
}

/** El servicio con los tres dobles enchufados y el reloj CONGELADO (R31). */
export function servicioCon(
  rollup: IAnaliticaOperativaRollupRepository,
  viva: IAnaliticaOperativaVivaRepository = vivaFalso(),
  intentos: ContadorIntentos = intentosFalso(),
  now: Date = AHORA,
): AnaliticaOperativaService {
  return new AnaliticaOperativaService(rollup, viva, intentos, { now: () => now });
}

/* -------------------------------------------------------------------------- */
/* Prisma falso: captura los argumentos con los que se consulta la base        */
/* -------------------------------------------------------------------------- */

export interface PrismaEspia {
  readonly groupBy: unknown[];
  readonly findMany: unknown[];
  readonly cliente: {
    analyticsDaily: { groupBy: (args: unknown) => Promise<unknown[]> };
    orderStatus: { findMany: (args: unknown) => Promise<{ id: string; value: string }[]> };
  };
}

/**
 * Cliente Prisma minimo que NO consulta nada y solo ANOTA con que se le llamo. Es la unica
 * forma honesta de afirmar R22/R23: lo que hay que comprobar no es el numero devuelto sino
 * el `where` que llega a la BASE — el recorte multi-tenant vive ahi, no en el resultado.
 */
export function prismaEspia(
  filas: unknown[] = [],
  estatus: { id: string; value: string }[] = [],
): PrismaEspia {
  const groupBy: unknown[] = [];
  const findMany: unknown[] = [];
  return {
    groupBy,
    findMany,
    cliente: {
      analyticsDaily: {
        groupBy: async (args: unknown) => {
          groupBy.push(args);
          return filas;
        },
      },
      orderStatus: {
        findMany: async (args: unknown) => {
          findMany.push(args);
          return estatus;
        },
      },
    },
  };
}
