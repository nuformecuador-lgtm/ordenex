import { describe, it, expect } from "vitest";
import {
  FORMATO_DIRECCION_DESTINATARIO,
  parseDireccionDestinatario,
  type DireccionDestinatarioPartes,
} from "@/lib/utils/direccion-destinatario";

// Feature 142 (B2) — contrato del parser puro de `direccion_destinatario` (R11-R28).

const CANONICO = "Costa Rica / Cartago / Jimenez (Juan Vinas) / Frente gasolinera JSM, 200m sur";

function partesDe(valor: string): DireccionDestinatarioPartes {
  const r = parseDireccionDestinatario(valor);
  if (!r.ok) throw new Error(`se esperaba ok, hubo error: ${r.mensaje}`);
  return r.partes;
}

function mensajeDe(valor: string): string {
  const r = parseDireccionDestinatario(valor);
  if (r.ok) throw new Error("se esperaba error, hubo ok");
  return r.mensaje;
}

describe("parseDireccionDestinatario — separacion en 4 segmentos (R11, R14)", () => {
  it("R14: con exactamente tres '/' produce provincia, canton, distrito y direccion", () => {
    expect(partesDe(CANONICO)).toEqual({
      provincia: "Cartago",
      canton: "Jimenez",
      distrito: "Juan Vinas",
      direccion: "Frente gasolinera JSM, 200m sur",
    });
  });

  it("R11: solo los TRES primeros '/' son separadores; el resto queda en la direccion", () => {
    const partes = partesDe("CR / Cartago / Jimenez (Juan Vinas) / a / b / c");
    expect(partes.provincia).toBe("Cartago");
    expect(partes.canton).toBe("Jimenez");
    expect(partes.distrito).toBe("Juan Vinas");
    expect(partes.direccion).toBe("a / b / c");
  });
});

describe("parseDireccionDestinatario — segmento de pais (R12)", () => {
  it("R12: el pais se descarta sin validarlo y no aparece en el resultado", () => {
    const partes = partesDe(CANONICO);
    expect(Object.values(partes)).not.toContain("Costa Rica");
    expect(partes).not.toHaveProperty("pais");
  });

  it("R12: pais vacio, con texto arbitrario o con numeros -> mismo resultado", () => {
    const esperado = partesDe(CANONICO);
    for (const pais of ["", "  ", "XX", "Zimbabwe", "123"]) {
      expect(partesDe(`${pais}/ Cartago / Jimenez (Juan Vinas) / Frente gasolinera JSM, 200m sur`)).toEqual(
        esperado,
      );
    }
  });
});

describe("parseDireccionDestinatario — cantidad de separadores (R13)", () => {
  it.each([
    ["sin ningun '/'", "Costa Rica Cartago Jimenez"],
    ["con un solo '/'", "Costa Rica / Cartago"],
    ["con dos '/'", "Costa Rica / Cartago / Jimenez (Juan Vinas)"],
  ])("R13: %s -> error de formato citando el formato esperado", (_caso, valor) => {
    const mensaje = mensajeDe(valor);
    expect(mensaje).toContain("separadores");
    expect(mensaje).toContain(FORMATO_DIRECCION_DESTINATARIO);
  });
});

describe("parseDireccionDestinatario — direccion literal (R15, R16, R26)", () => {
  it("R15: conserva los '/' posteriores al tercero y los espacios internos sin colapsar", () => {
    const partes = partesDe(
      "CR / Cartago / Jimenez (Juan Vinas) / Frente a la iglesia / casa verde  #3",
    );
    expect(partes.direccion).toBe("Frente a la iglesia / casa verde  #3");
  });

  it("R16: una direccion que termina en '/' conserva ese '/' final", () => {
    expect(partesDe("CR / Cartago / Jimenez (Juan Vinas) / Casa esquinera /").direccion).toBe(
      "Casa esquinera /",
    );
  });

  it("R26: direccion literal vacia tras recortar espacios -> se acepta con direccion ''", () => {
    for (const valor of [
      "CR / Cartago / Jimenez (Juan Vinas) /",
      "CR / Cartago / Jimenez (Juan Vinas) /    ",
    ]) {
      const r = parseDireccionDestinatario(valor);
      expect(r.ok).toBe(true);
      expect(partesDe(valor).direccion).toBe("");
    }
  });
});

describe("parseDireccionDestinatario — recorte de espacios (R17)", () => {
  it("R17: recorta extremos de provincia, canton, distrito y direccion; deja los internos", () => {
    expect(partesDe("  Costa Rica  /  Cartago  /  Jimenez  (  Juan Vinas  )  /  Frente a X  ")).toEqual({
      provincia: "Cartago",
      canton: "Jimenez",
      distrito: "Juan Vinas",
      direccion: "Frente a X",
    });
  });

  it("R17: los espacios internos de cada segmento se conservan", () => {
    const partes = partesDe("CR / San  Jose / Vazquez  de Coronado (San  Isidro) / 200 m  norte");
    expect(partes.provincia).toBe("San  Jose");
    expect(partes.canton).toBe("Vazquez  de Coronado");
    expect(partes.distrito).toBe("San  Isidro");
    expect(partes.direccion).toBe("200 m  norte");
  });
});

