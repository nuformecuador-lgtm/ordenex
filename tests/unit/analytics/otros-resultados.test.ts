// FICHA 347 (F1, entrega B) — la COMPOSICION de «Otros resultados».
//
// Cubre R50, R51, R52, R53, R54, R55 y R56.
//
// Lo unico que aqui puede equivocarse, y por eso el archivo esta organizado asi:
//
//   1. QUE entra y QUE no (R53): los dos desenlaces con columna propia fuera, los status sin
//      desenlace fuera, los ceros fuera.
//   2. QUE SUMA (R50): la composicion de una fila suma EXACTAMENTE su cubo `otrosDesenlaces`,
//      que es la cifra que la pantalla pinta encima. Se compara contra `calcularEfectividad`,
//      que es OTRA funcion —no contra la propia—: si las dos derivaran de listas distintas, la
//      segunda linea de la celda contradiria al numero de arriba y nadie lo veria.
//   3. QUE SE DERIVA (R51/R52): el caso del SEXTO DESENLACE INYECTADO. Una lista escrita a mano
//      (`["devuelta","reprogramada","incidente"]`) pasa TODOS los demas casos de este archivo y
//      cae SOLO en ese. Es lo unico que distingue derivar de escribir, y es la mutacion M8.
//   4. QUE NO DEPENDE DEL ENTORNO (R56): el orden y el texto son deterministas, sin
//      `localeCompare` y sin `Intl`.
//
// Modulo PURO: no monta nada.
import { describe, it, expect, vi, afterEach } from "vitest";

import { calcularEfectividad } from "@/app/(app)/analitica/_components/entregas/efectividad";
import { etiquetaDeDesenlace } from "@/app/(app)/analitica/_components/entregas/etiqueta-desenlace";
import {
  composicionOtrosResultados,
  textoComposicionOtrosResultados,
} from "@/app/(app)/analitica/_components/entregas/otros-resultados";
import { DESENLACES } from "@/lib/types/conteo-entregas";

/** DOS status que NO son desenlaces: la orden sigue su curso. */
const EN_CURSO = ["en_reparto", "en_preparacion"] as const;

/** Los dos desenlaces que YA tienen columna propia en la tabla de productos. */
const CON_COLUMNA = ["entregada", "rechazada"] as const;

/** Un desglose con `conteo` órdenes en cada uno de los `status` dados. */
function desglose(pares: readonly (readonly [string, number])[]) {
  return pares.map(([status, conteo]) => ({ status, conteo }));
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/types/conteo-entregas");
});

/* ========================================================================== */
/* 1 — qué entra y qué no                                                     */
/* ========================================================================== */

describe("FICHA 347 · la composición dice DE QUÉ se compone «Otros resultados» (R50/R53)", () => {
  it("la captura de la 346 se compone de sus dos desenlaces, con su cantidad", () => {
    // `Crema Especial MLX`, el caso que abrió la ficha 346: 24 órdenes, 3 entregadas, 2
    // rechazadas, 13 en proceso y SEIS que no aparecían en ninguna columna. Esas seis son
    // exactamente lo que esta composición nombra.
    const r = composicionOtrosResultados(
      desglose([
        ["entregada", 3],
        ["rechazada", 2],
        ["devuelta", 4],
        ["reprogramada", 2],
        [EN_CURSO[0], 13],
      ]),
    );

    expect(r).toEqual([
      { status: "devuelta", conteo: 4 },
      { status: "reprogramada", conteo: 2 },
    ]);
  });

  it("R53 — los dos desenlaces con COLUMNA PROPIA no entran en la composición", () => {
    // Si entraran, la fila diría dos veces lo mismo: la columna «Entregadas» arriba y
    // «8 entregadas» debajo del cubo que, por definición, no las incluye.
    const r = composicionOtrosResultados(
      desglose([
        ["entregada", 8],
        ["rechazada", 6],
        ["incidente", 1],
      ]),
    );

    expect(r.map((t) => t.status)).toEqual(["incidente"]);
    for (const conColumna of CON_COLUMNA) {
      expect(r.map((t) => t.status)).not.toContain(conColumna);
    }
  });

  it("R53 — los status SIN desenlace tampoco: ésos son «En proceso», no un resultado", () => {
    const r = composicionOtrosResultados(
      desglose([
        [EN_CURSO[0], 9],
        [EN_CURSO[1], 4],
        ["devuelta", 1],
      ]),
    );

    expect(r).toEqual([{ status: "devuelta", conteo: 1 }]);
  });

  it("un conteo en CERO no se nombra: «0 devueltas» no es composición, es ruido", () => {
    const r = composicionOtrosResultados(
      desglose([
        ["devuelta", 0],
        ["reprogramada", 3],
      ]),
    );

    expect(r).toEqual([{ status: "reprogramada", conteo: 3 }]);
  });

  it("R54 — sin ningún otro resultado, la composición está VACÍA y el texto también", () => {
    const porStatus = desglose([
      ["entregada", 8],
      ["rechazada", 6],
      [EN_CURSO[0], 2],
    ]);

    expect(composicionOtrosResultados(porStatus)).toEqual([]);
    // La cadena vacía es lo que la pantalla usa para NO pintar nada y lo que deja la celda del
    // archivo vacía. Un «ninguno» sería una afirmación sobre una fila que no tiene nada que
    // afirmar.
    expect(textoComposicionOtrosResultados(porStatus)).toBe("");
  });

  it("un desglose vacío no revienta y no compone nada", () => {
    expect(composicionOtrosResultados([])).toEqual([]);
    expect(textoComposicionOtrosResultados([])).toBe("");
  });
});

