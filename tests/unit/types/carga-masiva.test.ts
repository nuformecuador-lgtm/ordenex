import { describe, it, expect } from "vitest";
import { REQUIRED_HEADERS, findMissingHeaders, filaCargaSchema } from "@/lib/types/carga-masiva";

// Feature 276 (B3) — cabecera obligatoria y schema de fila tras el corte duro de
// la plantilla v3 (R7, R8, R10, R11, R30).

const HEADERS_NUEVOS = [
  "destinatario",
  "telefono",
  "provincia",
  "canton_distrito",
  "direccion",
  "monto_cobrar",
  "producto",
  "num_remision",
  "peso",
  "notas",
];

/** Plantilla v2 (feature 142): la geografia entera en una sola columna. */
const HEADERS_V2 = [
  "destinatario",
  "telefono",
  "direccion_destinatario",
  "monto_cobrar",
  "producto",
  "num_remision",
  "peso",
  "notas",
];

describe("REQUIRED_HEADERS (R7)", () => {
  it("R7: exige num_remision, destinatario, telefono, provincia, canton_distrito y direccion", () => {
    expect([...REQUIRED_HEADERS]).toEqual([
      "num_remision",
      "destinatario",
      "telefono",
      "provincia",
      "canton_distrito",
      "direccion",
    ]);
  });

  it("R5/R10: ya no exige la columna unica de la v2 ni columnas de canton/distrito sueltas", () => {
    for (const muerta of ["direccion_destinatario", "canton", "distrito"]) {
      expect(REQUIRED_HEADERS).not.toContain(muerta);
    }
  });
});

