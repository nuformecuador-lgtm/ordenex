import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";

import {
  itemsVisibles,
  primerDestino,
  ROLES_MI_BODEGA,
  SIDEBAR_ITEMS,
} from "@/lib/auth/menu-visibility";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T23 — «Mi bodega» ENTRA AL FINAL, Y NADIE CAMBIA DE PUERTA DE ENTRADA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTE ARCHIVO EXISTE. `/dashboard` no es una pantalla: redirige a
// `primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor))`, o sea al primer item ELEGIBLE de la barra
// de cada rol. Un item nuevo colocado ANTES de los que ya estaban cambia EN SILENCIO donde
// aterriza ese rol al entrar — ya paso dos veces en este repo (Analitica/133 y Monitoreo/192) y
// las dos veces se descubrio despues.
//
// La ficha 429 mete un item visible SOLO para `adminSatelite`, que es justo el rol que en las dos
// ocasiones anteriores se llevo el desvio. Aqui se ancla que no vuelve a pasar, y se ancla por
// DOS vias distintas a proposito:
//
//   1. LOS CINCO DESTINOS, escritos como LITERALES (igual que `destino-post-login.test.ts`).
//      Derivarlos de `primerDestino` seria una tautologia: pasaria igual con el destino correcto
//      que con cualquier otro.
//   2. LA POSICION del item en el array, afirmada por indice. Es la causa, no el sintoma: si
//      alguien lo sube de sitio, este caso lo dice aunque los cinco destinos siguieran cuadrando
//      por casualidad (porque el rol que lo ve tuviera otro item antes).
//
// Y una tercera cosa que NO es decorativa: el item NO lleva `destinoInicial: false`. La marca es
// para lo que NO puede ser aterrizaje, y aqui la posicion ya protege el aterrizaje. Ademas
// `destino-post-login.test.ts` afirma con un `toEqual` LITERAL que los marcados son EXACTAMENTE
// `["/analitica", "/monitoreo"]`: marcarlo pondria rojo ese caso sin que nadie hubiera decidido
// nada.

const actor = (rol: RolValue): Actor => ({ usuarioId: "u1", rol });

const destinoDe = (rol: RolValue): string | null =>
  primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor(rol)));

const itemMiBodega = () => SIDEBAR_ITEMS.filter((i) => i.href === "/mi-bodega");

describe("429/T23 — el item «Mi bodega»", () => {
  it("existe EXACTAMENTE una vez, con su etiqueta", () => {
    expect(itemMiBodega()).toHaveLength(1);
    expect(itemMiBodega()[0].label).toBe("Mi bodega");
  });

  it("⭑ va AL FINAL de `SIDEBAR_ITEMS`, que es lo que protege el aterrizaje de todos", () => {
    // 2026-09-16 · ficha 433: ESTE LITERAL SE CAMBIO A MANO, que es para lo que el caso existe.
    // Entro un item DETRAS —«Ayuda»—, asi que «Mi bodega» pasa a ser el PENULTIMO. La decision
    // es que «Ayuda» vaya la ultima: es el unico item visible para los CINCO roles, y arriba
    // habria pasado a ser el aterrizaje post-login de todos ellos, mientras que «Mi bodega» solo
    // la ve el `adminSatelite`. Lo que este caso protegia —que detras de «Mi bodega» no entre
    // nada que le robe el aterrizaje al `adminSatelite`— lo sigue cubriendo el caso de abajo
    // («lo ve el ULTIMO de su barra») y el bloque de aterrizajes, que no se movio ni un valor.
    expect(SIDEBAR_ITEMS[SIDEBAR_ITEMS.length - 1].href).toBe("/ayuda");
    expect(SIDEBAR_ITEMS[SIDEBAR_ITEMS.length - 2].href).toBe("/mi-bodega");
  });

  it("⭑ apunta a LA CONSTANTE compartida con el gate de la pagina, no a un literal copiado", () => {
    // `toBe` y no `toEqual`: se afirma la MISMA REFERENCIA. Un `["adminSatelite"]` escrito a mano
    // aqui pasaria un `toEqual` y seria una segunda lista capaz de divergir del gate sin que nada
    // se pusiera rojo (el precedente es la ficha 335).
    expect(itemMiBodega()[0].roles).toBe(ROLES_MI_BODEGA);
    expect(ROLES_MI_BODEGA).toEqual(["adminSatelite"]);
  });

  it("⭑ NO lleva `destinoInicial: false`: la posicion ya protege el aterrizaje", () => {
    expect(itemMiBodega()[0].destinoInicial).toBeUndefined();
  });

  it("solo lo ve el `adminSatelite`; los otros cuatro roles no", () => {
    const loVe = (rol: RolValue) =>
      itemsVisibles(SIDEBAR_ITEMS, actor(rol)).some((i) => i.href === "/mi-bodega");

    expect(loVe("adminSatelite")).toBe(true);
    for (const rol of ["maestro", "admin", "adminTienda", "mensajero"] as RolValue[]) {
      expect(loVe(rol), rol).toBe(false);
    }
  });

  it("⭑ y lo ve AL FINAL de su barra, que es donde se decidio ponerlo", () => {
    // 2026-09-16 · ficha 433: cambiado a mano. «Ayuda» la ven los cinco roles, asi que tambien
    // aparece en la barra del `adminSatelite`, detras de «Mi bodega». Lo que importa —que «Mi
    // bodega» NO sea el primero de su barra, porque entonces seria su aterrizaje— no cambia.
    const suyos = itemsVisibles(SIDEBAR_ITEMS, actor("adminSatelite"));
    expect(suyos[suyos.length - 1].href).toBe("/ayuda");
    expect(suyos[suyos.length - 2].href).toBe("/mi-bodega");
    expect(suyos[0].href).not.toBe("/mi-bodega");
  });
});

