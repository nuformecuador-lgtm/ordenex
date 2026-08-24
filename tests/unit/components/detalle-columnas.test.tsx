// @vitest-environment jsdom
//
// FEATURE 260 (F2/F5) — LAS COLUMNAS DEL DETALLE DEL TABLERO DEL DIA.
// Mapea: R14, R15, R16, R17, R20, R22, R23, R24, R25, R26, R27, R45.
//
// ─── POR QUE ESTE ARCHIVO ES `.tsx` Y NO `.ts` ─────────────────────────────────────────────
// `tasks.md` lo nombra `detalle-columnas.test.ts`. La mitad F5 —«ninguna celda pinta `₡0` ni
// «—» en lugar de un dato retirado»— solo se puede afirmar RENDERIZANDO, y renderizar la tabla
// pide JSX. Es la unica desviacion, y es de extension: vitest recoge las dos.
//
// ─── LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO ───────────────────────────────────────────────
// El conjunto esperado se CALCULA desde `ordenesColumns` dentro del propio test; NUNCA se
// escribe una lista literal de ids. Una lista literal seria la asercion-contra-su-propia-fuente
// que este repo ya pago: pasaria a ser un peaje que hay que actualizar cada vez que `/ordenes`
// cambie, y el dia que alguien la actualizara «para que pase» dejaria de comprobar R26.
//
// La UNICA lista literal de este archivo son los cinco ids de R23, y esa si es el contrato: es
// la decision que el humano firmo el 2026-08-21, escrita por identificador. Si se derivara de
// `PRIMERAS` seria circular —el modulo comprobandose contra su propia declaracion— y no diria
// nada.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  COLUMNAS_SOLO_ALCANCE_GLOBAL,
  COLUMNA_RESULTADO_ID,
  COLUMNA_RESULTADO_LABEL,
  PRIMERAS,
  columnasDetalle,
} from "@/app/(app)/monitoreo/_components/detalle-columnas";
import { ordenesColumns } from "@/app/(app)/ordenes/_components/ordenes-columns";
import { DataTable } from "@/components/shared/DataTable";
import { formatMonto } from "@/lib/config/moneda";
import { recortarPorAlcance, type AlcanceTableroDia } from "@/lib/types/tablero-dia";
import { CENTINELAS, ordenDelDetalle } from "@/tests/fixtures/orden-detalle-dia";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

afterEach(() => {
  cleanup();
});

const ALCANCES: readonly AlcanceTableroDia[] = ["global", "zona"];

/** El marcador de «relacion opcional que no resolvio» del repo. No es un cero. */
const SIN_DATO = "—";

/** Los ids que el detalle DEBERIA montar, calculados desde el modulo del listado. */
function idsEsperados(alcance: AlcanceTableroDia): string[] {
  const delListado = ordenesColumns.map((columna) => columna.id);
  const conLaPropia = [...delListado, COLUMNA_RESULTADO_ID];
  return alcance === "global"
    ? conLaPropia
    : conLaPropia.filter((id) => !COLUMNAS_SOLO_ALCANCE_GLOBAL.includes(id));
}

function idsMontados(alcance: AlcanceTableroDia): string[] {
  return columnasDetalle(alcance).map((columna) => columna.id);
}

/** La tabla del detalle, renderizada con una fila. Devuelve sus cabeceras y sus celdas. */
function pintar(alcance: AlcanceTableroDia, fila = ordenDelDetalle({ id: "o1" })) {
  render(
    <DataTable
      columns={columnasDetalle(alcance)}
      data={[fila]}
      rowKey="id"
      ariaLabel="Órdenes del día"
    />,
  );
  const tabla = screen.getByRole("table");
  return {
    cabeceras: within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim() ?? ""),
    celdas: [...tabla.querySelectorAll("tbody td")].map((td) => td.textContent?.trim() ?? ""),
    tabla,
  };
}

/* -------------------------------------------------------------------------- */
/* R20 / R26 — el conjunto se DERIVA del listado, no se enumera                */
/* -------------------------------------------------------------------------- */

