import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";

import {
  itemsVisibles,
  primerDestino,
  SIDEBAR_ITEMS,
} from "@/lib/auth/menu-visibility";
import { ROLES_AYUDA } from "@/lib/ayuda/documento";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// ⭑ FICHA 433 — EL ÍTEM «Ayuda», Y LA RAZÓN DE QUE VAYA EL ÚLTIMO.
//
// Es el ÚNICO ítem visible para los cinco roles a la vez. Eso lo convierte en el candidato
// perfecto a romper el aterrizaje post-login de TODO EL MUNDO: `primerDestino` devuelve el
// `href` del primer ítem visible no marcado `destinoInicial: false`, así que si «Ayuda»
// estuviera arriba, los cinco roles entrarían a leer documentación en vez de a trabajar — en
// silencio, porque ningún test de los que había miraba la posición de un ítem nuevo.
//
// Y la marca `destinoInicial: false` NO es la solución: `destino-post-login.test.ts` afirma
// con un `toEqual` LITERAL que los marcados son exactamente `["/analitica", "/monitoreo"]`.
// Lo que protege el aterrizaje aquí es LA POSICIÓN, y eso es lo que este archivo vigila.

const actor = (rol: RolValue): Actor => ({ usuarioId: "u1", rol });
const itemAyuda = SIDEBAR_ITEMS.find((item) => item.href === "/ayuda");

describe("R4 — el ítem «Ayuda»", () => {
  it("existe, se llama «Ayuda» y apunta a /ayuda", () => {
    expect(itemAyuda).toBeDefined();
    expect(itemAyuda?.label).toBe("Ayuda");
  });

  it("es EL ÚLTIMO de SIDEBAR_ITEMS", () => {
    expect(SIDEBAR_ITEMS[SIDEBAR_ITEMS.length - 1]?.href).toBe("/ayuda");
  });

  it("NO lleva destinoInicial: false (la posición ya protege el aterrizaje)", () => {
    // Si alguien se la pusiera «por si acaso», el `toEqual` literal de
    // `destino-post-login.test.ts` se pondría rojo sin que nadie hubiera decidido nada.
    expect(itemAyuda?.destinoInicial).toBeUndefined();
  });

  it("referencia ROLES_AYUDA por IDENTIDAD, no una copia que pueda divergir", () => {
    // `toBe` y no `toEqual`: una lista escrita a mano con los mismos cinco nombres pasaría un
    // `toEqual` y sería justo la segunda lista que este patrón existe para impedir.
    expect(itemAyuda?.roles).toBe(ROLES_AYUDA);
  });

  it("lo ven las CINCO cuentas de persona", () => {
    for (const rol of [
      "maestro",
      "admin",
      "mensajero",
      "adminTienda",
      "adminSatelite",
    ] as RolValue[]) {
      expect(
        itemsVisibles(SIDEBAR_ITEMS, actor(rol)).some((i) => i.href === "/ayuda"),
        `el rol ${rol} no ve «Ayuda»`,
      ).toBe(true);
    }
  });

  it("`apiKey` NO lo ve: es una cuenta de máquina y no navega la UI", () => {
    expect(itemsVisibles(SIDEBAR_ITEMS, actor("apiKey"))).toEqual([]);
  });
});

describe("R5 — ningún aterrizaje post-login cambia por culpa de este ítem", () => {
  // Literales escritos a mano, NO derivados: es la misma disciplina —y el mismo motivo— que
  // `destino-post-login.test.ts`. Se repiten aquí a propósito, para que este cambio tenga su
  // propia red y no dependa de que alguien recuerde correr el otro archivo.
  it.each([
    ["maestro", "/dashboard"],
    ["admin", "/dashboard"],
    ["adminTienda", "/ordenes"],
    ["adminSatelite", "/recepcion-satelite/por-recibir"],
    ["mensajero", "/mis-asignaciones/reparto"],
  ] as Array<[RolValue, string]>)("%s sigue aterrizando en %s", (rol, esperado) => {
    expect(primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor(rol)))).toBe(esperado);
  });

  it("NINGÚN rol aterriza en /ayuda", () => {
    for (const rol of [
      "maestro",
      "admin",
      "mensajero",
      "adminTienda",
      "adminSatelite",
      "apiKey",
    ] as RolValue[]) {
      expect(primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor(rol)))).not.toBe("/ayuda");
    }
  });

  it("`apiKey` SIGUE sin destino (null), que es lo que rompería meterlo en ROLES_AYUDA", () => {
    expect(primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor("apiKey")))).toBeNull();
  });
});
