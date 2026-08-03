import { describe, it, expect, vi } from "vitest";

import { ApiPdfEtiquetaService } from "@/lib/services/ApiPdfEtiquetaService";
import {
  EtiquetasLotePdfService,
  EtiquetasLoteExcedeTopeError,
} from "@/lib/services/EtiquetasLotePdfService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiOrdenDetalleRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IEtiquetaGuiaService } from "@/lib/interfaces/services/IEtiquetaGuiaService";
import type { IFileStorage, UploadInput } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  EtiquetaOrdenPdfResultado,
  EtiquetasLotePdfResultado,
  IEtiquetasLotePdfService,
} from "@/lib/interfaces/services/IEtiquetasLotePdfService";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

// Feature 177 — T11/T12. Tests del service de PDF de etiquetas del canal integrador, SOLO con
// dobles (ni DB ni Storage reales). Cubren R4, R7, R12, R20-R25, R29-R31, R33, R34, R37, R38.

const ACTOR: Actor = { usuarioId: "tienda-77", rol: "apiKey" };
const OTRA_TIENDA: Actor = { usuarioId: "tienda-99", rol: "apiKey" };
const TTL = 300; // etiquetasConfig.API_SIGNED_URL_TTL_SECONDS (R24)

const ORDEN_ID = "ord-1";
const CARGA_ID = "car-1";
const PATH_PERSISTIDO = "tienda-77/ya-existente.pdf";
const PATH_GENERADO = "tienda-77/recien-generado.pdf";

/**
 * URL reconocible que imita el valor caducado que las features 136/141 dejaron en
 * `download_url`. Ningun resultado del service puede contenerla (R23/R37/R38).
 */
const CADUCADA = "https://caducada.invalid/heredada.pdf";

// --- Dobles -----------------------------------------------------------------------------

/** Fila del detalle + la `download_url` heredada, para poder afirmar que NUNCA se usa. */
type FilaOrdenFake = ApiOrdenDetalleRow & { downloadUrl: string | null };

function filaOrden(downloadUrl: string | null): FilaOrdenFake {
  return {
    numGuia: 100234,
    numRemision: "REM-0001",
    estatusValue: "en_reparto",
    destinatario: "Ana",
    telefonoDest: "099",
    producto: "Prod",
    direccion: "Calle 1",
    montoCobrar: 10,
    createdAt: new Date("2026-07-22T14:03:11.000Z"),
    evidencias: [],
    downloadUrl,
  };
}

type CargaFake = {
  downloadStoragePath: string | null;
  ordenIds: string[];
  /** Espejo de `carga.download_url` (heredada): el service no debe mirarla jamas. */
  downloadUrl: string | null;
};

function fakeRepo(cfg: {
  ordenPath?: string | null;
  ordenFila?: FilaOrdenFake | null;
  carga?: CargaFake | null;
}) {
  return {
    findDownloadStoragePathByOrdenForOwner: vi.fn(
      async (_ordenId: string, _ownerId: string) => cfg.ordenPath ?? null,
    ),
    findDetalleByOrdenIdForOwner: vi.fn(
      async (_ordenId: string, _ownerId: string) => cfg.ordenFila ?? null,
    ),
    setOrdenDownloadStoragePath: vi.fn(async (_ordenId: string, _path: string) => {}),
    findCargaConOrdenesForOwner: vi.fn(
      async (_cargaId: string, _ownerId: string) => cfg.carga ?? null,
    ),
    setCargaDownloadStoragePath: vi.fn(async (_cargaId: string, _path: string) => {}),
  };
}

function fakeLotePdf(cfg: {
  porOrden?: EtiquetaOrdenPdfResultado[] | Error;
  consolidado?: EtiquetasLotePdfResultado | null | Error;
}): IEtiquetasLotePdfService {
  return {
    generarYAlmacenarPorOrden: vi.fn(async (_ordenIds: string[], _actor: Actor) => {
      if (cfg.porOrden instanceof Error) throw cfg.porOrden;
      return cfg.porOrden ?? [];
    }),
    generarYAlmacenar: vi.fn(async (_ordenIds: string[], _actor: Actor) => {
      if (cfg.consolidado instanceof Error) throw cfg.consolidado;
      return cfg.consolidado ?? null;
    }),
  };
}

function fakeSignedUrls(): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async (path: string, ttl: number) => `https://signed.test/${path}#${ttl}`),
    createSignedUrls: vi.fn(async () => ({})),
  };
}

