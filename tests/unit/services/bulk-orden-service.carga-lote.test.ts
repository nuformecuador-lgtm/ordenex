import { describe, it, expect, vi } from "vitest";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import {
  CargaLoteAjenoError,
  CargaNombreDuplicadoError,
  type CreateOrdenData,
  type IOrdenRepository,
  type LoteContexto,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ITarifaVigentePorTiendaRepository } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";

// Feature 141 (T7/T8/T19) — propagacion del LOTE desde el servicio. Cubre:
//   R15/R16 — sin token entrante se pide la CREACION al repo (cargaId null): el id lo genera
//             el servidor, nunca el cliente.
//   R17     — con un token propio se pide la REUTILIZACION del mismo lote.
//   R20-R23 — `name` opcional propagado al lote en AMBAS vias; ausente -> null.
//   R27     — dry-run: no se persiste nada y el summary trae cargaId null.
//   R28     — chunk sin ordenes creadas: no se llama al repo, cargaId null.
//   R29     — total_files = total de la SESION declarado por el cliente, NO el del chunk.
//   R30-R33 — via API key: un lote por peticion, usuario dedicado, total = payload.length.
//   R38/R39 — ambos summaries exponen el cargaId.
//   R40     — la via sesion nunca escribe download_url.
//   R41     — la autorizacion vigente no cambia (adminTienda / apiKey).

const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const APIKEY: Actor = { usuarioId: "key-user-1", rol: "apiKey" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const UUID_SESION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const tarifaRepoStub: ITarifaVigentePorTiendaRepository = {
  resolveTarifaPorTienda: vi.fn(async () => null),
  resolveTarifasPorTiendas: vi.fn(async () => new Map()),
};

/**
 * Doble MINIMO de `IOrdenRepository`: solo los metodos que recorre la carga masiva. Se
 * castea porque la interfaz tiene ~50 metodos ajenos a esta feature; cualquier metodo no
 * previsto reventaria el test con "is not a function" en vez de pasar en silencio.
 */
function buildRepo(overrides: Partial<IOrdenRepository> = {}): IOrdenRepository {
  return {
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-1"),
    findExistingRemisiones: vi.fn().mockResolvedValue(new Map()),
    findAllProvincias: vi.fn().mockResolvedValue([{ id: "p1", nombre: "Pichincha" }]),
    findCantonesByProvinciaIds: vi
      .fn()
      .mockResolvedValue([{ id: "c1", nombre: "Quito", provinciaId: "p1" }]),
    findDistritosByCantonIds: vi
      .fn()
      .mockResolvedValue([
        { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1", esCentral: false },
      ]),
    findMensajerosByIds: vi.fn().mockResolvedValue(new Set()),
    createManyOrdenes: vi.fn().mockResolvedValue({ inserted: 1, cargaId: UUID_SESION }),
    // Feature 141 (R47/R48): persistencia de las URLs de descarga de etiquetas.
    setCargaDownloadUrl: vi.fn(async () => {}),
    setOrdenesDownloadUrl: vi.fn(async () => {}),
    createManyOrdenesConGuia: vi.fn(async (data: CreateOrdenData[]) => ({
      creadas: data.map((d, i) => ({
        ordenId: `o${i + 1}`,
        numRemision: d.numRemision,
        numGuia: 1000 + i,
        estatusValue: "en_ruta_bodega_central",
      })),
      cargaId: "carga-api-1",
    })),
    ...overrides,
  } as unknown as IOrdenRepository;
}

function buildService(repo: IOrdenRepository): BulkOrdenService {
  return new BulkOrdenService(repo, tarifaRepoStub);
}

function row(numRemision: string): RawRow {
  return {
    num_remision: numRemision,
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton: "Quito",
    distrito: "La Mariscal",
    direccion: "",
    producto: "Caja",
    notas: "",
    monto_cobrar: "",
    mensajero_sugerido_id: "",
  };
}

function loteArg(repo: IOrdenRepository, metodo: "createManyOrdenes" | "createManyOrdenesConGuia") {
  return (repo[metodo] as unknown as ReturnType<typeof vi.fn>).mock.calls[0][3] as LoteContexto;
}

describe("cargarMasiva — lote de la sesion (R16/R17/R29/R38)", () => {
  it("R17: propaga al repo el token de lote recibido (el emitido por el servidor)", async () => {
    const repo = buildRepo();
    const service = buildService(repo);

    await service.cargarMasiva([row("REM-1")], TIENDA, {
      cargaId: UUID_SESION,
      totalFiles: 500,
    });
    await service.cargarMasiva([row("REM-2")], TIENDA, {
      cargaId: UUID_SESION,
      totalFiles: 500,
    });

    const llamadas = (repo.createManyOrdenes as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas.map((c) => (c[3] as LoteContexto).cargaId)).toEqual([
      UUID_SESION,
      UUID_SESION,
    ]);
  });

  it("R29: total_files = total de la SESION, NO el numero de filas del chunk", async () => {
    const repo = buildRepo();

    // El chunk trae 2 filas, pero la sesion completa declara 500.
    await buildService(repo).cargarMasiva([row("REM-1"), row("REM-2")], TIENDA, {
      cargaId: UUID_SESION,
      totalFiles: 500,
    });

    expect(loteArg(repo, "createManyOrdenes")).toEqual({
      cargaId: UUID_SESION,
      usuarioCargaId: "store1", // R2: el adminTienda autenticado
      totalFiles: 500,
      name: null, // R22: sin nombre declarado
    });
  });

  it("R29: sin total declarado, cae al tamaño del chunk (nunca a 0)", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarMasiva([row("REM-1"), row("REM-2")], TIENDA, {
      cargaId: UUID_SESION,
    });

    expect(loteArg(repo, "createManyOrdenes").totalFiles).toBe(2);
  });

  it("R38: el summary devuelve el cargaId resuelto por el repo", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarMasiva([row("REM-1")], TIENDA, {
      cargaId: UUID_SESION,
      totalFiles: 1,
    });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.summary.cargaId).toBe(UUID_SESION);
  });

  it("R15/R16: sin token entrante se pide la CREACION al repo (cargaId null)", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarMasiva([row("REM-1")], TIENDA);

    expect(loteArg(repo, "createManyOrdenes").cargaId).toBeNull();
  });
});

