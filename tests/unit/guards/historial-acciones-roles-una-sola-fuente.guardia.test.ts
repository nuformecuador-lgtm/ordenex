import { describe, it, expect } from "vitest";

import { codigoSinComentarios } from "@/tests/fixtures/sin-comentarios";
import { ROLES_HISTORIAL_ACCIONES } from "@/lib/auth/menu-visibility";

/**
 * FICHA 362 / T7.6 — GUARDIA: el subítem de menú, el gate de la ruta y el servicio NO PUEDEN
 * DIVERGIR, y la whitelist está CERRADA en `maestro`.
 *
 * Hermana de `historico-roles-una-sola-fuente.guardia.test.ts` (321/R8), con el mismo
 * mecanismo y por el mismo motivo — no se reescribe el mecanismo, se le añade la ruta nueva.
 *
 * ## Qué vigila (R19)
 *
 * `lib/auth/menu-visibility.ts` declara `ROLES_HISTORIAL_ACCIONES`; el subítem «Acciones» la
 * REFERENCIA y `app/(app)/historico/acciones/page.tsx` la lee para su `notFound()`. Mientras
 * eso sea así, abrir o cerrar el módulo es UNA edición en UN sitio. La forma en que esto se
 * rompe no es ruidosa: alguien copia `["maestro"]` dentro de la página «para no importar
 * nada», todo sigue verde, y el día que la whitelist cambie el menú y la ruta dirán cosas
 * distintas — el subítem desaparece pero la ruta sigue abierta, o al revés.
 *
 * ## Por qué aquí importa MÁS que en el histórico de conversaciones
 *
 * Porque la lista es de UNO. Este registro guarda las decisiones de dinero que toma el
 * `admin`, y la única razón por la que el módulo tiene valor es que su auditado no lo lee.
 * Un literal copiado en la página es la vía por la que el `admin` recuperaría el acceso sin
 * que nadie lo decidiera.
 *
 * ## Por qué SIN COMENTARIOS, y con el quitador del repo
 *
 * Los comentarios de este árbol nombran a propósito lo que el código tiene prohibido —el de
 * la propia página explica qué rol entra y por qué—, así que un barrido sobre el texto crudo
 * denunciaría la EXPLICACIÓN y obligaría a borrarla para pasar la guardia. Se usa
 * `codigoSinComentarios`, EL quitador único del repo (209/283).
 *
 * ## Por qué hay CONTRAPRUEBA
 *
 * Una guardia que escanea texto puede pasar POR VACÍO: si el regex no casa nunca —porque está
 * mal escrito, porque el quitador se comió el archivo, o porque la ruta apunta a un fichero
 * que ya no existe— informa «verde» diciendo exactamente nada. Las contrapruebas aplican la
 * mutación EN MEMORIA y exigen que la aserción la CACE.
 */

const RUTA_PAGINA = "app/(app)/historico/acciones/page.tsx";
const RUTA_MENU = "lib/auth/menu-visibility.ts";

/** Cualquier literal de rol entrecomillado. Es lo que la página NO puede contener. */
const LITERAL_DE_ROL = /"(maestro|admin|adminSatelite|adminTienda|mensajero|apiKey)"/;

/**
 * Las DOS mitades de R19, juntas y en una sola función para que la contraprueba ejercite
 * exactamente las mismas aserciones que el caso real (y no una copia que pueda divergir).
 */
function afirmarUnaSolaFuente(fuente: string): void {
  expect(fuente).not.toMatch(LITERAL_DE_ROL);
  expect(fuente).toContain("ROLES_HISTORIAL_ACCIONES");
}

