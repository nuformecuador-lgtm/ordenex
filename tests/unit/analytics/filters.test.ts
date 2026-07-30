import { describe, it, expect } from "vitest";
import {
  analiticaFiltroSchema,
  parseAnaliticaFiltro,
  CLAVE_ERROR_GENERAL,
} from "@/lib/analytics/filters";
import { RANGO_PRESETS, RANGO_TOPE_DIAS } from "@/lib/analytics/types";

// Feature 135 (T5.2) — filtros de analitica. Siete grupos: R19, R20, R21, R22,
// R23, R24 y R29. Ninguna asercion depende del reloj: el schema solo valida
// forma; los bordes temporales los calcula `ranges.ts` server-side.

/** Filtro minimo valido: `rango` es el UNICO campo obligatorio (R20). */
const valido = { rango: "dia" } as const;

/** Atajo: los `fieldErrors` de una entrada que DEBE fallar. */
function erroresDe(raw: unknown): Record<string, string[]> {
  const res = parseAnaliticaFiltro(raw);
  expect(res.status).toBe("validation_error");
  if (res.status !== "validation_error") throw new Error("inalcanzable");
  return res.fieldErrors;
}

describe("R19 — borde cerrado: el schema rechaza claves desconocidas", () => {
  it("rechaza una clave desconocida junto a un filtro por lo demas valido", () => {
    const res = analiticaFiltroSchema.safeParse({ ...valido, foo: 1 });
    expect(res.success).toBe(false);
    const codigos = res.success ? [] : res.error.issues.map((i) => i.code);
    expect(codigos).toContain("unrecognized_keys");
  });

  it("acepta el filtro sin la clave desconocida (la unica diferencia es esa clave)", () => {
    expect(analiticaFiltroSchema.safeParse(valido).success).toBe(true);
  });

  it("reporta la clave desconocida bajo su propio nombre en fieldErrors", () => {
    expect(Object.keys(erroresDe({ ...valido, foo: 1 }))).toContain("foo");
  });
});

describe("R20 — rango obligatorio y de dominio cerrado", () => {
  it("rechaza el filtro sin rango", () => {
    expect(analiticaFiltroSchema.safeParse({}).success).toBe(false);
    expect(Object.keys(erroresDe({}))).toContain("rango");
  });

  it("rechaza el preset trimestre", () => {
    expect(analiticaFiltroSchema.safeParse({ rango: "trimestre" }).success).toBe(false);
    expect(Object.keys(erroresDe({ rango: "trimestre" }))).toContain("rango");
  });

  it("acepta dia, semana y mes sin fechas", () => {
    for (const rango of ["dia", "semana", "mes"] as const) {
      const res = analiticaFiltroSchema.safeParse({ rango });
      expect(res.success, rango).toBe(true);
    }
  });

  it("acepta personalizado con su par de fechas", () => {
    const res = analiticaFiltroSchema.safeParse({
      rango: "personalizado",
      desde: "2026-07-01",
      hasta: "2026-07-15",
    });
    expect(res.success).toBe(true);
  });

  it("cubre exactamente los cuatro valores de RANGO_PRESETS", () => {
    expect(RANGO_PRESETS).toEqual(["dia", "semana", "mes", "personalizado"]);
  });
});

describe("R21 — filtros dimensionales: listas no vacias de ids no vacios", () => {
  const dimensiones = ["zona_id", "tienda_id", "mensajero_id"] as const;

  it("rechaza el escalar en zona_id, tienda_id y mensajero_id", () => {
    for (const campo of dimensiones) {
      const res = analiticaFiltroSchema.safeParse({ ...valido, [campo]: "z1" });
      expect(res.success, campo).toBe(false);
    }
  });

  it("rechaza la lista vacia de zona_id", () => {
    const res = analiticaFiltroSchema.safeParse({ ...valido, zona_id: [] });
    expect(res.success).toBe(false);
    expect(Object.keys(erroresDe({ ...valido, zona_id: [] }))).toContain("zona_id");
  });

  it("rechaza la lista con un id vacio", () => {
    const res = analiticaFiltroSchema.safeParse({ ...valido, zona_id: [""] });
    expect(res.success).toBe(false);
    expect(Object.keys(erroresDe({ ...valido, zona_id: [""] }))).toContain("zona_id.0");
  });

  it("acepta la lista de dos ids en las tres dimensiones", () => {
    const res = analiticaFiltroSchema.safeParse({
      ...valido,
      zona_id: ["z1", "z2"],
      tienda_id: ["t1", "t2"],
      mensajero_id: ["m1", "m2"],
    });
    expect(res.success).toBe(true);
  });

  it("acepta la ausencia de las tres dimensiones (son opcionales)", () => {
    const res = analiticaFiltroSchema.safeParse(valido);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.zona_id).toBeUndefined();
    expect(res.data.tienda_id).toBeUndefined();
    expect(res.data.mensajero_id).toBeUndefined();
  });
});

