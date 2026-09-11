// Feature 177 — T13: tests de INTEGRACION del handler `GET /api/ordenes/api-key/orden/{id}`.
// Sin DB y sin Storage: el autenticador y el lector de detalle se inyectan por `deps`, y la
// resolucion usa el SERVICE REAL (`ApiOrdenResolucionService`) sobre un repo fake, para que el
// caso discriminante de R14 se compruebe extremo a extremo (borde -> service -> repo).
import { describe, it, expect, vi } from "vitest";
import {
  handleConsultaOrdenApi,
  type ConsultaOrdenApiDeps,
} from "@/app/api/ordenes/api-key/orden/[id]/route";
import { ApiOrdenResolucionService } from "@/lib/services/ApiOrdenResolucionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { ApiOrdenDetalleDTO } from "@/lib/types/api-orden";
// ⏳ 2026-09-09 (feature 404, T6): los casos del campo nuevo cablean la CADENA REAL por debajo del
// handler (ApiOrdenLecturaService -> OrdenRepository -> Prisma mockeado). Con el `detalleDe` falso
// de arriba pasarian aunque el repositorio no proyectara nada.
import { Prisma, type PrismaClient } from "@prisma/client";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import { FILA_PRISMA_415 } from "@/tests/fixtures/api-orden-costeo-415";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const OK_AUTH: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };
const SECRETO = "ordx_secretovivo1234567890";

type Fila = { id: string; numGuia: number | null; numRemision: string };

/** Orden A: casa por GUIA. Orden B: casa por REMISION con el MISMO identificador. */
const ORDEN_A: Fila = { id: "orden-A", numGuia: 100234, numRemision: "REM-A" };
const ORDEN_B: Fila = { id: "orden-B", numGuia: 999001, numRemision: "100234" };

function detalleDe(fila: Fila, overrides: Partial<ApiOrdenDetalleDTO> = {}): ApiOrdenDetalleDTO {
  return {
    numGuia: fila.numGuia,
    numRemision: fila.numRemision,
    estado: "entregada",
    destinatario: "Ana",
    telefonoDest: "0999999999",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: 1500,
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    // ⏳ 2026-09-09 (feature 404): campo REQUERIDO del DTO publico; por defecto, sin asignado.
    mensajero: null,
    // ⏳ 2026-09-10 (feature 415): campos REQUERIDOS del DTO publico.
    zona: { id: "018f2c31-0000-4000-8000-00000000za01", nombre: "GAM" },
    costoEstimado: null,
    costoReal: null,
    // ⏳ 2026-09-10 (feature 405): campo REQUERIDO del DTO publico; por defecto, sin gestiones.
    // Los casos de la 405 que SI las miden cablean la cadena real (`depsRealesDetalle`), no este
    // doble: con el doble pasarian aunque el repositorio no proyectara nada.
    gestiones: [],
    evidencias: [
      {
        resultado: "entregada",
        contentType: "image/jpeg",
        url: "https://proyecto.supabase.co/storage/v1/object/sign/abc",
        expiraEnSegundos: 300,
      },
    ],
    ...overrides,
  };
}

/** Repo fake de la resolucion: devuelve las filas que casan por igualdad exacta (R10). */
function repoCon(filas: Fila[]) {
  return {
    findByGuiaORemisionForOwner: vi.fn(
      async (ident: { numGuia: number | null; numRemision: string }, ownerId: string) => {
        expect(ownerId).toBe(ACTOR.usuarioId); // R4/R7: owner SIEMPRE del actor
        return filas.filter(
          (f) =>
            (ident.numGuia !== null && f.numGuia === ident.numGuia) ||
            f.numRemision === ident.numRemision,
        );
      },
    ),
  };
}

function deps(
  auth: ApiKeyAuthResult,
  filas: Fila[],
  detalle?: (actor: Actor, ordenId: string) => Promise<ApiOrdenDetalleDTO | null>,
) {
  const repo = repoCon(filas);
  const detallePorOrdenId = vi.fn(
    detalle ??
      (async (_actor: Actor, ordenId: string) => {
        const fila = filas.find((f) => f.id === ordenId);
        return fila ? detalleDe(fila) : null;
      }),
  );
  const d: ConsultaOrdenApiDeps = {
    autenticar: vi.fn(async () => auth),
    resolucionService: new ApiOrdenResolucionService(repo),
    detallePorOrdenId,
  };
  return { deps: d, repo, detallePorOrdenId };
}

