import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { CierreBodegaService } from "@/lib/services/CierreBodegaService";
import type {
  CierreDiaConsolidableRow,
  ICierreBodegaRepository,
} from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { listarConsolidablesSchema } from "@/lib/types/cierre-bodega";

// Feature 170 — FASE 2, T J.1 (R40/R41/R44/R49/R51/R54) — «Cierres del dia a consolidar»,
// la cola paginada del adminSatelite.
//
// De las cuatro colas de la tanda J, ESTA es la unica cuya pantalla muestra dinero AGREGADO
// (`ConsolidacionBodegaModule`: cinco numeros, mas la decision de si se puede cerrar la
// bodega). Por eso R49 se prueba aqui con datos que abarcan mas de una pagina: si alguno de
// esos cinco se calculara sobre la pagina visible, el adminSatelite no veria un numero
// impreciso, veria uno FALSO — y dos de ellos (`totalNetoAgregado`, `totalCentralDebe`) ni
// siquiera son una suma: salen de repartir el efectivo entre los pagos INDIVIDUALES ordenados
// de menor a mayor, que una pagina no contiene.
//
// El repositorio doble aplica de verdad el acotamiento por zona que RECIBE y recorta de
// verdad: sin eso, el test de R44 pasaria con un servicio que devolviera cualquier cosa.

const SATELITE_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
const SATELITE_B: Actor = { usuarioId: "u-sat-b", rol: "adminSatelite" };

const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-b": "z-b",
};

/**
 * Roles que NO alcanzan este listado. Es el lado del rechazo de la contraprueba de R44; el
 * lado de la aceptacion son SATELITE_A y SATELITE_B, sin los cuales el test pasaria con un
 * servicio que no le devolviera nada a nadie.
 */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "u-maestro", rol: "maestro" },
  { usuarioId: "u-admin", rol: "admin" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
];

function fila(
  cierreDiaId: string,
  dinero: {
    efectivo: string;
    simpe: string;
    transferencia: string;
    general: string;
    pago: string;
    ingresoBodega: string;
  },
): CierreDiaConsolidableRow {
  return {
    cierreDiaId,
    mensajeroId: `m-${cierreDiaId}`,
    mensajeroNombre: `Mensajero ${cierreDiaId}`,
    totales: {
      efectivo: dinero.efectivo,
      simpe: dinero.simpe,
      transferencia: dinero.transferencia,
      general: dinero.general,
    },
    totalPagoMensajero: dinero.pago,
    totalIngresoBodegaRechazos: dinero.ingresoBodega,
  };
}

/**
 * Los consolidables de la zona A, en el ORDEN en que la pantalla los presenta hoy
 * (`solicitadoAt desc`, que el repositorio resuelve en el WHERE — ver
 * `colas-paginadas-where.test.ts`). Cinco filas con dinero DISTINTO por fila: si una pagina
 * se colara en un agregado, el numero no podria coincidir por casualidad.
 *
 * El pago de `ca-3` (500.00) es deliberadamente MAYOR que todo el efectivo de la zona: es lo
 * que hace que la central quede debiendo, y ese `500.00` desaparece por completo si el
 * reparto se calcula sobre la primera pagina.
 */
const ZONA_A: CierreDiaConsolidableRow[] = [
  fila("ca-1", {
    efectivo: "100.00",
    simpe: "0.00",
    transferencia: "0.00",
    general: "100.00",
    pago: "30.00",
    ingresoBodega: "5.00",
  }),
  fila("ca-2", {
    efectivo: "200.00",
    simpe: "10.00",
    transferencia: "0.00",
    general: "210.00",
    pago: "40.00",
    ingresoBodega: "6.00",
  }),
  fila("ca-3", {
    efectivo: "50.00",
    simpe: "0.00",
    transferencia: "20.00",
    general: "70.00",
    pago: "500.00",
    ingresoBodega: "7.00",
  }),
  fila("ca-4", {
    efectivo: "25.00",
    simpe: "0.00",
    transferencia: "0.00",
    general: "25.00",
    pago: "10.00",
    ingresoBodega: "8.00",
  }),
  fila("ca-5", {
    efectivo: "5.00",
    simpe: "1.00",
    transferencia: "0.00",
    general: "6.00",
    pago: "20.00",
    ingresoBodega: "9.00",
  }),
];

