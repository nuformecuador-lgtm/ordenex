import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletMensajeroFeedService } from "@/lib/services/WalletMensajeroFeedService";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { IngresoOrdenexDTO } from "@/lib/interfaces/services/ICierreDiaService";
import type {
  Alcance,
  CierreAdminResumenRow,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 38 — tests unit del CierresAdminService (dobles de repo/zona/orden/
// signedUrls, sin DB/red). Cubre R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,R11,R12,R13,R16.

const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const ZONA_SAT = "z-cartago";

function resumenRow(overrides: Partial<CierreAdminResumenRow> = {}): CierreAdminResumenRow {
  return {
    cierreId: "c1",
    mensajeroId: "m1",
    mensajeroNombre: "Ana Mensajera",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    destinoZonaNombre: "Central",
    totales: { efectivo: "10.00", simpe: "5.00", transferencia: "0.00", general: "15.00" },
    totalPagoMensajero: "5.00", // feature 39/R17: snapshot del pago al mensajero
    totalIngresoBodegaRechazos: "0.00", // feature 56/R16: snapshot del ingreso de bodega por rechazos
    solicitadoAt: "2026-07-12T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
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
    montoRecibido: "12.50",
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: null, // feature 39: snapshot (override para R16)
    ingresoBodegaRechazo: null, // feature 56: snapshot (override para R15)
    ...overrides,
  };
}

type Repo = ICierresAdminRepository;

function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    findCierresByAlcance: vi.fn(async () => [] as CierreAdminResumenRow[]),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    resolverCierre: vi.fn(async () => "updated" as const),
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

function newService(
  opts: { repo?: Repo; zonaSatelite?: string | null; signedUrls?: ISignedUrlProvider } = {},
) {
  const repo = opts.repo ?? fakeRepo();
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as Pick<IZonaRepository, "findCentralZonaId">;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () =>
      opts.zonaSatelite === undefined ? ZONA_SAT : opts.zonaSatelite,
    ),
  } as unknown as Pick<IOrdenRepository, "findUsuarioZonaId">;
  const signedUrls = opts.signedUrls ?? fakeSignedUrls();
  const service = new CierresAdminService(
    repo,
    zonaRepo as IZonaRepository,
    ordenRepo as IOrdenRepository,
    signedUrls,
  );
  return { service, repo, zonaRepo, ordenRepo, signedUrls };
}

// --- resolveAlcance / autorizacion (R1/R2/R3) ---

describe("CierresAdminService — autorizacion y alcance (R1/R2/R3)", () => {
  it("R1: rol invalido (mensajero) -> forbidden, sin consultar el repo", async () => {
    const { service, repo } = newService();
    const r = await service.listarCierresAdmin(MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.findCierresByAlcance).not.toHaveBeenCalled();
  });

  it("R2: maestro -> alcance bodega_central sin zona pasado al repo", async () => {
    const { service, repo } = newService();
    await service.listarCierresAdmin(MAESTRO);
    const alcance = (repo.findCierresByAlcance as ReturnType<typeof vi.fn>).mock.calls[0][0] as Alcance;
    expect(alcance).toEqual({ destinoTipo: "bodega_central", destinoZonaId: null });
  });

  it("R2: adminSatelite -> alcance bodega_satelite acotado a SU zona (ajeno excluido via el WHERE)", async () => {
    const { service, repo, ordenRepo } = newService();
    await service.listarCierresAdmin(ADMIN_SATELITE);
    expect(ordenRepo.findUsuarioZonaId).toHaveBeenCalledWith("adm-sat");
    const alcance = (repo.findCierresByAlcance as ReturnType<typeof vi.fn>).mock.calls[0][0] as Alcance;
    expect(alcance).toEqual({ destinoTipo: "bodega_satelite", destinoZonaId: ZONA_SAT });
  });

  it("R3: adminSatelite sin zona -> sinZona true, listas vacias, sin tocar el repo", async () => {
    const { service, repo } = newService({ zonaSatelite: null });
    const r = await service.listarCierresAdmin(ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.sinZona).toBe(true);
    expect(r.pendientes).toEqual([]);
    expect(r.historico).toEqual([]);
    expect(repo.findCierresByAlcance).not.toHaveBeenCalled();
  });
});

