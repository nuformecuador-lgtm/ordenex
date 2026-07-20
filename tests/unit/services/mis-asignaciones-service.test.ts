import { describe, it, expect, vi } from "vitest";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import type {
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GestionarInput } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const OTRO: Actor = { usuarioId: "m2", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

// Feature 47: zona central (para clasificar bodega_central) usada por el doble de zonaRepo.
const ZONA_CENTRAL = "z-central";

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_espera_aceptacion: "os-espera",
  en_reparto: "os-reparto",
  entregada: "os-entregada",
  reprogramada: "os-reprogramada",
  devuelta: "os-devuelta",
  rechazada: "os-rechazada",
  // Feature 47: destinos de la transicion de seguimiento (reintento a bodega).
  en_bodega: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
};

function gestionRow(overrides: Partial<OrdenGestionRow> = {}): OrdenGestionRow {
  return {
    id: "o1",
    estatusValue: "en_reparto",
    deletedAt: null,
    mensajeroAsignadoId: "m1",
    montoCobrar: 100,
    zonaId: "z-satelite", // feature 47: por defecto una zona satelite (no la central)
    ...overrides,
  };
}

function asignacionRow(overrides: Partial<MiAsignacionRow> = {}): MiAsignacionRow {
  return {
    id: "o1",
    numGuia: 1,
    numRemision: "R-1",
    estatusValue: "en_espera_aceptacion",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle",
    producto: "caja",
    peso: null,
    montoCobrar: 100,
    notas: null,
    tiendaNombre: "T",
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: "D",
    mensajeroAsignadoId: "m1",
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<IGestionOrdenRepository> = {}): IGestionOrdenRepository {
  return {
    findMisAsignaciones: vi.fn(async () => []),
    contarEntregadas: vi.fn(async () => 0),
    sumMontoCobrarEntregadas: vi.fn(async () => 0),
    findByIdsParaGestion: vi.fn(async () => [gestionRow()]),
    getOrdenEnGestion: vi.fn(async () => null),
    setOrdenEnGestion: vi.fn(async () => true),
    liberarOrdenEnGestion: vi.fn(async () => true),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    crearGestionYTransicionar: vi.fn(async () => "g1"),
    ...overrides,
  };
}

function fakeOrdenRepo(): Pick<IOrdenRepository, "findEstatusIdByValue"> {
  return {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
  };
}

// Feature 47: derivador de intentos (49). Por defecto 0 previos -> intento actual 1 (< umbral
// default 3 -> reintento). Los tests de escalado inyectan un conteo mayor.
function fakeHistorial(
  overrides: Partial<Pick<IOrdenHistorialService, "contarIntentos">> = {},
): Pick<IOrdenHistorialService, "contarIntentos"> {
  return {
    contarIntentos: vi.fn(async () => 0),
    ...overrides,
  };
}

// Feature 47: zona central para la bodega responsable (54). Por defecto ZONA_CENTRAL.
function fakeZonaRepo(
  overrides: Partial<Pick<IZonaRepository, "findCentralZonaId">> = {},
): Pick<IZonaRepository, "findCentralZonaId"> {
  return {
    findCentralZonaId: vi.fn(async () => ZONA_CENTRAL),
    ...overrides,
  };
}

function fakeStorage(overrides: Partial<IFileStorage> = {}): IFileStorage {
  return {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeSignedUrls(): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async (path: string) => `https://signed/${path}`),
    createSignedUrls: vi.fn(async () => ({})),
  };
}


/**
 * Feature 92 (R23/R28): doble del repo de ruta optimizada. Por defecto NO hay ruta
 * (`findByMensajero` -> null), que es el estado de un mensajero que nunca se optimizo: en
 * ese caso `porGestionar` conserva EXACTAMENTE el orden previo, asi que los tests
 * heredados de la 36/47/73 siguen midiendo lo mismo que antes.
 */
function fakeRutaRepo(
  over: Partial<Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen">> = {},
): Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen"> {
  return {
    findByMensajero: vi.fn(async () => null),
    upsertOrigen: vi.fn(async () => {}),
    ...over,
  };
}

