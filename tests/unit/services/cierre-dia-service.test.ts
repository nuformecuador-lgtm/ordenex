import { describe, it, expect, vi } from "vitest";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type {
  CierreGestionPendienteRow,
  GestionDeshacerRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaZonaMensajeroRepository,
  PagoTarifa,
} from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 37 — tests unit del CierreDiaService (mocks de repos + dobles de
// ISignedUrlProvider/findCentralZonaId, sin DB/red). Cubre R1,R2,R3,R4,R5,R6,R7,R8,
// R9,R10,R11,R12,R15,R16,R17.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const OTRO_ROL: Actor = { usuarioId: "u1", rol: "adminSatelite" };

const ZONA_MENSAJERO = "z-cartago";
const ZONA_CENTRAL = "z-central";

function pendiente(overrides: Partial<CierreGestionPendienteRow> = {}): CierreGestionPendienteRow {
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
    pagoMensajero: null, // feature 39: en vivo el snapshot es null; el service lo DERIVA
    ingresoBodegaRechazo: null, // feature 56: en vivo el snapshot es null; el service lo DERIVA
    esRechazoSla: false, // feature 102/R11: la vista en vivo del mensajero no expone el desglose
    ...overrides,
  };
}

type Repo = ICierreDiaRepository;

// Feature 39: tarifa por defecto para los tests (entregada paga cobroEntregado).
const TARIFA_DEFECTO: PagoTarifa = { cobroEntregado: "5.00", cobroRechazado: "3.00" };

function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    findGestionesPendientes: vi.fn(async () => [] as CierreGestionPendienteRow[]),
    contarOrdenesPendientesGestion: vi.fn(async () => 0),
    existeCierreSolicitado: vi.fn(async () => false),
    // Feature 111: por defecto NO hay vencido -> `solicitarCierre` toma el flujo de creación (37).
    existeCierreVencido: vi.fn(async () => false),
    transicionarVencidoASolicitado: vi.fn(async () => true),
    // Feature 109: por defecto NO hay rechazado (mismo criterio que el vencido).
    existeCierreRechazado: vi.fn(async () => false),
    transicionarRechazadoASolicitado: vi.fn(async () => true),
    crearCierre: vi.fn(async () => "c1"),
    findCierresByMensajero: vi.fn(async () => []),
    // Feature 67: por defecto, una gestion `entregada` vigente del propio mensajero, sin
    // cierre, que ES la mas reciente y cuya orden sigue en `entregada` -> deshacible (R1).
    findGestionParaDeshacer: vi.fn(async () => gestionDeshacer()),
    findUltimaGestionNoAnuladaId: vi.fn(async () => "g1"),
    anularGestionYDevolverAGestion: vi.fn(async () => true),
    ...overrides,
  };
}

// Feature 67 — fila de la gestion candidata a deshacerse (default: caso feliz).
function gestionDeshacer(overrides: Partial<GestionDeshacerRow> = {}): GestionDeshacerRow {
  return {
    gestionId: "g1",
    ordenId: "o1",
    mensajeroId: "m1", // el propio MENSAJERO actor
    resultado: "entregada",
    cierreId: null, // R1: dentro de la ventana
    anuladaAt: null, // R1: vigente
    orden: { deletedAt: null, estatusId: "s-entregada", estatusValue: "entregada" },
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

function newService(opts: {
  repo?: Repo;
  centralZonaId?: string | null;
  zonaMensajero?: string | null;
  vehiculoMensajero?: string | null;
  tarifa?: PagoTarifa | null; // feature 39: tarifa resuelta (default TARIFA_DEFECTO)
  signedUrls?: ISignedUrlProvider;
  // Feature 67: id de `en_reparto` en el catalogo (null = seed pendiente -> validation_error).
  estatusEnRepartoId?: string | null;
  // Feature 111/R5: ids de mensajeros bloqueados que devuelve `findMensajerosBloqueados`.
  bloqueados?: string[];
} = {}) {
  const repo = opts.repo ?? fakeRepo();
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => opts.centralZonaId ?? null),
  } as unknown as Pick<IZonaRepository, "findCentralZonaId">;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => (opts.zonaMensajero === undefined ? ZONA_MENSAJERO : opts.zonaMensajero)),
    findUsuarioVehiculoId: vi.fn(async () => opts.vehiculoMensajero ?? null),
    // Feature 67/R18: resuelve el destino `en_reparto`.
    findEstatusIdByValue: vi.fn(async () =>
      opts.estatusEnRepartoId === undefined ? "s-reparto" : opts.estatusEnRepartoId,
    ),
    // Feature 111/R5: predicado de bloqueo (default = NO bloqueado). Los tests de bloqueo lo
    // sobreescriben (Set con el mensajero) via `bloqueados`.
    findMensajerosBloqueados: vi.fn(
      async (): Promise<Set<string>> =>
        opts.bloqueados ? new Set(opts.bloqueados) : new Set<string>(),
    ),
  } as unknown as Pick<
    IOrdenRepository,
    "findUsuarioZonaId" | "findUsuarioVehiculoId" | "findEstatusIdByValue" | "findMensajerosBloqueados"
  >;
  const tarifa = opts.tarifa === undefined ? TARIFA_DEFECTO : opts.tarifa;
  const tarifaZonaRepo: ITarifaZonaMensajeroRepository = {
    resolvePagoTarifa: vi.fn(async () => tarifa),
  };
  const signedUrls = opts.signedUrls ?? fakeSignedUrls();
  const service = new CierreDiaService(
    repo,
    zonaRepo as IZonaRepository,
    ordenRepo as IOrdenRepository,
    signedUrls,
    tarifaZonaRepo,
  );
  return { service, repo, zonaRepo, ordenRepo, tarifaZonaRepo, signedUrls };
}

// --- listarCierreDia (R1-R11, R17, R18) ---