// --- listarCierresAdmin — particion + totales (R4/R5/R8/R9) ---

describe("CierresAdminService.listarCierresAdmin — particion y totales (R4/R5/R8/R9)", () => {
  it("R4/R5: parte pendientes (solicitado) del historico (aprobado/rechazado)", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [
        resumenRow({ cierreId: "a", estado: "solicitado" }),
        resumenRow({ cierreId: "b", estado: "aprobado", resueltoAt: "2026-07-12T12:00:00.000Z" }),
        resumenRow({ cierreId: "c", estado: "rechazado", motivoRechazo: "cuadre erroneo" }),
        resumenRow({ cierreId: "d", estado: "solicitado" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierresAdmin(MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.pendientes.map((c) => c.cierreId)).toEqual(["a", "d"]);
    expect(r.historico.map((c) => c.cierreId)).toEqual(["b", "c"]);
    expect(r.sinZona).toBe(false);
  });

  it("feature 41/R20: el vencido va a la cola de pendientes, diferenciado por su estado", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [
        resumenRow({ cierreId: "s", estado: "solicitado" }),
        resumenRow({ cierreId: "v", estado: "vencido" }), // creado por el corte
        resumenRow({ cierreId: "ap", estado: "aprobado", resueltoAt: "2026-07-12T12:00:00.000Z" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierresAdmin(MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // R20: solicitado y vencido en la cola (resolubles); aprobado al historico.
    expect(r.pendientes.map((c) => c.cierreId).sort()).toEqual(["s", "v"]);
    expect(r.historico.map((c) => c.cierreId)).toEqual(["ap"]);
    // el estado viaja en el resumen para que el frontend etiquete el vencido (R20).
    const vencido = r.pendientes.find((c) => c.cierreId === "v");
    expect(vencido?.estado).toBe("vencido");
  });

  it("R8/R9: los totales del resumen son el snapshot en STRING escala 2 (no recomputa)", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [
        resumenRow({
          cierreId: "a",
          totales: { efectivo: "100.50", simpe: "0.00", transferencia: "9.99", general: "110.49" },
        }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierresAdmin(MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    const c = r.pendientes[0];
    expect(c.totales).toEqual({
      efectivo: "100.50",
      simpe: "0.00",
      transferencia: "9.99",
      general: "110.49",
    });
    expect(typeof c.totales.general).toBe("string");
  });

  it("R17: el resumen expone totalPagoMensajero snapshot (string), separado de los totales", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [resumenRow({ totalPagoMensajero: "42.50" })]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierresAdmin(MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    const c = r.pendientes[0];
    expect(c.totalPagoMensajero).toBe("42.50"); // snapshot, sin recomputar
    expect(typeof c.totalPagoMensajero).toBe("string"); // R23
    // R21: no altera los totales de dinero recibido.
    expect(c.totales).toEqual({ efectivo: "10.00", simpe: "5.00", transferencia: "0.00", general: "15.00" });
  });

  it("R16: el resumen expone totalIngresoBodegaRechazos snapshot (string), separado de totales y pago mensajero", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [
        resumenRow({ totalPagoMensajero: "42.50", totalIngresoBodegaRechazos: "7.00" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierresAdmin(MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    const c = r.pendientes[0];
    expect(c.totalIngresoBodegaRechazos).toBe("7.00"); // snapshot, sin recomputar
    expect(typeof c.totalIngresoBodegaRechazos).toBe("string"); // R22
    // R20: no altera ni los totales de dinero recibido ni el pago al mensajero.
    expect(c.totalPagoMensajero).toBe("42.50");
    expect(c.totales).toEqual({ efectivo: "10.00", simpe: "5.00", transferencia: "0.00", general: "15.00" });
  });

  it("R16: listar NO muta (nunca invoca resolverCierre)", async () => {
    const repo = fakeRepo({
      findCierresByAlcance: vi.fn(async () => [resumenRow()]),
    });
    const { service } = newService({ repo });
    await service.listarCierresAdmin(MAESTRO);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});

// --- verCierreDetalle — detalle + evidencia firmada (R6/R7/R9/R13/R16) ---

describe("CierresAdminService.verCierreDetalle — ingreso y ganancia", () => {
  /** Desglose por orden como lo emite el repo (ya derivado del snapshot). */
  function conIngreso(over: Partial<IngresoOrdenexDTO>): IngresoOrdenexDTO {
    return {
      montoCobrar: null,
      cobraComision: false,
      esCentral: false,
      flete: null,
      ivaFlete: null,
      fleteDevolucion: null,
      ivaFleteDevolucion: null,
      comisionCod: null,
      ivaComisionCod: null,
      fleteConIva: null,
      fleteDevolucionConIva: null,
      comisionConIva: null,
      total: "0.00",
      tarifa: null,
      ...over,
    };
  }

  it("suma el ingreso por concepto y deriva la ganancia = bruto - pago al mensajero", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow({ totalPagoMensajero: "1500.00" }),
        gestiones: [
          gestionRow({
            gestionId: "a",
            resultado: "entregada",
            ingresoOrdenex: conIngreso({
              flete: "2500.00",
              ivaFlete: "325.00",
              comisionCod: "750.00",
              ivaComisionCod: "97.50",
              fleteConIva: "2825.00",
              comisionConIva: "847.50",
              total: "3672.50",
            }),
          }),
          gestionRow({
            gestionId: "b",
            resultado: "rechazada",
            ingresoOrdenex: conIngreso({
              fleteDevolucion: "1000.00",
              ivaFleteDevolucion: "130.00",
              fleteDevolucionConIva: "1130.00",
              total: "1130.00",
            }),
          }),
        ],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalesIngreso).toMatchObject({
      // Agrupados: lo que se pinta en el panel.
      fleteConIva: "2825.00",
      comisionConIva: "847.50",
      fleteDevolucionConIva: "1130.00",
      total: "4802.50", // 3672.50 + 1130.00
      // Detalle separado: sigue disponible para auditar cuánto de cada agrupado es IVA.
      flete: "2500.00",
      ivaFlete: "325.00",
      comisionCod: "750.00",
      ivaComisionCod: "97.50",
      fleteDevolucion: "1000.00",
      ivaFleteDevolucion: "130.00",
    });
    // La devolución también factura, así que entra en la ganancia.
    expect(r.ganancia).toBe("3302.50"); // 4802.50 - 1500.00
    expect(typeof r.ganancia).toBe("string"); // money-safe
  });

  it("la ganancia es negativa si el cierre no factura pero igual paga al mensajero", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow({ totalPagoMensajero: "1500.00" }),
        // Una reprogramación no aporta a ningún concepto.
        gestiones: [gestionRow({ gestionId: "a", resultado: "reprogramada" })],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalesIngreso.total).toBe("0.00");
    expect(r.ganancia).toBe("-1500.00");
  });
});

describe("CierresAdminService.verCierreDetalle — detalle y evidencia (R6/R7/R9/R13/R16)", () => {
  it("R6/R9: agrupa las gestiones por resultado con montos string escala 2", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow(),
        gestiones: [
          gestionRow({ gestionId: "a", resultado: "entregada", montoRecibido: "30.00", metodoPago: "SIMPE" }),
          gestionRow({
            gestionId: "b",
            resultado: "reprogramada",
            montoRecibido: null,
            metodoPago: null,
            motivo: "ausente",
            fechaReprogramacion: "2026-07-20",
          }),
          gestionRow({ gestionId: "c", resultado: "devuelta", montoRecibido: null, metodoPago: null }),
        ],
      })),
    });
    const { service } = newService({ repo });
    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada.map((g) => g.gestionId)).toEqual(["a"]);
    expect(r.grupos.reprogramada.map((g) => g.gestionId)).toEqual(["b"]);
    expect(r.grupos.devuelta.map((g) => g.gestionId)).toEqual(["c"]);
    expect(r.grupos.rechazada).toEqual([]);
    expect(r.grupos.entregada[0].montoRecibido).toBe("30.00"); // string escala 2
    expect(typeof r.grupos.entregada[0].montoRecibido).toBe("string");
    expect(r.grupos.reprogramada[0].fechaReprogramacion).toBe("2026-07-20");
  });

  it("R7: firma la evidencia en lote y expone SOLO la URL firmada, nunca el storage_path", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow(),
        gestiones: [
          gestionRow({
            gestionId: "a",
            resultado: "rechazada",
            montoRecibido: null,
            metodoPago: null,
            evidenciaStoragePath: "o1/rechazo.jpg",
          }),
        ],
      })),
    });
    const signedUrls = fakeSignedUrls();
    const { service } = newService({ repo, signedUrls });
    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(signedUrls.createSignedUrls).toHaveBeenCalledWith(["o1/rechazo.jpg"], expect.any(Number));
    const rechazada = r.grupos.rechazada[0];
    expect(rechazada.evidenciaUrl).toBe("https://signed/o1/rechazo.jpg");
    expect(rechazada).not.toHaveProperty("evidenciaStoragePath");
  });

  it("R8: la cabecera del detalle mantiene los totales snapshot del cierre", async () => {
    const cierre = resumenRow({
      totales: { efectivo: "1.00", simpe: "2.00", transferencia: "3.00", general: "6.00" },
    });
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({ cierre, gestiones: [] })),
    });
    const { service } = newService({ repo });
    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.cierre.totales).toEqual({ efectivo: "1.00", simpe: "2.00", transferencia: "3.00", general: "6.00" });
  });

  it("R16: cada gestion del detalle expone el pago al mensajero SNAPSHOTEADO (no recomputado)", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow({ totalPagoMensajero: "5.00" }),
        gestiones: [
          gestionRow({ gestionId: "a", resultado: "entregada", pagoMensajero: "5.00" }),
          gestionRow({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null, pagoMensajero: "0.00" }),
        ],
      })),
    });
    const { service } = newService({ repo });
    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada[0].pagoMensajero).toBe("5.00"); // snapshot leido de la columna
    expect(r.grupos.rechazada[0].pagoMensajero).toBe("0.00");
    expect(typeof r.grupos.entregada[0].pagoMensajero).toBe("string"); // R23
    // R17: la cabecera del detalle trae el total snapshot.
    expect(r.cierre.totalPagoMensajero).toBe("5.00");
  });

  it("R15: cada gestion rechazada del detalle expone el ingreso de bodega SNAPSHOTEADO (no recomputado)", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow({ totalIngresoBodegaRechazos: "3.00" }),
        gestiones: [
          gestionRow({ gestionId: "a", resultado: "entregada", ingresoBodegaRechazo: "0.00" }),
          gestionRow({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null, ingresoBodegaRechazo: "3.00" }),
        ],
      })),
    });
    const { service } = newService({ repo });
    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.rechazada[0].ingresoBodegaRechazo).toBe("3.00"); // snapshot leido de la columna
    expect(r.grupos.entregada[0].ingresoBodegaRechazo).toBe("0.00");
    expect(typeof r.grupos.rechazada[0].ingresoBodegaRechazo).toBe("string"); // R22
    // R16: la cabecera del detalle trae el total snapshot del ingreso de bodega.
    expect(r.cierre.totalIngresoBodegaRechazos).toBe("3.00");
  });

  it("R13: cierre fuera de alcance (repo devuelve null) -> no_encontrada", async () => {
    const repo = fakeRepo({ findCierreByIdEnAlcance: vi.fn(async () => null) });
    const { service } = newService({ repo });
    const r = await service.verCierreDetalle("c-ajeno", MAESTRO);
    expect(r.status).toBe("no_encontrada");
  });

  it("R1: rol invalido -> forbidden, sin consultar el repo", async () => {
    const { service, repo } = newService();
    const r = await service.verCierreDetalle("c1", MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.findCierreByIdEnAlcance).not.toHaveBeenCalled();
  });

  it("R13: adminSatelite sin zona -> no_encontrada, sin leakear (no consulta el repo)", async () => {
    const { service, repo } = newService({ zonaSatelite: null });
    const r = await service.verCierreDetalle("c1", ADMIN_SATELITE);
    expect(r.status).toBe("no_encontrada");
    expect(repo.findCierreByIdEnAlcance).not.toHaveBeenCalled();
  });

  it("R16: ver detalle NO muta (nunca invoca resolverCierre)", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({ cierre: resumenRow(), gestiones: [gestionRow()] })),
    });
    const { service } = newService({ repo });
    await service.verCierreDetalle("c1", MAESTRO);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});