/* ========================================================================== */
/* 2 — la composición SUMA el cubo que la pantalla pinta encima               */
/* ========================================================================== */

describe("FICHA 347 · la composición cuadra con el cubo «Otros resultados» (R50)", () => {
  /**
   * ⚠ SE COMPARA CONTRA `calcularEfectividad`, QUE ES OTRA FUNCIÓN, y ése es todo el punto:
   * son dos derivaciones independientes de la misma regla («está en `DESENLACES` y no es
   * ninguno de los dos con columna propia»). Si una de las dos se escribiera a mano y la otra
   * no, la segunda línea de la celda contradiría al número de arriba en la misma celda — y
   * nadie tendría forma de saber cuál de los dos miente.
   *
   * Comparar la composición contra sí misma sería la aserción-contra-su-propia-fuente que este
   * repo ya midió, y estaría siempre verde.
   */
  it.each(DESENLACES.map((d) => [d] as const))(
    "con el desenlace `%s` la suma de la composición es el cubo `otrosDesenlaces`",
    (desenlace) => {
      const porStatus = desglose([
        ["entregada", 3],
        ["rechazada", 2],
        [desenlace, 7],
        [EN_CURSO[0], 5],
      ]);

      const suma = composicionOtrosResultados(porStatus).reduce((n, t) => n + t.conteo, 0);
      expect(suma).toBe(calcularEfectividad(porStatus).otrosDesenlaces);
    },
  );

  it("y también con TODOS los desenlaces del catálogo a la vez", () => {
    const porStatus = desglose([
      ...DESENLACES.map((d, i) => [d, i + 1] as const),
      [EN_CURSO[0], 4],
    ]);

    const suma = composicionOtrosResultados(porStatus).reduce((n, t) => n + t.conteo, 0);
    expect(suma).toBe(calcularEfectividad(porStatus).otrosDesenlaces);
    // Y no está vacía: un cuadre entre ceros es cierto y no dice nada.
    expect(suma).toBeGreaterThan(0);
  });
});

/* ========================================================================== */
/* 3 — se DERIVA del catálogo: el sexto desenlace inyectado (M8)              */
/* ========================================================================== */

