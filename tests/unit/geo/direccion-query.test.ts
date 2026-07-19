import { describe, it, expect } from "vitest";
import { construirQueryDireccion, hashDireccion } from "@/lib/geo/direccion-query";

// Feature 91 (R15/R16/R17) — construccion de la consulta y de la huella de cache. Las DOS
// normalizaciones son DISTINTAS a proposito (design §4): la consulta conserva acentos y
// capitalizacion (Google los usa como senal); la huella los normaliza para que dos
// escrituras equivalentes compartan entrada de cache.

const BASE = {
  direccion: "Av. Central 100",
  distritoNombre: "Carmen",
  cantonNombre: "San José",
  provinciaNombre: "San José",
};

describe("R15 — construccion de la consulta", () => {
  it("concatena direccion, distrito, canton, provincia y pais omitiendo los ausentes", () => {
    expect(construirQueryDireccion(BASE)).toBe(
      "Av. Central 100, Carmen, San José, San José, Costa Rica",
    );
  });

  it("no deja separadores vacios cuando un componente de catalogo viene en blanco", () => {
    const query = construirQueryDireccion({
      ...BASE,
      distritoNombre: "   ",
      cantonNombre: "",
    });
    expect(query).toBe("Av. Central 100, San José, Costa Rica");
    expect(query).not.toMatch(/,\s*,/);
    expect(query).not.toMatch(/,\s*$/);
  });

  it("conserva acentos y capitalizacion (son senal para el proveedor)", () => {
    const query = construirQueryDireccion(BASE);
    expect(query).toContain("San José");
    expect(query).not.toContain("san jose");
  });

  it("colapsa espacios redundantes de la direccion libre", () => {
    expect(
      construirQueryDireccion({ ...BASE, direccion: "  Av.   Central   100  " }),
    ).toBe("Av. Central 100, Carmen, San José, San José, Costa Rica");
  });
});

describe("R16 — orden sin distrito", () => {
  it("construye la consulta sin distrito cuando la orden no lo tiene", () => {
    expect(construirQueryDireccion({ ...BASE, distritoNombre: null })).toBe(
      "Av. Central 100, San José, San José, Costa Rica",
    );
  });
});

describe("R9/Q5 — sin direccion libre no hay consulta", () => {
  it.each([
    ["null", null],
    ["vacia", ""],
    ["solo espacios", "    "],
  ])("devuelve null cuando la direccion es %s", (_caso, direccion) => {
    expect(construirQueryDireccion({ ...BASE, direccion })).toBeNull();
  });
});

describe("robustez en el borde del writer", () => {
  // Esta funcion se llama DENTRO de la transaccion de creacion de ordenes. Un campo
  // AUSENTE (undefined, no null) en la fila proyectada debe comportarse como vacio y
  // NUNCA lanzar: una excepcion aqui abortaria la creacion de la orden entera.
  it("un componente undefined se omite en vez de reventar", () => {
    expect(() =>
      construirQueryDireccion({
        direccion: "Av. Central 100",
        distritoNombre: undefined,
        cantonNombre: undefined,
        provinciaNombre: undefined,
      }),
    ).not.toThrow();
    expect(
      construirQueryDireccion({
        direccion: "Av. Central 100",
        distritoNombre: undefined,
        cantonNombre: undefined,
        provinciaNombre: undefined,
      }),
    ).toBe("Av. Central 100, Costa Rica");
  });

  it("direccion undefined -> null (no geocodificable), sin lanzar", () => {
    expect(
      construirQueryDireccion({ ...BASE, direccion: undefined }),
    ).toBeNull();
  });
});

describe("R17 — huella de deduplicacion", () => {
  it("dos variantes con acentos, mayusculas y espacios extra producen la misma huella", () => {
    const a = hashDireccion("Av. Central 100, San José, Costa Rica");
    const b = hashDireccion("  AV. CENTRAL   100,   SAN JOSE,  COSTA RICA ");
    expect(a).toBe(b);
  });

  it("dos direcciones DISTINTAS producen huellas distintas", () => {
    expect(hashDireccion("Av. Central 100")).not.toBe(hashDireccion("Av. Central 200"));
  });

  it("es determinista y hexadecimal de 64 caracteres (SHA-256)", () => {
    const h = hashDireccion("Av. Central 100");
    expect(h).toBe(hashDireccion("Av. Central 100"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
