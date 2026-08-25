import { describe, it, expect } from "vitest";
import {
  FORMATO_CANTON_DISTRITO,
  parseCantonDistrito,
  type CantonDistritoPartes,
} from "@/lib/utils/canton-distrito";

// Feature 276 (B2) — contrato del parser puro de `canton_distrito` (R12-R21).
//
// OJO al atajo de R14: un valor sin parentesis NO es un error, es `canton (canton)`.
// Decision del humano durante la implementacion; ver el bloque "canton sin distrito".
// Sucede a `tests/unit/utils/direccion-destinatario.test.ts`, retirado con la
// plantilla v2: sus casos de las cinco ramas de error se conservan aqui, que es
// donde vive ahora el cuerpo que los produce.

const CANONICO = "Cartago (Occidental)";

function partesDe(valor: string): CantonDistritoPartes {
  const r = parseCantonDistrito(valor);
  if (!r.ok) throw new Error(`se esperaba ok, hubo error: ${r.mensaje}`);
  return r.partes;
}

function mensajeDe(valor: string): string {
  const r = parseCantonDistrito(valor);
  if (r.ok) throw new Error("se esperaba ok=false, hubo ok=true");
  return r.mensaje;
}

describe("parseCantonDistrito — separacion canton/distrito (R12, R13)", () => {
  it("R12: extrae el canton antes del '(' y el distrito entre parentesis", () => {
    expect(partesDe(CANONICO)).toEqual({ canton: "Cartago", distrito: "Occidental" });
  });

  it("R12: un canton de varias palabras se conserva entero", () => {
    expect(partesDe("San Jose (Carmen)")).toEqual({ canton: "San Jose", distrito: "Carmen" });
  });

  it("R12: un distrito de varias palabras se conserva entero", () => {
    expect(partesDe("Jimenez (Juan Vinas)")).toEqual({
      canton: "Jimenez",
      distrito: "Juan Vinas",
    });
  });

  it("R13: recorta los espacios de los extremos de ambas partes", () => {
    expect(partesDe("   Cartago   (   Occidental   )   ")).toEqual({
      canton: "Cartago",
      distrito: "Occidental",
    });
  });

  it("R13: NO normaliza acentos ni mayusculas (eso es trabajo de resolveGeo)", () => {
    expect(partesDe("SAN JOSÉ (Pavas)")).toEqual({ canton: "SAN JOSÉ", distrito: "Pavas" });
  });

  it("R13: conserva los espacios internos sin colapsarlos", () => {
    expect(partesDe("San  Pedro (Los  Angeles)")).toEqual({
      canton: "San  Pedro",
      distrito: "Los  Angeles",
    });
  });

  it("R12: un ')' posterior al primero queda dentro del sobrante, no del distrito", () => {
    // El distrito se corta en el PRIMER ')' tras el '(' — lo que siga es sobrante (R17).
    expect(mensajeDe("Cartago (Occidental) (extra)")).toContain(
      "hay texto inesperado despues del distrito",
    );
  });
});

describe("parseCantonDistrito — canton sin distrito (R14, R16)", () => {
  it("R14: sin parentesis, el distrito toma el nombre del canton", () => {
    expect(partesDe("Cartago")).toEqual({ canton: "Cartago", distrito: "Cartago" });
  });

  it("R14: el atajo respeta los espacios internos y la caja del nombre", () => {
    expect(partesDe("  San  José  ")).toEqual({ canton: "San  José", distrito: "San  José" });
  });

  it("R16: los parentesis vacios dicen lo mismo que no ponerlos", () => {
    expect(partesDe("Cartago ()")).toEqual({ canton: "Cartago", distrito: "Cartago" });
  });

  it("R16: parentesis con solo espacios, idem", () => {
    expect(partesDe("Cartago (   )")).toEqual({ canton: "Cartago", distrito: "Cartago" });
  });

  it("R14: el atajo NO inventa geografia — la forma larga equivalente da lo mismo", () => {
    expect(partesDe("Cartago")).toEqual(partesDe("Cartago (Cartago)"));
  });
});

describe("parseCantonDistrito — ramas de error (R15, R17-R19)", () => {
  it("R15: parentesis sin cerrar -> lo dice explicitamente", () => {
    expect(mensajeDe("Cartago (Occidental")).toContain(
      "el parentesis del distrito no esta cerrado",
    );
  });

  it("R17: texto despues del ')'", () => {
    expect(mensajeDe("Cartago (Occidental) sobra")).toContain(
      "hay texto inesperado despues del distrito",
    );
  });

  it("R18: canton vacio antes del '('", () => {
    expect(mensajeDe("(Occidental)")).toContain("el canton esta vacio");
  });

  it("R19: valor vacio -> obligatorio", () => {
    expect(mensajeDe("")).toContain("canton_distrito es obligatorio");
  });

  it("R19: solo espacios -> obligatorio", () => {
    expect(mensajeDe("     ")).toContain("canton_distrito es obligatorio");
  });

  it("R15-R19: TODO mensaje de error cita el formato esperado", () => {
    const invalidos = [
      "",
      "   ",
      "Cartago (Occidental",
      "Cartago (Occidental) sobra",
      "(Occidental)",
    ];
    for (const valor of invalidos) {
      expect(mensajeDe(valor)).toContain(`Formato esperado: ${FORMATO_CANTON_DISTRITO}`);
    }
  });
});

describe("parseCantonDistrito — totalidad (R20)", () => {
  it("R20: nunca lanza para ninguna entrada string", () => {
    const entradas = [
      "",
      " ",
      "(",
      ")",
      "()",
      "((",
      "))",
      ")(",
      "Cartago (Occidental)",
      "a(b)c",
      "/".repeat(50),
      "\t\n",
      "🚚 (📦)",
    ];
    for (const valor of entradas) {
      expect(() => parseCantonDistrito(valor)).not.toThrow();
    }
  });

  it("R20: el resultado siempre es un ok:true con partes o un ok:false con mensaje", () => {
    const r = parseCantonDistrito("a(b)");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.partes).toEqual({ canton: "a", distrito: "b" });
    const e = parseCantonDistrito("(x)");
    expect(e.ok).toBe(false);
    if (!e.ok) expect(typeof e.mensaje).toBe("string");
  });
});
