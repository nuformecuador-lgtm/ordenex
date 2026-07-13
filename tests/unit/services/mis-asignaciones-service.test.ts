import { describe, it, expect, vi } from "vitest";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import type {
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GestionarInput } from "@/lib/interfaces/services/IMisAsignacionesService";

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const OTRO: Actor = { usuarioId: "m2", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_espera_aceptacion: "os-espera",
  en_reparto: "os-reparto",
  entregada: "os-entregada",
  reprogramada: "os-reprogramada",
  devuelta: "os-devuelta",
  rechazada: "os-rechazada",
};

function gestionRow(overrides: Partial<OrdenGestionRow> = {}): OrdenGestionRow {
  return {
    id: "o1",
    estatusValue: "en_reparto",
    deletedAt: null,
    mensajeroAsignadoId: "m1",
    montoCobrar: 100,
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

function newService(
  repo: IGestionOrdenRepository = fakeRepo(),
  storage: IFileStorage = fakeStorage(),
  signed: ISignedUrlProvider = fakeSignedUrls(),
) {
  return new MisAsignacionesService(repo, fakeOrdenRepo(), storage, signed);
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
      { ordenId: "o1", resultado: "devuelta", motivo: "x" },
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
      { ordenId: "o1", resultado: "devuelta", motivo: "x" },
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
      { ordenId: "o1", resultado: "devuelta", motivo: "x" },
      MENSAJERO,
    );
    expect(r.status).toBe("forbidden");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R21: otra orden activa distinta -> conflict, sin persistir", async () => {
    const repo = fakeRepo({ getOrdenEnGestion: vi.fn(async () => "o-otra") });
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "devuelta", motivo: "x" },
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
      { ordenId: "o1", resultado: "devuelta", motivo: "x" },
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

  it("menor-2: montoCobrar null -> validation_error", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: null })]),
    });
    const r = await newService(repo).gestionar(entrega(100), MENSAJERO);
    expect(r.status).toBe("validation_error");
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

  it("R28: devolucion valida -> gestion(devuelta) + estado devuelta", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).gestionar(
      { ordenId: "o1", resultado: "devuelta", motivo: "no estaba" },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(gArg.gestion.resultado).toBe("devuelta");
    expect(gArg.nuevoEstatusId).toBe("os-devuelta");
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