describe("listarCierreDia — autorizacion y alcance (R1/R2)", () => {
  it("R1/R2: rol != mensajero -> forbidden, sin consultar el repo", async () => {
    const { service, repo } = newService();
    const r = await service.listarCierreDia(OTRO_ROL);
    expect(r.status).toBe("forbidden");
    expect(repo.findGestionesPendientes).not.toHaveBeenCalled();
  });

  it("R2: resuelve gestiones/conteo/historico SIEMPRE por el usuarioId del actor", async () => {
    const { service, repo } = newService();
    await service.listarCierreDia(MENSAJERO);
    expect(repo.findGestionesPendientes).toHaveBeenCalledWith("m1");
    expect(repo.contarOrdenesPendientesGestion).toHaveBeenCalledWith("m1", [
      "en_espera_aceptacion",
      "en_reparto",
    ]);
    expect(repo.findCierresByMensajero).toHaveBeenCalledWith("m1");
  });
});

describe("listarCierreDia — agrupacion y detalle (R3/R4/R6)", () => {
  it("R3: agrupa por resultado con las 4 claves siempre presentes", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada" }),
        pendiente({ gestionId: "b", resultado: "reprogramada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "devuelta", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "d", resultado: "entregada" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada.map((g) => g.gestionId)).toEqual(["a", "d"]);
    expect(r.grupos.reprogramada.map((g) => g.gestionId)).toEqual(["b"]);
    expect(r.grupos.devuelta.map((g) => g.gestionId)).toEqual(["c"]);
    expect(r.grupos.rechazada).toEqual([]);
  });

  it("R4/R6: entregada expone monto+metodo; reprogramada expone fecha+motivo", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", montoRecibido: "30.00", metodoPago: "SIMPE" }),
        pendiente({
          gestionId: "b",
          resultado: "reprogramada",
          montoRecibido: null,
          metodoPago: null,
          motivo: "ausente",
          fechaReprogramacion: "2026-07-20",
        }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    const entregada = r.grupos.entregada[0];
    expect(entregada.montoRecibido).toBe("30.00"); // R6
    expect(entregada.metodoPago).toBe("SIMPE");
    const reprog = r.grupos.reprogramada[0];
    expect(reprog.fechaReprogramacion).toBe("2026-07-20"); // R4
    expect(reprog.motivo).toBe("ausente");
    expect(reprog.montoRecibido).toBeNull();
  });
});

describe("listarCierreDia — evidencia firmada (R5)", () => {
  it("R5: firma las evidencias en lote y expone SOLO la URL firmada, nunca el path crudo", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "rechazada", montoRecibido: null, metodoPago: null, evidenciaStoragePath: "o1/rechazo.jpg" }),
        pendiente({ gestionId: "b", resultado: "reprogramada", montoRecibido: null, metodoPago: null, evidenciaStoragePath: null }),
      ]),
    });
    const signedUrls = fakeSignedUrls();
    const { service } = newService({ repo, signedUrls });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(signedUrls.createSignedUrls).toHaveBeenCalledWith(["o1/rechazo.jpg"], expect.any(Number));
    const rechazada = r.grupos.rechazada[0];
    expect(rechazada.evidenciaUrl).toBe("https://signed/o1/rechazo.jpg");
    // el path crudo NO se filtra en el DTO.
    expect(rechazada).not.toHaveProperty("evidenciaStoragePath");
    // sin evidencia -> null y no rompe.
    expect(r.grupos.reprogramada[0].evidenciaUrl).toBeNull();
  });

  it("R5: sin evidencias no llama al firmador", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [pendiente({ evidenciaStoragePath: null })]),
    });
    const signedUrls = fakeSignedUrls();
    const { service } = newService({ repo, signedUrls });
    await service.listarCierreDia(MENSAJERO);
    expect(signedUrls.createSignedUrls).not.toHaveBeenCalled();
  });
});

describe("listarCierreDia — totales money-critical (R7/R8/R9)", () => {
  it("R7: totales por metodo + general cuadran con montos conocidos", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", metodoPago: "efectivo", montoRecibido: "10.00" }),
        pendiente({ gestionId: "b", metodoPago: "efectivo", montoRecibido: "5.25" }),
        pendiente({ gestionId: "c", metodoPago: "SIMPE", montoRecibido: "20.00" }),
        pendiente({ gestionId: "d", metodoPago: "transferencia", montoRecibido: "0.75" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totales).toEqual({
      efectivo: "15.25",
      simpe: "20.00",
      transferencia: "0.75",
      general: "36.00",
    });
  });

  it("R8: reprogramada/devuelta/rechazada cuentan $0 (set sin entregadas -> 0.00)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "reprogramada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "b", resultado: "devuelta", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totales).toEqual({
      efectivo: "0.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "0.00",
    });
  });

  it("R9: suma de 0.10 repetidos exacta (Decimal, sin error de punto flotante)", async () => {
    // 0.1 + 0.2 en float = 0.30000000000000004; con Decimal debe cuadrar exacto.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () =>
        Array.from({ length: 10 }, (_, i) =>
          pendiente({ gestionId: `g${i}`, metodoPago: "efectivo", montoRecibido: "0.10" }),
        ),
      ),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totales.efectivo).toBe("1.00");
    expect(r.totales.general).toBe("1.00");
  });
});

describe("listarCierreDia — gate de solicitar (R10/R11) y solo lectura (R17)", () => {
  it("R10: con ordenes pendientes -> puedesSolicitar false + motivo accionable", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 1),
      findGestionesPendientes: vi.fn(async () => [pendiente()]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.puedesSolicitar).toBe(false);
    expect(r.motivoBloqueo).toMatch(/gestion/i);
  });

  it("R11: sin gestiones pendientes -> puedesSolicitar false + motivo", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => []) });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.puedesSolicitar).toBe(false);
    expect(r.motivoBloqueo).not.toBeNull();
  });

  it("R10/R11: sin pendientes y con >=1 gestion -> puedesSolicitar true", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 0),
      findGestionesPendientes: vi.fn(async () => [pendiente()]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.puedesSolicitar).toBe(true);
    expect(r.motivoBloqueo).toBeNull();
  });

  it("R17: listar NO muta (nunca invoca crearCierre)", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => [pendiente()]) });
    const { service } = newService({ repo });
    await service.listarCierreDia(MENSAJERO);
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });
});

