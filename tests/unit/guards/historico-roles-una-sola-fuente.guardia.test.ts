import { describe, it, expect } from "vitest";

import { codigoSinComentarios } from "@/tests/fixtures/sin-comentarios";
import { ROLES_HISTORICO_CONVERSACIONES } from "@/lib/auth/menu-visibility";

/**
 * Feature 321 (T1.5) — GUARDIA: el ítem de menú y el gate de la ruta NO PUEDEN DIVERGIR,
 * y la whitelist está CERRADA.
 *
 * ## Qué vigila (R8)
 *
 * `lib/auth/menu-visibility.ts` declara `ROLES_HISTORICO_CONVERSACIONES` y el ítem
 * «Histórico» la REFERENCIA; `app/(app)/historico/conversaciones/page.tsx` la lee para su
 * `notFound()`. Mientras eso sea así, abrir o cerrar el histórico es UNA edición en UN
 * sitio. La forma en que esto se rompe no es ruidosa: alguien copia `["maestro","admin"]`
 * dentro de la página «para no importar nada», todo sigue verde, y el día que la whitelist
 * cambie el menú y la ruta dirán cosas distintas — el ítem desaparece pero la ruta sigue
 * abierta, o al revés. Es el precedente R10 de la 129.
 *
 * Por eso el censo se hace sobre el FUENTE de la página: no hay comportamiento observable
 * que distinga «leer la constante» de «haber copiado su contenido de hoy».
 *
 * ## Por qué SIN COMENTARIOS, y con el quitador del repo
 *
 * Los comentarios de este árbol nombran a propósito lo que el código tiene prohibido —el
 * de la propia página explica qué roles entran—, así que un barrido sobre el texto crudo
 * denunciaría la EXPLICACIÓN y obligaría a borrarla para pasar la guardia. Se usa
 * `codigoSinComentarios` (`tests/fixtures/sin-comentarios.ts`), EL quitador único del repo
 * (feature 209/283): escribir aquí un regex propio devolvería el árbol a las cinco
 * semánticas divergentes que ese módulo vino a cerrar.
 *
 * ## Por qué hay CONTRAPRUEBA
 *
 * Una guardia que escanea texto puede pasar POR VACÍO: si el regex no casa nunca —porque
 * está mal escrito, porque el quitador se comió el archivo, o porque la ruta apunta a un
 * fichero que ya no existe— informa «verde» diciendo exactamente nada. La contraprueba
 * aplica la mutación EN MEMORIA (constante → literal copiado) y exige que la aserción la
 * CACE. Sin ella, este archivo no sería una prueba de nada.
 */

const RUTA_PAGINA = "app/(app)/historico/conversaciones/page.tsx";

/** Cualquier literal de rol entrecomillado. Es lo que la página NO puede contener. */
const LITERAL_DE_ROL = /"(maestro|admin|adminSatelite|adminTienda|mensajero|apiKey)"/;

/**
 * Las DOS mitades de R8, juntas y en una sola función para que la contraprueba ejercite
 * exactamente las mismas aserciones que el caso real (y no una copia que pueda divergir).
 */
function afirmarUnaSolaFuente(fuente: string): void {
  expect(fuente).not.toMatch(LITERAL_DE_ROL);
  expect(fuente).toContain("ROLES_HISTORICO_CONVERSACIONES");
}

describe("R8 — el gate de la ruta lee la MISMA constante que el ítem de menú", () => {
  const fuente = codigoSinComentarios(RUTA_PAGINA);

  it("la página no escribe NINGÚN literal de rol y sí nombra la constante", () => {
    afirmarUnaSolaFuente(fuente);
  });

  it("el quitador no dejó el archivo vacío: la guardia mira código real, no un string en blanco", () => {
    // Sin esto, borrar la página entera dejaría la aserción de arriba pasando por vacío en
    // su primera mitad. Es el cinturón del cinturón.
    expect(fuente.trim().length).toBeGreaterThan(200);
    expect(fuente).toContain("notFound");
  });

  it("CONTRAPRUEBA (a): sustituir la constante por el literal copiado pone la guardia ROJA", () => {
    const mutado = fuente.replace(
      /ROLES_HISTORICO_CONVERSACIONES/g,
      '["maestro", "admin"]',
    );
    // La mutación tiene que haber ocurrido de verdad: si el `replace` no cambiara nada, el
    // `toThrow` de abajo estaría midiendo el fuente original.
    expect(mutado).not.toBe(fuente);
    expect(() => afirmarUnaSolaFuente(mutado)).toThrow();
  });

  it("CONTRAPRUEBA (b): colar un literal de rol SIN quitar la constante también la pone ROJA", () => {
    // La mutación realista de quien «sólo añade una excepción temporal» al gate.
    const mutado = fuente.replace(
      "if (!actor",
      'const extra = "adminSatelite";\n  if (!actor',
    );
    expect(mutado).not.toBe(fuente);
    expect(mutado).toContain("ROLES_HISTORICO_CONVERSACIONES");
    expect(() => afirmarUnaSolaFuente(mutado)).toThrow();
  });

  it("CONTRAPRUEBA (c): un fuente que no nombra la constante en absoluto la pone ROJA", () => {
    expect(() =>
      afirmarUnaSolaFuente("export default async function Pagina() { return null; }"),
    ).toThrow();
  });
});

describe("R1 / P4 — la whitelist está CERRADA: solo admin y maestro", () => {
  // Decisión humana del 2026-08-28 (P4, «solo admin/maestro»). Cada nombre de esta lista
  // es un rol que NO entra al histórico de conversaciones de todos los inquilinos;
  // añadirlo tiene que ser una edición deliberada de la constante, con fecha y autor, y
  // pasar por este archivo.
  for (const rol of ["adminSatelite", "adminTienda", "mensajero", "apiKey"] as const) {
    it(`${rol} NO está en ROLES_HISTORICO_CONVERSACIONES`, () => {
      expect(ROLES_HISTORICO_CONVERSACIONES as readonly string[]).not.toContain(rol);
    });
  }

  it("y el contenido es exactamente admin + maestro", () => {
    expect([...ROLES_HISTORICO_CONVERSACIONES].sort()).toEqual(["admin", "maestro"]);
  });
});