function resultadoPorOrden(ordenId: string, path: string): EtiquetaOrdenPdfResultado {
  // `signedUrl` deliberadamente caducable: el service debe re-firmar, no reenviar esto.
  return { ordenId, path, signedUrl: CADUCADA, expiraEnSegundos: 60 };
}

function etiquetaDTO(numGuia: number): EtiquetaGuiaDTO {
  return {
    ordenId: `ord-${numGuia}`,
    numGuia,
    numRemision: `REM-${numGuia}`,
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "Calle 1",
    producto: "Prod",
    montoCobrar: 10,
    tiendaNombre: "Tienda",
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: "D",
    qrValue: String(numGuia),
    barcodeValue: String(numGuia),
  };
}

// --- T11: reuso / generacion / sin_etiqueta / excede_tope --------------------------------

describe("ApiPdfEtiquetaService.porOrden", () => {
  it("reusa el PDF persistido: no genera ni sube y firma exactamente el path guardado con TTL 300 (R21/R22/R24/R37)", async () => {
    const repo = fakeRepo({ ordenPath: PATH_PERSISTIDO, ordenFila: filaOrden(CADUCADA) });
    const lotePdf = fakeLotePdf({});
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porOrden(ACTOR, ORDEN_ID);

    expect(res).toEqual({
      status: "ok",
      url: `https://signed.test/${PATH_PERSISTIDO}#${TTL}`,
      expiraEnSegundos: TTL,
      generado: false,
    });
    expect(lotePdf.generarYAlmacenarPorOrden).toHaveBeenCalledTimes(0);
    expect(lotePdf.generarYAlmacenar).toHaveBeenCalledTimes(0);
    expect(repo.setOrdenDownloadStoragePath).toHaveBeenCalledTimes(0);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledWith(PATH_PERSISTIDO, 300);
  });

  it("genera, sube y persiste el path DEVUELTO por el generador (R20/R22)", async () => {
    const repo = fakeRepo({ ordenPath: null, ordenFila: filaOrden(null) });
    const lotePdf = fakeLotePdf({ porOrden: [resultadoPorOrden(ORDEN_ID, PATH_GENERADO)] });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porOrden(ACTOR, ORDEN_ID);

    expect(lotePdf.generarYAlmacenarPorOrden).toHaveBeenCalledTimes(1);
    expect(lotePdf.generarYAlmacenarPorOrden).toHaveBeenCalledWith([ORDEN_ID], ACTOR);
    expect(repo.setOrdenDownloadStoragePath).toHaveBeenCalledTimes(1);
    expect(repo.setOrdenDownloadStoragePath).toHaveBeenCalledWith(ORDEN_ID, PATH_GENERADO);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledWith(PATH_GENERADO, 300);
    expect(res).toEqual({
      status: "ok",
      url: `https://signed.test/${PATH_GENERADO}#${TTL}`,
      expiraEnSegundos: TTL,
      generado: true,
    });
  });

  it("sin etiqueta imprimible: devuelve sin_etiqueta y no sube ni persiste (R25)", async () => {
    const repo = fakeRepo({ ordenPath: null, ordenFila: filaOrden(null) });
    const lotePdf = fakeLotePdf({ porOrden: [] });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porOrden(ACTOR, ORDEN_ID);

    expect(res).toEqual({ status: "sin_etiqueta" });
    expect(repo.setOrdenDownloadStoragePath).toHaveBeenCalledTimes(0);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledTimes(0);
  });

  it("excede el tope: devuelve excede_tope y no persiste ni firma nada (R34)", async () => {
    const repo = fakeRepo({ ordenPath: null, ordenFila: filaOrden(null) });
    const lotePdf = fakeLotePdf({ porOrden: new EtiquetasLoteExcedeTopeError(9, 3) });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porOrden(ACTOR, ORDEN_ID);

    expect(res).toEqual({ status: "excede_tope" });
    expect(repo.setOrdenDownloadStoragePath).toHaveBeenCalledTimes(0);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledTimes(0);
  });

  it("la URL devuelta sale SIEMPRE de createSignedUrl y nunca de una download_url persistida (R23)", async () => {
    const repo = fakeRepo({ ordenPath: null, ordenFila: filaOrden(CADUCADA) });
    const lotePdf = fakeLotePdf({ porOrden: [resultadoPorOrden(ORDEN_ID, PATH_GENERADO)] });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porOrden(ACTOR, ORDEN_ID);

    expect(res.status).toBe("ok");
    expect(JSON.stringify(res)).not.toContain("caducada.invalid");
    if (res.status !== "ok") throw new Error("inesperado");
    expect(res.url).toBe(`https://signed.test/${PATH_GENERADO}#${TTL}`);
  });

  it("decide el reuso por downloadStoragePath y nunca por download_url: la fila heredada regenera (R37/R38)", async () => {
    // Fila de la 136/141: `download_url` poblada y `download_storage_path` NULL.
    const repo = fakeRepo({ ordenPath: null, ordenFila: filaOrden(CADUCADA) });
    const lotePdf = fakeLotePdf({ porOrden: [resultadoPorOrden(ORDEN_ID, PATH_GENERADO)] });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porOrden(ACTOR, ORDEN_ID);

    expect(res).toEqual({
      status: "ok",
      url: `https://signed.test/${PATH_GENERADO}#${TTL}`,
      expiraEnSegundos: TTL,
      generado: true,
    });
    expect(lotePdf.generarYAlmacenarPorOrden).toHaveBeenCalledTimes(1);
    expect(repo.setOrdenDownloadStoragePath).toHaveBeenCalledWith(ORDEN_ID, PATH_GENERADO);
  });
});

