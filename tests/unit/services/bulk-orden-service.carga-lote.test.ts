import { describe, it, expect, vi } from "vitest";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import type {
  CreateOrdenData,
  IOrdenRepository,
  LoteContexto,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ITarifaVigentePorTiendaRepository } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";

// Feature 141 (T7/T8) — propagacion del LOTE desde el servicio. Cubre:
//   R12/R13 — via sesion: un lote por sesion; los N chunks portan el MISMO cargaId.
//   R14     — dry-run: no se persiste nada y el summary trae cargaId null.
//   R15     — chunk sin ordenes creadas: no se llama al repo, cargaId null.
//   R18     — total_files = total de la SESION declarado por el cliente, NO el del chunk.
//   R19-R22 — via API key: un lote por peticion, usuario dedicado, total = payload.length.
//   R27/R28 — ambos summaries exponen el cargaId.
//   R30     — la autorizacion vigente no cambia (adminTienda / apiKey).

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

describe("cargarMasiva — lote de la sesion (R12/R13/R18/R27)", () => {
  it("R12/R13: propaga al repo el cargaId de la SESION (el mismo en los N chunks)", async () => {
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

  it("R18: total_files = total de la SESION, NO el numero de filas del chunk", async () => {
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
    });
  });

  it("R18: sin total declarado, cae al tamaño del chunk (nunca a 0)", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarMasiva([row("REM-1"), row("REM-2")], TIENDA, {
      cargaId: UUID_SESION,
    });

    expect(loteArg(repo, "createManyOrdenes").totalFiles).toBe(2);
  });

  it("R27: el summary devuelve el cargaId resuelto por el repo", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarMasiva([row("REM-1")], TIENDA, {
      cargaId: UUID_SESION,
      totalFiles: 1,
    });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.summary.cargaId).toBe(UUID_SESION);
  });

  it("sin cargaId del cliente, el repo lo genera (se le pasa null)", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarMasiva([row("REM-1")], TIENDA);

    expect(loteArg(repo, "createManyOrdenes").cargaId).toBeNull();
  });
});

describe("cargarMasiva — cuando NO debe crearse lote (R14/R15)", () => {
  it("R14: dry-run no persiste nada y el summary trae cargaId null", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarMasiva([row("REM-1")], TIENDA, {
      dryRun: true,
      cargaId: UUID_SESION,
      totalFiles: 500,
    });

    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
    expect(res.status === "ok" && res.summary.cargaId).toBeNull();
  });

  it("R15: un chunk cuyas filas son TODAS duplicadas no toca el repo -> cargaId null", async () => {
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

  it("R15: un chunk con TODAS las filas en error no crea lote", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarMasiva(
      [{ ...row("REM-1"), destinatario: "" }],
      TIENDA,
      { cargaId: UUID_SESION, totalFiles: 500 },
    );

    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
    expect(res.status === "ok" && res.summary.cargaId).toBeNull();
  });

  it("R30: un rol distinto de adminTienda sigue siendo forbidden y no crea lote", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarMasiva([row("REM-1")], MAESTRO, {
      cargaId: UUID_SESION,
      totalFiles: 500,
    });

    expect(res.status).toBe("forbidden");
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });
});

describe("cargarViaApi — lote por peticion (R19/R20/R21/R22/R28)", () => {
  it("R19/R20/R21: un lote por peticion, del usuario de la key, con total = filas del payload", async () => {
    const repo = buildRepo();

    await buildService(repo).cargarViaApi([row("REM-1"), row("REM-2"), row("REM-3")], APIKEY);

    expect(repo.createManyOrdenesConGuia).toHaveBeenCalledTimes(1);
    expect(loteArg(repo, "createManyOrdenesConGuia")).toEqual({
      cargaId: null, // el id lo genera el servidor
      usuarioCargaId: "key-user-1", // R20: usuario dedicado de la key
      totalFiles: 3, // R21: objetos del array del payload
    });
  });

  it("R21: total_files cuenta TAMBIEN las filas duplicadas y con error del payload", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-2", "en_bodega_central"]])),
    });

    await buildService(repo).cargarViaApi(
      [row("REM-1"), row("REM-2"), { ...row("REM-3"), destinatario: "" }],
      APIKEY,
    );

    expect(loteArg(repo, "createManyOrdenesConGuia").totalFiles).toBe(3);
  });

  it("R28: el summary devuelve el cargaId y conserva el resto de campos", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarViaApi([row("REM-1")], APIKEY);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.summary.cargaId).toBe("carga-api-1");
    expect(res.summary.ordenes).toHaveLength(1);
    expect(res.summary.creadas).toBe(1);
  });

  it("R22: sin ninguna orden creada no se llama al repo y cargaId es null", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-1", "en_bodega_central"]])),
    });

    const res = await buildService(repo).cargarViaApi([row("REM-1")], APIKEY);

    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
    expect(res.status === "ok" && res.summary.cargaId).toBeNull();
  });

  it("R30: un rol distinto de apiKey sigue siendo forbidden y no crea lote", async () => {
    const repo = buildRepo();

    const res = await buildService(repo).cargarViaApi([row("REM-1")], TIENDA);

    expect(res.status).toBe("forbidden");
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });
});

describe("R29 — download_url no se escribe por ningun camino del servicio", () => {
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
