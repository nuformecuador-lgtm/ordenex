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

  it("R18: la respuesta 200 no expone storagePath, bucket, ids internos ni PII de mensajero", async () => {
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
      "mensajero",
    ]) {
      expect(texto).not.toContain(prohibida);
    }
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