// --- aprobar / rechazar (R10/R11/R12/R13/R14) ---

describe("CierresAdminService.aprobarCierre (R10/R12/R13)", () => {
  it("R10: aprobar cierre solicitado del alcance -> ok/aprobado; pasa alcance + resueltoPor", async () => {
    const repo = fakeRepo({ resolverCierre: vi.fn(async () => "updated" as const) });
    const { service } = newService({ repo });
    const r = await service.aprobarCierre("c1", MAESTRO);
    expect(r).toEqual({ status: "ok", cierreId: "c1", estado: "aprobado" });
    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      cierreId: "c1",
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro", // R14
      motivoRechazo: null,
      alcance: { destinoTipo: "bodega_central", destinoZonaId: null },
    });
  });

  it("R12: repo devuelve conflict -> conflict", async () => {
    const repo = fakeRepo({ resolverCierre: vi.fn(async () => "conflict" as const) });
    const { service } = newService({ repo });
    const r = await service.aprobarCierre("c1", MAESTRO);
    expect(r.status).toBe("conflict");
  });

  it("R13: repo devuelve fuera_de_alcance -> no_encontrada", async () => {
    const repo = fakeRepo({ resolverCierre: vi.fn(async () => "fuera_de_alcance" as const) });
    const { service } = newService({ repo });
    const r = await service.aprobarCierre("c1", MAESTRO);
    expect(r.status).toBe("no_encontrada");
  });

  it("R1: rol invalido -> forbidden, sin resolver", async () => {
    const { service, repo } = newService();
    const r = await service.aprobarCierre("c1", MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});

// --- feature 43/T11: aprobar CierreDia genera movimientos por tienda (end-to-end con el repo real) ---

describe("CierresAdminService.aprobarCierre — alimenta el ledger por tienda (feature 43: R5/R13)", () => {
  const TARIFA: TarifaVigente = {
    valorFlete: "1000.00",
    valorFleteGam: "1500.00",
    valorFleteDevuelto: "400.00",
    valorFleteDevueltoGam: "600.00",
    comisionCod: "5.00",
    ivaFlete: "13.00",
    ivaComisionCod: "13.00",
  };

  // Prisma doble: cierreDia.updateMany/count/findUnique + gestionOrden.findMany + createMany de
  // los 3 libros (42/43/44) + $transaction (tx === prisma). Stores para inspeccionar lo insertado
  // en el ledger por tienda, en el libro del pago por mensajero y en la caja 42.
  // `cierre`: snapshots 39/37 que consume el feed del pago al mensajero (feature 44).
  function buildStack(
    gestiones: unknown[],
    cierre: { mensajeroId: string; totalPagoMensajero: string; totalEfectivo: string } = {
      mensajeroId: "m1",
      totalPagoMensajero: "1000.00",
      totalEfectivo: "300.00",
    },
  ) {
    const tiendaRows: Array<Record<string, unknown>> = [];
    const mensajeroRows: Array<Record<string, unknown>> = [];
    const caja42Rows: Array<Record<string, unknown>> = [];
    const prisma = {
      cierreDia: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn(async () => ({
          mensajeroId: cierre.mensajeroId,
          totalPagoMensajero: new Prisma.Decimal(cierre.totalPagoMensajero),
          totalEfectivo: new Prisma.Decimal(cierre.totalEfectivo),
        })),
      },
      gestionOrden: {
        // Feature 69/R12/R13: de la gestion, los feeds solo toman lo que ES de la gestion.
        findMany: vi.fn().mockResolvedValue(
          (gestiones as GestionFixture[]).map((g, i) => ({
            ordenId: `o${i}`,
            resultado: g.resultado,
            montoRecibido: g.montoRecibido,
          })),
        ),
      },
      // Feature 69: el SNAPSHOT congelado de la orden, que es de donde derivan ahora los dos
      // feeds. Se construye del MISMO fixture: los importes de la 42/43 no cambian.
      cierreDetail: {
        findMany: vi.fn().mockResolvedValue(
          (gestiones as GestionFixture[]).map((g, i) => ({
            ordenId: `o${i}`,
            tiendaId: g.orden.tiendaId,
            montoCobrar: g.orden.montoCobrar,
            cobraComision: g.orden.cobraComision,
            esCentral: g.orden.zona.esCentral,
            tarifaId: "ta1",
            tarifaValorFlete: new Prisma.Decimal(TARIFA.valorFlete),
            tarifaValorFleteGam: new Prisma.Decimal(TARIFA.valorFleteGam),
            tarifaValorFleteDevuelto: new Prisma.Decimal(TARIFA.valorFleteDevuelto),
            tarifaValorFleteDevueltoGam: new Prisma.Decimal(TARIFA.valorFleteDevueltoGam),
            tarifaComisionCod: new Prisma.Decimal(TARIFA.comisionCod),
            tarifaIvaFlete: new Prisma.Decimal(TARIFA.ivaFlete),
            tarifaIvaComisionCod: new Prisma.Decimal(TARIFA.ivaComisionCod),
          })),
        ),
      },
      walletMovimiento: {
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          caja42Rows.push(...data);
          return { count: data.length };
        }),
      },
      walletTiendaMovimiento: {
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          tiendaRows.push(...data);
          return { count: data.length };
        }),
      },
      pagoMensajeroMovimiento: {
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          mensajeroRows.push(...data);
          return { count: data.length };
        }),
      },
    };
    const withTx = { ...prisma, $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)) };
    const repo = new CierresAdminRepository(
      withTx as unknown as PrismaClient,
      new WalletMovimientoRepository(withTx as unknown as PrismaClient),
      new WalletFeedService(),
      new WalletTiendaMovimientoRepository(withTx as unknown as PrismaClient),
      new WalletTiendaFeedService({ TIENDA_DEBITA_FLETE_DEVOLUCION: true }),
      new PagoMensajeroMovimientoRepository(withTx as unknown as PrismaClient),
      new WalletMensajeroFeedService(),
    );
    return { repo, prisma, tiendaRows, mensajeroRows, caja42Rows };
  }

  // Feature 69: forma del fixture que `buildStack` reparte entre gestion y snapshot.
  type GestionFixture = {
    resultado: string;
    montoRecibido: Prisma.Decimal | null;
    orden: {
      tiendaId: string;
      zonaId: string;
      montoCobrar: Prisma.Decimal;
      cobraComision: boolean;
      zona: { esCentral: boolean };
    };
  };

  function gestion(resultado: string, tiendaId: string, montoRecibido: string | null) {
    return {
      resultado,
      montoRecibido: montoRecibido === null ? null : new Prisma.Decimal(montoRecibido),
      orden: {
        tiendaId,
        zonaId: "z1",
        montoCobrar: new Prisma.Decimal("10000.00"),
        cobraComision: true,
        zona: { esCentral: false },
      },
    };
  }

  it("R5: aprobar un CierreDia inserta el credito COD + debitos por tienda (via el repo real)", async () => {
    const { repo, tiendaRows } = buildStack([
      gestion("entregada", "t1", "10000.00"),
      gestion("devuelta", "t2", null),
    ]);
    const { service } = newService({ repo });

    const r = await service.aprobarCierre("c1", MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c1", estado: "aprobado" });
    // t1 (entregada): credito cod_recaudado + debitos flete/iva_flete/comision/iva_comision.
    const t1 = tiendaRows.filter((m) => m.tiendaId === "t1");
    const t1cats = t1.map((m) => m.categoria);
    expect(t1cats).toEqual(expect.arrayContaining(["cod_recaudado", "flete", "iva_flete", "comision_cod", "iva_comision_cod"]));
    // t2 (devuelta, flag on): debitos de devolucion SIN credito (saldo negativo).
    const t2 = tiendaRows.filter((m) => m.tiendaId === "t2");
    const t2cats = t2.map((m) => m.categoria);
    expect(t2cats).toEqual(expect.arrayContaining(["flete_devolucion", "iva_flete_devolucion"]));
    expect(t2cats).not.toContain("cod_recaudado");
    // origen cierre_dia con el id del cierre; montos Prisma.Decimal en la fila.
    for (const m of tiendaRows) {
      expect(m.origenTipo).toBe("cierre_dia");
      expect(m.origenId).toBe("c1");
      expect(m.monto).toBeInstanceOf(Prisma.Decimal);
    }
  });

  it("R13: vencido->aprobado alimenta el ledger por tienda una sola vez", async () => {
    const { repo, prisma, tiendaRows } = buildStack([gestion("entregada", "t1", "5000.00")]);
    const { service } = newService({ repo });

    const r = await service.aprobarCierre("c-vencido", MAESTRO);

    expect(r.status).toBe("ok");
    expect(prisma.walletTiendaMovimiento.createMany).toHaveBeenCalledTimes(1); // una sola alimentacion
    expect(tiendaRows.some((m) => m.categoria === "cod_recaudado" && m.tiendaId === "t1")).toBe(true);
  });
});

