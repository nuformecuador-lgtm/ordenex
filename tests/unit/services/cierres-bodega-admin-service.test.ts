import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { CierresBodegaAdminService } from "@/lib/services/CierresBodegaAdminService";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type {
  CierreBodegaDetalleCierreRow,
  ICierresBodegaAdminRepository,
  ResolverCierreBodegaInput,
} from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IngresoOrdenexDTO } from "@/lib/interfaces/services/ICierreDiaService";
import { conPagos } from "@/tests/fixtures/cierre-pagos";
// Feature 393: el doble de la fila del repositorio deriva sus dos campos nuevos con las MISMAS
// funciones puras que usa el mapper real, para que un caso que cambie los snapshots no deje el
// doble diciendo un numero que el mapper nunca produciria.
import { efectivoCubreDescuentos, paraLaCentral } from "@/lib/utils/ingreso-ordenex";

// Feature 40 — tests unit del CierresBodegaAdminService (lado maestro; dobles de
// repo/signedUrls, sin DB/red). Cubre R2 (rol), R11 (detalle por cierre_dia con grupos
// + totales), R12 (evidencia firmada), R13 (montos string, snapshot no recompute), R14
// (DTO no expone pago mensajero), R15 (cola + historico), R17 (rechazo sin/con motivo),
// R19 (inexistente -> no_encontrada), R20 (resueltoPor al repo), R23 (listar/detalle no muta).

const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "adm-admin", rol: "admin" }; // feature 94: paridad con maestro
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

