import { describe, it, expect, vi } from "vitest";
import { gunzipSync } from "node:zlib";

import { EntregaDescargaService } from "@/lib/services/EntregaDescargaService";
import type { IAlmacenDescargas } from "@/lib/interfaces/external/IAlmacenDescargas";
import { deserializarDescarga, serializarDescarga } from "@/lib/utils/codec-descarga";

// Ficha 470 (T3.2, R5/R6/R10/R11/R15) — el transporte del conjunto, con un almacen DOBLE.

function almacenDoble(opciones: { guardarFalla?: Error; firmarFalla?: Error } = {}) {
  const guardado: Uint8Array[] = [];
  const guardar = vi.fn<IAlmacenDescargas["guardar"]>(async (bytes) => {
    if (opciones.guardarFalla) throw opciones.guardarFalla;
    guardado.push(bytes);
    return { ruta: "tmp/11111111-2222-4333-8444-555555555555.json.gz" };
  });
  const firmar = vi.fn<IAlmacenDescargas["firmar"]>(async (ruta, ttl) => {
    if (opciones.firmarFalla) throw opciones.firmarFalla;
    return `https://firmada/${ruta}?ttl=${ttl}`;
  });
  const purgarAnterioresA = vi.fn<IAlmacenDescargas["purgarAnterioresA"]>();
  const almacen: IAlmacenDescargas = { guardar, firmar, purgarAnterioresA };
  const llamadas = () => guardar.mock.calls.length + firmar.mock.calls.length + purgarAnterioresA.mock.calls.length;
  return { almacen, guardar, firmar, guardado, llamadas };
}

const RESULTADO = {
  status: "ok" as const,
  items: Array.from({ length: 50 }, (_, i) => ({ id: `o-${i}`, createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)), monto: "1000.00" })),
  total: 50,
};
const BYTES = Buffer.byteLength(serializarDescarga(RESULTADO), "utf8");

describe("R6 — por debajo (o en) el umbral: directo, el MISMO objeto, cero almacen", () => {
  it("umbral holgado ⇒ { modo: directo, resultado } con identidad de objeto", async () => {
    const d = almacenDoble();
    const s = new EntregaDescargaService(d.almacen, { UMBRAL_ALMACEN_BYTES: 2_000_000, TTL_URL_SEGUNDOS: 300 });
    const r = await s.entregar(RESULTADO);
    expect(r.modo).toBe("directo");
    expect(r.modo === "directo" && r.resultado).toBe(RESULTADO);
    expect(d.llamadas()).toBe(0);
  });

  it("BORDE: serializado de EXACTAMENTE el umbral ⇒ directo (mata la mutacion `<=` → `<`)", async () => {
    const d = almacenDoble();
    const s = new EntregaDescargaService(d.almacen, { UMBRAL_ALMACEN_BYTES: BYTES, TTL_URL_SEGUNDOS: 300 });
    expect((await s.entregar(RESULTADO)).modo).toBe("directo");
    expect(d.llamadas()).toBe(0);
  });

  it("el umbral se mide en BYTES utf-8, no en caracteres", async () => {
    const conAcentos = { status: "ok", items: ["ñandú ✓"] };
    const chars = serializarDescarga(conAcentos).length;
    const d = almacenDoble();
    // Con el umbral en los caracteres, los bytes (mas) lo superan ⇒ almacen.
    const s = new EntregaDescargaService(d.almacen, { UMBRAL_ALMACEN_BYTES: chars, TTL_URL_SEGUNDOS: 300 });
    expect((await s.entregar(conAcentos)).modo).toBe("almacen");
  });
});

