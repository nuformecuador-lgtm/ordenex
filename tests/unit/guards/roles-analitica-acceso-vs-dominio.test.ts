import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { ROLES_ANALITICA as ROLES_DOMINIO_ANALITICA } from "@/lib/analytics/types";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";

// GUARD DE NO-CONVERGENCIA (deuda técnica saldada el 2026-07-31).
// REEXPRESADO por la feature 133 el 2026-08-04 (Q1, puerta CERRADA). Ver más abajo.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// Hubo un momento en que este repo tenía DOS constantes exportadas llamadas
// EXACTAMENTE `ROLES_ANALITICA`, con significados distintos:
//
//   - `lib/auth/menu-visibility.ts` (feature 129) → `["maestro", "admin"]`.
//     Quién ACCEDE: quién ve el ítem del sidebar y quién no se come el
//     `notFound()` de `app/(app)/analitica/page.tsx`.
//   - `lib/analytics/types.ts` (feature 135) → los CINCO roles lectores.
//     Qué ALCANCE tiene uno dentro de la analítica una vez ya entró.
//
// Las dos son tuplas `readonly` de `RolValue`, así que importar la que no era
// NO rompía el typecheck ni el lint: simplemente abría la puerta a tres roles
// de más, o la cerraba a tres de menos, en silencio. La primera se renombró a
// `ROLES_ACCESO_ANALITICA` para que el nombre diga cuál es cuál.
//
// El rename por sí solo no impide la recaída: nada obliga a que las dos listas
// mantengan la relación que tienen. Este guard es lo que la fija.
//
// QUÉ CAMBIÓ EL 2026-08-04 (feature 133, T2.2) Y POR QUÉ
// ------------------------------------------------------
// La 133 abrió `/analitica` a `adminTienda`, `adminSatelite` y `mensajero`, así
// que el conjunto de ACCESO pasó a COINCIDIR con el del DOMINIO. El caso (b) de
// este guard exigía literalmente que los dos conjuntos NO fueran iguales, y se
// puso rojo POR DISEÑO.
//
// La salida la traía escrita este mismo archivo, en las líneas que decían: «si
// algún día esa igualdad es la decisión correcta, la respuesta NO es borrar el
// guard: es fundir las dos constantes en una sola y dejar de tener dos conceptos
// donde hay uno». Eso es exactamente lo que se hizo: `ROLES_ACCESO_ANALITICA`
// pasó a DERIVARSE de `ROLES_ANALITICA` (una sola declaración), y el caso (b) se
// REEXPRESA para vigilar esa derivación. NO se borró y NO se relajó (R3, R29 de
// la 133): sigue habiendo un caso (b) y sigue mordiendo.
//
// LA MUTACIÓN QUE EL CASO (b) SIGUE MATANDO
// -----------------------------------------
// Escribir la lista otra vez a mano en `lib/auth/menu-visibility.ts`:
//
//     export const ROLES_ACCESO_ANALITICA =
//       ["maestro","admin","adminSatelite","adminTienda","mensajero"] as const;
//
// Esa mutación tiene el MISMO contenido, pasa el typecheck, pasa todos los tests
// de comportamiento (menú, gate, aterrizaje) y devuelve el repo justo al estado
// que este guard existe para impedir: dos listas gemelas con significados
// distintos, libres de divergir en silencio en el próximo cambio de roles. La
// versión anterior del caso (b) —«los conjuntos no son iguales»— tampoco la
// habría cazado, porque los conjuntos SEGUIRÍAN siendo iguales. Se caza con dos
// aserciones que se complementan:
//
//   (b1) IDENTIDAD REFERENCIAL en runtime: `ROLES_ACCESO_ANALITICA` y
//        `ROLES_ANALITICA` deben ser el MISMO objeto. Una copia (a mano o por
//        spread) rompe aquí.
//   (b2) CENSO DEL FUENTE de `lib/auth/menu-visibility.ts`: el lado derecho de la
//        declaración debe ser una REFERENCIA a un identificador, nunca un literal
//        de array. Sin (b2) el guard seguiría siendo verdad pero no diría POR QUÉ:
//        el mensaje de un `toBe` sobre dos arrays de cinco strings iguales es
//        ilegible, y la instrucción («deriva, no copies») quedaría sin escribir en
//        el sitio donde se lee el fallo. Con (b2) el fallo nombra el archivo, la
//        línea del pecado y el remedio.
//
// El caso (a) —acceso ⊆ dominio— y el caso «no vacío» quedan INTACTOS: siguen
// siendo verdad y siguen siendo necesarios (hoy los implica la derivación; el día
// que alguien la deshaga, son la red que queda debajo).