function req(bearer?: string, esquema = "Bearer"): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers.Authorization = `${esquema} ${bearer}`;
  return new Request("http://localhost/api/ordenes/api-key/orden/100234", {
    method: "GET",
    headers,
  });
}

/**
 * ⏳ 2026-09-10 (feature 415): el resolutor de tarifa VIGENTE que el service pide por
 * constructor. Aqui no resuelve ninguna: estos casos no miden importes.
 */
const fakeTarifas = () => ({ resolveTarifas: vi.fn().mockResolvedValue(new Map()) });

describe("GET /api/ordenes/api-key/orden/{id} — autenticacion (R1/R2/R3)", () => {
  it("R1: sin Bearer, con esquema distinto o con token vacio -> 401 sin tocar DB ni Storage", async () => {
    for (const peticion of [req(), req("", "Bearer"), req(SECRETO, "Basic")]) {
      const { deps: d, repo, detallePorOrdenId } = deps({ status: "unauthenticated" }, [ORDEN_A]);
      const res = await handleConsultaOrdenApi(peticion, "100234", d);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ status: "error", code: "UNAUTHORIZED" });
      expect(repo.findByGuiaORemisionForOwner).toHaveBeenCalledTimes(0);
      expect(detallePorOrdenId).toHaveBeenCalledTimes(0);
    }
  });

  it("R2: key desconocida -> 401 indistinguible de 'no presento key'", async () => {
    const { deps: d, repo } = deps({ status: "unauthenticated" }, [ORDEN_A]);
    const res = await handleConsultaOrdenApi(req("ordx_inexistente"), "100234", d);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ status: "error", code: "UNAUTHORIZED" });
    expect(repo.findByGuiaORemisionForOwner).toHaveBeenCalledTimes(0);
  });

  it("R3: usuario o key no activos -> 403 sin leer ordenes ni tocar Storage", async () => {
    const { deps: d, repo, detallePorOrdenId } = deps({ status: "forbidden" }, [ORDEN_A]);
    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(repo.findByGuiaORemisionForOwner).toHaveBeenCalledTimes(0);
    expect(detallePorOrdenId).toHaveBeenCalledTimes(0);
  });
});

