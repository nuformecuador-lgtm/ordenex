import { describe, it, expect } from "vitest";
import {
  extraerVariables,
  validarCuerpo,
  renderPlantilla,
  previewConEjemplos,
} from "@/lib/utils/plantilla-mensaje";
import {
  PLANTILLA_VARIABLES,
  PLANTILLA_VARIABLE_KEYS,
} from "@/lib/types/plantilla-variables";

// Feature 107 — T2 (R13, R14, R15, R16, R18, R19).

describe("R13/R17: el catalogo predefinido esta VACIO por defecto (modelo abierto)", () => {
  it("no trae variables sembradas: el catalogo y el set de claves estan vacios", () => {
    expect(PLANTILLA_VARIABLES).toHaveLength(0);
    expect(PLANTILLA_VARIABLE_KEYS.size).toBe(0);
  });

  it("es data-driven: `key` es string libre (no un union cerrado), ampliar = una fila", () => {
    // Una entrada nueva arbitraria encaja en el tipo sin migrar codigo.
    const nueva = { key: "direccion", label: "Direccion", ejemplo: "Av. Siempre Viva" };
    const ampliado = [...PLANTILLA_VARIABLES, nueva];
    expect(ampliado.map((v) => v.key)).toContain("direccion");
  });

  it("acepta y extrae CUALQUIER clave bien formada definida por el usuario", () => {
    const r = validarCuerpo("Hola {{usuario}}, tu orden {{cod}}");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.variables).toEqual(["usuario", "cod"]);
  });

  it("un cuerpo con CERO variables es valido (variables = [])", () => {
    const r = validarCuerpo("Mensaje sin variables");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.variables).toEqual([]);
  });

  it("la preview de una clave definida por el usuario cae al marcador en MAYUSCULAS", () => {
    expect(previewConEjemplos("Hola {{usuario}}")).toBe("Hola USUARIO");
  });
});

describe("R14: reconoce {{ clave }} con espacios internos", () => {
  it("normaliza espacios y mayusculas a la clave lowercase", () => {
    expect(extraerVariables("Hola {{ usuario }}")).toEqual(["usuario"]);
    expect(extraerVariables("{{USUARIO}}")).toEqual(["usuario"]);
    expect(extraerVariables("{{cod}} y {{ cod }}")).toEqual(["cod"]);
  });
});

describe("R15: acepta cualquier clave bien formada y devuelve el array deduplicado", () => {
  it("extrae en orden de aparicion, sin duplicados", () => {
    const cuerpo = "Hola {{usuario}}, tu orden {{cod}} y otra vez {{usuario}}";
    expect(extraerVariables(cuerpo)).toEqual(["usuario", "cod"]);
  });

  it("acepta claves fuera del catalogo (sin lista blanca)", () => {
    const r = validarCuerpo("{{telefono}} y {{tienda_x}}");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.variables).toEqual(["telefono", "tienda_x"]);
  });

  it("cuerpo sin variables -> array vacio", () => {
    expect(extraerVariables("Sin placeholders")).toEqual([]);
  });
});

describe("R16: rechaza {{}} y claves con caracteres invalidos", () => {
  it("{{}} y {{ }} son malformados", () => {
    const a = validarCuerpo("Hola {{}}");
    expect(a.ok).toBe(false);
    const b = validarCuerpo("Hola {{ }}");
    expect(b.ok).toBe(false);
  });

  it("claves con espacios internos o caracteres fuera de [a-z0-9_] son malformadas", () => {
    expect(validarCuerpo("{{a b}}").ok).toBe(false);
    expect(validarCuerpo("{{á}}").ok).toBe(false);
    expect(validarCuerpo("{{cod-1}}").ok).toBe(false);
  });

  it("reporta el fragmento malformado", () => {
    const r = validarCuerpo("ok {{a-b}} fin");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.malformadas).toContain("{{a-b}}");
  });
});

describe("R18/R19: render sustituye todas las ocurrencias sin tocar el resto", () => {
  it("sustituye por el valor cuando la clave esta en el mapa de valores", () => {
    const out = renderPlantilla("Hola {{usuario}}, orden {{cod}}", {
      usuario: "Juan",
      cod: "ABC123",
    });
    expect(out).toBe("Hola Juan, orden ABC123");
  });

  it("con catalogo vacio toda clave bien formada -> marcador en MAYUSCULAS, sin romper", () => {
    expect(previewConEjemplos("Hola {{usuario}}, orden {{cod}}")).toBe("Hola USUARIO, orden COD");
    expect(previewConEjemplos("Envio a {{direccion}}")).toBe("Envio a DIRECCION");
  });

  it("reemplaza TODAS las ocurrencias y NO altera el texto no-placeholder", () => {
    const out = renderPlantilla("{{x}} - {{x}} - literal {{ }} no", { x: "V" });
    expect(out).toBe("V - V - literal {{ }} no");
  });
});
