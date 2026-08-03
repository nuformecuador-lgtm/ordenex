// Feature 177 — T14: tests de INTEGRACION del handler
// `POST /api/ordenes/api-key/orden/{id}/generate`. Sin DB y sin Storage: se inyectan por `deps`
// el autenticador, el service de resolucion (REAL, sobre un repo fake) y el service de PDF
// (REAL, sobre repo/generador/firmador fakes), de modo que el reuso (`generado: false`) y la
// precedencia de R14 se comprueban extremo a extremo y no contra un doble complaciente.
import { describe, it, expect, vi } from "vitest";
import * as generateRoute from "@/app/api/ordenes/api-key/orden/[id]/generate/route";
import { handleGenerarPdfOrdenApi } from "@/app/api/ordenes/api-key/orden/[id]/generate/route";
import { ApiOrdenResolucionService } from "@/lib/services/ApiOrdenResolucionService";
import { ApiPdfEtiquetaService } from "@/lib/services/ApiPdfEtiquetaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { ApiOrdenDetalleRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IApiPdfEtiquetaService } from "@/lib/interfaces/services/IApiPdfEtiquetaService";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const OK_AUTH: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };
const SECRETO = "ordx_secretovivo1234567890";
const TTL = 300;

type Fila = { id: string; numGuia: number | null; numRemision: string };

/** Orden A: casa por GUIA. Orden B: casa por REMISION con el MISMO identificador (R14). */
const ORDEN_A: Fila = { id: "orden-A", numGuia: 100234, numRemision: "REM-A" };
const ORDEN_B: Fila = { id: "orden-B", numGuia: 999001, numRemision: "100234" };

function detalleRow(fila: Fila): ApiOrdenDetalleRow {
  return {
    numGuia: fila.numGuia,
    numRemision: fila.numRemision,
    estatusValue: "en_reparto",
    destinatario: "Ana",
    telefonoDest: "0999999999",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: 1500,
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    evidencias: [],
  };
}

/**
 * Escenario completo del borde: filas visibles para el owner (resolucion), estado de la
 * columna `download_storage_path` en memoria y un firmador que devuelve una URL DISTINTA en
 * cada llamada (asi el test puede ver que la segunda respuesta se re-firmo, R22/R23).
 */
function escenario(opts: {
  auth?: ApiKeyAuthResult;
  filas?: Fila[];
  /** `false` = la orden no tiene etiqueta imprimible (generador devuelve []) -> 409 (R25). */
  imprimible?: boolean;
}) {
  const filas = opts.filas ?? [ORDEN_A];
  const paths = new Map<string, string>();
  let firmas = 0;
  let subidas = 0;

  const resolucionRepo = {
    findByGuiaORemisionForOwner: vi.fn(
      async (ident: { numGuia: number | null; numRemision: string }, ownerId: string) => {
        expect(ownerId).toBe(ACTOR.usuarioId); // R4/R7
        return filas.filter(
          (f) =>
            (ident.numGuia !== null && f.numGuia === ident.numGuia) ||
            f.numRemision === ident.numRemision,
        );
      },
    ),
  };

  const pdfRepo = {
    findDownloadStoragePathByOrdenForOwner: vi.fn(async (ordenId: string, ownerId: string) => {
      expect(ownerId).toBe(ACTOR.usuarioId);
      return paths.get(ordenId) ?? null;
    }),
    findDetalleByOrdenIdForOwner: vi.fn(async (ordenId: string, ownerId: string) => {
      expect(ownerId).toBe(ACTOR.usuarioId);
      const fila = filas.find((f) => f.id === ordenId);
      return fila ? detalleRow(fila) : null;
    }),
    setOrdenDownloadStoragePath: vi.fn(async (ordenId: string, path: string) => {
      paths.set(ordenId, path);
    }),
    findCargaConOrdenesForOwner: vi.fn(async () => null),
    setCargaDownloadStoragePath: vi.fn(async () => {}),
  };

  const lotePdf = {
    generarYAlmacenar: vi.fn(async () => null),
    generarYAlmacenarPorOrden: vi.fn(async (ordenIds: string[]) => {
      if (opts.imprimible === false) return []; // sin `num_guia`: nada imprimible (R25)
      subidas += 1;
      return ordenIds.map((ordenId) => ({
        ordenId,
        path: `store-1/${ordenId}.pdf`,
        signedUrl: "no-usar",
        expiraEnSegundos: TTL,
      }));
    }),
  };

  const signedUrls = {
    createSignedUrl: vi.fn(async (path: string, ttl: number) => {
      expect(ttl).toBe(TTL); // R24
      firmas += 1;
      return `https://proyecto.supabase.co/sign/${path}?firma=${firmas}`;
    }),
    createSignedUrls: vi.fn(async () => ({})),
  };

  const real = new ApiPdfEtiquetaService(pdfRepo, lotePdf, signedUrls, TTL);
  const porOrden = vi.fn((actor: Actor, ordenId: string) => real.porOrden(actor, ordenId));
  const pdfService: IApiPdfEtiquetaService = { porOrden, porCarga: vi.fn() };

  return {
    deps: {
      autenticar: vi.fn(async () => opts.auth ?? OK_AUTH),
      resolucionService: new ApiOrdenResolucionService(resolucionRepo),
      pdfService,
    },
    resolucionRepo,
    pdfRepo,
    lotePdf,
    signedUrls,
    porOrden,
    subidas: () => subidas,
  };
}

