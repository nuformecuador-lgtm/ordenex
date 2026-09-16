import { describe, it, expect, vi } from "vitest";

import { ConciliacionSatelitesService } from "@/lib/services/ConciliacionSatelitesService";
import type { ICierresBodegaAdminRepository } from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { ISaldosSatelitesRepository } from "@/lib/interfaces/repositories/ISaldosSatelitesRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { SaldoSateliteDTO } from "@/lib/types/conciliacion-satelites";
import { descargaConfig } from "@/lib/config/descarga";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 / T8 (R25/R27) — EL SERVICIO: QUIEN PUEDE, Y QUE LLAMA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LO QUE MIDE: que el guard de rol va PRIMERO —antes de tocar NINGUN repositorio— en las SEIS
// operaciones, y que la UNICA llamada al repositorio es la esperada.
//
// ⚠️ POR QUE «ANTES DEL REPO» ES UNA ASERCION Y NO UN DETALLE DE ESTILO: con el guard despues, el
// saldo de TODAS las bodegas —dinero agregado de la operacion entera— ya habria salido de la base
// aunque la respuesta fuera un error. `expect(repo.x).not.toHaveBeenCalled()` es lo que lo ancla.
//
// QUIEN PUEDE (Q3, confirmado por el humano el 2026-09-16): `esAccesoTotal` = `maestro` **o**
// `admin`, que es exactamente quien aprueba hoy. Estrechar a `maestro` devolveria la dependencia de
// una sola persona, que es parte de lo que la ficha viene a quitar. Por eso el barrido de roles de
// abajo afirma las DOS caras: quien SI puede y quien NO.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-adminsat", rol: "adminSatelite" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const TIENDA: Actor = { usuarioId: "t1", rol: "adminTienda" };

const ZONA = "11111111-1111-4111-8111-111111111111";

/**
 * Lee las llamadas de un doble que viaja tipado como el METODO de la interfaz. El cast vive AQUI,
 * en una sola linea y con nombre, en vez de repartido por cada asercion.
 */
function llamadasDe(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls;
}

function saldoDe(overrides: Partial<SaldoSateliteDTO> = {}): SaldoSateliteDTO {
  return {
    zonaId: ZONA,
    zonaNombre: "Cartago",
    saldoSinConciliar: "1015.00",
    totalEfectivo: "2300.00",
    totalConsolidado: "3000.00",
    totalRecibido: "1285.00",
    consolidacionesSinConciliar: 1,
    diasDeLaMasAntigua: 5,
    fechaDeLaMasAntigua: "2026-09-11T12:00:00.000Z",
    ...overrides,
  };
}

function fakeSaldos(overrides: Partial<ISaldosSatelitesRepository> = {}) {
  return {
    findSaldosPaginado: vi.fn(async () => ({ items: [saldoDe()], total: 1 })),
    findSaldosCompleto: vi.fn(async () => [saldoDe()]),
    findConsolidacionesPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findConsolidacionesCompleto: vi.fn(async () => []),
    ...overrides,
  } as unknown as ISaldosSatelitesRepository & Record<string, ReturnType<typeof vi.fn>>;
}

type Escrituras = Pick<ICierresBodegaAdminRepository, "marcarConciliado" | "revertirConciliacion">;

function fakeEscrituras(overrides: Partial<Escrituras> = {}) {
  return {
    marcarConciliado: vi.fn(async () => "updated" as const),
    revertirConciliacion: vi.fn(async () => "updated" as const),
    ...overrides,
  } as unknown as Escrituras & Record<string, ReturnType<typeof vi.fn>>;
}

function newService(
  saldos = fakeSaldos(),
  escrituras = fakeEscrituras(),
) {
  return { service: new ConciliacionSatelitesService(saldos, escrituras), saldos, escrituras };
}

// ---------------------------------------------------------------------------------------------
// R27 — el rol
// ---------------------------------------------------------------------------------------------

