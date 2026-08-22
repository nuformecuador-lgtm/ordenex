import { describe, expect, it } from "vitest";

import { ordenesConfig } from "@/lib/config/ordenes";
import type {
  FilaDelDia,
  PaginaOrdenesDelDia,
} from "@/lib/interfaces/repositories/ITableroDiaRepository";
import { TableroDiaService } from "@/lib/services/TableroDiaService";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { DetalleMensajeroDia } from "@/lib/types/tablero-dia";
import { TODOS_LOS_CENTINELAS, ordenDeListado } from "@/tests/fixtures/orden-detalle-dia";

import { HistorialDoble, OrdenesDoble, RepositorioDoble } from "./_doble-tablero-dia";

// FEATURE 260 (B5) — R4, R5, R6, R7, R9, R10, R11, R12, R13, R40, R46.
//
// LA COMPOSICION DEL DETALLE, que es donde vive el reparto de decisiones de esta feature:
//
//   · la consulta del DIA decide QUIEN entra, cuantas hay y EN QUE ORDEN;
//   · la hidratacion decide QUE trae cada una, por el camino que ya produce el elemento del
//     listado de ordenes — sin criterio propio, sin filtrar por fecha y sin ordenar;
//   · el servicio REIMPONE el orden del primero sobre el resultado del segundo, anexa lo que
//     es del dia y RECORTA por alcance antes de devolver nada.
//
// Cada `it` de aqui mide una de esas costuras. La que no se puede medir con dobles —que el
// `WHERE` de la hidratacion recorte de verdad— se mide contra Postgres en
// `tests/integration/orden-list-items-by-ids.test.ts`, porque un doble NO VE EL SQL.

const ZONA_X = "11111111-1111-4111-8111-111111111111";
const AHORA = new Date("2026-08-08T19:00:00.000Z");
const MENSAJERO = "33333333-3333-4333-8333-333333333333";

const MAESTRO = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const SATELITE_X = { usuarioId: "u-sat", rol: "adminSatelite", zonaId: ZONA_X };

/** Una fila de la pagina del dia: los tres campos que esa consulta decide, y nada mas. */
function filaDelDia(ordenId: string, parciales: Partial<FilaDelDia> = {}): FilaDelDia {
  return {
    ordenId,
    resultadoDelDia: null,
    asignadoAt: "2026-08-08T13:00:00.000Z",
    ...parciales,
  };
}

interface Montaje {
  readonly service: TableroDiaService;
  readonly repo: RepositorioDoble;
  readonly ordenes: OrdenesDoble;
  readonly historial: HistorialDoble;
}

function montar(
  pagina: PaginaOrdenesDelDia,
  items: readonly OrdenListItemDTO[] = [],
  intentos: ReadonlyMap<string, number> = new Map(),
): Montaje {
  const repo = new RepositorioDoble(
    () => [],
    () => pagina,
  );
  const ordenes = new OrdenesDoble(new Map(items.map((item) => [item.id, item])));
  const historial = new HistorialDoble(intentos);
  return { service: new TableroDiaService(repo, ordenes, historial), repo, ordenes, historial };
}

async function detalleDe(
  montaje: Montaje,
  actor: { usuarioId: string; rol: string; zonaId: string | null } = MAESTRO,
  pagina = 1,
): Promise<DetalleMensajeroDia> {
  const resultado = await montaje.service.detalle(actor, AHORA, MENSAJERO, pagina);
  if (resultado.estado !== "ok") throw new Error(`se esperaba ok, llego ${resultado.motivo}`);
  return resultado.detalle;
}

/* -------------------------------------------------------------------------- */
/* R4 — el orden lo decide la consulta del dia                                 */
/* -------------------------------------------------------------------------- */