function bodegaResumenRow(
  overrides: Partial<CierreBodegaResumenRow> = {},
): CierreBodegaResumenRow {
  const base = {
    cierreBodegaId: "cb1",
    zonaId: "z-cartago",
    zonaNombre: "Cartago",
    solicitadoPorId: "adm-sat",
    solicitadoPorNombre: "Sara Satelite",
    estado: "solicitado" as const,
    totales: { efectivo: "10.00", simpe: "5.00", transferencia: "0.00", general: "15.00" },
    totalPagoMensajero: "5.00", // feature 39/R20: snapshot agregado del pago a mensajeros
    totalIngresoBodegaRechazos: "0.00", // feature 56/R19: snapshot agregado del ingreso de bodega
    cantidadCierres: 2,
    solicitadoAt: "2026-07-12T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...overrides,
  };
  // Feature 393 (R38): el doble reproduce lo que hace el MAPPER real
  // (`toBodegaResumenRow`), que es donde vive la derivacion — el servicio solo la deja pasar.
  // Se deriva y no se fija en un literal porque varios casos de esta suite sobreescriben
  // `totales` y `totalPagoMensajero`, y un literal quedaria mintiendo en cuanto lo hacen.
  return {
    ...base,
    paraLaCentral:
      overrides.paraLaCentral ??
      paraLaCentral(base.totales.general, base.totalPagoMensajero, base.totalIngresoBodegaRechazos),
    efectivoCubreDescuentos:
      overrides.efectivoCubreDescuentos ??
      efectivoCubreDescuentos(
        base.totales.efectivo,
        base.totalPagoMensajero,
        base.totalIngresoBodegaRechazos,
      ),
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
  // Feature 212/T9: el desglose es OBLIGATORIO en la fila. Por defecto se deriva del par
  // escalar (UNA linea, igual que el backfill), asi que los casos previos no cambian; un
  // caso que quiera un cobro MIXTO pasa sus propias lineas en `overrides.pagos`.
  const { pagos, ...resto } = overrides;
  const fila: Omit<CierreGestionPendienteRow, "pagos"> = {
    gestionId: "g1",
    ordenId: "o1",
    fechaGestion: "2026-07-11",
    numGuia: 10,
    numRemision: "REM-1",
    destinatario: "Ana",
    direccion: "Av 1",
    zonaNombre: "Cartago",
    provinciaNombre: "Cartago",
    cantonNombre: "Central",
    distritoNombre: "Oriental",
    producto: "Caja",
    // Ficha 396: la clave por la que el cierre se parte por tienda (el nombre es solo para mostrar).
    tiendaId: "tienda-1",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "10.00",
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: "5.00", // feature 39/R20: snapshot del pago de la gestion
    ingresoBodegaRechazo: "0.00", // feature 56/R19: snapshot del ingreso de la gestion
    esRechazoSla: false, // feature 102
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
    // Feature 158/R9/R19: campos POR RAMA del incidente. `null` por defecto en el resto
    // de resultados; los casos del incidente los sobreescriben.
    causaIncidente: null,
    indemnizacion: null,
    ...resto,
  };
  return conPagos(fila, pagos);
}

type Repo = ICierresBodegaAdminRepository;

function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    findCierresBodega: vi.fn(async () => [] as CierreBodegaResumenRow[]),
    // Feature 170 (T I.1): el historico paginado vive en su propia suite (*-paginado).
    findHistoricoPaginado: vi.fn(async () => ({
      items: [] as CierreBodegaResumenRow[],
      total: 0,
    })),
    // Feature 170 (T J.1): la cola paginada vive en su propia suite (*-pendientes-paginado).
    findColaPaginada: vi.fn(async () => ({
      items: [] as CierreBodegaResumenRow[],
      total: 0,
    })),
    // Feature 184 (T E.1): los dos CONJUNTOS de los que salen los archivos. Sus casos viven en
    // `cierres-bodega-admin-completo.test.ts`; aqui son no-op para completar el contrato.
    findHistoricoCompleto: vi.fn(async () => [] as CierreBodegaResumenRow[]),
    findColaCompleta: vi.fn(async () => [] as CierreBodegaResumenRow[]),
    findCierreBodegaConDetalle: vi.fn(async () => null),
    // Feature 230 (T7.1): el doble implementa la interfaz ENTERA. Estos casos no ejercitan la
    // descarga detallada; el conjunto vacio deja el camino de la 40 intacto.
    findGestionesDeCierresBodegaCompleto: vi.fn(async () => []),
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
  it("R2: rol sin acceso total (adminSatelite/mensajero) -> forbidden en las 4 operaciones, sin tocar el repo", async () => {
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

  it("feature 94: admin tiene paridad con maestro en las 4 operaciones", async () => {
    const repo = fakeRepo({
      findCierresBodega: vi.fn(async () => [bodegaResumenRow()]),
      findCierreBodegaConDetalle: vi.fn(async () => ({
        cierre: bodegaResumenRow(),
        cierresDia: [{ resumen: detalleCierreRow(), gestiones: [gestionRow()] }],
      })),
      resolverCierreBodega: vi.fn(async () => "updated" as const),
    });
    const { service } = newService({ repo });

    expect((await service.listarCierresBodegaAdmin(ADMIN)).status).toBe("ok");
    expect((await service.verCierreBodegaDetalle("cb1", ADMIN)).status).toBe("ok");
    expect((await service.aprobarCierreBodega("cb1", ADMIN)).status).toBe("ok");
    expect((await service.rechazarCierreBodega("cb1", "motivo", ADMIN)).status).toBe("ok");
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

describe("CierresBodegaAdminService.verCierreBodegaDetalle — ingreso y ganancia", () => {
  /** Desglose por orden como lo emite el repo (ya derivado del snapshot). */
  function conIngreso(over: Partial<IngresoOrdenexDTO>): IngresoOrdenexDTO {
    return {
      montoCobrar: null,
      cobraComision: false,
      esCentral: false,
      esZonaEspecial: false,
      fleteOrigen: "normal",
      fleteDevolucionOrigen: "normal",
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

  it("deriva el ingreso y la ganancia por cierre_dia Y agregados de toda la bodega", async () => {
    const repo = fakeRepo({
      findCierreBodegaConDetalle: vi.fn(async () => ({
        // Snapshot agregado de la bodega: 1500 + 500 de pago a mensajeros.
        cierre: bodegaResumenRow({ totalPagoMensajero: "2000.00" }),
        cierresDia: [
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd1", totalPagoMensajero: "1500.00" }),
            gestiones: [
              gestionRow({
                gestionId: "g1",
                resultado: "entregada",
                ingresoOrdenex: conIngreso({
                  flete: "2500.00",
                  ivaFlete: "325.00",
                  fleteConIva: "2825.00",
                  total: "2825.00",
                }),
              }),
            ],
          },
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd2", totalPagoMensajero: "500.00" }),
            gestiones: [
              gestionRow({
                gestionId: "g2",
                resultado: "rechazada",
                ingresoOrdenex: conIngreso({
                  fleteDevolucion: "1000.00",
                  ivaFleteDevolucion: "130.00",
                  fleteDevolucionConIva: "1130.00",
                  total: "1130.00",
                }),
              }),
            ],
          },
        ],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // Por cierre_dia: cada mensajero con SU ingreso y SU pago.
    expect(r.cierres[0].totalesIngreso.total).toBe("2825.00");
    expect(r.cierres[0].ganancia).toBe("1325.00"); // 2825 - 1500
    expect(r.cierres[1].totalesIngreso.total).toBe("1130.00");
    expect(r.cierres[1].ganancia).toBe("630.00"); // 1130 - 500

    // Agregado de la bodega: suma de los dos, menos el pago agregado del snapshot.
    expect(r.totalesIngreso).toMatchObject({
      // Agrupados: cada concepto con su IVA (lo que se pinta en el panel de arriba).
      fleteConIva: "2825.00",
      fleteDevolucionConIva: "1130.00",
      total: "3955.00", // 2825 + 1130
      // Detalle separado, para auditar cuánto de cada agrupado es IVA.
      flete: "2500.00",
      ivaFlete: "325.00",
      fleteDevolucion: "1000.00",
      ivaFleteDevolucion: "130.00",
    });
    expect(r.ganancia).toBe("1955.00"); // 3955 - 2000
    expect(typeof r.ganancia).toBe("string"); // money-safe
  });

  it("la ganancia agregada es negativa si la bodega no factura pero igual paga", async () => {
    const repo = fakeRepo({
      findCierreBodegaConDetalle: vi.fn(async () => ({
        cierre: bodegaResumenRow({ totalPagoMensajero: "2000.00" }),
        cierresDia: [
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd1", totalPagoMensajero: "2000.00" }),
            // Una reprogramación no aporta a ningún concepto.
            gestiones: [gestionRow({ gestionId: "g1", resultado: "reprogramada" })],
          },
        ],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalesIngreso.total).toBe("0.00");
    expect(r.ganancia).toBe("-2000.00");
    expect(r.cierres[0].ganancia).toBe("-2000.00");
  });
});

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

// --- feature 42/R11: la bodega NO alimenta la wallet (evita doble conteo) ---

describe("CierresBodegaAdminService — R11: aprobar bodega NO genera ingresos de wallet", () => {
  it("R11: aprobar un CierreBodega solo transiciona su estado; NO invoca ningun feed de wallet", async () => {
    // El CierresBodegaAdminService NO tiene NINGUNA dependencia de wallet (constructor =
    // repo + signedUrls). Aprobar solo llama resolverCierreBodega (transicion de estado del
    // agregado, feature 40). La fuente unica de ingresos de Ordenex es CierreDia (feature
    // 42/T8): la bodega agrega cierre_dia ya contados, por eso NO re-cuenta (F1.4-Q3).
    const resolver = vi.fn(async () => "updated" as const);
    const repo = fakeRepo({ resolverCierreBodega: resolver });
    const { service } = newService({ repo });

    const r = await service.aprobarCierreBodega("cb1", MAESTRO);

    expect(r.status).toBe("ok");
    // R11: la unica escritura es la transicion del cierre de bodega; ninguna otra tabla.
    expect(resolver).toHaveBeenCalledTimes(1);
    // El service no expone ni referencia ningun feed/movimiento de wallet (fuente unica = CierreDia).
    expect((service as unknown as Record<string, unknown>).walletFeedService).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).walletMovimientoRepo).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).construirMovimientosDeIngreso).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).crearMovimientos).toBeUndefined();
  });

  it("feature 43/R12: aprobar un CierreBodega NO genera movimientos del ledger POR TIENDA", async () => {
    // El ledger por tienda (43) se alimenta EXCLUSIVAMENTE desde CierreDia aprobado (misma tx
    // que la 42). El CierresBodegaAdminService no tiene ninguna dependencia del feed/repo de
    // tienda; aprobar bodega solo transiciona su estado -> no re-cuenta (evita doble conteo).
    const resolver = vi.fn(async () => "updated" as const);
    const repo = fakeRepo({ resolverCierreBodega: resolver });
    const { service } = newService({ repo });

    const r = await service.aprobarCierreBodega("cb1", MAESTRO);

    expect(r.status).toBe("ok");
    expect(resolver).toHaveBeenCalledTimes(1);
    expect((service as unknown as Record<string, unknown>).walletTiendaFeedService).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).walletTiendaMovimientoRepo).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).construirMovimientosPorTienda).toBeUndefined();
  });

  it("feature 44/R11: aprobar un CierreBodega NO genera movimientos del PAGO AL MENSAJERO", async () => {
    // El libro del pago por mensajero (44) se alimenta EXCLUSIVAMENTE desde CierreDia aprobado
    // (misma tx que 42/43). El CierresBodegaAdminService no tiene ninguna dependencia del
    // feed/repo del pago por mensajero; aprobar bodega solo transiciona su estado -> no re-cuenta
    // (evita doble conteo). Tampoco emite el egreso egreso_pago_mensajero en la caja 42.
    const resolver = vi.fn(async () => "updated" as const);
    const repo = fakeRepo({ resolverCierreBodega: resolver });
    const { service } = newService({ repo });

    const r = await service.aprobarCierreBodega("cb1", MAESTRO);

    expect(r.status).toBe("ok");
    expect(resolver).toHaveBeenCalledTimes(1);
    expect((service as unknown as Record<string, unknown>).walletMensajeroFeedService).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).pagoMensajeroMovimientoRepo).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).construirMovimientosDePago).toBeUndefined();
  });

  it("feature 173/R16: aprobar un CierreBodega NO mete CONTRA-ENTREGA en la caja principal", async () => {
    // Cuarta afirmacion de la misma linea que las tres de arriba (42/43/44), ahora para el
    // contra-entrega. El COD entra en la caja EXCLUSIVAMENTE al aprobar un CierreDia (misma tx
    // que 42/43/44), leyendo del ledger por tienda. El cierre de BODEGA agrega cierres del dia
    // YA aprobados —y por tanto YA contados—: si tambien emitiera, el mismo contra-entrega
    // entraria dos veces en la caja y «Dinero en caja» diria el doble de lo que hay.
    const resolver = vi.fn(async () => "updated" as const);
    const repo = fakeRepo({ resolverCierreBodega: resolver });
    const { service } = newService({ repo });

    const r = await service.aprobarCierreBodega("cb1", MAESTRO);

    expect(r.status).toBe("ok");
    expect(resolver).toHaveBeenCalledTimes(1);
    // Ni el feed del COD, ni el repositorio de la caja, ni el del ledger del que leeria.
    expect((service as unknown as Record<string, unknown>).cajaCodFeedService).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).construirIngresoCod).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).crearMovimientos).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 238 (T5.1, R39) — EL CIERRE DE BODEGA **NO** HEREDA LA CONFIRMACION FISICA.