describe("GET /api/ordenes/api-key/orden/{id} — resolucion (R6/R11/R12/R14/R15/R16)", () => {
  it("R6/R9/R16: 200 resolviendo por guia", async () => {
    const { deps: d, detallePorOrdenId } = deps(OK_AUTH, [ORDEN_A]);
    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.numGuia).toBe(100234);
    expect(json.numRemision).toBe("REM-A");
    expect(json.evidencias[0]).toMatchObject({ resultado: "entregada", expiraEnSegundos: 300 });
    expect(detallePorOrdenId).toHaveBeenCalledWith(ACTOR, "orden-A");
  });

  it("R15: 200 resolviendo por remision cuando ninguna guia coincide", async () => {
    const { deps: d, detallePorOrdenId } = deps(OK_AUTH, [ORDEN_B]);
    const res = await handleConsultaOrdenApi(req(SECRETO), "REM-XYZ-9", d);
    expect(res.status).toBe(404); // REM-XYZ-9 no casa con ninguna fila
    const otro = deps(OK_AUTH, [{ id: "orden-C", numGuia: null, numRemision: "REM-XYZ-9" }]);
    const res2 = await handleConsultaOrdenApi(req(SECRETO), "REM-XYZ-9", otro.deps);
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({ numRemision: "REM-XYZ-9", numGuia: null });
    expect(otro.detallePorOrdenId).toHaveBeenCalledWith(ACTOR, "orden-C");
    expect(detallePorOrdenId).toHaveBeenCalledTimes(0);
  });

  it("R11: 404 cuando ninguna orden propia coincide", async () => {
    const { deps: d } = deps(OK_AUTH, [ORDEN_A]);
    const res = await handleConsultaOrdenApi(req(SECRETO), "NO-EXISTE", d);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ status: "error", code: "NOT_FOUND" });
  });

  it("R12: 404 de orden ajena BYTE-IDENTICO al 404 de inexistente", async () => {
    // Ajena/borrada: el repo (owner forzado) no la devuelve, igual que si no existiera.
    const inexistente = await handleConsultaOrdenApi(
      req(SECRETO),
      "NO-EXISTE",
      deps(OK_AUTH, []).deps,
    );
    const ajena = await handleConsultaOrdenApi(req(SECRETO), "100234", deps(OK_AUTH, []).deps);
    expect(inexistente.status).toBe(404);
    expect(ajena.status).toBe(404);
    expect(await ajena.text()).toBe(await inexistente.text());
  });

  it("R14 (DISCRIMINANTE, extremo a extremo): con la guia de A y la remision de B casando a la vez devuelve A, no B", async () => {
    const { deps: d, detallePorOrdenId } = deps(OK_AUTH, [ORDEN_B, ORDEN_A]);
    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);
    expect(res.status).toBe(200);
    const json = await res.json();
    // El campo que distingue A de B: la remision de A.
    expect(json.numRemision).toBe("REM-A");
    expect(json.numRemision).not.toBe("100234");
    expect(json.numGuia).toBe(100234);
    expect(detallePorOrdenId).toHaveBeenCalledWith(ACTOR, "orden-A");
    expect(detallePorOrdenId).not.toHaveBeenCalledWith(ACTOR, "orden-B");
  });

  it("R16: 200 con evidencias vacias -> []", async () => {
    const { deps: d } = deps(OK_AUTH, [ORDEN_A], async () =>
      detalleDe(ORDEN_A, { evidencias: [] }),
    );
    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);
    expect(res.status).toBe(200);
    expect((await res.json()).evidencias).toEqual([]);
  });
});

describe("GET /api/ordenes/api-key/orden/{id} — validacion y contrato (R13/R18/R42)", () => {
  it.each([
    ["vacio", ""],
    ["solo espacios", "     "],
    ["mas de 128 chars", "R".repeat(129)],
  ])("R13: 422 con {id} %s, sin tocar la DB", async (_caso, valor) => {
    const { deps: d, repo, detallePorOrdenId } = deps(OK_AUTH, [ORDEN_A]);
    const res = await handleConsultaOrdenApi(req(SECRETO), valor, d);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toMatchObject({ status: "error", code: "VALIDATION_ERROR" });
    expect(json.details.fieldErrors.id).toBeDefined(); // detalle POR CAMPO
    expect(repo.findByGuiaORemisionForOwner).toHaveBeenCalledTimes(0);
    expect(detallePorOrdenId).toHaveBeenCalledTimes(0);
  });

  // ⏳ 2026-09-09 (feature 404, R21/R22) — se AMPLIA esta lista en vez de escribir un aserto
  // paralelo. Sale de ella la palabra suelta «mensajero»: el detalle publica `mensajero: {id,
  // nombre} | null` —el ASIGNADO— por la excepcion acotada a 106/R16 que el humano firmo el
  // 2026-09-09 (design §2). Entran, por su nombre, las cosas que la palabra generica tapaba y que
  // SIGUEN prohibidas: el resto de la PII del asignado y todo lo del mensajero que GESTIONO la
  // orden, que es la feature 405. Lo demas de la lista no se toca.
  it("R18 (+404): la respuesta 200 no expone storagePath, bucket, ids internos ni PII fuera del nombre del asignado", async () => {
    const { deps: d } = deps(OK_AUTH, [ORDEN_A]);
    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);
    const texto = JSON.stringify(await res.json());
    for (const prohibida of [
      "storagePath",
      "storage_path",
      "etiquetas-guia",
      "gestion-evidencias",
      "orden-A",
      "tiendaId",
      "usuarioId",
      "store-1",
      // 404/R6: del mensajero asignado SOLO su id y su nombre; nada mas de su ficha.
      "telefonoMensajero",
      "mensajeroTelefono",
      "cedula",
      "vehiculo",
      "placa",
      "zonaMensajero",
      // 404/R7 + 256/R22: el GESTOR y su texto libre no salen por aqui (es la 405).
      "mensajeroId",
      "mensajeroGestion",
      "gestionadaPor",
    ]) {
      expect(texto).not.toContain(prohibida);
    }
    // Y lo que SI sale es exactamente la clave nueva, con la convencion de ausencia de R2.
    expect(JSON.parse(texto).mensajero).toBeNull();
  });

  it("R15/R42: ningun caso responde 409 y todo error usa status/code/message con codigos existentes", async () => {
    const codigosPermitidos = ["VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"];
    const casos: Array<[ApiKeyAuthResult, Fila[], string]> = [
      [{ status: "unauthenticated" }, [ORDEN_A], "100234"],
      [{ status: "forbidden" }, [ORDEN_A], "100234"],
      [OK_AUTH, [ORDEN_A], ""],
      [OK_AUTH, [], "100234"],
      [OK_AUTH, [ORDEN_B, ORDEN_A], "100234"],
      [OK_AUTH, [ORDEN_A], "100234"],
    ];
    for (const [auth, filas, id] of casos) {
      const res = await handleConsultaOrdenApi(req(SECRETO), id, deps(auth, filas).deps);
      expect(res.status).not.toBe(409);
      if (res.status !== 200) {
        const json = await res.json();
        expect(json.status).toBe("error");
        expect(typeof json.message).toBe("string");
        expect(codigosPermitidos).toContain(json.code);
      }
    }
  });
});