function req(bearer?: string, esquema = "Bearer"): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers.Authorization = `${esquema} ${bearer}`;
  return new Request("http://localhost/api/ordenes/api-key/orden/100234/generate", {
    method: "POST",
    headers,
  });
}

describe("POST /api/ordenes/api-key/orden/{id}/generate — PDF (R20/R21/R22/R27)", () => {
  it("R20/R21/R22/R27: 200 generado:true la primera vez y generado:false la segunda, con URL distinta", async () => {
    const e = escenario({});
    const primera = await handleGenerarPdfOrdenApi(req(SECRETO), "100234", e.deps);
    expect(primera.status).toBe(200);
    const j1 = await primera.json();
    expect(j1).toMatchObject({ generado: true, expiraEnSegundos: TTL });
    expect(typeof j1.url).toBe("string");

    const segunda = await handleGenerarPdfOrdenApi(req(SECRETO), "100234", e.deps);
    expect(segunda.status).toBe(200);
    const j2 = await segunda.json();
    expect(j2).toMatchObject({ generado: false, expiraEnSegundos: TTL });
    // R22/R23: la URL se re-firma en ESTA llamada, no se devuelve la anterior.
    expect(j2.url).not.toBe(j1.url);
    // R27: un unico objeto en Storage tras dos llamadas.
    expect(e.subidas()).toBe(1);
    expect(e.lotePdf.generarYAlmacenarPorOrden).toHaveBeenCalledTimes(1);
    expect(e.pdfRepo.setOrdenDownloadStoragePath).toHaveBeenCalledTimes(1);
  });

  it("R19/R12: 404 con orden ajena (el repo owner-forzado no la ve)", async () => {
    const e = escenario({ filas: [] });
    const res = await handleGenerarPdfOrdenApi(req(SECRETO), "100234", e.deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ status: "error", code: "NOT_FOUND" });
    expect(e.porOrden).toHaveBeenCalledTimes(0);
    expect(e.lotePdf.generarYAlmacenarPorOrden).toHaveBeenCalledTimes(0);
  });

  it("R25: 409 CONFLICT cuando la orden no tiene guia; no sube ni persiste", async () => {
    const e = escenario({ imprimible: false });
    const res = await handleGenerarPdfOrdenApi(req(SECRETO), "100234", e.deps);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ status: "error", code: "CONFLICT" });
    expect(e.subidas()).toBe(0);
    expect(e.pdfRepo.setOrdenDownloadStoragePath).toHaveBeenCalledTimes(0);
  });

  it("R14 (DISCRIMINANTE): con la guia de A y la remision de B se genera el PDF de A", async () => {
    const e = escenario({ filas: [ORDEN_B, ORDEN_A] });
    const res = await handleGenerarPdfOrdenApi(req(SECRETO), "100234", e.deps);
    expect(res.status).toBe(200);
    // El argumento capturado es el testigo de CUAL orden se genero.
    expect(e.porOrden).toHaveBeenCalledWith(ACTOR, "orden-A");
    expect(e.porOrden).not.toHaveBeenCalledWith(ACTOR, "orden-B");
    expect(e.lotePdf.generarYAlmacenarPorOrden).toHaveBeenCalledWith(["orden-A"], ACTOR);
  });
});

describe("POST /api/ordenes/api-key/orden/{id}/generate — auth y validacion (R1/R2/R3/R19/R42)", () => {
  it("R1: sin Bearer, con esquema distinto o con token vacio -> 401 sin tocar DB ni Storage", async () => {
    for (const peticion of [req(), req("", "Bearer"), req(SECRETO, "Basic")]) {
      const e = escenario({ auth: { status: "unauthenticated" } });
      const res = await handleGenerarPdfOrdenApi(peticion, "100234", e.deps);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ status: "error", code: "UNAUTHORIZED" });
      expect(e.resolucionRepo.findByGuiaORemisionForOwner).toHaveBeenCalledTimes(0);
      expect(e.porOrden).toHaveBeenCalledTimes(0);
    }
  });

  it("R3: usuario o key no activos -> 403 sin leer ordenes ni tocar Storage", async () => {
    const e = escenario({ auth: { status: "forbidden" } });
    const res = await handleGenerarPdfOrdenApi(req(SECRETO), "100234", e.deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(e.resolucionRepo.findByGuiaORemisionForOwner).toHaveBeenCalledTimes(0);
    expect(e.porOrden).toHaveBeenCalledTimes(0);
  });

  it.each([
    ["vacio", ""],
    ["solo espacios", "   "],
    ["mas de 128 chars", "R".repeat(129)],
  ])("R19/R13: 422 con {id} %s, sin tocar la DB ni Storage", async (_caso, valor) => {
    const e = escenario({});
    const res = await handleGenerarPdfOrdenApi(req(SECRETO), valor, e.deps);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toMatchObject({ status: "error", code: "VALIDATION_ERROR" });
    expect(json.details.fieldErrors.id).toBeDefined();
    expect(e.resolucionRepo.findByGuiaORemisionForOwner).toHaveBeenCalledTimes(0);
    expect(e.porOrden).toHaveBeenCalledTimes(0);
  });
});

describe("POST /api/ordenes/api-key/orden/{id}/generate — verbo (R44)", () => {
  it("R44: el modulo de ruta no exporta GET; POST es el UNICO verbo HTTP exportado", async () => {
    expect(typeof (generateRoute as Record<string, unknown>).GET).toBe("undefined");
    const verbos = ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "POST"];
    const exportados = verbos.filter(
      (v) => typeof (generateRoute as Record<string, unknown>)[v] === "function",
    );
    expect(exportados).toEqual(["POST"]);
  });
});
