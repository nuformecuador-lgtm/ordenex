import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { ROLES_ANALITICA as ROLES_DOMINIO_ANALITICA } from "@/lib/analytics/types";
import {
  ROLES_ACCESO_ANALITICA,
  ROLES_SIN_ACCESO_ANALITICA,
} from "@/lib/auth/menu-visibility";

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
//
// QUÉ CAMBIÓ EL 2026-08-12 (decisión del humano: el mensajero SALE del tablero)
// ----------------------------------------------------------------------------
// El `mensajero` deja de ver el ítem del sidebar y deja de pasar el `notFound()`
// de la ruta, pero CONSERVA su alcance en el catálogo de la 135 (`metrics.ts` le
// declara métrica a métrica qué vería si entrara; `oraculo-mensajero.ts` lo mide).
// Es decir: acceso vuelve a ser subconjunto ESTRICTO del dominio, que es la forma
// que este archivo tenía antes de la 133 — sólo que ahora con UNA sola enumeración
// de roles debajo.
//
// La derivación NO se deshace: se convierte en una RESTA. `ROLES_ACCESO_ANALITICA`
// sigue naciendo de `ROLES_ANALITICA`, y lo que se le quita vive en su propia
// constante, `ROLES_SIN_ACCESO_ANALITICA`, escrita para leerse como la decisión que
// es. Por eso (b1) ya NO puede ser identidad referencial (`toBe`): el filtro
// devuelve un array nuevo por necesidad. Lo que se vigila en su lugar es que la
// resta sea EXACTA en las dos direcciones —ni un rol de más, ni uno de menos— y que
// la lista de excluidos no esté vacía (una resta vacía sería la igualdad de ayer
// disfrazada de decisión).
//
// LAS MUTACIONES QUE (b1) Y (b2) SIGUEN MATANDO
// ---------------------------------------------
//   - «volver a escribir la lista a mano», ahora en su forma corta:
//         export const ROLES_ACCESO_ANALITICA =
//           ["maestro","admin","adminSatelite","adminTienda"] as const;
//     Mismo contenido, typecheck verde, todos los tests de comportamiento verdes, y
//     otra vez dos listas gemelas libres de divergir: un `RolValue` que mañana entre
//     al dominio de la analítica se quedaría sin puerta sin que nada se ponga rojo.
//     La caza (b2), censando el fuente: el lado derecho tiene que MENCIONAR
//     `ROLES_ANALITICA` y no puede contener literales de rol.
//   - «cerrarle la puerta a alguien más (o reabrirla) sin declararlo»: cambiar el
//     filtro para que excluya a `adminTienda`, o dejar de aplicar la resta. La caza
//     (b1), exigiendo que la diferencia dominio∖acceso sea EXACTAMENTE
//     `ROLES_SIN_ACCESO_ANALITICA`.

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
 * ¿El lado derecho DERIVA de `ROLES_ANALITICA` o es una lista propia?
 *
 * Dos condiciones, y las dos hacen falta:
 *  (1) MENCIONA el identificador `ROLES_ANALITICA` — si no, no deriva de nada;
 *  (2) NO contiene ni una comilla. Un nombre de rol sólo puede llegar aquí como
 *      literal de string, así que prohibir las comillas prohíbe exactamente eso:
 *      la lista escrita a mano (`["maestro", …]`) y la mezcla
 *      (`[...ROLES_ANALITICA, "otro"]`), que pasaría (1) y seguiría siendo una
 *      segunda enumeración de roles.
 *
 * Lo que SÍ se admite ahora y antes no: los corchetes. La declaración ya no puede
 * ser un identificador suelto —el `mensajero` se resta con un `.filter`, que
 * devuelve un array nuevo por necesidad—, así que la regla dejó de poder ser
 * «ninguna estructura» y pasó a ser «ningún nombre de rol». A quién se le resta se
 * declara en `ROLES_SIN_ACCESO_ANALITICA`, cuya exactitud vigila el caso (b1).
 */
