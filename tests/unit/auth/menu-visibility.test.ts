import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";
import {
  puedeVer,
  itemsVisibles,
  SIDEBAR_ITEMS,
  type MenuItem,
} from "@/lib/auth/menu-visibility";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const actor = (rol: RolValue): Actor => ({ usuarioId: "u1", rol });

const [config, perfil, ordenes] = SIDEBAR_ITEMS;

const labels = (items: readonly MenuItem[]): string[] =>
  items.map((i) => i.label);

describe("puedeVer", () => {
  it("muestra el item cuando el rol del actor está autorizado", () => {
    expect(puedeVer(config, actor("maestro"))).toBe(true);
    expect(puedeVer(ordenes, actor("mensajero"))).toBe(true);
    expect(puedeVer(perfil, actor("adminSatelite"))).toBe(true);
  });

  it("oculta el item cuando el rol no está autorizado", () => {
    expect(puedeVer(config, actor("mensajero"))).toBe(false);
    expect(puedeVer(config, actor("adminTienda"))).toBe(false);
    expect(puedeVer(config, actor("adminSatelite"))).toBe(false);
    expect(puedeVer(ordenes, actor("adminSatelite"))).toBe(false);
  });

  it("oculta todo cuando no hay actor (sesión ausente o inválida)", () => {
    expect(puedeVer(config, null)).toBe(false);
    expect(puedeVer(perfil, null)).toBe(false);
    expect(puedeVer(ordenes, null)).toBe(false);
  });
});

describe("itemsVisibles por rol (mapeo real de SIDEBAR_ITEMS)", () => {
  it("maestro ve los 3 ítems (Configuración, Perfil, Órdenes)", () => {
    expect(labels(itemsVisibles(SIDEBAR_ITEMS, actor("maestro")))).toEqual([
      "Configuración",
      "Perfil",
      "Órdenes",
    ]);
  });

  it("admin ve Perfil + Órdenes, NO Configuración", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("admin")));
    expect(visibles).toEqual(["Perfil", "Órdenes"]);
    expect(visibles).not.toContain("Configuración");
  });

  it("adminTienda ve Perfil + Órdenes, NO Configuración", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("adminTienda")));
    expect(visibles).toEqual(["Perfil", "Órdenes"]);
    expect(visibles).not.toContain("Configuración");
  });

  it("mensajero ve Perfil + Órdenes, NO Configuración", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("mensajero")));
    expect(visibles).toEqual(["Perfil", "Órdenes"]);
    expect(visibles).not.toContain("Configuración");
  });

  it("adminSatelite ve solo Perfil", () => {
    expect(labels(itemsVisibles(SIDEBAR_ITEMS, actor("adminSatelite")))).toEqual(
      ["Perfil"],
    );
  });

  it("sin actor no ve ningún ítem", () => {
    expect(itemsVisibles(SIDEBAR_ITEMS, null)).toEqual([]);
  });

  it("conserva los children del ítem padre visible (Configuración → Usuarios/Tarifas/API)", () => {
    const [visibleConfig] = itemsVisibles(SIDEBAR_ITEMS, actor("maestro"))
      .filter((i) => i.label === "Configuración");
    expect(visibleConfig.children?.map((c) => c.href)).toEqual([
      "/configuracion",
      "/configuracion/tarifas",
      "/configuracion/api",
    ]);
  });

  it("Órdenes ya no tiene submenú (el listado vive en el ítem padre)", () => {
    const [ordenes] = itemsVisibles(SIDEBAR_ITEMS, actor("mensajero")).filter(
      (i) => i.label === "Órdenes",
    );
    expect(ordenes.children).toBeUndefined();
    expect(ordenes.href).toBe("/ordenes");
  });
});
