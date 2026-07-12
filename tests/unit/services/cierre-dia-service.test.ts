import { describe, it, expect, vi } from "vitest";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type {
  CierreGestionPendienteRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
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
    ...overrides,
  };
}

type Repo = ICierreDiaRepository;

function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    findGestionesPendientes: vi.fn(async () => [] as CierreGestionPendienteRow[]),
    contarOrdenesPendientesGestion: vi.fn(async () => 0),
    existeCierreSolicitado: vi.fn(async () => false),
    crearCierre: vi.fn(async () => "c1"),
    findCierresByMensajero: vi.fn(async () => []),
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
  signedUrls?: ISignedUrlProvider;
} = {}) {
  const repo = opts.repo ?? fakeRepo();
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => opts.centralZonaId ?? null),
  } as unknown as Pick<IZonaRepository, "findCentralZonaId">;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => (opts.zonaMensajero === undefined ? ZONA_MENSAJERO : opts.zonaMensajero)),
  } as unknown as Pick<IOrdenRepository, "findUsuarioZonaId">;
  const signedUrls = opts.signedUrls ?? fakeSignedUrls();
  const service = new CierreDiaService(
    repo,
    zonaRepo as IZonaRepository,
    ordenRepo as IOrdenRepository,
    signedUrls,
  );
  return { service, repo, zonaRepo, ordenRepo, signedUrls };
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