const acceso = new Set<string>(ROLES_ACCESO_ANALITICA);
const dominio = new Set<string>(ROLES_DOMINIO_ANALITICA);

const RUTA_MENU_VISIBILITY = "lib/auth/menu-visibility.ts";

/**
 * Quita comentarios antes de censar, misma decisión (y mismas dos sustituciones)
 * que `tests/unit/guards/tablero-financiero.guardia.test.ts` y que
 * `tests/unit/analytics/modulo-puro.guardia.test.ts`: la cabecera de la constante
 * está OBLIGADA a nombrar la forma prohibida —documenta por escrito que no se
 * escribe la lista a mano— y censar el texto crudo convertiría el contrato
 * escrito en una violación.
 */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/**
 * Lado derecho de `export const ROLES_ACCESO_ANALITICA = …;`, normalizado.
 * `null` si la declaración no aparece (que también es un fallo: alguien la borró
 * o la renombró, y este guard se habría quedado vigilando el vacío).
 */
function ladoDerechoDeLaDeclaracion(fuente: string): string | null {
  const encontrado = /export\s+const\s+ROLES_ACCESO_ANALITICA\s*(?::[^=]+)?=\s*([^;]+);/.exec(
    soloCodigo(fuente),
  );
  return encontrado ? encontrado[1].trim().replace(/\s+/g, " ") : null;
}

/**
 * ¿El lado derecho es una REFERENCIA (deriva) o una lista propia (copia)?
 * Referencia = un identificador suelto, opcionalmente con `as const` o con
 * calificador de módulo (`Modulo.ROLES_ANALITICA`). Cualquier `[` es una lista
 * escrita en este archivo, aunque sea un spread de la otra constante: un spread
 * crea un array NUEVO que ya puede editarse por su cuenta.
 */
function derivaDeUnaReferencia(ladoDerecho: string | null): boolean {
  if (ladoDerecho === null) return false;
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?: as const)?$/.test(ladoDerecho);
}

const fuenteMenuVisibility = readFileSync(
  path.join(process.cwd(), RUTA_MENU_VISIBILITY),
  "utf8",
);