describe("R5/R10 — por encima del umbral: gzip al almacen y URL firmada con el TTL", () => {
  it("un byte por encima ⇒ guarda, firma con TTL_URL_SEGUNDOS y devuelve { modo: almacen, url }", async () => {
    const d = almacenDoble();
    const s = new EntregaDescargaService(d.almacen, { UMBRAL_ALMACEN_BYTES: BYTES - 1, TTL_URL_SEGUNDOS: 300 });
    const r = await s.entregar(RESULTADO);
    expect(r).toEqual({ modo: "almacen", url: "https://firmada/tmp/11111111-2222-4333-8444-555555555555.json.gz?ttl=300" });
    expect(d.guardar).toHaveBeenCalledTimes(1);
    expect(d.firmar).toHaveBeenCalledWith("tmp/11111111-2222-4333-8444-555555555555.json.gz", 300);
    // El sobre NO lleva el resultado.
    expect(r).not.toHaveProperty("resultado");
  });

  it("lo guardado es gzip de `serializarDescarga`: descomprimido y deserializado es el original", async () => {
    const d = almacenDoble();
    await new EntregaDescargaService(d.almacen, { UMBRAL_ALMACEN_BYTES: 1, TTL_URL_SEGUNDOS: 120 }).entregar(RESULTADO);
    const bytes = d.guardado[0];
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]); // cabecera gzip
    const vuelta = deserializarDescarga<typeof RESULTADO>(gunzipSync(bytes).toString("utf8"));
    expect(vuelta).toEqual(RESULTADO);
    expect(vuelta.items[3].createdAt).toBeInstanceOf(Date);
    expect(d.firmar.mock.calls[0][1]).toBe(120);
  });
});

describe("R11 — los resultados de error van directos y el almacen no se toca", () => {
  it.each([
    { status: "unauthenticated" },
    { status: "forbidden" },
    { status: "validation_error", fieldErrors: { desde: ["Fecha invalida"] } },
    { status: "limite_excedido", total: 2_000_000, limite: 1_048_575 },
    { status: "limite_excedido", hoja: "detalle", total: 2_000_000, limite: 1_048_575 },
  ])("%o ⇒ directo", async (error) => {
    const d = almacenDoble();
    // Umbral por defecto de produccion: un error real nunca lo alcanza.
    const r = await new EntregaDescargaService(d.almacen, { UMBRAL_ALMACEN_BYTES: 2_000_000, TTL_URL_SEGUNDOS: 300 }).entregar(error);
    expect(r).toEqual({ modo: "directo", resultado: error });
    expect(d.llamadas()).toBe(0);
  });
});

describe("R15 — un fallo del almacen se propaga (la accion lo traduce a ActionError)", () => {
  it("fallo al guardar ⇒ lanza con su contexto y no firma", async () => {
    const d = almacenDoble({ guardarFalla: new Error("fallo al subir la descarga temporal: Payload too large") });
    const s = new EntregaDescargaService(d.almacen, { UMBRAL_ALMACEN_BYTES: 1, TTL_URL_SEGUNDOS: 300 });
    await expect(s.entregar(RESULTADO)).rejects.toThrow(/fallo al subir la descarga temporal/);
    expect(d.firmar).not.toHaveBeenCalled();
  });

  it("fallo al firmar ⇒ lanza con su contexto", async () => {
    const d = almacenDoble({ firmarFalla: new Error("fallo al firmar la descarga temporal: x") });
    const s = new EntregaDescargaService(d.almacen, { UMBRAL_ALMACEN_BYTES: 1, TTL_URL_SEGUNDOS: 300 });
    await expect(s.entregar(RESULTADO)).rejects.toThrow(/fallo al firmar la descarga temporal/);
  });

  it("un valor no serializable lanza ANTES de tocar el almacen (K7)", async () => {
    const d = almacenDoble();
    const s = new EntregaDescargaService(d.almacen, { UMBRAL_ALMACEN_BYTES: 1, TTL_URL_SEGUNDOS: 300 });
    await expect(s.entregar({ status: "ok", m: new Map() })).rejects.toThrow(/«Map»/);
    expect(d.llamadas()).toBe(0);
  });
});
