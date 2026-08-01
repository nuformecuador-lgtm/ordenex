import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { CierreBodegaService } from "@/lib/services/CierreBodegaService";
import type {
  CierreBodegaResumenRow,
  CierreDiaConsolidableRow,
  ICierreBodegaRepository,
} from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 40 — tests unit del CierreBodegaService (lado adminSatelite; dobles de
// repo/orden, sin DB/red). Cubre R1 (rol), R3 (acota a su zona), R4 (sin zona), R5
// (lista consolidables), R6 (pendientes -> conflict), R7 (vacio -> conflict), R8
// (duplicado + P2002 -> conflict), R10 (totales agregados exactos), R23 (listar no muta).

const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const ZONA_SAT = "z-cartago";

function consolidableRow(
  overrides: Partial<CierreDiaConsolidableRow> = {},
): CierreDiaConsolidableRow {
  return {
    cierreDiaId: "cd1",
    mensajeroId: "m1",
    mensajeroNombre: "Ana Mensajera",
    totales: { efectivo: "10.00", simpe: "5.00", transferencia: "0.00", general: "15.00" },
    totalPagoMensajero: "0.00", // feature 39/R18: snapshot del pago (override en tests R18/R19)
    totalIngresoBodegaRechazos: "0.00", // feature 56/R17: snapshot del ingreso (override en tests R17/R18)
    ...overrides,
  };
}

type Repo = ICierreBodegaRepository;

function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    findCierresDiaConsolidables: vi.fn(async () => [consolidableRow()]),
    contarCierresDiaSolicitados: vi.fn(async () => 0),
    existeCierreBodegaSolicitado: vi.fn(async () => false),
    crearCierreBodega: vi.fn(async () => "cb1"),
    findCierresBodegaByZona: vi.fn(async () => [] as CierreBodegaResumenRow[]),
    // Feature 170 (T I.1): el listado paginado vive en su propia suite (*-paginado).
    findCierresBodegaByZonaPaginado: vi.fn(async () => ({
      items: [] as CierreBodegaResumenRow[],
      total: 0,
    })),
    ...overrides,
  };
}

function newService(opts: { repo?: Repo; zonaSatelite?: string | null } = {}) {
  const repo = opts.repo ?? fakeRepo();
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () =>
      opts.zonaSatelite === undefined ? ZONA_SAT : opts.zonaSatelite,
    ),
  } as unknown as Pick<IOrdenRepository, "findUsuarioZonaId">;
  const service = new CierreBodegaService(repo, ordenRepo as IOrdenRepository);
  return { service, repo, ordenRepo };
}

// --- autorizacion + alcance (R1/R3) ---

describe("CierreBodegaService — autorizacion y alcance (R1/R3)", () => {
  it("R1: listarConsolidacion con rol != adminSatelite -> forbidden, sin tocar repos", async () => {
    for (const actor of [MAESTRO, MENSAJERO]) {
      const { service, repo, ordenRepo } = newService();
      const r = await service.listarConsolidacion(actor);
      expect(r.status).toBe("forbidden");
      expect(ordenRepo.findUsuarioZonaId).not.toHaveBeenCalled();
      expect(repo.findCierresDiaConsolidables).not.toHaveBeenCalled();
    }
  });

  it("R1: solicitarCierreBodega con rol != adminSatelite -> forbidden, sin crear", async () => {
    const { service, repo } = newService();
    const r = await service.solicitarCierreBodega(MAESTRO);
    expect(r.status).toBe("forbidden");
    expect(repo.crearCierreBodega).not.toHaveBeenCalled();
  });

  it("R3: adminSatelite -> consolida SOLO su zona (findUsuarioZonaId + WHERE por esa zona)", async () => {
    const { service, repo, ordenRepo } = newService();
    await service.listarConsolidacion(ADMIN_SATELITE);
    expect(ordenRepo.findUsuarioZonaId).toHaveBeenCalledWith("adm-sat");
    expect(repo.findCierresDiaConsolidables).toHaveBeenCalledWith(ZONA_SAT);
    expect(repo.contarCierresDiaSolicitados).toHaveBeenCalledWith(ZONA_SAT);
    expect(repo.findCierresBodegaByZona).toHaveBeenCalledWith(ZONA_SAT);
  });
});

// --- sin zona (R4) ---

