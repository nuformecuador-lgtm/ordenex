import { describe, expect, it } from "vitest";

import type { OrdenListItemDTO } from "@/lib/types/orden";
import {
  CAMPOS_SOLO_ALCANCE_GLOBAL,
  type OrdenDetalleDia,
} from "@/lib/types/tablero-dia";
import { ordenDeListado, ordenDelDetalle } from "@/tests/fixtures/orden-detalle-dia";

// FEATURE 260 (T0.2 / C2) — R1, R18, R43. EL CONTRATO DEL ELEMENTO DEL DETALLE.
//
// Dos afirmaciones, y las dos son de TIPO antes que de valor:
//
//   (1) R1 — la fila del detalle ES la del listado. Es lo que sostiene que `ordenesColumns` se
//       monte sobre ella SIN UN CAST: `Column<OrdenListItemDTO>[]` solo es asignable a
//       `Column<OrdenDetalleDia>[]` mientras `OrdenDetalleDia` sea un subtipo ESTRICTO
//       (`render: (row: T) => ReactNode` es contravariante bajo `strictFunctionTypes`). El dia
//       que deje de serlo, montar las columnas exigiria un `as`, y ese `as` es la costura por
//       la que las dos pantallas divergen sin que el compilador diga nada.
//
//   (2) R18 — TECHO DE SUPERFICIE. El elemento del detalle es el del listado o un subconjunto
//       suyo, MAS los dos campos que son del DIA y no de la orden. Nunca un superconjunto: mas
//       campos es mas superficie, y el detalle no es el sitio donde se amplia el contrato.
//
// Las aserciones de tipo de este archivo fallan en `pnpm typecheck`, no en tiempo de
// ejecucion — que es justo lo que se quiere: el error aparece al compilar, en el commit que lo
// introduce, y no cuando alguien ejecute esta prueba.

/* -------------------------------------------------------------------------- */
/* (1) R1 — asignabilidad en las dos direcciones que importan                  */
/* -------------------------------------------------------------------------- */

describe("OrdenDetalleDia — es el elemento del listado (R1)", () => {
  it("una fila del detalle se puede usar DONDE SEA que se espere un elemento del listado", () => {
    const delDetalle: OrdenDetalleDia = ordenDelDetalle({ id: "o1" });
    // Si esta linea deja de compilar, `ordenesColumns` ya no se puede montar sin cast.
    const comoDelListado: OrdenListItemDTO = delDetalle;
    expect(comoDelListado.id).toBe("o1");
  });

  it("una funcion que consume el elemento del listado acepta la fila del detalle", () => {
    // Es la forma EXACTA que tiene el `render` de cada columna del listado. Se escribe asi, y
    // no como una anotacion suelta, porque lo que R1 sostiene es la CONTRAVARIANZA.
    const render = (fila: OrdenListItemDTO): string => fila.numRemision;
    const columna: { render: (fila: OrdenDetalleDia) => string } = { render };
    expect(columna.render(ordenDelDetalle({ id: "o1", numRemision: "REM-9" }))).toBe("REM-9");
  });
});

/* -------------------------------------------------------------------------- */
/* (2) R18 — el techo de superficie, comprobado por tipo Y por valor           */
/* -------------------------------------------------------------------------- */

/** Los DOS unicos campos que el detalle añade, y que no son de la orden sino del DIA. */
const CAMPOS_PROPIOS_DEL_DIA = ["resultadoDelDia", "asignadoAt"] as const;
type CampoPropioDelDia = (typeof CAMPOS_PROPIOS_DEL_DIA)[number];

/** Lo que el detalle tiene y el listado no. */
type ClavesPropiasDelDetalle = Exclude<keyof OrdenDetalleDia, keyof OrdenListItemDTO>;

/**
 * ⛔ EL TECHO. Si alguien añade un tercer campo propio a `OrdenDetalleDia`, esta linea deja de
 * compilar: `Exclude<...>` deja de ser `never` y `true` ya no es asignable a `false`. Va en
 * forma de TUPLA (`[A] extends [never]`) a proposito — sin ella, un `never` desnudo distribuye
 * la condicional y la comprobacion se vuelve trivialmente cierta.
 */
const TECHO_RESPETADO: [Exclude<ClavesPropiasDelDetalle, CampoPropioDelDia>] extends [never]
  ? true
  : false = true;

describe("OrdenDetalleDia — techo de superficie (R18)", () => {
  it("no añade ningun campo propio mas alla de los dos del dia", () => {
    expect(TECHO_RESPETADO).toBe(true);
  });

  it("las claves de una fila del detalle son las del listado mas esos dos, nunca mas", () => {
    const delListado = Object.keys(ordenDeListado({ id: "o1" }));
    const delDetalle = Object.keys(ordenDelDetalle({ id: "o1" }));

    const permitidas = new Set([...delListado, ...CAMPOS_PROPIOS_DEL_DIA]);
    expect(delDetalle.filter((clave) => !permitidas.has(clave))).toEqual([]);
    // Y los dos campos del dia SI estan: sin esto la clausula seria verde por vacio.
    for (const campo of CAMPOS_PROPIOS_DEL_DIA) expect(delDetalle).toContain(campo);
  });
});

/* -------------------------------------------------------------------------- */
/* (3) R43 — una sola declaracion de lo restringido, atada a su tipo           */
/* -------------------------------------------------------------------------- */

describe("CAMPOS_SOLO_ALCANCE_GLOBAL — una sola lista, atada al tipo (R43)", () => {
  it("cada nombre declarado existe de verdad en la fila del detalle", () => {
    // El `satisfies` de la declaracion ya lo garantiza al COMPILAR. Esto lo comprueba ademas
    // contra un valor real: si un campo se renombrara y alguien "arreglara" el `satisfies`
    // aflojandolo, el fixture completo lo delata.
    const orden = ordenDelDetalle({ id: "o1" });
    for (const campo of CAMPOS_SOLO_ALCANCE_GLOBAL.orden) {
      expect(orden[campo], `\`${campo}\` no viene poblado en la fila`).not.toBeUndefined();
    }
    const tienda = orden.relaciones?.tienda;
    expect(tienda).not.toBeNull();
    for (const campo of CAMPOS_SOLO_ALCANCE_GLOBAL.tienda) {
      expect(tienda?.[campo], `\`tienda.${campo}\` no viene poblado`).not.toBeUndefined();
    }
  });

  it("la lista no esta vacia ni se quedo en un solo campo", () => {
    expect(CAMPOS_SOLO_ALCANCE_GLOBAL.orden.length).toBe(2);
    expect(CAMPOS_SOLO_ALCANCE_GLOBAL.tienda.length).toBe(3);
  });
});