function newService(
  repo: IGestionOrdenRepository = fakeRepo(),
  storage: IFileStorage = fakeStorage(),
  signed: ISignedUrlProvider = fakeSignedUrls(),
  historial: Pick<IOrdenHistorialService, "contarIntentos"> = fakeHistorial(),
  zonaRepo: Pick<IZonaRepository, "findCentralZonaId"> = fakeZonaRepo(),
  rutaRepo: Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen"> = fakeRutaRepo(),
) {
  return new MisAsignacionesService(
    repo,
    fakeOrdenRepo(),
    storage,
    signed,
    historial,
    zonaRepo,
    rutaRepo,
  );
}

function evidencia() {
  return { contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) };
}

// --- listarMisAsignaciones (R9-R13) ---

describe("listarMisAsignaciones (R9-R13)", () => {
  it("R12: rol != mensajero -> forbidden", async () => {
    const r = await newService().listarMisAsignaciones(MAESTRO);
    expect(r.status).toBe("forbidden");
  });

  it("R10/R13: separa por recoger (en_espera_aceptacion) de por gestionar (en_reparto) + ordenEnGestionId", async () => {
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "a", estatusValue: "en_espera_aceptacion" }),
        asignacionRow({ id: "b", estatusValue: "en_reparto" }),
      ]),
      getOrdenEnGestion: vi.fn(async () => "b"),
    });
    const r = await newService(repo).listarMisAsignaciones(MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.porRecoger.map((o) => o.id)).toEqual(["a"]);
    expect(r.porGestionar.map((o) => o.id)).toEqual(["b"]);
    expect(r.ordenEnGestionId).toBe("b");
    // R13: la consulta se hizo con el mensajero del actor.
    expect(repo.findMisAsignaciones).toHaveBeenCalledWith("m1", [
      "en_espera_aceptacion",
      "en_reparto",
    ]);
  });

  it("Feature 61: KPIs = pendientes (en_reparto), entregadas (conteo) y porCobrar (suma COD de en_reparto; null=0)", async () => {
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "a", estatusValue: "en_espera_aceptacion", montoCobrar: 999 }),
        asignacionRow({ id: "b", estatusValue: "en_reparto", montoCobrar: 100 }),
        asignacionRow({ id: "c", estatusValue: "en_reparto", montoCobrar: 250 }),
        asignacionRow({ id: "d", estatusValue: "en_reparto", montoCobrar: null }),
      ]),
      contarEntregadas: vi.fn(async () => 7),
      // COD ya entregado (400): alimenta 'Total a cobrar' junto al COD de en_reparto (350).
      sumMontoCobrarEntregadas: vi.fn(async () => 400),
    });
    const r = await newService(repo).listarMisAsignaciones(MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // pendientes = # en_reparto (no cuenta por recoger); porCobrar suma solo en_reparto,
    // null cuenta 0 (100 + 250 + 0); entregadas viene del conteo del repo.
    // totalACobrar = COD en_reparto (350) + COD entregado (400) = 750 (acumulado, no baja
    // al entregar; reprogramada/devuelta/rechazada quedan fuera de ambos sets).
    expect(r.kpis).toEqual({
      pendientes: 3,
      entregadas: 7,
      porCobrar: 350,
      totalACobrar: 750,
    });
    expect(repo.contarEntregadas).toHaveBeenCalledWith("m1");
    expect(repo.sumMontoCobrarEntregadas).toHaveBeenCalledWith("m1");
  });
});

// --- recogerAsignaciones (R14-R17) ---