// -----------------------------------------------------------------------------------------------
// ⏳ 2026-09-09 — Feature 404 (T6): `mensajero` en el borde HTTP del DETALLE, de punta a punta.
// -----------------------------------------------------------------------------------------------

const MENSAJERO_ID = "018f2c31-0000-4000-8000-0000000000aa";
const MENSAJERO_ROW = {
  id: MENSAJERO_ID,
  nombre: "Carlos",
  primerApellido: "Jimenez",
  segundoApellido: "Mora",
};

const signedUrlsNoOp: ISignedUrlProvider = {
  createSignedUrl: vi.fn(async () => "https://signed/one"),
  createSignedUrls: vi.fn(async () => ({})),
};

/** Fila de `orden` como la devuelve Prisma para `API_ORDEN_DETALLE_SELECT`, con su owner. */
function filaDetalle(over: Record<string, unknown> = {}) {
  return {
    tiendaId: ACTOR.usuarioId,
    numGuia: 100234,
    numRemision: "REM-A",
    destinatario: "Ana",
    telefonoDest: "0999999999",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: new Prisma.Decimal(1500),
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    estatus: { value: "en_reparto" },
    // ⏳ 2026-09-10 (feature 415): lo que el `select` del canal anade a la fila cruda.
    ...FILA_PRISMA_415,
    gestiones: [],
    // ⏳ 2026-09-10 (feature 405): la relacion del historial que el `select` del detalle pide para
    // resolver `estadoResultante`.
    historialEstados: [],
    incidentesAdmin: [],
    mensajeroAsignado: MENSAJERO_ROW,
    ...over,
  };
}

/**
 * Deps con el handler real por encima de la cadena real. El Prisma falso APLICA el `where` del
 * repositorio, asi que el aislamiento por owner se mide de verdad y no se supone.
 */