describe("ApiPdfEtiquetaService.porCarga", () => {
  const carga = (over: Partial<CargaFake> = {}): CargaFake => ({
    downloadStoragePath: null,
    ordenIds: ["ord-1", "ord-2"],
    downloadUrl: null,
    ...over,
  });

  it("reusa el consolidado persistido: no genera y solo re-firma el path guardado con TTL 300 (R31/R22/R24)", async () => {
    const repo = fakeRepo({
      carga: carga({ downloadStoragePath: PATH_PERSISTIDO, downloadUrl: CADUCADA }),
    });
    const lotePdf = fakeLotePdf({});
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porCarga(ACTOR, CARGA_ID);

    expect(res).toEqual({
      status: "ok",
      url: `https://signed.test/${PATH_PERSISTIDO}#${TTL}`,
      expiraEnSegundos: TTL,
      generado: false,
    });
    expect(lotePdf.generarYAlmacenar).toHaveBeenCalledTimes(0);
    expect(lotePdf.generarYAlmacenarPorOrden).toHaveBeenCalledTimes(0);
    expect(repo.setCargaDownloadStoragePath).toHaveBeenCalledTimes(0);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledWith(PATH_PERSISTIDO, 300);
  });

  it("genera el consolidado con los ordenIds del repositorio y persiste el path devuelto (R30/R32)", async () => {
    const repo = fakeRepo({ carga: carga() });
    const lotePdf = fakeLotePdf({
      consolidado: { path: PATH_GENERADO, signedUrl: CADUCADA, expiraEnSegundos: 60 },
    });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porCarga(ACTOR, CARGA_ID);

    expect(lotePdf.generarYAlmacenar).toHaveBeenCalledWith(["ord-1", "ord-2"], ACTOR);
    expect(repo.setCargaDownloadStoragePath).toHaveBeenCalledTimes(1);
    expect(repo.setCargaDownloadStoragePath).toHaveBeenCalledWith(CARGA_ID, PATH_GENERADO);
    expect(res).toEqual({
      status: "ok",
      url: `https://signed.test/${PATH_GENERADO}#${TTL}`,
      expiraEnSegundos: TTL,
      generado: true,
    });
  });

  it("lote sin etiquetas imprimibles: devuelve sin_etiqueta y no sube ni persiste (R33)", async () => {
    const repo = fakeRepo({ carga: carga() });
    const lotePdf = fakeLotePdf({ consolidado: null });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porCarga(ACTOR, CARGA_ID);

    expect(res).toEqual({ status: "sin_etiqueta" });
    expect(repo.setCargaDownloadStoragePath).toHaveBeenCalledTimes(0);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledTimes(0);
  });

  it("excede el tope: no construye el PDF, no sube y no persiste (R34)", async () => {
    // Aqui el generador es el REAL de la 136 (con sus propios dobles): asi se afirma que el
    // corte por tope ocurre ANTES de construir nada (spy de `build` en 0).
    const build = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const storage: IFileStorage = {
      upload: vi.fn(async (input: UploadInput) => input.path),
      remove: vi.fn(async () => {}),
    };
    const etiquetaService: IEtiquetaGuiaService = {
      generarEtiquetas: vi.fn(async () => ({
        status: "ok" as const,
        etiquetas: [etiquetaDTO(1), etiquetaDTO(2), etiquetaDTO(3), etiquetaDTO(4)],
        omitidas: [],
      })),
      obtenerEtiquetaPorGuia: vi.fn(),
    };
    const lotePdf = new EtiquetasLotePdfService(
      etiquetaService,
      storage,
      fakeSignedUrls(),
      TTL,
      3, // MAX_ETIQUETAS_POR_PDF
      build,
    );
    const repo = fakeRepo({ carga: carga({ ordenIds: ["o1", "o2", "o3", "o4"] }) });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porCarga(ACTOR, CARGA_ID);

    expect(res).toEqual({ status: "excede_tope" });
    expect(build).toHaveBeenCalledTimes(0);
    expect(storage.upload).toHaveBeenCalledTimes(0);
    expect(repo.setCargaDownloadStoragePath).toHaveBeenCalledTimes(0);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledTimes(0);
  });

  it("la carga heredada (download_url poblada, path NULL) regenera y nunca devuelve la URL heredada (R23/R37/R38)", async () => {
    const repo = fakeRepo({
      carga: carga({ downloadStoragePath: null, downloadUrl: CADUCADA }),
    });
    const lotePdf = fakeLotePdf({
      consolidado: { path: PATH_GENERADO, signedUrl: CADUCADA, expiraEnSegundos: 60 },
    });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porCarga(ACTOR, CARGA_ID);

    expect(JSON.stringify(res)).not.toContain("caducada.invalid");
    expect(res).toEqual({
      status: "ok",
      url: `https://signed.test/${PATH_GENERADO}#${TTL}`,
      expiraEnSegundos: TTL,
      generado: true,
    });
    expect(lotePdf.generarYAlmacenar).toHaveBeenCalledTimes(1);
  });
});

