// Feature 274 (T6.3, R27-R31, R38) — el BORDE REAL de la carga por API key ante el hueco de
// tarifa.
//
// Por que este archivo existe habiendo ya tests unitarios del service: el criterio de lote de
// design §3.6 solo vale si el integrador lo VE. El service no devuelve un `status: "conflict"`:
// lanza `ConflictError` y confia en que `withErrorHandler` + `appErrorToResponse` lo traduzcan a
// un 409 con el mensaje publicado. Esa traduccion es una linea que nadie escribio para esta
// feature (design §4.3: "el borde ya lo traduce"), y una afirmacion de ese tipo hay que
// ejercitarla, no razonarla: si `route.ts` capturara la excepcion, o si el codigo no mapeara a
// 409, los unitarios seguirian verdes y la API devolveria un 500.
//
// A diferencia del resto de tests de este borde, aqui el `bulkService` es el SERVICE REAL
// (`BulkOrdenService`) con dobles de repositorio: lo que se prueba es el camino completo
// fila -> tarifa -> HTTP, no el contrato entre dos dobles.
import { describe, it, expect, vi } from "vitest";
import { handleCargaApi, type CargaApiDeps } from "@/app/api/ordenes/api-key/carga/route";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import type { CreateOrdenData, IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaVigenteRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar, type ParTarifa } from "@/lib/utils/cascada-tarifa";
import { MSG_CARGA_SIN_TARIFA, MSG_FILA_SIN_TARIFA } from "@/lib/services/mensajes-tarifa";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IEtiquetasDescargaService } from "@/lib/interfaces/services/IEtiquetasDescargaService";
import type { IManifiestoService } from "@/lib/interfaces/services/IManifiestoService";