describe("TableroDiaService.detalle — el orden de la pagina (R4)", () => {
  it("devuelve las filas en el orden de la consulta del dia, no en el de la hidratacion", async () => {
    const ids = ["o3", "o1", "o2"];
    const montaje = montar(
      { filas: ids.map((id) => filaDelDia(id)), total: 3 },
      ids.map((id) => ordenDeListado({ id })),
    );

    const detalle = await detalleDe(montaje);

    // `OrdenesDoble` devuelve a proposito en orden INVERSO al pedido: si el servicio no
    // reimpusiera el orden, aqui saldria `["o2","o1","o3"]` y este test seria el unico que lo
    // notaria — ninguna columna pinta `asignadoAt`.
    expect(detalle.ordenes.map((o) => o.id)).toEqual(ids);
  });

  it("anexa el resultado del dia y el instante de asignacion de SU fila, no de otra", async () => {
    const montaje = montar(
      {
        filas: [
          filaDelDia("o1", { resultadoDelDia: "entregada", asignadoAt: "2026-08-08T13:00:00.000Z" }),
          filaDelDia("o2", { resultadoDelDia: null, asignadoAt: "2026-08-08T09:00:00.000Z" }),
        ],
        total: 2,
      },
      [ordenDeListado({ id: "o1" }), ordenDeListado({ id: "o2" })],
    );

    const detalle = await detalleDe(montaje);

    expect(detalle.ordenes.map((o) => [o.id, o.resultadoDelDia, o.asignadoAt])).toEqual([
      ["o1", "entregada", "2026-08-08T13:00:00.000Z"],
      ["o2", null, "2026-08-08T09:00:00.000Z"],
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* R5 — cero filas, cero consultas                                             */
/* -------------------------------------------------------------------------- */

describe("TableroDiaService.detalle — la pagina vacia (R5)", () => {
  it("con cero filas NO llama ni a la hidratacion ni al contador de intentos", async () => {
    const montaje = montar({ filas: [], total: 0 });

    const detalle = await detalleDe(montaje);

    expect(detalle.ordenes).toEqual([]);
    expect(montaje.ordenes.llamadas).toEqual([]);
    expect(montaje.historial.llamadas).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R6 — los intentos, con el criterio unico y el `0` como valor conocido       */
/* -------------------------------------------------------------------------- */

describe("TableroDiaService.detalle — los intentos de entrega (R6)", () => {
  it("mergea el conteo del lote y pone `0` a las ordenes que no traen ninguno", async () => {
    const montaje = montar(
      { filas: [filaDelDia("o1"), filaDelDia("o2")], total: 2 },
      [ordenDeListado({ id: "o1" }), ordenDeListado({ id: "o2" })],
      new Map([["o1", 3]]),
    );

    const detalle = await detalleDe(montaje);

    expect(detalle.ordenes.map((o) => [o.id, o.intentosEntrega])).toEqual([
      ["o1", 3],
      ["o2", 0],
    ]);
  });

  it("pide los intentos EN LOTE, con los ids de la pagina y una sola llamada", async () => {
    const montaje = montar(
      { filas: [filaDelDia("o1"), filaDelDia("o2")], total: 2 },
      [ordenDeListado({ id: "o1" }), ordenDeListado({ id: "o2" })],
    );

    await detalleDe(montaje);

    expect(montaje.historial.llamadas).toEqual([["o1", "o2"]]);
  });
});

/* -------------------------------------------------------------------------- */
/* R7 — un id que no resuelve se omite                                         */
/* -------------------------------------------------------------------------- */

describe("TableroDiaService.detalle — el id que no resuelve (R7)", () => {
  it("omite la fila en lugar de devolver un elemento incompleto", async () => {
    const montaje = montar(
      { filas: [filaDelDia("o1"), filaDelDia("fantasma"), filaDelDia("o2")], total: 3 },
      [ordenDeListado({ id: "o1" }), ordenDeListado({ id: "o2" })],
    );

    const detalle = await detalleDe(montaje);

    expect(detalle.ordenes.map((o) => o.id)).toEqual(["o1", "o2"]);
    // El `total` NO se recalcula: sale de la consulta del dia (R8) y el desajuste de una fila
    // borrada entre las dos consultas es un limite aceptado, no un error que tapar aqui.
    expect(detalle.total).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* R10/R11/R40 — el alcance viaja tambien a la hidratacion                     */
/* -------------------------------------------------------------------------- */

describe("TableroDiaService.detalle — la frontera en la hidratacion (R10/R11/R40)", () => {
  it("la hidratacion recibe EXACTAMENTE los ids de la pagina, nunca una lista sin acotar", async () => {
    const ids = ["o1", "o2", "o3"];
    const montaje = montar(
      { filas: ids.map((id) => filaDelDia(id)), total: 3 },
      ids.map((id) => ordenDeListado({ id })),
    );

    await detalleDe(montaje);

    expect(montaje.ordenes.llamadas).toHaveLength(1);
    expect(montaje.ordenes.llamadas[0].ids).toEqual(ids);
  });

  it("el filtro que llega a la hidratacion es el MISMO que produjo la autorizacion", async () => {
    const montaje = montar(
      { filas: [filaDelDia("o1")], total: 1 },
      [ordenDeListado({ id: "o1" })],
    );

    await detalleDe(montaje, SATELITE_X);

    const esperado = { tipo: "zona", zonaId: ZONA_X };
    expect(montaje.ordenes.llamadas[0].filtro).toEqual(esperado);
    // Y es el mismo objeto de valor que se le paso a la consulta del dia: dos filtros distintos
    // en la misma peticion serian dos fronteras multi-tenant que pueden divergir.
    expect(montaje.repo.detalles[0].filtro).toEqual(esperado);
  });

  it("un actor denegado no llega a la hidratacion ni al contador de intentos (R10)", async () => {
    const montaje = montar(
      { filas: [filaDelDia("o1")], total: 1 },
      [ordenDeListado({ id: "o1" })],
    );

    const resultado = await montaje.service.detalle(
      { usuarioId: "u", rol: "adminTienda", zonaId: null },
      AHORA,
      MENSAJERO,
    );

    expect(resultado).toEqual({ estado: "denegado", motivo: "rol_no_autorizado" });
    expect(montaje.repo.detalles).toEqual([]);
    expect(montaje.ordenes.llamadas).toEqual([]);
    expect(montaje.historial.llamadas).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R9/R12 — la pagina y el alcance viajan en el detalle                        */
/* -------------------------------------------------------------------------- */

describe("TableroDiaService.detalle — lo que acompana a las filas (R9/R12)", () => {
  it("el detalle trae el alcance con el que se resolvio", async () => {
    const montaje = montar(
      { filas: [filaDelDia("o1")], total: 1 },
      [ordenDeListado({ id: "o1" })],
    );

    expect((await detalleDe(montaje, MAESTRO)).alcance).toBe("global");
    expect((await detalleDe(montaje, SATELITE_X)).alcance).toBe("zona");
  });

  it("la pagina y el tamaño de pagina salen del servidor, con la config del listado (R9)", async () => {
    const montaje = montar({ filas: [], total: 0 });
    const detalle = await detalleDe(montaje, MAESTRO, 4);

    expect(detalle.pagina).toBe(4);
    expect(detalle.pageSize).toBe(ordenesConfig.DEFAULT_PAGE_SIZE);
    expect(montaje.repo.detalles[0].pagina).toEqual({
      pagina: 4,
      pageSize: ordenesConfig.DEFAULT_PAGE_SIZE,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* R13/R46 — el recorte por alcance, sobre el payload REAL del servicio        */
/* -------------------------------------------------------------------------- */

describe("TableroDiaService.detalle — el recorte por alcance (R13/R46)", () => {
  it("alcance `zona`: el detalle SERIALIZADO no contiene ninguno de los centinelas", async () => {
    const montaje = montar(
      { filas: [filaDelDia("o1")], total: 1 },
      [ordenDeListado({ id: "o1" })],
    );

    const detalle = await detalleDe(montaje, SATELITE_X);

    // Serializar el detalle ENTERO es lo que caza un campo anidado que nadie listo: probar
    // campo a campo solo encuentra lo que ya se sabia que habia que mirar.
    const payload = JSON.stringify(detalle);
    for (const centinela of TODOS_LOS_CENTINELAS) {
      expect(payload, `el centinela ${centinela} viajo al cliente en alcance zona`).not.toContain(
        centinela,
      );
    }
  });

  it("alcance `zona`: el monto a cobrar SI viaja (R17)", async () => {
    const montaje = montar(
      { filas: [filaDelDia("o1")], total: 1 },
      [ordenDeListado({ id: "o1", montoCobrar: 12345 })],
    );

    const detalle = await detalleDe(montaje, SATELITE_X);
    expect(detalle.ordenes[0].montoCobrar).toBe(12345);
  });

  it("alcance `global`: el payload NO pierde nada (R46)", async () => {
    const montaje = montar(
      { filas: [filaDelDia("o1")], total: 1 },
      [ordenDeListado({ id: "o1" })],
    );

    const detalle = await detalleDe(montaje, MAESTRO);

    const payload = JSON.stringify(detalle);
    for (const centinela of TODOS_LOS_CENTINELAS) {
      expect(payload, `el alcance global perdio ${centinela}`).toContain(centinela);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R18 — el techo de superficie, sobre lo que el SERVICIO devuelve             */
/* -------------------------------------------------------------------------- */

describe("TableroDiaService.detalle — techo de superficie (R18)", () => {
  it("no inventa ni un campo: las claves son las del elemento del listado mas las dos del dia", async () => {
    const item = ordenDeListado({ id: "o1" });
    const montaje = montar({ filas: [filaDelDia("o1")], total: 1 }, [item]);

    const detalle = await detalleDe(montaje, MAESTRO);

    const permitidas = new Set([...Object.keys(item), "resultadoDelDia", "asignadoAt"]);
    expect(Object.keys(detalle.ordenes[0]).filter((c) => !permitidas.has(c))).toEqual([]);
  });
});
