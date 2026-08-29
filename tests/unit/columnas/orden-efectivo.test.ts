// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  clavesVisiblesEnOrden,
  columnasEnOrden,
  guardar,
  leerCrudo,
  moverClave,
  ordenEfectivo,
  sanearPreferencia,
} from "@/lib/columnas/preferencia-columnas";

// ---------------------------------------------------------------------------
// Ficha 314 (T11) — EL NUDO DE LA FICHA: un orden explícito guardado y una columna publicada
// DESPUÉS. Cubre R16, R20, R26, R27, R28, R29, R30, R31 y R35.
//
// La propiedad que estos casos existen para MORDER, y que ninguna otra prueba cubre:
//
//    EL ORDEN GUARDADO NO SUSTITUYE AL CATÁLOGO, LO ENMIENDA.
//
// La feature 194 guarda las columnas OCULTAS y no las visibles precisamente para que una
// columna publicada mañana aparezca sola, sin migrar la preferencia de nadie. Un orden
// explícito reabre la pregunta de DÓNDE cae esa columna. Si el orden guardado fuese
// AUTORITATIVO, lo nuevo caería al final: esta misma ficha publica SIETE columnas de golpe, y
// quien hubiera reordenado antes las recibiría las siete apiladas al final —el teléfono lejos
// del destinatario, los importes lejos del monto— sin haber pedido nada.
//
// R35 GOBIERNA ESTE ARCHIVO: los catálogos son SINTÉTICOS (uno de 3 y uno de 5) y ningún
// aserto afirma un número de columnas. El módulo funciona igual con 3, 13 o 22.
// ---------------------------------------------------------------------------

/** Catálogo sintético de 4 claves: es el del design §3, para poder comparar caso a caso. */
const CATALOGO = ["a", "b", "c", "d"];

/** Catálogo sintético de 3 y de 5: la misma mecánica con otra cardinalidad (R35). */
const CATALOGO_3 = ["uno", "dos", "tres"];
const CATALOGO_5 = ["uno", "dos", "tres", "cuatro", "cinco"];

const CLAVE = "ordenex:descarga-columnas:sintetico";

function crudoCon(preferencia: {
  ocultas?: string[];
  orden?: string[];
}): string {
  return JSON.stringify(preferencia);
}

const descriptorOriginal = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  if (descriptorOriginal) {
    Object.defineProperty(window, "localStorage", descriptorOriginal);
  }
  window.localStorage.clear();
});

