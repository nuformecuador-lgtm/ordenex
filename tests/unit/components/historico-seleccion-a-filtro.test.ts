import { describe, it, expect } from "vitest";

import { seleccionAFiltroHistorico as seleccionAFiltro } from "@/app/(app)/historico/conversaciones/_components/seleccion-a-filtro";
import { ATAJOS_CREACION } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { filtroHilosHistoricoSchema } from "@/lib/types/historico-conversaciones";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

/**
 * Feature 318 — T5.2 (R32/R38): la seleccion del control generico traducida al `filtro` del
 * borde.
 *
 * Cada regla dura de aqui corresponde a un RECHAZO de `filtroHilosHistoricoSchema`, asi que
 * ademas de comprobar la forma se pasa la salida por el propio esquema: si la traduccion
 * emitiera `[]`, un instante con hora o una clave suelta, el borde responderia
 * `validation_error` y la pantalla se quedaria sin listado.
 */

const AHORA = new Date("2026-08-28T18:00:00.000Z");
const opts = { ahora: AHORA };

/** El borde acepta la salida: la garantia de que la traduccion no produce un rechazo. */
function esAceptadaPorElBorde(filtro: unknown): boolean {
  return filtroHilosHistoricoSchema.safeParse(filtro).success;
}

describe("R32 — una lista vacia se OMITE, jamas viaja `[]` (T5.2)", () => {
  it("`{ mensajero_id: [] }` produce el filtro VACIO", () => {
    const filtro = seleccionAFiltro({ mensajero_id: [] }, opts);

    expect(filtro).toEqual({});
    // `idList` es `.nonempty()`: mandar `[]` seria `validation_error`, no «sin filtro».
    expect("mensajero_id" in filtro).toBe(false);
    expect(esAceptadaPorElBorde(filtro)).toBe(true);
  });

  it("con mensajeros seleccionados, la lista viaja tal cual", () => {
    const filtro = seleccionAFiltro({ mensajero_id: ["m-1", "m-2"] }, opts);

    expect(filtro.mensajero_id).toEqual(["m-1", "m-2"]);
    expect(esAceptadaPorElBorde(filtro)).toBe(true);
  });

  it("toda clave desconocida se descarta: el esquema del borde es `.strict()`", () => {
    const filtro = seleccionAFiltro({ zona_id: ["z-1"], reasignables: ["true"] }, opts);

    expect(filtro).toEqual({});
    expect(esAceptadaPorElBorde(filtro)).toBe(true);
  });
});

describe("R37 — el termino por debajo del minimo no viaja (T5.2)", () => {
  it("`q: [\"ma\"]` no emite `q`", () => {
    expect(seleccionAFiltro({ q: ["ma"] }, opts).q).toBeUndefined();
  });

  it("con el minimo cumplido, `q` viaja ESCALAR y recortada", () => {
    const termino = "m".repeat(BUSQUEDA_MIN_CHARS);
    const filtro = seleccionAFiltro({ q: [`  ${termino}  `] }, opts);

    expect(filtro.q).toBe(termino);
    expect(Array.isArray(filtro.q)).toBe(false);
    expect(esAceptadaPorElBorde(filtro)).toBe(true);
  });

  it("los espacios no cuentan como caracteres: `\"  ma  \"` sigue por debajo del minimo", () => {
    // El esquema del borde hace `.trim()` ANTES de `.min()`; si aqui se midiera sin recortar,
    // el control mandaria un termino que el servidor rechaza.
    expect(seleccionAFiltro({ q: ["  ma  "] }, opts).q).toBeUndefined();
  });
});

describe("R34 — atajo y rango son EXCLUYENTES, y las fechas van sin hora (T5.2)", () => {
  const atajo7d = ATAJOS_CREACION.find((a) => a.value === "7d");

  it("el atajo `7d` se resuelve a su rango de fechas calendario", () => {
    const filtro = seleccionAFiltro({ fecha: ["7d", "", ""] }, opts);
    const esperado = ultimosNDiasCalendarioCR(atajo7d!.dias, AHORA);

    expect(filtro.fecha_desde).toBe(esperado.desde);
    expect(filtro.fecha_hasta).toBe(esperado.hasta);
    expect(esAceptadaPorElBorde(filtro)).toBe(true);
  });

  it("el atajo NO viaja ademas del rango: la salida solo tiene las dos fechas", () => {
    const filtro = seleccionAFiltro({ fecha: ["7d", "", ""] }, opts);

    // El contrato del borde no tiene clave de atajo (`.strict()`): emitir una junto al rango
    // seria `validation_error`, no «un dato de mas».
    expect(Object.keys(filtro).sort()).toEqual(["fecha_desde", "fecha_hasta"]);
  });

  it("con atajo puesto, el atajo GANA el rango escrito a mano", () => {
    const filtro = seleccionAFiltro({ fecha: ["7d", "2020-01-01", "2020-01-31"] }, opts);
    const esperado = ultimosNDiasCalendarioCR(atajo7d!.dias, AHORA);

    expect(filtro.fecha_desde).toBe(esperado.desde);
    expect(filtro.fecha_hasta).toBe(esperado.hasta);
  });

  it("sin atajo, viaja el rango tal cual, en `YYYY-MM-DD` y sin hora", () => {
    const filtro = seleccionAFiltro({ fecha: ["", "2026-08-01", "2026-08-28"] }, opts);

    expect(filtro).toEqual({ fecha_desde: "2026-08-01", fecha_hasta: "2026-08-28" });
    expect(filtro.fecha_desde).not.toMatch(/T|:/);
    expect(esAceptadaPorElBorde(filtro)).toBe(true);
  });

  it("media terna: solo `desde` emite solo `fecha_desde`", () => {
    const filtro = seleccionAFiltro({ fecha: ["", "2026-08-01", ""] }, opts);

    expect(filtro).toEqual({ fecha_desde: "2026-08-01" });
    expect(esAceptadaPorElBorde(filtro)).toBe(true);
  });
});

describe("R35 — el numero de orden viaja ESCALAR (T5.2)", () => {
  it("`orden: [\"1001\"]` emite la cadena, no la lista", () => {
    const filtro = seleccionAFiltro({ orden: ["1001"] }, opts);

    expect(filtro.orden).toBe("1001");
    expect(Array.isArray(filtro.orden)).toBe(false);
    expect(esAceptadaPorElBorde(filtro)).toBe(true);
  });

  it("una orden vacia se omite: «sin filtro» se expresa OMITIENDO la clave", () => {
    expect(seleccionAFiltro({ orden: ["   "] }, opts)).toEqual({});
  });
});

describe("R38 — la seleccion completa produce un filtro que el borde acepta (T5.2)", () => {
  it("las cuatro claves juntas se traducen a la forma del contrato", () => {
    const filtro = seleccionAFiltro(
      {
        q: ["ana"],
        mensajero_id: ["m-1"],
        fecha: ["", "2026-08-01", "2026-08-28"],
        orden: ["1001"],
      },
      opts,
    );

    expect(filtro).toEqual({
      q: "ana",
      mensajero_id: ["m-1"],
      fecha_desde: "2026-08-01",
      fecha_hasta: "2026-08-28",
      orden: "1001",
    });
    expect(esAceptadaPorElBorde(filtro)).toBe(true);
  });

  it("una seleccion vacia produce el filtro vacio, que tambien es legal", () => {
    const filtro = seleccionAFiltro({}, opts);

    expect(filtro).toEqual({});
    expect(esAceptadaPorElBorde(filtro)).toBe(true);
  });
});