// --- solicitarCierre (R1, R10-R16) ---

describe("solicitarCierre — precondiciones (R1/R10/R11/R12)", () => {
  it("R1: rol != mensajero -> forbidden, sin tocar el repo", async () => {
    const { service, repo } = newService();
    const r = await service.solicitarCierre(OTRO_ROL);
    expect(r.status).toBe("forbidden");
    expect(repo.contarOrdenesPendientesGestion).not.toHaveBeenCalled();
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R10: con ordenes pendientes -> conflict, no crea", async () => {
    const repo = fakeRepo({ contarOrdenesPendientesGestion: vi.fn(async () => 2) });
    const { service } = newService({ repo });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "conflict" });
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R12: ya existe un cierre solicitado -> conflict, no crea", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 0),
      existeCierreSolicitado: vi.fn(async () => true),
    });
    const { service } = newService({ repo });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "conflict" });
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R11: sin gestiones pendientes -> conflict, no crea (no se cierra un dia vacio)", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 0),
      existeCierreSolicitado: vi.fn(async () => false),
      findGestionesPendientes: vi.fn(async () => []),
    });
    const { service } = newService({ repo });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "conflict" });
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });
});

describe("solicitarCierre — ruteo por zona (R15/R16) y snapshot (R13/R14)", () => {
  it("R16: mensajero sin zona -> validation_error, no crea", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => [pendiente()]) });
    const { service } = newService({ repo, zonaMensajero: null });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "validation_error" });
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors.zona).toBeDefined();
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R15: zona del mensajero == central -> destino bodega_central", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => [pendiente({ metodoPago: "efectivo", montoRecibido: "10.00" })]) });
    const { service } = newService({ repo, zonaMensajero: ZONA_CENTRAL, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "ok", destinoTipo: "bodega_central" });
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ mensajeroId: "m1", destinoTipo: "bodega_central", destinoZonaId: ZONA_CENTRAL });
  });

  it("R15: zona no-central -> destino bodega_satelite con su zona; R14 snapshot totales", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ metodoPago: "efectivo", montoRecibido: "10.00" }),
        pendiente({ gestionId: "g2", metodoPago: "SIMPE", montoRecibido: "5.00" }),
      ]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "ok", destinoTipo: "bodega_satelite" });
    if (r.status !== "ok") throw new Error("esperaba ok");
    // R14: los totales snapshot que se pasan al repo cuadran con las gestiones.
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.destinoZonaId).toBe(ZONA_MENSAJERO);
    expect(arg.totales).toEqual({ efectivo: "10.00", simpe: "5.00", transferencia: "0.00", general: "15.00" });
    expect(r.totales).toEqual(arg.totales);
  });

  it("R15 + design §6: findCentralZonaId null (feature 55 pendiente) -> fallback seguro a bodega_satelite, no lanza", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => [pendiente()]) });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: null });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "ok", destinoTipo: "bodega_satelite" });
  });
});

// --- Feature 39: pago al mensajero DERIVADO en vivo (R10/R11/R21) ---

describe("listarCierreDia — pago al mensajero derivado (R10/R11/R21)", () => {
  it("R10: expone pagoMensajero por orden (entregada -> cobroEntregado; resto -> 0.00)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "reprogramada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "d", resultado: "devuelta", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo }); // TARIFA_DEFECTO: cobroEntregado 5.00
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada[0].pagoMensajero).toBe("5.00"); // cobroEntregado
    expect(r.grupos.rechazada[0].pagoMensajero).toBe("0.00"); // NUNCA cobroRechazado
    expect(r.grupos.reprogramada[0].pagoMensajero).toBe("0.00");
    expect(r.grupos.devuelta[0].pagoMensajero).toBe("0.00");
    expect(typeof r.grupos.entregada[0].pagoMensajero).toBe("string"); // R23
  });

  it("R10: sin tarifa (gap de datos) -> pagoMensajero 0.00 en todas, no bloquea", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada" }),
      ]),
    });
    const { service } = newService({ repo, tarifa: null });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada[0].pagoMensajero).toBe("0.00");
    expect(r.totalPagoMensajero).toBe("0.00");
  });

  it("R11/R21: totalPagoMensajero es la suma de entregadas y NO altera los totales de dinero recibido", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "entregada", metodoPago: "SIMPE", montoRecibido: "8.00" }),
        pendiente({ gestionId: "c", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo }); // cobroEntregado 5.00 x2 = 10.00
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // R11: total del pago al mensajero (separado).
    expect(r.totalPagoMensajero).toBe("10.00");
    // R21: dinero recibido intacto (12 efectivo + 8 SIMPE), sin mezclar con el pago.
    expect(r.totales).toEqual({
      efectivo: "12.00",
      simpe: "8.00",
      transferencia: "0.00",
      general: "20.00",
    });
  });

  it("R4: resuelve la tarifa por la zona+vehiculo del MENSAJERO (usuarioId del actor)", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => [pendiente()]) });
    const { service, ordenRepo, tarifaZonaRepo } = newService({
      repo,
      zonaMensajero: ZONA_MENSAJERO,
      vehiculoMensajero: "veh-1",
    });
    await service.listarCierreDia(MENSAJERO);
    expect(ordenRepo.findUsuarioZonaId).toHaveBeenCalledWith("m1");
    expect(ordenRepo.findUsuarioVehiculoId).toHaveBeenCalledWith("m1");
    expect(tarifaZonaRepo.resolvePagoTarifa).toHaveBeenCalledWith(ZONA_MENSAJERO, "veh-1");
  });
});

// --- Feature 39: snapshot al solicitar (R12/R13/R15) ---

