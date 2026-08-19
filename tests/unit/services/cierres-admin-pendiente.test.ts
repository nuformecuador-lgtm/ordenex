import { describe, it, expect, vi } from "vitest";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  CierreAdminResumenRow,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { CierreParaPagoDTO } from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { derivarPendienteCierre } from "@/lib/utils/pendiente-cierre";

// Feature 172 / T C.2 (R22, R26, R28) — `pendientePagoMensajero` viaja con el cierre.
//
// Tres cosas se afirman aqui, y las tres son las que la task pide comprobar CONTANDO, no leyendo:
//   1. los TRES listados (cola paginada, historico paginado y el sin paginar) traen el campo;
//   2. un cierre NO aprobado lo trae en `null` (R28) — que no es `"0.00"` (R27);
//   3. el numero de llamadas al repositorio de pagos por listado **no crece con el tamaño de
//      pagina**: es UNA, con los ids de la pagina.
//
// Money-safe: en este archivo no hay ni un `Number(` ni un `parseFloat`. Los montos se escriben
// y se comparan como STRING, que es como viajan (R14).

const MAESTRO: Actor = { usuarioId: "adm", rol: "maestro" };

const CERO = { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" };

/**
 * Fila cruda de cierre. `P` = `totalPagoMensajero` (snapshot de la 39) y `E` = `totales.efectivo`
 * (snapshot de la 37): son los dos numeros de los que sale `min(P, E)` (§5).
 */
function row(over: Partial<CierreAdminResumenRow> & { cierreId: string }): CierreAdminResumenRow {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: "Ana Mensajera",
    estado: "aprobado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    destinoZonaNombre: "Central",
    totales: CERO,
    totalPagoMensajero: "50000.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-07-30T10:00:00.000Z",
    resueltoAt: "2026-07-31T10:00:00.000Z",
    motivoRechazo: null,
    ...over,
  };
}

function fakeRepo(overrides: Partial<ICierresAdminRepository> = {}): ICierresAdminRepository {
  return {
    findCierresByAlcance: vi.fn(async () => [] as CierreAdminResumenRow[]),
    findHistoricoPaginado: vi.fn(async () => ({ items: [] as CierreAdminResumenRow[], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [] as CierreAdminResumenRow[], total: 0 })),
    // Feature 184 (T D.1): los dos CONJUNTOS de la descarga (no-op en esta suite).
    findHistoricoCompleto: vi.fn(async () => [] as CierreAdminResumenRow[]),
    findColaCompleta: vi.fn(async () => [] as CierreAdminResumenRow[]),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    // Feature 230 (T2.1): el doble implementa la interfaz ENTERA. Estos casos no ejercitan la
    // descarga detallada; devolver el conjunto vacio deja el camino de la 38 intacto.
    findGestionesPorAlcanceCompleto: vi.fn(async () => []),
    findCatalogoFiltros: vi.fn(async () => ({ zonas: [], mensajeros: [] })),
    // Pedido humano (2026-08-19): la correccion del desglose. Dobles no-op: esta suite no la
    // ejercita (vive en `cierres-admin-corregir-pagos.test.ts`).
    findGestionEditableEnCierre: vi.fn(async () => null),
    actualizarPagosGestion: vi.fn(async () => ({ status: "conflict" as const })),
    ...overrides,
  };
}

/**
 * Doble del repositorio de pagos con CONTADOR de llamadas. `pagados` es lo ya entregado por
 * cierre; `cierre` es lo que se relee tras aprobar.
 */
function fakeLiquidacion(opts: { pagados?: Record<string, string>; cierre?: CierreParaPagoDTO | null } = {}) {
  const idsPedidos: string[][] = [];
  return {
    idsPedidos,
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) => {
      idsPedidos.push(ids);
      return Object.fromEntries(ids.map((id) => [id, opts.pagados?.[id] ?? "0.00"]));
    }),
    obtenerCierreParaPago: vi.fn(async () => opts.cierre ?? null),
  };
}

