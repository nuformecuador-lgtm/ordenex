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

  // Los cuatro casos de arriba los rechazan DOS redes a la vez —el regex de ancho
  // fijo y el `.refine` del tope, que trata `NaN` como rechazo—, asi que ninguno
  // discrimina cual de las dos funciona. Los tres de abajo si: cada uno pasa una
  // red y solo lo para la otra. Sin ellos, quitar el regex O aflojar el `NaN` deja
  // la suite verde (medido: 3 mutantes supervivientes en el review de la 135).

  it("rechaza la fecha que pasa el regex pero NO existe en el calendario, en hasta", () => {
    // `"2026-13-45"` tiene la forma \d{4}-\d{2}-\d{2}, asi que el regex la deja
    // pasar; `Date.parse` da NaN. Va en `hasta` porque el mes 13 es
    // lexicograficamente MAYOR que cualquier mes real, y con la fecha invalida en
    // `desde` la cortaria antes el refine (3).
    //
    // OJO, cambio de red: cuando se escribio este caso lo paraba el `Number.isFinite`
    // del cuarto refine, y por eso decia discriminar ESA red. Ya no: desde el arreglo
    // del dia rodado lo para antes el `.refine` de `fechaCalendario`, en el campo. El
    // caso sigue afirmando lo correcto —esta fecha se rechaza— pero ya no discrimina
    // el `NaN` del tope, que hoy es defensa en profundidad inalcanzable desde aqui.
    const res = analiticaFiltroSchema.safeParse({
      rango: "personalizado",
      desde: "2026-07-01",
      hasta: "2026-13-45",
    });
    expect(res.success).toBe(false);
  });

  it("rechaza el par de fechas inexistentes en desde y hasta a la vez", () => {
    // Mismo caso por el lado de `desde`: el par es lexicograficamente valido (son
    // iguales) y pasa el refine (3). Misma nota sobre la red que lo para hoy.
    const res = analiticaFiltroSchema.safeParse({
      rango: "personalizado",
      desde: "2026-13-45",
      hasta: "2026-13-45",
    });
    expect(res.success).toBe(false);
  });

  // El DIA rodado es otra cosa que el mes 13, y era el hueco de verdad. `"2026-13-45"`
  // da `NaN` y lo paraba el tope; `"2026-02-31"` NO da `Invalid Date`: en V8 el dia
  // desbordado RUEDA al 3 de marzo (solo el MES fuera de rango invalida). Pasaba el
  // regex, pasaba el refine (3) —el orden lexicografico es correcto— y pasaba el tope
  // —la ventana medida es real y pequena—, asi que la analitica respondia por un rango
  // DESPLAZADO respecto del que el usuario pidio, sin un solo error.
  it("V8 rueda el dia desbordado en vez de invalidarlo (el porque del caso de abajo)", () => {
    expect(new Date("2026-02-31T00:00:00.000Z").toISOString().slice(0, 10)).toBe("2026-03-03");
    expect(Number.isNaN(Date.parse("2026-13-45T00:00:00.000Z"))).toBe(true);
  });

  // Cada par se elige ESTRECHO a proposito: la fecha rodada deja una ventana de pocos
  // dias, muy por debajo de `RANGO_TOPE_DIAS`, y en orden lexicografico correcto. Asi el
  // unico motivo de rechazo posible es la existencia de la fecha. Con una ventana ancha
  // (p. ej. `hasta: "2027-06-05"`) lo cortaria el tope y el caso pasaria en verde por el
  // motivo equivocado.
  it.each([
    ["2026-02-31", "2026-03-05"], // rueda al 3 de marzo: ventana de 3 dias
    ["2026-04-31", "2026-05-05"], // rueda al 1 de mayo: ventana de 5 dias
    ["2027-02-29", "2027-03-05"], // rueda al 1 de marzo: ventana de 5 dias
  ])("rechaza %s en desde, con una ventana que el tope NO habria parado", (desde, hasta) => {
    const res = analiticaFiltroSchema.safeParse({ rango: "personalizado", desde, hasta });
    expect(res.success).toBe(false);
  });

  it.each([
    ["2026-01-05", "2026-02-31"],
    ["2026-01-05", "2026-04-31"],
    ["2027-01-05", "2027-02-29"],
  ])("rechaza %s..%s: la fecha inexistente esta en hasta", (desde, hasta) => {
    const res = analiticaFiltroSchema.safeParse({ rango: "personalizado", desde, hasta });
    expect(res.success).toBe(false);
  });

  it("acepta el 29 de febrero de un ano BISIESTO (el contrapeso: no se rechaza por la fecha)", () => {
    const res = analiticaFiltroSchema.safeParse({
      rango: "personalizado",
      desde: "2028-02-29",
      hasta: "2028-03-05",
    });
    expect(res.success).toBe(true);
  });

  it("rechaza el ano expandido +002026-07-15 (lo para el regex, NO el tope)", () => {
    // Este es el reves del anterior y el unico caso que discrimina el regex por si
    // solo: `Date.parse("+002026-07-15T00:00:00.000Z")` es VALIDO (ano expandido de
    // ISO 8601, verificado en node) y la ventana resultante cabe de sobra en el
    // tope, asi que sin el patron de ancho fijo el filtro lo aceptaria. R22 exige
    // fecha calendario de ancho fijo, y esta no lo es.
    const res = analiticaFiltroSchema.safeParse({ ...base, desde: "+002026-07-15" });
    expect(res.success).toBe(false);
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