describe("solicitarCierre — snapshot del pago al mensajero (R12/R13)", () => {
  it("R12/R13: pasa a crearCierre el pago por gestion + el total, congelados con la tarifa vigente", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r.status).toBe("ok");
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // R12: pago snapshoteado por gestion (entregada 5.00, rechazada 0.00).
    expect(arg.pagoByGestionId).toEqual({ a: "5.00", b: "0.00" });
    // R13: total snapshot del cierre.
    expect(arg.totalPagoMensajero).toBe("5.00");
  });

  it("R12: sin tarifa aplicable -> snapshot 0.00 en todas y total 0.00, no bloquea el cierre", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada" }),
      ]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, tarifa: null });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r.status).toBe("ok");
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.pagoByGestionId).toEqual({ a: "0.00" });
    expect(arg.totalPagoMensajero).toBe("0.00");
  });
});

describe("listarCierreDia — snapshot congelado del historico (R15)", () => {
  it("R15: el total del cierre pasado sale del snapshot del repo, NO se re-deriva con la tarifa vigente", async () => {
    // Aunque la tarifa vigente sea 5.00, el cierre pasado ya congelo 99.99: no cambia.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => []),
      findCierresByMensajero: vi.fn(async () => [
        {
          cierreId: "c1",
          estado: "aprobado" as const,
          destinoTipo: "bodega_satelite" as const,
          destinoZonaId: ZONA_MENSAJERO,
          totales: { efectivo: "20.00", simpe: "0.00", transferencia: "0.00", general: "20.00" },
          totalPagoMensajero: "99.99", // snapshot congelado
          totalIngresoBodegaRechazos: "0.00",
          solicitadoAt: "2026-07-10T10:00:00.000Z",
        },
      ]),
    });
    const { service } = newService({ repo, tarifa: TARIFA_DEFECTO });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.cierresPasados[0].totalPagoMensajero).toBe("99.99"); // R15: no re-derivado
  });
});

// --- Feature 56: ingreso de bodega por rechazos DERIVADO en vivo (R2/R7b/R9/R10/R20/R23) ---

describe("listarCierreDia — ingreso de bodega por rechazos derivado (R9/R10)", () => {
  it("R9: expone ingresoBodegaRechazo por gestion (rechazada -> cobroRechazado; resto -> 0.00)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "reprogramada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "d", resultado: "devuelta", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo }); // TARIFA_DEFECTO: cobroRechazado 3.00
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.rechazada[0].ingresoBodegaRechazo).toBe("3.00"); // cobroRechazado
    expect(r.grupos.entregada[0].ingresoBodegaRechazo).toBe("0.00"); // no genera ingreso
    expect(r.grupos.reprogramada[0].ingresoBodegaRechazo).toBe("0.00");
    expect(r.grupos.devuelta[0].ingresoBodegaRechazo).toBe("0.00");
    expect(typeof r.grupos.rechazada[0].ingresoBodegaRechazo).toBe("string"); // R22
  });

  it("R10/R7b/R20: totalIngresoBodegaRechazos separado de totales y de pago mensajero; no los altera", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo }); // cobroEntregado 5.00, cobroRechazado 3.00
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // R10: total del ingreso de bodega = 3.00 x2 rechazadas.
    expect(r.totalIngresoBodegaRechazos).toBe("6.00");
    // R7b: el pago al mensajero (1 entregada x 5.00) queda intacto, NO recibe cobroRechazado.
    expect(r.totalPagoMensajero).toBe("5.00");
    // R20: dinero recibido intacto (solo la entregada de 12.00 efectivo).
    expect(r.totales).toEqual({
      efectivo: "12.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "12.00",
    });
  });

  it("R9: sin tarifa (gap de datos) -> ingreso 0.00 en todas, no bloquea", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [pendiente({ gestionId: "a", resultado: "rechazada", montoRecibido: null, metodoPago: null })]),
    });
    const { service } = newService({ repo, tarifa: null });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.rechazada[0].ingresoBodegaRechazo).toBe("0.00");
    expect(r.totalIngresoBodegaRechazos).toBe("0.00");
  });

  it("R2: resuelve el ingreso por la zona+vehiculo del MENSAJERO (usuarioId del actor), no de la orden", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [pendiente({ resultado: "rechazada", montoRecibido: null, metodoPago: null })]),
    });
    const { service, ordenRepo, tarifaZonaRepo } = newService({
      repo,
      zonaMensajero: ZONA_MENSAJERO,
      vehiculoMensajero: "veh-1",
    });
    await service.listarCierreDia(MENSAJERO);
    // Feature 56/R2: la tarifa (fuente del cobroRechazado) se resuelve por la zona del mensajero.
    expect(ordenRepo.findUsuarioZonaId).toHaveBeenCalledWith("m1");
    expect(tarifaZonaRepo.resolvePagoTarifa).toHaveBeenCalledWith(ZONA_MENSAJERO, "veh-1");
  });
});

describe("listarCierreDia — feature 102: /cierre-dia NO expone el desglose SLA (R11)", () => {
  it("R11: el resultado del mensajero NO trae `desgloseIngresoBodegaRechazos` (concepto de admin)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // El desglose SLA/manual solo existe en el detalle del admin (38/40); la vista del mensajero
    // no lo percibe (mismo criterio que la feature 56: el mensajero no ve el ingreso de bodega).
    expect(r).not.toHaveProperty("desgloseIngresoBodegaRechazos");
  });

  it("R11: cada gestion de la vista en vivo llega con esRechazoSla=false (sin clasificar el origen)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.rechazada[0].esRechazoSla).toBe(false);
  });
});

describe("listarCierreDia — flag tarifaFaltante server-side (R23)", () => {
  it("R23: tarifaFaltante=true cuando el resolver -> null (zona sin tarifa capturada)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo, tarifa: null });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // Aplica a entregas Y rechazos (reemplaza la heuristica de frontend de la 39).
    expect(r.grupos.entregada[0].tarifaFaltante).toBe(true);
    expect(r.grupos.rechazada[0].tarifaFaltante).toBe(true);
  });

  it("R23: tarifaFaltante=false cuando existe tarifa AUNQUE sus montos sean 0.00 (sin falso positivo)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    // Tarifa REAL con montos 0.00: pago 0.00 pero NO es tarifa faltante (arregla la deuda m1 de la 39).
    const { service } = newService({ repo, tarifa: { cobroEntregado: "0.00", cobroRechazado: "0.00" } });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada[0].pagoMensajero).toBe("0.00");
    expect(r.grupos.entregada[0].tarifaFaltante).toBe(false); // entrega legitima de 0.00, NO badge
    expect(r.grupos.rechazada[0].tarifaFaltante).toBe(false);
  });
});

