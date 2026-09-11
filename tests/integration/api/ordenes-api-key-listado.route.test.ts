import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { handleListadoApi, type ListadoApiDeps } from "@/app/api/ordenes/api-key/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenLecturaService } from "@/lib/interfaces/services/IApiOrdenLecturaService";
import type { ApiOrdenListadoDTO } from "@/lib/types/api-orden";
// ⏳ 2026-09-09 (feature 404, T6): los casos del campo nuevo montan la CADENA REAL
// (route -> ApiOrdenLecturaService -> OrdenRepository -> Prisma mockeado). Con el service falso de
// arriba pasarian aunque nadie inyectara nada y aunque el mapeo del repositorio no existiera: es
// el modo de fallo del «composition root que no inyecta».
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
// ⏳ 2026-09-10 (feature 415, T6): el resolutor REAL de la tarifa vigente, para que los importes
// que se afirman salgan de la cadena entera y no de un doble.
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import { FILA_PRISMA_415 } from "@/tests/fixtures/api-orden-costeo-415";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

function okListado(): ApiOrdenListadoDTO {
  return {
    items: [
      {
        numGuia: 10234,
        numRemision: "REM-1",
        estado: "en_bodega_central",
        destinatario: "Ana",
        telefonoDest: "099",
        producto: "Caja",
        direccion: "Calle 1",
        montoCobrar: 1500,
        createdAt: new Date("2026-07-20T15:04:00.000Z"),
        // ⏳ 2026-09-09 (feature 404): campo REQUERIDO del DTO publico.
        mensajero: null,
        // ⏳ 2026-09-10 (feature 415): campos REQUERIDOS del DTO publico. Este doble no mide
        // importes: los casos que si los miden montan la cadena real.
        zona: { id: "018f2c31-0000-4000-8000-00000000za01", nombre: "GAM" },
        costoEstimado: null,
        costoReal: null,
      },
    ],
    pagination: { limit: 50, offset: 0, total: 173 },
  };
}

function fakeService(overrides: Partial<IApiOrdenLecturaService> = {}): IApiOrdenLecturaService {
  return {
    listar: vi.fn().mockResolvedValue(okListado()),
    detallePorOrdenId: vi.fn(), // feature 177: metodo hermano, no usado por este endpoint
    ...overrides,
  };
}

function deps(
  auth: ApiKeyAuthResult,
  service: IApiOrdenLecturaService,
  spyAuth?: ListadoApiDeps["autenticar"],
): ListadoApiDeps {
  return { autenticar: spyAuth ?? (async () => auth), lecturaService: service };
}

function req(query = "", bearer?: string): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request(`http://localhost/api/ordenes/api-key${query}`, { method: "GET", headers });
}

/**
 * ⏳ 2026-09-10 (feature 415): el resolutor de tarifa VIGENTE que el service pide por
 * constructor. Aqui no resuelve ninguna: estos casos no miden importes.
 */
const fakeTarifas = () => ({ resolveTarifas: vi.fn().mockResolvedValue(new Map()) });

describe("GET /api/ordenes/api-key — autenticacion (R1/R2/R3)", () => {
  it("R1: sin Bearer -> 401 y autenticar recibe null, sin llamar al service", async () => {
    const spyAuth = vi.fn(async () => ({ status: "unauthenticated" }) as ApiKeyAuthResult);
    const service = fakeService();
    const res = await handleListadoApi(req(), deps({ status: "unauthenticated" }, service, spyAuth));
    expect(res.status).toBe(401);
    expect(spyAuth).toHaveBeenCalledWith(null);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R2: key inexistente (autenticar unauthenticated) -> 401", async () => {
    const service = fakeService();
    const res = await handleListadoApi(req("", SECRETO), deps({ status: "unauthenticated" }, service));
    expect(res.status).toBe(401);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R3: usuario inactivo (forbidden) -> 403", async () => {
    const service = fakeService();
    const res = await handleListadoApi(req("", SECRETO), deps({ status: "forbidden" }, service));
    expect(res.status).toBe(403);
    expect(service.listar).not.toHaveBeenCalled();
  });
});