describe("R19 — el gate de la ruta lee la MISMA constante que el subítem de menú", () => {
  const fuente = codigoSinComentarios(RUTA_PAGINA);

  it("la página no escribe NINGÚN literal de rol y sí nombra la constante", () => {
    afirmarUnaSolaFuente(fuente);
  });

  it("el quitador no dejó el archivo vacío: la guardia mira código real, no un string en blanco", () => {
    // Sin esto, borrar la página entera dejaría la aserción de arriba pasando por vacío en su
    // primera mitad. Es el cinturón del cinturón.
    expect(fuente.trim().length).toBeGreaterThan(200);
    expect(fuente).toContain("notFound");
  });

  it("CONTRAPRUEBA (a): sustituir la constante por el literal copiado pone la guardia ROJA", () => {
    const mutado = fuente.replace(/ROLES_HISTORIAL_ACCIONES/g, '["maestro"]');
    // La mutación tiene que haber ocurrido de verdad: si el `replace` no cambiara nada, el
    // `toThrow` de abajo estaría midiendo el fuente original.
    expect(mutado).not.toBe(fuente);
    expect(() => afirmarUnaSolaFuente(mutado)).toThrow();
  });

  it("CONTRAPRUEBA (b): colar un literal de rol SIN quitar la constante también la pone ROJA", () => {
    // ⭑ La mutación realista, y la que este módulo no puede permitirse: «devolverle el acceso
    // al admin, sólo un momento». Sin este caso, el registro de auditoría lo leería su propio
    // auditado y nada se pondría rojo.
    const mutado = fuente.replace(
      "if (!actor",
      'const extra = "admin";\n  if (!actor',
    );
    expect(mutado).not.toBe(fuente);
    expect(mutado).toContain("ROLES_HISTORIAL_ACCIONES");
    expect(() => afirmarUnaSolaFuente(mutado)).toThrow();
  });

  it("CONTRAPRUEBA (c): un fuente que no nombra la constante en absoluto la pone ROJA", () => {
    expect(() =>
      afirmarUnaSolaFuente("export default async function Pagina() { return null; }"),
    ).toThrow();
  });
});

describe("R19 — el subítem de menú REFERENCIA la constante, no la copia", () => {
  const fuenteMenu = codigoSinComentarios(RUTA_MENU);

  it("la declaración del subítem «Acciones» nombra la constante", () => {
    // El menú SÍ escribe literales de rol en otros ítems (`roles: ["maestro","admin"]` de
    // Incidentes, por ejemplo), así que aquí no se puede barrer el archivo entero: se recorta
    // el bloque del subítem y se mira ESE.
    const bloque = fuenteMenu.slice(
      fuenteMenu.indexOf('label: "Acciones"'),
      fuenteMenu.indexOf('label: "Acciones"') + 200,
    );
    expect(bloque).toContain("roles: ROLES_HISTORIAL_ACCIONES");
    expect(bloque).not.toMatch(LITERAL_DE_ROL);
  });

  it("CONTRAPRUEBA: un bloque con la lista copiada a mano se caza", () => {
    const mutado = 'label: "Acciones", href: "/historico/acciones", roles: ["maestro"],';
    expect(mutado).not.toContain("roles: ROLES_HISTORIAL_ACCIONES");
    expect(mutado).toMatch(LITERAL_DE_ROL);
  });
});

describe("la whitelist está CERRADA: solo el maestro", () => {
  // Decisión humana del 2026-09-02 (Q4). Cada nombre de esta lista es un rol que NO lee el
  // registro de acciones; añadirlo tiene que ser una edición deliberada de la constante, con
  // fecha y autor, y pasar por este archivo.
  for (const rol of ["admin", "adminSatelite", "adminTienda", "mensajero", "apiKey"] as const) {
    it(`${rol} NO está en ROLES_HISTORIAL_ACCIONES`, () => {
      expect(ROLES_HISTORIAL_ACCIONES as readonly string[]).not.toContain(rol);
    });
  }

  it("⭑ y el contenido es exactamente [maestro]", () => {
    expect([...ROLES_HISTORIAL_ACCIONES]).toEqual(["maestro"]);
  });
});
