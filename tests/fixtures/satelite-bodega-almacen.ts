// Feature 184 — Tanda A: el almacen y el DOBLE de repositorio del listado «Órdenes de la
// bodega», compartidos por los dos archivos de servicio de la tanda (el conjunto de la descarga
// y la vigencia de la seleccion).
//
// Existe porque los dos preguntan lo mismo al mismo dominio desde dos angulos —«dame el
// conjunto filtrado» y «¿estos ids siguen en el conjunto filtrado?»— y con dos almacenes
// distintos la comparacion entre ambos no significaria nada.
//
// El doble aplica la semantica de la BASE, no la del filtro de cliente: igualdad EXACTA de
// nombre (`IN (...)`), `NULL IN (...)` que no casa (el `LEFT JOIN` de distrito) y rango de grupo
// por `array_position`. Si implementara `normalizeName` como el navegador, los tests estarian
// comparando el codigo consigo mismo.
//
// AVISO, y es el de siempre en este repo: esto es un DOBLE. No ve la traduccion a SQL. El
// `WHERE`, el `ORDER BY`, cuantas consultas se emiten y que NO llevan viven en
// `tests/unit/repositories/satelite-paginado-where.test.ts`.
import { vi } from "vitest";
import type {
  IOrdenRepository,
  RecepcionSateliteFiltro,
  RecepcionSateliteRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import type { RangoPagina } from "@/lib/utils/rango-pagina";

export const SAT_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
export const SAT_B: Actor = { usuarioId: "u-sat-b", rol: "adminSatelite" };
export const SAT_SIN_ZONA: Actor = { usuarioId: "u-sat-sin", rol: "adminSatelite" };

export const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-b": "z-b",
  "u-sat-sin": null,
};

