import type { RolValue } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ROLES_SEED } from "@/lib/types/roles";

/**
 * Clave string del icono de un item. El icono real (componente de lucide) NO
 * viaja en los datos porque cruza el borde RSC (Server Component layout ->
 * Client Component Sidebar) y las funciones/componentes no son serializables.
 * El Sidebar resuelve `iconKey -> componente` en el cliente al renderizar.
 */
export type IconKey = "settings" | "user" | "package";

/** Subitem de navegacion (dentro de un item colapsable). Sin icono propio. */
export interface MenuChild {
  label: string;
  href: string;
}

/**
 * Item de navegacion con los roles autorizados a verlo. La visibilidad del menu
 * se decide aqui, en un unico punto, para poder migrar de "por rol" a "por
 * permisos granulares" (tablas Permiso/RolPermiso) sin tocar el Sidebar.
 *
 * Solo contiene datos 100% serializables (strings/arrays): `iconKey` en vez del
 * componente de icono, para poder cruzar el borde RSC hacia el Sidebar cliente.
 */
export interface MenuItem {
  label: string;
  href: string;
  iconKey: IconKey;
  roles: readonly RolValue[];
  children?: readonly MenuChild[];
}

/**
 * Fuente de verdad del menu. Vive en este modulo server-safe (NO en el
 * "use client" del Sidebar): un Server Component que importa un export de un
 * modulo cliente recibe una referencia-proxy, no el valor real, y `.filter`
 * reventaria. El layout (server) y el Sidebar (client) lo importan desde aqui.
 *
 * Los `roles` se derivan de la autorizacion que ya aplican los services:
 * - Órdenes: KNOWN_ROLES de OrdenService.
 * - Configuración: ALLOWED_ROLES de UsuarioService (solo maestro).
 * - Perfil: cualquier rol autenticado (ningun service lo restringe).
 */
export const SIDEBAR_ITEMS: readonly MenuItem[] = [
  {
    label: "Órdenes",
    href: "/ordenes",
    iconKey: "package",
    roles: ["maestro", "admin", "adminTienda", "mensajero"],
  },
  {
    label: "Configuración",
    href: "/configuracion",
    iconKey: "settings",
    roles: ["maestro"],
    children: [
      { label: "Usuarios", href: "/configuracion" },
      { label: "Tarifas", href: "/configuracion/tarifas" },
      { label: "API", href: "/configuracion/api" },
    ],
  },
  {
    label: "Perfil",
    href: "/perfil",
    iconKey: "user",
    roles: ROLES_SEED,
  },
] as const;

/**
 * Regla de visibilidad de un item para el actor autenticado. Hoy compara contra
 * el rol; el dia que se activen los permisos granulares, la consulta a
 * RolPermiso vive aqui y nadie mas cambia.
 */
export function puedeVer(item: MenuItem, actor: Actor | null): boolean {
  if (!actor) return false; // sesion ausente o invalida -> sin items
  return item.roles.includes(actor.rol);
  // TODO(permisos): sustituir/complementar por consulta a los permisos del actor.
}

/** Filtra la lista de items dejando solo los visibles para el actor. */
export function itemsVisibles<T extends MenuItem>(
  items: readonly T[],
  actor: Actor | null,
): T[] {
  return items.filter((item) => puedeVer(item, actor));
}