describe("431/T8 (R27) — quien puede ver y quien puede marcar", () => {
  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
  ])("%s SI puede: las seis operaciones responden `ok`", async (_n, actor) => {
    const { service } = newService();

    expect((await service.listarSaldosSatelites({ page: 1, pageSize: 25 }, actor)).status).toBe("ok");
    expect((await service.listarSaldosSatelitesCompleto({}, actor)).status).toBe("ok");
    expect(
      (await service.listarConsolidacionesSatelite({ zonaId: ZONA, page: 1, pageSize: 25 }, actor))
        .status,
    ).toBe("ok");
    expect(
      (await service.listarConsolidacionesSateliteCompleto({ zonaId: ZONA }, actor)).status,
    ).toBe("ok");
    expect(
      (await service.marcarRecibida({ cierreBodegaId: "cb1", montoRecibido: "485.00" }, actor))
        .status,
    ).toBe("ok");
    expect((await service.revertirConciliacion({ cierreBodegaId: "cb1" }, actor)).status).toBe("ok");
  });

  it.each([
    ["adminSatelite", ADMIN_SATELITE],
    ["mensajero", MENSAJERO],
    ["adminTienda", TIENDA],
  ])(
    "⭑ %s NO puede, y el repositorio NI SE TOCA en ninguna de las seis",
    async (_n, actor) => {
      const { service, saldos, escrituras } = newService();

      for (const r of [
        await service.listarSaldosSatelites({ page: 1, pageSize: 25 }, actor),
        await service.listarSaldosSatelitesCompleto({}, actor),
        await service.listarConsolidacionesSatelite(
          { zonaId: ZONA, page: 1, pageSize: 25 },
          actor,
        ),
        await service.listarConsolidacionesSateliteCompleto({ zonaId: ZONA }, actor),
        await service.marcarRecibida(
          { cierreBodegaId: "cb1", montoRecibido: "485.00" },
          actor,
        ),
        await service.revertirConciliacion({ cierreBodegaId: "cb1" }, actor),
      ]) {
        expect(r.status).toBe("forbidden");
      }

      // ⭑ EL ANCLA: el dinero no sale de la base ni siquiera para ser descartado.
      for (const fn of Object.values(saldos)) expect(fn).not.toHaveBeenCalled();
      for (const fn of Object.values(escrituras)) expect(fn).not.toHaveBeenCalled();
    },
  );

  it("⭑ `adminSatelite` NO marca ni revierte NI SIQUIERA LAS SUYAS (R26)", async () => {
    // Quien entrego el dinero tiene derecho a VER si la central dijo que llego, y a nada mas. Esa
    // asimetria es deliberada: si la bodega pudiera marcar su propia consolidacion como recibida,
    // la conciliacion no diria nada.
    const { service, escrituras } = newService();
    const r = await service.marcarRecibida(
      { cierreBodegaId: "cb1", montoRecibido: "485.00" },
      ADMIN_SATELITE,
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(escrituras.marcarConciliado).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// R9/R11/R12 — lo que el servicio le pide al repositorio, y como traduce sus desenlaces
// ---------------------------------------------------------------------------------------------

describe("431/T8 — marcar y revertir: la UNICA llamada, y los tres desenlaces", () => {
  it("⭑ marcar: la unica llamada al repositorio es la escritura esperada, con el actor", async () => {
    const { service, escrituras, saldos } = newService();
    const r = await service.marcarRecibida(
      { cierreBodegaId: "cb1", montoRecibido: "485.00", nota: "faltaron 15" },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", cierreBodegaId: "cb1" });
    expect(escrituras.marcarConciliado).toHaveBeenCalledTimes(1);
    expect(escrituras.marcarConciliado).toHaveBeenCalledWith({
      id: "cb1",
      montoRecibido: "485.00",
      nota: "faltaron 15",
      // El actor sale de la SESION, nunca del payload: quien marca no se puede suplantar.
      actorUsuarioId: "u-maestro",
    });
    expect(escrituras.revertirConciliacion).not.toHaveBeenCalled();
    // Y no se lee nada de mas: marcar no lista saldos.
    for (const fn of Object.values(saldos)) expect(fn).not.toHaveBeenCalled();
  });

  it("la nota AUSENTE viaja como `null`, no como `undefined` ni como cadena vacia", async () => {
    // El `CHECK` de la base distingue NULL de cadena vacia, y el contrato del repositorio declara
    // `string | null`. Normalizar aqui evita que cada llamador invente su propia ausencia.
    const { service, escrituras } = newService();
    await service.marcarRecibida({ cierreBodegaId: "cb1", montoRecibido: "1.00" }, MAESTRO);
    const arg = llamadasDe(escrituras.marcarConciliado)[0][0] as { nota: unknown };
    expect(arg.nota).toBeNull();
  });

  it("R11: `conflict` del repositorio -> `conflict` del servicio", async () => {
    const { service } = newService(
      fakeSaldos(),
      fakeEscrituras({ marcarConciliado: vi.fn(async () => "conflict" as const) }),
    );
    const r = await service.marcarRecibida(
      { cierreBodegaId: "cb1", montoRecibido: "1.00" },
      MAESTRO,
    );
    expect(r).toEqual({ status: "conflict" });
  });

  it("`fuera_de_alcance` del repositorio -> `no_encontrada` del servicio", async () => {
    const { service } = newService(
      fakeSaldos(),
      fakeEscrituras({ marcarConciliado: vi.fn(async () => "fuera_de_alcance" as const) }),
    );
    const r = await service.marcarRecibida(
      { cierreBodegaId: "cb1", montoRecibido: "1.00" },
      MAESTRO,
    );
    expect(r).toEqual({ status: "no_encontrada" });
  });

  it("⭑ revertir: la unica llamada es la reversion, y NO lleva monto", async () => {
    // No hace falta: el monto que se borra lo lee el repositorio dentro de su transaccion y lo pone
    // en el historial. Pedirlo por parametro abriria la puerta a que el borde mandara otro.
    const { service, escrituras } = newService();
    const r = await service.revertirConciliacion({ cierreBodegaId: "cb1" }, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreBodegaId: "cb1" });
    expect(escrituras.revertirConciliacion).toHaveBeenCalledTimes(1);
    expect(escrituras.revertirConciliacion).toHaveBeenCalledWith({
      id: "cb1",
      actorUsuarioId: "u-maestro",
    });
    expect(escrituras.marcarConciliado).not.toHaveBeenCalled();
  });

  it("revertir: `conflict` y `fuera_de_alcance` se traducen igual que al marcar", async () => {
    const enConflicto = newService(
      fakeSaldos(),
      fakeEscrituras({ revertirConciliacion: vi.fn(async () => "conflict" as const) }),
    );
    expect(
      (await enConflicto.service.revertirConciliacion({ cierreBodegaId: "cb1" }, MAESTRO)).status,
    ).toBe("conflict");

    const inexistente = newService(
      fakeSaldos(),
      fakeEscrituras({ revertirConciliacion: vi.fn(async () => "fuera_de_alcance" as const) }),
    );
    expect(
      (await inexistente.service.revertirConciliacion({ cierreBodegaId: "cb1" }, MAESTRO)).status,
    ).toBe("no_encontrada");
  });
});

// ---------------------------------------------------------------------------------------------
// R23/R24/R29 — las lecturas
// ---------------------------------------------------------------------------------------------

describe("431/T8 — las lecturas: paginacion, recorte y tope de descarga", () => {
  it("la pagina traduce `{page,pageSize}` a `{skip,take}` y devuelve el TOTAL del conjunto", async () => {
    const { service, saldos } = newService();
    const r = await service.listarSaldosSatelites({ page: 3, pageSize: 10 }, MAESTRO);

    expect(saldos.findSaldosPaginado).toHaveBeenCalledWith({ skip: 20, take: 10 });
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.page).toBe(3);
    expect(r.pageSize).toBe(10);
    expect(r.total).toBe(1); // el total del CONJUNTO, nunca `items.length`
  });

  it("el desglose pasa la zona y el recorte `soloSinConciliar` tal cual", async () => {
    const { service, saldos } = newService();
    await service.listarConsolidacionesSatelite(
      { zonaId: ZONA, page: 2, pageSize: 25, soloSinConciliar: true },
      MAESTRO,
    );
    expect(saldos.findConsolidacionesPaginado).toHaveBeenCalledWith(
      ZONA,
      { skip: 25, take: 25 },
      true,
    );
  });

  it("⭑ R29: por encima del tope, `limite_excedido` viaja SIN filas", async () => {
    // El tope lo evalua y lo aplica el SERVICIO, y la rama de error nunca lleva un dataset
    // truncado: una descarga a medias es peor que ninguna.
    const muchas = Array.from({ length: descargaConfig.MAX_FILAS + 1 }, (_, i) =>
      saldoDe({ zonaId: `z-${i}` }),
    );
    const { service } = newService(fakeSaldos({ findSaldosCompleto: vi.fn(async () => muchas) }));

    const r = await service.listarSaldosSatelitesCompleto({}, MAESTRO);

    expect(r.status).toBe("limite_excedido");
    expect(r).not.toHaveProperty("items");
    if (r.status === "limite_excedido") {
      expect(r.total).toBe(descargaConfig.MAX_FILAS + 1);
      expect(r.limite).toBe(descargaConfig.MAX_FILAS);
    }
  });

  it("R20: el servicio NO hace aritmetica con dinero: devuelve lo que el repositorio cuadro", async () => {
    // El saldo llega YA cuadrado del repositorio, donde se resta con `Prisma.Decimal`. Si el
    // servicio recalculara algo, habria dos formulas y un dia dirian cosas distintas.
    const { service } = newService();
    const r = await service.listarSaldosSatelites({ page: 1, pageSize: 25 }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.items[0].saldoSinConciliar).toBe("1015.00");
    expect(r.items[0].totalEfectivo).toBe("2300.00");
  });
});