describe("solicitarCierre — snapshot del ingreso de bodega por rechazos (R8/R11/R12/R14/R20)", () => {
  it("R11/R12: pasa a crearCierre el ingreso por gestion + el total, congelados con la tarifa vigente", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r.status).toBe("ok");
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // R11: ingreso snapshoteado por gestion (rechazadas 3.00; entregada 0.00).
    expect(arg.ingresoByGestionId).toEqual({ a: "0.00", b: "3.00", c: "3.00" });
    // R12: total snapshot del ingreso de bodega.
    expect(arg.totalIngresoBodegaRechazos).toBe("6.00");
  });

  it("R8/R20: el ingreso se snapshotea junto al destino del cierre, sin alterar pago mensajero ni totales", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "10.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "ok", destinoTipo: "bodega_satelite" });
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // R8: el ingreso viaja en el MISMO crearCierre que fija destinoTipo/destinoZonaId (bodega responsable).
    expect(arg.destinoTipo).toBe("bodega_satelite");
    expect(arg.destinoZonaId).toBe(ZONA_MENSAJERO);
    expect(arg.totalIngresoBodegaRechazos).toBe("3.00");
    // R20: pago al mensajero y totales de dinero recibido INTACTOS (carriles separados).
    expect(arg.totalPagoMensajero).toBe("5.00");
    expect(arg.totales).toEqual({ efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" });
  });

  it("R14: cambiar la tarifa DESPUES del cierre NO altera el snapshot leido del historico", async () => {
    // El cierre pasado ya congelo total_ingreso_bodega_rechazos=7.50; aunque la tarifa vigente
    // cambie, el historico lee el snapshot del repo, NO se re-deriva.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => []),
      findCierresByMensajero: vi.fn(async () => [
        {
          cierreId: "c1",
          estado: "aprobado" as const,
          destinoTipo: "bodega_satelite" as const,
          destinoZonaId: ZONA_MENSAJERO,
          totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
          totalPagoMensajero: "0.00",
          totalIngresoBodegaRechazos: "7.50", // snapshot congelado
          solicitadoAt: "2026-07-10T10:00:00.000Z",
        },
      ]),
    });
    // Tarifa vigente distinta (cobroRechazado 3.00): NO debe reemplazar el 7.50 congelado.
    const { service } = newService({ repo, tarifa: TARIFA_DEFECTO });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.cierresPasados[0].totalIngresoBodegaRechazos).toBe("7.50"); // R14: no re-derivado
  });
});

// ============================================================================
// Feature 67 — deshacerGestion: la REGLA (8 guardias de design §5.2).
// Cubre R1-R6, R8, R9, R18, R19, R29, R30, R32, R34 con dobles (sin DB/red).
// ============================================================================

describe("Feature 67 · deshacerGestion — ventana y elegibilidad (R1-R6)", () => {
  it("R1: gestion vigente (cierreId null, no anulada), la mas reciente, orden en su sitio -> ok", async () => {
    const { service, repo } = newService();

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledTimes(1);
  });

  it("R2: gestion YA vinculada a un cierre -> conflict accionable, SIN escribir", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () => gestionDeshacer({ cierreId: "c1" })),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/cierre/i);
    // La ventana murio: el dinero ya esta snapshoteado y la wallet lo cobrara al aprobar.
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R3: gestion YA anulada -> conflict, sin efectos (un 2.º envio no re-transiciona la orden)", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({ anuladaAt: new Date("2026-07-14T10:00:00.000Z") }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/ya fue deshecha/i);
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R4: existe una gestion posterior NO anulada -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () => gestionDeshacer({ gestionId: "g1" })),
      findUltimaGestionNoAnuladaId: vi.fn(async () => "g2"), // hay una mas reciente
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/mas reciente/i);
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R6: orden borrada (soft-delete) -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          orden: {
            deletedAt: new Date("2026-07-14T09:00:00.000Z"),
            estatusId: "s-entregada",
            estatusValue: "entregada",
          },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });
});

