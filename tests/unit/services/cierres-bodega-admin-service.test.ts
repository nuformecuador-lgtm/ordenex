import { describe, it, expect, vi } from "vitest";
import { CierresBodegaAdminService } from "@/lib/services/CierresBodegaAdminService";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type {
  CierreBodegaDetalleCierreRow,
  ICierresBodegaAdminRepository,
} from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 40 — tests unit del CierresBodegaAdminService (lado maestro; dobles de
// repo/signedUrls, sin DB/red). Cubre R2 (rol), R11 (detalle por cierre_dia con grupos
// + totales), R12 (evidencia firmada), R13 (montos string, snapshot no recompute), R14
// (DTO no expone pago mensajero), R15 (cola + historico), R17 (rechazo sin/con motivo),
// R19 (inexistente -> no_encontrada), R20 (resueltoPor al repo), R23 (listar/detalle no muta).

const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

function bodegaResumenRow(
  overrides: Partial<CierreBodegaResumenRow> = {},
): CierreBodegaResumenRow {
  return {
    cierreBodegaId: "cb1",
    zonaId: "z-cartago",
    zonaNombre: "Cartago",
    solicitadoPorId: "adm-sat",
    solicitadoPorNombre: "Sara Satelite",
    estado: "solicitado",
    totales: { efectivo: "10.00", simpe: "5.00", transferencia: "0.00", general: "15.00" },
    totalPagoMensajero: "5.00", // feature 39/R20: snapshot agregado del pago a mensajeros
    totalIngresoBodegaRechazos: "0.00", // feature 56/R19: snapshot agregado del ingreso de bodega
    cantidadCierres: 2,
    solicitadoAt: "2026-07-12T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...overrides,
  };
}

function detalleCierreRow(
  overrides: Partial<CierreBodegaDetalleCierreRow> = {},
): CierreBodegaDetalleCierreRow {
  return {
    cierreDiaId: "cd1",
    mensajeroId: "m1",
    mensajeroNombre: "Ana Mensajera",
    totales: { efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" },
    totalPagoMensajero: "5.00", // feature 39/R20: snapshot del pago del cierre_dia
    totalIngresoBodegaRechazos: "0.00", // feature 56/R19: snapshot del ingreso del cierre_dia
    ...overrides,
  };
}

function gestionRow(overrides: Partial<CierreGestionPendienteRow> = {}): CierreGestionPendienteRow {
  return {
    gestionId: "g1",
    ordenId: "o1",
    numGuia: 10,
    numRemision: "REM-1",
    destinatario: "Ana",
    direccion: "Av 1",
    zonaNombre: "Cartago",
    provinciaNombre: "Cartago",
    cantonNombre: "Central",
    distritoNombre: "Oriental",
    producto: "Caja",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "10.00",
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: "5.00", // feature 39/R20: snapshot del pago de la gestion
    ingresoBodegaRechazo: "0.00", // feature 56/R19: snapshot del ingreso de la gestion
    ...overrides,
  };
}

type Repo = ICierresBodegaAdminRepository;

function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    findCierresBodega: vi.fn(async () => [] as CierreBodegaResumenRow[]),
    findCierreBodegaConDetalle: vi.fn(async () => null),
    resolverCierreBodega: vi.fn(async () => "updated" as const),
    ...overrides,
  };
}

function fakeSignedUrls(overrides: Partial<ISignedUrlProvider> = {}): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
    createSignedUrls: vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    ),
    ...overrides,
  };
}

function newService(opts: { repo?: Repo; signedUrls?: ISignedUrlProvider } = {}) {
  const repo = opts.repo ?? fakeRepo();
  const signedUrls = opts.signedUrls ?? fakeSignedUrls();
  const service = new CierresBodegaAdminService(repo, signedUrls);
  return { service, repo, signedUrls };
}

// --- autorizacion (R2) ---