describe("R22 — el cliente no manda instantes, epochs ni offsets", () => {
  const base = { rango: "personalizado", hasta: "2026-07-20" } as const;

  it("rechaza el instante ISO con hora en desde", () => {
    expect(
      analiticaFiltroSchema.safeParse({ ...base, desde: "2026-07-15T10:00:00Z" }).success,
    ).toBe(false);
  });

  it("rechaza el epoch numerico en desde", () => {
    expect(analiticaFiltroSchema.safeParse({ ...base, desde: 1752537600000 }).success).toBe(
      false,
    );
  });

  it("rechaza el instante con offset de huso en desde", () => {
    expect(
      analiticaFiltroSchema.safeParse({ ...base, desde: "2026-07-15T00:00:00-06:00" }).success,
    ).toBe(false);
  });

  it("rechaza la fecha sin relleno de ceros 2026-7-5 (el regex es de ancho fijo)", () => {
    expect(analiticaFiltroSchema.safeParse({ ...base, desde: "2026-7-5" }).success).toBe(false);
  });

  it("rechaza los mismos formatos en hasta", () => {
    for (const hasta of [
      "2026-07-15T10:00:00Z",
      1752537600000,
      "2026-07-15T00:00:00-06:00",
      "2026-7-5",
    ]) {
      const res = analiticaFiltroSchema.safeParse({
        rango: "personalizado",
        desde: "2026-07-01",
        hasta,
      });
      expect(res.success, String(hasta)).toBe(false);
    }
  });

  it("acepta la fecha calendario YYYY-MM-DD", () => {
    expect(
      analiticaFiltroSchema.safeParse({ ...base, desde: "2026-07-15" }).success,
    ).toBe(true);
  });
});

describe("R23 — resultado de validacion tipado, sin excepciones", () => {
  it("devuelve status ok con el filtro parseado cuando la entrada es valida", () => {
    const res = parseAnaliticaFiltro({ rango: "semana", zona_id: ["z1"] });
    expect(res).toEqual({ status: "ok", filtro: { rango: "semana", zona_id: ["z1"] } });
  });

  it("mapea el error a fieldErrors con la clave del campo culpable", () => {
    const errores = erroresDe({ ...valido, zona_id: [] });
    expect(Object.keys(errores)).toEqual(["zona_id"]);
    expect(errores.zona_id.length).toBeGreaterThan(0);
    expect(typeof errores.zona_id[0]).toBe("string");
  });

  it("no lanza ante una entrada absurda, ni null, ni undefined", () => {
    for (const raw of [null, undefined, 42, "texto", [], { rango: {} }]) {
      expect(() => parseAnaliticaFiltro(raw)).not.toThrow();
      expect(parseAnaliticaFiltro(raw).status).toBe("validation_error");
    }
  });

  it("agrupa bajo la clave general el error que no pertenece a ningun campo", () => {
    const errores = erroresDe(42);
    expect(Object.keys(errores)).toEqual([CLAVE_ERROR_GENERAL]);
  });
});

