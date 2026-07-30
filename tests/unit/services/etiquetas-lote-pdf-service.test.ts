import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EtiquetasLotePdfService,
  EtiquetasLoteExcedeTopeError,
} from "@/lib/services/EtiquetasLotePdfService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  GenerarEtiquetasServiceResult,
  IEtiquetaGuiaService,
} from "@/lib/interfaces/services/IEtiquetaGuiaService";
import type { IFileStorage, UploadInput } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

const ACTOR: Actor = { usuarioId: "tienda-77", rol: "apiKey" };
/** Tope de etiquetas por PDF inyectado en los tests (BLOQ-1). */
const MAX_ETIQUETAS = 3;

function etiqueta(numGuia: number): EtiquetaGuiaDTO {
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

function fakeEtiquetaService(result: GenerarEtiquetasServiceResult): IEtiquetaGuiaService {
  return {
    generarEtiquetas: vi.fn().mockResolvedValue(result),
    obtenerEtiquetaPorGuia: vi.fn(),
  };
}

function fakeStorage(overrides: Partial<IFileStorage> = {}): IFileStorage {
  return {
    upload: vi.fn(async (input: UploadInput) => input.path),
    remove: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeSignedUrls(overrides: Partial<ISignedUrlProvider> = {}): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async () => "https://signed.example/pdf?token=abc"),
    createSignedUrls: vi.fn(async () => ({})),
    ...overrides,
  };
}

const buildStub = vi.fn(async () => new Uint8Array([1, 2, 3]));

beforeEach(() => {
  buildStub.mockClear();
});

