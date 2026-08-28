import { describe, it, expect } from "vitest";
import {
  CALIDAD_JPEG_ENVIO,
  clasificarAdjunto,
  FORMATOS_NOTA_VOZ,
  LIMITE_BYTES,
  LIMITE_DOCUMENTO_BYTES,
  MAX_CAPTION,
  MAX_LADO_LARGO_ENVIO,
  MIMES_ENVIO,
  TIMEOUT_SUBIDA_MS,
  validarAdjunto,
} from "@/lib/config/chat-media-envio";

// Feature 316 — A1 (R8, R9, R10, R12). Politica de SUBIDA: clasificacion por MIME y limites.
// Todo lo que se prueba aqui son funciones PURAS que corren en los DOS lados (R11).

describe("chat-media-envio: clasificarAdjunto (R8)", () => {
  it("(a) deriva el tipo de mensaje del MIME, incluidos los cinco documentos", () => {
    expect(clasificarAdjunto("application/pdf")).toBe("documento");
    expect(clasificarAdjunto("image/jpeg")).toBe("imagen");
    expect(clasificarAdjunto("image/png")).toBe("imagen");
    expect(clasificarAdjunto("audio/ogg")).toBe("audio");
    expect(clasificarAdjunto("video/mp4")).toBe("video");

    // Los cinco MIME de documento (PDF + Word .doc/.docx + Excel .xls/.xlsx).
    for (const mime of [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]) {
      expect(clasificarAdjunto(mime)).toBe("documento");
    }
    expect(MIMES_ENVIO.documento.size).toBe(5);
  });

  it("(b) webp y heic NO estan en la lista de Meta: entran por la normalizacion, no por aqui", () => {
    // No es un olvido: Meta no acepta ninguno de los dos como imagen. El navegador los convierte
    // a JPEG antes de validar (R29-R32); si estuvieran aqui, se subiria a Meta algo que rechaza.
    expect(clasificarAdjunto("image/webp")).toBeNull();
    expect(clasificarAdjunto("image/heic")).toBeNull();
    expect(MIMES_ENVIO.imagen.has("image/webp")).toBe(false);
    expect(MIMES_ENVIO.imagen.has("image/heic")).toBe(false);
  });

  it("tolera parametros y mayusculas del MIME (lo que entrega MediaRecorder)", () => {
    // `MediaRecorder.mimeType` llega como `audio/ogg;codecs=opus`: sin normalizar el MIME base,
    // una nota de voz en un formato que Meta SI acepta se rechazaria por tipo.
    expect(clasificarAdjunto("audio/ogg;codecs=opus")).toBe("audio");
    expect(clasificarAdjunto("IMAGE/JPEG")).toBe("imagen");
    // Y el que Meta rechaza sigue rechazado aunque venga con el mismo formato de parametros.
    expect(clasificarAdjunto("audio/webm;codecs=opus")).toBeNull();
  });
});

describe("chat-media-envio: validarAdjunto (R9/R10)", () => {
  it("(c) el limite de imagen es exclusivo: 5 MB exactos pasan, un byte mas no", () => {
    expect(validarAdjunto("image/jpeg", 5 * 1024 * 1024 + 1)).toEqual({
      ok: false,
      motivo: "demasiado_grande",
      limiteBytes: 5 * 1024 * 1024,
    });
    expect(validarAdjunto("image/jpeg", 5 * 1024 * 1024)).toEqual({ ok: true, tipo: "imagen" });
  });

  it("(d) un MIME fuera de la lista blanca se rechaza por tipo, no por tamano", () => {
    expect(validarAdjunto("application/x-msdownload", 10)).toEqual({
      ok: false,
      motivo: "tipo_no_permitido",
    });
  });

  it("audio y video comparten los 16 MB de Meta", () => {
    expect(validarAdjunto("audio/mpeg", 16 * 1024 * 1024)).toEqual({ ok: true, tipo: "audio" });
    expect(validarAdjunto("video/mp4", 16 * 1024 * 1024 + 1)).toEqual({
      ok: false,
      motivo: "demasiado_grande",
      limiteBytes: 16 * 1024 * 1024,
    });
  });
});

describe("chat-media-envio: nota de voz (R14/R15)", () => {
  it("(e) todos los formatos de grabacion son audio aceptado por Meta", () => {
    // Regresion: impide que alguien anada `audio/webm` a la lista de grabacion porque "Chrome
    // lo soporta". Meta lo rechaza como `type: audio` y el cliente no lo escucharia.
    expect(FORMATOS_NOTA_VOZ.length).toBeGreaterThan(0);
    for (const formato of FORMATOS_NOTA_VOZ) {
      const base = formato.split(";")[0];
      expect(MIMES_ENVIO.audio.has(base)).toBe(true);
      expect(clasificarAdjunto(formato)).toBe("audio");
    }
    expect(FORMATOS_NOTA_VOZ.some((f) => f.startsWith("audio/webm"))).toBe(false);
  });
});

describe("chat-media-envio: tope propio de documentos (D6/P3)", () => {
  it("(f) LIMITE_BYTES.documento REFERENCIA la constante, no repite el numero", () => {
    expect(LIMITE_DOCUMENTO_BYTES).toBe(25 * 1024 * 1024);
    expect(LIMITE_BYTES.documento).toBe(LIMITE_DOCUMENTO_BYTES);
    // Y es MAS restrictivo que los 100 MB de Meta a proposito: quien sube es un repartidor por
    // red movil. Un PDF de 26 MB, que Meta aceptaria, aqui se rechaza.
    expect(LIMITE_BYTES.documento).toBeLessThan(100 * 1024 * 1024);
    expect(validarAdjunto("application/pdf", 26 * 1024 * 1024)).toEqual({
      ok: false,
      motivo: "demasiado_grande",
      limiteBytes: 25 * 1024 * 1024,
    });
    expect(validarAdjunto("application/pdf", LIMITE_DOCUMENTO_BYTES)).toEqual({
      ok: true,
      tipo: "documento",
    });
  });
});

describe("chat-media-envio: constantes del composer y de la subida", () => {
  it("R12: el pie de adjunto tiene el maximo de Meta (1024), no el del texto libre (4096)", () => {
    expect(MAX_CAPTION).toBe(1024);
  });

  it("R29/R30: la normalizacion acota el lado largo y fija la calidad JPEG", () => {
    expect(MAX_LADO_LARGO_ENVIO).toBe(1600);
    expect(CALIDAD_JPEG_ENVIO).toBe(0.85);
  });

  it("el timeout de subida es mas generoso que el de un envio de texto (10 s)", () => {
    expect(TIMEOUT_SUBIDA_MS).toBeGreaterThan(10_000);
  });
});
