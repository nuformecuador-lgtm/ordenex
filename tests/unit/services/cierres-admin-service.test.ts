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
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import { conPagos } from "@/tests/fixtures/cierre-pagos";

// Feature 38 — tests unit del CierresAdminService (dobles de repo/zona/orden/
// signedUrls, sin DB/red). Cubre R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,R11,R12,R13,R16.

const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "adm-admin", rol: "admin" }; // feature 94: paridad con maestro
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
  // Feature 212/T9: el desglose es OBLIGATORIO en la fila. Por defecto se deriva del par
  // escalar (UNA linea, igual que el backfill), asi que los casos previos no cambian; un
  // caso que quiera un cobro MIXTO pasa sus propias lineas en `overrides.pagos`.
  const { pagos, ...resto } = overrides;
  const fila: Omit<CierreGestionPendienteRow, "pagos"> = {
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
    esRechazoSla: false, // feature 102: clasificacion SLA/manual (override para R8/R9)
    // Feature 158/R9/R19: campos POR RAMA del incidente. `null` por defecto en el resto
    // de resultados; los casos del incidente los sobreescriben.
    causaIncidente: null,
    indemnizacion: null,
    ...resto,
  };
  return conPagos(fila, pagos);
}

type Repo = ICierresAdminRepository;

function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    findCierresByAlcance: vi.fn(async () => [] as CierreAdminResumenRow[]),
    // Feature 170 (T I.1): el historico paginado vive en su propia suite (*-paginado).
    findHistoricoPaginado: vi.fn(async () => ({ items: [] as CierreAdminResumenRow[], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [] as CierreAdminResumenRow[], total: 0 })),
    // Feature 184 (T D.1): los dos CONJUNTOS de la descarga viven en su propia suite
    // (`cierres-admin-completo.test.ts`); aqui solo hace falta que existan.
    findHistoricoCompleto: vi.fn(async () => [] as CierreAdminResumenRow[]),
    findColaCompleta: vi.fn(async () => [] as CierreAdminResumenRow[]),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    resolverCierre: vi.fn(async () => "updated" as const),
    // Feature 111/R16: válvula de escape (default = updated).
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
    // Feature 158/R19: por defecto el cierre NO tiene incidentes -> cobertura vacia, camino
    // de la 38 intacto (R36). Los casos de la 158 lo sobreescriben.
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    findCatalogoFiltros: vi.fn(async () => ({ zonas: [], mensajeros: [] })),
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

// Feature 109 (T3.1): ids del catalogo que `aprobarCierre` resuelve para la config de liberacion.
const ESTATUS_IDS: Record<string, string | null> = {
  sin_gestionar: "s-sin-gestionar",
  en_bodega_central: "s-en-bodega",
  en_bodega_satelite: "s-en-bodega-sat",
};