describe("recogerAsignaciones (R14-R17)", () => {
  it("R12: rol != mensajero -> forbidden", async () => {
    const r = await newService().recogerAsignaciones({ ordenIds: ["o1"] }, MAESTRO);
    expect(r.status).toBe("forbidden");
  });

  it("R15/R16: recoge el lote (en_espera_aceptacion -> en_reparto) de sus ordenes", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1", estatusValue: "en_espera_aceptacion" }),
        gestionRow({ id: "o2", estatusValue: "en_espera_aceptacion" }),
      ]),
    });
    const r = await newService(repo).recogerAsignaciones({ ordenIds: ["o1", "o2"] }, MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.recogidas.sort()).toEqual(["o1", "o2"]);
    expect(repo.recogerLote).toHaveBeenCalledWith(["o1", "o2"], "m1", "os-espera", "os-reparto");
  });

  it("R17: orden de OTRO mensajero -> forbidden, sin recoger", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1", estatusValue: "en_espera_aceptacion", mensajeroAsignadoId: "m2" }),
      ]),
    });
    const r = await newService(repo).recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.recogerLote).not.toHaveBeenCalled();
  });

  it("R17: origen invalido (no en_espera_aceptacion) -> conflict, sin recoger", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1", estatusValue: "en_reparto" }),
      ]),
    });
    const r = await newService(repo).recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO);
    expect(r.status).toBe("conflict");
    expect(repo.recogerLote).not.toHaveBeenCalled();
  });

  // Feature 46/R4: una orden reprogramada NO es origen valido de "recoger"; el bloqueo de
  // envio es inherente a la maquina de estados (se verifica explicitamente, sin codigo nuevo).
  it("feature 46/R4: recoger una orden reprogramada -> conflict por origen, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1", estatusValue: "reprogramada", mensajeroAsignadoId: "m1" }),
      ]),
    });
    const r = await newService(repo).recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO);
    expect(r.status).toBe("conflict");
    expect(repo.recogerLote).not.toHaveBeenCalled();
  });
});

// --- escogerParaGestion (R19-R21) ---

describe("escogerParaGestion (R19-R21)", () => {
  it("R19: fija la orden activa (en_reparto, propia)", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).escogerParaGestion("o1", MENSAJERO);
    expect(r.status).toBe("ok");
    expect(repo.setOrdenEnGestion).toHaveBeenCalledWith("m1", "o1");
  });

  it("R21: ya hay OTRA orden activa -> conflict", async () => {
    const repo = fakeRepo({ setOrdenEnGestion: vi.fn(async () => false) });
    const r = await newService(repo).escogerParaGestion("o1", MENSAJERO);
    expect(r.status).toBe("conflict");
  });

  it("R31: orden ajena -> forbidden", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ mensajeroAsignadoId: "m2" })]),
    });
    const r = await newService(repo).escogerParaGestion("o1", OTRO);
    // OTRO es m2, la orden es de m2 -> ok; probamos el caso ajeno real:
    expect(r.status).toBe("ok");

    const repo2 = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ mensajeroAsignadoId: "m2" })]),
    });
    const r2 = await newService(repo2).escogerParaGestion("o1", MENSAJERO);
    expect(r2.status).toBe("forbidden");
  });
});

// --- gestionar (R18, R22-R32) ---

describe("gestionar — guardias (R12/R18/R21/R31)", () => {
  it("R12: rol != mensajero -> forbidden", async () => {
    const r = await newService().gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencia: evidencia() },
      MAESTRO,
    );
    expect(r.status).toBe("forbidden");
  });

  it("R18: origen no en_reparto (aun en_espera_aceptacion) -> conflict, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_espera_aceptacion" }),
      ]),
    });
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencia: evidencia() },
      MENSAJERO,
    );
    expect(r.status).toBe("conflict");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R31: orden ajena -> forbidden, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ mensajeroAsignadoId: "m2" })]),
    });
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencia: evidencia() },
      MENSAJERO,
    );
    expect(r.status).toBe("forbidden");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R21: otra orden activa distinta -> conflict, sin persistir", async () => {
    const repo = fakeRepo({ getOrdenEnGestion: vi.fn(async () => "o-otra") });
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencia: evidencia() },
      MENSAJERO,
    );
    expect(r.status).toBe("conflict");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  // Feature 46/R4: gestionar exige origen en_reparto; una orden reprogramada se rechaza
  // por origen (bloqueo de "envio" inherente a la maquina de estados).
  it("feature 46/R4: gestionar una orden reprogramada -> conflict por origen, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1", estatusValue: "reprogramada", mensajeroAsignadoId: "m1" }),
      ]),
    });
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencia: evidencia() },
      MENSAJERO,
    );
    expect(r.status).toBe("conflict");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });
});