describe("findMissingHeaders (R7, R8, R9, R10)", () => {
  it("R8: cabecera sin las columnas geograficas -> se reportan como obligatorias ausentes", () => {
    expect(findMissingHeaders(["num_remision", "destinatario", "telefono"])).toEqual([
      "provincia",
      "canton_distrito",
      "direccion",
    ]);
  });

  it("R9/R10: la plantilla v2 falla la cabecera por provincia y canton_distrito", () => {
    // `direccion` tampoco esta en la v2, asi que las tres faltan: no hay forma de
    // que un archivo v2 pase, que es justo el corte duro.
    expect(findMissingHeaders(HEADERS_V2)).toEqual([
      "provincia",
      "canton_distrito",
      "direccion",
    ]);
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

describe("filaCargaSchema (R30, design.md §5)", () => {
  const filaOk = {
    num_remision: "REM-1",
    destinatario: "Ana",
    telefono: "88887777",
    producto: "Caja",
    provincia: "  Cartago  ",
    canton_distrito: "  Cartago (Occidental)  ",
    direccion: "  Frente a X  ",
    monto_cobrar: "25.90",
    notas: "",
  };

  it("R30: acepta las tres columnas geograficas como paso-a-traves recortado", () => {
    const data = filaCargaSchema.parse(filaOk);
    expect(data.provincia).toBe("Cartago");
    expect(data.canton_distrito).toBe("Cartago (Occidental)");
    expect(data.direccion).toBe("Frente a X");
  });

  it("R30: geografia ausente -> '' (el fieldError lo produce el extractor del service)", () => {
    const sinGeo: Record<string, string> = { ...filaOk };
    delete sinGeo.provincia;
    delete sinGeo.canton_distrito;
    delete sinGeo.direccion;
    const data = filaCargaSchema.parse(sinGeo);
    expect(data.provincia).toBe("");
    expect(data.canton_distrito).toBe("");
    expect(data.direccion).toBe("");
  });

  it("R26/R30: el schema NO valida el CONTENIDO geografico (eso es del GeoInput por via)", () => {
    // Un canton_distrito imposible y una provincia inexistente pasan el schema:
    // quien los rechaza es el extractor del service, con la clave de su columna.
    const data = filaCargaSchema.parse({
      ...filaOk,
      provincia: "Narnia",
      canton_distrito: "basura sin parentesis (",
    });
    expect(data.provincia).toBe("Narnia");
    expect(data.canton_distrito).toBe("basura sin parentesis (");
  });

  it("R30: el schema sigue SIN declarar canton ni distrito sueltos (los usa la via API key desde raw)", () => {
    const data = filaCargaSchema.parse({
      ...filaOk,
      canton: "Cartago",
      distrito: "Occidental",
    }) as Record<string, unknown>;
    expect(data).not.toHaveProperty("canton");
    expect(data).not.toHaveProperty("distrito");
  });

  it("R30: conserva la semantica de num_remision/destinatario/telefono/producto/monto_cobrar/notas", () => {
    const data = filaCargaSchema.parse(filaOk);
    expect(data.num_remision).toBe("REM-1");
    // FEATURE 299 — el esperado era `25.9`, el monto crudo de `filaOk` ("25.90"). Ese literal
    // ERA el contrato de la 15 («el monto pasa tal cual») y esta ficha lo cambia a proposito:
    // el desglose de la entrega solo admite enteros, asi que el schema redondea al entrar. Se
    // sustituye por el contrario AFIRMADO, no por lo que salga.
    expect(data.monto_cobrar).toBe(26);
    expect(data.notas).toBe("");

    const vacios = filaCargaSchema.safeParse({ ...filaOk, num_remision: "", producto: "" });
    expect(vacios.success).toBe(false);

    const montoInvalido = filaCargaSchema.safeParse({ ...filaOk, monto_cobrar: "-1" });
    expect(montoInvalido.success).toBe(false);

    expect(filaCargaSchema.parse({ ...filaOk, monto_cobrar: "" }).monto_cobrar).toBeNull();
  });
});

/**
 * FEATURE 299 — LA PUERTA DE ALTA, medida donde vive.
 *
 * Este schema lo comparten las DOS vias de alta (`cargarMasiva` por pantalla y `cargarViaApi`
 * por API key, feature 88), asi que lo que se afirme aqui vale para las dos. El desglose de
 * pago de la entrega solo admite ENTEROS —decision deliberada de `DesglosePagoField`—, de modo
 * que un monto con centimos producia una orden imposible de entregar: 14 hubo que redondearlas
 * a mano en la base el 2026-08-27.
 */
describe("filaCargaSchema — monto redondeado al colon (feature 299)", () => {
  const filaConMonto = (monto: string) => ({
    num_remision: "REM-1",
    destinatario: "Ana",
    telefono: "88887777",
    producto: "Caja",
    provincia: "Cartago",
    canton_distrito: "Cartago (Occidental)",
    direccion: "Frente a X",
    notas: "",
    monto_cobrar: monto,
  });

  it("299: el caso real de la captura — 11898.81 sale como 11899, con el aviso al lado", () => {
    const data = filaCargaSchema.parse(filaConMonto("11898.81"));
    expect(data.monto_cobrar).toBe(11899);
    expect(data.monto_cobrar_ajuste).toEqual({ original: 11898.81, aplicado: 11899 });
  });

  it("299: un entero sale intacto y SIN aviso", () => {
    const data = filaCargaSchema.parse(filaConMonto("11899"));
    expect(data.monto_cobrar).toBe(11899);
    expect(data.monto_cobrar_ajuste).toBeNull();
  });

  it("299: vacio y ausente siguen siendo null, y null no es un ajuste", () => {
    const vacio = filaCargaSchema.parse(filaConMonto(""));
    expect(vacio.monto_cobrar).toBeNull();
    expect(vacio.monto_cobrar_ajuste).toBeNull();

    const sinColumna: Record<string, string> = filaConMonto("x");
    delete sinColumna.monto_cobrar;
    const ausente = filaCargaSchema.parse(sinColumna);
    expect(ausente.monto_cobrar).toBeNull();
    expect(ausente.monto_cobrar_ajuste).toBeNull();
  });

  // Los bordes del redondeo, con su direccion declarada. El medio SUBE: es la misma regla
  // (half away from zero) con la que `formatMontoString` viene pintando el dinero sin
  // centimos desde la feature 230, asi que lo que se guarda es lo que la pantalla ya decia.
  it.each([
    ["0.49", 0],
    ["0.5", 1],
    ["0.51", 1],
    ["11898.4999", 11898],
    ["11898.5", 11899],
    ["11899.5", 11900],
    ["0", 0],
    ["0.0", 0],
  ])("299: %s -> %i", (entrada, esperado) => {
    expect(filaCargaSchema.parse(filaConMonto(entrada)).monto_cobrar).toBe(esperado);
  });

  it("299: lo invalido sigue siendo invalido (el redondeo no ablanda la validacion)", () => {
    expect(filaCargaSchema.safeParse(filaConMonto("abc")).success).toBe(false);
    expect(filaCargaSchema.safeParse(filaConMonto("-0.4")).success).toBe(false);
  });

  it("299/143: el schema sigue sin ser `.strict()` tras ganar el transform", () => {
    // El `.transform` del objeto no endurece nada: la fila re-subida con su columna extra
    // `motivo_error` (feature 143/R16) tiene que seguir pasando.
    const conExtra = { ...filaConMonto("100"), motivo_error: "Fila 7 — telefono: ...", otra: "x" };
    const r = filaCargaSchema.safeParse(conExtra);
    expect(r.success).toBe(true);
    if (r.success) expect("motivo_error" in r.data).toBe(false);
  });
});
