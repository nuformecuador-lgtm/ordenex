// Feature 302 (T4) — AISLAMIENTO ENTRE TIENDAS con la tienda destino puesta.
//
// Esta es la parte delicada de la ficha y por eso tiene archivo propio. Con `tienda_destino_id`,
// lo que una key VE deja de ser «lo que ella misma creo» y pasa a ser «lo de esa tienda», lo que
// incluye las ordenes que la tienda cargo POR PANTALLA. Eso es deliberado —es lo que significa que
// Nuform sea una sola— y aqui se congela como comportamiento explicito, no como efecto colateral.
//
// Lo que NO puede pasar, y es el resto del archivo: que una key alcance a OTRA tienda. El recorte
// sigue siendo de UN solo sujeto (`orden.tienda_id = ownerId`, forzado en el repositorio) y el
// `ownerId` sigue sin salir jamas de la peticion.
//
// El doble de `IOrdenRepository` implementa el filtro por owner HONESTAMENTE (como el WHERE real):
// si el service dejara de forzar el owner, las filas ajenas apareceran de verdad. Un doble que
// devolviera siempre lo mismo no probaria nada.
import { describe, it, expect, vi } from "vitest";
import { handleListadoApi, type ListadoApiDeps } from "@/app/api/ordenes/api-key/route";
import { handleDetalleApi, type DetalleApiDeps } from "@/app/api/ordenes/api-key/[numGuia]/route";
import { ApiKeyAuthService } from "@/lib/services/ApiKeyAuthService";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import { hashApiKey } from "@/lib/utils/api-key-hash";
import type {
  ApiKeyAutenticada,
  IApiKeyRepository,
} from "@/lib/interfaces/repositories/IApiKeyRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";

const SECRETO = "ordx_secretovivo1234567890";

const U_KEY_NUFORM = "u-key-nuform"; // cuenta dedicada de la key de Nuform
const U_NUFORM = "u-nuform"; // la tienda REAL
const U_OTRA = "u-otra-tienda"; // otra tienda, la que nunca se debe ver

/** Fila minima del listado, mas su dueno (la columna `tienda_id` que el WHERE compara). */
interface FilaFalsa {
  tiendaId: string;
  numGuia: number;
  numRemision: string;
  estatusValue: string;
  destinatario: string;
  telefonoDest: string;
  producto: string;
  direccion: string | null;
  montoCobrar: number | null;
  createdAt: Date;
}

function fila(tiendaId: string, numGuia: number, numRemision: string): FilaFalsa {
  return {
    tiendaId,
    numGuia,
    numRemision,
    estatusValue: "por_recolectar_en_tienda",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: null,
    montoCobrar: null,
    createdAt: new Date("2026-08-28T12:00:00Z"),
  };
}

/**
 * El universo de filas del test. Nuform tiene DOS: una cargada por la API y otra cargada POR
 * PANTALLA por la propia tienda (misma `tienda_id`, que es justo el punto). La otra tienda tiene
 * la suya, que ninguna key de Nuform puede alcanzar.
 */
const UNIVERSO: FilaFalsa[] = [
  fila(U_NUFORM, 5001, "NUF-API-1"), // cargada por la API
  fila(U_NUFORM, 5002, "NUF-WEB-1"), // cargada por la tienda desde la pantalla
  fila(U_OTRA, 9001, "OTRA-1"),
  fila(U_KEY_NUFORM, 7001, "KEY-PROPIA-1"), // de la cuenta dedicada (mundo pre-302)
];

/**
 * Doble de `IOrdenRepository` que HONRA el `ownerId`, como hace el WHERE real
 * (`tienda_id = ownerId`). `owners` guarda cada `ownerId` recibido: es la evidencia de QUE id
 * llego a la base, que es exactamente lo que la 302 cambia.
 */
function ordenRepo() {
  const owners: string[] = [];
  const repo = {
    findEstatusIdByValue: vi.fn(async () => "os-erbp"),
    listByOwner: vi.fn(async (params: { ownerId: string; skip: number; take: number }) => {
      owners.push(params.ownerId);
      const propias = UNIVERSO.filter((f) => f.tiendaId === params.ownerId);
      return {
        items: propias.slice(params.skip, params.skip + params.take),
        total: propias.length,
      };
    }),
    findDetalleByNumGuiaForOwner: vi.fn(async (numGuia: number, ownerId: string) => {
      owners.push(ownerId);
      const f = UNIVERSO.find((x) => x.numGuia === numGuia && x.tiendaId === ownerId);
      return f ? { ...f, evidencias: [], gestiones: [] } : null;
    }),
  };
  return { repo, owners };
}

/** No hay evidencias en estas filas: el provider no deberia firmar nada. */
const signedUrls = {
  crearUrlsFirmadas: vi.fn(async () => new Map<string, string>()),
} as unknown as ISignedUrlProvider;

