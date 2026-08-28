import { describe, it, expect } from "vitest";
import { resolverOwnerApiKey } from "@/lib/utils/api-key-owner";

// Feature 302 — la funcion que decide QUIEN ES EL DUENO de las ordenes de una API key.
//
// Es media docena de lineas, pero es el punto unico del que cuelgan TODAS las superficies del
// canal (carga, cotizacion, cancelacion, habilitacion, PDF, lecturas y analitica derivan el dueno
// de `actor.usuarioId`, y ese id sale de aqui). Por eso tiene tests propios: una regresion aqui no
// da una cifra equivocada, cambia de dueno a las ordenes de una tienda.

describe("resolverOwnerApiKey", () => {
  it("sin tienda destino, el dueno es la cuenta dedicada (comportamiento historico 88/[D4])", () => {
    expect(resolverOwnerApiKey("u-dedicada", null)).toBe("u-dedicada");
  });

  it("con tienda destino, el dueno es la TIENDA", () => {
    expect(resolverOwnerApiKey("u-dedicada", "u-nuform")).toBe("u-nuform");
  });

  it("`undefined` se trata como ausencia, igual que `null`", () => {
    // La columna es nullable y, segun por donde venga la fila, un campo ausente puede llegar como
    // `undefined`. Las dos formas de "no hay tienda" tienen que dar el mismo dueno.
    expect(resolverOwnerApiKey("u-dedicada", undefined)).toBe("u-dedicada");
    expect(resolverOwnerApiKey("u-dedicada", undefined)).toBe(
      resolverOwnerApiKey("u-dedicada", null),
    );
  });

  it("la cadena vacia NO es un id: se trata como ausencia, nunca como un owner vacio", () => {
    // Un owner `""` no falla: casa con cero filas en unas consultas y se escribiria como
    // `tienda_id = ''` en otras. Fallar hacia la cuenta dedicada es el unico desenlace seguro.
    expect(resolverOwnerApiKey("u-dedicada", "")).toBe("u-dedicada");
  });

  it("es pura: el mismo par de ids da siempre el mismo dueno", () => {
    expect(resolverOwnerApiKey("a", "b")).toBe(resolverOwnerApiKey("a", "b"));
    expect(resolverOwnerApiKey("a", null)).not.toBe(resolverOwnerApiKey("a", "b"));
  });
});
