// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { comprimirImagen } from "@/lib/utils/comprimir-imagen";

// Feature 316 (A4) — el helper de canvas deja de ser una optimizacion best-effort y pasa a
// decidir si una foto de iPhone se puede ENVIAR por el chat (R29-R32, design §2.1). Hasta esta
// feature no tenia ni un test, asi que aqui se fija SOLO el comportamiento del que la 316
// depende, no una cobertura completa del helper.
//
// Todo lo que jsdom no trae (`createImageBitmap`) o no implementa (`getContext("2d")`, `toBlob`)
// se stubbea: jsdom no rasteriza. Por eso el assert de orientacion (R30) es sobre la LLAMADA a
// `createImageBitmap`, y la comprobacion de que la foto no llega girada se hace a ojo en un
// movil real.

/** `File` con `bytes` bytes reales: `size` sale del contenido, no de un `defineProperty`. */
function archivo(nombre: string, tipo: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], nombre, { type: tipo });
}

const createImageBitmapMock = vi.fn();
let blobDevuelto: Blob | null = null;

// jsdom no rasteriza: `getContext("2d")` devuelve `null` y `toBlob` lanza "not implemented". Se
// sustituyen en el prototipo y se restauran en `afterEach`. El `unknown` intermedio es para
// poder asignar un doble parcial donde el DOM declara la firma completa del contexto 2d.
const proto = HTMLCanvasElement.prototype as unknown as {
  getContext: unknown;
  toBlob: unknown;
};
const getContextOriginal = proto.getContext;
const toBlobOriginal = proto.toBlob;

beforeEach(() => {
  createImageBitmapMock.mockReset();
  createImageBitmapMock.mockResolvedValue({
    width: 4000,
    height: 3000,
    close: vi.fn(),
  });
  vi.stubGlobal("createImageBitmap", createImageBitmapMock);

  // El contexto 2d solo tiene que existir y aceptar `drawImage`: no se pinta nada de verdad.
  proto.getContext = vi.fn(() => ({ drawImage: vi.fn() }));
  proto.toBlob = vi.fn((cb: (b: Blob | null) => void) => {
    cb(blobDevuelto);
  });
  blobDevuelto = new Blob([new Uint8Array(50 * 1024)], { type: "image/jpeg" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  proto.getContext = getContextOriginal;
  proto.toBlob = toBlobOriginal;
});

describe("comprimirImagen — conversion de formato para el chat saliente (R29-R32)", () => {
  it("R29: convierte a JPEG un HEIC de 3 MB y le cambia la extension a .jpg", async () => {
    const original = archivo("IMG_0042.heic", "image/heic", 3 * 1024 * 1024);

    const resultado = await comprimirImagen(original, {
      saltarSiMenorA: 0,
      devolverOriginalSiMayor: false,
    });

    expect(resultado.type).toBe("image/jpeg");
    expect(resultado.name.endsWith(".jpg")).toBe(true);
    expect(resultado).not.toBe(original);
  });

  it("R29: con `saltarSiMenorA: 0` un HEIC de 200 KB TAMBIEN se convierte", async () => {
    const original = archivo("IMG_0043.heic", "image/heic", 200 * 1024);

    const resultado = await comprimirImagen(original, {
      saltarSiMenorA: 0,
      devolverOriginalSiMayor: false,
    });

    expect(resultado.type).toBe("image/jpeg");
  });

  it("R29: SIN `saltarSiMenorA: 0` ese mismo HEIC de 200 KB sale sin convertir (por eso la opcion es obligatoria aqui)", async () => {
    const original = archivo("IMG_0043.heic", "image/heic", 200 * 1024);

    const resultado = await comprimirImagen(original);

    // El atajo por tamaño (default 1 MB) es CORRECTO para comprimir y es un BUG para convertir:
    // este HEIC llegaria intacto a la lista blanca de Meta y se rechazaria una foto valida.
    expect(resultado).toBe(original);
    expect(resultado.type).toBe("image/heic");
    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });

  it("puerta 3 / R32: con el JPEG resultante MAS GRANDE, `devolverOriginalSiMayor: false` se queda con el JPEG", async () => {
    const original = archivo("IMG_0044.heic", "image/heic", 200 * 1024);
    blobDevuelto = new Blob([new Uint8Array(400 * 1024)], { type: "image/jpeg" });

    const resultado = await comprimirImagen(original, {
      saltarSiMenorA: 0,
      devolverOriginalSiMayor: false,
    });

    expect(resultado.type).toBe("image/jpeg");
    expect(resultado.size).toBe(400 * 1024);
  });

  it("puerta 3: con el DEFAULT (`devolverOriginalSiMayor` ausente) un resultado mas grande devuelve el ORIGINAL", async () => {
    // Regresion de las 4 superficies que solo OPTIMIZAN y no tienen tests propios:
    // GestionarOrdenPanel, ReportarIncidenteModal, GestionarDesdeAyudaModal, PostulacionForm.
    const original = archivo("evidencia.jpg", "image/jpeg", 2 * 1024 * 1024);
    blobDevuelto = new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "image/jpeg" });

    const resultado = await comprimirImagen(original);

    expect(resultado).toBe(original);
    expect(resultado.size).toBe(2 * 1024 * 1024);
  });

  it("R30: la imagen se decodifica con la orientacion EXIF de la foto", async () => {
    await comprimirImagen(archivo("IMG_0045.heic", "image/heic", 3 * 1024 * 1024), {
      saltarSiMenorA: 0,
      devolverOriginalSiMayor: false,
    });

    expect(createImageBitmapMock.mock.calls[0]?.[1]).toEqual({
      imageOrientation: "from-image",
    });
  });

  it("R31: si `toBlob` no produce nada, devuelve el ORIGINAL con su tipo intacto (el rechazo lo decide quien llama)", async () => {
    const original = archivo("IMG_0046.heic", "image/heic", 3 * 1024 * 1024);
    blobDevuelto = null;

    const resultado = await comprimirImagen(original, {
      saltarSiMenorA: 0,
      devolverOriginalSiMayor: false,
    });

    // El helper NUNCA lanza: quien convierte comprueba el `type` DESPUES y por eso puede decir
    // "no se pudo preparar la foto" (R31) en vez de "tipo no permitido" (R9).
    expect(resultado).toBe(original);
    expect(resultado.type).toBe("image/heic");
  });
});