/** Contraprueba por el lado del rechazo: el modulo satelite es de UN solo rol (R4). */
export const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "u-maestro", rol: "maestro" },
  { usuarioId: "u-admin", rol: "admin" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

export interface FilaAlmacen {
  row: RecepcionSateliteRow;
  zonaId: string;
  /** El repositorio ordena por `created_at` pero NO lo proyecta: vive solo en el almacen. */
  createdAt: string;
}

export function filaSatelite(
  id: string,
  zonaId: string,
  estatusValue: string,
  canton: string,
  distrito: string | null,
  dia: number,
  prioridad = false,
): FilaAlmacen {
  return {
    zonaId,
    createdAt: `2026-03-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    row: {
      id,
      numGuia: 1000 + dia,
      numRemision: `REM-${id}`,
      estatusValue,
      destinatario: `Destinatario ${id}`,
      telefonoDest: "88880000",
      direccion: "100 metros al sur",
      producto: "Caja",
      montoCobrar: 1000,
      tiendaNombre: "Tienda",
      zonaNombre: `Zona ${zonaId}`,
      provinciaNombre:
        canton === "Cartago" ? "Cartago" : canton === "Barva" ? "Heredia" : "San José",
      cantonNombre: canton,
      distritoNombre: distrito,
      prioridad,
    },
  };
}

/**
 * El almacen. Cuatro cosas estan puestas a proposito:
 *
 *  - **«Escazú» existe en las DOS zonas** (a-01… y b-01): el filtro de canton es por NOMBRE, asi
 *    que si el acotamiento por zona se perdiera, filtrar por «Escazú» seria la forma mas facil
 *    de ver —o de descargar— la bodega del vecino.
 *  - **«San Rafael» existe en DOS cantones** de la misma zona (Escazú y Barva).
 *  - **hay ordenes SIN distrito** (a-05, a-10, a-12), que caen solo bajo un filtro de distrito.
 *  - **hay ordenes en estados que NO son de este listado** (a-13 «por recibir», a-14
 *    «entregada»), que ninguna combinacion de filtros puede hacer aparecer.
 */
export const ALMACEN_SATELITE: FilaAlmacen[] = [
  filaSatelite("a-01", "z-a", "en_bodega_satelite", "Escazú", "San Rafael", 1),
  filaSatelite("a-02", "z-a", "en_bodega_satelite", "Escazú", "San Antonio", 2, true),
  filaSatelite("a-03", "z-a", "en_bodega_satelite", "Barva", "San Rafael", 3),
  filaSatelite("a-04", "z-a", "por_recoger", "Escazú", "San Rafael", 4),
  filaSatelite("a-05", "z-a", "por_recoger", "San José", null, 5),
  filaSatelite("a-06", "z-a", "por_devolver", "Barva", "San Pedro", 6),
  filaSatelite("a-07", "z-a", "por_devolver", "Escazú", "San Antonio", 7),
  filaSatelite("a-08", "z-a", "devolviendo_a_bodega_central", "Barva", "San Rafael", 8),
  filaSatelite("a-09", "z-a", "devuelta", "Escazú", "San Rafael", 9, true),
  filaSatelite("a-10", "z-a", "devuelta", "San José", null, 10),
  filaSatelite("a-11", "z-a", "devuelta", "Barva", "San Pedro", 11),
  filaSatelite("a-12", "z-a", "en_bodega_satelite", "San José", null, 12),
  filaSatelite("a-13", "z-a", "en_ruta_bodega_satelite", "Escazú", "San Rafael", 13),
  filaSatelite("a-14", "z-a", "entregada", "Escazú", "San Rafael", 14),
  filaSatelite("b-01", "z-b", "en_bodega_satelite", "Escazú", "San Rafael", 20),
  filaSatelite("b-02", "z-b", "devuelta", "Cartago", "Occidental", 21),
  filaSatelite("b-03", "z-b", "por_recoger", "Cartago", "Occidental", 22),
];

/**
 * El CONJUNTO filtrado y ordenado tal como lo produce el SQL: grupo, prioridad, recencia e
 * `id` de desempate. Lo comparten las tres lecturas del doble, igual que en produccion lo
 * comparten `condicionesSatelite` y `ordenBodegaSatelite`.
 */
function conjuntoDe(filas: FilaAlmacen[], filtro: RecepcionSateliteFiltro): FilaAlmacen[] {
  const estados = [...filtro.estatusValues];
  if (estados.length === 0) return [];
  const cantones = [...(filtro.cantonNombres ?? [])];
  const distritos = [...(filtro.distritoNombres ?? [])];
  return filas
    .filter((f) => f.zonaId === filtro.zonaId)
    .filter((f) => estados.includes(f.row.estatusValue))
    .filter((f) => cantones.length === 0 || cantones.includes(f.row.cantonNombre))
    .filter(
      (f) =>
        distritos.length === 0 ||
        (f.row.distritoNombre !== null && distritos.includes(f.row.distritoNombre)),
    )
    .sort((a, b) => {
      const grupo =
        ESTADOS_BODEGA_SATELITE.indexOf(a.row.estatusValue as never) -
        ESTADOS_BODEGA_SATELITE.indexOf(b.row.estatusValue as never);
      if (grupo !== 0) return grupo;
      if (a.row.prioridad !== b.row.prioridad) return a.row.prioridad ? -1 : 1;
      const recencia = b.createdAt.localeCompare(a.createdAt);
      return recencia !== 0 ? recencia : a.row.id.localeCompare(b.row.id);
    });
}

/**
 * Doble del repositorio con las lecturas del dominio. `llamadas` registra el ORDEN en que se
 * consulta —asi se puede afirmar «el guard va antes del repositorio» y «sin ids no consulta»— y
 * `filtros` guarda el filtro con el que se llamo a cada lectura.
 */
export function repoSateliteEnMemoria(filas: FilaAlmacen[] = ALMACEN_SATELITE) {
  const llamadas: string[] = [];
  const filtros: { metodo: string; filtro: RecepcionSateliteFiltro; ids?: readonly string[] }[] =
    [];

  const findUsuarioZonaId = vi.fn(async (usuarioId: string) => {
    llamadas.push("findUsuarioZonaId");
    return ZONA_POR_USUARIO[usuarioId] ?? null;
  });

  const findRecepcionSatelitePaginada = vi.fn(
    async (filtro: RecepcionSateliteFiltro, rango: RangoPagina) => {
      llamadas.push("findRecepcionSatelitePaginada");
      filtros.push({ metodo: "paginada", filtro });
      const conjunto = conjuntoDe(filas, filtro);
      return {
        items: conjunto.slice(rango.skip, rango.skip + rango.take).map((f) => f.row),
        total: conjunto.length,
      };
    },
  );

  const findRecepcionSateliteCompleta = vi.fn(async (filtro: RecepcionSateliteFiltro) => {
    llamadas.push("findRecepcionSateliteCompleta");
    filtros.push({ metodo: "completa", filtro });
    return conjuntoDe(filas, filtro).map((f) => f.row);
  });

  const findIdsVigentesEnBodega = vi.fn(
    async (filtro: RecepcionSateliteFiltro, ids: readonly string[]) => {
      llamadas.push("findIdsVigentesEnBodega");
      filtros.push({ metodo: "vigencia", filtro, ids });
      // Lo que hace el SQL: el `IN` de ids se cruza con el acotamiento, no lo sustituye.
      const enConjunto = new Set(conjuntoDe(filas, filtro).map((f) => f.row.id));
      return ids.filter((id) => enConjunto.has(id));
    },
  );

  const repo = {
    findUsuarioZonaId,
    findRecepcionSatelitePaginada,
    findRecepcionSateliteCompleta,
    findIdsVigentesEnBodega,
  } as unknown as IOrdenRepository;

  return {
    repo,
    llamadas,
    filtros,
    findRecepcionSatelitePaginada,
    findRecepcionSateliteCompleta,
    findIdsVigentesEnBodega,
  };
}