describe("gestionar — ENTREGADA (R22/R23/R32)", () => {
  const entrega = (monto: number): GestionarInput => ({
    ordenId: "o1",
    resultado: "entregada",
    montoRecibido: monto,
    metodoPago: "efectivo",
    evidencia: evidencia(),
  });

  it("R22 (h): monto != montoCobrar -> validation_error, NO sube ni persiste", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(entrega(50), MENSAJERO);
    expect(r.status).toBe("validation_error");
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  // menor-2: comparacion en Decimal EXACTA (no float).
  it("menor-2: monto == montoCobrar EXACTO -> ok (comparacion Decimal)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: 100 })]),
    });
    const r = await newService(repo).gestionar(entrega(100), MENSAJERO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.montoRecibido).toBe(100);
  });

  it("menor-2: diferencia minima (100.01 vs 100) -> validation_error, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: 100 })]),
    });
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(entrega(100.01), MENSAJERO);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(r.fieldErrors.montoRecibido).toBeDefined();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("menor-2: montoCobrar null + monto 100 -> validation_error (100 no cuadra con 0)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: null })]),
    });
    const r = await newService(repo).gestionar(entrega(100), MENSAJERO);
    expect(r.status).toBe("validation_error");
  });

  it("sin cobro: montoCobrar 0 + monto 0 -> ok (entrega sin recaudo)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: 0 })]),
    });
    const r = await newService(repo).gestionar(entrega(0), MENSAJERO);
    expect(r.status).toBe("ok");
  });

  it("sin cobro: montoCobrar null + monto 0 -> ok (null cuadra con 0)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: null })]),
    });
    const r = await newService(repo).gestionar(entrega(0), MENSAJERO);
    expect(r.status).toBe("ok");
  });

  it("R23/R32: entrega valida -> sube foto, crea gestion(entregada), deja estado entregada + URL firmada", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const signed = fakeSignedUrls();
    const r = await newService(repo, storage, signed).gestionar(entrega(100), MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.estado).toBe("entregada");
    expect(r.evidenciaUrl).toMatch(/^https:\/\/signed\//);
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.resultado).toBe("entregada");
    expect(gArg.gestion.montoRecibido).toBe(100);
    expect(gArg.gestion.metodoPago).toBe("efectivo");
    expect(gArg.gestion.evidenciaStoragePath).toContain("o1/entregada-");
    expect(gArg.nuevoEstatusId).toBe("os-entregada");
  });

  it("R8: persiste storage_path (no URL); la URL solo se firma para mostrar", async () => {
    const repo = fakeRepo();
    await newService(repo).gestionar(entrega(100), MENSAJERO);
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.evidenciaStoragePath).not.toMatch(/^https?:\/\//);
  });

  it("R23: si la transaccion falla tras subir -> limpia el objeto (best-effort) y propaga", async () => {
    const storage = fakeStorage();
    const repo = fakeRepo({
      crearGestionYTransicionar: vi.fn(async () => {
        throw new Error("db caida");
      }),
    });
    await expect(newService(repo, storage).gestionar(entrega(100), MENSAJERO)).rejects.toThrow(
      "db caida",
    );
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });
});