// R5: la guardia de "la orden no se movio" (F1.4-h), un caso por resultado. La tabla
// ESTADOS_ESPERADOS sale de crearGestionYTransicionar + resolverSeguimientoDevuelta.
describe("Feature 67 · deshacerGestion — guardia de estado de la orden (R5, F1.4-h)", () => {
  const CASOS_OK = [
    { resultado: "entregada" as const, estatusValue: "entregada", nota: "destino = resultado" },
    { resultado: "reprogramada" as const, estatusValue: "reprogramada", nota: "destino = resultado" },
    { resultado: "rechazada" as const, estatusValue: "rechazada", nota: "destino = resultado" },
    { resultado: "devuelta" as const, estatusValue: "en_bodega", nota: "47: reintento a central" },
    { resultado: "devuelta" as const, estatusValue: "en_bodega_satelite", nota: "47: reintento a satelite" },
    { resultado: "devuelta" as const, estatusValue: "rechazada", nota: "47: escalado al umbral" },
  ];

  for (const c of CASOS_OK) {
    it(`ok: gestion ${c.resultado} con la orden en ${c.estatusValue} (${c.nota})`, async () => {
      const repo = fakeRepo({
        findGestionParaDeshacer: vi.fn(async () =>
          gestionDeshacer({
            resultado: c.resultado,
            orden: { deletedAt: null, estatusId: "s-x", estatusValue: c.estatusValue },
          }),
        ),
      });
      const { service } = newService({ repo });
      const r = await service.deshacerGestion("g1", MENSAJERO);
      expect(r.status).toBe("ok");
    });
  }

  const CASOS_CONFLICT = [
    { resultado: "entregada" as const, estatusValue: "en_bodega", nota: "la bodega ya la recibio" },
    { resultado: "reprogramada" as const, estatusValue: "en_bodega", nota: "el cron de la 46 ya la libero" },
    { resultado: "rechazada" as const, estatusValue: "devuelta_origen", nota: "48: ya se devolvio a la tienda" },
    { resultado: "devuelta" as const, estatusValue: "en_reparto", nota: "la bodega la reasigno y ruteo" },
    { resultado: "entregada" as const, estatusValue: "en_preparacion", nota: "ajuste administrativo" },
  ];

  for (const c of CASOS_CONFLICT) {
    it(`conflict: gestion ${c.resultado} pero la orden esta en ${c.estatusValue} (${c.nota})`, async () => {
      const repo = fakeRepo({
        findGestionParaDeshacer: vi.fn(async () =>
          gestionDeshacer({
            resultado: c.resultado,
            orden: { deletedAt: null, estatusId: "s-x", estatusValue: c.estatusValue },
          }),
        ),
      });
      const { service } = newService({ repo });

      const r = await service.deshacerGestion("g1", MENSAJERO);

      expect(r.status).toBe("conflict");
      if (r.status !== "conflict") throw new Error("esperaba conflict");
      expect(r.motivo).toMatch(/bodega|no se puede deshacer/i); // accionable (F1.4-h)
      expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
    });
  }
});

describe("Feature 67 · deshacerGestion — autorizacion (R8/R9)", () => {
  it("R8 (F1.4-f): rol != mensajero -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", OTRO_ROL);

    expect(r).toEqual({ status: "forbidden" });
    // El admin NO tiene ventana para deshacer: ni siquiera se lee la gestion.
    expect(repo.findGestionParaDeshacer).not.toHaveBeenCalled();
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R9: gestion de OTRO mensajero -> forbidden, sin revelar datos ni escribir", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () => gestionDeshacer({ mensajeroId: "m2" })),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    // Resultado forbidden PELADO: sin motivo ni ningun dato de la gestion ajena.
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R9: gestion INEXISTENTE -> forbidden (no se distingue de ajena: no revela existencia)", async () => {
    const repo = fakeRepo({ findGestionParaDeshacer: vi.fn(async () => null) });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("no-existe", MENSAJERO);

    expect(r).toEqual({ status: "forbidden" }); // mismo resultado que la ajena (patron 36/R31)
  });
});

describe("Feature 67 · deshacerGestion — transicion y efectos (R18/R19/R29/R30/R32/R34)", () => {
  it("R18/R19: pide al repo `en_reparto` como destino y el mensajero AUTOR como asignado", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "devuelta",
          // 47: el seguimiento del reintento habia limpiado `mensajero_asignado_id`.
          orden: { deletedAt: null, estatusId: "s-bodega", estatusValue: "en_bodega" },
        }),
      ),
    });
    const { service, ordenRepo } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(ordenRepo.findEstatusIdByValue).toHaveBeenCalledWith("en_reparto"); // R18
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledWith({
      gestionId: "g1",
      ordenId: "o1",
      mensajeroId: "m1", // R19: repone la asignacion al autor, aunque el reintento la limpio
      actorUsuarioId: "m1", // R11/R20: rastro de quien deshizo
      estatusEsperadoId: "s-bodega", // R5: id REAL leido (guardia optimista de la escritura)
      estatusEnRepartoId: "s-reparto", // R18
    });
  });

  it("R22: el repo devuelve false (carrera: guardia perdida en la tx) -> conflict", async () => {
    const repo = fakeRepo({ anularGestionYDevolverAGestion: vi.fn(async () => false) });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict"); // sin efectos parciales: la tx hizo rollback
  });

  it("catalogo sin `en_reparto` (seed pendiente) -> validation_error, sin escribir", async () => {
    const repo = fakeRepo();
    const { service } = newService({ repo, estatusEnRepartoId: null });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("validation_error");
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R29/R30 (F1.4-c): el mensajero con OTRA orden activa en gestion PUEDE deshacer igual", async () => {
    // El puntero 1-a-1 (`usuario.orden_en_gestion_id`) NO participa del deshacer: el service ni
    // lo lee ni lo escribe (su Pick del ordenRepo no incluye metodos de puntero). Deshacer no
    // se bloquea por tener otra orden activa — justo el caso en el que hay que corregir el error.
    const repo = fakeRepo();
    const { service, ordenRepo } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("ok");
    const metodos = Object.keys(ordenRepo);
    expect(metodos).not.toContain("getOrdenEnGestion");
    expect(metodos).not.toContain("setOrdenEnGestion");
    expect(metodos).not.toContain("liberarOrdenEnGestion");
  });

  it("R32: NUNCA borra la evidencia del bucket (el service no tiene storage de escritura)", async () => {
    const repo = fakeRepo();
    const { service, signedUrls } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("ok");
    // El unico colaborador de storage del service es el firmador de URLs (solo lectura): no
    // existe `remove`. `evidencia_storage_path` tampoco viaja en el input del repo (R12).
    expect("remove" in signedUrls).toBe(false);
    const input = (repo.anularGestionYDevolverAGestion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.evidenciaStoragePath).toBeUndefined();
  });

  it("R34: deshacer una `entregada` con monto NO produce movimiento de wallet/tienda/pago", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () => gestionDeshacer({ resultado: "entregada" })),
    });
    const { service, tarifaZonaRepo } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("ok");
    // El dinero solo se asienta al APROBAR el cierre (los feeds leen por `cierreId`), y esta
    // gestion tiene cierre_id = NULL: no hay asiento que compensar (F1.4-g). El deshacer ni
    // siquiera resuelve tarifas.
    expect(tarifaZonaRepo.resolvePagoTarifa).not.toHaveBeenCalled();
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });
});

