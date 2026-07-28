import { describe, it, expect } from "vitest";
import { REQUIRED_HEADERS, findMissingHeaders, filaCargaSchema } from "@/lib/types/carga-masiva";

// Feature 142 (B3) — cabecera obligatoria y schema de fila tras el corte duro D1
// (R6, R7, R9, R39).

const HEADERS_NUEVOS = [
  "destinatario",
  "telefono",
  "direccion_destinatario",
  "monto_cobrar",
  "producto",
  "num_remision",
  "peso",
  "notas",
];

const HEADERS_VIEJOS = [
  "num_remision",
  "destinatario",
  "telefono",
  "provincia",
  "canton",
  "distrito",
  "direccion",
  "producto",
  "peso",
  "monto_cobrar",
  "notas",
];

describe("REQUIRED_HEADERS (R6)", () => {
  it("R6: exige exactamente num_remision, destinatario, telefono y direccion_destinatario", () => {
    expect([...REQUIRED_HEADERS]).toEqual([
      "num_remision",
      "destinatario",
      "telefono",
      "direccion_destinatario",
    ]);
  });

  it("R6/R5: ya no exige columnas geograficas separadas", () => {
    for (const vieja of ["provincia", "canton", "distrito", "direccion"]) {
      expect(REQUIRED_HEADERS).not.toContain(vieja);
    }
  });
});

describe("findMissingHeaders (R7, R8, R9, R10)", () => {
  it("R7: cabecera sin direccion_destinatario -> se reporta como obligatoria ausente", () => {
    expect(findMissingHeaders(["num_remision", "destinatario", "telefono"])).toEqual([
      "direccion_destinatario",
    ]);
  });

  it("R8/R9: la plantilla vieja (4 columnas geograficas) falla la cabecera por direccion_destinatario", () => {
    expect(findMissingHeaders(HEADERS_VIEJOS)).toEqual(["direccion_destinatario"]);
  });

  it("R10: columnas extra desconocidas ademas de las obligatorias no producen error de cabecera", () => {
    expect(findMissingHeaders([...HEADERS_NUEVOS, "provincia", "canton", "distrito", "direccion", "xyz"])).toEqual(
      [],
    );
  });

  it("la cabecera de la plantilla nueva no tiene obligatorias ausentes", () => {
    expect(findMissingHeaders(HEADERS_NUEVOS)).toEqual([]);
  });
});

describe("filaCargaSchema (R39, design.md §4)", () => {
  const filaOk = {
    num_remision: "REM-1",
    destinatario: "Ana",
    telefono: "88887777",
    producto: "Caja",
    direccion_destinatario: "  Costa Rica / Cartago / Jimenez (Juan Vinas) / Frente a X  ",
    monto_cobrar: "25.90",
    notas: "",
  };

  it("acepta direccion_destinatario como paso-a-traves recortado", () => {
    const data = filaCargaSchema.parse(filaOk);
    expect(data.direccion_destinatario).toBe(
      "Costa Rica / Cartago / Jimenez (Juan Vinas) / Frente a X",
    );
  });

  it("direccion_destinatario ausente -> '' (el fieldError lo produce el extractor del service)", () => {
    const sinDireccion: Record<string, string> = { ...filaOk };
    delete sinDireccion.direccion_destinatario;
    const data = filaCargaSchema.parse(sinDireccion);
    expect(data.direccion_destinatario).toBe("");
  });

  it("design.md §4: el schema NO declara campos geograficos (los aporta el GeoInput por via)", () => {
    const data = filaCargaSchema.parse({
      ...filaOk,
      provincia: "Cartago",
      canton: "Jimenez",
      distrito: "Juan Vinas",
      direccion: "Frente a X",
    }) as Record<string, unknown>;
    expect(data).not.toHaveProperty("provincia");
    expect(data).not.toHaveProperty("canton");
    expect(data).not.toHaveProperty("distrito");
    expect(data).not.toHaveProperty("direccion");
  });

  it("R39: conserva la semantica de num_remision/destinatario/telefono/producto/monto_cobrar/notas", () => {
    const data = filaCargaSchema.parse(filaOk);
    expect(data.num_remision).toBe("REM-1");
    expect(data.monto_cobrar).toBe(25.9);
    expect(data.notas).toBe("");

    const vacios = filaCargaSchema.safeParse({ ...filaOk, num_remision: "", producto: "" });
    expect(vacios.success).toBe(false);

    const montoInvalido = filaCargaSchema.safeParse({ ...filaOk, monto_cobrar: "-1" });
    expect(montoInvalido.success).toBe(false);

    expect(filaCargaSchema.parse({ ...filaOk, monto_cobrar: "" }).monto_cobrar).toBeNull();
  });
});