describe("CierreBodegaService — adminSatelite sin zona (R4)", () => {
  it("R4: listarConsolidacion sin zona -> sinZona true, vacio, no puede solicitar, sin consultar consolidables", async () => {
    const { service, repo } = newService({ zonaSatelite: null });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.sinZona).toBe(true);
    expect(r.consolidables).toEqual([]);
    expect(r.puedesSolicitar).toBe(false);
    expect(r.motivoBloqueo).toBeTruthy();
    expect(repo.findCierresDiaConsolidables).not.toHaveBeenCalled();
  });

  it("R4: solicitarCierreBodega sin zona -> validation_error {zona}, sin crear", async () => {
    const { service, repo } = newService({ zonaSatelite: null });
    const r = await service.solicitarCierreBodega(ADMIN_SATELITE);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors.zona).toBeDefined();
    expect(repo.crearCierreBodega).not.toHaveBeenCalled();
  });
});

// --- consolidacion (R5/R23) ---

describe("CierreBodegaService.listarConsolidacion — consolidables (R5/R23)", () => {
  it("R5: lista los cierre_dia consolidables devueltos por el repo", async () => {
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () => [
        consolidableRow({ cierreDiaId: "cd1" }),
        consolidableRow({ cierreDiaId: "cd2", mensajeroId: "m2", mensajeroNombre: "Beto" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.consolidables.map((c) => c.cierreDiaId)).toEqual(["cd1", "cd2"]);
    expect(r.puedesSolicitar).toBe(true);
    expect(r.motivoBloqueo).toBeNull();
  });

  it("R23: listar NO muta (nunca invoca crearCierreBodega)", async () => {
    const { service, repo } = newService();
    await service.listarConsolidacion(ADMIN_SATELITE);
    expect(repo.crearCierreBodega).not.toHaveBeenCalled();
  });
});

// --- precondiciones de solicitar (R6/R7/R8) ---

describe("CierreBodegaService.solicitarCierreBodega — precondiciones (R6/R7/R8)", () => {
  it("R6: con cierre_dia solicitado pendiente -> conflict, sin crear; y bloquea el gate al listar", async () => {
    const repo = fakeRepo({ contarCierresDiaSolicitados: vi.fn(async () => 2) });
    const { service } = newService({ repo });
    const r = await service.solicitarCierreBodega(ADMIN_SATELITE);
    expect(r.status).toBe("conflict");
    expect(repo.crearCierreBodega).not.toHaveBeenCalled();

    const l = await service.listarConsolidacion(ADMIN_SATELITE);
    if (l.status !== "ok") throw new Error("esperaba ok");
    expect(l.puedesSolicitar).toBe(false);
    expect(l.motivoBloqueo).toBeTruthy();
  });

  it("R7: sin consolidables -> conflict, sin crear", async () => {
    const repo = fakeRepo({ findCierresDiaConsolidables: vi.fn(async () => []) });
    const { service } = newService({ repo });
    const r = await service.solicitarCierreBodega(ADMIN_SATELITE);
    expect(r.status).toBe("conflict");
    expect(repo.crearCierreBodega).not.toHaveBeenCalled();
  });

  it("R8: ya existe un cierre de bodega solicitado -> conflict, sin crear", async () => {
    const repo = fakeRepo({ existeCierreBodegaSolicitado: vi.fn(async () => true) });
    const { service } = newService({ repo });
    const r = await service.solicitarCierreBodega(ADMIN_SATELITE);
    expect(r.status).toBe("conflict");
    expect(repo.crearCierreBodega).not.toHaveBeenCalled();
  });

  it("R8: P2002 del indice unico parcial en crearCierreBodega -> conflict (carrera concurrente)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique violation", {
      code: "P2002",
      clientVersion: "test",
    });
    const repo = fakeRepo({
      crearCierreBodega: vi.fn(async () => {
        throw p2002;
      }),
    });
    const { service } = newService({ repo });
    const r = await service.solicitarCierreBodega(ADMIN_SATELITE);
    expect(r.status).toBe("conflict");
  });
});

// --- totales agregados (R10) ---