function newService(
  opts: {
    repo?: Repo;
    zonaSatelite?: string | null;
    signedUrls?: ISignedUrlProvider;
    estatusIds?: Record<string, string | null>; // feature 109: override para el defensivo (seed pendiente)
  } = {},
) {
  const repo = opts.repo ?? fakeRepo();
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as Pick<IZonaRepository, "findCentralZonaId">;
  const estatusIds = opts.estatusIds ?? ESTATUS_IDS;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () =>
      opts.zonaSatelite === undefined ? ZONA_SAT : opts.zonaSatelite,
    ),
    // Feature 109/T3.1: resuelve sin_gestionar/en_bodega_central/en_bodega_satelite para la liberacion.
    findEstatusIdByValue: vi.fn(async (v: string) => estatusIds[v] ?? null),
  } as unknown as Pick<IOrdenRepository, "findUsuarioZonaId" | "findEstatusIdByValue">;
  const signedUrls = opts.signedUrls ?? fakeSignedUrls();
  // Feature 172 (T C.2): lectura de los pagos ya registrados para derivar el pendiente de los
  // cierres APROBADOS. Este doble no tiene ninguno; la derivacion con dinero de verdad se mide
  // en `tests/unit/services/cierres-admin-pendiente.test.ts`.
  const liquidacionRepo = {
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
    obtenerCierreParaPago: vi.fn(async () => null),
  };
  const service = new CierresAdminService(
    repo,
    zonaRepo as IZonaRepository,
    ordenRepo as IOrdenRepository,
    signedUrls,
    liquidacionRepo,
  );
  return { service, repo, zonaRepo, ordenRepo, signedUrls, liquidacionRepo };
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

  it("feature 94: admin -> MISMO alcance bodega_central que maestro (sin zona)", async () => {
    const { service, repo } = newService();
    await service.listarCierresAdmin(ADMIN);
    const alcance = (repo.findCierresByAlcance as ReturnType<typeof vi.fn>).mock.calls[0][0] as Alcance;
    expect(alcance).toEqual({ destinoTipo: "bodega_central", destinoZonaId: null });
  });

  it("feature 94: admin puede aprobar/rechazar como maestro (alcance bodega_central)", async () => {
    const repo = fakeRepo({ resolverCierre: vi.fn(async () => "updated" as const) });
    const { service } = newService({ repo });
    const rAprobar = await service.aprobarCierre("c1", ADMIN);
    expect(rAprobar).toEqual({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "0.00", // feature 172/T C.2
    });
    const rRechazar = await service.rechazarCierre("c1", "motivo", ADMIN);
    expect(rRechazar).toEqual({ status: "ok", cierreId: "c1", estado: "rechazado" });
    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.alcance).toEqual({ destinoTipo: "bodega_central", destinoZonaId: null });
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
          gestionRow({ gestionId: "a", resultado: "entregada", montoRecibido: "30.00", metodoPago: "SINPE" }),
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

// --- feature 102: desglose SLA/manual del ingreso de bodega por rechazos (R5/R6/R7/R8/R10/R16) ---

describe("CierresAdminService.verCierreDetalle — desglose SLA/manual (feature 102)", () => {
  // Cierre con un rechazo SLA (cron 99) y un rechazo manual (mensajero), con el snapshot del
  // total del cierre YA congelado a la suma de ambos.
  function repoConMezcla() {
    return fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow({ totalIngresoBodegaRechazos: "5.00" }),
        gestiones: [
          gestionRow({
            gestionId: "sla",
            resultado: "rechazada",
            montoRecibido: null,
            metodoPago: null,
            ingresoBodegaRechazo: "3.00",
            esRechazoSla: true, // escalado por el cron SLA (99)
          }),
          gestionRow({
            gestionId: "man",
            resultado: "rechazada",
            montoRecibido: null,
            metodoPago: null,
            ingresoBodegaRechazo: "2.00",
            esRechazoSla: false, // rechazo manual del mensajero
          }),
        ],
      })),
    });
  }

  it("R8: expone el subtotal SLA separado del manual junto al total del cierre", async () => {
    const { service } = newService({ repo: repoConMezcla() });
    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.desgloseIngresoBodegaRechazos).toEqual({ sla: "3.00", manual: "2.00", total: "5.00" });
    expect(typeof r.desgloseIngresoBodegaRechazos.sla).toBe("string"); // R18
    expect(typeof r.desgloseIngresoBodegaRechazos.manual).toBe("string");
  });

  it("R9: cada gestion rechazada del detalle viaja marcada SLA/manual (esRechazoSla)", async () => {
    const { service } = newService({ repo: repoConMezcla() });
    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    const byId = Object.fromEntries(r.grupos.rechazada.map((g) => [g.gestionId, g.esRechazoSla]));
    expect(byId.sla).toBe(true);
    expect(byId.man).toBe(false);
  });

  it("R5: subtotal SLA + subtotal manual === total del cierre (money-safe, sin perder centavos)", async () => {
    const { service } = newService({ repo: repoConMezcla() });
    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    const d = r.desgloseIngresoBodegaRechazos;
    expect(new Prisma.Decimal(d.sla).plus(d.manual).toFixed(2)).toBe(d.total);
  });

  it("R6: el total del desglose es el SNAPSHOT del cierre, LEIDO (no recomputado)", async () => {
    // El snapshot (7.00) NO coincide con la suma de las gestiones (5.00): el service lo LEE tal
    // cual, no lo re-suma. Asi se prueba que R6 (no altera el total_ingreso_bodega_rechazos) se
    // cumple aunque las gestiones no cuadren (cierre pre-migracion / dato historico).
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow({
          totales: { efectivo: "10.00", simpe: "5.00", transferencia: "0.00", general: "15.00" },
          totalPagoMensajero: "5.00",
          totalIngresoBodegaRechazos: "7.00",
        }),
        gestiones: [
          gestionRow({ gestionId: "sla", resultado: "rechazada", montoRecibido: null, metodoPago: null, ingresoBodegaRechazo: "3.00", esRechazoSla: true }),
          gestionRow({ gestionId: "man", resultado: "rechazada", montoRecibido: null, metodoPago: null, ingresoBodegaRechazo: "2.00", esRechazoSla: false }),
        ],
      })),
    });
    const { service } = newService({ repo });
    const r = await service.verCierreDetalle("c1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.desgloseIngresoBodegaRechazos.total).toBe("7.00"); // snapshot leido
    // R6: no altera los totales de dinero recibido, ni el pago al mensajero, ni el total 56.
    expect(r.cierre.totales).toEqual({ efectivo: "10.00", simpe: "5.00", transferencia: "0.00", general: "15.00" });
    expect(r.cierre.totalPagoMensajero).toBe("5.00");
    expect(r.cierre.totalIngresoBodegaRechazos).toBe("7.00");
  });

  it("R16: el flujo de detalle NO muta (nunca invoca resolverCierre -> sin movimiento de wallet/caja)", async () => {
    const repo = repoConMezcla();
    const { service } = newService({ repo });
    await service.verCierreDetalle("c1", MAESTRO);
    // resolverCierre es el UNICO camino que alimenta wallet/caja (al aprobar); leer el detalle
    // jamas lo toca.
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("R7: el desglose es estable (misma entrada inmutable -> misma salida), sin resolver tarifa", async () => {
    // El detalle admin no recibe tarifa (el servicio no la resuelve): el desglose sale del
    // snapshot congelado + la clasificacion inmutable, asi que dos lecturas coinciden.
    const { service } = newService({ repo: repoConMezcla() });
    const r1 = await service.verCierreDetalle("c1", MAESTRO);
    const r2 = await service.verCierreDetalle("c1", MAESTRO);
    if (r1.status !== "ok" || r2.status !== "ok") throw new Error("esperaba ok");
    expect(r1.desgloseIngresoBodegaRechazos).toEqual(r2.desgloseIngresoBodegaRechazos);
  });

  it("R10: el adminSatelite recibe el MISMO desglose por el mismo camino (sin pantalla nueva)", async () => {
    const { service, repo } = newService({ repo: repoConMezcla() });
    const r = await service.verCierreDetalle("c1", ADMIN_SATELITE);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.desgloseIngresoBodegaRechazos).toEqual({ sla: "3.00", manual: "2.00", total: "5.00" });
    // El alcance satelite viajo al repo por el MISMO metodo `findCierreByIdEnAlcance`.
    const alcance = (repo.findCierreByIdEnAlcance as ReturnType<typeof vi.fn>).mock.calls[0][1] as Alcance;
    expect(alcance).toEqual({ destinoTipo: "bodega_satelite", destinoZonaId: ZONA_SAT });
  });
});