function apiKeyRepo(fila: Partial<ApiKeyAutenticada>): IApiKeyRepository {
  const completa: ApiKeyAutenticada = {
    apiKeyId: "k1",
    usuarioId: U_KEY_NUFORM,
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

const CON_NUFORM: Partial<ApiKeyAutenticada> = {
  tiendaDestinoId: U_NUFORM,
  tiendaDestinoEstado: "activo",
  tiendaDestinoRol: "adminTienda",
};

const CON_OTRA: Partial<ApiKeyAutenticada> = {
  tiendaDestinoId: U_OTRA,
  tiendaDestinoEstado: "activo",
  tiendaDestinoRol: "adminTienda",
};

function depsListado(key: Partial<ApiKeyAutenticada>) {
  const { repo, owners } = ordenRepo();
  const auth = new ApiKeyAuthService(apiKeyRepo(key));
  const deps: ListadoApiDeps = {
    autenticar: (raw) => auth.autenticar(raw),
    lecturaService: new ApiOrdenLecturaService(repo as never, signedUrls),
  };
  return { deps, owners };
}

function depsDetalle(key: Partial<ApiKeyAutenticada>) {
  const { repo, owners } = ordenRepo();
  const auth = new ApiKeyAuthService(apiKeyRepo(key));
  const deps: DetalleApiDeps = {
    autenticar: (raw) => auth.autenticar(raw),
    lecturaService: new ApiOrdenLecturaService(repo as never, signedUrls),
  };
  return { deps, owners };
}

function req(query = ""): Request {
  return new Request(`http://localhost/api/ordenes/api-key${query}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRETO}` },
  });
}

describe("302 — que VE una key con tienda destino", () => {
  it("ve las ordenes de SU tienda, incluidas las que la tienda cargo por pantalla", async () => {
    // CONSECUENCIA ASUMIDA Y DECLARADA de la ficha: el canal deja de ver «lo que la key creo» y
    // pasa a ver «lo de la tienda». Es lo que hace que Nuform sea UNA sola en las lecturas, y a la
    // vez amplia lo que una key filtrada alcanzaria. Queda escrito aqui a proposito.
    const { deps, owners } = depsListado(CON_NUFORM);
    const res = await handleListadoApi(req(), deps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pagination.total).toBe(2);
    expect(body.items.map((i: { numRemision: string }) => i.numRemision).sort()).toEqual([
      "NUF-API-1",
      "NUF-WEB-1",
    ]);
    // El id que llego a la base es el de la TIENDA, no el de la cuenta dedicada.
    expect(owners).toEqual([U_NUFORM]);
  });

  it("NO ve las ordenes de su propia cuenta dedicada: el dueno es uno solo, no dos", async () => {
    // Si el owner se resolviera como «la tienda O la cuenta dedicada», una key veria dos conjuntos
    // y el aislamiento dejaria de ser de un unico sujeto.
    const { deps } = depsListado(CON_NUFORM);
    const body = await (await handleListadoApi(req(), deps)).json();
    expect(JSON.stringify(body)).not.toContain("KEY-PROPIA-1");
  });

  it("una key SIN tienda destino sigue viendo solo lo suyo (camino 88/[D4] intacto)", async () => {
    const { deps, owners } = depsListado({});
    const body = await (await handleListadoApi(req(), deps)).json();
    expect(body.pagination.total).toBe(1);
    expect(body.items[0].numRemision).toBe("KEY-PROPIA-1");
    expect(owners).toEqual([U_KEY_NUFORM]);
  });
});

describe("302 — aislamiento: ninguna key alcanza a otra tienda", () => {
  it("la key de Nuform no ve NI UNA fila de la otra tienda", async () => {
    const { deps } = depsListado(CON_NUFORM);
    const body = await (await handleListadoApi(req(), deps)).json();
    expect(JSON.stringify(body)).not.toContain("OTRA-1");
    expect(JSON.stringify(body)).not.toContain(U_OTRA);
  });

  it("y la key de la otra tienda tampoco ve nada de Nuform: el aislamiento es simetrico", async () => {
    const { deps, owners } = depsListado(CON_OTRA);
    const body = await (await handleListadoApi(req(), deps)).json();
    expect(body.pagination.total).toBe(1);
    expect(body.items[0].numRemision).toBe("OTRA-1");
    expect(owners).toEqual([U_OTRA]);
  });

  it("el detalle de una guia AJENA devuelve 404, igual que una que no existe", async () => {
    // Indistinguibilidad (106/R13/R14): el canal no puede ser un oraculo de existencia de guias de
    // la competencia. `num_guia` es UNIQUE GLOBAL, asi que la unica defensa es el owner en el WHERE.
    const ajena = await handleDetalleApi(req(), "9001", depsDetalle(CON_NUFORM).deps);
    const inexistente = await handleDetalleApi(req(), "999999", depsDetalle(CON_NUFORM).deps);

    expect(ajena.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(await ajena.json()).toEqual(await inexistente.json());
  });

  it("el detalle de una guia PROPIA de la tienda si responde 200 (la guarda no cierra el canal)", async () => {
    const res = await handleDetalleApi(req(), "5002", depsDetalle(CON_NUFORM).deps);
    expect(res.status).toBe(200);
    expect((await res.json()).numRemision).toBe("NUF-WEB-1");
  });

  it("un `tienda_id` en la query NO amplia el alcance (la clave ni se lee)", async () => {
    const { deps, owners } = depsListado(CON_NUFORM);
    const res = await handleListadoApi(req(`?tienda_id=${U_OTRA}&owner=${U_OTRA}`), deps);
    const body = await res.json();

    expect(res.status).toBe(200); // clave desconocida: se ignora, no es un 422
    expect(body.pagination.total).toBe(2); // sigue viendo SOLO lo de Nuform
    expect(owners).toEqual([U_NUFORM]);
  });
});