describe("GET /api/ordenes/api-key — listado (R8/R9/R10)", () => {
  it("R10: 200 con items + pagination (total)", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?limit=50&offset=0", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pagination).toEqual({ limit: 50, offset: 0, total: 173 });
    expect(json.items[0]).toMatchObject({ numGuia: 10234, estado: "en_bodega_central" });
  });

  it("R8: ignora tiendaId de la query (el service recibe el actor, no el input)", async () => {
    const service = fakeService();
    await handleListadoApi(
      req("?tiendaId=store-999&limit=10", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(service.listar).toHaveBeenCalledWith(ACTOR, { limit: 10, offset: 0, estado: undefined });
  });

  it("R9: limit > 100 -> 422, sin consultar", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?limit=150", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(422);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R9: limit no numerico -> 422", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?limit=abc", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(422);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R9: offset negativo -> 422", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?offset=-5", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(422);
  });

  it("estado fuera del catalogo -> 422", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?estado=inventado", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(422);
  });
});

// -----------------------------------------------------------------------------------------------
// ⏳ 2026-09-09 — Feature 404 (T6): `mensajero` en el borde HTTP del LISTADO, de punta a punta.
// -----------------------------------------------------------------------------------------------

const MENSAJERO_ID = "018f2c31-0000-4000-8000-0000000000aa";
const MENSAJERO_ROW = {
  id: MENSAJERO_ID,
  nombre: "Carlos",
  primerApellido: "Jimenez",
  segundoApellido: "Mora",
};
const AJENO_ID = "018f2c31-0000-4000-8000-0000000000cc";
const AJENO_ROW = { id: AJENO_ID, nombre: "Pedro", primerApellido: "Ajeno", segundoApellido: null };

/** Fila de `orden` como la devuelve Prisma para `API_ORDEN_SELECT`, con su owner. */
function filaOrden(over: Record<string, unknown> = {}) {
  return {
    tiendaId: "store-1",
    numGuia: 10234,
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: new Prisma.Decimal(1500),
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    estatus: { value: "en_reparto" },
    // ⏳ 2026-09-10 (feature 415): lo que el `select` del canal anade a la fila cruda.
    ...FILA_PRISMA_415,
    mensajeroAsignado: MENSAJERO_ROW,
    ...over,
  };
}

const signedUrlsNoOp: ISignedUrlProvider = {
  createSignedUrl: vi.fn(async () => "https://signed/one"),
  createSignedUrls: vi.fn(async () => ({})),
};

/**
 * Prisma falso que APLICA de verdad el `where.tiendaId` sobre el conjunto de filas: sin eso, el
 * caso de scope (R20) estaria verde aunque el repositorio hubiera dejado de acotar por owner.
 */
function prismaConOrdenes(filas: ReturnType<typeof filaOrden>[]) {
  const visibles = (where: Record<string, unknown>) =>
    filas.filter((f) => f.tiendaId === where.tiendaId);
  return {
    orden: {
      findMany: vi.fn(async (arg: { where: Record<string, unknown> }) => visibles(arg.where)),
      count: vi.fn(async (arg: { where: Record<string, unknown> }) => visibles(arg.where).length),
      findFirst: vi.fn(async () => null),
    },
    usuario: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  };
}

/** La cadena real, con el `OrdenRepository` de produccion encima del Prisma falso. */
function depsReales(prisma: ReturnType<typeof prismaConOrdenes>): ListadoApiDeps {
  const repo = new OrdenRepository(prisma as unknown as PrismaClient);
  return {
    autenticar: async () => ({ status: "ok", actor: ACTOR, apiKeyId: "k1" }) as ApiKeyAuthResult,
    lecturaService: new ApiOrdenLecturaService(repo, signedUrlsNoOp, fakeTarifas() as never),
  };
}