function newService(repo: ICierresAdminRepository, liquidacion = fakeLiquidacion()) {
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z-sat"),
    // Feature 239 (T2.1, R9): los DOS ids del ANCLAJE son obligatorios al aprobar — sin ellos la
    // aprobacion no ocurre. Los demas estados (la config OPCIONAL de la 109/139) siguen
    // resolviendo a `null`, que es lo que esta suite necesita: mide el PENDIENTE, no la
    // liberacion.
    findEstatusIdByValue: vi.fn(async (v: string) =>
      v === "devolucion_por_confirmar" || v === "devuelta" ? `s-${v}` : null,
    ),
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  const service = new CierresAdminService(repo, zonaRepo, ordenRepo, signedUrls, liquidacion);
  return { service, liquidacion };
}

// ── R22: la derivacion ──────────────────────────────────────────────────────────────────────

describe("R22 — el pendiente sale de min(P, E) menos los pagos VIGENTES, en el servidor", () => {
  it("E = 0: el cierre debe TODO el pago devengado", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [row({ cierreId: "c1" })]),
    });
    const { service } = newService(repo);

    const r = await service.listarCierresAdmin(MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.historico[0]!.pendientePagoMensajero).toBe("50000.00");
  });

  it("E cubre parte de P: solo queda el resto (y un pago vigente lo baja mas)", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [
        row({ cierreId: "c1", totales: { ...CERO, efectivo: "20000.00" } }),
      ]),
    });
    // 50 000 devengado − 20 000 tomados del efectivo = 30 000; menos 12 500 ya pagados.
    const { service } = newService(repo, fakeLiquidacion({ pagados: { c1: "12500.00" } }));

    const r = await service.listarCierresAdmin(MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.historico[0]!.pendientePagoMensajero).toBe("17500.00");
  });

  it("R27: pagado del todo -> `0.00`, que NO es lo mismo que `null`", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [row({ cierreId: "c1" })]),
    });
    const { service } = newService(repo, fakeLiquidacion({ pagados: { c1: "50000.00" } }));

    const r = await service.listarCierresAdmin(MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.historico[0]!.pendientePagoMensajero).toBe("0.00");
  });

  it("la cifra es EXACTA al centimo (lo que un float redondearia mal)", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [
        row({ cierreId: "c1", totalPagoMensajero: "0.30", totales: { ...CERO, efectivo: "0.10" } }),
      ]),
    });
    const { service } = newService(repo, fakeLiquidacion({ pagados: { c1: "0.10" } }));

    const r = await service.listarCierresAdmin(MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    // 0.30 − 0.10 − 0.10 = 0.10 exacto (en coma flotante, 0.09999999999999999).
    expect(r.historico[0]!.pendientePagoMensajero).toBe("0.10");
  });

  it("no reimplementa la regla: coincide con `derivarPendienteCierre` en varios pares", async () => {
    const casos: [string, string, string][] = [
      ["50000.00", "0.00", "0.00"],
      ["50000.00", "50000.00", "0.00"],
      ["50000.00", "70000.00", "0.00"],
      ["1234.56", "1000.00", "100.00"],
      ["0.00", "0.00", "0.00"],
    ];
    for (const [p, e, pagado] of casos) {
      const repo = fakeRepo({
        findCierresByAlcance: vi.fn(async () => [
          row({ cierreId: "c1", totalPagoMensajero: p, totales: { ...CERO, efectivo: e } }),
        ]),
      });
      const { service } = newService(repo, fakeLiquidacion({ pagados: { c1: pagado } }));

      const r = await service.listarCierresAdmin(MAESTRO);

      if (r.status !== "ok") throw new Error("esperaba ok");
      expect(r.historico[0]!.pendientePagoMensajero).toBe(derivarPendienteCierre(p, e, pagado));
    }
  });
});

// ── R28: solo los aprobados ─────────────────────────────────────────────────────────────────

