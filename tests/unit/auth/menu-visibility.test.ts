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

// Referencias por LABEL (no por posicion): el orden de SIDEBAR_ITEMS puede
// cambiar sin romper estas pruebas mientras las etiquetas se mantengan.
const byLabel = (label: string): MenuItem => {
  const it = SIDEBAR_ITEMS.find((i) => i.label === label);
  if (!it) throw new Error(`sin item ${label}`);
  return it;
};
const ordenes = byLabel("Órdenes");
const entregas = byLabel("Entregas");
const config = byLabel("Configuración");
const perfil = byLabel("Perfil");
const cierreDia = byLabel("Cierre del día");
const cierresAdmin = byLabel("Cierres del día");

const labels = (items: readonly MenuItem[]): string[] =>
  items.map((i) => i.label);

describe("puedeVer", () => {
  it("muestra el item cuando el rol del actor está autorizado", () => {
    expect(puedeVer(config, actor("maestro"))).toBe(true);
    expect(puedeVer(ordenes, actor("adminTienda"))).toBe(true);
    expect(puedeVer(perfil, actor("adminSatelite"))).toBe(true);
    expect(puedeVer(cierreDia, actor("mensajero"))).toBe(true);
    // Feature 61: "Entregas" (portal del mensajero) es exclusivo del mensajero.
    expect(puedeVer(entregas, actor("mensajero"))).toBe(true);
    // "Cierres del día" (admin) es visible para maestro y adminSatelite (R1).
    expect(puedeVer(cierresAdmin, actor("maestro"))).toBe(true);
    expect(puedeVer(cierresAdmin, actor("adminSatelite"))).toBe(true);
  });

  it("oculta el item cuando el rol no está autorizado", () => {
    expect(puedeVer(config, actor("mensajero"))).toBe(false);
    expect(puedeVer(config, actor("adminTienda"))).toBe(false);
    expect(puedeVer(config, actor("adminSatelite"))).toBe(false);
    expect(puedeVer(ordenes, actor("adminSatelite"))).toBe(false);
    // Feature 61: "Entregas" NO lo ven roles distintos del mensajero.
    expect(puedeVer(entregas, actor("maestro"))).toBe(false);
    expect(puedeVer(entregas, actor("admin"))).toBe(false);
    expect(puedeVer(entregas, actor("adminTienda"))).toBe(false);
    expect(puedeVer(entregas, actor("adminSatelite"))).toBe(false);
    // "Cierre del día" es exclusivo del mensajero (R1).
    expect(puedeVer(cierreDia, actor("maestro"))).toBe(false);
    expect(puedeVer(cierreDia, actor("adminSatelite"))).toBe(false);
    // "Cierres del día" (admin) NO lo ve el mensajero ni otros roles.
    expect(puedeVer(cierresAdmin, actor("mensajero"))).toBe(false);
    expect(puedeVer(cierresAdmin, actor("admin"))).toBe(false);
    expect(puedeVer(cierresAdmin, actor("adminTienda"))).toBe(false);
  });

  it("oculta todo cuando no hay actor (sesión ausente o inválida)", () => {
    expect(puedeVer(config, null)).toBe(false);
    expect(puedeVer(perfil, null)).toBe(false);
    expect(puedeVer(ordenes, null)).toBe(false);
  });
});

describe("itemsVisibles por rol (mapeo real de SIDEBAR_ITEMS)", () => {
  it("maestro ve Órdenes, Configuración, Cierres del día, QR y Perfil en orden real", () => {
    // PR #75: "QR" (roles: ROLES_SEED) se intercala antes de "Perfil".
    expect(labels(itemsVisibles(SIDEBAR_ITEMS, actor("maestro")))).toEqual([
      "Órdenes",
      "Configuración",
      "Cierres del día",
      "QR",
      "Perfil",
    ]);
  });

  it("admin ve Órdenes + QR + Perfil, NO Configuración", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("admin")));
    expect(visibles).toEqual(["Órdenes", "QR", "Perfil"]); // PR #75: QR
    expect(visibles).not.toContain("Configuración");
  });

  it("adminTienda ve Órdenes + QR + Perfil, NO Configuración", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("adminTienda")));
    expect(visibles).toEqual(["Órdenes", "QR", "Perfil"]); // PR #75: QR
    expect(visibles).not.toContain("Configuración");
  });

  it("mensajero ve Entregas + Cierre del día + QR + Perfil, NO Órdenes ni Configuración", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("mensajero")));
    // Feature 61: el mensajero usa "Entregas" (su portal); ya NO ve "Órdenes"
    // (lista genérica reservada a maestro/admin/adminTienda).
    // PR #75: "QR" es visible para todos los roles (ROLES_SEED).
    expect(visibles).toEqual(["Entregas", "Cierre del día", "QR", "Perfil"]);
    expect(visibles).not.toContain("Órdenes");
    expect(visibles).not.toContain("Configuración");
  });

  it("adminSatelite ve Asignaciones + Cierres del día + QR + Perfil", () => {
    expect(labels(itemsVisibles(SIDEBAR_ITEMS, actor("adminSatelite")))).toEqual(
      ["Asignaciones", "Cierres del día", "QR", "Perfil"], // PR #75: QR
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
    const [ordenes] = itemsVisibles(SIDEBAR_ITEMS, actor("adminTienda")).filter(
      (i) => i.label === "Órdenes",
    );
    expect(ordenes.children).toBeUndefined();
    expect(ordenes.href).toBe("/ordenes");
  });
});