describe("GET /api/ordenes/api-key — `mensajero` de punta a punta (feature 404)", () => {
  it("404/R14: CADA item de la respuesta HTTP trae `mensajero` con `{id, nombre}`", async () => {
    const prisma = prismaConOrdenes([
      filaOrden({ numRemision: "REM-1" }),
      filaOrden({ numRemision: "REM-2" }),
    ]);
    const res = await handleListadoApi(req("?limit=50", SECRETO), depsReales(prisma));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(2);
    for (const item of json.items) {
      // Literal a mano: el nombre completo compuesto de las tres columnas.
      expect(item.mensajero).toEqual({ id: MENSAJERO_ID, nombre: "Carlos Jimenez Mora" });
    }
  });

  it("404/R2+R23: la orden sin asignado sale con `mensajero: null`, y la clave viaja", async () => {
    const prisma = prismaConOrdenes([filaOrden({ mensajeroAsignado: null })]);
    const res = await handleListadoApi(req("?limit=50", SECRETO), depsReales(prisma));

    const cuerpo = await res.text();
    expect(cuerpo).toContain('"mensajero":null'); // en el JSON REAL, no en un objeto intermedio
    expect(JSON.parse(cuerpo).items[0].mensajero).toBeNull();
  });

  it("404/R16: los nueve campos publicados y `pagination` no cambian de forma", async () => {
    const prisma = prismaConOrdenes([filaOrden()]);
    const res = await handleListadoApi(req("?limit=50&offset=0", SECRETO), depsReales(prisma));

    const json = await res.json();
    // Igualdad exacta del juego de claves: un decimo campo colado la pone roja.
    //
    // ⏳ 2026-09-10 (feature 415, R34) — ENMENDADO con su motivo, no relajado. La 415 anade TRES
    // campos ADITIVOS (`zona`, `costoEstimado`, `costoReal`) y el conjunto exacto pasa de DIEZ a
    // TRECE. Sigue siendo una igualdad de la lista ENTERA —ni `toContain` ni un aserto de
    // longitud—, asi que un campo colado por un spread la sigue poniendo roja y diciendo cual.
    // Las diez de antes conservan su nombre, que es lo que R34 pide.
    expect(Object.keys(json.items[0]).sort()).toEqual([
      "costoEstimado",
      "costoReal",
      "createdAt",
      "destinatario",
      "direccion",
      "estado",
      "mensajero",
      "montoCobrar",
      "numGuia",
      "numRemision",
      "producto",
      "telefonoDest",
      "zona",
    ]);
    expect(json.pagination).toEqual({ limit: 50, offset: 0, total: 1 });
    expect(Object.keys(json).sort()).toEqual(["items", "pagination"]);
    // Y los valores de los nueve, uno a uno, sin cambiar de tipo.
    expect(json.items[0]).toMatchObject({
      numGuia: 10234,
      numRemision: "REM-1",
      estado: "en_reparto",
      destinatario: "Ana",
      telefonoDest: "0991234567",
      producto: "Caja",
      direccion: "Calle 1",
      montoCobrar: 1500,
    });
  });

  it("404/R20: una orden de OTRO owner sigue sin aparecer, y su mensajero tampoco", async () => {
    const prisma = prismaConOrdenes([
      filaOrden({ numRemision: "REM-MIA" }),
      filaOrden({
        tiendaId: "store-AJENA",
        numRemision: "REM-AJENA",
        mensajeroAsignado: AJENO_ROW,
      }),
    ]);
    const res = await handleListadoApi(req("?limit=50", SECRETO), depsReales(prisma));

    const cuerpo = await res.text();
    const json = JSON.parse(cuerpo);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].numRemision).toBe("REM-MIA");
    // Ni la orden ajena ni el nombre ni el id de SU mensajero aparecen por ningun lado.
    expect(cuerpo).not.toContain("REM-AJENA");
    expect(cuerpo).not.toContain("Pedro");
    expect(cuerpo).not.toContain(AJENO_ID);
    // Y el `where` que llego a Prisma sigue forzando el owner del actor.
    expect(prisma.orden.findMany.mock.calls[0][0].where).toMatchObject({
      tiendaId: "store-1",
      deletedAt: null,
    });
  });

  it("404/R17: `?mensajero=` se IGNORA: misma respuesta y mismo `where` que sin el parametro", async () => {
    const sinParam = prismaConOrdenes([filaOrden()]);
    const conParam = prismaConOrdenes([filaOrden()]);

    const a = await handleListadoApi(req("?limit=50&offset=0", SECRETO), depsReales(sinParam));
    const b = await handleListadoApi(
      req(`?limit=50&offset=0&mensajero=${MENSAJERO_ID}&order_by=mensajero`, SECRETO),
      depsReales(conParam),
    );

    expect(b.status).toBe(200); // no es un 422: es una clave desconocida, se ignora (106/R8)
    expect(await b.text()).toBe(await a.text()); // respuesta identica, byte a byte
    const whereA = sinParam.orden.findMany.mock.calls[0][0] as Record<string, unknown>;
    const whereB = conParam.orden.findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(whereB).toEqual(whereA);
    expect(whereB.where).not.toHaveProperty("mensajeroAsignadoId");
    // R16/R17: la ordenacion sigue siendo la de siempre —`created_at desc`, que es lo que sostiene
    // el orden de las filas entre paginas— y NO se ordena por el mensajero.
    expect(whereB.orderBy).toEqual({ createdAt: "desc" });
    expect(JSON.stringify(whereB.orderBy)).not.toContain("mensajero");
  });

  it("404/R21+R22: la respuesta no lleva storagePath, bucket, tiendaId ni el texto libre de la gestion", async () => {
    const prisma = prismaConOrdenes([filaOrden()]);
    const res = await handleListadoApi(req("?limit=50", SECRETO), depsReales(prisma));

    const cuerpo = await res.text();
    expect(cuerpo).not.toMatch(/storagePath|storage_path|bucket/i);
    expect(cuerpo).not.toContain("tiendaId");
    expect(cuerpo).not.toContain("store-1"); // el owner no se devuelve, ya es quien pregunta
    // 256/R22: el texto libre del mensajero no se emite por ninguna superficie.
    expect(cuerpo).not.toContain("gestion");
    expect(cuerpo).not.toMatch(/mensajeroId|mensajeroGestion/);
  });
});

