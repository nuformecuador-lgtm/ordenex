import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";

import {
  ROLES_HISTORIAL_ACCIONES,
  ROLES_HISTORICO_CONVERSACIONES,
  SIDEBAR_ITEMS,
  hijosVisibles,
  itemsVisibles,
  primerDestino,
  puedeVer,
  puedeVerSubitem,
  type MenuItem,
} from "@/lib/auth/menu-visibility";

// ⭑ FICHA 362 / T5.2 (R19/R20) — EL SUBÍTEM «Acciones» Y QUIÉN LO VE.
//
// Esta es la mitad de pantalla del pedido humano: el historial lo lee SOLO el maestro, porque
// el registro guarda las decisiones de dinero que toma el ADMIN y no puede ser el admin quien
// revise su propio registro.
//
// LO QUE NO PUEDE PASAR, y es lo que estos casos cierran: que al admin se le ENSEÑE el ítem y
// al entrar reciba un 404. Un menú que ofrece lo que no se puede abrir es peor que no
// ofrecerlo — el usuario no concluye «no tengo permiso», concluye «esto está roto».
//
// La otra mitad —que la RUTA le responde 404— vive en
// `tests/components/HistorialAccionesPage.test.tsx`; las dos leen la MISMA constante y por eso
// no pueden divergir (R19).

const LABEL_PADRE = "Histórico";
const LABEL_HIJO = "Acciones";
const HREF_HIJO = "/historico/acciones";

const TODOS: readonly RolValue[] = [
  "maestro",
  "admin",
  "mensajero",
  "adminTienda",
  "adminSatelite",
  "apiKey",
];

const actor = (rol: RolValue) => ({ usuarioId: "u1", rol });

/** El ítem «Histórico» tal como lo DECLARA el árbol (sin podar). */
function itemHistorico(): MenuItem {
  const item = SIDEBAR_ITEMS.find((i) => i.label === LABEL_PADRE);
  if (!item) throw new Error("el ítem «Histórico» no está en SIDEBAR_ITEMS");
  return item;
}

/** Los subítems que ese rol vería, ya podados por `itemsVisibles`. */
function subitemsDe(rol: RolValue | null): readonly { label: string; href: string }[] {
  const visto = itemsVisibles(SIDEBAR_ITEMS, rol === null ? null : actor(rol)).find(
    (i) => i.label === LABEL_PADRE,
  );
  return visto?.children ?? [];
}

describe("declaración del subítem", () => {
  it("cuelga del apartado «Histórico» ya existente y va SEGUNDO (R20)", () => {
    const hijos = itemHistorico().children ?? [];
    expect(hijos.map((h) => h.label)).toEqual(["Conversaciones", "Acciones"]);
    expect(hijos[1]?.href).toBe(HREF_HIJO);
  });

  it("declara `roles` PROPIOS, y son la CONSTANTE (no una copia de su contenido de hoy)", () => {
    const acciones = (itemHistorico().children ?? []).find((h) => h.label === LABEL_HIJO);
    // `toBe` y no `toEqual`: se afirma la IDENTIDAD de la referencia. Un `["maestro"]` escrito
    // a mano pasaría un `toEqual` y divergiría el día que la constante cambie.
    expect(acciones?.roles).toBe(ROLES_HISTORIAL_ACCIONES);
  });

  it("«Conversaciones» sigue SIN `roles` propios: hereda del padre (321/R3)", () => {
    const conv = (itemHistorico().children ?? []).find((h) => h.label === "Conversaciones");
    expect(conv?.roles).toBeUndefined();
  });

  it("⚠️ ningún PRIMER subítem del menú declara `roles` propios", () => {
    // `primerDestino` devuelve `children[0].href` del primer ítem visible. Un primer subítem
    // restringido mandaría a un 404 post-login a un rol que sí ve el padre — la mitad del
    // agujero que abre `MenuChild.roles`, cerrada aquí para TODO el menú y no sólo para este
    // ítem.
    for (const item of SIDEBAR_ITEMS) {
      const primero = item.children?.[0];
      if (!primero) continue;
      expect(primero.roles, `${item.label} › ${primero.label}`).toBeUndefined();
    }
  });
});