function depsRealesDetalle(fila: Record<string, unknown> | null) {
  const prisma = {
    orden: {
      findFirst: vi.fn(async (arg: { where: Record<string, unknown> }) =>
        fila !== null && fila.tiendaId === arg.where.tiendaId ? fila : null,
      ),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    usuario: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  };
  const repo = new OrdenRepository(prisma as unknown as PrismaClient);
  const svc = new ApiOrdenLecturaService(repo, signedUrlsNoOp, fakeTarifas() as never);
  const d: ConsultaOrdenApiDeps = {
    autenticar: vi.fn(async () => OK_AUTH),
    resolucionService: new ApiOrdenResolucionService(repoCon([ORDEN_A])),
    detallePorOrdenId: (actor: Actor, ordenId: string) => svc.detallePorOrdenId(actor, ordenId),
  };
  return { deps: d, prisma };
}

describe("GET /api/ordenes/api-key/orden/{id} — `mensajero` de punta a punta (feature 404)", () => {
  it("404/R18: el detalle trae `mensajero` con `{id, nombre}` y conserva `evidencias`", async () => {
    const { deps: d } = depsRealesDetalle(filaDetalle());
    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);

    expect(res.status).toBe(200);
    const json = await res.json();
    // Literal a mano: el nombre completo compuesto de las tres columnas.
    expect(json.mensajero).toEqual({ id: MENSAJERO_ID, nombre: "Carlos Jimenez Mora" });
    expect(json.evidencias).toEqual([]); // R19: el array sigue ahi, vacio
  });

  it("404/R2+R23: sin asignado el detalle responde `mensajero: null`, con la clave presente", async () => {
    const { deps: d } = depsRealesDetalle(filaDetalle({ mensajeroAsignado: null }));
    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);

    const cuerpo = await res.text();
    expect(cuerpo).toContain('"mensajero":null');
    expect(JSON.parse(cuerpo).mensajero).toBeNull();
  });

  it("404/R16+R19 (+405/R1): el detalle son los nueve publicados + `mensajero` + los DOS arrays, y nada mas", async () => {
    const { deps: d } = depsRealesDetalle(filaDetalle());
    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);

    const json = await res.json();
    // ⏳ 2026-09-10 (feature 405/R1) — ONCE claves pasan a ser DOCE: `gestiones` es el array nuevo
    // del detalle. Igualdad exacta, como estaba: una clave de mas sigue siendo un fallo.
    expect(Object.keys(json).sort()).toEqual([
      // ⏳ 2026-09-10 (feature 415, R34) — DOCE claves pasan a QUINCE: `zona`, `costoEstimado` y
      // `costoReal` son los tres campos ADITIVOS de la 415, que el detalle HEREDA del item por el
      // `...toListItemDTO(row)`. El literal se ENMIENDA y sigue siendo una igualdad exacta: una
      // clave de mas la pone roja igual que antes. Las doce anteriores conservan su nombre.
      "costoEstimado",
      "costoReal",
      "createdAt",
      "destinatario",
      "direccion",
      "estado",
      "evidencias",
      "gestiones",
      "mensajero",
      "montoCobrar",
      "numGuia",
      "numRemision",
      "producto",
      "telefonoDest",
      "zona",
    ]);
  });

  it("404/R20: una orden de OTRO owner sigue dando 404, y su mensajero no se filtra", async () => {
    const { deps: d } = depsRealesDetalle(
      filaDetalle({
        tiendaId: "store-AJENA",
        mensajeroAsignado: {
          id: "018f2c31-0000-4000-8000-0000000000cc",
          nombre: "Pedro",
          primerApellido: "Ajeno",
          segundoApellido: null,
        },
      }),
    );
    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);

    expect(res.status).toBe(404);
    const cuerpo = await res.text();
    expect(cuerpo).not.toContain("Pedro");
    expect(cuerpo).not.toContain("018f2c31-0000-4000-8000-0000000000cc");
    expect(cuerpo).not.toContain("mensajero");
  });

  it("404/R21+R22: la respuesta no lleva storagePath, bucket, tiendaId ni el texto libre de la gestion", async () => {
    const { deps: d } = depsRealesDetalle(filaDetalle());
    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);

    const cuerpo = await res.text();
    expect(cuerpo).not.toMatch(/storagePath|storage_path|bucket/i);
    expect(cuerpo).not.toContain("tiendaId");
    expect(cuerpo).not.toContain("store-1");
    expect(cuerpo).not.toMatch(/mensajeroId|mensajeroGestion|gestionadaPor/);
  });
});

// -----------------------------------------------------------------------------------------------
// ⏳ 2026-09-10 — Feature 405 (T10): `gestiones[]` en el BORDE HTTP del detalle. Cubre R1 y R17.
//
// Sobre la CADENA REAL (`handler -> ApiOrdenLecturaService -> OrdenRepository -> Prisma`), no
// sobre el `detalleDe` falso de arriba: con el doble, estos casos pasarian aunque el repositorio
// no proyectara nada. Lo que NO se mide aqui es el `where` ni el `orderBy` —eso es SQL y vive en
// `tests/integration/db/gestiones-detalle-api-405.test.ts`—.
// -----------------------------------------------------------------------------------------------