// -----------------------------------------------------------------------------------------------
// ⏳ 2026-09-10 — Feature 415 (T6): `zona`, `costoEstimado` y `costoReal` de PUNTA A PUNTA.
//
// Cadena REAL: route handler -> `ApiOrdenLecturaService` -> `OrdenRepository` ->
// `TarifaVigenteRepository` -> Prisma falso. Lo unico de mentira es Prisma.
// -----------------------------------------------------------------------------------------------

const ZONA_415 = { id: "018f2c31-0000-4000-8000-00000000za01", nombre: "GAM" };
const ZONA_415_B = { id: "018f2c31-0000-4000-8000-00000000za07", nombre: "FGAM Limon" };

/** La fila de `tarifas` de nivel 1 (tienda + zona) para la zona GAM del test. */
const TARIFA_415 = {
  id: "tarifa-415",
  tiendaId: "store-1",
  zonaId: ZONA_415.id,
  fulfillment: new Prisma.Decimal("696.00"),
  valorFlete: new Prisma.Decimal("3000.00"),
  valorFleteGam: new Prisma.Decimal("2500.00"),
  valorFleteDevuelto: new Prisma.Decimal("1500.00"),
  valorFleteDevueltoGam: new Prisma.Decimal("1200.00"),
  comisionCod: new Prisma.Decimal("3.50"),
  ivaFlete: new Prisma.Decimal("13.00"),
  ivaComisionCod: new Prisma.Decimal("13.00"),
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/**
 * Importes ESCRITOS A MANO (aritmetica anotada), con `montoCobrar` 25900.00 y comision activa:
 *   flete = 2500.00 (GAM) · iva = 2500.00 x 13 % = 325.00
 *   comision = 25900.00 x 3.50 % = 906.50 · ivaComision = 906.50 x 13 % = 117.845 -> 117.85
 *   fulfillment = 696.00
 */
const COSTO_415 = {
  flete: "2500.00",
  iva: "325.00",
  comision: "906.50",
  ivaComision: "117.85",
  fulfillment: "696.00",
};

/** La orden con COD y comision, para que los cinco conceptos sean distintos de cero. */
function filaOrden415(over: Record<string, unknown> = {}) {
  return filaOrden({
    montoCobrar: new Prisma.Decimal("25900.00"),
    cobraComision: true,
    ...over,
  });
}

/** Prisma falso que ADEMAS responde a `tarifa.findMany`, para el resolutor REAL. */
function prismaConTarifas(filas: ReturnType<typeof filaOrden>[], tarifas: unknown[] = [TARIFA_415]) {
  const base = prismaConOrdenes(filas);
  return { ...base, tarifa: { findMany: vi.fn(async () => tarifas) } };
}

/** La cadena real COMPLETA, con el `TarifaVigenteRepository` de produccion. */
function depsRealesConTarifa(prisma: ReturnType<typeof prismaConTarifas>): ListadoApiDeps {
  const repo = new OrdenRepository(prisma as unknown as PrismaClient);
  return {
    autenticar: async () => ({ status: "ok", actor: ACTOR, apiKeyId: "k1" }) as ApiKeyAuthResult,
    lecturaService: new ApiOrdenLecturaService(
      repo,
      signedUrlsNoOp,
      new TarifaVigenteRepository(prisma as unknown as PrismaClient),
    ),
  };
}

describe("GET /api/ordenes/api-key — zona y costo de punta a punta (feature 415)", () => {
  it("415/R1+R2: CADA item trae `zona` con las dos claves, y nunca `null`", async () => {
    const prisma = prismaConTarifas([
      filaOrden415({ numRemision: "REM-1" }),
      filaOrden415({ numRemision: "REM-2", zona: { ...ZONA_415_B, esCentral: false }, zonaId: ZONA_415_B.id }),
    ]);
    const res = await handleListadoApi(req("?limit=50", SECRETO), depsRealesConTarifa(prisma));

    const json = await res.json();
    expect(json.items).toHaveLength(2);
    expect(json.items[0].zona).toEqual(ZONA_415);
    expect(json.items[1].zona).toEqual(ZONA_415_B);
    for (const item of json.items) {
      expect(item.zona).not.toBeNull();
      expect(Object.keys(item.zona).sort()).toEqual(["id", "nombre"]);
    }
  });

  it("415/R9+R19: cada item trae `costoEstimado` con los CINCO conceptos exactos", async () => {
    const prisma = prismaConTarifas([filaOrden415()]);
    const res = await handleListadoApi(req("?limit=50", SECRETO), depsRealesConTarifa(prisma));

    const json = await res.json();
    // Literales a mano (ver la aritmetica de `COSTO_415`), sobre la respuesta HTTP REAL.
    expect(json.items[0].costoEstimado).toEqual(COSTO_415);
    // Y sin fila congelada, `costoReal` viaja como `null` explicito, no omitido.
    expect(json.items[0].costoReal).toBeNull();
  });

  it("415/R22: sin tarifa que resuelva, `costoEstimado` es `null` y NO cinco ceros", async () => {
    // La tabla de tarifas no devuelve ninguna fila que case con el par.
    const prisma = prismaConTarifas([filaOrden415()], []);
    const res = await handleListadoApi(req("?limit=50", SECRETO), depsRealesConTarifa(prisma));

    const cuerpo = await res.text();
    expect(cuerpo).toContain('"costoEstimado":null');
    expect(cuerpo).not.toContain('"flete":"0.00"');
    expect(JSON.parse(cuerpo).items[0].costoEstimado).toBeNull();
  });

  it("415/R7+R18: `?zona=`, `?zona_id=`, `?costoEstimado=` y `?order_by=costo` se IGNORAN", async () => {
    const sinParam = prismaConTarifas([filaOrden415()]);
    const conParam = prismaConTarifas([filaOrden415()]);

    const a = await handleListadoApi(
      req("?limit=50&offset=0", SECRETO),
      depsRealesConTarifa(sinParam),
    );
    const b = await handleListadoApi(
      req(
        `?limit=50&offset=0&zona=GAM&zona_id=${ZONA_415.id}&costoEstimado=2500.00&costo_real=1&order_by=costo`,
        SECRETO,
      ),
      depsRealesConTarifa(conParam),
    );

    expect(b.status).toBe(200); // clave desconocida -> se ignora (106/R8), no es un 422
    expect(await b.text()).toBe(await a.text()); // respuesta identica, byte a byte
    const argA = sinParam.orden.findMany.mock.calls[0][0] as Record<string, unknown>;
    const argB = conParam.orden.findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(argB).toEqual(argA);
    expect(argB.orderBy).toEqual({ createdAt: "desc" }); // el orden entre paginas no se mueve
    expect(JSON.stringify(argB.orderBy)).not.toMatch(/zona|costo|flete|tarifa/i);
  });

  it("415/R32: una orden de OTRO owner sigue sin aparecer, y su zona y su costo tampoco", async () => {
    const prisma = prismaConTarifas([
      filaOrden415({ numRemision: "REM-MIA" }),
      filaOrden415({
        tiendaId: "store-AJENA",
        numRemision: "REM-AJENA",
        zona: { id: "zona-AJENA", nombre: "ZONA AJENA", esCentral: false },
        zonaId: "zona-AJENA",
      }),
    ]);
    const res = await handleListadoApi(req("?limit=50", SECRETO), depsRealesConTarifa(prisma));

    const cuerpo = await res.text();
    expect(JSON.parse(cuerpo).items).toHaveLength(1);
    expect(cuerpo).not.toContain("REM-AJENA");
    expect(cuerpo).not.toContain("ZONA AJENA");
    expect(cuerpo).not.toContain("zona-AJENA");
    // Y el par que se pidio a `tarifas` lleva el owner del ACTOR, no el de la fila ajena.
    const llamada = prisma.tarifa.findMany.mock.calls[0] as unknown as [{ where: unknown }];
    const whereTarifas = JSON.stringify(llamada[0].where);
    expect(whereTarifas).toContain("store-1");
    expect(whereTarifas).not.toContain("store-AJENA");
  });

  it("415/R5+R18+R35: la respuesta no lleva `zonaId`, `esCentral`, `tarifaId` ni `cierreId`", async () => {
    const prisma = prismaConTarifas([filaOrden415()]);
    const res = await handleListadoApi(req("?limit=50", SECRETO), depsRealesConTarifa(prisma));

    const cuerpo = await res.text();
    // Ampliacion del aserto de exclusion que ya existia mas arriba, no uno paralelo: aqui entran
    // por su nombre las cosas que la 415 LEE y no publica.
    for (const fuga of [
      "zonaId",
      "esCentral",
      "esZonaEspecial",
      "costeo",
      "tarifaId",
      "tarifa-415",
      "cierreId",
      "cierreDetalles",
    ]) {
      expect(cuerpo, `se filtro \`${fuga}\``).not.toContain(fuga);
    }
  });

  it("415/R24: la pagina entera resuelve tarifas en UNA sola consulta, sea cual sea su tamano", async () => {
    const muchas = Array.from({ length: 20 }, (_, i) =>
      filaOrden415({
        numRemision: `REM-${i}`,
        // Diez en GAM y diez en Limon: dos pares DISTINTOS, una sola consulta.
        ...(i % 2 === 0 ? {} : { zona: { ...ZONA_415_B, esCentral: false }, zonaId: ZONA_415_B.id }),
      }),
    );
    const prisma = prismaConTarifas(muchas);

    const res = await handleListadoApi(req("?limit=50", SECRETO), depsRealesConTarifa(prisma));

    expect(JSON.parse(await res.text()).items).toHaveLength(20);
    expect(prisma.tarifa.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orden.findMany).toHaveBeenCalledTimes(1);
  });

  it("415/R36: los codigos de estado no cambian — 401 sin key y 422 con un `limit` invalido", async () => {
    const prisma = prismaConTarifas([filaOrden415()]);
    const deps = depsRealesConTarifa(prisma);

    const sinKey = await handleListadoApi(req("?limit=50", SECRETO), {
      ...deps,
      autenticar: async () => ({ status: "unauthenticated" }) as ApiKeyAuthResult,
    });
    expect(sinKey.status).toBe(401);

    const prohibida = await handleListadoApi(req("?limit=50", SECRETO), {
      ...deps,
      autenticar: async () => ({ status: "forbidden" }) as ApiKeyAuthResult,
    });
    expect(prohibida.status).toBe(403);

    const limiteMalo = await handleListadoApi(req("?limit=0", SECRETO), deps);
    expect(limiteMalo.status).toBe(422);
  });
});