// T19 (R13/R14/R15): una gestion anulada desaparece de la vista Y de los derivados. La
// exclusion ocurre aguas arriba (el WHERE del repo, T6): aqui se prueba el efecto END-TO-END
// sobre grupos + totales + pago al mensajero (39) + ingreso de bodega (56).
describe("Feature 67 · gestion anulada ausente de la vista y los totales (R13/R14/R15)", () => {
  it("R13/R14/R15: la lista SIN la anulada -> no aparece en los grupos ni suma a ningun total", async () => {
    // El repo (con `anuladaAt: null` en su WHERE) devuelve SOLO la vigente: una anulada de
    // 20.00 en efectivo ni se lista ni suma.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "g-vigente", montoRecibido: "12.50", metodoPago: "efectivo" }),
      ]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // R13: un solo grupo con una sola fila; la anulada no esta en ninguno de los 4.
    expect(r.grupos.entregada).toHaveLength(1);
    expect(r.grupos.entregada[0].gestionId).toBe("g-vigente");
    const todas = [
      ...r.grupos.entregada,
      ...r.grupos.reprogramada,
      ...r.grupos.devuelta,
      ...r.grupos.rechazada,
    ];
    expect(todas.map((g) => g.gestionId)).not.toContain("g-anulada");
    // R14: totales por metodo + general SIN la anulada (12.50, no 32.50).
    expect(r.totales).toEqual({
      efectivo: "12.50",
      simpe: "0.00",
      transferencia: "0.00",
      general: "12.50",
    });
    // R15: los derivados 39/56 tampoco la cuentan (una sola entregada -> 5.00 de pago).
    expect(r.totalPagoMensajero).toBe("5.00");
    expect(r.totalIngresoBodegaRechazos).toBe("0.00");
  });

  it("R13/R14: si TODAS las gestiones del dia estan anuladas, el dia queda vacio (totales en 0)", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => []) });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    expect(r.grupos).toEqual({ entregada: [], reprogramada: [], devuelta: [], rechazada: [] });
    expect(r.totales.general).toBe("0.00");
    expect(r.totalPagoMensajero).toBe("0.00");
    expect(r.totalIngresoBodegaRechazos).toBe("0.00");
    expect(r.puedesSolicitar).toBe(false); // R11: no se cierra un dia vacio
  });

  it("R15/R16: `solicitarCierre` snapshotea SOLO las vigentes (la anulada no entra al cierre)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "g-vigente", montoRecibido: "12.50", metodoPago: "efectivo" }),
      ]),
    });
    const { service } = newService({ repo, centralZonaId: ZONA_CENTRAL });

    const r = await service.solicitarCierre(MENSAJERO);
    expect(r.status).toBe("ok");

    // El snapshot consume la MISMA lista filtrada: la anulada no aparece en `pagoByGestionId`
    // ni en `ingresoByGestionId`, y los totales congelados la excluyen.
    const input = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(input.pagoByGestionId)).toEqual(["g-vigente"]);
    expect(Object.keys(input.ingresoByGestionId)).toEqual(["g-vigente"]);
    expect(input.totales.general).toBe("12.50");
  });
});

// ============================================================================
// Feature 111 — solicitarCierre: rama del `vencido` (R6/R7/R9/R10/R11) + B2 tieneVencido (R13).
// ============================================================================