describe("guard: ROLES_ACCESO_ANALITICA DERIVA de ROLES_ANALITICA (una sola declaración)", () => {
  it("(a) todo rol con acceso al tablero es un rol conocido por el dominio de analítica", () => {
    const huerfanos = [...acceso].filter((rol) => !dominio.has(rol));
    expect(
      huerfanos,
      `Roles en ROLES_ACCESO_ANALITICA (lib/auth/menu-visibility.ts) que NO están ` +
        `en ROLES_ANALITICA (lib/analytics/types.ts): ${huerfanos.join(", ")}. ` +
        `Entrarían al tablero sin que la analítica tenga definido su alcance.`,
    ).toEqual([]);
  });

  it("(b1) el acceso y el dominio son el MISMO objeto, no dos listas con el mismo contenido", () => {
    expect(
      ROLES_ACCESO_ANALITICA,
      `ROLES_ACCESO_ANALITICA ya no ES ROLES_ANALITICA: alguien deshizo la derivación ` +
        `que la feature 133 (Q1, 2026-08-04) puso en su lugar y volvió a tener DOS listas ` +
        `de roles. Aunque hoy tengan el mismo contenido, son dos sitios que mañana dirán ` +
        `cosas distintas sin que nada se ponga rojo — la colisión exacta que este guard ` +
        `existe para impedir. Remedio: en ${RUTA_MENU_VISIBILITY}, ` +
        `\`export const ROLES_ACCESO_ANALITICA = ROLES_ANALITICA;\`.`,
    ).toBe(ROLES_DOMINIO_ANALITICA);
  });

  it("(b2) la declaración del fuente es una REFERENCIA, nunca una lista de roles escrita a mano", () => {
    const ladoDerecho = ladoDerechoDeLaDeclaracion(fuenteMenuVisibility);
    expect(
      ladoDerecho,
      `No se encontró \`export const ROLES_ACCESO_ANALITICA = …;\` en ` +
        `${RUTA_MENU_VISIBILITY}. Si se renombró o se movió, este guard hay que ` +
        `reapuntarlo — no borrarlo.`,
    ).not.toBeNull();
    expect(
      derivaDeUnaReferencia(ladoDerecho),
      `En ${RUTA_MENU_VISIBILITY}, ROLES_ACCESO_ANALITICA se declara como ` +
        `\`${ladoDerecho}\`, que no es una referencia sino una lista propia. Escribir ` +
        `los roles a mano compila, pasa el typecheck y pasa todos los tests de ` +
        `comportamiento, y aun así reintroduce el problema: dos listas gemelas con ` +
        `significados distintos ("quién entra" y "quién ve qué"), libres de divergir en ` +
        `silencio. Debe DERIVARSE: \`export const ROLES_ACCESO_ANALITICA = ROLES_ANALITICA;\`.`,
    ).toBe(true);
  });

  it("el conjunto de acceso no está vacío (un guard sobre el conjunto vacío pasaría por vacuidad)", () => {
    expect(acceso.size).toBeGreaterThan(0);
  });

  // AUTOCOMPROBACIÓN del censo (b2). Sin esto, un regex que dejara de casar —o una
  // ruta mal calculada— dejaría el caso (b2) en verde para siempre por vacío, que es
  // justo la forma en que un guard muere sin que nadie se entere. Mismo patrón que el
  // bloque final de `tests/unit/analytics/modulo-puro.guardia.test.ts`.
  describe("autocomprobación: el censo (b2) detecta de verdad la mutación", () => {
    const derivado = `export const ROLES_ACCESO_ANALITICA = ROLES_ANALITICA;`;
    const copiado =
      `export const ROLES_ACCESO_ANALITICA = ` +
      `["maestro", "admin", "adminSatelite", "adminTienda", "mensajero"] as const;`;

    it("acepta la derivación", () => {
      expect(derivaDeUnaReferencia(ladoDerechoDeLaDeclaracion(derivado))).toBe(true);
      expect(
        derivaDeUnaReferencia(
          ladoDerechoDeLaDeclaracion(`export const ROLES_ACCESO_ANALITICA = ROLES_ANALITICA as const;`),
        ),
      ).toBe(true);
    });

    it("rechaza la lista escrita a mano, aunque su contenido sea idéntico", () => {
      expect(derivaDeUnaReferencia(ladoDerechoDeLaDeclaracion(copiado))).toBe(false);
    });

    it("rechaza la copia por spread (array nuevo, editable por su cuenta)", () => {
      expect(
        derivaDeUnaReferencia(
          ladoDerechoDeLaDeclaracion(`export const ROLES_ACCESO_ANALITICA = [...ROLES_ANALITICA] as const;`),
        ),
      ).toBe(false);
    });

    it("rechaza el fuente donde la declaración no existe", () => {
      expect(ladoDerechoDeLaDeclaracion(`export const OTRA_COSA = 1;`)).toBeNull();
      expect(derivaDeUnaReferencia(null)).toBe(false);
    });

    it("ignora los comentarios: la cabecera puede citar la forma prohibida", () => {
      const conComentario =
        `// no escribir ["maestro","admin","adminSatelite","adminTienda","mensajero"]\n` +
        derivado;
      expect(derivaDeUnaReferencia(ladoDerechoDeLaDeclaracion(conComentario))).toBe(true);
    });
  });
});