// --- feature 44/T11: aprobar CierreDia genera el pago al mensajero + el egreso en la caja 42 ---

describe("CierresAdminService.aprobarCierre — alimenta el pago al mensajero (feature 44: R5/R12/R17)", () => {
  // Feature 69: este bloque ya no necesita una tarifa. El libro del pago al mensajero (44)
  // sale de los snapshots del `cierre_dia` y su cierre no lleva gestiones.
  function buildStack(cierre: { mensajeroId: string; totalPagoMensajero: string; totalEfectivo: string }) {
    const mensajeroRows: Array<Record<string, unknown>> = [];
    const caja42Rows: Array<Record<string, unknown>> = [];
    const prisma = {
      cierreDia: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn(async () => ({
          mensajeroId: cierre.mensajeroId,
          totalPagoMensajero: new Prisma.Decimal(cierre.totalPagoMensajero),
          totalEfectivo: new Prisma.Decimal(cierre.totalEfectivo),
        })),
      },
      gestionOrden: { findMany: vi.fn().mockResolvedValue([]) }, // el pago no depende de gestiones (snapshot)
      // Feature 69: cierre sin gestiones -> snapshot vacio. El libro del pago al mensajero
      // (44) sale de los snapshots del `cierre_dia`, no de `cierre_detail`: la 69 no lo toca.
      cierreDetail: { findMany: vi.fn().mockResolvedValue([]) },
      walletMovimiento: {
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          caja42Rows.push(...data);
          return { count: data.length };
        }),
      },
      walletTiendaMovimiento: { createMany: vi.fn(async () => ({ count: 0 })) },
      pagoMensajeroMovimiento: {
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          mensajeroRows.push(...data);
          return { count: data.length };
        }),
      },
    };
    const withTx = { ...prisma, $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)) };
    const repo = new CierresAdminRepository(
      withTx as unknown as PrismaClient,
      new WalletMovimientoRepository(withTx as unknown as PrismaClient),
      new WalletFeedService(),
      new WalletTiendaMovimientoRepository(withTx as unknown as PrismaClient),
      new WalletTiendaFeedService({ TIENDA_DEBITA_FLETE_DEVOLUCION: true }),
      new PagoMensajeroMovimientoRepository(withTx as unknown as PrismaClient),
      new WalletMensajeroFeedService(),
    );
    return { repo, prisma, mensajeroRows, caja42Rows };
  }

  it("R5/R17: E<P -> devengo=P + pago=E en el libro; egreso egreso_pago_mensajero=P en la caja 42", async () => {
    const { repo, mensajeroRows, caja42Rows } = buildStack({ mensajeroId: "m1", totalPagoMensajero: "1000.00", totalEfectivo: "300.00" });
    const { service } = newService({ repo });

    const r = await service.aprobarCierre("c1", MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c1", estado: "aprobado" });
    // Libro del pago por mensajero (via el repo real): devengo=1000, pago=300.
    const byCat = Object.fromEntries(mensajeroRows.map((m) => [m.categoria, m]));
    expect((byCat.pago_devengado.monto as Prisma.Decimal).toFixed(2)).toBe("1000.00");
    expect((byCat.pago_efectivo.monto as Prisma.Decimal).toFixed(2)).toBe("300.00");
    for (const m of mensajeroRows) {
      expect(m.mensajeroId).toBe("m1");
      expect(m.origenTipo).toBe("cierre_dia");
      expect(m.origenId).toBe("c1");
      expect(m.monto).toBeInstanceOf(Prisma.Decimal);
    }
    // R17 (Qa): egreso egreso_pago_mensajero=P (1000) en la caja 42.
    const egreso = caja42Rows.find((m) => m.categoria === "egreso_pago_mensajero");
    expect(egreso).toBeDefined();
    expect((egreso!.monto as Prisma.Decimal).toFixed(2)).toBe("1000.00");
    expect(egreso!.tipo).toBe("egreso");
    expect(egreso!.origenTipo).toBe("cierre_dia");
    expect(egreso!.origenId).toBe("c1");
  });

  it("R10: P=0 (cierre sin entregas que paguen) -> NI libro NI egreso en la caja 42", async () => {
    const { repo, mensajeroRows, caja42Rows } = buildStack({ mensajeroId: "m1", totalPagoMensajero: "0.00", totalEfectivo: "5000.00" });
    const { service } = newService({ repo });

    const r = await service.aprobarCierre("c1", MAESTRO);

    expect(r.status).toBe("ok");
    expect(mensajeroRows).toEqual([]);
    expect(caja42Rows.some((m) => m.categoria === "egreso_pago_mensajero")).toBe(false);
  });

  it("R12: vencido->aprobado alimenta el pago al mensajero una sola vez", async () => {
    const { repo, prisma, mensajeroRows } = buildStack({ mensajeroId: "m1", totalPagoMensajero: "800.00", totalEfectivo: "800.00" });
    const { service } = newService({ repo });

    const r = await service.aprobarCierre("c-vencido", MAESTRO);

    expect(r.status).toBe("ok");
    expect(prisma.pagoMensajeroMovimiento.createMany).toHaveBeenCalledTimes(1); // una sola alimentacion
    // E=P -> pagado=P, pendiente=0 (solo devengo + pago, sin cuenta por pagar).
    expect(mensajeroRows.map((m) => m.categoria).sort()).toEqual(["pago_devengado", "pago_efectivo"]);
  });
});