describe("EtiquetasLotePdfService.generarYAlmacenar", () => {
  it("sube el PDF con contentType application/pdf al bucket (R8)", async () => {
    const storage = fakeStorage();
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas: [etiqueta(1)], omitidas: [] }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );
    await svc.generarYAlmacenar(["ord-1"], ACTOR);
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const input = (storage.upload as ReturnType<typeof vi.fn>).mock.calls[0][0] as UploadInput;
    expect(input.contentType).toBe("application/pdf");
    expect(input.bytes).toBeInstanceOf(Uint8Array);
  });

  it("el path aisla por usuarioId y es unico por lote (R11)", async () => {
    const storage = fakeStorage();
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas: [etiqueta(1)], omitidas: [] }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );
    const uploadMock = storage.upload as ReturnType<typeof vi.fn>;
    const a = await svc.generarYAlmacenar(["ord-1"], ACTOR);
    const b = await svc.generarYAlmacenar(["ord-1"], ACTOR);
    const pathA = (uploadMock.mock.calls[0][0] as UploadInput).path;
    const pathB = (uploadMock.mock.calls[1][0] as UploadInput).path;
    expect(pathA.startsWith(`${ACTOR.usuarioId}/`)).toBe(true);
    expect(pathA.endsWith(".pdf")).toBe(true);
    expect(pathA).not.toBe(pathB); // unico por lote
    expect(a?.path).toBe(pathA);
    expect(b?.path).toBe(pathB);
  });

  it("retorna la signed URL y el TTL (R10)", async () => {
    const signedUrls = fakeSignedUrls({
      createSignedUrl: vi.fn(async () => "https://signed.example/x?token=zzz"),
    });
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas: [etiqueta(1)], omitidas: [] }),
      fakeStorage(),
      signedUrls,
      1800,
      MAX_ETIQUETAS,
      buildStub,
    );
    const out = await svc.generarYAlmacenar(["ord-1"], ACTOR);
    expect(out).not.toBeNull();
    expect(out?.signedUrl).toBe("https://signed.example/x?token=zzz");
    expect(out?.expiraEnSegundos).toBe(1800);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledWith(out?.path, 1800);
  });

  it("retorna null cuando no hay etiquetas imprimibles (R14)", async () => {
    const storage = fakeStorage();
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({
        status: "ok",
        etiquetas: [],
        omitidas: [{ ordenId: "ord-1", motivo: "sin_guia" }],
      }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );
    const out = await svc.generarYAlmacenar(["ord-1"], ACTOR);
    expect(out).toBeNull();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(buildStub).not.toHaveBeenCalled();
  });

  it("retorna null cuando generarEtiquetas responde forbidden (R14)", async () => {
    const storage = fakeStorage();
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "forbidden" }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );
    const out = await svc.generarYAlmacenar(["ord-1"], ACTOR);
    expect(out).toBeNull();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  // R3 (puente end-to-end): el review marco este requisito como PARCIAL porque
  // solo se probaba el builder en aislamiento ("N etiquetas -> N paginas"), no el
  // tramo "N ordenes creadas del lote -> N paginas del PDF que se sube". Aqui se
  // usa el builder REAL: entran 3 ordenIds y se cuenta lo que acaba en Storage.
  it("sube un PDF con una pagina por orden creada del lote (R1/R3)", async () => {
    const storage = fakeStorage();
    const ordenIds = ["ord-1", "ord-2", "ord-3"];
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({
        status: "ok",
        etiquetas: ordenIds.map((_, i) => etiqueta(100 + i)),
        omitidas: [],
      }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      // sin `build`: se usa el default `buildEtiquetasLotePdf`
    );

    await svc.generarYAlmacenar(ordenIds, ACTOR);

    const input = (storage.upload as ReturnType<typeof vi.fn>).mock.calls[0][0] as UploadInput;
    const pdf = Buffer.from(input.bytes).toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect((pdf.match(/\/Type\s*\/Page(?![s])/g) ?? []).length).toBe(ordenIds.length);
  });

  // BLOQ-1: el tope corta ANTES de construir el PDF. Es la defensa en profundidad
  // del invariante "la carga por API nunca se rompe por la generacion del PDF":
  // el borde ya descarta el lote por el numero de ordenes creadas.
  it("no construye ni sube el PDF cuando el lote supera el tope de etiquetas (BLOQ-1)", async () => {
    const storage = fakeStorage();
    const signedUrls = fakeSignedUrls();
    const etiquetas = Array.from({ length: MAX_ETIQUETAS + 1 }, (_, i) => etiqueta(i + 1));
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas, omitidas: [] }),
      storage,
      signedUrls,
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    await expect(svc.generarYAlmacenar(["ord-1"], ACTOR)).rejects.toBeInstanceOf(
      EtiquetasLoteExcedeTopeError,
    );
    // Nada de trabajo pesado ni de I/O: el fallo se decide antes de empezar.
    expect(buildStub).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(signedUrls.createSignedUrl).not.toHaveBeenCalled();
  });

  it("el error del tope solo lleva numeros (sin PII), apto para log (BLOQ-1)", async () => {
    const etiquetas = Array.from({ length: MAX_ETIQUETAS + 2 }, (_, i) => etiqueta(i + 1));
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas, omitidas: [] }),
      fakeStorage(),
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    const err = await svc.generarYAlmacenar(["ord-1"], ACTOR).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EtiquetasLoteExcedeTopeError);
    const message = (err as Error).message;
    expect(message).toContain(String(MAX_ETIQUETAS + 2));
    expect(message).toContain(String(MAX_ETIQUETAS));
    // Ningun dato de la orden (destinatario/telefono/direccion) en el mensaje.
    expect(message).not.toContain("Ana");
    expect(message).not.toContain("Calle 1");
  });

  it("genera el PDF cuando el lote iguala EXACTAMENTE el tope (BLOQ-1, borde)", async () => {
    const storage = fakeStorage();
    const etiquetas = Array.from({ length: MAX_ETIQUETAS }, (_, i) => etiqueta(i + 1));
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas, omitidas: [] }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    const out = await svc.generarYAlmacenar(["ord-1"], ACTOR);
    expect(out).not.toBeNull();
    expect(buildStub).toHaveBeenCalledTimes(1);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it("propaga el error si el upload falla (base best-effort del borde, R12)", async () => {
    const storage = fakeStorage({
      upload: vi.fn(async () => {
        throw new Error("storage caido");
      }),
    });
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas: [etiqueta(1)], omitidas: [] }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );
    await expect(svc.generarYAlmacenar(["ord-1"], ACTOR)).rejects.toThrow("storage caido");
  });
});

// --- Feature 141 (T25): modo `individual` — UN PDF por orden (R48/R49/R50/R52) ---