describe("gestionar — REPROGRAMAR / DEVOLUCION / RECHAZO (R26/R28/R30/R32)", () => {
  it("R26: reprogramar valida -> gestion(reprogramada) + estado reprogramada, sin storage", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(
      { ordenId: "o1", resultado: "reprogramada", fechaReprogramacion: "2027-01-01", motivo: "x" },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    expect(storage.upload).not.toHaveBeenCalled();
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.resultado).toBe("reprogramada");
    expect(gArg.nuevoEstatusId).toBe("os-reprogramada");
  });

  it("R28 + pedido: devolucion valida -> sube foto, gestion(devuelta) con evidencia + estado devuelta", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(
      { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "no estaba", evidencia: evidencia() },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    // Pedido: la devolución ahora sube y persiste la evidencia (como rechazo/entrega).
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.resultado).toBe("devuelta");
    expect(gArg.gestion.evidenciaStoragePath).toContain("o1/devuelta-");
    expect(gArg.gestion.evidenciaContentType).toBe("image/jpeg");
    expect(gArg.nuevoEstatusId).toBe("os-devuelta");
  });

  it("feature 75: devolucion con transaccion fallida -> limpia storage y propaga", async () => {
    const storage = fakeStorage();
    const repo = fakeRepo({
      crearGestionYTransicionar: vi.fn(async () => {
        throw new Error("db caida");
      }),
    });
    await expect(
      newService(repo, storage).gestionar(
        { ordenId: "o1", resultado: "devuelta", causaDevolucion: "not_found", motivo: "x", evidencia: evidencia() },
        MENSAJERO,
      ),
    ).rejects.toThrow("db caida");
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it("R30: rechazo valido -> sube foto, gestion(rechazada) + estado rechazada", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(
      { ordenId: "o1", resultado: "rechazada", motivo: "cliente rechazo", evidencia: evidencia() },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.estado).toBe("rechazada");
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.resultado).toBe("rechazada");
    expect(gArg.gestion.evidenciaStoragePath).toContain("o1/rechazada-");
    expect(gArg.nuevoEstatusId).toBe("os-rechazada");
  });

  it("R30: rechazo con transaccion fallida -> limpia storage y propaga", async () => {
    const storage = fakeStorage();
    const repo = fakeRepo({
      crearGestionYTransicionar: vi.fn(async () => {
        throw new Error("db caida");
      }),
    });
    await expect(
      newService(repo, storage).gestionar(
        { ordenId: "o1", resultado: "rechazada", motivo: "x", evidencia: evidencia() },
        MENSAJERO,
      ),
    ).rejects.toThrow("db caida");
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });
});

// --- FEATURE 47: reintento vs escalado en la rama DEVUELTA (R1/R2/R4/R5/R8/R9/R13/R19) ---