describe("FICHA 347 · un desenlace NUEVO del catálogo entra solo (R51/R52)", () => {
  it("un SEXTO desenlace aparece en la composición sin tocar la pantalla", async () => {
    // ⚠ ÉSTE ES EL CASO QUE MATA LA MUTACIÓN M8. Con
    // `["devuelta","reprogramada","incidente"]` escrito a mano en `otros-resultados.ts`, TODOS
    // los demás casos de este archivo siguen verdes y sólo cae éste. Es el escenario que ya
    // ocurrió tres veces en este repo (features 135, 153 y 154) y el defecto exacto que la
    // ficha 346 acaba de reparar: un estado que se evapora en silencio.
    const SEXTO = "custodiada_en_puerto";

    vi.resetModules();
    vi.doMock("@/lib/types/conteo-entregas", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/types/conteo-entregas")>();
      return { ...actual, DESENLACES: [...actual.DESENLACES, SEXTO] };
    });

    const modulo = await import("@/app/(app)/analitica/_components/entregas/otros-resultados");
    const porStatus = desglose([
      ["entregada", 3],
      [SEXTO, 5],
      [EN_CURSO[0], 2],
    ]);

    expect(modulo.composicionOtrosResultados(porStatus)).toEqual([
      { status: SEXTO, conteo: 5 },
    ]);
    expect(modulo.textoComposicionOtrosResultados(porStatus)).toBe("5 custodiada_en_puertos");
  });

  it("y sin tocar el catálogo ese mismo status es trabajo VIVO, no un resultado", () => {
    // La contraparte, para que el caso anterior no se lea como que cualquier cosa entra: un
    // status que el catálogo no nombra está en proceso, y «En proceso» no se compone.
    const porStatus = desglose([
      ["entregada", 3],
      ["custodiada_en_puerto", 5],
      [EN_CURSO[0], 2],
    ]);

    expect(composicionOtrosResultados(porStatus)).toEqual([]);
    expect(calcularEfectividad(porStatus).enProceso).toBe(7);
  });
});

/* ========================================================================== */
/* 4 — el texto, las etiquetas y el determinismo                              */
/* ========================================================================== */

describe("FICHA 347 · el texto de la composición (R55/R56)", () => {
  it("R55 — nombra cada desenlace con su etiqueta legible, NUNCA con el value crudo", () => {
    const texto = textoComposicionOtrosResultados(
      desglose([
        ["devuelta", 3],
        ["reprogramada", 2],
      ]),
    );

    expect(texto).toBe("3 devueltas · 2 reprogramadas");
    // Y las etiquetas salen del MECANISMO QUE YA EXISTE, no de una tabla escrita en la ficha:
    // `etiquetaDeDesenlace` pluraliza y capitaliza el value del catálogo.
    expect(texto).toContain(etiquetaDeDesenlace("devuelta").toLowerCase());
    expect(texto).toContain(etiquetaDeDesenlace("reprogramada").toLowerCase());
  });

  it("R56 — el orden es conteo DESCENDENTE y, a igualdad, `status` ascendente", () => {
    const r = composicionOtrosResultados(
      desglose([
        ["reprogramada", 2],
        ["incidente", 9],
        ["devuelta", 2],
      ]),
    );

    // 9 primero; entre los dos empatados a 2, `devuelta` antes que `reprogramada`.
    expect(r.map((t) => t.status)).toEqual(["incidente", "devuelta", "reprogramada"]);
  });

  it("R56 — la MISMA fila produce siempre el MISMO texto, venga como venga el desglose", () => {
    // El orden de llegada de `porStatus` no es contrato, así que el texto no puede depender de
    // él: dos usuarios con la misma fila tienen que leer lo mismo, y sobre todo el archivo
    // descargable tiene que ser el mismo byte a byte.
    const pares: readonly (readonly [string, number])[] = [
      ["devuelta", 4],
      ["incidente", 4],
      ["reprogramada", 7],
    ];
    const directo = textoComposicionOtrosResultados(desglose(pares));
    const alReves = textoComposicionOtrosResultados(desglose([...pares].reverse()));

    expect(alReves).toBe(directo);
    expect(directo).toBe("7 reprogramadas · 4 devueltas · 4 incidentes");
  });

  it("el número va CRUDO, sin separador de miles: el texto viaja al archivo", () => {
    // `Intl` pondría «1.234» con el locale del repo y «1,234» con otro. Un archivo que dice
    // cosas distintas según la máquina que lo generó es peor que uno feo.
    expect(textoComposicionOtrosResultados(desglose([["devuelta", 1234]]))).toBe(
      "1234 devueltas",
    );
  });

  it("la etiqueta se puede INYECTAR, y el cálculo no cambia", () => {
    // El módulo es puro y no depende de nada de UI: quien quiera otro idioma pasa su función.
    const texto = textoComposicionOtrosResultados(desglose([["devuelta", 3]]), () => "RETURNED");
    expect(texto).toBe("3 returned");
  });
});