// --- aprobar / rechazar (R10/R11/R12/R13/R14) ---

describe("CierresAdminService.aprobarCierre (R10/R12/R13)", () => {
  it("R10: aprobar cierre solicitado del alcance -> ok/aprobado; pasa alcance + resueltoPor", async () => {
    const repo = fakeRepo({ resolverCierre: vi.fn(async () => "updated" as const) });
    const { service } = newService({ repo });
    const r = await service.aprobarCierre("c1", MAESTRO);
    expect(r).toEqual({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "0.00", // feature 172/T C.2
    });
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

// Feature 109 — la APROBACION pasa la config de LIBERACION de `sin_gestionar` (R16/R20); el RECHAZO no.
describe("Feature 109 · aprobarCierre — config de liberación de `sin_gestionar` (R16/R20)", () => {
  it("R16: resuelve los estatus destino (sin_gestionar/en_bodega_central/satelite) + zona central y los pasa", async () => {
    const repo = fakeRepo({ resolverCierre: vi.fn(async () => "updated" as const) });
    const { service, ordenRepo } = newService({ repo });

    await service.aprobarCierre("c1", MAESTRO);

    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.liberacionSinGestionar).toEqual({
      sinGestionarEstatusId: "s-sin-gestionar",
      enBodegaEstatusId: "s-en-bodega",
      enBodegaSateliteEstatusId: "s-en-bodega-sat",
      centralZonaId: "z-central",
    });
    expect(ordenRepo.findEstatusIdByValue).toHaveBeenCalledWith("sin_gestionar");
  });

  it("R16 defensivo: catálogo sin `sin_gestionar` (seed pendiente) -> liberacionSinGestionar undefined", async () => {
    const repo = fakeRepo({ resolverCierre: vi.fn(async () => "updated" as const) });
    const { service } = newService({
      repo,
      estatusIds: { sin_gestionar: null, en_bodega_central: "s-b", en_bodega_satelite: "s-bs" },
    });

    await service.aprobarCierre("c1", MAESTRO);

    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.liberacionSinGestionar).toBeUndefined();
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
      // Feature 109/R20: cierre NORMAL (sin ordenes `sin_gestionar`) -> la liberacion afecta 0 filas.
      orden: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      gestionOrden: {
        // Feature 69/R12/R13: de la gestion, los feeds solo toman lo que ES de la gestion.
        // Feature 158: el doble HONRA `where.resultado` porque ahora hay DOS consumidores con
        // predicados distintos — los feeds 42/43/44 (sin filtro) y la guardia de cobertura de
        // indemnizaciones + su feed (`resultado: "incidente"`). Sin honrarlo, la guardia veria
        // gestiones `entregada` como si fueran incidentes.
        findMany: vi.fn(async (args?: { where?: { resultado?: string } }) =>
          (gestiones as GestionFixture[])
            .map((g, i) => ({
              id: `g${i}`,
              ordenId: `o${i}`,
              resultado: g.resultado,
              montoRecibido: g.montoRecibido,
              indemnizacion: null,
            }))
            .filter((g) =>
              args?.where?.resultado === undefined ? true : g.resultado === args.where.resultado,
            ),
        ),
        updateMany: vi.fn(async () => ({ count: 1 })),
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
        // Feature 173/T B.2: el feed del contra-entrega LEE del ledger lo que el feed de la 43
        // acaba de escribir. El doble filtra por el `where` recibido, como Postgres.
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          tiendaRows
            .filter((m) => Object.entries(where).every(([k, v]) => m[k] === v))
            .map((m) => ({ monto: m.monto })),
        ),
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
      // Feature 158: feed del egreso de indemnizacion (real: sin incidentes devuelve []).
      new WalletIndemnizacionFeedService(),
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

    expect(r).toEqual({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "0.00", // feature 172/T C.2
    });
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
      // Feature 109/R20: cierre NORMAL -> la liberacion de `sin_gestionar` no encuentra ordenes.
      orden: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
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
      // Feature 158: feed del egreso de indemnizacion (real: sin incidentes devuelve []).
      new WalletIndemnizacionFeedService(),
    );
    return { repo, prisma, mensajeroRows, caja42Rows };
  }

  it("R5/R17: E<P -> devengo=P + pago=E en el libro; egreso egreso_pago_mensajero=P en la caja 42", async () => {
    const { repo, mensajeroRows, caja42Rows } = buildStack({ mensajeroId: "m1", totalPagoMensajero: "1000.00", totalEfectivo: "300.00" });
    const { service } = newService({ repo });

    const r = await service.aprobarCierre("c1", MAESTRO);

    expect(r).toEqual({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "0.00", // feature 172/T C.2
    });
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
    // Feature 109/R27: rechazar conserva `estado:'rechazado'` (escritura SIN cambio) y NO libera
    // `sin_gestionar` -> NO pasa la config de liberacion (solo la aprobacion lo hace, R16).
    expect(arg.liberacionSinGestionar).toBeUndefined();
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

// --- feature 111: VÁLVULA DE ESCAPE (R16/R17/R18) ---

describe("CierresAdminService.forzarSolicitudVencido (feature 111/R16/R17/R18)", () => {
  it("R16: maestro destraba un vencido de su alcance -> ok/solicitado; pasa el alcance al repo", async () => {
    const repo = fakeRepo({ forzarSolicitudVencido: vi.fn(async () => "updated" as const) });
    const { service } = newService({ repo });

    const r = await service.forzarSolicitudVencido("c-venc", MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-venc", estado: "solicitado" });
    const [cierreId, alcance] = (repo.forzarSolicitudVencido as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(cierreId).toBe("c-venc");
    expect(alcance).toEqual({ destinoTipo: "bodega_central", destinoZonaId: null });
  });

  it("R16: adminSatelite -> la válvula queda acotada a SU zona (alcance bodega_satelite)", async () => {
    const repo = fakeRepo({ forzarSolicitudVencido: vi.fn(async () => "updated" as const) });
    const { service } = newService({ repo });

    await service.forzarSolicitudVencido("c-venc", ADMIN_SATELITE);

    const alcance = (repo.forzarSolicitudVencido as ReturnType<typeof vi.fn>).mock.calls[0][1] as Alcance;
    expect(alcance).toEqual({ destinoTipo: "bodega_satelite", destinoZonaId: ZONA_SAT });
  });

  it("R16: repo conflict (ya no es vencido / carrera) -> conflict", async () => {
    const repo = fakeRepo({ forzarSolicitudVencido: vi.fn(async () => "conflict" as const) });
    const { service } = newService({ repo });
    const r = await service.forzarSolicitudVencido("c-venc", MAESTRO);
    expect(r.status).toBe("conflict");
  });

  it("R16: repo fuera_de_alcance (otra bodega/zona) -> no_encontrada", async () => {
    const repo = fakeRepo({ forzarSolicitudVencido: vi.fn(async () => "fuera_de_alcance" as const) });
    const { service } = newService({ repo });
    const r = await service.forzarSolicitudVencido("c-ajeno", MAESTRO);
    expect(r.status).toBe("no_encontrada");
  });

  it("R1: rol no admin (mensajero) -> forbidden, sin tocar el repo", async () => {
    const { service, repo } = newService();
    const r = await service.forzarSolicitudVencido("c-venc", MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.forzarSolicitudVencido).not.toHaveBeenCalled();
  });

  it("R13: adminSatelite sin zona -> no_encontrada, sin tocar el repo", async () => {
    const { service, repo } = newService({ zonaSatelite: null });
    const r = await service.forzarSolicitudVencido("c-venc", ADMIN_SATELITE);
    expect(r.status).toBe("no_encontrada");
    expect(repo.forzarSolicitudVencido).not.toHaveBeenCalled();
  });

  it("R18: la válvula deja el cierre en `solicitado` (sigue bloqueante); NO lo aprueba directo", async () => {
    // `vencido -> solicitado` NO desbloquea: el estado resultante SIGUE siendo bloqueante
    // (findMensajerosBloqueados incluye `solicitado`). El desbloqueo llega al APROBARLO luego.
    const repo = fakeRepo({ forzarSolicitudVencido: vi.fn(async () => "updated" as const) });
    const { service } = newService({ repo });
    const r = await service.forzarSolicitudVencido("c-venc", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.estado).toBe("solicitado"); // no `aprobado`
    // La válvula NO resuelve: no invoca resolverCierre (no mueve dinero, R21).
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Feature 158 (T1.10, R18) — el detalle del ADMIN agrupa el `incidente` aparte.
// ============================================================================

describe("Feature 158 · verCierreDetalle — el incidente es un grupo PROPIO (R18)", () => {
  it("R18: la gestion `incidente` cae en `grupos.incidente` y no se mezcla con las otras", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow(),
        gestiones: [
          gestionRow({ gestionId: "g1", resultado: "entregada" }),
          gestionRow({
            gestionId: "g-inc",
            ordenId: "o2",
            resultado: "incidente",
            montoRecibido: null,
            metodoPago: null,
            motivo: "caja aplastada",
          }),
        ],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierreDetalle("c1", MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    // Las CINCO claves siempre presentes (el grupo vacio no desaparece del contrato).
    expect(Object.keys(r.grupos).sort()).toEqual(
      ["devuelta", "entregada", "incidente", "rechazada", "reprogramada"].sort(),
    );
    expect(r.grupos.incidente.map((g) => g.gestionId)).toEqual(["g-inc"]);
    expect(r.grupos.entregada.map((g) => g.gestionId)).toEqual(["g1"]);
  });

  it("R17: un incidente NO aporta ingreso de Ordenex a los totales del cierre", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow({ totalPagoMensajero: "0.00" }),
        gestiones: [
          gestionRow({
            gestionId: "g-inc",
            resultado: "incidente",
            montoRecibido: null,
            metodoPago: null,
            // El repo deriva el desglose con `derivarIngresoOrden`, que para `incidente`
            // devuelve {} -> todos los conceptos en null y el total en 0.00.
            ingresoOrdenex: {
              montoCobrar: "50000.00",
              cobraComision: true,
              esCentral: true,
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
            },
          }),
        ],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierreDetalle("c1", MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalesIngreso.total).toBe("0.00");
    expect(r.totalesIngreso.fleteConIva).toBe("0.00");
    expect(r.totalesIngreso.comisionConIva).toBe("0.00");
  });
});

describe("Feature 158 · verCierreDetalle — la causa y el monto llegan al DTO (R34)", () => {
  it("R34: el detalle del admin expone `causaIncidente` e `indemnizacion` por gestión", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow({ estado: "aprobado" }),
        gestiones: [
          gestionRow({
            gestionId: "g-inc",
            resultado: "incidente",
            montoRecibido: null,
            metodoPago: null,
            motivo: "caja aplastada",
            causaIncidente: "danado",
            indemnizacion: "12500.75",
          }),
        ],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierreDetalle("c1", MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    const inc = r.grupos.incidente[0];
    // Sin la causa, el admin decide el monto de una indemnización sin saber si el paquete se
    // rompió o se lo robaron: es justo lo que R34 exige mostrar.
    expect(inc.causaIncidente).toBe("danado");
    // Money-safe: STRING de extremo a extremo.
    expect(inc.indemnizacion).toBe("12500.75");
    expect(typeof inc.indemnizacion).toBe("string");
  });

  it("R19: mientras el cierre sigue `solicitado` el monto es `null` (no 0.00)", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow(), // `solicitado`
        gestiones: [
          gestionRow({
            gestionId: "g-inc",
            resultado: "incidente",
            montoRecibido: null,
            metodoPago: null,
            causaIncidente: "robado",
            indemnizacion: null,
          }),
        ],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierreDetalle("c1", MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    // `null` = «todavía no hay monto». "0.00" diría «se indemnizó con cero», que es otra cosa.
    expect(r.grupos.incidente[0].indemnizacion).toBeNull();
    // La causa SÍ existe desde el reporte: es lo que el admin necesita para decidir el monto.
    expect(r.grupos.incidente[0].causaIncidente).toBe("robado");
  });

  it("R35: las gestiones de los otros cuatro resultados llegan con los dos campos en `null`", async () => {
    const repo = fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow(),
        gestiones: [
          gestionRow({ gestionId: "g1", resultado: "entregada" }),
          gestionRow({ gestionId: "g2", resultado: "rechazada", motivo: "cliente rechazó" }),
        ],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierreDetalle("c1", MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    for (const g of [...r.grupos.entregada, ...r.grupos.rechazada]) {
      expect(g.causaIncidente).toBeNull();
      expect(g.indemnizacion).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------
// El comprobante se sirve AUNQUE el storage falle. Incidente de produccion (2026-07-29): una
// evidencia referenciada ya no estaba en el bucket, la firma lanzo y el detalle entero dejo de
// abrirse. Sin detalle no hay boton de aprobar/rechazar; sin aprobar, el mensajero sigue
// bloqueado; y con el bloqueado, la regla de zona impide asignar en TODA su zona. Una foto que
// falta no puede costar eso: las evidencias ilustran la decision, no son la decision.
// ---------------------------------------------------------------------------------------
describe("CierresAdminService.verCierreDetalle — el storage no puede bloquear la decision", () => {
  function repoConEvidencias() {
    return fakeRepo({
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow(),
        gestiones: [
          gestionRow({
            gestionId: "a",
            resultado: "entregada",
            evidenciaStoragePath: "o1/entregada.jpg",
          }),
        ],
      })),
    });
  }

  it("storage caido (la firma lanza) -> el detalle SIGUE abriendose, sin URL de evidencia", async () => {
    const signedUrls = fakeSignedUrls({
      createSignedUrls: vi.fn(async () => {
        throw new Error("fallo al firmar URLs de documentos: supabaseUrl is required");
      }),
    });
    const { service } = newService({ repo: repoConEvidencias(), signedUrls });

    const r = await service.verCierreDetalle("c1", MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.grupos.entregada[0]!.evidenciaUrl).toBeNull();
    // Y lo que decide el dinero sigue intacto: el comprobante no depende de las fotos.
    expect(r.grupos.entregada[0]!.gestionId).toBe("a");
  });

  it("evidencia que el storage no pudo firmar -> esa gestion queda sin URL, el resto igual", async () => {
    // El provider real ya omite lo que no puede firmar: aqui se simula ese mapa PARCIAL.
    const signedUrls = fakeSignedUrls({ createSignedUrls: vi.fn(async () => ({})) });
    const { service } = newService({ repo: repoConEvidencias(), signedUrls });

    const r = await service.verCierreDetalle("c1", MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.grupos.entregada[0]!.evidenciaUrl).toBeNull();
  });
});