describe("gestionar — DEVUELTA: reintento vs escalado (feature 47)", () => {
  // Feature 73/R6: la rama `devuelta` ahora exige causa. Se añade al input SIN cambiar nada de
  // lo que estos tests afirman: la regla de reintento/escalado de la 47 NO lee la causa (R17,
  // F1.4-e) y `resolverSeguimientoDevuelta` no se toca. La verificacion dedicada de R17 (las 3
  // causas -> el MISMO seguimiento) es la task T6.1 del bloque 6.
  const devolucion: GestionarInput = {
    ordenId: "o1",
    resultado: "devuelta",
    causaDevolucion: "not_found",
    motivo: "ausente",
    evidencia: evidencia(),
  };

  function repoCall(repo: IGestionOrdenRepository) {
    return (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      nuevoEstatusId: string;
      seguimiento?: { destinoEstatusId: string; limpiaMensajero: boolean };
    };
  }

  it("R1/R5: bajo umbral + zona satelite -> seguimiento en_bodega_satelite, limpia mensajero", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ zonaId: "z-satelite" })]),
    });
    const historial = fakeHistorial({ contarIntentos: vi.fn(async () => 0) }); // intento actual = 1
    const r = await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
      devolucion,
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    const call = repoCall(repo);
    expect(call.nuevoEstatusId).toBe("os-devuelta"); // la orden pasa por devuelta (derivador la cuenta)
    expect(call.seguimiento).toEqual({ destinoEstatusId: "os-en-bodega-satelite", limpiaMensajero: true });
    expect(historial.contarIntentos).toHaveBeenCalledWith("o1"); // R1: consume el derivador
  });

  it("R5: bajo umbral + zona CENTRAL -> seguimiento en_bodega (central), limpia mensajero", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ zonaId: ZONA_CENTRAL })]),
    });
    const zonaRepo = fakeZonaRepo({ findCentralZonaId: vi.fn(async () => ZONA_CENTRAL) });
    const r = await newService(repo, fakeStorage(), fakeSignedUrls(), fakeHistorial(), zonaRepo).gestionar(
      devolucion,
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    expect(repoCall(repo).seguimiento).toEqual({ destinoEstatusId: "os-en-bodega", limpiaMensajero: true });
  });

  it("R5 edge: zonaId null -> fallback en_bodega (central), sin consultar la zona central", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ zonaId: null })]),
    });
    const zonaRepo = fakeZonaRepo();
    const r = await newService(repo, fakeStorage(), fakeSignedUrls(), fakeHistorial(), zonaRepo).gestionar(
      devolucion,
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    expect(repoCall(repo).seguimiento).toEqual({ destinoEstatusId: "os-en-bodega", limpiaMensajero: true });
    expect(zonaRepo.findCentralZonaId).not.toHaveBeenCalled();
  });

  it("R8/R9: la N-esima devolucion (N = umbral 3) ESCALA a rechazada, NO limpia mensajero", async () => {
    const repo = fakeRepo();
    // 2 previos -> intento actual 3 == umbral default 3 -> escalado.
    const historial = fakeHistorial({ contarIntentos: vi.fn(async () => 2) });
    const r = await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
      devolucion,
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    expect(repoCall(repo).seguimiento).toEqual({ destinoEstatusId: "os-rechazada", limpiaMensajero: false });
  });

  it("R9: la (N-1)-esima devolucion NO escala -> vuelve a la bodega para reintentar", async () => {
    const repo = fakeRepo();
    // 1 previo -> intento actual 2 < umbral default 3 -> reintento (no rechazada).
    const historial = fakeHistorial({ contarIntentos: vi.fn(async () => 1) });
    const r = await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
      devolucion,
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    const seg = repoCall(repo).seguimiento;
    expect(seg?.destinoEstatusId).toBe("os-en-bodega-satelite"); // no os-rechazada
    expect(seg?.limpiaMensajero).toBe(true);
  });

  // --- FEATURE 64 (R27): un intento ANULADO no cuenta para la decision reintento/escalado ---

  it("67/R27: con 2 devueltas de las cuales 1 esta ANULADA, la siguiente es REINTENTO (no escalado)", async () => {
    const repo = fakeRepo();
    // El historial tiene 2 filas destino `devuelta`, pero una vino de una gestion que el
    // mensajero DESHIZO. `contarIntentos` consume `contarPorDestinoVigentes`, que la excluye en
    // la LECTURA -> devuelve 1 (no 2). Intento actual = 2 < umbral 3 -> REINTENTO.
    const historial = fakeHistorial({ contarIntentos: vi.fn(async () => 1) });
    const r = await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
      devolucion,
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    const seg = repoCall(repo).seguimiento;
    // Sin la correccion de la 64, el conteo crudo seria 2 -> intento 3 == umbral -> la orden
    // habria escalado sola a `rechazada` y disparado `cobroRechazado` (56): dinero mal cobrado
    // por un error que el mensajero YA corrigio.
    expect(seg?.destinoEstatusId).toBe("os-en-bodega-satelite");
    expect(seg?.destinoEstatusId).not.toBe("os-rechazada");
    expect(seg?.limpiaMensajero).toBe(true);
  });

  it("67/R27: el escalado sigue disparando cuando los 3 intentos son VIGENTES (sin regresion de la 47)", async () => {
    const repo = fakeRepo();
    // Ninguna anulada: 2 previos vigentes -> intento actual 3 == umbral -> escalado (47/R8).
    const historial = fakeHistorial({ contarIntentos: vi.fn(async () => 2) });
    const r = await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
      devolucion,
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    expect(repoCall(repo).seguimiento?.destinoEstatusId).toBe("os-rechazada");
  });

  it("67/R31: una orden devuelta a `en_reparto` por un deshacer es escogible (guardia 1-a-1 vigente)", async () => {
    // Tras el deshacer, la orden esta en `en_reparto` y asignada al mensajero (R18/R19): es
    // exactamente la precondicion de `cargarOrdenGestionable`. El flujo existente de la 36
    // funciona sin cambios — el deshacer NO toca el puntero (R29), asi que la retoma normal.
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_reparto", mensajeroAsignadoId: "m1" }),
      ]),
      setOrdenEnGestion: vi.fn(async () => true),
    });
    const r = await newService(repo).escogerParaGestion("o1", MENSAJERO);
    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(repo.setOrdenEnGestion).toHaveBeenCalledWith("m1", "o1"); // guardia 1-a-1 de la 36
  });

  it("67/R30: si el mensajero YA tiene OTRA orden activa, escoger la deshecha da conflict (1-a-1 intacta)", async () => {
    // El deshacer se completa igual (R30, probado en cierre-dia-service.test.ts); lo que sigue
    // sujeto a la guardia 1-a-1 es RETOMARLA. La invariante de la 36 no se relaja.
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_reparto", mensajeroAsignadoId: "m1" }),
      ]),
      setOrdenEnGestion: vi.fn(async () => false), // ya hay otra activa
    });
    const r = await newService(repo).escogerParaGestion("o1", MENSAJERO);
    expect(r.status).toBe("conflict");
  });

  it("R2: catalogo incompleto (sin el estado de bodega) -> validation_error, sin persistir", async () => {
    const repo = fakeRepo();
    // ordenRepo que resuelve devuelta pero NO en_bodega_satelite (seed pendiente).
    const ordenRepo = {
      findEstatusIdByValue: vi.fn(async (v: string) =>
        v === "en_bodega_satelite" ? null : (ESTATUS_ID_BY_VALUE[v] ?? null),
      ),
    };
    const service = new MisAsignacionesService(
      repo,
      ordenRepo,
      fakeStorage(),
      fakeSignedUrls(),
      fakeHistorial(),
      fakeZonaRepo(),
      fakeRutaRepo(),
    );
    const r = await service.gestionar(devolucion, MENSAJERO);
    expect(r.status).toBe("validation_error");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R13: la 47 NO escribe devuelta_origen (reservado a la feature 48)", async () => {
    const repo = fakeRepo();
    const ordenRepo = {
      findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    };
    const service = new MisAsignacionesService(
      repo,
      ordenRepo,
      fakeStorage(),
      fakeSignedUrls(),
      fakeHistorial(),
      fakeZonaRepo(),
      fakeRutaRepo(),
    );
    await service.gestionar(devolucion, MENSAJERO);
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalledWith("devuelta_origen");
  });

  it("R4/R19: reprogramada NO cuenta ni computa seguimiento (rama intacta)", async () => {
    const repo = fakeRepo();
    const historial = fakeHistorial();
    const r = await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
      { ordenId: "o1", resultado: "reprogramada", fechaReprogramacion: "2027-01-01", motivo: "x" },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    expect(historial.contarIntentos).not.toHaveBeenCalled();
    const call = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      seguimiento?: unknown;
    };
    expect(call.seguimiento).toBeUndefined(); // R19: sin transicion de seguimiento
  });

  it("R19: entregada NO computa seguimiento (una sola transicion)", async () => {
    const repo = fakeRepo();
    const historial = fakeHistorial();
    await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
      { ordenId: "o1", resultado: "entregada", montoRecibido: 100, metodoPago: "efectivo", evidencia: evidencia() },
      MENSAJERO,
    );
    const call = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      seguimiento?: unknown;
    };
    expect(call.seguimiento).toBeUndefined();
    expect(historial.contarIntentos).not.toHaveBeenCalled();
  });

  it("R19: rechazada DIRECTA NO computa seguimiento (una sola transicion)", async () => {
    const repo = fakeRepo();
    const historial = fakeHistorial();
    await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
      { ordenId: "o1", resultado: "rechazada", motivo: "cliente rechazo", evidencia: evidencia() },
      MENSAJERO,
    );
    const call = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      seguimiento?: unknown;
    };
    expect(call.seguimiento).toBeUndefined();
    expect(historial.contarIntentos).not.toHaveBeenCalled();
  });

  // --- FEATURE 73 / R17 (T6.1): la causa NO altera la regla de seguimiento de la 47 ---
  // F1.4-e: para la MISMA orden y el MISMO conteo previo, las 3 causas
  // (not_found / wrong_number / wrong_address) producen el MISMO seguimiento. La causa
  // viaja en su columna propia y NUNCA entra en `resolverSeguimientoDevuelta`, asi que
  // ni el destino (reintento a bodega / escalado a rechazada) ni el conteo de intentos
  // dependen de ella. Bug historico que este test cierra: al ampliar los tests de la 47
  // se dejo pasando SIEMPRE `not_found`, con lo que las otras 2 causas nunca recorrian
  // esta ruta y R17 quedaba huerfano.

  const CAUSAS = CAUSA_DEVOLUCION_SEED; // ["not_found", "wrong_number", "wrong_address"]

  it.each(CAUSAS)(
    "73/R17: causa '%s' BAJO umbral -> MISMO seguimiento (reintento a en_bodega_satelite, limpia mensajero, cuenta igual)",
    async (causa) => {
      const repo = fakeRepo({
        findByIdsParaGestion: vi.fn(async () => [gestionRow({ zonaId: "z-satelite" })]),
      });
      const historial = fakeHistorial({ contarIntentos: vi.fn(async () => 0) }); // intento actual = 1 < umbral 3
      const r = await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
        { ordenId: "o1", resultado: "devuelta", causaDevolucion: causa, motivo: "ausente", evidencia: evidencia() },
        MENSAJERO,
      );
      expect(r.status).toBe("ok");
      const call = repoCall(repo);
      // Mismo destino de seguimiento que el caso baseline (independiente de la causa).
      expect(call.seguimiento).toEqual({ destinoEstatusId: "os-en-bodega-satelite", limpiaMensajero: true });
      // Mismo efecto sobre el conteo de intento: la decision consume el derivador de la 49
      // con el id de orden, sin que la causa lo altere.
      expect(historial.contarIntentos).toHaveBeenCalledTimes(1);
      expect(historial.contarIntentos).toHaveBeenCalledWith("o1");
    },
  );

  it.each(CAUSAS)(
    "73/R17: causa '%s' EN umbral -> MISMO escalado a rechazada, NO limpia mensajero (causa irrelevante)",
    async (causa) => {
      const repo = fakeRepo();
      const historial = fakeHistorial({ contarIntentos: vi.fn(async () => 2) }); // intento actual = 3 == umbral
      const r = await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
        { ordenId: "o1", resultado: "devuelta", causaDevolucion: causa, motivo: "ausente", evidencia: evidencia() },
        MENSAJERO,
      );
      expect(r.status).toBe("ok");
      expect(repoCall(repo).seguimiento).toEqual({ destinoEstatusId: "os-rechazada", limpiaMensajero: false });
      expect(historial.contarIntentos).toHaveBeenCalledTimes(1);
      expect(historial.contarIntentos).toHaveBeenCalledWith("o1");
    },
  );

  it("73/R17: las 3 causas colapsan al MISMO seguimiento para la misma orden y conteo (invariante directa)", async () => {
    async function seguimientoDe(causa: (typeof CAUSAS)[number]) {
      const repo = fakeRepo({
        findByIdsParaGestion: vi.fn(async () => [gestionRow({ zonaId: "z-satelite" })]),
      });
      const historial = fakeHistorial({ contarIntentos: vi.fn(async () => 1) }); // intento actual = 2 < umbral
      const r = await newService(repo, fakeStorage(), fakeSignedUrls(), historial).gestionar(
        { ordenId: "o1", resultado: "devuelta", causaDevolucion: causa, motivo: "ausente", evidencia: evidencia() },
        MENSAJERO,
      );
      expect(r.status).toBe("ok");
      return repoCall(repo).seguimiento;
    }
    const [a, b, c] = await Promise.all(CAUSAS.map(seguimientoDe));
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a).toEqual({ destinoEstatusId: "os-en-bodega-satelite", limpiaMensajero: true });
  });
});

// --- menor-3: liberarGestion (R35) ---

describe("liberarGestion (R35)", () => {
  it("R12: rol != mensajero -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).liberarGestion("o1", MAESTRO);
    expect(r.status).toBe("forbidden");
    expect(repo.liberarOrdenEnGestion).not.toHaveBeenCalled();
  });

  it("mensajero -> ok e invoca repo.liberarOrdenEnGestion(actor, orden)", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).liberarGestion("o1", MENSAJERO);
    expect(r.status).toBe("ok");
    expect(repo.liberarOrdenEnGestion).toHaveBeenCalledWith("m1", "o1");
  });

  it("idempotente: ok aunque el repo no limpiara nada (count 0 -> false)", async () => {
    const repo = fakeRepo({ liberarOrdenEnGestion: vi.fn(async () => false) });
    const r = await newService(repo).liberarGestion("o1", MENSAJERO);
    expect(r.status).toBe("ok");
  });
});