describe("cargarMasiva — cuando NO debe crearse lote (R27/R28)", () => {
  it("R27: dry-run no persiste nada y el summary trae cargaId null", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarMasiva([row("REM-1")], TIENDA, {
      dryRun: true,
      cargaId: UUID_SESION,
      totalFiles: 500,
    });

    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
    expect(res.status === "ok" && res.summary.cargaId).toBeNull();
  });

  it("R28: un chunk cuyas filas son TODAS duplicadas no toca el repo -> cargaId null", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-1", "en_bodega_central"]])),
    });

    const res = await buildService(repo).cargarMasiva([row("REM-1")], TIENDA, {
      cargaId: UUID_SESION,
      totalFiles: 500,
    });

    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
    expect(res.status === "ok" && res.summary.cargaId).toBeNull();
  });

  it("R28: un chunk con TODAS las filas en error no crea lote", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarMasiva(
      [{ ...row("REM-1"), destinatario: "" }],
      TIENDA,
      { cargaId: UUID_SESION, totalFiles: 500 },
    );

    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
    expect(res.status === "ok" && res.summary.cargaId).toBeNull();
  });

  it("R41: un rol distinto de adminTienda sigue siendo forbidden y no crea lote", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarMasiva([row("REM-1")], MAESTRO, {
      cargaId: UUID_SESION,
      totalFiles: 500,
    });

    expect(res.status).toBe("forbidden");
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });
});

describe("cargarViaApi — lote por peticion (R30/R31/R32/R33/R39)", () => {
  it("R30/R31/R32: un lote por peticion, del usuario de la key, con total = filas del payload", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarViaApi([row("REM-1"), row("REM-2"), row("REM-3")], APIKEY);

    expect(repo.createManyOrdenesConGuia).toHaveBeenCalledTimes(1);
    expect(loteArg(repo, "createManyOrdenesConGuia")).toEqual({
      cargaId: null, // R15: el id lo genera SIEMPRE el servidor
      usuarioCargaId: "key-user-1", // R31: usuario dedicado de la key
      totalFiles: 3, // R32: objetos del array del payload
      name: null, // R22: sin nombre declarado
    });
  });

  it("R32: total_files cuenta TAMBIEN las filas duplicadas y con error del payload", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-2", "en_bodega_central"]])),
    });

    await buildService(repo).cargarViaApi(
      [row("REM-1"), row("REM-2"), { ...row("REM-3"), destinatario: "" }],
      APIKEY,
    );

    expect(loteArg(repo, "createManyOrdenesConGuia").totalFiles).toBe(3);
  });

  it("R39: el summary devuelve el cargaId y conserva el resto de campos", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarViaApi([row("REM-1")], APIKEY);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.summary.cargaId).toBe("carga-api-1");
    expect(res.summary.ordenes).toHaveLength(1);
    expect(res.summary.creadas).toBe(1);
  });

  it("R33: sin ninguna orden creada no se llama al repo y cargaId es null", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-1", "en_bodega_central"]])),
    });

    const res = await buildService(repo).cargarViaApi([row("REM-1")], APIKEY);

    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
    expect(res.status === "ok" && res.summary.cargaId).toBeNull();
  });

  it("R41: un rol distinto de apiKey sigue siendo forbidden y no crea lote", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarViaApi([row("REM-1")], TIENDA);

    expect(res.status).toBe("forbidden");
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });
});

