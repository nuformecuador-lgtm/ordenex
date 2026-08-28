import { describe, it, expect } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RolValue } from "@prisma/client";

import {
  ROLES_HISTORICO_CONVERSACIONES,
  SIDEBAR_ITEMS,
  itemsVisibles,
  primerDestino,
  type MenuItem,
} from "@/lib/auth/menu-visibility";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

/**
 * Feature 318 — bloque 1 (T1.1, T1.2, T1.3): la CONSTANTE, el ÍTEM y el ATERRIZAJE.
 *
 * Los tres se afirman por COMPORTAMIENTO. Ninguna aserción de este archivo se satisface
 * reescribiendo un comentario ni comprobando que un archivo existe: hay precedente en
 * este repo de un criterio tipo grep que se cumplía editando la prosa que lo documentaba.
 *
 * La divergencia entre el `roles` del ítem y el gate de la ruta la vigila
 * `tests/unit/guards/historico-roles-una-sola-fuente.guardia.test.ts` (R8); aquí se
 * vigila que el ítem REFERENCIE la constante, que es la mitad de esa misma puerta.
 */

const LABEL = "Histórico";

const actor = (rol: RolValue): Actor => ({ usuarioId: "u1", rol });

const TODOS_LOS_ROLES: readonly RolValue[] = [
  "maestro",
  "admin",
  "mensajero",
  "adminTienda",
  "adminSatelite",
  "apiKey",
];

function itemHistorico(): MenuItem {
  const item = SIDEBAR_ITEMS.find((i) => i.label === LABEL);
  if (!item) throw new Error(`No existe el ítem «${LABEL}» en SIDEBAR_ITEMS`);
  return item;
}

describe("R1 — constante única de roles del histórico (T1.1)", () => {
  it("contiene exactamente admin y maestro", () => {
    expect([...ROLES_HISTORICO_CONVERSACIONES].sort()).toEqual(["admin", "maestro"]);
  });
});

describe("R2/R3 — el ítem «Histórico» y su subítem (T1.3)", () => {
  it("R2: el `roles` del ítem es LA MISMA REFERENCIA que la constante, no un literal copiado", () => {
    // `toBe` y no `toEqual` A PROPÓSITO: `toEqual` pasaría igual si alguien pegara
    // `["maestro","admin"]` a mano, que es exactamente la mutación que R2 prohíbe.
    expect(itemHistorico().roles).toBe(ROLES_HISTORICO_CONVERSACIONES);
  });

  it("R3: tiene exactamente un subítem «Conversaciones» que apunta a la ruta del histórico", () => {
    expect(itemHistorico().children).toEqual([
      { label: "Conversaciones", href: "/historico/conversaciones" },
    ]);
  });

  it("R3: el subítem NO declara `roles` propios (hereda la visibilidad del padre)", () => {
    const hijos = itemHistorico().children;
    expect(hijos).toBeDefined();
    expect("roles" in (hijos as readonly object[])[0]).toBe(false);
  });
});

describe("R4/R5 — visibilidad del ítem (T1.3)", () => {
  it("R4: sólo lo ven los roles de la whitelist; ningún otro rol lo recibe", () => {
    for (const rol of TODOS_LOS_ROLES) {
      expect(
        itemsVisibles(SIDEBAR_ITEMS, actor(rol)).some((i) => i.label === LABEL),
      ).toBe((["maestro", "admin"] as readonly string[]).includes(rol));
    }
  });

  it("R5: sin actor resuelto, el ítem no se muestra", () => {
    expect(itemsVisibles(SIDEBAR_ITEMS, null).some((i) => i.label === LABEL)).toBe(false);
  });
});

describe("R9 — el aterrizaje post-login NO cambia (T1.3)", () => {
  /**
   * Los destinos van ESCRITOS A MANO, nunca derivados de `primerDestino` ni de
   * `SIDEBAR_ITEMS`: derivarlos sería una tautología que pasaría igual si el ítem nuevo
   * moviera el aterrizaje de un rol. Mismo criterio —y misma tabla— que
   * `tests/unit/auth/destino-post-login.test.ts`.
   *
   * Si el ítem «Histórico» se moviera de la ÚLTIMA posición hacia arriba, este test se
   * pone rojo para `adminSatelite`, `adminTienda` y `mensajero`, que es justo el fallo
   * silencioso que R9 existe para impedir.
   */
  const DESTINOS: ReadonlyArray<readonly [RolValue, string | null]> = [
    ["maestro", "/dashboard"],
    ["admin", "/dashboard"],
    ["mensajero", "/mis-asignaciones/reparto"],
    ["adminSatelite", "/recepcion-satelite/por-recibir"],
    ["adminTienda", "/ordenes"],
    ["apiKey", null],
  ];

  for (const [rol, esperado] of DESTINOS) {
    it(`${rol} sigue aterrizando en ${esperado ?? "ningún destino"}`, () => {
      expect(primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor(rol)))).toBe(esperado);
    });
  }
});

describe("R6 — el icono viaja como clave serializable y el Sidebar la resuelve (T1.2)", () => {
  it("ningún ítem del menú exporta un componente de icono: `iconKey` es siempre string", () => {
    for (const it of SIDEBAR_ITEMS) {
      expect(typeof it.iconKey).toBe("string");
    }
  });

  it("`ICON_BY_KEY` del Sidebar resuelve la clave de TODOS los ítems, incluida `history`", async () => {
    // Import DINÁMICO y con forma comprobada en tiempo de ejecución: `ICON_BY_KEY` es hoy
    // un `const` interno de `Sidebar.tsx` y su exportación —junto con la entrada
    // `history: History`— es la tarea T1.2, que corre en paralelo. Escrito así, este `it`
    // se pone rojo hasta que esa tarea aterrice SIN arrastrar consigo el typecheck ni el
    // resto de este archivo.
    const mod = (await import("@/app/(app)/_components/Sidebar")) as unknown as {
      ICON_BY_KEY?: Record<string, unknown>;
    };
    const mapa = mod.ICON_BY_KEY;
    expect(mapa, "Sidebar.tsx debe exportar ICON_BY_KEY (T1.2)").toBeDefined();

    // La aserción es de COMPORTAMIENTO —cada entrada RENDERIZA un <svg>— y no
    // `toBeTypeOf("function")`: los iconos de lucide se construyen con `forwardRef`, así
    // que en runtime son OBJETOS, no funciones (medido el 2026-08-28: la versión previa de
    // este caso fallaba con «expected {…} to be type of 'function'» para TODAS las claves,
    // incluidas las que llevan años en el menú). Renderizar es además más fuerte: un objeto
    // cualquiera puesto en el mapa pasaría un `typeof`, pero revienta aquí.
    for (const it of SIDEBAR_ITEMS) {
      const Icono = mapa?.[it.iconKey] as ComponentType<{ className?: string }> | undefined;
      expect(Icono, `ICON_BY_KEY no resuelve la clave «${it.iconKey}»`).toBeDefined();
      const html = renderToStaticMarkup(createElement(Icono!, {}));
      expect(html, `la clave «${it.iconKey}» no pinta un icono`).toContain("<svg");
    }
  });
});
