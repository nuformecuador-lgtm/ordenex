import { describe, it, expect } from "vitest";

import { ROLES_ANALITICA as ROLES_DOMINIO_ANALITICA } from "@/lib/analytics/types";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";

// GUARD DE NO-CONVERGENCIA (deuda técnica saldada el 2026-07-31).
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
// mantengan la relación que tienen. Este guard es lo que la fija. Falla si:
//
//   (a) algún rol con ACCESO no está en el conjunto del DOMINIO — es decir,
//       alguien puede entrar al tablero pero la analítica no sabe qué
//       enseñarle; o
//   (b) los dos conjuntos se vuelven IGUALES — el momento exacto en que la
//       distinción entre "quién entra" y "quién ve qué" deja de existir y las
//       dos constantes vuelven a ser intercambiables, que es como empezó todo.
//
// La feature 133 va a ensanchar el conjunto de ACCESO. Puede hacerlo: lo que no
// puede es llevarlo hasta igualar el del dominio sin pasar por aquí y explicar
// por qué. Si algún día esa igualdad es la decisión correcta, la respuesta NO es
// borrar el guard: es fundir las dos constantes en una sola y dejar de tener
// dos conceptos donde hay uno.

const acceso = new Set<string>(ROLES_ACCESO_ANALITICA);
const dominio = new Set<string>(ROLES_DOMINIO_ANALITICA);

describe("guard: ROLES_ACCESO_ANALITICA ⊂ ROLES_ANALITICA (subconjunto ESTRICTO)", () => {
  it("(a) todo rol con acceso al tablero es un rol conocido por el dominio de analítica", () => {
    const huerfanos = [...acceso].filter((rol) => !dominio.has(rol));
    expect(
      huerfanos,
      `Roles en ROLES_ACCESO_ANALITICA (lib/auth/menu-visibility.ts) que NO están ` +
        `en ROLES_ANALITICA (lib/analytics/types.ts): ${huerfanos.join(", ")}. ` +
        `Entrarían al tablero sin que la analítica tenga definido su alcance.`,
    ).toEqual([]);
  });

  it("(b) los dos conjuntos NO son iguales: 'quién entra' y 'quién ve qué' siguen siendo preguntas distintas", () => {
    const soloEnDominio = [...dominio].filter((rol) => !acceso.has(rol));
    expect(
      soloEnDominio.length,
      `ROLES_ACCESO_ANALITICA y ROLES_ANALITICA se han vuelto el MISMO conjunto. ` +
        `Volvieron a ser dos nombres para una sola idea, que es la colisión que este ` +
        `guard existe para impedir: o el ensanche del acceso se pasó de la raya, o ha ` +
        `llegado el momento de fundir ambas constantes en una (y no de borrar el guard).`,
    ).toBeGreaterThan(0);
  });

  it("el conjunto de acceso no está vacío (un guard sobre el conjunto vacío pasaría por vacuidad)", () => {
    expect(acceso.size).toBeGreaterThan(0);
  });
});