describe("CierresBodegaAdminService — autorizacion (R2)", () => {
  it("R2: rol != maestro -> forbidden en las 4 operaciones, sin tocar el repo", async () => {
    for (const actor of [ADMIN_SATELITE, MENSAJERO]) {
      const { service, repo } = newService();
      expect((await service.listarCierresBodegaAdmin(actor)).status).toBe("forbidden");
      expect((await service.verCierreBodegaDetalle("cb1", actor)).status).toBe("forbidden");
      expect((await service.aprobarCierreBodega("cb1", actor)).status).toBe("forbidden");
      expect((await service.rechazarCierreBodega("cb1", "motivo", actor)).status).toBe("forbidden");
      expect(repo.findCierresBodega).not.toHaveBeenCalled();
      expect(repo.findCierreBodegaConDetalle).not.toHaveBeenCalled();
      expect(repo.resolverCierreBodega).not.toHaveBeenCalled();
    }
  });
});

// --- listar cola + historico (R15/R13/R23) ---

describe("CierresBodegaAdminService.listarCierresBodegaAdmin (R15/R13/R23)", () => {
  it("R15: parte pendientes (solicitado) del historico (aprobado/rechazado)", async () => {
    const repo = fakeRepo({
      findCierresBodega: vi.fn(async () => [
        bodegaResumenRow({ cierreBodegaId: "a", estado: "solicitado" }),
        bodegaResumenRow({ cierreBodegaId: "b", estado: "aprobado", resueltoAt: "2026-07-12T12:00:00.000Z" }),
        bodegaResumenRow({ cierreBodegaId: "c", estado: "rechazado", motivoRechazo: "cuadre" }),
        bodegaResumenRow({ cierreBodegaId: "d", estado: "solicitado" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierresBodegaAdmin(MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.pendientes.map((c) => c.cierreBodegaId)).toEqual(["a", "d"]);
    expect(r.historico.map((c) => c.cierreBodegaId)).toEqual(["b", "c"]);
  });

  it("R13: los totales del resumen son el snapshot STRING escala 2 (no recomputa)", async () => {
    const repo = fakeRepo({
      findCierresBodega: vi.fn(async () => [
        bodegaResumenRow({
          totales: { efectivo: "100.50", simpe: "0.00", transferencia: "9.99", general: "110.49" },
        }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierresBodegaAdmin(MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.pendientes[0].totales).toEqual({
      efectivo: "100.50",
      simpe: "0.00",
      transferencia: "9.99",
      general: "110.49",
    });
    expect(typeof r.pendientes[0].totales.general).toBe("string");
  });

  it("R23: listar NO muta (nunca invoca resolverCierreBodega)", async () => {
    const repo = fakeRepo({ findCierresBodega: vi.fn(async () => [bodegaResumenRow()]) });
    const { service } = newService({ repo });
    await service.listarCierresBodegaAdmin(MAESTRO);
    expect(repo.resolverCierreBodega).not.toHaveBeenCalled();
  });
});

// --- detalle agregado (R11/R12/R13/R14/R19/R23) ---

describe("CierresBodegaAdminService.verCierreBodegaDetalle (R11/R12/R13/R14/R19/R23)", () => {
  it("R11/R13: detalle por cierre_dia con gestiones agrupadas por resultado + totales snapshot", async () => {
    const repo = fakeRepo({
      findCierreBodegaConDetalle: vi.fn(async () => ({
        cierre: bodegaResumenRow({
          totales: { efectivo: "20.00", simpe: "0.00", transferencia: "0.00", general: "20.00" },
        }),
        cierresDia: [
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd1" }),
            gestiones: [
              gestionRow({ gestionId: "g1", resultado: "entregada", montoRecibido: "10.00" }),
              gestionRow({
                gestionId: "g2",
                resultado: "reprogramada",
                montoRecibido: null,
                metodoPago: null,
                motivo: "ausente",
              }),
            ],
          },
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd2", mensajeroId: "m2", mensajeroNombre: "Beto" }),
            gestiones: [gestionRow({ gestionId: "g3", resultado: "devuelta", montoRecibido: null, metodoPago: null })],
          },
        ],
      })),
    });
    const { service } = newService({ repo });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // cabecera: totales snapshot agregados (no recompute).
    expect(r.cierre.totales).toEqual({
      efectivo: "20.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "20.00",
    });
    // un elemento por cierre_dia.
    expect(r.cierres.map((c) => c.cierreDiaId)).toEqual(["cd1", "cd2"]);
    // grupos por resultado (4 claves siempre).
    expect(r.cierres[0].grupos.entregada.map((g) => g.gestionId)).toEqual(["g1"]);
    expect(r.cierres[0].grupos.reprogramada.map((g) => g.gestionId)).toEqual(["g2"]);
    expect(r.cierres[0].grupos.devuelta).toEqual([]);
    expect(r.cierres[0].grupos.rechazada).toEqual([]);
    expect(r.cierres[1].grupos.devuelta.map((g) => g.gestionId)).toEqual(["g3"]);
    // montos string escala 2.
    expect(r.cierres[0].grupos.entregada[0].montoRecibido).toBe("10.00");
    expect(typeof r.cierres[0].grupos.entregada[0].montoRecibido).toBe("string");
  });

  it("R12: firma en LOTE las evidencias de todos los cierre_dia; expone SOLO URL firmada, no el path", async () => {
    const repo = fakeRepo({
      findCierreBodegaConDetalle: vi.fn(async () => ({
        cierre: bodegaResumenRow(),
        cierresDia: [
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd1" }),
            gestiones: [
              gestionRow({ gestionId: "g1", resultado: "rechazada", montoRecibido: null, metodoPago: null, evidenciaStoragePath: "o1/r.jpg" }),
            ],
          },
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd2" }),
            gestiones: [
              gestionRow({ gestionId: "g2", resultado: "entregada", evidenciaStoragePath: "o2/e.jpg" }),
            ],
          },
        ],
      })),
    });
    const signedUrls = fakeSignedUrls();
    const { service } = newService({ repo, signedUrls });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // una sola llamada en lote con ambos paths.
    expect(signedUrls.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(signedUrls.createSignedUrls).toHaveBeenCalledWith(["o1/r.jpg", "o2/e.jpg"], expect.any(Number));
    const g1 = r.cierres[0].grupos.rechazada[0];
    expect(g1.evidenciaUrl).toBe("https://signed/o1/r.jpg");
    expect(g1).not.toHaveProperty("evidenciaStoragePath");
    expect(r.cierres[1].grupos.entregada[0].evidenciaUrl).toBe("https://signed/o2/e.jpg");
  });

  it("R20: el detalle expone el pago al mensajero snapshoteado por cierre_dia, por gestion y el agregado", async () => {
    const repo = fakeRepo({
      findCierreBodegaConDetalle: vi.fn(async () => ({
        cierre: bodegaResumenRow({ totalPagoMensajero: "12.00" }),
        cierresDia: [
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd1", totalPagoMensajero: "12.00" }),
            gestiones: [gestionRow({ gestionId: "g1", resultado: "entregada", pagoMensajero: "12.00" })],
          },
        ],
      })),
    });
    const { service } = newService({ repo });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // R20: agregado del cierre de bodega (cabecera).
    expect(r.cierre.totalPagoMensajero).toBe("12.00");
    // R20: por cada cierre_dia incluido.
    expect(r.cierres[0].totalPagoMensajero).toBe("12.00");
    // R20: por gestion (snapshot leido, no recomputado).
    expect(r.cierres[0].grupos.entregada[0].pagoMensajero).toBe("12.00");
    expect(typeof r.cierre.totalPagoMensajero).toBe("string"); // R23
  });

  it("R19: el detalle expone el ingreso de bodega por rechazos por cierre_dia y el agregado (snapshot)", async () => {
    const repo = fakeRepo({
      findCierreBodegaConDetalle: vi.fn(async () => ({
        cierre: bodegaResumenRow({ totalIngresoBodegaRechazos: "9.00" }),
        cierresDia: [
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd1", totalIngresoBodegaRechazos: "9.00" }),
            gestiones: [
              gestionRow({ gestionId: "g1", resultado: "rechazada", montoRecibido: null, metodoPago: null, ingresoBodegaRechazo: "3.00" }),
            ],
          },
        ],
      })),
    });
    const { service } = newService({ repo });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // R19: agregado del cierre de bodega (cabecera).
    expect(r.cierre.totalIngresoBodegaRechazos).toBe("9.00");
    // R19: por cada cierre_dia incluido (snapshot, sin recomputar).
    expect(r.cierres[0].totalIngresoBodegaRechazos).toBe("9.00");
    // R19: por gestion rechazada (snapshot leido).
    expect(r.cierres[0].grupos.rechazada[0].ingresoBodegaRechazo).toBe("3.00");
    expect(typeof r.cierre.totalIngresoBodegaRechazos).toBe("string"); // R22
  });

  it("R19: id inexistente (repo null) -> no_encontrada", async () => {
    const repo = fakeRepo({ findCierreBodegaConDetalle: vi.fn(async () => null) });
    const { service } = newService({ repo });
    const r = await service.verCierreBodegaDetalle("cb-x", MAESTRO);
    expect(r.status).toBe("no_encontrada");
  });

  it("R23: ver detalle NO muta (nunca invoca resolverCierreBodega)", async () => {
    const repo = fakeRepo({
      findCierreBodegaConDetalle: vi.fn(async () => ({
        cierre: bodegaResumenRow(),
        cierresDia: [{ resumen: detalleCierreRow(), gestiones: [gestionRow()] }],
      })),
    });
    const { service } = newService({ repo });
    await service.verCierreBodegaDetalle("cb1", MAESTRO);
    expect(repo.resolverCierreBodega).not.toHaveBeenCalled();
  });
});

// --- aprobar / rechazar (R16/R17/R18/R19/R20) ---

describe("CierresBodegaAdminService.aprobarCierreBodega (R16/R18/R19/R20)", () => {
  it("R16/R20: aprobar solicitado -> ok/aprobado; pasa resueltoPor + motivoRechazo null", async () => {
    const repo = fakeRepo({ resolverCierreBodega: vi.fn(async () => "updated" as const) });
    const { service } = newService({ repo });
    const r = await service.aprobarCierreBodega("cb1", MAESTRO);
    expect(r).toEqual({ status: "ok", cierreBodegaId: "cb1", estado: "aprobado" });
    const arg = (repo.resolverCierreBodega as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      id: "cb1",
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro", // R20
      motivoRechazo: null,
    });
  });

  it("R18: repo conflict -> conflict", async () => {
    const repo = fakeRepo({ resolverCierreBodega: vi.fn(async () => "conflict" as const) });
    const { service } = newService({ repo });
    expect((await service.aprobarCierreBodega("cb1", MAESTRO)).status).toBe("conflict");
  });

  it("R19: repo fuera_de_alcance -> no_encontrada", async () => {
    const repo = fakeRepo({ resolverCierreBodega: vi.fn(async () => "fuera_de_alcance" as const) });
    const { service } = newService({ repo });
    expect((await service.aprobarCierreBodega("cb1", MAESTRO)).status).toBe("no_encontrada");
  });
});

describe("CierresBodegaAdminService.rechazarCierreBodega (R17/R18/R19/R20)", () => {
  it("R17: rechazo sin motivo (vacio/espacios) -> validation_error, sin resolver", async () => {
    const { service, repo } = newService();
    const r = await service.rechazarCierreBodega("cb1", "   ", MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors.motivo).toBeDefined();
    expect(repo.resolverCierreBodega).not.toHaveBeenCalled();
  });

  it("R17/R20: rechazo con motivo -> ok/rechazado; persiste motivo trim + resueltoPor", async () => {
    const repo = fakeRepo({ resolverCierreBodega: vi.fn(async () => "updated" as const) });
    const { service } = newService({ repo });
    const r = await service.rechazarCierreBodega("cb1", "  cuadre no coincide  ", MAESTRO);
    expect(r).toEqual({ status: "ok", cierreBodegaId: "cb1", estado: "rechazado" });
    const arg = (repo.resolverCierreBodega as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      id: "cb1",
      nuevoEstado: "rechazado",
      resueltoPor: "adm-maestro", // R20
      motivoRechazo: "cuadre no coincide", // trim aplicado
    });
  });

  it("R18: repo conflict -> conflict", async () => {
    const repo = fakeRepo({ resolverCierreBodega: vi.fn(async () => "conflict" as const) });
    const { service } = newService({ repo });
    expect((await service.rechazarCierreBodega("cb1", "motivo", MAESTRO)).status).toBe("conflict");
  });

  it("R19: repo fuera_de_alcance -> no_encontrada", async () => {
    const repo = fakeRepo({ resolverCierreBodega: vi.fn(async () => "fuera_de_alcance" as const) });
    const { service } = newService({ repo });
    expect((await service.rechazarCierreBodega("cb1", "motivo", MAESTRO)).status).toBe("no_encontrada");
  });
});