describe("EtiquetasLotePdfService.generarYAlmacenarPorOrden (feature 141)", () => {
  it("R48: N etiquetas -> N build/upload/firma y N resultados correlacionados por ordenId", async () => {
    const storage = fakeStorage();
    const signedUrls = fakeSignedUrls({
      createSignedUrl: vi.fn(async (path: string) => `https://signed.example/${path}`),
    });
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas: [etiqueta(1), etiqueta(2)], omitidas: [] }),
      storage,
      signedUrls,
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    const out = await svc.generarYAlmacenarPorOrden(["ord-1", "ord-2"], ACTOR);

    expect(out.map((r) => r.ordenId)).toEqual(["ord-1", "ord-2"]);
    expect(buildStub).toHaveBeenCalledTimes(2);
    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(signedUrls.createSignedUrl).toHaveBeenCalledTimes(2);
    // Cada PDF lleva UNA sola etiqueta: la de SU orden.
    const lotesConstruidos = buildStub.mock.calls.map(
      (c) => (c as unknown as [EtiquetaGuiaDTO[]])[0],
    );
    expect(lotesConstruidos.map((dtos) => dtos.length)).toEqual([1, 1]);
    expect(lotesConstruidos.map((dtos) => dtos[0].ordenId)).toEqual(["ord-1", "ord-2"]);
    // Y cada URL corresponde al path subido de esa orden.
    for (const r of out) expect(r.signedUrl).toBe(`https://signed.example/${r.path}`);
  });

  it("los paths se aislan por dueño, son unicos y terminan en .pdf", async () => {
    const storage = fakeStorage();
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas: [etiqueta(1), etiqueta(2)], omitidas: [] }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    const out = await svc.generarYAlmacenarPorOrden(["ord-1", "ord-2"], ACTOR);

    for (const r of out) {
      expect(r.path.startsWith(`${ACTOR.usuarioId}/`)).toBe(true);
      expect(r.path.endsWith(".pdf")).toBe(true);
    }
    expect(out[0].path).not.toBe(out[1].path);
    const uploadMock = storage.upload as ReturnType<typeof vi.fn>;
    for (const call of uploadMock.mock.calls) {
      expect((call[0] as UploadInput).contentType).toBe("application/pdf");
    }
  });

  it("R49: una orden sin etiqueta imprimible NO aparece en el resultado (y no aborta las demas)", async () => {
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({
        status: "ok",
        etiquetas: [etiqueta(1)],
        omitidas: [{ ordenId: "ord-2", motivo: "sin_guia" }],
      }),
      fakeStorage(),
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    const out = await svc.generarYAlmacenarPorOrden(["ord-1", "ord-2"], ACTOR);

    expect(out.map((r) => r.ordenId)).toEqual(["ord-1"]);
    expect(buildStub).toHaveBeenCalledTimes(1);
  });

  it("R50: cero etiquetas imprimibles -> [] sin tocar Storage", async () => {
    const storage = fakeStorage();
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas: [], omitidas: [] }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    expect(await svc.generarYAlmacenarPorOrden(["ord-1"], ACTOR)).toEqual([]);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(buildStub).not.toHaveBeenCalled();
  });

  it("`forbidden` del servicio de etiquetas -> [] sin tocar Storage", async () => {
    const storage = fakeStorage();
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "forbidden" }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    expect(await svc.generarYAlmacenarPorOrden(["ord-1"], ACTOR)).toEqual([]);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("R52: por encima del tope lanza ANTES de construir o subir nada", async () => {
    const storage = fakeStorage();
    const etiquetas = Array.from({ length: MAX_ETIQUETAS + 1 }, (_, i) => etiqueta(i + 1));
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas, omitidas: [] }),
      storage,
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    await expect(
      svc.generarYAlmacenarPorOrden(
        etiquetas.map((e) => e.ordenId),
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(EtiquetasLoteExcedeTopeError);
    expect(buildStub).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("justo EN el tope si genera (borde del limite)", async () => {
    const etiquetas = Array.from({ length: MAX_ETIQUETAS }, (_, i) => etiqueta(i + 1));
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas, omitidas: [] }),
      fakeStorage(),
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    const out = await svc.generarYAlmacenarPorOrden(
      etiquetas.map((e) => e.ordenId),
      ACTOR,
    );

    expect(out).toHaveLength(MAX_ETIQUETAS);
  });

  it("resuelve las etiquetas con UNA sola llamada al servicio (sin N+1)", async () => {
    const etiquetaSvc = fakeEtiquetaService({
      status: "ok",
      etiquetas: [etiqueta(1), etiqueta(2)],
      omitidas: [],
    });
    const svc = new EtiquetasLotePdfService(
      etiquetaSvc,
      fakeStorage(),
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    await svc.generarYAlmacenarPorOrden(["ord-1", "ord-2"], ACTOR);

    expect(etiquetaSvc.generarEtiquetas).toHaveBeenCalledTimes(1);
    expect(etiquetaSvc.generarEtiquetas).toHaveBeenCalledWith(
      { ordenIds: ["ord-1", "ord-2"] },
      ACTOR,
    );
  });

  it("un fallo de Storage se PROPAGA (el best-effort vive en el borde, R51)", async () => {
    const svc = new EtiquetasLotePdfService(
      fakeEtiquetaService({ status: "ok", etiquetas: [etiqueta(1)], omitidas: [] }),
      fakeStorage({
        upload: vi.fn(async () => {
          throw new Error("storage caido");
        }),
      }),
      fakeSignedUrls(),
      3600,
      MAX_ETIQUETAS,
      buildStub,
    );

    await expect(svc.generarYAlmacenarPorOrden(["ord-1"], ACTOR)).rejects.toThrow("storage caido");
  });
});
