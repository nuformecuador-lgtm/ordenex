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
const inicio = byLabel("Inicio");
const ordenes = byLabel("Órdenes");
const entregas = byLabel("Entregas");
const config = byLabel("Configuración");
const perfil = byLabel("Perfil");
const cierreDia = byLabel("Cierre del día");
const cierresAdmin = byLabel("Cierres del día");
const novedades = byLabel("Novedades");
const wallet = byLabel("Wallet");
const ranking = byLabel("Ranking");

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
    // "Cierres del día" (admin) es visible para maestro, admin y adminSatelite (R1).
    expect(puedeVer(cierresAdmin, actor("maestro"))).toBe(true);
    expect(puedeVer(cierresAdmin, actor("admin"))).toBe(true);
    expect(puedeVer(cierresAdmin, actor("adminSatelite"))).toBe(true);
    // Feature 87 (R20): "Novedades" es exclusivo del adminTienda.
    expect(puedeVer(novedades, actor("adminTienda"))).toBe(true);
    // Feature 42 + 94 (paridad adm↔maestro): "Wallet" (caja principal) es visible
    // para maestro y admin.
    expect(puedeVer(wallet, actor("maestro"))).toBe(true);
    expect(puedeVer(wallet, actor("admin"))).toBe(true);
    // Feature 76 + 94: "Ranking" es visible para maestro, admin y mensajero.
    expect(puedeVer(ranking, actor("maestro"))).toBe(true);
    expect(puedeVer(ranking, actor("admin"))).toBe(true);
    expect(puedeVer(ranking, actor("mensajero"))).toBe(true);
    // Feature 92: "Inicio" (acceso a /dashboard) es visible para maestro y admin.
    expect(puedeVer(inicio, actor("maestro"))).toBe(true);
    expect(puedeVer(inicio, actor("admin"))).toBe(true);
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
    // "Cierres del día" (admin) NO lo ve el mensajero ni el adminTienda (feature 94:
    // el `admin` SÍ lo ve, se afirma en el bloque de arriba).
    expect(puedeVer(cierresAdmin, actor("mensajero"))).toBe(false);
    expect(puedeVer(cierresAdmin, actor("adminTienda"))).toBe(false);
    // Feature 87 (R20): el mensajero DEJA de ver "Novedades" (antes lo veía).
    expect(puedeVer(novedades, actor("mensajero"))).toBe(false);
    expect(puedeVer(novedades, actor("maestro"))).toBe(false);
    expect(puedeVer(novedades, actor("adminSatelite"))).toBe(false);
    // Feature 42 + 94: "Wallet" lo ven maestro/admin; NO adminTienda/adminSatelite/mensajero.
    expect(puedeVer(wallet, actor("adminTienda"))).toBe(false);
    expect(puedeVer(wallet, actor("adminSatelite"))).toBe(false);
    expect(puedeVer(wallet, actor("mensajero"))).toBe(false);
    // Feature 76 + 94: "Ranking" NO lo ven adminTienda ni adminSatelite.
    expect(puedeVer(ranking, actor("adminTienda"))).toBe(false);
    expect(puedeVer(ranking, actor("adminSatelite"))).toBe(false);
    // Feature 92: "Inicio" NO lo ven roles distintos de maestro/admin.
    expect(puedeVer(inicio, actor("adminTienda"))).toBe(false);
    expect(puedeVer(inicio, actor("mensajero"))).toBe(false);
    expect(puedeVer(inicio, actor("adminSatelite"))).toBe(false);
  });

  it("oculta todo cuando no hay actor (sesión ausente o inválida)", () => {
    expect(puedeVer(config, null)).toBe(false);
    expect(puedeVer(perfil, null)).toBe(false);
    expect(puedeVer(ordenes, null)).toBe(false);
    expect(puedeVer(novedades, null)).toBe(false);
    expect(puedeVer(wallet, null)).toBe(false);
  });
});

describe("itemsVisibles por rol (mapeo real de SIDEBAR_ITEMS)", () => {
  it("maestro ve Inicio, Órdenes, Wallet, Configuración, Cierres del día, QR y Perfil en orden real", () => {
    // PR #75: "QR" (roles: ROLES_SEED) se intercala antes de "Perfil".
    // Feature 42: "Wallet" (caja principal, solo maestro) va antes de "Configuración".
    // Feature 92: "Inicio" (acceso a /dashboard) va PRIMERO en SIDEBAR_ITEMS.
    expect(labels(itemsVisibles(SIDEBAR_ITEMS, actor("maestro")))).toEqual([
      "Inicio",
      "Órdenes",
      "Ranking",
      "Wallet",
      "Configuración",
      "Cierres del día",
      "QR",
      "Perfil",
    ]);
  });

  it("admin ve Inicio, Órdenes, Ranking, Wallet, Cierres del día, QR y Perfil, NO Configuración (paridad con maestro salvo Configuración)", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("admin")));
    // Feature 94 (paridad adm↔maestro): el admin ve Ranking, Wallet y Cierres del día
    // igual que el maestro; solo Configuración sigue siendo maestro-only.
    expect(visibles).toEqual([
      "Inicio",
      "Órdenes",
      "Ranking",
      "Wallet",
      "Cierres del día",
      "QR",
      "Perfil",
    ]);
    expect(visibles).not.toContain("Configuración");
  });

  it("adminTienda ve Órdenes + Novedades + QR + Perfil, NO Configuración", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("adminTienda")));
    expect(visibles).toEqual(["Órdenes", "Novedades", "QR", "Perfil"]);
    expect(visibles).not.toContain("Configuración");
    // "Ranking" es solo del maestro.
    expect(visibles).not.toContain("Ranking");
  });

  it("mensajero ve Entregas + Ranking + Cierre del día + QR + Perfil, NO Órdenes, Novedades ni Configuración", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("mensajero")));
    // Feature 61: el mensajero usa "Entregas" (su portal); ya NO ve "Órdenes"
    // (lista genérica reservada a maestro/admin/adminTienda).
    // PR #75: "QR" es visible para todos los roles (ROLES_SEED).
    // Feature 76 (R20): "Ranking" es visible para el mensajero en solo-lectura
    // (roles maestro+mensajero); su defensa real es el notFound de la página.
    // Feature 87 (R20): "Novedades" ahora es exclusivo del adminTienda; el
    // mensajero DEJA de verlo.
    expect(visibles).toEqual([
      "Entregas",
      "Ranking",
      "Cierre del día",
      "QR",
      "Perfil",
    ]);
    expect(visibles).not.toContain("Órdenes");
    expect(visibles).not.toContain("Novedades");
    expect(visibles).not.toContain("Configuración");
  });

  it("adminSatelite ve Órdenes + Cierres del día + QR + Perfil", () => {
    expect(labels(itemsVisibles(SIDEBAR_ITEMS, actor("adminSatelite")))).toEqual(
      ["Órdenes", "Cierres del día", "QR", "Perfil"], // PR #75: QR
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