/** Una fila CRUDA de `gestion_orden` con las claves que pide el `select` del detalle. */
function gestionCruda(over: Record<string, unknown> = {}) {
  return {
    id: "g-1",
    resultado: "devuelta",
    evidenciaStoragePath: null,
    evidenciaContentType: null,
    createdAt: new Date("2026-09-04T18:02:55.000Z"),
    anuladaAt: null,
    causaDevolucion: "wrong_address",
    causaIncidente: null,
    mensajero: {
      id: "018f2c31-0000-4000-8000-0000000000bb",
      nombre: "Ana",
      primerApellido: "Solis",
      segundoApellido: "Vargas",
    },
    ...over,
  };
}

describe("GET /api/ordenes/api-key/orden/{id} — `gestiones` de punta a punta (feature 405)", () => {
  it("405/R1: el detalle incluye la clave `gestiones` con sus cinco campos publicos", async () => {
    const { deps: d } = depsRealesDetalle(
      filaDetalle({
        gestiones: [gestionCruda()],
        historialEstados: [
          {
            id: "h-1",
            gestionOrdenId: "g-1",
            createdAt: new Date("2026-09-04T18:02:55.000Z"),
            estatusDestino: { value: "devolucion_por_confirmar" },
          },
        ],
      }),
    );

    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);

    expect(res.status).toBe(200);
    const json = await res.json();
    // Literales a mano: el nombre completo compuesto de las tres columnas, la causa tipificada y
    // el estado destino de la transicion sembrada.
    expect(json.gestiones).toEqual([
      {
        createdAt: "2026-09-04T18:02:55.000Z",
        resultado: "devuelta",
        estadoResultante: "devolucion_por_confirmar",
        motivo: "wrong_address",
        mensajero: {
          id: "018f2c31-0000-4000-8000-0000000000bb",
          nombre: "Ana Solis Vargas",
        },
      },
    ]);
  });

  it("405/R2: una orden sin gestiones responde `gestiones: []`, con la clave presente", async () => {
    const { deps: d } = depsRealesDetalle(filaDetalle());

    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);

    const cuerpo = await res.text();
    expect(cuerpo).toContain('"gestiones":[]');
    expect(JSON.parse(cuerpo).gestiones).toEqual([]);
  });

  it("405/R12: el texto libre de la gestion no cruza el borde ni aunque la fila lo trajera", async () => {
    const { deps: d } = depsRealesDetalle(
      filaDetalle({
        gestiones: [
          {
            ...gestionCruda(),
            // La columna existe en la tabla; si el `select` la pidiera, Prisma la devolveria y
            // este es el aspecto que tendria la fila. El repositorio NO debe emitirla.
            motivo: "FUGA-TEXTO-LIBRE-el-cliente-no-contesto",
          },
        ],
      }),
    );

    const res = await handleConsultaOrdenApi(req(SECRETO), "100234", d);

    const cuerpo = await res.text();
    expect(cuerpo).not.toContain("FUGA-TEXTO-LIBRE");
    expect(cuerpo).not.toContain("g-1"); // ni el id interno de la gestion
  });

  it("405/R17: los codigos de estado del endpoint no cambian con la clave nueva", async () => {
    // R17 en el mismo sitio donde vive el borde: la ficha 405 no toca el handler, y esto lo
    // demuestra ejercitando los cuatro caminos de error con la cadena de siempre.
    const casos: Array<[ApiKeyAuthResult, Fila[], string, number]> = [
      [{ status: "unauthenticated" }, [ORDEN_A], "100234", 401],
      [{ status: "forbidden" }, [ORDEN_A], "100234", 403],
      [OK_AUTH, [ORDEN_A], "", 422],
      [OK_AUTH, [], "100234", 404],
    ];
    for (const [auth, filas, id, esperado] of casos) {
      const res = await handleConsultaOrdenApi(req(SECRETO), id, deps(auth, filas).deps);
      expect(res.status, `caso ${esperado}`).toBe(esperado);
      const cuerpo = await res.text();
      // Y ninguna respuesta de error menciona la clave nueva.
      expect(cuerpo).not.toContain("gestiones");
    }
  });
});