describe("R40 — la via sesion no escribe download_url por ningun camino del servicio", () => {
  it("los datos que el servicio manda a persistir no incluyen downloadUrl", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarMasiva([row("REM-1")], TIENDA, { cargaId: UUID_SESION });
    await buildService(repo).cargarViaApi([row("REM-2")], APIKEY);

    const sesion = (repo.createManyOrdenes as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as CreateOrdenData[];
    const api = (repo.createManyOrdenesConGuia as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as CreateOrdenData[];
    for (const fila of [...sesion, ...api]) {
      expect(fila).not.toHaveProperty("downloadUrl");
    }
  });
});

// --- Feature 141 (T19): nombre del lote en AMBAS vias (R20/R21/R22/R23) ---

describe("nombre del lote (R20/R21/R22/R23)", () => {
  it("R20/R21: la via sesion propaga el `name` recibido al contexto del lote", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarMasiva([row("REM-1")], TIENDA, {
      name: "carga de enero",
      totalFiles: 1,
    });

    expect(loteArg(repo, "createManyOrdenes").name).toBe("carga de enero");
  });

  it("R22: sin `name`, la via sesion pide el lote con name null", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarMasiva([row("REM-1")], TIENDA, { totalFiles: 1 });

    expect(loteArg(repo, "createManyOrdenes").name).toBeNull();
  });

  it("R20/R21: la via API key propaga el `name` recibido", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarViaApi([row("REM-1")], APIKEY, { name: "lote api" });

    expect(loteArg(repo, "createManyOrdenesConGuia").name).toBe("lote api");
  });

  it("R22: sin `name`, la via API key pide el lote con name null", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarViaApi([row("REM-1")], APIKEY);

    expect(loteArg(repo, "createManyOrdenesConGuia").name).toBeNull();
  });

  it("R23: el `name` viaja en todos los chunks, pero el 2.o ya reutiliza el lote por token", async () => {
    const repo = buildRepo();
    const service = buildService(repo);

    await service.cargarMasiva([row("REM-1")], TIENDA, { name: "enero", totalFiles: 2 });
    await service.cargarMasiva([row("REM-2")], TIENDA, {
      name: "enero",
      totalFiles: 2,
      cargaId: UUID_SESION, // 2.o chunk: token emitido por el servidor -> el repo solo lee
    });

    const llamadas = (repo.createManyOrdenes as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas.map((c) => (c[3] as LoteContexto).cargaId)).toEqual([null, UUID_SESION]);
    expect(llamadas.map((c) => (c[3] as LoteContexto).name)).toEqual(["enero", "enero"]);
  });

  it("los errores de dominio del lote NO se capturan en el service (los traduce el borde)", async () => {
    const repo = buildRepo({
      createManyOrdenes: vi.fn().mockRejectedValue(new CargaNombreDuplicadoError("enero")),
    });

    await expect(
      buildService(repo).cargarMasiva([row("REM-1")], TIENDA, { name: "enero" }),
    ).rejects.toBeInstanceOf(CargaNombreDuplicadoError);
  });

  it("R19: tampoco captura el error de lote ajeno (403 lo pone el borde)", async () => {
    const repo = buildRepo({
      createManyOrdenes: vi.fn().mockRejectedValue(new CargaLoteAjenoError(UUID_SESION)),
    });

    await expect(
      buildService(repo).cargarMasiva([row("REM-1")], TIENDA, { cargaId: UUID_SESION }),
    ).rejects.toBeInstanceOf(CargaLoteAjenoError);
  });
});