describe("orden efectivo — el orden guardado enmienda el catálogo, no lo sustituye", () => {
  it("R16 — sin preferencia devuelve las publicadas en su orden", () => {
    expect(ordenEfectivo(null, CATALOGO)).toEqual(CATALOGO);
    expect(clavesVisiblesEnOrden(null, CATALOGO)).toEqual(CATALOGO);
    // Y con la preferencia escrita pero SIN orden, lo mismo: no es una rama aparte del
    // código, es el caso general con la lista vacía.
    expect(ordenEfectivo(crudoCon({ ocultas: [] }), CATALOGO)).toEqual(CATALOGO);
    expect(ordenEfectivo(crudoCon({ ocultas: [], orden: [] }), CATALOGO)).toEqual(
      CATALOGO,
    );
  });

  it("R20 — con un orden guardado completo, ése es el orden", () => {
    const crudo = crudoCon({ ocultas: [], orden: ["d", "c", "b", "a"] });

    expect(ordenEfectivo(crudo, CATALOGO)).toEqual(["d", "c", "b", "a"]);
    expect(clavesVisiblesEnOrden(crudo, CATALOGO)).toEqual(["d", "c", "b", "a"]);
  });

  it("R27 — una columna nueva se coloca tras su predecesora de catálogo presente en el orden del usuario", () => {
    // El usuario ordenó `d b a`; `c` se publica después. Su predecesora de catálogo presente
    // es `b`, esté donde esté `b` en el orden del usuario.
    const crudo = crudoCon({ ocultas: [], orden: ["d", "b", "a"] });

    expect(ordenEfectivo(crudo, CATALOGO)).toEqual(["d", "b", "c", "a"]);
    // Contraprueba de no-vacuidad: NO cae al final, que es la alternativa descartada.
    expect(ordenEfectivo(crudo, CATALOGO)).not.toEqual(["d", "b", "a", "c"]);
  });

  it("R28 — sin ninguna predecesora presente, la columna nueva va al principio", () => {
    // `a` es la primera del catálogo: no tiene predecesora que pueda estar presente.
    const crudo = crudoCon({ ocultas: [], orden: ["d", "c", "b"] });

    expect(ordenEfectivo(crudo, CATALOGO)).toEqual(["a", "d", "c", "b"]);
  });

  it("R27 + R28 — dos columnas nuevas a la vez caen cada una en su sitio", () => {
    // `a` no tiene predecesora (va al principio); `c` va tras `b`.
    const crudo = crudoCon({ ocultas: [], orden: ["d", "b"] });

    expect(ordenEfectivo(crudo, CATALOGO)).toEqual(["a", "d", "b", "c"]);
  });

  it("R29 — una clave guardada que ya no corresponde a ninguna columna publicada se ignora", () => {
    // `z` se retiró del catálogo. Se ignora al resolver y el resto se comporta igual que si
    // nunca hubiera estado.
    const crudo = crudoCon({ ocultas: ["z"], orden: ["d", "z", "b"] });

    expect(ordenEfectivo(crudo, CATALOGO)).toEqual(["a", "d", "b", "c"]);
    expect(ordenEfectivo(crudo, CATALOGO)).not.toContain("z");
    expect(sanearPreferencia(crudo, CATALOGO).ocultas).toEqual([]);
    expect(clavesVisiblesEnOrden(crudo, CATALOGO)).toEqual(["a", "d", "b", "c"]);
  });

  it("R30 — una preferencia guardada ANTES de esta ficha sigue valiendo: mismas ocultas, orden del catálogo", () => {
    // El literal exacto que la feature 194 dejó escrito en el navegador de la gente. Ni
    // migración, ni versionado, ni código que alguien deba acordarse de borrar.
    const legado = '{"ocultas":["b"]}';

    expect(ordenEfectivo(legado, CATALOGO)).toEqual(CATALOGO);
    expect(clavesVisiblesEnOrden(legado, CATALOGO)).toEqual(["a", "c", "d"]);
    expect(sanearPreferencia(legado, CATALOGO)).toEqual({
      ocultas: ["b"],
      orden: [],
    });
  });

  it("R26 — una clave publicada que no figura en lo guardado sale VISIBLE sin migrar nada", () => {
    // La preferencia se escribió cuando `d` aún no existía: no está en las ocultas de nadie,
    // luego sale. La visibilidad la decide SOLO la lista de exclusión, y por eso una columna
    // no puede "nacer oculta".
    const crudo = crudoCon({ ocultas: ["b"], orden: ["c", "a"] });
    const antes = ["a", "b", "c"];
    const despues = ["a", "b", "c", "d"];

    expect(clavesVisiblesEnOrden(crudo, antes)).not.toContain("d");
    const visiblesDespues = clavesVisiblesEnOrden(crudo, despues);
    expect(visiblesDespues).toContain("d");
    expect(visiblesDespues).not.toContain("b");
    // Y cae junto a su vecina de catálogo (`c`), no al final por ser nueva.
    expect(ordenEfectivo(crudo, despues)).toEqual(["c", "d", "a", "b"]);
    // El almacenamiento no se tocó: cero migración.
    expect(window.localStorage.length).toBe(0);
  });

  it("R27 — dos columnas nuevas CONSECUTIVAS conservan su orden relativo entre sí", () => {
    // Si el ancla no se buscara también entre lo intercalado en la misma pasada, `uno` y `dos`
    // se insertarían las dos en la posición 0 y saldrían INVERTIDAS.
    const crudo = crudoCon({ ocultas: [], orden: ["cinco"] });

    expect(ordenEfectivo(crudo, CATALOGO_5)).toEqual([
      "uno",
      "dos",
      "tres",
      "cuatro",
      "cinco",
    ]);
    expect(ordenEfectivo(crudo, CATALOGO_5).indexOf("uno")).toBeLessThan(
      ordenEfectivo(crudo, CATALOGO_5).indexOf("dos"),
    );
  });

  it("R35 — el mecanismo opera igual con un catálogo de 3 y con uno de 5", () => {
    const crudo = crudoCon({ ocultas: ["dos"], orden: ["tres", "uno"] });

    // Con 3: el orden guardado manda entero.
    expect(ordenEfectivo(crudo, CATALOGO_3)).toEqual(["tres", "uno", "dos"]);
    expect(clavesVisiblesEnOrden(crudo, CATALOGO_3)).toEqual(["tres", "uno"]);

    // Con 5, la MISMA preferencia: `cuatro` y `cinco` son nuevas y caen tras `tres`, su
    // predecesora presente, conservando su orden entre sí.
    expect(ordenEfectivo(crudo, CATALOGO_5)).toEqual([
      "tres",
      "cuatro",
      "cinco",
      "uno",
      "dos",
    ]);
    expect(clavesVisiblesEnOrden(crudo, CATALOGO_5)).toEqual([
      "tres",
      "cuatro",
      "cinco",
      "uno",
    ]);
  });

  it("R20 — la visibilidad y el orden son ejes INDEPENDIENTES", () => {
    // Ocultar no reordena y reordenar no oculta: el archivo es el orden efectivo FILTRADO por
    // las ocultas, en ese mismo orden.
    const crudo = crudoCon({ ocultas: ["b"], orden: ["d", "c", "b", "a"] });

    expect(ordenEfectivo(crudo, CATALOGO)).toEqual(["d", "c", "b", "a"]);
    expect(clavesVisiblesEnOrden(crudo, CATALOGO)).toEqual(["d", "c", "a"]);
  });
});

