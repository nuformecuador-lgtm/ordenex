import { describe, it, expect } from "vitest";
import { cedulaSintetica, emailSintetico, slugify } from "@/lib/utils/api-key-identity";

// Feature 81 [D4] — derivacion de la identidad sintetica (R5/R6/R10).

describe("slugify (feature 81, R5/R6)", () => {
  const casos: Array<{ entrada: string; esperado: string; nota: string }> = [
    { entrada: "Tienda Uno", esperado: "tienda-uno", nota: "espacios y mayusculas" },
    { entrada: "Almacén Ñandú", esperado: "almacen-nandu", nota: "acentos y ñ" },
    { entrada: "ACME  S.A.", esperado: "acme-s-a", nota: "simbolos colapsados" },
    { entrada: "  Bodega 42  ", esperado: "bodega-42", nota: "recorte de extremos" },
    { entrada: "a---b", esperado: "a-b", nota: "guiones consecutivos colapsados" },
    { entrada: "--Tienda--", esperado: "tienda", nota: "sin '-' inicial ni final" },
    { entrada: "Ünïcödé Tëst", esperado: "unicode-test", nota: "diacriticos varios" },
    { entrada: "Café&Bar", esperado: "cafe-bar", nota: "ampersand" },
  ];

  for (const { entrada, esperado, nota } of casos) {
    it(`R5: normaliza ${JSON.stringify(entrada)} -> ${JSON.stringify(esperado)} (${nota})`, () => {
      expect(slugify(entrada)).toBe(esperado);
    });
  }

  it("R5: el slug resultante solo contiene [a-z0-9-]", () => {
    expect(slugify("Almacén Ñandú #1 (Norte)")).toMatch(/^[a-z0-9-]+$/);
  });

  // Alimenta R6: el service traduce el slug vacio a validation_error.
  it.each(["!!!", "   ", "---", "###$$$", "¿?¡!"])(
    "R6: %s no deja nada utilizable -> slug vacio",
    (entrada) => {
      expect(slugify(entrada)).toBe("");
    },
  );
});

describe("emailSintetico / cedulaSintetica (feature 81, R10/[D4])", () => {
  it("R10: el email vive en el TLD reservado .invalid (RFC 2606), no enrutable", () => {
    expect(emailSintetico("tienda-uno")).toBe("apikey+tienda-uno@apikey.invalid");
    expect(emailSintetico("tienda-uno").endsWith("@apikey.invalid")).toBe(true);
  });

  it("R10: la cedula vive en el namespace reservado APIKEY-", () => {
    expect(cedulaSintetica("tienda-uno")).toBe("APIKEY-tienda-uno");
  });

  it("R10: slugs distintos dan email y cedula distintos (base de la unicidad de R11)", () => {
    expect(emailSintetico("a")).not.toBe(emailSintetico("b"));
    expect(cedulaSintetica("a")).not.toBe(cedulaSintetica("b"));
  });

  it("R10: el namespace no puede colisionar con un email humano real", () => {
    // Ningun proveedor enruta .invalid, asi que ningun usuario real puede tenerlo.
    const email = emailSintetico(slugify("Tienda Uno"));
    expect(email).not.toMatch(/@(gmail|hotmail|outlook|yahoo)\./);
    expect(email.split("@")[1]).toBe("apikey.invalid");
  });
});