describe("R24 — el filtro no es autorizacion: ni rol ni sesion", () => {
  it("rechaza el campo rol", () => {
    const res = analiticaFiltroSchema.safeParse({ ...valido, rol: "maestro" });
    expect(res.success).toBe(false);
    expect(Object.keys(erroresDe({ ...valido, rol: "maestro" }))).toContain("rol");
  });

  it("rechaza el campo usuario_id", () => {
    const res = analiticaFiltroSchema.safeParse({ ...valido, usuario_id: "u1" });
    expect(res.success).toBe(false);
    expect(Object.keys(erroresDe({ ...valido, usuario_id: "u1" }))).toContain("usuario_id");
  });

  it("no declara ninguna clave de rol, sesion ni alcance en su forma", () => {
    const claves = Object.keys(analiticaFiltroSchema.parse(valido));
    expect(claves).not.toContain("rol");
    expect(claves).not.toContain("usuario_id");
    expect(claves).not.toContain("alcance");
  });
});

describe("R29 — rango arbitrario: obligatoriedad, orden y tope", () => {
  it("exige desde y hasta cuando el rango es personalizado", () => {
    expect(Object.keys(erroresDe({ rango: "personalizado" }))).toContain("desde");
    expect(
      Object.keys(erroresDe({ rango: "personalizado", desde: "2026-07-01" })),
    ).toContain("desde");
    expect(
      Object.keys(erroresDe({ rango: "personalizado", hasta: "2026-07-01" })),
    ).toContain("desde");
  });

  it("rechaza el rango invertido", () => {
    const errores = erroresDe({
      rango: "personalizado",
      desde: "2026-07-20",
      hasta: "2026-07-01",
    });
    expect(Object.keys(errores)).toContain("hasta");
  });

  it("acepta la ventana de un solo dia (desde igual a hasta)", () => {
    const res = parseAnaliticaFiltro({
      rango: "personalizado",
      desde: "2026-07-15",
      hasta: "2026-07-15",
    });
    expect(res.status).toBe("ok");
  });

  it("acepta la ventana de 366 dias contando ambos extremos", () => {
    // 2026-01-01 .. 2027-01-01 = 365 dias de 2026 + el 1 de enero de 2027 = 366.
    const res = parseAnaliticaFiltro({
      rango: "personalizado",
      desde: "2026-01-01",
      hasta: "2027-01-01",
    });
    expect(res.status).toBe("ok");
  });

  it("rechaza la ventana de 367 dias contando ambos extremos", () => {
    const errores = erroresDe({
      rango: "personalizado",
      desde: "2026-01-01",
      hasta: "2027-01-02",
    });
    expect(Object.keys(errores)).toContain("hasta");
  });

  it("toma el tope de la constante RANGO_TOPE_DIAS, no de un literal", () => {
    expect(RANGO_TOPE_DIAS).toBe(366);
    expect(erroresDe({
      rango: "personalizado",
      desde: "2026-01-01",
      hasta: "2027-01-02",
    }).hasta.join(" ")).toContain(String(RANGO_TOPE_DIAS));
  });

  it("rechaza desde junto a un preset", () => {
    for (const rango of ["dia", "semana", "mes"] as const) {
      const errores = erroresDe({ rango, desde: "2026-07-01" });
      expect(Object.keys(errores), rango).toContain("desde");
    }
  });

  it("rechaza hasta junto a un preset", () => {
    for (const rango of ["dia", "semana", "mes"] as const) {
      const errores = erroresDe({ rango, hasta: "2026-07-01" });
      expect(Object.keys(errores), rango).toContain("desde");
    }
  });

  it("rechaza todos los casos como validation_error, nunca como excepcion", () => {
    const casos = [
      { rango: "personalizado" },
      { rango: "personalizado", desde: "2026-07-20", hasta: "2026-07-01" },
      { rango: "personalizado", desde: "2026-01-01", hasta: "2027-01-02" },
      { rango: "dia", desde: "2026-07-01" },
    ];
    for (const caso of casos) {
      expect(() => parseAnaliticaFiltro(caso)).not.toThrow();
      const res = parseAnaliticaFiltro(caso);
      expect(res.status).toBe("validation_error");
      if (res.status !== "validation_error") continue;
      expect(Object.keys(res.fieldErrors).length).toBeGreaterThan(0);
    }
  });
});