describe("degradación: nunca se impide la descarga (R31)", () => {
  const MATRIZ: Array<[string, string]> = [
    ["JSON inválido", "{no-es-json"],
    ["el valor no es un objeto", "[1,2]"],
    ["el valor es un número", "42"],
    ["orden no es un array", '{"ocultas":[],"orden":"a,b"}'],
    ["orden con elementos que no son string", '{"ocultas":[],"orden":[1,2]}'],
    ["ocultas no es un array", '{"ocultas":"b"}'],
    ["las dos listas ausentes", '{"otra":["a"]}'],
  ];

  it.each(MATRIZ)("con %s se procede como si no hubiera preferencia", (_caso, crudo) => {
    expect(() => sanearPreferencia(crudo, CATALOGO)).not.toThrow();
    expect(() => ordenEfectivo(crudo, CATALOGO)).not.toThrow();
    expect(ordenEfectivo(crudo, CATALOGO)).toEqual(CATALOGO);
    // Y SIEMPRE queda algo que descargar: la lista visible nunca sale vacía.
    expect(clavesVisiblesEnOrden(crudo, CATALOGO).length).toBeGreaterThan(0);
  });

  it("un orden con claves DUPLICADAS no duplica ninguna columna", () => {
    const crudo = crudoCon({ ocultas: [], orden: ["d", "d", "b"] });

    expect(ordenEfectivo(crudo, CATALOGO)).toEqual(["a", "d", "b", "c"]);
    expect(
      ordenEfectivo(crudo, CATALOGO).filter((clave) => clave === "d"),
    ).toHaveLength(1);
  });

  it("unas `ocultas` que taparían TODAS las publicadas se degradan a ninguna", () => {
    const crudo = crudoCon({ ocultas: [...CATALOGO], orden: ["d", "c"] });

    expect(sanearPreferencia(crudo, CATALOGO).ocultas).toEqual([]);
    // El orden guardado, que sí era legible, NO se tira con ellas: degradación campo a campo.
    // `a` no tiene predecesora (va al principio) y `b` cae tras ella, su predecesora presente.
    expect(ordenEfectivo(crudo, CATALOGO)).toEqual(["a", "b", "d", "c"]);
    expect(clavesVisiblesEnOrden(crudo, CATALOGO)).toEqual(["a", "b", "d", "c"]);
  });

  it("un almacenamiento que LANZA se lee como `null` y se escribe sin romper", () => {
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("SecurityError: acceso denegado al almacenamiento");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
      configurable: true,
    });

    expect(leerCrudo(CLAVE)).toBeNull();
    expect(() =>
      guardar(CLAVE, { ocultas: ["a"], orden: ["b", "a"] }),
    ).not.toThrow();
    expect(clavesVisiblesEnOrden(leerCrudo(CLAVE), CATALOGO)).toEqual(CATALOGO);
  });

  it("sin ámbito (clave `null`) no se lee ni se escribe nada", () => {
    // R33: una tabla que no declara ámbito no toca el almacenamiento de nadie.
    expect(leerCrudo(null)).toBeNull();
    guardar(null, { ocultas: ["a"], orden: ["b"] });
    expect(window.localStorage.length).toBe(0);
  });
});

