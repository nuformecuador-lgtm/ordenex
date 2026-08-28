// Feature 302 (T3) — DE LA FILA `api_key` HASTA LA ORDEN QUE SE ESCRIBE.
//
// Que congela este archivo, y por que no bastan los unitarios: la ficha 302 se resume en una
// frase —«las ordenes que cree la key se registran a nombre de la tienda real»— pero esa frase
// atraviesa CUATRO piezas (repositorio -> `ApiKeyAuthService` -> borde HTTP -> `BulkOrdenService`)
// y ninguna de ellas la contiene entera. Un unitario del autenticador demuestra que el actor sale
// con el id correcto; lo que NO demuestra es que ese id llegue hasta el `tienda_id` de la fila que
// se inserta ni hasta el par `(tienda, zona)` con el que se busca la TARIFA — que es justamente la
// consecuencia medida del bug: «la tienda nueva naceria con cero tarifas».
//
// Por eso aqui son REALES el autenticador (`ApiKeyAuthService`), el borde (`handleCargaApi`) y el
// service de carga (`BulkOrdenService`); los dobles son solo la base (`IApiKeyRepository`,
// `IOrdenRepository`, `ITarifaVigenteRepository`).
import { describe, it, expect, vi } from "vitest";
import { handleCargaApi, type CargaApiDeps } from "@/app/api/ordenes/api-key/carga/route";
import { ApiKeyAuthService } from "@/lib/services/ApiKeyAuthService";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { hashApiKey } from "@/lib/utils/api-key-hash";
import type {
  ApiKeyAutenticada,
  IApiKeyRepository,
} from "@/lib/interfaces/repositories/IApiKeyRepository";
import type {
  CreateOrdenData,
  IOrdenRepository,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaVigenteRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar, type ParTarifa } from "@/lib/utils/cascada-tarifa";
import type { IEtiquetasDescargaService } from "@/lib/interfaces/services/IEtiquetasDescargaService";
import type { IManifiestoService } from "@/lib/interfaces/services/IManifiestoService";

const SECRETO = "ordx_secretovivo1234567890";

/** La cuenta dedicada de la key (portadora de la credencial, rol `apiKey`). */
const U_KEY = "u-key-dedicada";
/** La tienda REAL ya registrada (rol `adminTienda`) — el caso Nuform de la ficha. */
const U_NUFORM = "u-nuform";

