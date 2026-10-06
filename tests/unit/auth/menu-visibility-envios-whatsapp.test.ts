import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";

import { SIDEBAR_ITEMS, itemsVisibles, primerDestino } from "@/lib/auth/menu-visibility";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Ficha 474 (R2) — la entrada «Envíos automáticos» vive DENTRO de «Configuración», la ve solo quien
// ve ese menú (maestro) y no cambia el destino inicial tras el login de NINGÚN rol.

const actor = (rol: RolValue): Actor => ({ usuarioId: "u1", rol });
const TODOS: readonly RolValue[] = ["maestro", "admin", "mensajero", "adminTienda", "adminSatelite", "apiKey"];
const HREF = "/configuracion/envios-whatsapp";

function hrefsVisibles(rol: RolValue): string[] {
  return itemsVisibles(SIDEBAR_ITEMS, actor(rol)).flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]);
}

describe("R2 — «Envíos automáticos» en Configuración", () => {
  it("el maestro lo ve como hijo de «Configuración», justo después de «Plantillas» (maqueta)", () => {
    const config = itemsVisibles(SIDEBAR_ITEMS, actor("maestro")).find((i) => i.label === "Configuración");
    const hijos = config?.children ?? [];
    const i = hijos.findIndex((c) => c.href === HREF);
    expect(i).toBeGreaterThan(0);
    expect(hijos[i]).toEqual({ label: "Envíos automáticos", href: HREF });
    expect(hijos[i - 1].href).toBe("/configuracion/plantillas");
  });

  it("ningún otro rol lo ve", () => {
    for (const rol of TODOS.filter((r) => r !== "maestro")) {
      expect(hrefsVisibles(rol)).not.toContain(HREF);
    }
  });

  it("no es el destino inicial de ningún rol tras el login", () => {
    for (const rol of TODOS) {
      expect(primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor(rol)))).not.toBe(HREF);
    }
    // Y el del maestro sigue siendo el primer hijo de Configuración o anterior: no es este.
    const config = SIDEBAR_ITEMS.find((i) => i.label === "Configuración");
    expect(config?.children?.[0].href).toBe("/configuracion");
  });
});