describe("formato guardado: aditivo y compatible en las DOS direcciones (R30)", () => {
  it("con `orden` vacío se escribe EXACTAMENTE el literal de la feature 194", () => {
    // Esto no es cosmético: `{"ocultas":[]}` es el contrato de almacenamiento que afirma
    // `tests/components/ColumnasManifiestoPopover.test.tsx`, y es lo que hace que una
    // preferencia nueva leída por código VIEJO (un revert de esta ficha) siga valiendo.
    guardar(CLAVE, { ocultas: [], orden: [] });
    expect(window.localStorage.getItem(CLAVE)).toBe('{"ocultas":[]}');

    guardar(CLAVE, { ocultas: ["b"], orden: [] });
    expect(window.localStorage.getItem(CLAVE)).toBe('{"ocultas":["b"]}');
    expect(window.localStorage.getItem(CLAVE)).not.toContain("orden");
  });

  it("con `orden` se añade el campo, con `ocultas` SIEMPRE primero", () => {
    guardar(CLAVE, { ocultas: ["b"], orden: ["d", "a"] });
    expect(window.localStorage.getItem(CLAVE)).toBe(
      '{"ocultas":["b"],"orden":["d","a"]}',
    );

    // Y el código VIEJO, que solo lee `parseado.ocultas`, sigue entendiendo lo suyo.
    const parseado = JSON.parse(window.localStorage.getItem(CLAVE)!);
    expect(parseado.ocultas).toEqual(["b"]);
  });

  it("guardar SOLO toca su clave: dos ámbitos jamás se pisan (R10)", () => {
    guardar("ordenex:descarga-columnas:ordenes", { ocultas: ["a"], orden: [] });
    guardar("ordenex:manifiesto-columnas:carga_masiva", {
      ocultas: ["b"],
      orden: ["b", "a"],
    });

    expect(
      window.localStorage.getItem("ordenex:descarga-columnas:ordenes"),
    ).toBe('{"ocultas":["a"]}');
    expect(
      window.localStorage.getItem("ordenex:manifiesto-columnas:carga_masiva"),
    ).toBe('{"ocultas":["b"],"orden":["b","a"]}');
  });
});

describe("mover una clave dentro del orden (R22, R23, R24)", () => {
  it("mueve un puesto arriba y un puesto abajo", () => {
    expect(moverClave(CATALOGO, "c", "arriba")).toEqual(["a", "c", "b", "d"]);
    expect(moverClave(CATALOGO, "b", "abajo")).toEqual(["a", "c", "b", "d"]);
  });

  it("R22/R23 — en los extremos NO hay movimiento, y se dice que no lo hay", () => {
    expect(moverClave(CATALOGO, "a", "arriba")).toBeNull();
    expect(moverClave(CATALOGO, "d", "abajo")).toBeNull();
    // Una clave que no está en la lista tampoco se mueve.
    expect(moverClave(CATALOGO, "z", "arriba")).toBeNull();
  });

  it("no muta la lista recibida", () => {
    const original = [...CATALOGO];
    moverClave(original, "c", "arriba");
    expect(original).toEqual(CATALOGO);
  });
});

describe("columnasEnOrden — los dos mundos se tocan en un accesor (design §0/D5)", () => {
  interface ColumnaFalsa {
    clave: string;
    encabezado: string;
  }
  const claveDe = (columna: ColumnaFalsa) => columna.clave;
  const PUBLICADAS: ColumnaFalsa[] = [
    { clave: "a", encabezado: "Alfa" },
    { clave: "b", encabezado: "Beta" },
    { clave: "c", encabezado: "Gama" },
  ];

  it("devuelve las columnas en el orden de las claves pedidas", () => {
    expect(
      columnasEnOrden(PUBLICADAS, ["c", "a"], claveDe).map((c) => c.encabezado),
    ).toEqual(["Gama", "Alfa"]);
  });

  it("descarta las claves que no correspondan a ninguna columna publicada", () => {
    expect(
      columnasEnOrden(PUBLICADAS, ["c", "z", "a"], claveDe).map((c) => c.clave),
    ).toEqual(["c", "a"]);
  });
});