const KEY_ACTOR: Actor = { usuarioId: "key-user-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

const TARIFA_Z1: TarifaVigenteResuelta = {
  tarifaId: "t-z1",
  fulfillment: "0.00",
  valorFlete: "3.50", // -> 3.50 + 12% = "3.92"
  valorFleteGam: "5.00",
  valorFleteDevuelto: "1.00",
  valorFleteDevueltoGam: "2.00",
  comisionCod: "5.00",
  ivaFlete: "12.00",
  ivaComisionCod: "12.00",
};

/** Doble del resolver de la cascada: mapa `zonaId -> tarifa`; lo que no este, no resuelve (R2). */
function tarifaRepo(porZona: Record<string, TarifaVigenteResuelta>): ITarifaVigenteRepository {
  return {
    resolveTarifa: vi.fn(async (_t: string, zonaId: string | null) =>
      zonaId === null ? null : porZona[zonaId] ?? null,
    ),
    resolveTarifas: vi.fn(
      async (pares: readonly ParTarifa[]) =>
        new Map<string, TarifaVigenteResuelta | null>(
          pares.map((p) => [clavePar(p), p.zonaId === null ? null : porZona[p.zonaId] ?? null]),
        ),
    ),
  };
}

/**
 * Doble MINIMO de `IOrdenRepository` (mismo patron que `bulk-orden-service.carga-lote.test.ts`):
 * solo los metodos que recorre la carga por API. Se castea porque la interfaz tiene ~50 metodos
 * ajenos; cualquier metodo no previsto revienta con "is not a function" en vez de pasar mudo.
 *
 * Geografia: dos distritos del mismo canton en ZONAS distintas (`z1` y `z2`), que es lo minimo
 * para tener un lote con dos pares (tienda, zona).
 */
function ordenRepo(): IOrdenRepository {
  return {
    findUsuarioFulfillment: vi.fn(async () => false),
    findEstatusIdByValue: vi.fn(async () => "os-erbp"),
    findExistingRemisiones: vi.fn(async () => new Map<string, string>()),
    findAllProvincias: vi.fn(async () => [{ id: "p1", nombre: "Pichincha" }]),
    findCantonesByProvinciaIds: vi.fn(async () => [{ id: "c1", nombre: "Quito", provinciaId: "p1" }]),
    findDistritosByCantonIds: vi.fn(async () => [
      { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1", esCentral: false },
      { id: "d2", nombre: "Cumbaya", cantonId: "c1", zonaId: "z2", esCentral: false },
    ]),
    createManyOrdenes: vi.fn(async () => ({ inserted: 0, cargaId: null })),
    createManyOrdenesConGuia: vi.fn(async (data: CreateOrdenData[]) => ({
      creadas: data.map((d, i) => ({
        ordenId: `ord-${d.numRemision}`,
        numRemision: d.numRemision,
        numGuia: 1000 + i,
        estatusValue: "por_recolectar_en_tienda",
      })),
      cargaId: "44444444-4444-4444-8444-444444444444",
    })),
  } as unknown as IOrdenRepository;
}

const etiquetasStub = {
  generarYPersistir: vi.fn(async () => ({ consolidado: null, porOrden: new Map<string, string>() })),
} as unknown as IEtiquetasDescargaService;

const manifiestoStub = {
  armar: vi.fn(async () => ({ status: "ok", filas: [], omitidas: [] })),
} as unknown as IManifiestoService;

function deps(repo: IOrdenRepository, tarifas: ITarifaVigenteRepository): CargaApiDeps {
  return {
    autenticar: async () => ({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }) as ApiKeyAuthResult,
    // SERVICE REAL: lo que se mide es el camino completo hasta el codigo HTTP.
    bulkService: new BulkOrdenService(repo, tarifas),
    descargaService: etiquetasStub,
    manifiestoService: manifiestoStub,
  };
}

/** Fila del contrato publico 88: geografia en columnas separadas. */
function fila(numRemision: string, distrito: string): Record<string, string> {
  return {
    num_remision: numRemision,
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton: "Quito",
    distrito,
    producto: "Caja",
  };
}

function req(ordenes: unknown[]): Request {
  return new Request("http://localhost/api/ordenes/api-key/carga", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRETO}` },
    body: JSON.stringify({ ordenes }),
  });
}

describe("carga por API key: ninguna fila resuelve tarifa -> 409 (274/R29)", () => {
  it("R29: 409 con el mensaje publicado y NADA persistido", async () => {
    const repo = ordenRepo();
    const res = await handleCargaApi(
      req([fila("REM-1", "La Mariscal"), fila("REM-2", "Cumbaya")]),
      deps(repo, tarifaRepo({})), // ninguna zona con tarifa
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    // El mensaje se compara contra la CONSTANTE, no contra un literal re-escrito (R38/§3.5).
    expect(body).toMatchObject({ status: "error", code: "CONFLICT", message: MSG_CARGA_SIN_TARIFA });

    // Cero escrituras: ni ordenes ni fila de `carga` (las crea el mismo writer, misma tx).
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
    // Y el borde tampoco llega a las etapas posteriores a la carga.
    expect(etiquetasStub.generarYPersistir).not.toHaveBeenCalled();
  });

  it("R31: el cuerpo del 409 no lleva ningun importe (tampoco '0.00')", async () => {
    const res = await handleCargaApi(
      req([fila("REM-1", "La Mariscal")]),
      deps(ordenRepo(), tarifaRepo({})),
    );

    expect(res.status).toBe(409);
    const crudo = JSON.stringify(await res.json());
    expect(crudo).not.toContain("costoEnvio");
    expect(crudo).not.toContain("0.00");
  });
});

describe("carga por API key: lote MIXTO -> 200 con la fila sin tarifa en error (274/R27/R28/R38)", () => {
  it("R27/R28: la fila con tarifa se crea con su costoEnvio; la otra va a `error` con `errores.tarifa`", async () => {
    const repo = ordenRepo();
    const res = await handleCargaApi(
      // `z1` tiene tarifa, `z2` no.
      req([fila("REM-OK", "La Mariscal"), fila("REM-SIN", "Cumbaya")]),
      deps(repo, tarifaRepo({ z1: TARIFA_Z1 })),
    );

    expect(res.status).toBe(200); // NO 409: otra fila del lote si resolvio (design §3.6)
    const body = await res.json();

    expect(body).toMatchObject({ total: 2, creadas: 1, duplicadas: 0, conError: 1 });
    const ok = body.filas.find((f: { numRemision: string }) => f.numRemision === "REM-OK");
    const sin = body.filas.find((f: { numRemision: string }) => f.numRemision === "REM-SIN");
    expect(ok).toMatchObject({ resultado: "creada", numGuia: 1000 });
    expect(sin).toMatchObject({ resultado: "error", errores: { tarifa: [MSG_FILA_SIN_TARIFA] } });

    // R28: la fila sin tarifa NO llego a la persistencia.
    const persistidas = (repo.createManyOrdenesConGuia as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as CreateOrdenData[];
    expect(persistidas.map((o) => o.numRemision)).toEqual(["REM-OK"]);

    // R31: solo se emite el importe de la orden realmente creada; ningun "0.00".
    expect(body.ordenes).toHaveLength(1);
    expect(body.ordenes[0]).toMatchObject({ numRemision: "REM-OK", costoEnvio: "3.92" });
    expect(JSON.stringify(body.ordenes)).not.toContain("0.00");
  });
});

describe("carga por API key: nadie llega a resolver -> 200, no 409 (274/R30)", () => {
  it("R30: lote entero sin cobertura geografica -> 200 con sus errores de siempre", async () => {
    const repo = ordenRepo();
    const tarifas = tarifaRepo({});
    const res = await handleCargaApi(
      req([fila("REM-1", "No existe"), fila("REM-2", "Tampoco")]),
      deps(repo, tarifas),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 2, creadas: 0, conError: 2 });
    for (const f of body.filas) {
      expect(f.errores).toHaveProperty("distrito");
      expect(f.errores).not.toHaveProperty("tarifa");
    }
    // La tarifa no es el motivo del fallo: ni siquiera se pregunta por ella.
    expect(tarifas.resolveTarifas).not.toHaveBeenCalled();
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });
});