/** La zona vecina. Sus montos son de otro orden de magnitud: mezclarlos se nota. */
const ZONA_B: CierreDiaConsolidableRow[] = [
  fila("cb-1", {
    efectivo: "1000.00",
    simpe: "0.00",
    transferencia: "0.00",
    general: "1000.00",
    pago: "100.00",
    ingresoBodega: "50.00",
  }),
  fila("cb-2", {
    efectivo: "2000.00",
    simpe: "0.00",
    transferencia: "0.00",
    general: "2000.00",
    pago: "200.00",
    ingresoBodega: "60.00",
  }),
];

const ALMACEN: Record<string, CierreDiaConsolidableRow[]> = { "z-a": ZONA_A, "z-b": ZONA_B };

/**
 * Los cinco agregados que `listarConsolidacion` calcula sobre el conjunto COMPLETO de la zona
 * A, con la cuenta escrita para que un lector pueda verificarla a mano:
 *
 *   efectivo      100 + 200 + 50 + 25 + 5   = 380.00
 *   simpe           0 +  10 +  0 +  0 + 1   =  11.00
 *   transferencia   0 +   0 + 20 +  0 + 0   =  20.00
 *   general       100 + 210 + 70 + 25 + 6   = 411.00
 *   pago           30 +  40 + 500 + 10 + 20 = 600.00
 *   ingresoBodega   5 +   6 +  7 +  8 + 9   =  35.00
 *
 * Reparto del efectivo (atomico, de menor a mayor) sobre 380.00 con pagos [10,20,30,40,500]:
 * se pagan 10+20+30+40 = 100.00 y el de 500 NO cabe -> la central debe 500.00.
 * Neto = 411.00 - 100.00 = 311.00.
 */
const AGREGADOS_CONJUNTO = {
  totales: { efectivo: "380.00", simpe: "11.00", transferencia: "20.00", general: "411.00" },
  pago: "600.00",
  ingresoBodega: "35.00",
  neto: "311.00",
  centralDebe: "500.00",
};

/**
 * Los MISMOS cinco calculados sobre la PAGINA 1 (`ca-1`, `ca-2`), que es lo que la pantalla
 * mostraria si alguien los derivara de la tabla:
 *
 *   efectivo 100 + 200 = 300.00 · general 100 + 210 = 310.00 · pago 30 + 40 = 70.00
 *   reparto de 300.00 con [30,40] -> se pagan los dos -> la central NO debe nada
 *   neto = 310.00 - 70.00 = 240.00
 *
 * Los cinco son DISTINTOS de los del conjunto, y `centralDebe` es el que mas duele: diria
 * «0.00» donde la verdad es «500.00».
 */
const AGREGADOS_PAGINA_1 = {
  totales: { efectivo: "300.00", simpe: "10.00", transferencia: "0.00", general: "310.00" },
  pago: "70.00",
  ingresoBodega: "11.00",
  neto: "240.00",
  centralDebe: "0.00",
};

/**
 * Repositorio EN MEMORIA: acota por la zona que RECIBE, recorta de verdad y anota cada
 * llamada. La cuenta de llamadas es lo que prueba R54 y, sobre todo, que
 * `listarConsolidacion` NO se alimente de la version paginada.
 */
function repoEnMemoria() {
  const llamadas: string[] = [];

  const findCierresDiaConsolidables = vi.fn(async (zonaId: string) => {
    llamadas.push("findCierresDiaConsolidables");
    return ALMACEN[zonaId] ?? [];
  });

  const findCierresDiaConsolidablesPaginado = vi.fn(
    async (zonaId: string, rango: RangoPagina) => {
      llamadas.push("findCierresDiaConsolidablesPaginado");
      const conjunto = ALMACEN[zonaId] ?? [];
      return {
        items: conjunto.slice(rango.skip, rango.skip + rango.take),
        total: conjunto.length,
      };
    },
  );

  const repo = {
    findCierresDiaConsolidables,
    findCierresDiaConsolidablesPaginado,
    contarCierresDiaSolicitados: vi.fn(async () => {
      llamadas.push("contarCierresDiaSolicitados");
      return 0;
    }),
    existeCierreBodegaSolicitado: vi.fn(async () => false),
    crearCierreBodega: vi.fn(async () => "cb-1"),
    findCierresBodegaByZona: vi.fn(async () => {
      llamadas.push("findCierresBodegaByZona");
      return [];
    }),
    findCierresBodegaByZonaPaginado: vi.fn(async () => ({ items: [], total: 0 })),
  } as unknown as ICierreBodegaRepository;

  return { repo, llamadas, findCierresDiaConsolidablesPaginado };
}