describe("R28 — el pendiente solo existe en cierres APROBADOS", () => {
  it.each(["solicitado", "vencido", "rechazado"] as const)(
    "un cierre `%s` lo devuelve `null` y NO entra en la agregacion",
    async (estado) => {
      const repo = fakeRepo({
        findCierresByAlcance: vi.fn(async () => [row({ cierreId: "c1", estado })]),
      });
      const { service, liquidacion } = newService(repo);

      const r = await service.listarCierresAdmin(MAESTRO);

      if (r.status !== "ok") throw new Error("esperaba ok");
      const todos = [...r.pendientes, ...r.historico];
      expect(todos[0]!.pendientePagoMensajero).toBeNull();
      // Ni siquiera se pregunta por el: sus ids no viajan a la consulta.
      expect(liquidacion.idsPedidos).toEqual([[]]);
    },
  );

  it("mezcla: en la MISMA respuesta, aprobados con cifra y no aprobados con `null`", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [
        row({ cierreId: "c-sol", estado: "solicitado" }),
        row({ cierreId: "c-apr", estado: "aprobado" }),
        row({ cierreId: "c-rec", estado: "rechazado" }),
      ]),
    });
    const { service, liquidacion } = newService(repo, fakeLiquidacion({ pagados: { "c-apr": "10000.00" } }));

    const r = await service.listarCierresAdmin(MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.pendientes.map((c) => [c.cierreId, c.pendientePagoMensajero])).toEqual([
      ["c-sol", null],
    ]);
    expect(r.historico.map((c) => [c.cierreId, c.pendientePagoMensajero])).toEqual([
      ["c-apr", "40000.00"],
      ["c-rec", null],
    ]);
    // Solo el aprobado viaja a la agregacion.
    expect(liquidacion.idsPedidos).toEqual([["c-apr"]]);
  });
});

// ── R26: los TRES listados + el coste ───────────────────────────────────────────────────────

