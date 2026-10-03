// Ficha 470 (T4.1, design §4.1) — `descargarDatos` / `leerDesdeAlmacen`: el transporte del conjunto de
// una descarga de Familia A en el NAVEGADOR. Cubre R6 (directo sin red), R7 (almacén: fetch, gunzip y
// deserializar al MISMO objeto), R15 (sobre de error ⇒ lanza) y R16 (lectura fallida ⇒ lanza).
//
// `prepararDescargaAction` y `fetch` son dobles: ningún test toca Storage (el `.env` local apunta a
// producción). El gzip es REAL (`node:zlib`) y el texto lo produce el códec real del servidor.
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepararMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/descargas", () => ({ prepararDescargaAction: prepararMock }));

import {
  DescargaTransporteError,
  descargarDatos,
  leerDesdeAlmacen,
} from "@/components/shared/descarga-datos";
import { serializarDescarga } from "@/lib/utils/codec-descarga";

const URL_FIRMADA =
  "https://x.supabase.co/storage/v1/object/sign/descargas/tmp/0b8f7c3e-1a2b-4c3d-8e4f-123456789abc.json.gz?token=t";

/** Un resultado con lo que una Server Action transporta y JSON no: fechas y bigint. */
const RESULTADO = {
  status: "ok" as const,
  items: [
    { guia: "A-1", monto: 1500, creada: new Date("2026-09-30T14:05:00.000Z"), id: BigInt("9007199254740993") },
    { guia: "B-2", monto: -20, creada: new Date("2026-10-01T00:00:00.000Z"), id: BigInt(2) },
  ],
  total: 2,
};

function respuestaGzip(texto: string, status = 200): Response {
  return new Response(new Uint8Array(gzipSync(Buffer.from(texto, "utf8"))), { status });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  prepararMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("descargarDatos · directo (R6)", () => {
  it("devuelve el MISMO resultado del sobre y no llama a fetch", async () => {
    prepararMock.mockResolvedValue({ modo: "directo", resultado: RESULTADO });
    const r = await descargarDatos("listarOrdenesCompleto", { filter: { estado: "x" } });
    expect(r).toBe(RESULTADO);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("manda a la preparación el nombre y la entrada tal cual, en una sola llamada", async () => {
    prepararMock.mockResolvedValue({ modo: "directo", resultado: RESULTADO });
    const entrada = { filtros: { desde: "2026-09-01" } };
    await descargarDatos("libroCajaKardexConDetalle", entrada);
    expect(prepararMock).toHaveBeenCalledTimes(1);
    expect(prepararMock.mock.calls[0]).toEqual(["libroCajaKardexConDetalle", entrada]);
  });

  it("los errores PROPIOS de la acción vuelven como resultado, sin lanzar (R11)", async () => {
    const limite = { status: "limite_excedido", total: 2_000_000, limite: 1_048_575 };
    prepararMock.mockResolvedValue({ modo: "directo", resultado: limite });
    await expect(descargarDatos("listarOrdenesCompleto", {})).resolves.toEqual(limite);
  });
});

describe("descargarDatos · almacén (R7)", () => {
  it("lee la URL firmada UNA vez, sin credenciales, y reconstruye el objeto con fechas y bigint", async () => {
    prepararMock.mockResolvedValue({ modo: "almacen", url: URL_FIRMADA });
    fetchMock.mockResolvedValue(respuestaGzip(serializarDescarga(RESULTADO)));

    const r = await descargarDatos("listarOrdenesCompleto", {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(URL_FIRMADA);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "omit", cache: "no-store" });
    expect(r).toEqual(RESULTADO);
    const items = (r as unknown as typeof RESULTADO).items;
    expect(items[0].creada).toBeInstanceOf(Date);
    expect(typeof items[0].id).toBe("bigint");
  });
});

describe("descargarDatos · lectura fallida (R16)", () => {
  it.each([403, 404, 400])("HTTP %i (URL caducada o sin permiso) ⇒ lanza", async (status) => {
    prepararMock.mockResolvedValue({ modo: "almacen", url: URL_FIRMADA });
    fetchMock.mockResolvedValue(new Response("no", { status }));
    await expect(descargarDatos("listarOrdenesCompleto", {})).rejects.toThrow(`HTTP ${status}`);
  });

  it("red caída ⇒ lanza", async () => {
    prepararMock.mockResolvedValue({ modo: "almacen", url: URL_FIRMADA });
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(descargarDatos("listarOrdenesCompleto", {})).rejects.toThrow("Failed to fetch");
  });

  it("gzip corrupto ⇒ lanza", async () => {
    prepararMock.mockResolvedValue({ modo: "almacen", url: URL_FIRMADA });
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { status: 200 }));
    await expect(descargarDatos("listarOrdenesCompleto", {})).rejects.toThrow();
  });

  it("gzip válido con contenido que no es JSON ⇒ lanza", async () => {
    fetchMock.mockResolvedValue(respuestaGzip("esto no es json"));
    await expect(leerDesdeAlmacen(URL_FIRMADA)).rejects.toThrow();
  });
});

describe("descargarDatos · sobre de error (R12/R15)", () => {
  it("fallo del almacén (AppErrorShape INTERNAL) ⇒ lanza DescargaTransporteError con el código", async () => {
    prepararMock.mockResolvedValue({ status: "error", code: "INTERNAL", message: "Error interno" });
    const p = descargarDatos("listarOrdenesCompleto", {});
    await expect(p).rejects.toBeInstanceOf(DescargaTransporteError);
    await expect(p).rejects.toThrow("INTERNAL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nombre rechazado (validation_error) ⇒ lanza", async () => {
    prepararMock.mockResolvedValue({ status: "validation_error", fieldErrors: { nombre: ["Descarga desconocida"] } });
    await expect(descargarDatos("listarOrdenesCompleto", {})).rejects.toThrow("validation_error");
  });

  it("respuesta sin forma de sobre (undefined) ⇒ lanza", async () => {
    prepararMock.mockResolvedValue(undefined);
    await expect(descargarDatos("listarOrdenesCompleto", {})).rejects.toBeInstanceOf(DescargaTransporteError);
  });

  it("modo almacén sin URL ⇒ lanza, sin fetch", async () => {
    prepararMock.mockResolvedValue({ modo: "almacen" });
    await expect(descargarDatos("listarOrdenesCompleto", {})).rejects.toBeInstanceOf(DescargaTransporteError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