function servicio(repo: ICierreBodegaRepository, contarZona?: { n: number }) {
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async (usuarioId: string) => {
      if (contarZona) contarZona.n += 1;
      return ZONA_POR_USUARIO[usuarioId] ?? null;
    }),
  } as unknown as IOrdenRepository;
  return new CierreBodegaService(repo, ordenRepo);
}

function input(extra: Record<string, unknown> = {}) {
  return listarConsolidablesSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ cierreDiaId: string }>): string[] {
  return items.map((c) => c.cierreDiaId);
}

/** Suma money-safe (Prisma.Decimal, como produccion) de un campo de las filas dadas. */
function suma(filas: ReadonlyArray<CierreDiaConsolidableRow>, campo: "pago" | "general"): string {
  let acc = new Prisma.Decimal(0);
  for (const f of filas) {
    acc = acc.plus(campo === "pago" ? f.totalPagoMensajero : f.totales.general);
  }
  return acc.toFixed(2);
}

describe("CierreBodegaService.listarConsolidablesPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarConsolidablesPaginado(input({ page: 1, pageSize: 2 }), SATELITE_A);
    const p2 = await svc.listarConsolidablesPaginado(input({ page: 2, pageSize: 2 }), SATELITE_A);
    const p3 = await svc.listarConsolidablesPaginado(input({ page: 3, pageSize: 2 }), SATELITE_A);

    expect(p1.status).toBe("ok");
    expect(p2.status).toBe("ok");
    expect(p3.status).toBe("ok");
    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") return;

    expect(ids(p1.items)).toEqual(["ca-1", "ca-2"]);
    expect(ids(p2.items)).toEqual(["ca-3", "ca-4"]);
    expect(ids(p3.items)).toEqual(["ca-5"]);

    for (const [i, p] of [p1, p2, p3].entries()) {
      expect(p.total, `pagina ${i + 1}`).toBe(5);
      expect(p.pageSize, `pagina ${i + 1}`).toBe(2);
      expect(p.page, `pagina ${i + 1}`).toBe(i + 1);
    }
    // La ultima pagina es la que hace visible la mentira de contar el array.
    expect(p3.items).toHaveLength(1);
    expect(p3.total).not.toBe(p3.items.length);
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarConsolidablesPaginado(input({ pageSize: 100000 }), SATELITE_A);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pageSize).toBe(100); // cierreConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    for (const actor of [SATELITE_A, SATELITE_B]) {
      const { repo } = repoEnMemoria();
      const svc = servicio(repo);

      const sinPaginar = await svc.listarConsolidacion(actor);
      expect(sinPaginar.status, `actor ${actor.usuarioId}`).toBe("ok");
      if (sinPaginar.status !== "ok") return;

      const recorrido: string[] = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarConsolidablesPaginado(input({ page, pageSize: 2 }), actor);
        expect(p.status, `actor ${actor.usuarioId}`).toBe("ok");
        if (p.status !== "ok") return;
        total = p.total;
        if (p.items.length === 0) break;
        recorrido.push(...ids(p.items));
      }

      expect(recorrido, `actor ${actor.usuarioId}`).toEqual(ids(sinPaginar.consolidables));
      expect(total, `actor ${actor.usuarioId}: el total es el del conjunto`).toBe(
        sinPaginar.consolidables.length,
      );
    }
  });

  it("CONTRAPRUEBA de R44: cada bodega ve la SUYA y ninguna de la vecina", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const pagina = async (actor: Actor) => {
      const r = await svc.listarConsolidablesPaginado(input({ pageSize: 50 }), actor);
      return r.status === "ok" ? ids(r.items) : [`<${r.status}>`];
    };

    const deA = await pagina(SATELITE_A);
    const deB = await pagina(SATELITE_B);

    expect(deA).toEqual(["ca-1", "ca-2", "ca-3", "ca-4", "ca-5"]);
    // Sin este segundo lado, un servicio que devolviera siempre vacio pasaria la mitad de
    // arriba: el de la zona B tiene que ver LO SUYO, no nada.
    expect(deB).toEqual(["cb-1", "cb-2"]);
    expect(deA.filter((id) => deB.includes(id))).toEqual([]);
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol que no sea adminSatelite", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarConsolidablesPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total"); // un conteo tambien es informacion
      // El guard va ANTES de la base: ni una consulta al dinero de una bodega ajena.
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }
  });

  it("el adminSatelite SIN zona recibe una pagina vacia y no consulta la base (R44)", async () => {
    const { repo, llamadas } = repoEnMemoria();
    const sinZona: Actor = { usuarioId: "u-sin-zona", rol: "adminSatelite" };

    const r = await servicio(repo).listarConsolidablesPaginado(input(), sinZona);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    // Es lo mismo que devuelve hoy `listarConsolidacion` (consolidables []), sin tocar cierres.
    expect(llamadas).toEqual([]);
  });

  it("conserva el criterio de ordenacion actual (R51)", async () => {
    const { repo } = repoEnMemoria();
    const svc = servicio(repo);

    const r = await svc.listarConsolidablesPaginado(input({ pageSize: 50 }), SATELITE_A);
    const sinPaginar = await svc.listarConsolidacion(SATELITE_A);

    expect(r.status).toBe("ok");
    expect(sinPaginar.status).toBe("ok");
    if (r.status !== "ok" || sinPaginar.status !== "ok") return;

    // Es EL MISMO orden que presenta hoy la pantalla, no solo "un orden".
    expect(ids(r.items)).toEqual(ids(sinPaginar.consolidables));
    // Y las paginas encajan en ese orden sin solaparse ni saltarse nada.
    const p1 = await svc.listarConsolidablesPaginado(input({ page: 1, pageSize: 3 }), SATELITE_A);
    const p2 = await svc.listarConsolidablesPaginado(input({ page: 2, pageSize: 3 }), SATELITE_A);
    if (p1.status !== "ok" || p2.status !== "ok") return;
    expect([...ids(p1.items), ...ids(p2.items)]).toEqual(ids(r.items));
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    // El listado sin paginar hace TRES consultas al repo (consolidables, el contador de
    // pendientes y el historico de la zona); el paginado hace UNA, con el conteo dentro.
    const sinPaginar = repoEnMemoria();
    await servicio(sinPaginar.repo).listarConsolidacion(SATELITE_A);
    expect(sinPaginar.llamadas).toEqual([
      "findCierresDiaConsolidables",
      "contarCierresDiaSolicitados",
      "findCierresBodegaByZona",
    ]);

    const paginado = repoEnMemoria();
    await servicio(paginado.repo).listarConsolidablesPaginado(
      input({ pageSize: 2 }),
      SATELITE_A,
    );
    expect(paginado.llamadas).toEqual(["findCierresDiaConsolidablesPaginado"]);
    expect(paginado.llamadas.length).toBeLessThanOrEqual(sinPaginar.llamadas.length);

    // La pagina y el total salen de la MISMA llamada: el conteo no puede resolverse contra
    // otro `where` que el de la pagina.
    expect(paginado.findCierresDiaConsolidablesPaginado).toHaveBeenCalledTimes(1);
    await expect(
      paginado.findCierresDiaConsolidablesPaginado.mock.results[0]!.value,
    ).resolves.toMatchObject({ total: 5 });

    // El coste NO crece con el numero de filas devueltas (nada de N+1 por fila).
    const grande = repoEnMemoria();
    await servicio(grande.repo).listarConsolidablesPaginado(input({ pageSize: 100 }), SATELITE_A);
    expect(grande.llamadas).toEqual(["findCierresDiaConsolidablesPaginado"]);

    // Y la resolucion de zona es la MISMA que ya hacia el listado sin paginar: paginar no
    // anade ninguna consulta de alcance nueva.
    const zonaSinPaginar = { n: 0 };
    await servicio(repoEnMemoria().repo, zonaSinPaginar).listarConsolidacion(SATELITE_A);
    const zonaPaginado = { n: 0 };
    await servicio(repoEnMemoria().repo, zonaPaginado).listarConsolidablesPaginado(
      input(),
      SATELITE_A,
    );
    expect(zonaPaginado.n).toBe(zonaSinPaginar.n);
  });

  it("los totales agregados de dinero siguen calculandose sobre el conjunto completo (R49)", async () => {
    const { repo, llamadas } = repoEnMemoria();
    const svc = servicio(repo);

    const r = await svc.listarConsolidacion(SATELITE_A);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    // (a) Los CINCO agregados son los del conjunto completo, no los de una pagina.
    expect(r.totalesAgregados).toEqual(AGREGADOS_CONJUNTO.totales);
    expect(r.totalPagoMensajeroAgregado).toBe(AGREGADOS_CONJUNTO.pago);
    expect(r.totalIngresoBodegaRechazosAgregado).toBe(AGREGADOS_CONJUNTO.ingresoBodega);
    expect(r.totalNetoAgregado).toBe(AGREGADOS_CONJUNTO.neto);
    expect(r.totalCentralDebeAgregado).toBe(AGREGADOS_CONJUNTO.centralDebe);

    // (b) Y NINGUNO coincide con lo que daria la pagina visible: los datos abarcan tres
    // paginas a proposito, para que un calculo por pagina no pueda pasar por casualidad.
    // El mas grave es `centralDebe`: sobre la pagina 1 diria que la central no debe nada.
    expect(r.totalesAgregados).not.toEqual(AGREGADOS_PAGINA_1.totales);
    expect(r.totalPagoMensajeroAgregado).not.toBe(AGREGADOS_PAGINA_1.pago);
    expect(r.totalIngresoBodegaRechazosAgregado).not.toBe(AGREGADOS_PAGINA_1.ingresoBodega);
    expect(r.totalNetoAgregado).not.toBe(AGREGADOS_PAGINA_1.neto);
    expect(r.totalCentralDebeAgregado).not.toBe(AGREGADOS_PAGINA_1.centralDebe);
    expect(AGREGADOS_PAGINA_1.centralDebe).toBe("0.00"); // la mentira que se evita

    // (c) ESTRUCTURAL: el dinero NO se alimenta del camino paginado. Si manana alguien
    // "optimiza" `listarConsolidacion` haciendola leer una pagina, los cinco numeros pasarian
    // a ser los de esa pagina y esta linea se pone roja antes que ninguna otra.
    expect(llamadas).not.toContain("findCierresDiaConsolidablesPaginado");

    // (d) El conjunto sobre el que se agrega es EXACTAMENTE el que la paginacion recorre: el
    // dinero de todas las paginas juntas es el mismo que el del listado entero.
    const recorrido: CierreDiaConsolidableRow[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const p = await svc.listarConsolidablesPaginado(input({ page, pageSize: 2 }), SATELITE_A);
      if (p.status !== "ok" || p.items.length === 0) break;
      recorrido.push(...p.items);
    }
    expect(suma(recorrido, "general")).toBe(r.totalesAgregados.general);
    expect(suma(recorrido, "pago")).toBe(r.totalPagoMensajeroAgregado);
    // Y una sola pagina NO llega a esos numeros: la desigualdad es la que da valor a la
    // igualdad de arriba.
    expect(suma(recorrido.slice(0, 2), "general")).not.toBe(r.totalesAgregados.general);
    expect(suma(recorrido.slice(0, 2), "pago")).not.toBe(r.totalPagoMensajeroAgregado);

    // (e) Los agregados no dependen de que pagina se este viendo (semilla de R50): el gate de
    // «Solicitar cierre de bodega» tampoco.
    expect(r.puedesSolicitar).toBe(true);
    const otra = await svc.listarConsolidacion(SATELITE_A);
    expect(otra.status === "ok" && otra.totalCentralDebeAgregado).toBe(
      AGREGADOS_CONJUNTO.centralDebe,
    );
  });
});