describe("columnasDetalle — monta las del listado, derivadas (R20/R26)", () => {
  it("el censo NO es vacio: el modulo del listado trae de verdad sus columnas", () => {
    // Sin esto, todas las comparaciones de abajo podrian ser verdes por vacio.
    expect(ordenesColumns.length).toBeGreaterThan(15);
    expect(new Set(ordenesColumns.map((c) => c.id)).size).toBe(ordenesColumns.length);
  });

  it.each(ALCANCES)(
    "alcance `%s`: los ids montados son EXACTAMENTE los calculados desde `ordenesColumns`",
    (alcance) => {
      expect([...idsMontados(alcance)].sort()).toEqual([...idsEsperados(alcance)].sort());
    },
  );

  it.each(ALCANCES)("alcance `%s`: no monta ninguna columna dos veces", (alcance) => {
    const ids = idsMontados(alcance);
    expect(new Set(ids).size, `hay ids repetidos en ${ids.join(", ")}`).toBe(ids.length);
  });

  it("R22 — añade UNA columna propia y solo una", () => {
    const delListado = new Set(ordenesColumns.map((c) => c.id));
    const propias = idsMontados("global").filter((id) => !delListado.has(id));
    expect(propias).toEqual([COLUMNA_RESULTADO_ID]);
  });
});

/* -------------------------------------------------------------------------- */
/* R45 — «Liberada el» se queda fuera                                          */
/* -------------------------------------------------------------------------- */

describe("columnasDetalle — «Liberada el» no entra (R45)", () => {
  it.each(ALCANCES)("alcance `%s`: no monta la columna de la variante reprogramada", (alcance) => {
    // El id se toma de la propia variante del listado: si alla se renombrara, aqui se buscaria
    // el nombre nuevo en vez de quedar mirando a un id que ya no existe.
    expect(idsMontados(alcance)).not.toContain("liberada");
  });

  it("la clausula NO es vacia: la variante del listado SI la trae", async () => {
    const { ordenesColumnsReprogramada } = await import(
      "@/app/(app)/ordenes/_components/ordenes-columns"
    );
    const propias = ordenesColumnsReprogramada
      .map((c) => c.id)
      .filter((id) => !ordenesColumns.some((c) => c.id === id));
    expect(propias, "la variante `reprogramada` ya no añade ninguna columna").toEqual(["liberada"]);
  });
});

/* -------------------------------------------------------------------------- */
/* R23 / R24 / R25 — las cinco primeras, y que sus ids EXISTAN                 */
/* -------------------------------------------------------------------------- */