describe("parseDireccionDestinatario — canton y distrito del 3.er segmento (R18)", () => {
  it("R18: el distrito sale del primer parentesis y el canton de lo que lo precede", () => {
    const partes = partesDe("CR / Cartago / Jimenez (Juan Vinas) / X");
    expect(partes.canton).toBe("Jimenez");
    expect(partes.distrito).toBe("Juan Vinas");
  });

  it("R18: un ')' dentro del distrito no confunde: cierra en el primer ')' posterior", () => {
    const partes = partesDe("CR / Cartago / La Union (Dulce Nombre) / Contiguo a (la plaza)");
    expect(partes.canton).toBe("La Union");
    expect(partes.distrito).toBe("Dulce Nombre");
    expect(partes.direccion).toBe("Contiguo a (la plaza)");
  });
});

describe("parseDireccionDestinatario — errores del parentesis de distrito (R19-R22)", () => {
  it("R19: sin parentesis de distrito -> error indicando que falta el distrito", () => {
    const mensaje = mensajeDe("CR / Cartago / Jimenez / Frente a X");
    expect(mensaje).toContain("distrito");
    expect(mensaje).toContain(FORMATO_DIRECCION_DESTINATARIO);
  });

  it.each([
    ["parentesis vacio", "CR / Cartago / Jimenez () / X"],
    ["parentesis con solo espacios", "CR / Cartago / Jimenez (   ) / X"],
  ])("R20: %s -> error de campo", (_caso, valor) => {
    expect(mensajeDe(valor)).toContain("vacio");
  });

  it("R21: parentesis abierto y no cerrado -> error de campo", () => {
    expect(mensajeDe("CR / Cartago / Jimenez (Juan Vinas / X")).toContain("cerrado");
  });

  it("R22: texto no vacio despues del ')' -> error de campo", () => {
    expect(mensajeDe("CR / Cartago / Jimenez (Juan Vinas) extra / X")).toContain("texto inesperado");
  });

  it("R22: solo espacios despues del ')' -> se ignoran sin error", () => {
    const partes = partesDe("CR / Cartago / Jimenez (Juan Vinas)    / X");
    expect(partes.canton).toBe("Jimenez");
    expect(partes.distrito).toBe("Juan Vinas");
  });
});

describe("parseDireccionDestinatario — provincia y canton vacios (R23, R24)", () => {
  it.each([
    ["provincia vacia", "CR // Jimenez (Juan Vinas) / X"],
    ["provincia con solo espacios", "CR /    / Jimenez (Juan Vinas) / X"],
  ])("R23: %s -> error de campo", (_caso, valor) => {
    expect(mensajeDe(valor)).toContain("provincia");
  });

  it.each([
    ["canton vacio", "CR / Cartago / (Juan Vinas) / X"],
    ["canton con solo espacios", "CR / Cartago /    (Juan Vinas) / X"],
  ])("R24: %s -> error de campo", (_caso, valor) => {
    expect(mensajeDe(valor)).toContain("canton");
  });
});

describe("parseDireccionDestinatario — valor ausente o vacio (R25)", () => {
  it.each([
    ["vacio", ""],
    ["solo espacios", "     "],
    ["solo tabuladores y saltos", " \t \n "],
  ])("R25: %s -> error de obligatoriedad citando el formato esperado", (_caso, valor) => {
    const mensaje = mensajeDe(valor);
    expect(mensaje).toContain("obligatorio");
    expect(mensaje).toContain(FORMATO_DIRECCION_DESTINATARIO);
  });
});

describe("parseDireccionDestinatario — sin normalizacion (R27)", () => {
  it("R27: entrega los nombres tal cual, con acentos y mayusculas del archivo", () => {
    expect(partesDe("costa rica / CARTAGO / jiménez (juan viñas) / X")).toEqual({
      provincia: "CARTAGO",
      canton: "jiménez",
      distrito: "juan viñas",
      direccion: "X",
    });
  });

  it("R27: no colapsa espacios repetidos internos (eso es tarea de resolverGeografia)", () => {
    expect(partesDe("CR / San  Jose / San  Jose (Hospital) / X").provincia).toBe("San  Jose");
  });
});

describe("parseDireccionDestinatario — pureza y totalidad (R28)", () => {
  it("R28: nunca lanza para ninguna entrada string", () => {
    const entradas = [
      "",
      "   ",
      "/",
      "//",
      "///",
      "////",
      "( ) / ( ) / ( ) / ( )",
      "CR / Cartago / Jimenez )( Juan Vinas / X",
      "\n\t/\n\t/\n\t/\n\t",
      "a".repeat(5000),
      "🙂 / 🙂 / 🙂 (🙂) / 🙂",
    ];
    for (const entrada of entradas) {
      expect(() => parseDireccionDestinatario(entrada)).not.toThrow();
    }
  });

  it("R28: es determinista — la misma entrada produce el mismo resultado", () => {
    expect(parseDireccionDestinatario(CANONICO)).toEqual(parseDireccionDestinatario(CANONICO));
    expect(parseDireccionDestinatario("CR / Cartago / Jimenez / X")).toEqual(
      parseDireccionDestinatario("CR / Cartago / Jimenez / X"),
    );
  });
});
