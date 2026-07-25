import { describe, it, expect, vi, beforeEach } from "vitest";
import { EtiquetasLotePdfService } from "@/lib/services/EtiquetasLotePdfService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  GenerarEtiquetasServiceResult,
  IEtiquetaGuiaService,
} from "@/lib/interfaces/services/IEtiquetaGuiaService";
import type { IFileStorage, UploadInput } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

const ACTOR: Actor = { usuarioId: "tienda-77", rol: "apiKey" };

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
      buildStub,
    );
    const out = await svc.generarYAlmacenar(["ord-1"], ACTOR);
    expect(out).toBeNull();
    expect(storage.upload).not.toHaveBeenCalled();
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
      buildStub,
    );
    await expect(svc.generarYAlmacenar(["ord-1"], ACTOR)).rejects.toThrow("storage caido");
  });
});