describe("Feature 111 · solicitarCierre — transición del vencido (R6/R9/R10)", () => {
  it("R6: con un vencido -> transiciona (via vencido_solicitado), NO crea un cierre nuevo", async () => {
    const repo = fakeRepo({
      existeCierreVencido: vi.fn(async () => true),
      transicionarVencidoASolicitado: vi.fn(async () => true),
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "vencido_solicitado" });
    expect(repo.transicionarVencidoASolicitado).toHaveBeenCalledWith("m1");
    // R6/R10: no se inserta una segunda fila cierre_dia (no pasa por el flujo de creación).
    expect(repo.crearCierre).not.toHaveBeenCalled();
    expect(repo.existeCierreSolicitado).not.toHaveBeenCalled();
    expect(repo.findGestionesPendientes).not.toHaveBeenCalled(); // R8: sin snapshot nuevo
  });

  it("R9 (anti-deadlock): con un vencido + órdenes pendientes -> transiciona igual, sin conflict por pendientes", async () => {
    // El mensajero está bloqueado para gestionar (R1) — si además la precondición de pendientes
    // aplicara, quedaría atrapado. La rama del vencido NO consulta `contarOrdenesPendientesGestion`.
    const repo = fakeRepo({
      existeCierreVencido: vi.fn(async () => true),
      transicionarVencidoASolicitado: vi.fn(async () => true),
      contarOrdenesPendientesGestion: vi.fn(async () => 3), // hay órdenes en_reparto
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r.status).toBe("ok");
    expect(repo.contarOrdenesPendientesGestion).not.toHaveBeenCalled(); // R9
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R7: el vencido ya fue transicionado (updateMany 0 filas) -> conflict, sin crear", async () => {
    const repo = fakeRepo({
      existeCierreVencido: vi.fn(async () => true),
      transicionarVencidoASolicitado: vi.fn(async () => false), // carrera
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R11: SIN vencido -> flujo de creación de la 37 SIN cambios (crea, via creado)", async () => {
    const repo = fakeRepo({
      existeCierreVencido: vi.fn(async () => false),
      findGestionesPendientes: vi.fn(async () => [pendiente({ metodoPago: "efectivo", montoRecibido: "10.00" })]),
    });
    const { service } = newService({ repo, centralZonaId: ZONA_CENTRAL });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado" });
    expect(repo.transicionarVencidoASolicitado).not.toHaveBeenCalled();
    expect(repo.crearCierre).toHaveBeenCalledTimes(1); // flujo 37 intacto
  });
});

describe("Feature 111 · listarCierreDia — tieneVencido derivado (R13-datos)", () => {
  const cierrePasado = (estado: "solicitado" | "aprobado" | "rechazado" | "vencido") => ({
    cierreId: `c-${estado}`,
    estado,
    destinoTipo: "bodega_satelite" as const,
    destinoZonaId: ZONA_MENSAJERO,
    totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-07-10T10:00:00.000Z",
  });

  it("R13: tieneVencido=true cuando hay un cierre vencido en el histórico", async () => {
    const repo = fakeRepo({
      findCierresByMensajero: vi.fn(async () => [cierrePasado("vencido")]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.tieneVencido).toBe(true);
  });

  it("R13: tieneVencido=false sin ningún vencido (solicitado/aprobado/rechazado no cuentan)", async () => {
    const repo = fakeRepo({
      findCierresByMensajero: vi.fn(async () => [cierrePasado("aprobado"), cierrePasado("rechazado")]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.tieneVencido).toBe(false);
  });
});

// ============================================================================
// Feature 109 — solicitarCierre: rama `rechazado -> solicitado` (R28) + tieneRechazado (R31-datos).
// Modelo GLOBAL: un `rechazado` YA NO es terminal — bloquea y es RE-SOLICITABLE (espejo del vencido).
// ============================================================================

describe("Feature 109 · solicitarCierre — re-solicitar un `rechazado` (R28)", () => {
  it("R28: con un rechazado -> transiciona (via rechazado_solicitado), NO crea un cierre nuevo", async () => {
    const repo = fakeRepo({
      existeCierreVencido: vi.fn(async () => false),
      existeCierreRechazado: vi.fn(async () => true),
      transicionarRechazadoASolicitado: vi.fn(async () => true),
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "rechazado_solicitado" });
    expect(repo.transicionarRechazadoASolicitado).toHaveBeenCalledWith("m1");
    // R28: NO pasa por el flujo de creación (no crea un cierre nuevo).
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R28: EXENTO de la precondición de pendientes (anti-deadlock): re-solicita aunque haya pendientes", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 3), // pendientes: el vencido/rechazado los ignora
      existeCierreVencido: vi.fn(async () => false),
      existeCierreRechazado: vi.fn(async () => true),
      transicionarRechazadoASolicitado: vi.fn(async () => true),
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "rechazado_solicitado" });
  });

  it("R28: carrera (transición afecta 0 filas) -> conflict, sin crear", async () => {
    const repo = fakeRepo({
      existeCierreVencido: vi.fn(async () => false),
      existeCierreRechazado: vi.fn(async () => true),
      transicionarRechazadoASolicitado: vi.fn(async () => false), // ya re-solicitado/resuelto
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R28: el `vencido` tiene prioridad sobre el `rechazado` (a lo sumo uno abierto, R30)", async () => {
    const repo = fakeRepo({
      existeCierreVencido: vi.fn(async () => true),
      transicionarVencidoASolicitado: vi.fn(async () => true),
      existeCierreRechazado: vi.fn(async () => true),
      transicionarRechazadoASolicitado: vi.fn(async () => true),
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "vencido_solicitado" });
    // R30: nunca coexisten; se toma el vencido y no se toca el rechazado.
    expect(repo.transicionarRechazadoASolicitado).not.toHaveBeenCalled();
  });

  it("R11: sin vencido ni rechazado -> flujo de creación normal (regresión 37/111 verde)", async () => {
    const repo = fakeRepo({
      existeCierreVencido: vi.fn(async () => false),
      existeCierreRechazado: vi.fn(async () => false),
      findGestionesPendientes: vi.fn(async () => [pendiente()]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: ZONA_CENTRAL });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado" });
    expect(repo.transicionarRechazadoASolicitado).not.toHaveBeenCalled();
  });
});

describe("Feature 109 · listarCierreDia — tieneRechazado derivado (R31-datos)", () => {
  const cierrePasado = (estado: "solicitado" | "aprobado" | "rechazado" | "vencido") => ({
    cierreId: `c-${estado}`,
    estado,
    destinoTipo: "bodega_satelite" as const,
    destinoZonaId: ZONA_MENSAJERO,
    totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-07-10T10:00:00.000Z",
  });

  it("R31: tieneRechazado=true cuando hay un cierre rechazado en el histórico", async () => {
    const repo = fakeRepo({ findCierresByMensajero: vi.fn(async () => [cierrePasado("rechazado")]) });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.tieneRechazado).toBe(true);
  });

  it("R31: tieneRechazado=false sin ningún rechazado (solicitado/aprobado/vencido no cuentan)", async () => {
    const repo = fakeRepo({
      findCierresByMensajero: vi.fn(async () => [cierrePasado("aprobado"), cierrePasado("vencido")]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.tieneRechazado).toBe(false);
  });
});

// ============================================================================
// Feature 111 — deshacerGestion: bloqueo total EXPLÍCITO (R5/R20, Q2).
// ============================================================================

describe("Feature 111 · deshacerGestion — bloqueo total del mensajero (R5/R20)", () => {
  it("R5: mensajero BLOQUEADO (vencido/solicitado) -> conflict, sin leer ni anular la gestión", async () => {
    const repo = fakeRepo();
    const { service, ordenRepo } = newService({ repo, bloqueados: ["m1"] });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    // R5 (Q2, belt-and-suspenders): usa el MISMO predicado derivado, ANTES de cualquier lectura.
    expect(ordenRepo.findMensajerosBloqueados).toHaveBeenCalledWith(["m1"]);
    expect(repo.findGestionParaDeshacer).not.toHaveBeenCalled();
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled(); // sin devolver a en_reparto
  });

  it("R20: el motivo del bloqueo es texto fijo SIN PII (ni ids de cierre ni del actor)", async () => {
    const repo = fakeRepo();
    const { service } = newService({ repo, bloqueados: ["m1"] });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/cierre pendiente/i);
    expect(r.motivo).not.toMatch(/m1|g1|c1/); // sin ids del actor/gestión/cierre
  });

  it("R5: mensajero NO bloqueado -> el deshacer procede (regresión 67 verde)", async () => {
    const repo = fakeRepo();
    const { service } = newService({ repo, bloqueados: [] });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledTimes(1);
  });
});