describe("R26 — los tres listados traen el campo, con UNA sola consulta cada uno", () => {
  it("el listado SIN PAGINAR (cola + historico) usa una sola agregacion para las dos listas", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [
        row({ cierreId: "c1", estado: "solicitado" }),
        row({ cierreId: "c2" }),
        row({ cierreId: "c3" }),
      ]),
    });
    const { service, liquidacion } = newService(repo);

    await service.listarCierresAdmin(MAESTRO);

    expect(liquidacion.sumarVigentesPorCierre).toHaveBeenCalledTimes(1);
    expect(liquidacion.idsPedidos).toEqual([["c2", "c3"]]);
  });

  it("el HISTORICO paginado trae el campo en todas sus filas", async () => {
    const items = [row({ cierreId: "h1" }), row({ cierreId: "h2" })];
    const repo = fakeRepo({ findHistoricoPaginado: vi.fn(async () => ({ items, total: 40 })) });
    const { service } = newService(repo, fakeLiquidacion({ pagados: { h2: "50000.00" } }));

    const r = await service.listarHistoricoCierresAdminPaginado({ page: 1, pageSize: 2 }, MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.items.map((c) => c.pendientePagoMensajero)).toEqual(["50000.00", "0.00"]);
    expect(r.total).toBe(40); // el total del CONJUNTO no lo toca esta tanda (R41)
  });

  it("la COLA paginada trae el campo, siempre `null` (son cierres no aprobados)", async () => {
    const items = [
      row({ cierreId: "p1", estado: "solicitado" }),
      row({ cierreId: "p2", estado: "vencido" }),
    ];
    const repo = fakeRepo({ findColaPaginada: vi.fn(async () => ({ items, total: 2 })) });
    const { service } = newService(repo);

    const r = await service.listarPendientesCierresAdminPaginado({ page: 1, pageSize: 20 }, MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.items.map((c) => c.pendientePagoMensajero)).toEqual([null, null]);
  });

  it("EL COSTE: el numero de llamadas NO crece con el tamaño de pagina", async () => {
    // Se mide con 1, 5 y 50 filas APROBADAS. Si la derivacion se hiciera por fila —una consulta
    // por cierre, que es el error natural—, este test lo veria en la tercera corrida: 50 en vez
    // de 1. Es la razon de que se cuenten llamadas en vez de leer el codigo.
    for (const n of [1, 5, 50]) {
      const items = Array.from({ length: n }, (_, i) => row({ cierreId: `c${i}` }));
      const repo = fakeRepo({ findHistoricoPaginado: vi.fn(async () => ({ items, total: 500 })) });
      const { service, liquidacion } = newService(repo);

      const r = await service.listarHistoricoCierresAdminPaginado(
        { page: 1, pageSize: n },
        MAESTRO,
      );

      if (r.status !== "ok") throw new Error("esperaba ok");
      expect(r.items).toHaveLength(n);
      expect(
        liquidacion.sumarVigentesPorCierre,
        `con pageSize=${n} el listado hizo mas de una consulta de pagos`,
      ).toHaveBeenCalledTimes(1);
      // Y la consulta llevo los ids de TODA la pagina, no los de un trozo.
      expect(liquidacion.idsPedidos[0]).toHaveLength(n);
      expect(liquidacion.obtenerCierreParaPago).not.toHaveBeenCalled(); // los listados no releen cierres
    }
  });

  it("`sinZona` no consulta pagos: no hay alcance que mirar", async () => {
    const zonaRepo = { findCentralZonaId: vi.fn(async () => null) } as unknown as IZonaRepository;
    const ordenRepo = {
      findUsuarioZonaId: vi.fn(async () => null), // adminSatelite sin zona (R3)
      findEstatusIdByValue: vi.fn(async () => null),
    } as unknown as IOrdenRepository;
    const signedUrls = { createSignedUrls: vi.fn(async () => ({})) } as unknown as ISignedUrlProvider;
    const liquidacion = fakeLiquidacion();
    const service = new CierresAdminService(fakeRepo(), zonaRepo, ordenRepo, signedUrls, liquidacion);

    const r = await service.listarCierresAdmin({ usuarioId: "sat", rol: "adminSatelite" });

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.sinZona).toBe(true);
    expect(liquidacion.sumarVigentesPorCierre).not.toHaveBeenCalled();
  });

  it("un rol sin acceso al modulo no llega ni a la agregacion (R1)", async () => {
    const { service, liquidacion } = newService(fakeRepo());

    const r = await service.listarCierresAdmin({ usuarioId: "m1", rol: "mensajero" });

    expect(r.status).toBe("forbidden");
    expect(liquidacion.sumarVigentesPorCierre).not.toHaveBeenCalled();
  });
});

// ── R26 en el DETALLE ───────────────────────────────────────────────────────────────────────

describe("R26 — el detalle de un cierre tambien trae su pendiente", () => {
  function repoConDetalle(estado: CierreAdminResumenRow["estado"]): ICierresAdminRepository {
    return fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: row({ cierreId: "c1", estado }),
        gestiones: [],
      })),
    });
  }

  it("cierre aprobado: el detalle trae la misma cifra que el listado", async () => {
    const { service } = newService(
      repoConDetalle("aprobado"),
      fakeLiquidacion({ pagados: { c1: "15000.00" } }),
    );

    const r = await service.verCierreDetalle("c1", MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.cierre.pendientePagoMensajero).toBe("35000.00");
  });

  it("cierre solicitado: el detalle no ofrece nada relativo al pago (R28)", async () => {
    const { service } = newService(repoConDetalle("solicitado"));

    const r = await service.verCierreDetalle("c1", MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.cierre.pendientePagoMensajero).toBeNull();
  });

  it("el detalle NO recomputa el resto del dinero: los snapshots viajan tal cual", async () => {
    const { service } = newService(
      repoConDetalle("aprobado"),
      fakeLiquidacion({ pagados: { c1: "15000.00" } }),
    );

    const r = await service.verCierreDetalle("c1", MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.cierre.totalPagoMensajero).toBe("50000.00"); // snapshot de la 39, intacto
    expect(r.cierre.totales).toEqual(CERO); // snapshot de la 37, intacto
  });
});