//
// Sin codigo: el caso existe para que la AUSENCIA sea una decision y no un olvido. Cuarta
// afirmacion de la misma linea que las tres de arriba (42/43/44 y el contra-entrega), ahora para
// la 238.
//
// LA RAZON, y es de fondo: el nivel 2 agrega `cierre_dia` **YA APROBADOS**, y cada uno de ellos
// paso por su propia confirmacion fisica en el nivel 1. Pedirla otra vez seria pedirle a bodega
// que escanee dos veces el mismo paquete. Ademas `CierreBodegaRepository` y
// `CierresBodegaAdminRepository` **no tocan `orden` ni el choke point**: no hay ninguna orden que
// mover ni ninguna gestion que marcar.
//
// UBICACION — DISCREPANCIA CON EL SPEC, declarada: `tasks.md` situa este caso en
// `cierre-bodega-service.test.ts`, pero ahi vive el servicio del MENSAJERO (solicitar el cierre de
// bodega). `aprobarCierreBodega` vive en `CierresBodegaAdminService`, y sus tres hermanos «esta
// feature no llega al nivel 2» estan en ESTE archivo. Se pone donde vive.
describe("Feature 238 (R39) — aprobar un CierreBodega NO pide confirmacion fisica", () => {
  it("R39: la aprobacion del nivel 2 no lee ningun conjunto de paquetes que vuelven", async () => {
    // El doble se tipa con el input REAL: asi el literal de (2) se compara contra lo que el
    // servicio manda de verdad, y no contra un `unknown` que aceptaria cualquier cosa.
    const resolver = vi.fn<(input: ResolverCierreBodegaInput) => Promise<"updated">>(
      async () => "updated",
    );
    const repo = fakeRepo({ resolverCierreBodega: resolver });
    const { service } = newService({ repo });

    const r = await service.aprobarCierreBodega("cb1", MAESTRO);

    expect(r.status).toBe("ok");
    // (1) UNA sola llamada al repositorio, y es la transicion. Si alguien hiciera que el nivel 2
    // exigiera la confirmacion, tendria que LEER el conjunto esperado de algun sitio — y esa
    // lectura seria una llamada mas, aqui.
    const llamadasAlRepo = Object.entries(repo).filter(
      ([, metodo]) => (metodo as ReturnType<typeof vi.fn>).mock?.calls.length > 0,
    );
    expect(llamadasAlRepo.map(([nombre]) => nombre)).toEqual(["resolverCierreBodega"]);

    // (2) El input de la transicion es EXACTAMENTE el de siempre: cuatro claves, ninguna de
    // confirmacion. El literal es el contrato — una clave nueva lo pone rojo.
    expect(resolver.mock.calls[0][0]).toEqual({
      id: "cb1",
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    // (3) El servicio no tiene con que exigirla: ni colaborador, ni metodo de lectura.
    expect((service as unknown as Record<string, unknown>).cierresAdminRepo).toBeUndefined();
    expect(
      (repo as unknown as Record<string, unknown>).findGestionesRetornablesDelCierre,
    ).toBeUndefined();
  });

  it("R39: `aprobarCierreBodega` sigue aceptando (cierreBodegaId, actor) y nada mas", async () => {
    // Un tercer parametro de confirmacion cambiaria esta aridad. No es una prueba fuerte por si
    // sola —un parametro CON default no la movería—, pero (1) y (2) de arriba si lo cazan.
    expect(CierresBodegaAdminService.prototype.aprobarCierreBodega.length).toBe(2);
  });

  it("R39: ni el servicio ni sus repositorios NOMBRAN la confirmacion fisica", async () => {
    // Censo de texto sobre los tres archivos del nivel 2. Es el frente que caza el intento mas
    // probable: «reutilizar» aqui la marca de la 238 sin pensar en que ya se confirmo en el
    // nivel 1. Se pone rojo con solo plantar el nombre.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const raiz = path.resolve(__dirname, "../../..");
    const archivos = [
      "lib/services/CierresBodegaAdminService.ts",
      "lib/repositories/CierresBodegaAdminRepository.ts",
      "lib/repositories/CierreBodegaRepository.ts",
    ];
    for (const rel of archivos) {
      const fuente = readFileSync(path.join(raiz, rel), "utf8");
      for (const nombre of ["confirmacionFisica", "confirmadaFisicaAt", "confirmada_fisica_at"]) {
        expect(fuente, `${rel} nombra ${nombre}: el nivel 2 no confirma paquetes (R39)`).not.toContain(
          nombre,
        );
      }
    }
  });
});

/**
 * Feature 393 (B6) — LAS DOS CASCADAS que el servicio deriva: la de «de quien es el dinero»
 * (detalle) y la de «lo que va a la central» (tarjeta y detalle).
 *
 * DOS `cierre_dia` y CENTIMOS en todas las cifras. Con montos redondos estas identidades
 * cierran igual sin el arreglo y el caso no probaria nada; y R16 —que el agregado sea, AL
 * CENTIMO, la suma de los dias— es justo donde un redondeo intermedio se notaria.
 *
 * Los valores esperados van como LITERAL, no llamando a la funcion que el servicio usa: eso
 * seria una asercion contra su propia fuente y estaria siempre verde.
 */
describe("CierresBodegaAdminService.verCierreBodegaDetalle — las dos cascadas (feature 393)", () => {
  function conIngreso(over: Partial<IngresoOrdenexDTO>): IngresoOrdenexDTO {
    return {
      montoCobrar: null,
      cobraComision: false,
      esCentral: false,
      esZonaEspecial: false,
      fleteOrigen: "normal",
      fleteDevolucionOrigen: "normal",
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

  // --- Los dos dias -------------------------------------------------------
  // cd1 (Ana): solo entregadas, sin rechazos y sin ingreso de bodega.
  const DIA_1 = {
    totales: {
      efectivo: "60000.35",
      simpe: "5000.10",
      transferencia: "0.00",
      general: "65000.45",
    },
    totalPagoMensajero: "8000.55",
    totalIngresoBodegaRechazos: "0.00",
  };
  // cd2 (Beto): una entregada Y UN RECHAZO — el que hace que la linea puente importe — mas
  // ingreso de bodega, que es el sustraendo que `ganancia` no conoce.
  const DIA_2 = {
    totales: {
      efectivo: "40000.20",
      simpe: "0.00",
      transferencia: "1088.52",
      general: "41088.72",
    },
    totalPagoMensajero: "6000.45",
    totalIngresoBodegaRechazos: "1250.45",
  };
  // El snapshot AGREGADO es la suma exacta de los dos dias (que es lo que se midio contra
  // produccion el 2026-09-08: 14 cierres, 14 cuadran, 0 descuadran).
  const AGREGADO = {
    totales: {
      efectivo: "100000.55",
      simpe: "5000.10",
      transferencia: "1088.52",
      general: "106089.17",
    },
    totalPagoMensajero: "14001.00",
    totalIngresoBodegaRechazos: "1250.45",
  };

  function repoDeDosDias(
    cierre: Partial<CierreBodegaResumenRow> = {},
    dia1: Partial<typeof DIA_1> = {},
  ) {
    return fakeRepo({
      findCierreBodegaConDetalle: vi.fn(async () => ({
        cierre: bodegaResumenRow({ ...AGREGADO, ...cierre }),
        cierresDia: [
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd1", ...DIA_1, ...dia1 }),
            gestiones: [
              gestionRow({
                gestionId: "g1",
                resultado: "entregada",
                ingresoOrdenex: conIngreso({
                  flete: "2500.55",
                  ivaFlete: "325.07",
                  fleteConIva: "2825.62",
                  comisionCod: "1200.33",
                  ivaComisionCod: "156.04",
                  comisionConIva: "1356.37",
                  total: "4181.99",
                }),
              }),
            ],
          },
          {
            resumen: detalleCierreRow({
              cierreDiaId: "cd2",
              mensajeroId: "m2",
              mensajeroNombre: "Beto",
              ...DIA_2,
            }),
            gestiones: [
              gestionRow({
                gestionId: "g2",
                resultado: "entregada",
                ingresoOrdenex: conIngreso({
                  flete: "1800.35",
                  ivaFlete: "234.05",
                  fleteConIva: "2034.40",
                  comisionCod: "900.11",
                  ivaComisionCod: "117.01",
                  comisionConIva: "1017.12",
                  total: "3051.52",
                }),
              }),
              gestionRow({
                gestionId: "g3",
                resultado: "rechazada",
                ingresoOrdenex: conIngreso({
                  fleteDevolucion: "1200.45",
                  ivaFleteDevolucion: "156.06",
                  fleteDevolucionConIva: "1356.51",
                  total: "1356.51",
                }),
              }),
            ],
          },
        ],
      })),
    });
  }

  const suma = (...xs: string[]) =>
    xs.reduce((a, x) => a.plus(x), new Prisma.Decimal(0)).toFixed(2);

  it("1 · las cuatro identidades cierran con las cifras del AGREGADO (R6/R7/R8/R9)", async () => {
    const { service } = newService({ repo: repoDeDosDias() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // Lo facturado, por concepto.
    expect(r.totalesIngreso.fleteConIva).toBe("4860.02");
    expect(r.totalesIngreso.comisionConIva).toBe("2373.49");
    expect(r.totalesIngreso.fleteDevolucionConIva).toBe("1356.51");
    expect(r.totalesIngreso.total).toBe("8590.02");

    // R6 — lo recaudado menos los DOS deducibles = para la tienda.
    expect(r.pagoTienda).toBe("98855.66");
    expect(suma(r.pagoTienda, r.totalesIngreso.fleteConIva, r.totalesIngreso.comisionConIva)).toBe(
      r.cierre.totales.general,
    );

    // R7 — la linea puente mas el flete por rechazo = lo que Ordenex facturo.
    expect(r.cobradoSobreRecaudado).toBe("7233.51");
    expect(suma(r.cobradoSobreRecaudado, r.totalesIngreso.fleteDevolucionConIva)).toBe(
      r.totalesIngreso.total,
    );

    // R8 — lo facturado menos los dos pagos de Ordenex = neto. Sale NEGATIVO en este cierre, y
    // se emite con su signo. NO es `ganancia`: la diferencia entre las dos es, al centimo, el
    // ingreso de bodega.
    expect(r.netoOrdenex).toBe("-6661.43");
    expect(r.ganancia).toBe("-5410.98");
    expect(suma(r.netoOrdenex, r.cierre.totalIngresoBodegaRechazos)).toBe(r.ganancia);
    expect(
      suma(r.netoOrdenex, r.cierre.totalPagoMensajero, r.cierre.totalIngresoBodegaRechazos),
    ).toBe(r.totalesIngreso.total);

    // R9 — lo recaudado menos los dos descuentos de la bodega = para la central.
    expect(r.paraLaCentral).toBe("90837.72");
    expect(
      suma(r.paraLaCentral, r.cierre.totalPagoMensajero, r.cierre.totalIngresoBodegaRechazos),
    ).toBe(r.cierre.totales.general);

    // R37 — aqui el efectivo SI cubre los dos descuentos.
    expect(r.efectivoCubreDescuentos).toBe(true);
  });

  it("2 · la suma de los cuatro derivados por dia es, AL CENTIMO, el derivado agregado (R15/R16)", async () => {
    const { service } = newService({ repo: repoDeDosDias() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    const [cd1, cd2] = r.cierres;

    // Cada dia, desde SUS PROPIOS snapshots.
    expect(cd1.cobradoSobreRecaudado).toBe("4181.99");
    expect(cd1.pagoTienda).toBe("60818.46");
    expect(cd1.netoOrdenex).toBe("-3818.56");
    expect(cd1.paraLaCentral).toBe("56999.90");

    expect(cd2.cobradoSobreRecaudado).toBe("3051.52");
    expect(cd2.pagoTienda).toBe("38037.20");
    expect(cd2.netoOrdenex).toBe("-2842.87");
    expect(cd2.paraLaCentral).toBe("33837.82");

    // Y la suma de los dos da el agregado, sin un centimo de deriva.
    expect(suma(cd1.cobradoSobreRecaudado, cd2.cobradoSobreRecaudado)).toBe(
      r.cobradoSobreRecaudado,
    );
    expect(suma(cd1.pagoTienda, cd2.pagoTienda)).toBe(r.pagoTienda);
    expect(suma(cd1.netoOrdenex, cd2.netoOrdenex)).toBe(r.netoOrdenex);
    expect(suma(cd1.paraLaCentral, cd2.paraLaCentral)).toBe(r.paraLaCentral);
  });

  it("3 · con un rechazo, «para la tienda» NO es «recaudado − facturado», y la linea puente explica la diferencia exacta (R7/R10)", async () => {
    const { service } = newService({ repo: repoDeDosDias() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    const cd2 = r.cierres[1];

    // (a) El dia con el rechazo: empezar por el bruto NO da «para la tienda».
    const brutoDelDia = new Prisma.Decimal(cd2.totales.general)
      .minus(cd2.totalesIngreso.total)
      .toFixed(2);
    expect(brutoDelDia).toBe("36680.69");
    expect(brutoDelDia).not.toBe(cd2.pagoTienda);
    // El hueco es, al centimo, el flete por rechazo + IVA: se factura pero no sale de lo
    // recaudado, que es lo que la linea puente tiene que decir.
    expect(new Prisma.Decimal(cd2.pagoTienda).minus(brutoDelDia).toFixed(2)).toBe(
      cd2.totalesIngreso.fleteDevolucionConIva,
    );
    // Y con la linea puente SI da.
    expect(new Prisma.Decimal(cd2.totales.general).minus(cd2.cobradoSobreRecaudado).toFixed(2)).toBe(
      cd2.pagoTienda,
    );

    // (b) Lo mismo en el AGREGADO, que es donde se pinta la cascada A.
    const brutoAgregado = new Prisma.Decimal(r.cierre.totales.general)
      .minus(r.totalesIngreso.total)
      .toFixed(2);
    expect(brutoAgregado).toBe("97499.15");
    expect(brutoAgregado).not.toBe(r.pagoTienda);
    expect(new Prisma.Decimal(r.pagoTienda).minus(brutoAgregado).toFixed(2)).toBe(
      r.totalesIngreso.fleteDevolucionConIva,
    );

    // (c) El dia SIN rechazos tiene la linea puente igual: vale lo mismo que el bruto, y se
    // emite de todas formas — un cero explicito dice «aqui no hubo rechazos».
    const cd1 = r.cierres[0];
    expect(cd1.totalesIngreso.fleteDevolucionConIva).toBe("0.00");
    expect(cd1.cobradoSobreRecaudado).toBe(cd1.totalesIngreso.total);
  });

  it("4 · si el snapshot agregado NO es la suma de los dias, el agregado sigue saliendo del agregado y el dia del dia (R17)", async () => {
    // Un agregado deliberadamente descuadrado. Esto NO ocurre hoy —se midio— pero si ocurriera,
    // la pantalla tiene que ENSEÑAR el descuadre, no maquillarlo: cada nivel se lee de su
    // propio snapshot.
    const { service } = newService({
      repo: repoDeDosDias({
        totales: { efectivo: "900.99", simpe: "0.00", transferencia: "99.00", general: "999.99" },
        totalPagoMensajero: "111.11",
        totalIngresoBodegaRechazos: "22.22",
      }),
    });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // El agregado sale de SUS numeros: 999.99 - 111.11 - 22.22.
    expect(r.paraLaCentral).toBe("866.66");
    expect(r.netoOrdenex).toBe("8456.69"); // 8590.02 - 111.11 - 22.22

    // Los dias NO se han tocado: siguen valiendo lo de su propio snapshot.
    expect(r.cierres[0].paraLaCentral).toBe("56999.90");
    expect(r.cierres[1].paraLaCentral).toBe("33837.82");

    // Y nadie ha corregido a nadie para que cuadren: la suma de los dias NO da el agregado.
    expect(suma(r.cierres[0].paraLaCentral, r.cierres[1].paraLaCentral)).not.toBe(r.paraLaCentral);
    expect(suma(r.cierres[0].netoOrdenex, r.cierres[1].netoOrdenex)).not.toBe(r.netoOrdenex);
  });

  it("5 · el aviso del efectivo mira el EFECTIVO agregado, no el general (R37)", async () => {
    // «Para la central» POSITIVO y aun asi la bodega sin efectivo con que pagar: lo recaudado
    // entro casi todo por SINPE. Es el caso mas frecuente de los dos raros — medido contra
    // produccion el 2026-09-08: 2 de 14 cierres de bodega.
    const { service } = newService({
      repo: repoDeDosDias({
        totales: {
          efectivo: "1000.00",
          simpe: "104000.55",
          transferencia: "1088.62",
          general: "106089.17",
        },
      }),
    });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    expect(r.paraLaCentral).toBe("90837.72"); // positivo: el general no cambio
    expect(r.efectivoCubreDescuentos).toBe(false); // 1000.00 < 14001.00 + 1250.45
  });

  it("5b · y el aviso POR DIA tambien mira el efectivo DE ESE DIA, no su general (R15/R37)", async () => {
    // EL CASO DISCRIMINANTE del aviso por dia, que es el que el SERVICIO deriva: cd1 recauda
    // lo mismo pero casi todo por SINPE, asi que su efectivo (100.00) no cubre su pago
    // (8000.55) aunque su general (65000.45) lo cubriria de sobra. cd2 no cambia y sigue
    // pudiendo pagar: si los dos dieran lo mismo, este caso no separaria nada.
    const { service } = newService({
      repo: repoDeDosDias(
        {},
        {
          totales: {
            efectivo: "100.00",
            simpe: "64900.45",
            transferencia: "0.00",
            general: "65000.45",
          },
        },
      ),
    });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    expect(r.cierres[0].efectivoCubreDescuentos).toBe(false); // 100.00 < 8000.55
    expect(r.cierres[1].efectivoCubreDescuentos).toBe(true); // 40000.20 >= 7250.90
    // Y el «Para la central» del dia NO cambia: el general es el mismo.
    expect(r.cierres[0].paraLaCentral).toBe("56999.90");
  });

  it("6 · `pagoTienda` y `ganancia` siguen valiendo lo mismo que antes de la ficha (R31)", async () => {
    // Esta ficha AÑADE lineas, las agrupa y las renombra; no recalcula dinero existente. Los
    // dos derivados que ya existian se siguen devolviendo con la formula de siempre.
    const { service } = newService({ repo: repoDeDosDias() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // `ganancia` = facturado - mensajeros (SIN la bodega), como desde la feature 40.
    expect(r.ganancia).toBe("-5410.98");
    expect(r.cierres[0].ganancia).toBe("-3818.56"); // 4181.99 - 8000.55
    expect(r.cierres[1].ganancia).toBe("-1592.42"); // 4408.03 - 6000.45
    // `pagoTienda` = recaudado - flete+IVA - comision+IVA (SIN el flete por rechazo).
    expect(r.pagoTienda).toBe("98855.66");
    expect(r.cierres[0].pagoTienda).toBe("60818.46");
    expect(r.cierres[1].pagoTienda).toBe("38037.20");
  });
});

/**
 * 💰 FICHA 396 (D1) — EL DETALLE DEL CIERRE DE BODEGA DICE DE QUÉ TIENDA ES CADA PARTE,
 * EN SUS **DOS** NIVELES.
 *
 * ⚠️ **NO ES UN DEFECTO DE DINERO.** `wallet_tienda_movimiento` lleva los movimientos separados
 * por tienda desde siempre, con sus propias cifras: a nadie se le paga mal, y esta ficha no
 * emite, borra ni corrige ni una fila del ledger. Lo que faltaba era DECIRLO en la pantalla.
 *
 * Aquí el defecto es el peor de los tres: el cierre de bodega agrega **N mensajeros × M
 * tiendas** bajo un único rótulo «Pago a tienda».
 *
 * **Todos los importes de aquí abajo están escritos a mano.** Ninguno sale de llamar a
 * `partesPorTienda` ni a `ganaLaTienda`, que son las funciones bajo prueba: comparar un total
 * contra la función que lo genera deja el test siempre verde.
 *
 * ⚠️ **EL CORPUS TIENE CARDINALES DISTINTOS POR NIVEL, A PROPÓSITO.** Ana llevó órdenes de UNA
 * sola tienda; Beto, de DOS; la bodega entera, DOS. Es lo que separa R19 de R20: el umbral del
 * nivel-mensajero se evalúa sobre las tiendas **DE ESE MENSAJERO**. Y la tienda Norte aparece en
 * los DOS mensajeros, así que el agregado la trae UNA sola vez (R20/Q8).
 */
describe("396/D1 — `verCierreBodegaDetalle` emite el desglose por tienda en los DOS niveles", () => {
  /** Desglose por orden como lo emite el repositorio (ya derivado del snapshot congelado). */
  function ingreso(over: Partial<IngresoOrdenexDTO>): IngresoOrdenexDTO {
    return {
      montoCobrar: null,
      cobraComision: false,
      esCentral: false,
      esZonaEspecial: false,
      fleteOrigen: "normal",
      fleteDevolucionOrigen: "normal",
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

  // --- ANA (cd1): UNA sola tienda (Norte), y CON un rechazo ------------------------------
  const GESTIONES_ANA = () => [
    gestionRow({
      gestionId: "g-ana-entrega",
      ordenId: "o-ana-1",
      tiendaId: "t-norte",
      tiendaNombre: "Tienda Norte",
      resultado: "entregada",
      montoRecibido: "100000.00",
      metodoPago: "efectivo",
      ingresoOrdenex: ingreso({
        flete: "2500.00",
        ivaFlete: "325.00",
        fleteConIva: "2825.00",
        comisionCod: "3000.00",
        ivaComisionCod: "390.00",
        comisionConIva: "3390.00",
        total: "6215.00",
      }),
    }),
    gestionRow({
      gestionId: "g-ana-rechazo",
      ordenId: "o-ana-2",
      tiendaId: "t-norte",
      tiendaNombre: "Tienda Norte",
      resultado: "rechazada",
      montoRecibido: null,
      metodoPago: null,
      ingresoOrdenex: ingreso({
        fleteDevolucion: "1500.00",
        ivaFleteDevolucion: "195.00",
        fleteDevolucionConIva: "1695.00",
        total: "1695.00",
      }),
    }),
  ];

  // --- BETO (cd2): DOS tiendas (Sur y Norte), SIN rechazos -------------------------------
  const GESTIONES_BETO = () => [
    gestionRow({
      gestionId: "g-beto-sur",
      ordenId: "o-beto-1",
      tiendaId: "t-sur",
      tiendaNombre: "Tienda Sur",
      resultado: "entregada",
      montoRecibido: "40000.00",
      metodoPago: "SINPE",
      ingresoOrdenex: ingreso({
        flete: "2000.00",
        ivaFlete: "260.00",
        fleteConIva: "2260.00",
        comisionCod: "1200.00",
        ivaComisionCod: "156.00",
        comisionConIva: "1356.00",
        total: "3616.00",
      }),
    }),
    gestionRow({
      gestionId: "g-beto-norte",
      ordenId: "o-beto-2",
      tiendaId: "t-norte",
      tiendaNombre: "Tienda Norte",
      resultado: "entregada",
      montoRecibido: "25000.00",
      metodoPago: "efectivo",
      ingresoOrdenex: ingreso({
        flete: "2000.00",
        ivaFlete: "260.00",
        fleteConIva: "2260.00",
        comisionCod: "750.00",
        ivaComisionCod: "97.50",
        comisionConIva: "847.50",
        total: "3107.50",
      }),
    }),
  ];

  const SNAPSHOT_ANA = {
    totales: { efectivo: "100000.00", simpe: "0.00", transferencia: "0.00", general: "100000.00" },
    totalPagoMensajero: "5000.00",
    totalIngresoBodegaRechazos: "500.00",
  };
  const SNAPSHOT_BETO = {
    totales: {
      efectivo: "25000.00",
      simpe: "40000.00",
      transferencia: "0.00",
      general: "65000.00",
    },
    totalPagoMensajero: "4000.00",
    totalIngresoBodegaRechazos: "0.00",
  };
  /** El snapshot AGREGADO es la suma exacta de los dos días — la condición MEDIDA de T0.5. */
  const SNAPSHOT_AGREGADO = {
    totales: {
      efectivo: "125000.00",
      simpe: "40000.00",
      transferencia: "0.00",
      general: "165000.00",
    },
    totalPagoMensajero: "9000.00",
    totalIngresoBodegaRechazos: "500.00",
  };

  function repoDeDosMensajeros(cierre: Partial<CierreBodegaResumenRow> = {}) {
    return fakeRepo({
      findCierreBodegaConDetalle: vi.fn(async () => ({
        cierre: bodegaResumenRow({ ...SNAPSHOT_AGREGADO, ...cierre }),
        cierresDia: [
          {
            resumen: detalleCierreRow({
              cierreDiaId: "cd-ana",
              mensajeroId: "m-ana",
              mensajeroNombre: "Ana Mensajera",
              ...SNAPSHOT_ANA,
            }),
            gestiones: GESTIONES_ANA(),
          },
          {
            resumen: detalleCierreRow({
              cierreDiaId: "cd-beto",
              mensajeroId: "m-beto",
              mensajeroNombre: "Beto Mensajero",
              ...SNAPSHOT_BETO,
            }),
            gestiones: GESTIONES_BETO(),
          },
        ],
      })),
    });
  }

  const sumar = (montos: string[]) =>
    montos.reduce((a, m) => a.plus(new Prisma.Decimal(m)), new Prisma.Decimal(0)).toFixed(2);

  it("D1: los DOS niveles emiten el `ganaLaTienda` AGREGADO que a este contrato le faltaba", async () => {
    // La asimetría que la 395 dejó abierta: puso `ganaLaTienda` sólo en el detalle del cierre
    // del mensajero. Sin él, el desglose de abajo sumaría hacia un total que no está en ninguna
    // pantalla. Literales a mano; misma función que en el otro detalle, sobre los datos de cada
    // nivel.
    const { service } = newService({ repo: repoDeDosMensajeros() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // Ana: 100.000,00 − 7.910,00 (6.215,00 de la entrega + 1.695,00 del rechazo).
    expect(r.cierres[0].ganaLaTienda).toBe("92090.00");
    // Beto: 65.000,00 − 6.723,50 (3.616,00 + 3.107,50). SIN rechazos, coincide con su pago.
    expect(r.cierres[1].ganaLaTienda).toBe("58276.50");
    expect(r.cierres[1].pagoTienda).toBe("58276.50");
    // Agregado: 165.000,00 − 14.633,50.
    expect(r.ganaLaTienda).toBe("150366.50");

    // Y NO es `pagoTienda`: la diferencia es, al céntimo, el flete por rechazo de ese nivel.
    expect(
      new Prisma.Decimal(r.cierres[0].pagoTienda).minus(r.cierres[0].ganaLaTienda).toFixed(2),
    ).toBe("1695.00");
    expect(new Prisma.Decimal(r.pagoTienda).minus(r.ganaLaTienda).toFixed(2)).toBe("1695.00");
  });

  it("⚠️ R19: el nivel de CADA MENSAJERO se desglosa con SUS gestiones — Ana tiene UNA tienda y la bodega DOS", async () => {
    // ESTE es el caso que separa los dos umbrales. Si el nivel-mensajero se derivara del
    // conjunto de toda la bodega, a Ana le saldrían DOS tiendas y la pantalla enseñaría un
    // desglose en un mensajero que sólo llevó una.
    const { service } = newService({ repo: repoDeDosMensajeros() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    expect(r.cierres[0].partesPorTienda).toEqual([
      {
        tiendaId: "t-norte",
        tiendaNombre: "Tienda Norte",
        recaudado: "100000.00",
        pagoTienda: "93785.00", // 100.000,00 − 2.825,00 − 3.390,00
        ganaLaTienda: "92090.00", // 100.000,00 − (6.215,00 + 1.695,00)
      },
    ]);

    // Beto: DOS, ordenadas por lo que se les paga, de mayor a menor (R8).
    expect(r.cierres[1].partesPorTienda).toEqual([
      {
        tiendaId: "t-sur",
        tiendaNombre: "Tienda Sur",
        recaudado: "40000.00",
        pagoTienda: "36384.00", // 40.000,00 − 2.260,00 − 1.356,00
        ganaLaTienda: "36384.00", // sin rechazos, coincide
      },
      {
        tiendaId: "t-norte",
        tiendaNombre: "Tienda Norte",
        recaudado: "25000.00",
        pagoTienda: "21892.50", // 25.000,00 − 2.260,00 − 847,50
        ganaLaTienda: "21892.50",
      },
    ]);

    // Los cardinales, dichos aparte: es el número del que la pantalla saca su umbral.
    expect(r.cierres[0].partesPorTienda).toHaveLength(1);
    expect(r.cierres[1].partesPorTienda).toHaveLength(2);
    expect(r.partesPorTienda).toHaveLength(2);
  });

  it("R20/Q8: el agregado trae UNA fila por tienda — Norte está en los DOS mensajeros y sale una vez", async () => {
    const { service } = newService({ repo: repoDeDosMensajeros() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // Ni matriz tienda × mensajero, ni la misma tienda repetida: DOS filas para DOS tiendas,
    // con las cifras de Norte sumadas a través de los dos mensajeros.
    expect(r.partesPorTienda).toEqual([
      {
        tiendaId: "t-norte",
        tiendaNombre: "Tienda Norte",
        recaudado: "125000.00", // 100.000,00 + 25.000,00
        pagoTienda: "115677.50", // 125.000,00 − 5.085,00 − 4.237,50
        ganaLaTienda: "113982.50", // 125.000,00 − 11.017,50
      },
      {
        tiendaId: "t-sur",
        tiendaNombre: "Tienda Sur",
        recaudado: "40000.00",
        pagoTienda: "36384.00",
        ganaLaTienda: "36384.00",
      },
    ]);
  });

  it("R10/R11/R12: en los TRES niveles la suma de las partes ES el agregado de ESE nivel, al céntimo", async () => {
    const { service } = newService({ repo: repoDeDosMensajeros() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // Los DOS lados anclados a literales escritos a mano: la suma de las partes y el agregado
    // que el propio DTO emite. Si cualquiera de los dos se moviera, esto se entera.
    const ana = r.cierres[0];
    expect(sumar(ana.partesPorTienda.map((p) => p.pagoTienda))).toBe("93785.00");
    expect(ana.pagoTienda).toBe("93785.00"); // R10
    expect(sumar(ana.partesPorTienda.map((p) => p.ganaLaTienda))).toBe("92090.00");
    expect(ana.ganaLaTienda).toBe("92090.00"); // R11
    expect(sumar(ana.partesPorTienda.map((p) => p.recaudado))).toBe("100000.00");
    expect(ana.totales.general).toBe("100000.00"); // R12

    const beto = r.cierres[1];
    expect(sumar(beto.partesPorTienda.map((p) => p.pagoTienda))).toBe("58276.50");
    expect(beto.pagoTienda).toBe("58276.50");
    expect(sumar(beto.partesPorTienda.map((p) => p.ganaLaTienda))).toBe("58276.50");
    expect(beto.ganaLaTienda).toBe("58276.50");
    expect(sumar(beto.partesPorTienda.map((p) => p.recaudado))).toBe("65000.00");
    expect(beto.totales.general).toBe("65000.00");

    expect(sumar(r.partesPorTienda.map((p) => p.pagoTienda))).toBe("152061.50");
    expect(r.pagoTienda).toBe("152061.50");
    expect(sumar(r.partesPorTienda.map((p) => p.ganaLaTienda))).toBe("150366.50");
    expect(r.ganaLaTienda).toBe("150366.50");
    expect(sumar(r.partesPorTienda.map((p) => p.recaudado))).toBe("165000.00");
    expect(r.cierre.totales.general).toBe("165000.00");
  });

  it("la CUARTA identidad, por tienda: lo que se le paga − lo que gana = SU flete por rechazo", async () => {
    // Es la que hace imposible derivar una de las dos con el subconjunto equivocado sin que se
    // note. Norte tuvo un rechazo (1.695,00) y Sur no (0,00): si las dos dieran cero, este test
    // pasaría sin comprobar nada.
    const { service } = newService({ repo: repoDeDosMensajeros() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    const dif = (p: { pagoTienda: string; ganaLaTienda: string }) =>
      new Prisma.Decimal(p.pagoTienda).minus(p.ganaLaTienda).toFixed(2);

    const norte = r.partesPorTienda.find((p) => p.tiendaId === "t-norte");
    const sur = r.partesPorTienda.find((p) => p.tiendaId === "t-sur");
    if (norte === undefined || sur === undefined) throw new Error("falta una tienda del agregado");
    expect(dif(norte)).toBe("1695.00");
    expect(dif(sur)).toBe("0.00");

    // Y en el nivel de Beto, donde Norte NO trajo rechazos, su diferencia es cero: la resta
    // depende del SUBCONJUNTO, no de la tienda.
    const norteDeBeto = r.cierres[1].partesPorTienda.find((p) => p.tiendaId === "t-norte");
    if (norteDeBeto === undefined) throw new Error("falta Norte en el nivel de Beto");
    expect(dif(norteDeBeto)).toBe("0.00");
  });

  it("⚠️ R21: si el snapshot AGREGADO no es la suma de sus días, el descuadre SE VE — no se maquilla", async () => {
    // Los agregados salen del snapshot AGREGADO y el desglose sólo puede salir de las gestiones.
    // Que las dos vías coincidan se MIDIÓ contra producción (14 de 14 el 2026-09-08), pero es una
    // medición, NO una regla. Aquí se fuerza el descuadre: el agregado sigue saliendo del
    // snapshot y el desglose de las gestiones, y la diferencia queda a la vista (R21). Corregir
    // cualquiera de los dos para que cuadren violaría R18 y contradiría la decisión de la 393.
    const { service } = newService({
      repo: repoDeDosMensajeros({
        totales: {
          efectivo: "160000.00",
          simpe: "40000.00",
          transferencia: "0.00",
          general: "200000.00", // 35.000,00 MÁS que lo que suman los dos días
        },
      }),
    });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // El agregado, desde el SNAPSHOT: 200.000,00 − 7.345,00 − 5.593,50 y 200.000,00 − 14.633,50.
    expect(r.pagoTienda).toBe("187061.50");
    expect(r.ganaLaTienda).toBe("185366.50");

    // El desglose, desde las GESTIONES: exactamente el mismo de antes, sin enterarse.
    expect(sumar(r.partesPorTienda.map((p) => p.pagoTienda))).toBe("152061.50");
    expect(sumar(r.partesPorTienda.map((p) => p.ganaLaTienda))).toBe("150366.50");
    expect(sumar(r.partesPorTienda.map((p) => p.recaudado))).toBe("165000.00");

    // Y el descuadre es visible y vale exactamente los 35.000,00 que se le añadieron al
    // snapshot. NO es un fallo del desglose: es lo que la pantalla debe enseñar.
    expect(
      new Prisma.Decimal(r.pagoTienda)
        .minus(sumar(r.partesPorTienda.map((p) => p.pagoTienda)))
        .toFixed(2),
    ).toBe("35000.00");
    expect(
      new Prisma.Decimal(r.cierre.totales.general)
        .minus(sumar(r.partesPorTienda.map((p) => p.recaudado)))
        .toFixed(2),
    ).toBe("35000.00");

    // Los niveles por mensajero NO se contagian: cada uno sigue cuadrando con SU propio día.
    expect(sumar(r.cierres[0].partesPorTienda.map((p) => p.pagoTienda))).toBe(
      r.cierres[0].pagoTienda,
    );
    expect(sumar(r.cierres[1].partesPorTienda.map((p) => p.pagoTienda))).toBe(
      r.cierres[1].pagoTienda,
    );
  });

  it("R5/R16: cinco claves por parte, y ni el pago al mensajero ni el ingreso de bodega se reparten", async () => {
    const { service } = newService({ repo: repoDeDosMensajeros() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    for (const parte of [...r.partesPorTienda, ...r.cierres.flatMap((c) => c.partesPorTienda)]) {
      expect(Object.keys(parte).sort()).toEqual([
        "ganaLaTienda",
        "pagoTienda",
        "recaudado",
        "tiendaId",
        "tiendaNombre",
      ]);
    }
    // Siguen siendo del cierre entero, agregados y sin repartir (R16).
    expect(r.cierre.totalPagoMensajero).toBe("9000.00");
    expect(r.cierre.totalIngresoBodegaRechazos).toBe("500.00");
    expect(r.cierres[0].totalPagoMensajero).toBe("5000.00");
    expect(r.cierres[1].totalIngresoBodegaRechazos).toBe("0.00");
  });

  it("R18: ni un importe ya visible cambia de valor por añadir el desglose", async () => {
    const { service } = newService({ repo: repoDeDosMensajeros() });
    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // AGREGADO: lo facturado por concepto y los cinco derivados que ya existían.
    expect(r.totalesIngreso.fleteConIva).toBe("7345.00"); // 2.825,00 + 2.260,00 + 2.260,00
    expect(r.totalesIngreso.comisionConIva).toBe("5593.50"); // 3.390,00 + 1.356,00 + 847,50
    expect(r.totalesIngreso.fleteDevolucionConIva).toBe("1695.00");
    expect(r.totalesIngreso.total).toBe("14633.50");
    expect(r.ganancia).toBe("5633.50"); // 14.633,50 − 9.000,00
    expect(r.pagoTienda).toBe("152061.50");
    expect(r.cobradoSobreRecaudado).toBe("12938.50"); // 7.345,00 + 5.593,50
    expect(r.netoOrdenex).toBe("5133.50"); // 14.633,50 − 9.000,00 − 500,00
    expect(r.paraLaCentral).toBe("155500.00"); // 165.000,00 − 9.000,00 − 500,00
    expect(r.efectivoCubreDescuentos).toBe(true);

    // POR MENSAJERO: los mismos cinco, de sus propios snapshots.
    expect(r.cierres[0].totalesIngreso.total).toBe("7910.00");
    expect(r.cierres[0].ganancia).toBe("2910.00"); // 7.910,00 − 5.000,00
    expect(r.cierres[0].pagoTienda).toBe("93785.00");
    expect(r.cierres[0].cobradoSobreRecaudado).toBe("6215.00"); // 2.825,00 + 3.390,00
    expect(r.cierres[0].netoOrdenex).toBe("2410.00"); // 7.910,00 − 5.000,00 − 500,00
    expect(r.cierres[0].paraLaCentral).toBe("94500.00"); // 100.000,00 − 5.000,00 − 500,00
    expect(r.cierres[1].totalesIngreso.total).toBe("6723.50");
    expect(r.cierres[1].ganancia).toBe("2723.50");
    expect(r.cierres[1].pagoTienda).toBe("58276.50");
    expect(r.cierres[1].cobradoSobreRecaudado).toBe("6723.50");
    expect(r.cierres[1].netoOrdenex).toBe("2723.50");
    expect(r.cierres[1].paraLaCentral).toBe("61000.00"); // 65.000,00 − 4.000,00 − 0,00
  });

  it("R24: el desglose no se cuela por la puerta de alcance — un rol sin acceso total no lo ve", async () => {
    const repo = repoDeDosMensajeros();
    const { service } = newService({ repo });

    const r = await service.verCierreBodegaDetalle("cb1", ADMIN_SATELITE);

    expect(r).toEqual({ status: "forbidden" });
    expect(Object.keys(r)).toEqual(["status"]); // ni `partesPorTienda`, ni `ganaLaTienda`
    expect(repo.findCierreBodegaConDetalle).not.toHaveBeenCalled();
  });

  it("con UNA sola tienda en toda la bodega el campo se emite igual, con un elemento", async () => {
    // El umbral de Q5 es de PRESENTACIÓN y vive en la pantalla. Un contrato que a veces trae la
    // lista y a veces no obliga a cada consumidor a distinguir dos formas del mismo dato: el
    // error que la 264 ya documentó.
    const repo = fakeRepo({
      findCierreBodegaConDetalle: vi.fn(async () => ({
        cierre: bodegaResumenRow({
          totales: {
            efectivo: "100000.00",
            simpe: "0.00",
            transferencia: "0.00",
            general: "100000.00",
          },
          totalPagoMensajero: "5000.00",
          totalIngresoBodegaRechazos: "500.00",
        }),
        cierresDia: [
          {
            resumen: detalleCierreRow({ cierreDiaId: "cd-ana", ...SNAPSHOT_ANA }),
            gestiones: GESTIONES_ANA(),
          },
        ],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    expect(r.partesPorTienda).toEqual([
      {
        tiendaId: "t-norte",
        tiendaNombre: "Tienda Norte",
        recaudado: "100000.00",
        pagoTienda: "93785.00",
        ganaLaTienda: "92090.00",
      },
    ]);
    // Y sus tres cifras son EXACTAMENTE las agregadas del mismo nivel.
    expect(r.partesPorTienda[0].pagoTienda).toBe(r.pagoTienda);
    expect(r.partesPorTienda[0].ganaLaTienda).toBe(r.ganaLaTienda);
    expect(r.partesPorTienda[0].recaudado).toBe(r.cierre.totales.general);
  });
});