// --- T12: aislamiento por dueño ----------------------------------------------------------

describe("ApiPdfEtiquetaService (aislamiento por dueño)", () => {
  it("porOrden con una orden ajena devuelve not_found y NO invoca al generador ni firma nada (R4/R7/R12)", async () => {
    // El repo, con el owner forzado, no ve la orden ajena: devuelve null por ambos caminos.
    const repo = fakeRepo({ ordenPath: null, ordenFila: null });
    const lotePdf = fakeLotePdf({ porOrden: [resultadoPorOrden(ORDEN_ID, PATH_GENERADO)] });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porOrden(OTRA_TIENDA, "ord-de-otra-tienda");

    expect(res).toEqual({ status: "not_found" });
    expect(lotePdf.generarYAlmacenarPorOrden).toHaveBeenCalledTimes(0);
    expect(lotePdf.generarYAlmacenar).toHaveBeenCalledTimes(0);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledTimes(0);
    expect(repo.setOrdenDownloadStoragePath).toHaveBeenCalledTimes(0);
  });

  it("porCarga con una carga ajena devuelve not_found y NO invoca al generador ni firma nada (R29)", async () => {
    const repo = fakeRepo({ carga: null });
    const lotePdf = fakeLotePdf({
      consolidado: { path: PATH_GENERADO, signedUrl: CADUCADA, expiraEnSegundos: 60 },
    });
    const signedUrls = fakeSignedUrls();
    const svc = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL);

    const res = await svc.porCarga(OTRA_TIENDA, "carga-de-otra-tienda");

    expect(res).toEqual({ status: "not_found" });
    expect(lotePdf.generarYAlmacenar).toHaveBeenCalledTimes(0);
    expect(lotePdf.generarYAlmacenarPorOrden).toHaveBeenCalledTimes(0);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledTimes(0);
    expect(repo.setCargaDownloadStoragePath).toHaveBeenCalledTimes(0);
  });

  it("el ownerId que llega al repositorio es actor.usuarioId, nunca un dato de la peticion (R4/R7)", async () => {
    const repo = fakeRepo({ ordenPath: null, ordenFila: null, carga: null });
    const svc = new ApiPdfEtiquetaService(repo, fakeLotePdf({}), fakeSignedUrls(), TTL);

    await svc.porOrden(ACTOR, ORDEN_ID);
    await svc.porCarga(ACTOR, CARGA_ID);

    expect(repo.findDownloadStoragePathByOrdenForOwner).toHaveBeenCalledWith(
      ORDEN_ID,
      ACTOR.usuarioId,
    );
    expect(repo.findDetalleByOrdenIdForOwner).toHaveBeenCalledWith(ORDEN_ID, ACTOR.usuarioId);
    expect(repo.findCargaConOrdenesForOwner).toHaveBeenCalledWith(CARGA_ID, ACTOR.usuarioId);
  });
});
