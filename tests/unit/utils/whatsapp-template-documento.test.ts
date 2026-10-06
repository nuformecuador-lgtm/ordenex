import { describe, it, expect } from "vitest";
import {
  construirComponentsEnvio,
  construirComponentsTemplate,
} from "@/lib/utils/whatsapp-template";

// Ficha 474 (T2.5, R5/R33) — cabecera DOCUMENT en el alta y en el envio, y NO REGRESION: sin
// `opts` la salida es la de siempre (literales escritos a mano, no derivados de la funcion).

describe("474/R5 — construirComponentsTemplate con documento", () => {
  it("sin opts: identico al literal de siempre", () => {
    expect(construirComponentsTemplate("Hola {{destinatario}}", ["destinatario"])).toEqual([
      { type: "BODY", text: "Hola {{1}}", example: { body_text: [["María Rodríguez"]] } },
    ]);
  });

  it("sin variables ni opts: solo BODY sin example", () => {
    expect(construirComponentsTemplate("Hola", [])).toEqual([{ type: "BODY", text: "Hola" }]);
  });

  it("con documento: HEADER DOCUMENT con header_handle ANTES del BODY", () => {
    const c = construirComponentsTemplate("Buenos días {{destinatario_nombre}}", ["destinatario_nombre"], {
      ejemplos: () => "Daniel",
      documento: { headerHandle: "4::aGFuZGxl" },
    });
    expect(c).toEqual([
      { type: "HEADER", format: "DOCUMENT", example: { header_handle: ["4::aGFuZGxl"] } },
      { type: "BODY", text: "Buenos días {{1}}", example: { body_text: [["Daniel"]] } },
    ]);
  });

  it("ejemplos del informe sustituyen al catalogo de orden", () => {
    const c = construirComponentsTemplate("{{fecha}} {{hora}}", ["fecha", "hora"], {
      ejemplos: (k) => (k === "fecha" ? "05/10/2026" : "05:00"),
    });
    expect(c).toEqual([
      { type: "BODY", text: "{{1}} {{2}}", example: { body_text: [["05/10/2026", "05:00"]] } },
    ]);
  });
});

describe("474/R33 — construirComponentsEnvio con documento", () => {
  it("sin opts: identico al literal de siempre", () => {
    expect(construirComponentsEnvio(["a"], { a: "x" })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "x" }] },
    ]);
    expect(construirComponentsEnvio([], {})).toEqual([]);
  });

  it("con documento: header document con id y filename, y luego body", () => {
    expect(
      construirComponentsEnvio(["a"], { a: "x" }, {
        documento: { mediaId: "MID", nombreArchivo: "prueba-2026-10-05.pdf" },
      }),
    ).toEqual([
      {
        type: "header",
        parameters: [{ type: "document", document: { id: "MID", filename: "prueba-2026-10-05.pdf" } }],
      },
      { type: "body", parameters: [{ type: "text", text: "x" }] },
    ]);
  });

  it("documento sin variables: solo el header", () => {
    expect(
      construirComponentsEnvio([], {}, { documento: { mediaId: "M", nombreArchivo: "f.pdf" } }),
    ).toHaveLength(1);
  });
});