const TARIFA: TarifaVigenteResuelta = {
  tarifaId: "t-nuform-z1",
  fulfillment: "0.00",
  valorFlete: "3.50",
  valorFleteGam: "5.00",
  valorFleteDevuelto: "1.00",
  valorFleteDevueltoGam: "2.00",
  comisionCod: "5.00",
  ivaFlete: "12.00",
  ivaComisionCod: "12.00",
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/**
 * Repositorio de api keys con UNA fila, la que responde al secreto de arriba. Es el doble de la
 * BASE: lo que se le da es exactamente lo que Postgres devolveria por `key_hash`.
 */
function apiKeyRepo(fila: Partial<ApiKeyAutenticada>): IApiKeyRepository {
  const completa: ApiKeyAutenticada = {
    apiKeyId: "k1",
    usuarioId: U_KEY,
    tiendaDestinoId: null,
    tiendaDestinoEstado: null,
    tiendaDestinoRol: null,
    estado: "activo",
    apiKeyEstado: "activa",
    rol: "apiKey",
    ...fila,
  };
  return {
    findByKeyHash: vi.fn(async (hash: string) => (hash === hashApiKey(SECRETO) ? completa : null)),
  } as unknown as IApiKeyRepository;
}

/**
 * Doble MINIMO de `IOrdenRepository` (mismo patron que `carga-api-key-sin-tarifa.test.ts`): solo
 * los metodos que recorre la carga por API. `createManyOrdenesConGuia` GUARDA las filas recibidas:
 * son la evidencia de a nombre de quien se escribieron.
 */
function ordenRepo(): { repo: IOrdenRepository; escritas: CreateOrdenData[][] } {
  const escritas: CreateOrdenData[][] = [];
  const repo = {
    findUsuarioFulfillment: vi.fn(async () => false),
    findEstatusIdByValue: vi.fn(async () => "os-erbp"),
    findExistingRemisiones: vi.fn(async () => new Map<string, string>()),
    findAllProvincias: vi.fn(async () => [{ id: "p1", nombre: "Pichincha" }]),
    findCantonesByProvinciaIds: vi.fn(async () => [
      { id: "c1", nombre: "Quito", provinciaId: "p1" },
    ]),
    findDistritosByCantonIds: vi.fn(async () => [
      { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1", esCentral: false },
    ]),
    createManyOrdenes: vi.fn(async () => ({ inserted: 0, cargaId: null, omitidas: [] })),
    createManyOrdenesConGuia: vi.fn(async (data: CreateOrdenData[]) => {
      escritas.push(data);
      return {
        creadas: data.map((d, i) => ({
          ordenId: `ord-${d.numRemision}`,
          numRemision: d.numRemision,
          numGuia: 1000 + i,
          estatusValue: "por_recolectar_en_tienda",
        })),
        cargaId: "44444444-4444-4444-8444-444444444444",
        omitidas: [],
      };
    }),
  } as unknown as IOrdenRepository;
  return { repo, escritas };
}

/**
 * Tarifas por PAR `(tienda, zona)`. Solo `(U_NUFORM, z1)` resuelve: si la carga preguntara por
 * cualquier otra tienda, el lote se queda sin tarifa y sale 409. Es la reproduccion exacta de la
 * consecuencia medida en la ficha —«la Nuform nueva naceria con cero tarifas»— convertida en
 * aserto: aqui la unica tienda con tarifa es la REAL.
 */
function tarifaRepo(): { repo: ITarifaVigenteRepository; pares: ParTarifa[] } {
  const pares: ParTarifa[] = [];
  const porPar = new Map<string, TarifaVigenteResuelta>([
    [clavePar({ tiendaId: U_NUFORM, zonaId: "z1" }), TARIFA],
  ]);
  const repo: ITarifaVigenteRepository = {
    resolveTarifa: vi.fn(async (tiendaId: string, zonaId: string | null) => {
      pares.push({ tiendaId, zonaId });
      return porPar.get(clavePar({ tiendaId, zonaId })) ?? null;
    }),
    resolveTarifas: vi.fn(async (solicitados: readonly ParTarifa[]) => {
      pares.push(...solicitados);
      return new Map<string, TarifaVigenteResuelta | null>(
        solicitados.map((p) => [clavePar(p), porPar.get(clavePar(p)) ?? null]),
      );
    }),
  };
  return { repo, pares };
}

const etiquetasStub = {
  generarYPersistir: vi.fn(async () => ({ consolidado: null, porOrden: new Map<string, string>() })),
} as unknown as IEtiquetasDescargaService;

const manifiestoStub = {
  armar: vi.fn(async () => ({ status: "ok", filas: [], omitidas: [] })),
} as unknown as IManifiestoService;

function deps(
  keyRepo: IApiKeyRepository,
  ordenes: IOrdenRepository,
  tarifas: ITarifaVigenteRepository,
): CargaApiDeps {
  const auth = new ApiKeyAuthService(keyRepo); // AUTENTICADOR REAL: es lo que se esta probando
  return {
    autenticar: (raw) => auth.autenticar(raw),
    bulkService: new BulkOrdenService(ordenes, tarifas),
    descargaService: etiquetasStub,
    manifiestoService: manifiestoStub,
  };
}

function fila(numRemision: string): Record<string, string> {
  return {
    num_remision: numRemision,
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton: "Quito",
    distrito: "La Mariscal",
    producto: "Caja",
  };
}

function req(numRemision: string): Request {
  return new Request("http://localhost/api/ordenes/api-key/carga", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRETO}` },
    body: JSON.stringify({ ordenes: [fila(numRemision)] }),
  });
}

/** La key apuntada a la tienda real, sana: el caso feliz de la ficha. */
const CON_TIENDA: Partial<ApiKeyAutenticada> = {
  tiendaDestinoId: U_NUFORM,
  tiendaDestinoEstado: "activo",
  tiendaDestinoRol: "adminTienda",
};

describe("302 — key CON tienda destino: la orden nace a nombre de la tienda real", () => {
  it("escribe `tiendaId` = la tienda destino, no la cuenta dedicada de la key", async () => {
    const { repo: ordenes, escritas } = ordenRepo();
    const { repo: tarifas } = tarifaRepo();
    const res = await handleCargaApi(
      req("REM-1"),
      deps(apiKeyRepo(CON_TIENDA), ordenes, tarifas),
    );

    expect(res.status).toBe(200);
    expect(escritas).toHaveLength(1);
    // LA linea de la ficha: una sola Nuform en `orden.tienda_id`.
    expect(escritas[0].map((d) => d.tiendaId)).toEqual([U_NUFORM]);
    expect(escritas[0].map((d) => d.tiendaId)).not.toContain(U_KEY);
  });

  it("resuelve la TARIFA por el par (tienda REAL, zona): la key no nace sin tarifas", async () => {
    const { repo: ordenes } = ordenRepo();
    const { repo: tarifas, pares } = tarifaRepo();
    const res = await handleCargaApi(
      req("REM-2"),
      deps(apiKeyRepo(CON_TIENDA), ordenes, tarifas),
    );

    // 200 y no 409: la unica tienda con tarifa en este doble es la REAL. Si el dueno siguiera
    // siendo la cuenta dedicada, el lote no resolveria tarifa y el borde devolveria 409 — que es
    // exactamente el sintoma que describe la ficha.
    expect(res.status).toBe(200);
    expect(pares.length).toBeGreaterThan(0);
    for (const par of pares) expect(par.tiendaId).toBe(U_NUFORM);
  });
});

describe("302 — key SIN tienda destino: el camino existente, intacto", () => {
  it("escribe `tiendaId` = la cuenta dedicada de la key (comportamiento 88/[D4])", async () => {
    const { repo: ordenes, escritas } = ordenRepo();
    // Aqui la tarifa la tiene la CUENTA DEDICADA: es el mundo de antes de la 302.
    const porPar = new Map([[clavePar({ tiendaId: U_KEY, zonaId: "z1" }), TARIFA]]);
    const tarifas: ITarifaVigenteRepository = {
      resolveTarifa: vi.fn(
        async (t: string, z: string | null) => porPar.get(clavePar({ tiendaId: t, zonaId: z })) ?? null,
      ),
      resolveTarifas: vi.fn(
        async (solicitados: readonly ParTarifa[]) =>
          new Map(solicitados.map((p) => [clavePar(p), porPar.get(clavePar(p)) ?? null])),
      ),
    };

    const res = await handleCargaApi(req("REM-3"), deps(apiKeyRepo({}), ordenes, tarifas));

    expect(res.status).toBe(200);
    expect(escritas[0].map((d) => d.tiendaId)).toEqual([U_KEY]);
  });
});

describe("302 — aislamiento: una key no puede cargar a nombre de otra tienda", () => {
  it("el dueno NO sale de la peticion: un `tienda_id` en el cuerpo no cambia nada", async () => {
    const { repo: ordenes, escritas } = ordenRepo();
    const { repo: tarifas } = tarifaRepo();
    // Intento explicito de suplantacion: claves que NO estan en el schema del endpoint.
    const cuerpo = {
      tienda_id: "u-tienda-ajena",
      tiendaId: "u-tienda-ajena",
      ordenes: [{ ...fila("REM-4"), tienda_id: "u-tienda-ajena" }],
    };
    const res = await handleCargaApi(
      new Request("http://localhost/api/ordenes/api-key/carga", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRETO}` },
        body: JSON.stringify(cuerpo),
      }),
      deps(apiKeyRepo(CON_TIENDA), ordenes, tarifas),
    );

    expect(res.status).toBe(200);
    // El dueno sigue siendo el de la KEY, no el del cuerpo. `tiendaId` se fija en el service a
    // partir del actor autenticado; ninguna clave de la peticion participa.
    expect(escritas[0].map((d) => d.tiendaId)).toEqual([U_NUFORM]);
    expect(JSON.stringify(escritas[0])).not.toContain("u-tienda-ajena");
  });

  it("una key cuya tienda destino se dio de BAJA no carga nada (403, ni una fila escrita)", async () => {
    const { repo: ordenes, escritas } = ordenRepo();
    const { repo: tarifas } = tarifaRepo();
    const res = await handleCargaApi(
      req("REM-5"),
      // La tienda se dio de baja DESPUES de generar la key: la comprobacion del alta ya paso.
      deps(apiKeyRepo({ ...CON_TIENDA, tiendaDestinoEstado: "inactivo" }), ordenes, tarifas),
    );

    expect(res.status).toBe(403);
    expect(escritas).toHaveLength(0);
  });
});
