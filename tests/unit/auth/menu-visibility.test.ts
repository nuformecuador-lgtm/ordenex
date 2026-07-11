import { describe, it, expect } from "vitest";
import {
  puedeVer,
  itemsVisibles,
  type MenuItem,
} from "@/lib/auth/menu-visibility";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const soloMaestro: MenuItem = {
  label: "Configuración",
  href: "/configuracion",
  roles: ["maestro"],
};
const ordenes: MenuItem = {
  label: "Órdenes",
  href: "/ordenes",
  roles: ["maestro", "admin", "adminTienda", "mensajero"],
};
const items = [soloMaestro, ordenes] as const;

const actor = (rol: Actor["rol"]): Actor => ({ usuarioId: "u1", rol });

describe("puedeVer", () => {
  it("muestra el item cuando el rol del actor está autorizado", () => {
    expect(puedeVer(soloMaestro, actor("maestro"))).toBe(true);
    expect(puedeVer(ordenes, actor("mensajero"))).toBe(true);
  });

  it("oculta el item cuando el rol no está autorizado", () => {
    expect(puedeVer(soloMaestro, actor("mensajero"))).toBe(false);
    expect(puedeVer(soloMaestro, actor("adminTienda"))).toBe(false);
  });

  it("oculta todo cuando no hay actor (sesión ausente o inválida)", () => {
    expect(puedeVer(soloMaestro, null)).toBe(false);
    expect(puedeVer(ordenes, null)).toBe(false);
  });
});

describe("itemsVisibles", () => {
  it("maestro ve todos los items del ejemplo", () => {
    expect(itemsVisibles(items, actor("maestro"))).toEqual([soloMaestro, ordenes]);
  });

  it("mensajero ve solo Órdenes, no Configuración", () => {
    const visibles = itemsVisibles(items, actor("mensajero"));
    expect(visibles).toEqual([ordenes]);
    expect(visibles).not.toContain(soloMaestro);
  });

  it("sin actor no ve ningún item", () => {
    expect(itemsVisibles(items, null)).toEqual([]);
  });
});