describe("CierresAdminService.rechazarCierre (R11/R12/R13/R14)", () => {
  it("R11: rechazo sin motivo (vacio/espacios) -> validation_error, sin resolver", async () => {
    const repo = fakeRepo();
    const { service } = newService({ repo });
    const r = await service.rechazarCierre("c1", "   ", MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors.motivo).toBeDefined();
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("R11/R14: rechazo con motivo -> ok/rechazado; persiste motivo trim + resueltoPor", async () => {
    const repo = fakeRepo({ resolverCierre: vi.fn(async () => "updated" as const) });
    const { service } = newService({ repo });
    const r = await service.rechazarCierre("c1", "  cuadre no coincide  ", MAESTRO);
    expect(r).toEqual({ status: "ok", cierreId: "c1", estado: "rechazado" });
    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      nuevoEstado: "rechazado",
      resueltoPor: "adm-maestro", // R14
      motivoRechazo: "cuadre no coincide", // trim aplicado
    });
  });

  it("R12: repo devuelve conflict -> conflict", async () => {
    const repo = fakeRepo({ resolverCierre: vi.fn(async () => "conflict" as const) });
    const { service } = newService({ repo });
    const r = await service.rechazarCierre("c1", "motivo", MAESTRO);
    expect(r.status).toBe("conflict");
  });

  it("R13: repo devuelve fuera_de_alcance -> no_encontrada", async () => {
    const repo = fakeRepo({ resolverCierre: vi.fn(async () => "fuera_de_alcance" as const) });
    const { service } = newService({ repo });
    const r = await service.rechazarCierre("c1", "motivo", MAESTRO);
    expect(r.status).toBe("no_encontrada");
  });

  it("R1: rol invalido -> forbidden, sin resolver", async () => {
    const { service, repo } = newService();
    const r = await service.rechazarCierre("c1", "motivo", MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});
