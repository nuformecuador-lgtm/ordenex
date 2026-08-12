// Feature 207 — el test PROPIO del lector de `expect(…)` de la guardia de aserciones de
// orden. No existía.
//
// Es el peor sitio del repo donde podía vivir este defecto. La guardia exige que toda lista de
// columnas descargables tenga una aserción que fije su orden; el lector escaneaba el fuente
// CRUDO, así que un `expect(...)` COMENTADO contaba como aserción. Dicho de otro modo: una
// guardia que cuenta aserciones podía quedar satisfecha por código que no se ejecuta. Comentar
// la aserción de orden —el gesto de quien va con prisa y la deja «para luego»— dejaba la
// guardia verde y el contrato del archivo que descarga el usuario sin vigilancia.
//
// Este archivo fija LAS DOS CARAS:
//   - un `expect(...)` en un comentario (de línea o de bloque) NO es una aserción;
//   - un `expect(...)` vivo SÍ lo es, con sus paréntesis anidados, sus cadenas y su matcher.
//
// Los fixtures usan nombres INVENTADOS (`COLUMNAS_DESCARGA_INVENTADA`) a propósito: con un
// nombre real, este archivo pasaría a contar como cobertura de esa constante en el barrido de
// la guardia, que lee `tests/` entero.
import { describe, it, expect } from "vitest";

import { aserciones, tieneAsercionDeOrden } from "./aserciones-de-orden";

const CONSTANTE = "COLUMNAS_DESCARGA_INVENTADA";
const OTRA = "COLUMNAS_DESCARGA_OTRA_INVENTADA";

/** La forma canónica que la guardia exige. */
const ASERCION_VIVA = `expect(${CONSTANTE}.map((c) => c.clave)).toEqual(["fecha", "monto"]);`;

describe("aserciones — una aserción comentada no es una aserción", () => {
  describe("la prosa no cuenta", () => {
    it("un `expect(` comentado no entra en la lista", () => {
      const fuente = `
        it("orden", () => {
          // ${ASERCION_VIVA}
          /* ${ASERCION_VIVA} */
        });
      `;
      expect(aserciones(fuente)).toEqual([]);
    });

    it("y por tanto no da por cubierta a la constante — comentario de línea", () => {
      const fuente = `
        it("orden de las columnas", () => {
          // TODO(#123): reactivar cuando cambie el catálogo
          // ${ASERCION_VIVA}
          expect(true).toBe(true);
        });
      `;
      expect(
        tieneAsercionDeOrden(fuente, CONSTANTE),
        "una aserción comentada NO puede dar por cubierta una lista de columnas",
      ).toBe(false);
    });

    it("ni comentada en bloque, que es como la citan los docstrings", () => {
      // La cabecera de la propia guardia cita la forma canónica para explicarla; ese texto no
      // puede valer como cobertura de nada.
      const fuente = `
        /**
         * El contrato se fija así:
         *   ${ASERCION_VIVA}
         */
        export const notas = 1;
      `;
      expect(tieneAsercionDeOrden(fuente, CONSTANTE)).toBe(false);
    });

    it("mixto: la comentada no cuenta y la viva sí, en el mismo archivo", () => {
      // El caso que decide de verdad: con el lector viejo las DOS daban verde, así que la
      // primera constante quedaba «cubierta» por una línea que nadie ejecuta.
      const fuente = `
        it("orden", () => {
          // ${ASERCION_VIVA}
          expect(${OTRA}.map((c) => c.clave)).toEqual(["id"]);
        });
      `;
      expect(tieneAsercionDeOrden(fuente, CONSTANTE), "la comentada").toBe(false);
      expect(tieneAsercionDeOrden(fuente, OTRA), "la viva").toBe(true);
    });

    it("nombrar la constante en un comentario DENTRO de una aserción viva tampoco cuenta", () => {
      // La aserción existe y se ejecuta, pero afirma sobre un parámetro: es la forma
      // `describe.each` que la guardia rechaza a propósito. El comentario que nombra la
      // constante no puede rescatarla.
      const fuente = `
        expect(
          columnas.map((c) => c.clave), // ${CONSTANTE}
        ).toEqual(["fecha"]);
      `;
      expect(tieneAsercionDeOrden(fuente, CONSTANTE)).toBe(false);
    });
  });

  describe("una aserción viva sí cuenta", () => {
    it("la forma canónica", () => {
      expect(tieneAsercionDeOrden(ASERCION_VIVA, CONSTANTE)).toBe(true);
    });

    it("se lee el sujeto entero, con los paréntesis anidados equilibrados", () => {
      const leidas = aserciones(`expect(${CONSTANTE}.map((c) => c.clave)).toEqual([]);`);
      expect(leidas).toHaveLength(1);
      expect(leidas[0].sujeto).toBe(`${CONSTANTE}.map((c) => c.clave)`);
      expect(leidas[0].matcher).toBe("toEqual");
    });

    it("un `)` SUELTO dentro de una cadena no cierra el `expect(`", () => {
      // El paréntesis de la cadena tiene que estar DESEQUILIBRADO para que este caso valga:
      // con `"Totales (USD)"` el conteo cuadra igual y el test pasa aunque se le quite al
      // lector el respeto por las cadenas — se midió, esa versión sobrevivía a la mutación.
      const leidas = aserciones(`expect(rotulo("cerrado )")).toEqual("x");`);
      expect(leidas).toHaveLength(1);
      expect(leidas[0].sujeto).toBe(`rotulo("cerrado )")`);
      expect(leidas[0].matcher, "el matcher se pierde si el sujeto se cierra antes").toBe(
        "toEqual",
      );
    });

    it("el matcher se encuentra tras `.not` / `.resolves`", () => {
      expect(aserciones(`expect(x).not.toEqual([]);`)[0].matcher).toBe("toEqual");
      expect(aserciones(`expect(p).resolves.toBe(1);`)[0].matcher).toBe("toBe");
    });

    it("un matcher que no fija el orden no vale como aserción de orden", () => {
      const fuente = `expect(${CONSTANTE}.map((c) => c.clave)).toHaveLength(4);`;
      expect(aserciones(fuente), "la aserción se lee").toHaveLength(1);
      expect(tieneAsercionDeOrden(fuente, CONSTANTE), "pero no fija el orden").toBe(false);
    });

    it("un comentario ENTRE la aserción y su matcher ya no la esconde", () => {
      // El mismo defecto por el otro lado, y éste es un falso NEGATIVO: con el lector viejo,
      // el comentario intercalado dejaba el matcher fuera de la cola que se inspecciona y la
      // aserción, viva y correcta, no contaba como cobertura.
      const fuente = `
        expect(${CONSTANTE}.map((c) => c.clave))
          // el orden es el del contrato de la 189
          .toEqual(["fecha", "monto"]);
      `;
      expect(tieneAsercionDeOrden(fuente, CONSTANTE)).toBe(true);
    });

    it("prosa antes y después no se lleva por delante la aserción viva", () => {
      // La viva va EN MEDIO de dos comentarios de bloque: un quitador ávido (bloque no
      // perezoso) se la comería junto con la prosa y este test lo vería.
      const fuente = `
        /* Antes: ${ASERCION_VIVA} */
        ${ASERCION_VIVA}
        /* Después se añadirá la columna "estado". */
      `;
      const leidas = aserciones(fuente);
      expect(leidas, "la prosa suma aserciones fantasma").toHaveLength(1);
      expect(tieneAsercionDeOrden(fuente, CONSTANTE)).toBe(true);
    });
  });
});