function derivaDeRolesAnalitica(ladoDerecho: string | null): boolean {
  if (ladoDerecho === null) return false;
  if (!/\bROLES_ANALITICA\b/.test(ladoDerecho)) return false;
  return !/['"`]/.test(ladoDerecho);
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

  it("(b1) el acceso es el dominio MENOS exactamente ROLES_SIN_ACCESO_ANALITICA, ni un rol más ni uno menos", () => {
    const excluidos = new Set<string>(ROLES_SIN_ACCESO_ANALITICA);
    const diferencia = [...dominio].filter((rol) => !acceso.has(rol)).sort();

    expect(
      diferencia,
      `La resta dominio∖acceso ya no coincide con ROLES_SIN_ACCESO_ANALITICA ` +
        `(${[...excluidos].sort().join(", ") || "vacía"}). O alguien le cerró/abrió la ` +
        `puerta del tablero a un rol sin declararlo en esa constante, o el \`.filter\` de ` +
        `${RUTA_MENU_VISIBILITY} dejó de aplicarse. Quién NO entra es una decisión humana ` +
        `y tiene que estar escrita en un solo sitio, legible: esa constante.`,
    ).toEqual([...excluidos].sort());

    // La otra mitad, explícita: nadie EXCLUIDO conserva la puerta.
    for (const rol of excluidos) {
      expect(acceso.has(rol), `El rol ${rol} está excluido y aun así tiene acceso.`).toBe(
        false,
      );
    }
  });

  it("(b2) la declaración del fuente DERIVA de ROLES_ANALITICA, nunca una lista de roles escrita a mano", () => {
    const ladoDerecho = ladoDerechoDeLaDeclaracion(fuenteMenuVisibility);
    expect(
      ladoDerecho,
      `No se encontró \`export const ROLES_ACCESO_ANALITICA = …;\` en ` +
        `${RUTA_MENU_VISIBILITY}. Si se renombró o se movió, este guard hay que ` +
        `reapuntarlo — no borrarlo.`,
    ).not.toBeNull();
    expect(
      derivaDeRolesAnalitica(ladoDerecho),
      `En ${RUTA_MENU_VISIBILITY}, ROLES_ACCESO_ANALITICA se declara como ` +
        `\`${ladoDerecho}\`, que no deriva de ROLES_ANALITICA o nombra roles a mano. ` +
        `Escribir los roles a mano compila, pasa el typecheck y pasa todos los tests de ` +
        `comportamiento, y aun así reintroduce el problema: dos listas gemelas con ` +
        `significados distintos ("quién entra" y "quién ve qué"), libres de divergir en ` +
        `silencio — un rol nuevo del dominio se quedaría sin puerta sin que nada se ponga ` +
        `rojo. Debe DERIVARSE del dominio restándole ROLES_SIN_ACCESO_ANALITICA.`,
    ).toBe(true);
  });

  it("el conjunto de acceso no está vacío (un guard sobre el conjunto vacío pasaría por vacuidad)", () => {
    expect(acceso.size).toBeGreaterThan(0);
  });

  // Contrapesos de (b1): sin ellos, una resta VACÍA (la igualdad de la 133 disfrazada de
  // decisión) o una que se comiera el dominio entero pasarían (b1) sin decir nada.
  it("la lista de excluidos no está vacía y todos sus roles pertenecen al dominio", () => {
    expect(ROLES_SIN_ACCESO_ANALITICA.length).toBeGreaterThan(0);
    for (const rol of ROLES_SIN_ACCESO_ANALITICA) {
      expect(
        dominio.has(rol),
        `${rol} se excluye del acceso pero no está en ROLES_ANALITICA: no resta nada.`,
      ).toBe(true);
    }
    // Subconjunto ESTRICTO: la resta muerde de verdad, y no se lo lleva todo.
    expect(acceso.size).toBeLessThan(dominio.size);
  });

  // AUTOCOMPROBACIÓN del censo (b2). Sin esto, un regex que dejara de casar —o una
  // ruta mal calculada— dejaría el caso (b2) en verde para siempre por vacío, que es
  // justo la forma en que un guard muere sin que nadie se entere. Mismo patrón que el
  // bloque final de `tests/unit/analytics/modulo-puro.guardia.test.ts`.
  describe("autocomprobación: el censo (b2) detecta de verdad la mutación", () => {
    const restado =
      `export const ROLES_ACCESO_ANALITICA: readonly RolAnalitica[] = ROLES_ANALITICA.filter(` +
      `(rol) => !(ROLES_SIN_ACCESO_ANALITICA as readonly string[]).includes(rol));`;
    const copiado =
      `export const ROLES_ACCESO_ANALITICA = ` +
      `["maestro", "admin", "adminSatelite", "adminTienda"] as const;`;

    it("acepta la resta (con y sin anotación de tipo) y la derivación desnuda", () => {
      expect(derivaDeRolesAnalitica(ladoDerechoDeLaDeclaracion(restado))).toBe(true);
      expect(
        derivaDeRolesAnalitica(
          ladoDerechoDeLaDeclaracion(`export const ROLES_ACCESO_ANALITICA = ROLES_ANALITICA;`),
        ),
      ).toBe(true);
    });

    it("rechaza la lista escrita a mano, aunque su contenido sea el correcto de hoy", () => {
      expect(derivaDeRolesAnalitica(ladoDerechoDeLaDeclaracion(copiado))).toBe(false);
    });

    it("rechaza la MEZCLA: derivar y además nombrar un rol a mano", () => {
      // Pasa la mitad (1) del predicado —menciona `ROLES_ANALITICA`— y sigue siendo una
      // segunda enumeración de roles. La comilla es lo que la delata.
      expect(
        derivaDeRolesAnalitica(
          ladoDerechoDeLaDeclaracion(
            `export const ROLES_ACCESO_ANALITICA = [...ROLES_ANALITICA, "apiKey"] as const;`,
          ),
        ),
      ).toBe(false);
    });

    it("rechaza el fuente donde la declaración no existe, y el que no menciona el dominio", () => {
      expect(ladoDerechoDeLaDeclaracion(`export const OTRA_COSA = 1;`)).toBeNull();
      expect(derivaDeRolesAnalitica(null)).toBe(false);
      expect(
        derivaDeRolesAnalitica(
          ladoDerechoDeLaDeclaracion(`export const ROLES_ACCESO_ANALITICA = OTRA_LISTA;`),
        ),
      ).toBe(false);
    });

    it("ignora los comentarios: la cabecera puede citar la forma prohibida", () => {
      const conComentario =
        `// no escribir ["maestro","admin","adminSatelite","adminTienda"]\n` + restado;
      expect(derivaDeRolesAnalitica(ladoDerechoDeLaDeclaracion(conComentario))).toBe(true);
    });
  });
});