describe("columnasDetalle — el orden de las cinco primeras (R23/R25)", () => {
  it.each(ALCANCES)("alcance `%s`: van delante y en el orden que el humano firmo", (alcance) => {
    // Literal a proposito: ESTA es la decision de la puerta humana del 2026-08-21, escrita por
    // identificador. Derivarla de `PRIMERAS` seria comprobar el modulo contra su propia
    // declaracion, que siempre esta verde.
    expect(idsMontados(alcance).slice(0, 5)).toEqual([
      "numGuia",
      "estatus",
      COLUMNA_RESULTADO_ID,
      "destinatario",
      "direccion",
    ]);
  });

  it.each(ALCANCES)("alcance `%s`: cada id declarado en `PRIMERAS` existe de verdad", (alcance) => {
    // R25 — sin esto, un rename en `/ordenes` dejaria la columna al final EN SILENCIO: la
    // reordenacion no la encontraria y nadie se enteraria.
    const montados = new Set(idsMontados(alcance));
    for (const id of PRIMERAS) {
      expect(montados.has(id), `\`${id}\` esta en PRIMERAS pero no se monta ninguna columna asi`).toBe(
        true,
      );
    }
  });

  it("cada id de la lista de exclusion existe de verdad entre las del listado", () => {
    // La otra declaracion por id de este modulo, y falla igual de ruidoso: si `flete` se
    // renombrara en `/ordenes`, el filtro dejaria de quitar nada y la columna volveria — a
    // pintar el `₡0` de un dato que el servidor ya retiro, que es justo lo que R15 prohibe.
    const delListado = new Set(ordenesColumns.map((c) => c.id));
    for (const id of COLUMNAS_SOLO_ALCANCE_GLOBAL) {
      expect(delListado.has(id), `\`${id}\` ya no es una columna del listado de ordenes`).toBe(true);
    }
    expect(COLUMNAS_SOLO_ALCANCE_GLOBAL.length).toBe(3);
  });

  it("R24 — el modulo no declara ni una segunda definicion de columna", () => {
    // Un `value:` es el encabezado de una columna, y solo la propia tiene uno: las 19 restantes
    // se leen de `ordenesColumns`. Dos `value:` aqui serian una segunda lista paralela, que es
    // lo que R24 prohibe (y lo que divergiria en cuanto `/ordenes` cambiara).
    const fuente = quitarComentarios(
      readFileSync(
        path.join(process.cwd(), "app/(app)/monitoreo/_components/detalle-columnas.ts"),
        "utf8",
      ),
    );
    expect([...fuente.matchAll(/\bvalue\s*:/g)]).toHaveLength(1);
    expect([...fuente.matchAll(/\bPRIMERAS\s*(?::|=)/g)], "el orden se declara dos veces").toHaveLength(
      1,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* R14 / R16 / R17 — el recorte por alcance, en las CABECERAS                  */
/* -------------------------------------------------------------------------- */

/** Los encabezados de las tres columnas restringidas, leidos del propio modulo del listado. */
const CABECERAS_RESTRINGIDAS = COLUMNAS_SOLO_ALCANCE_GLOBAL.map(
  (id) => ordenesColumns.find((c) => c.id === id)?.value ?? `sin columna \`${id}\``,
);

/** El encabezado del monto a cobrar, que R17 conserva en LOS DOS alcances. */
const CABECERA_MONTO = ordenesColumns.find((c) => c.id === "montoCobrar")?.value ?? "";

describe("columnasDetalle — el recorte por alcance en la pantalla (R14/R16/R17)", () => {
  it("R14 — con alcance `zona` NO se monta ninguna de las tres columnas de dinero restringido", () => {
    const { cabeceras } = pintar("zona");
    for (const cabecera of CABECERAS_RESTRINGIDAS) {
      expect(cabeceras, `la cabecera «${cabecera}» sigue montada en alcance zona`).not.toContain(
        cabecera,
      );
    }
  });

  it("R16 — con alcance `global` SI se montan las cuatro columnas de dinero", () => {
    const { cabeceras } = pintar("global");
    for (const cabecera of [...CABECERAS_RESTRINGIDAS, CABECERA_MONTO]) {
      expect(cabeceras, `falta «${cabecera}» en alcance global`).toContain(cabecera);
    }
  });

  it("R17 — «Monto a cobrar» esta en los DOS alcances, y con su cifra", () => {
    expect(CABECERA_MONTO).not.toBe("");
    for (const alcance of ALCANCES) {
      const { cabeceras, celdas } = pintar(alcance);
      expect(cabeceras, `falta «${CABECERA_MONTO}» en alcance ${alcance}`).toContain(CABECERA_MONTO);
      expect(celdas, `el monto no se pinta en alcance ${alcance}`).toContain(formatMonto(12345));
      cleanup();
    }
  });

  it("la diferencia entre los dos alcances son EXACTAMENTE tres columnas, no una mas", () => {
    const global = new Set(idsMontados("global"));
    const zona = idsMontados("zona");
    const retiradas = [...global].filter((id) => !zona.includes(id));
    expect(retiradas.sort()).toEqual([...COLUMNAS_SOLO_ALCANCE_GLOBAL].sort());
  });
});

/* -------------------------------------------------------------------------- */
/* R15 — lo retirado se retira como COLUMNA, nunca como VALOR                  */
/* -------------------------------------------------------------------------- */

describe("columnasDetalle — un dato retirado no se pinta como cero ni como guion (R15)", () => {
  it("alcance `zona`, sobre la fila YA RECORTADA: ninguna celda pinta `₡0` ni «—»", () => {
    // Este es el caso REAL de produccion: el servidor ya retiro flete, comision y tarifa. Si
    // una de esas columnas siguiera montada, `PriceLabel` pintaria el cero de un hueco —«esta
    // orden no paga flete»— que es una afirmacion FALSA, y peor que enseñar la cifra.
    const fila = recortarPorAlcance(
      ordenDelDetalle({ id: "o1", resultadoDelDia: "entregada" }),
      "zona",
    );
    const { celdas } = pintar("zona", fila);

    expect(celdas.length).toBeGreaterThan(10);
    expect(
      celdas.filter((texto) => texto === formatMonto(0)),
      "una columna de dinero sobrevivio al recorte y pinta el cero de un dato que no llego",
    ).toEqual([]);
    expect(
      celdas.filter((texto) => texto === SIN_DATO),
      "una celda pinta el marcador de «no resolvio» sobre una fila completamente poblada",
    ).toEqual([]);
  });

  it("la clausula NO es vacia: en alcance `global` esa MISMA fila recortada SI pintaria ceros", () => {
    // Es la contraprueba de la de arriba: demuestra que el detector encuentra el `₡0` cuando lo
    // hay. Montar las columnas de dinero sobre una fila recortada es exactamente el fallo que
    // R15 describe, y aqui se provoca a proposito.
    const fila = recortarPorAlcance(
      ordenDelDetalle({ id: "o1", resultadoDelDia: "entregada" }),
      "zona",
    );
    const { celdas } = pintar("global", fila);
    expect(celdas.filter((texto) => texto === formatMonto(0)).length).toBeGreaterThanOrEqual(3);
  });
});

/* -------------------------------------------------------------------------- */
/* R27 — la etiqueta del resultado del dia sale del mapa compartido            */
/* -------------------------------------------------------------------------- */

describe("columnasDetalle — «Resultado del día» (R22/R27)", () => {
  it("se etiqueta con el mapa compartido de estatus", () => {
    const { tabla } = pintar("zona", ordenDelDetalle({ id: "o1", resultadoDelDia: "reprogramada" }));
    const columna = idsMontados("zona").indexOf(COLUMNA_RESULTADO_ID);
    const celda = tabla.querySelectorAll("tbody td")[columna];
    expect(celda?.textContent?.trim()).toBe("Reprogramada");
  });

  it("sin gestion hoy pinta el marcador de vacio, no una cadena cruda ni un cero", () => {
    const { tabla } = pintar("zona", ordenDelDetalle({ id: "o1", resultadoDelDia: null }));
    const columna = idsMontados("zona").indexOf(COLUMNA_RESULTADO_ID);
    const celda = tabla.querySelectorAll("tbody td")[columna];
    expect(celda?.textContent?.trim()).toBe(SIN_DATO);
  });

  it("su encabezado es el que la pantalla declara, y esta en los dos alcances", () => {
    for (const alcance of ALCANCES) {
      expect(pintar(alcance).cabeceras).toContain(COLUMNA_RESULTADO_LABEL);
      cleanup();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* El fixture trae los centinelas: si no, nada de arriba probaria nada         */
/* -------------------------------------------------------------------------- */

describe("el fixture de este archivo NO esta vacio", () => {
  it("la fila sin recortar trae los tres importes restringidos con valor", () => {
    const fila = ordenDelDetalle({ id: "o1" });
    expect(fila.fleteConIva).toBe(CENTINELAS.flete);
    expect(fila.comisionConIva).toBe(CENTINELAS.comision);
    expect(fila.relaciones?.tienda?.tarifa?.fulfillment).toBe(CENTINELAS.tarifa);
  });
});