describe("429/T23 — el aterrizaje post-login de los cinco roles NO se mueve", () => {
  // Valores escritos A MANO, verificados leyendo `SIDEBAR_ITEMS`. PROHIBIDO derivarlos de
  // `primerDestino`, de `itemsVisibles` o de `SIDEBAR_ITEMS`: eso es la tautologia que el
  // archivo hermano (`destino-post-login.test.ts`) documenta como el defecto que cerro la 133.
  it("maestro sigue aterrizando en /dashboard", () => {
    expect(destinoDe("maestro")).toBe("/dashboard");
  });

  it("admin sigue aterrizando en /dashboard", () => {
    expect(destinoDe("admin")).toBe("/dashboard");
  });

  it("adminTienda sigue aterrizando en /ordenes", () => {
    expect(destinoDe("adminTienda")).toBe("/ordenes");
  });

  it("⭑ adminSatelite sigue aterrizando en /recepcion-satelite/por-recibir, NO en /mi-bodega", () => {
    // Es el rol que gana el item, o sea el unico que podia desviarse. La segunda asercion es la
    // que muerde: sin ella, el caso pasaria igual si el destino hubiera cambiado a otra cosa.
    expect(destinoDe("adminSatelite")).toBe("/recepcion-satelite/por-recibir");
    expect(destinoDe("adminSatelite")).not.toBe("/mi-bodega");
  });

  it("mensajero sigue aterrizando en /mis-asignaciones/reparto", () => {
    expect(destinoDe("mensajero")).toBe("/mis-asignaciones/reparto");
  });

  it("NINGUNO de los cinco aterriza en /mi-bodega", () => {
    for (const rol of [
      "maestro",
      "admin",
      "adminTienda",
      "adminSatelite",
      "mensajero",
    ] as RolValue[]) {
      expect(destinoDe(rol), rol).not.toBe("/mi-bodega");
    }
  });
});

describe("429/T21-B — el subitem «SINPE por bodega» de Configuracion", () => {
  const configuracion = () =>
    SIDEBAR_ITEMS.find((i) => i.href === "/configuracion")!;

  it("existe, con su etiqueta, y es EL ULTIMO hijo", () => {
    // Igual que «Geografia» (374/R46): `primerDestino` mira el PRIMER hijo del primer item
    // visible, asi que un hijo añadido al final no puede mover el aterrizaje de nadie.
    const hijos = configuracion().children!;
    expect(hijos[hijos.length - 1]).toEqual({
      label: "SINPE por bodega",
      href: "/configuracion/sinpe",
    });
  });

  it("NO declara roles propios: hereda los del padre y no hay una segunda lista", () => {
    const hijo = configuracion().children!.find(
      (c) => c.href === "/configuracion/sinpe",
    )!;
    expect(hijo.roles).toBeUndefined();
  });

  it("y el primer hijo de Configuracion sigue siendo `/configuracion`", () => {
    // La otra mitad de lo de arriba: si el orden se invirtiera, el maestro aterrizaria en el
    // SINPE el dia que Configuracion fuera su primer item visible.
    expect(configuracion().children![0].href).toBe("/configuracion");
  });
});