describe("CierreBodegaService — totales agregados exactos (R10)", () => {
  it("R10: totalesAgregados == suma al centavo de los snapshots de los consolidables", async () => {
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () => [
        consolidableRow({
          cierreDiaId: "cd1",
          totales: { efectivo: "10.00", simpe: "5.55", transferencia: "0.00", general: "15.55" },
        }),
        consolidableRow({
          cierreDiaId: "cd2",
          totales: { efectivo: "0.01", simpe: "0.00", transferencia: "100.44", general: "100.45" },
        }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalesAgregados).toEqual({
      efectivo: "10.01",
      simpe: "5.55",
      transferencia: "100.44",
      general: "116.00",
    });
    expect(typeof r.totalesAgregados.general).toBe("string");
  });

  it("R10: solicitar crea con la MISMA suma agregada + los ids de los consolidables", async () => {
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () => [
        consolidableRow({
          cierreDiaId: "cd1",
          totales: { efectivo: "10.00", simpe: "5.55", transferencia: "0.00", general: "15.55" },
        }),
        consolidableRow({
          cierreDiaId: "cd2",
          totales: { efectivo: "0.01", simpe: "0.00", transferencia: "100.44", general: "100.45" },
        }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.solicitarCierreBodega(ADMIN_SATELITE);
    expect(r).toEqual({
      status: "ok",
      cierreBodegaId: "cb1",
      totales: { efectivo: "10.01", simpe: "5.55", transferencia: "100.44", general: "116.00" },
    });
    const arg = (repo.crearCierreBodega as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      zonaId: ZONA_SAT,
      solicitadoPor: "adm-sat",
      cierreDiaIds: ["cd1", "cd2"],
      totales: { efectivo: "10.01", simpe: "5.55", transferencia: "100.44", general: "116.00" },
    });
  });
});

// --- Feature 39: pago a mensajeros agregado (R18/R19) ---

describe("CierreBodegaService — pago a mensajeros agregado (R18/R19)", () => {
  it("R18: listarConsolidacion expone totalPagoMensajeroAgregado = suma snapshot de los consolidables", async () => {
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () => [
        consolidableRow({ cierreDiaId: "cd1", totalPagoMensajero: "10.50" }),
        consolidableRow({ cierreDiaId: "cd2", totalPagoMensajero: "0.25" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalPagoMensajeroAgregado).toBe("10.75"); // suma exacta al centavo
    expect(typeof r.totalPagoMensajeroAgregado).toBe("string"); // R23
    // R21: separado del dinero recibido (no altera totalesAgregados).
    expect(r.totalesAgregados.general).toBe("30.00"); // (15.00 + 15.00) de los dos consolidables
  });

  it("R18: sin zona -> totalPagoMensajeroAgregado 0.00", async () => {
    const { service } = newService({ zonaSatelite: null });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalPagoMensajeroAgregado).toBe("0.00");
  });

  it("R19: solicitarCierreBodega pasa a crearCierreBodega el pago agregado snapshoteado", async () => {
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () => [
        consolidableRow({ cierreDiaId: "cd1", totalPagoMensajero: "10.50" }),
        consolidableRow({ cierreDiaId: "cd2", totalPagoMensajero: "0.25" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.solicitarCierreBodega(ADMIN_SATELITE);
    expect(r.status).toBe("ok");
    const arg = (repo.crearCierreBodega as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.totalPagoMensajero).toBe("10.75"); // R19: snapshot agregado en la tx
  });
});

// --- Total neto + deuda de la central (el pago a mensajeros solo sale del EFECTIVO) ---

/** Consolidable con `efectivo` (y `general`) a medida: el reparto solo mira el efectivo. */
function conEfectivo(
  efectivo: string,
  overrides: Partial<CierreDiaConsolidableRow> = {},
): CierreDiaConsolidableRow {
  return consolidableRow({
    totales: {
      efectivo,
      simpe: "0.00",
      transferencia: "0.00",
      general: efectivo,
    },
    ...overrides,
  });
}

describe("CierreBodegaService — total neto y deuda de la central", () => {
  it("el efectivo alcanza para todos -> no hay deuda y el neto descuenta todo el pago", async () => {
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () => [
        conEfectivo("5000.00", { cierreDiaId: "cd1", totalPagoMensajero: "1000.00" }),
        conEfectivo("0.00", { cierreDiaId: "cd2", totalPagoMensajero: "2000.00" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalesAgregados.efectivo).toBe("5000.00");
    expect(r.totalPagoMensajeroAgregado).toBe("3000.00");
    expect(r.totalCentralDebeAgregado).toBe("0.00");
    expect(r.totalNetoAgregado).toBe("2000.00"); // 5000 general - 3000 pagados
  });

  it("efectivo insuficiente -> se paga completo a los que alcanzan y la central debe el resto", async () => {
    // El caso del usuario: 5000 en efectivo, 6 mensajeros de 1500 c/u. Solo se le puede
    // pagar a 3 (4500); el pago no puede ser parcial, así que los 500 sobrantes no se usan.
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () =>
        Array.from({ length: 6 }, (_, i) =>
          conEfectivo(i === 0 ? "5000.00" : "0.00", {
            cierreDiaId: `cd${i + 1}`,
            mensajeroId: `m${i + 1}`,
            totalPagoMensajero: "1500.00",
          }),
        ),
      ),
    });
    const { service } = newService({ repo });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalPagoMensajeroAgregado).toBe("9000.00"); // se mantiene sin cambios
    expect(r.totalCentralDebeAgregado).toBe("4500.00"); // los 3 que no se pudieron pagar
    expect(r.totalNetoAgregado).toBe("500.00"); // 5000 general - 4500 pagados
  });

  it("con montos distintos se paga de menor a mayor (le paga a la mayor cantidad posible)", async () => {
    // 5000 en efectivo y montos 4000/3000/2000/1000: de menor a mayor entran 1000+2000 =
    // 3000; el de 3000 ya no cabe (3000+3000 > 5000) y el de 4000 tampoco.
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () => [
        conEfectivo("5000.00", { cierreDiaId: "cd1", totalPagoMensajero: "4000.00" }),
        conEfectivo("0.00", { cierreDiaId: "cd2", totalPagoMensajero: "3000.00" }),
        conEfectivo("0.00", { cierreDiaId: "cd3", totalPagoMensajero: "2000.00" }),
        conEfectivo("0.00", { cierreDiaId: "cd4", totalPagoMensajero: "1000.00" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalPagoMensajeroAgregado).toBe("10000.00");
    expect(r.totalCentralDebeAgregado).toBe("7000.00"); // 3000 + 4000 sin pagar
    expect(r.totalNetoAgregado).toBe("2000.00"); // 5000 general - 3000 pagados
  });

  it("el pago a mensajeros NO se paga con SINPE ni transferencia: solo cuenta el efectivo", async () => {
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () => [
        consolidableRow({
          totales: {
            efectivo: "0.00",
            simpe: "9000.00",
            transferencia: "0.00",
            general: "9000.00",
          },
          totalPagoMensajero: "1500.00",
        }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // Hay 9000 recibidos, pero ninguno en efectivo: no se puede pagar nada en mano.
    expect(r.totalCentralDebeAgregado).toBe("1500.00");
    expect(r.totalNetoAgregado).toBe("9000.00"); // no se descuenta lo que no se pagó
  });

  it("sin zona -> neto y deuda en 0.00", async () => {
    const { service } = newService({ zonaSatelite: null });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalNetoAgregado).toBe("0.00");
    expect(r.totalCentralDebeAgregado).toBe("0.00");
    expect(typeof r.totalNetoAgregado).toBe("string"); // money-safe
  });
});

// --- Feature 56: ingreso de bodega por rechazos agregado (R17/R18) ---

describe("CierreBodegaService — ingreso de bodega por rechazos agregado (R17/R18)", () => {
  it("R17: listarConsolidacion expone totalIngresoBodegaRechazosAgregado = suma snapshot de los consolidables", async () => {
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () => [
        consolidableRow({ cierreDiaId: "cd1", totalIngresoBodegaRechazos: "6.00" }),
        consolidableRow({ cierreDiaId: "cd2", totalIngresoBodegaRechazos: "0.50" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalIngresoBodegaRechazosAgregado).toBe("6.50"); // suma exacta al centavo
    expect(typeof r.totalIngresoBodegaRechazosAgregado).toBe("string"); // R22
    // R20: separado del dinero recibido y del pago a mensajeros (no altera esos agregados).
    expect(r.totalesAgregados.general).toBe("30.00");
    expect(r.totalPagoMensajeroAgregado).toBe("0.00");
  });

  it("R17: sin zona -> totalIngresoBodegaRechazosAgregado 0.00", async () => {
    const { service } = newService({ zonaSatelite: null });
    const r = await service.listarConsolidacion(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalIngresoBodegaRechazosAgregado).toBe("0.00");
  });

  it("R18: solicitarCierreBodega congela en crearCierreBodega el ingreso agregado snapshoteado (misma tx)", async () => {
    const repo = fakeRepo({
      findCierresDiaConsolidables: vi.fn(async () => [
        consolidableRow({ cierreDiaId: "cd1", totalIngresoBodegaRechazos: "6.00" }),
        consolidableRow({ cierreDiaId: "cd2", totalIngresoBodegaRechazos: "0.50" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.solicitarCierreBodega(ADMIN_SATELITE);
    expect(r.status).toBe("ok");
    const arg = (repo.crearCierreBodega as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.totalIngresoBodegaRechazos).toBe("6.50"); // R18: snapshot agregado en la tx
  });
});