describe("⭑ quién ve el subítem: solo el maestro", () => {
  it("el MAESTRO ve los dos subítems", () => {
    expect(subitemsDe("maestro").map((h) => h.label)).toEqual([
      "Conversaciones",
      "Acciones",
    ]);
  });

  it("⭑ el ADMIN ve el apartado, pero NO ve «Acciones»", () => {
    const suyos = subitemsDe("admin");
    expect(suyos.map((h) => h.label)).toEqual(["Conversaciones"]);
    expect(suyos.some((h) => h.href === HREF_HIJO)).toBe(false);
  });

  it("⭑ el ADMIN no ve la ruta por NINGUNA vía del menú", () => {
    // La forma en que esto se rompería sin que nada más lo notara: podar sólo en el `Sidebar`
    // y dejar el árbol sin podar para el resto de consumidores. Se barre el menú ENTERO del
    // admin, ítems y subítems, buscando el `href`.
    const suyo = itemsVisibles(SIDEBAR_ITEMS, actor("admin"));
    const hrefs = suyo.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]);
    expect(hrefs).not.toContain(HREF_HIJO);
    // Anti-vacuidad: el admin SÍ ve el resto del apartado, así que el `not.toContain` no está
    // pasando porque la lista esté vacía.
    expect(hrefs).toContain("/historico/conversaciones");
  });

  for (const rol of TODOS.filter((r) => r !== "maestro")) {
    it(`${rol} NO llega a ${HREF_HIJO} por el menú`, () => {
      const hrefs = itemsVisibles(SIDEBAR_ITEMS, actor(rol)).flatMap((i) => [
        i.href,
        ...(i.children ?? []).map((c) => c.href),
      ]);
      expect(hrefs).not.toContain(HREF_HIJO);
    });
  }

  it("sin sesión no se ve nada, tampoco el subítem", () => {
    expect(subitemsDe(null)).toEqual([]);
  });

  it("la regla de herencia, afirmada directamente", () => {
    const padre = itemHistorico();
    const conv = (padre.children ?? [])[0];
    const acc = (padre.children ?? [])[1];
    if (!conv || !acc) throw new Error("faltan subítems");

    // Sin `roles` propios manda el padre…
    expect(puedeVerSubitem(conv, padre, actor("admin"))).toBe(true);
    expect(puedeVerSubitem(conv, padre, actor("maestro"))).toBe(true);
    // …con `roles` propios mandan los suyos.
    expect(puedeVerSubitem(acc, padre, actor("admin"))).toBe(false);
    expect(puedeVerSubitem(acc, padre, actor("maestro"))).toBe(true);
    expect(puedeVerSubitem(acc, padre, null)).toBe(false);
  });
});

describe("R20 — el aterrizaje post-login no cambia para NADIE", () => {
  // Los destinos van escritos A MANO y no derivados de `primerDestino`: derivarlos sería
  // comparar la función consigo misma y el caso no podría ponerse rojo nunca.
  const ATERRIZAJES: ReadonlyArray<[RolValue, string | null]> = [
    ["maestro", "/dashboard"],
    ["admin", "/dashboard"],
    ["adminTienda", "/ordenes"],
    ["mensajero", "/mis-asignaciones/reparto"],
    ["adminSatelite", "/recepcion-satelite/por-recibir"],
  ];

  for (const [rol, esperado] of ATERRIZAJES) {
    it(`${rol} sigue aterrizando en ${esperado}`, () => {
      expect(primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor(rol)))).toBe(esperado);
    });
  }

  it("el apartado «Histórico» sigue siendo el ÚLTIMO de quien lo ve", () => {
    // La posición es lo que hace que añadir un subítem no mueva el aterrizaje de nadie.
    for (const rol of ROLES_HISTORICO_CONVERSACIONES) {
      const visibles = itemsVisibles(SIDEBAR_ITEMS, actor(rol));
      expect(visibles.at(-1)?.label).toBe(LABEL_PADRE);
    }
  });
});

describe("un desplegable sin subítems visibles no se pinta", () => {
  it("el ítem cuyos únicos subítems están restringidos desaparece entero", () => {
    // Hoy no ocurre en el árbol real (por eso este caso construye el suyo), pero es la forma
    // de equivocarse que abre `MenuChild.roles`: un disparador en la barra que despliega el
    // vacío. Vale la pena que sea imposible por construcción y no por vigilancia.
    const sintetico: MenuItem = {
      label: "Ejemplo",
      href: "/ejemplo",
      iconKey: "history",
      roles: ["maestro", "admin"],
      children: [{ label: "Solo maestro", href: "/ejemplo/x", roles: ["maestro"] }],
    };

    expect(puedeVer(sintetico, actor("maestro"))).toBe(true);
    expect(puedeVer(sintetico, actor("admin"))).toBe(false);
    expect(itemsVisibles([sintetico], actor("admin"))).toEqual([]);
    expect(hijosVisibles(sintetico, actor("admin"))).toEqual([]);
  });

  it("un ítem SIN subítems no cambia de comportamiento", () => {
    const sinHijos: MenuItem = {
      label: "Plano",
      href: "/plano",
      iconKey: "history",
      roles: ["admin"],
    };
    expect(puedeVer(sinHijos, actor("admin"))).toBe(true);
    // Y conserva su IDENTIDAD al pasar por el filtro: nada se reescribe sin necesidad.
    expect(itemsVisibles([sinHijos], actor("admin"))[0]).toBe(sinHijos);
  });

  it("un ítem cuyos subítems se ven TODOS conserva su identidad (no se reescribe)", () => {
    const visto = itemsVisibles(SIDEBAR_ITEMS, actor("maestro")).find(
      (i) => i.label === LABEL_PADRE,
    );
    expect(visto).toBe(itemHistorico());
  });
});