// ── §8: el resultado de aprobar ─────────────────────────────────────────────────────────────

describe("R16/R18 — aprobar devuelve el pendiente, sin convertirlo en condicion", () => {
  const cierreAprobado: CierreParaPagoDTO = {
    id: "c1",
    mensajeroId: "m1",
    estado: "aprobado",
    totalPagoMensajero: "50000.00",
    totalEfectivo: "20000.00",
  };

  it("tras aprobar, `ok` trae el pendiente derivado (30 000 = 50 000 − 20 000)", async () => {
    const { service } = newService(fakeRepo(), fakeLiquidacion({ cierre: cierreAprobado }));

    const r = await service.aprobarCierre("c1", MAESTRO);

    expect(r).toEqual({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "30000.00",
    });
  });

  it("el pendiente se deriva DESPUES de que la aprobacion haya confirmado", async () => {
    const orden: string[] = [];
    const repo = fakeRepo({
      resolverCierre: vi.fn(async () => {
        orden.push("aprobar");
        return "updated" as const;
      }),
    });
    const liquidacion = fakeLiquidacion({ cierre: cierreAprobado });
    liquidacion.obtenerCierreParaPago.mockImplementation(async () => {
      orden.push("leer-cierre");
      return cierreAprobado;
    });
    const { service } = newService(repo, liquidacion);

    await service.aprobarCierre("c1", MAESTRO);

    // R17/R18: aprobar y pagar son dos escrituras distintas. La derivacion no puede formar
    // parte de la transaccion de aprobacion, porque un fallo suyo revertiria la aprobacion y
    // dejaria al mensajero bloqueado por un tramite administrativo (alternativa A, descartada).
    expect(orden).toEqual(["aprobar", "leer-cierre"]);
  });

  it("un cierre ya liquidado del todo devuelve `0.00`: no hay nada que ofrecer (R27)", async () => {
    const { service } = newService(
      fakeRepo(),
      fakeLiquidacion({ cierre: cierreAprobado, pagados: { c1: "30000.00" } }),
    );

    const r = await service.aprobarCierre("c1", MAESTRO);

    expect(r).toMatchObject({ status: "ok", pendientePagoMensajero: "0.00" });
  });

  it("si el cierre no se puede releer, `0.00`: no se ofrece pagar una cifra sin derivar", async () => {
    const { service } = newService(fakeRepo(), fakeLiquidacion({ cierre: null }));

    const r = await service.aprobarCierre("c1", MAESTRO);

    expect(r).toMatchObject({ status: "ok", pendientePagoMensajero: "0.00" });
  });

  it("`conflict` y `no_encontrada` no derivan nada (no hubo aprobacion)", async () => {
    for (const [res, esperado] of [
      ["conflict", "conflict"],
      ["fuera_de_alcance", "no_encontrada"],
    ] as const) {
      const repo = fakeRepo({ resolverCierre: vi.fn(async () => res) });
      const { service, liquidacion } = newService(repo, fakeLiquidacion({ cierre: cierreAprobado }));

      const r = await service.aprobarCierre("c1", MAESTRO);

      expect(r).toEqual({ status: esperado });
      expect(liquidacion.obtenerCierreParaPago).not.toHaveBeenCalled();
      expect(liquidacion.sumarVigentesPorCierre).not.toHaveBeenCalled();
    }
  });

  it("R14: todo lo que sale es STRING de escala 2", async () => {
    const { service } = newService(fakeRepo(), fakeLiquidacion({ cierre: cierreAprobado }));

    const r = await service.aprobarCierre("c1", MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(typeof r.pendientePagoMensajero).toBe("string");
    expect(r.pendientePagoMensajero).toMatch(/^\d+\.\d{2}$/);
  });
});
