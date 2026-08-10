import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_ANALITICA_FINANCIERA,
  COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO,
} from "@/app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas";

// Feature 184 — analitica financiera: export de la serie (T2.2). R29.
//
// EL MOLDE ES EL DE LA 189 (`progress/impl_189.md` §1): DOS aserciones por constante —clave Y
// encabezado— con el esperado ESCRITO A MANO, y **nunca** `COLUMNAS.map(...)` a los dos lados.
// Esa tautologia es la que este repo lleva semanas cazando: una asercion que proyecta la misma
// constante a ambos lados pasa igual despues de permutar dos columnas, y el orden de las columnas
// de un archivo es contrato — una permuta silenciosa rompe la hoja de quien lo reenvia.
//
// Los dos juegos se afirman POR SEPARADO y con su lista propia, y no uno derivado del otro: el
// juego `solo_bruto` se PRODUCE quitando `neto` del completo (que es lo correcto en produccion,
// para que no puedan divergir en encabezado), asi que derivar tambien el esperado dejaria el caso
// midiendose a si mismo.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con nombre, no solo con numero.

/** Las OCHO claves del juego completo, en su orden. Escritas a mano. */
const CLAVES_CON_NETO = [
  "periodo",
  "grano",
  "metrica",
  "bruto",
  "neto",
  "moneda",
  "cifra",
  "limitacion_conocida",
];

/** Los OCHO encabezados, en su orden. Escritos a mano. */
const ENCABEZADOS_CON_NETO = [
  "Periodo",
  "Grano",
  "Metrica",
  "Bruto",
  "Neto",
  "Moneda",
  "Tipo de cifra",
  "Limitacion conocida",
];

/** Las SIETE claves del juego `solo_bruto`, en su orden. Escritas a mano: sin `neto`. */
const CLAVES_SOLO_BRUTO = [
  "periodo",
  "grano",
  "metrica",
  "bruto",
  "moneda",
  "cifra",
  "limitacion_conocida",
];

/** Los SIETE encabezados del juego `solo_bruto`, en su orden. Escritos a mano. */
const ENCABEZADOS_SOLO_BRUTO = [
  "Periodo",
  "Grano",
  "Metrica",
  "Bruto",
  "Moneda",
  "Tipo de cifra",
  "Limitacion conocida",
];

describe("Feature 184 — analitica financiera: export de la serie (R29) · el contrato de columnas", () => {
  it("las columnas con neto se declaran en su orden", () => {
    expect(COLUMNAS_DESCARGA_ANALITICA_FINANCIERA.map((columna) => columna.clave)).toEqual(
      CLAVES_CON_NETO,
    );
    expect(COLUMNAS_DESCARGA_ANALITICA_FINANCIERA.map((columna) => columna.encabezado)).toEqual(
      ENCABEZADOS_CON_NETO,
    );
  });

  it("las columnas solo bruto se declaran en su orden", () => {
    expect(
      COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO.map((columna) => columna.clave),
    ).toEqual(CLAVES_SOLO_BRUTO);
    expect(
      COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO.map((columna) => columna.encabezado),
    ).toEqual(ENCABEZADOS_SOLO_BRUTO);
  });

  it("la unica diferencia entre los dos juegos es la columna de neto (R13)", () => {
    // Contrapeso de los dos casos anteriores: sin esto, los dos podrian seguir en verde con los
    // juegos divergiendo en cualquier otra columna, porque cada uno mira solo el suyo.
    const soloEnElCompleto = COLUMNAS_DESCARGA_ANALITICA_FINANCIERA.filter(
      (columna) =>
        !COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO.some(
          (otra) => otra.clave === columna.clave,
        ),
    );
    expect(soloEnElCompleto.map((columna) => columna.clave)).toEqual(["neto"]);
  });
});
