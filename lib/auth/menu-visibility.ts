import type { RolValue } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
// Feature 133 (T2.1): `ROLES_ACCESO_ANALITICA` DERIVA de esta constante. Import de
// VALOR (no `import type`) porque el valor se reexporta. `lib/analytics/types.ts` es
// un módulo sin runtime —sólo `import type` en su cabecera (R1 de la 135)—, así que
// esta arista no arrastra Prisma, `next/headers` ni nada de servidor al Sidebar
// cliente, que importa este módulo.
import { ROLES_ANALITICA } from "@/lib/analytics/types";

/**
 * Clave string del icono de un item. El icono real (componente de lucide) NO
 * viaja en los datos porque cruza el borde RSC (Server Component layout ->
 * Client Component Sidebar) y las funciones/componentes no son serializables.
 * El Sidebar resuelve `iconKey -> componente` en el cliente al renderizar.
 */
export type IconKey =
  | "home"
  | "settings"
  | "user"
  | "package"
  | "clipboardCheck"
  | "truck"
  | "megaphone"
  | "trophy"
  | "wallet"
  // Feature 158 (T2.8, Q-I): cola de incidentes. Icono propio y no otro `clipboardCheck`:
  // un incidente NO es un cierre, y compartir el icono con "Cierres del día" invitaría a
  // leerlo como una sección suya, que es justo lo que la decisión del humano descartó.
  | "shieldAlert"
  // Feature 129: tablero de analítica. Icono propio y no otro existente:
  // `IconKey` es una unión cerrada y compartir icono con otra sección invitaría a
  // leer analítica como parte de esa sección — mismo criterio que se escribió al
  // crear `shieldAlert` para incidentes.
  | "chartColumn"
  // Feature 167 (R5): apartado propio de RECOLECCIÓN EN TIENDA del mensajero. Icono
  // propio y NO el `truck` de "Entregas": recolectar en la tienda y repartir en la calle
  // son dos trabajos distintos, y compartir icono con Entregas invitaría a leer la
  // recolección como una sección suya — que es exactamente de donde esta feature la sacó.
  // Mismo criterio que `shieldAlert` (158) y `chartColumn` (129).
  | "store"
  // Feature 192 (R53): tablero del día "Monitoreo" (órdenes por mensajero, en vivo). Icono
  // propio y NO el `chartColumn` de "Analítica": una cosa es el cierre analítico del negocio
  // y otra el pulso del día en curso, y compartir icono invitaría a leer el monitoreo como
  // una sección de analítica. Mismo criterio que `shieldAlert` (158), `chartColumn` (129) y
  // `store` (167).
  | "gauge";

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
  /**
   * Feature 133 (T5.1, decisión Q2 del 2026-08-04): marca que el ítem NO es
   * elegible como ATERRIZAJE post-login, aunque sea visible y aunque quede el
   * primero de la barra. Lo lee `primerDestino`, que se lo salta.
   *
   * Existe porque el ítem "Analítica" ocupa la posición 2 del sidebar y esta
   * feature lo hace visible a `mensajero` y `adminSatelite`: sin esta marca,
   * esos dos roles habrían pasado a aterrizar en `/analitica` en vez de en su
   * pantalla de trabajo, **en silencio** (ningún test vigente lo detectaba). Un
   * tablero de indicadores no es donde empieza el turno de nadie.
   *
   * Es un CAMPO DEL ÍTEM y no un literal de ruta dentro de `primerDestino` a
   * propósito: la ruta es un dato del ítem y `primerDestino` no debe conocer
   * ninguna pantalla concreta. Mover el ítem de sitio estaba descartado: rompe
   * R16 de la 129 (posición justo tras "Inicio").
   *
   * El tipo es `false` y no `boolean`: sólo hay una razón para escribirlo
   * (excluirse), y `destinoInicial: true` no significaría nada — todo ítem sin
   * la marca ya es elegible.
   */
  destinoInicial?: false;
}

/**
 * Feature 129: único punto de verdad de quién ACCEDE a analítica (quién ve la
 * entrada y quién no recibe un 404). Lo usan TANTO el `roles` del ítem de menú
 * de "Analítica" (abajo) COMO el gate `notFound()` de
 * `app/(app)/analitica/page.tsx`, para que las dos capas no puedan divergir
 * (R10 de la 129).
 *
 * Feature 133 (T2.1, decisión Q1 del 2026-08-04): el acceso se ENSANCHA a los
 * cinco roles lectores y, con eso, PASA A COINCIDIR con `ROLES_ANALITICA` de
 * `lib/analytics/types.ts`. Por eso se DERIVA de ella en vez de escribirse una
 * lista propia con el mismo contenido.
 *
 * POR QUÉ DERIVAR Y NO COPIAR (alternativa A5 del design, DESCARTADA): esta
 * constante se llamaba `ROLES_ANALITICA` y colisionaba con la homónima de
 * `lib/analytics/types.ts` (feature 135) —los CINCO roles con ALCANCE DENTRO de
 * la analítica—. Dos tuplas `readonly RolValue[]` con el mismo nombre y
 * significados distintos: importar la que no era no rompía el typecheck, sólo
 * abría o cerraba la puerta equivocada. El rename le puso el prefijo `ACCESO`;
 * la derivación remata el problema. Escribir aquí los cinco nombres a mano
 * compilaría y pasaría los tests de comportamiento, pero dejaría otra vez DOS
 * listas con el mismo contenido y significados distintos, libres de divergir en
 * silencio. Que la derivación siga existiendo lo vigila
 * `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts` (caso (b),
 * reexpresado por esta feature: mata la mutación «volver a escribir la lista»).
 *
 * NO se usa `esAccesoTotal` (`lib/auth/acceso-total.ts`) y ahora se ve por qué:
 * "acceso total de gestión" y "acceso a la ruta de analítica" eran conceptos
 * distintos que hasta hoy coincidían por accidente, y esta feature los SEPARA de
 * hecho — `esAccesoTotal` es quien ve el DINERO (la región financiera de la 132,
 * `app/(app)/analitica/page.tsx`), no quien entra a la ruta. Tampoco se usa
 * `ROLES_SEED`: incluye `apiKey` (`lib/types/roles.ts`), una cuenta de máquina
 * que no navega y que sigue recibiendo `notFound()`.
 *
 * Sigue siendo una WHITELIST (R4): un `RolValue` nuevo del esquema no entra por
 * defecto — sólo entra si se le declara alcance en el catálogo de la analítica.
 */
export const ROLES_ACCESO_ANALITICA = ROLES_ANALITICA;

/**
 * Fuente de verdad del menu. Vive en este modulo server-safe (NO en el
 * "use client" del Sidebar): un Server Component que importa un export de un
 * modulo cliente recibe una referencia-proxy, no el valor real, y `.filter`
 * reventaria. El layout (server) y el Sidebar (client) lo importan desde aqui.
 *
 * Los `roles` se derivan de la autorizacion que ya aplican los services:
 * - Órdenes: KNOWN_ROLES de OrdenService.
 * - Configuración: ALLOWED_ROLES de UsuarioService (solo maestro).
 */
export const SIDEBAR_ITEMS: readonly MenuItem[] = [
  {
    // Feature 92: acceso al dashboard (landing post-login movido a /dashboard por
    // la feature 86). Visible solo para maestro/admin, los roles para los que la
    // página renderiza contenido real; la defensa real es la resolución de rol
    // server-side de la propia página.
    label: "Inicio",
    href: "/dashboard",
    iconKey: "home",
    roles: ["maestro", "admin"],
  },
  {
    // Feature 129: tablero de analítica (ruta/shell). Feature 133 (T2.1): ya está
    // ampliado a los CINCO roles lectores — `roles` apunta a la CONSTANTE (nunca a
    // un literal copiado: R10 de la 129 lo castiga), y la constante deriva de
    // `ROLES_ANALITICA`. Este ítem solo decide qué se MUESTRA; la defensa real es el
    // `notFound()` de la página. Quién ve la región financiera de dentro es OTRA
    // pregunta y la responde `esAccesoTotal` (D2 de la 133).
    //
    // `destinoInicial: false` (T5.1, Q2): visible sí, aterrizaje post-login NO. Va
    // en posición 2, así que sin esta marca `mensajero` y `adminSatelite` habrían
    // dejado de aterrizar en `/mis-asignaciones/reparto` y `/recepcion-satelite`
    // para caer aquí, sin que nada se pusiera rojo (R5).
    label: "Analítica",
    href: "/analitica",
    iconKey: "chartColumn",
    roles: ROLES_ACCESO_ANALITICA,
    destinoInicial: false,
  },
  {
    // Feature 192 (R53): tablero del día — una tarjeta por mensajero con sus órdenes
    // asignadas hoy y en qué terminó cada una. Va junto a "Analítica" porque ambos son
    // tableros de LECTURA, pero es otra cosa: analítica cierra el día, esto lo vigila
    // mientras pasa. Los `roles` son los de R1 y la defensa real es el `notFound()` de
    // `/monitoreo` (R11): este ítem sólo decide qué se MUESTRA.
    //
    // `destinoInicial: false` NO es decorativo (R35/R54). El aterrizaje post-login se deriva
    // del PRIMER ítem visible del menú (`primerDestino`, consumido por
    // `app/(app)/dashboard/page.tsx`), y este ítem va en posición 3: para el `adminSatelite`
    // —que no ve "Inicio" ni "Órdenes"— sería el primer ítem elegible después de "Analítica"
    // y pasaría a aterrizar aquí en silencio, en vez de en `/recepcion-satelite`. Es
    // exactamente el incidente que ya documenta el campo `destinoInicial` con "Analítica".
    label: "Monitoreo",
    href: "/monitoreo",
    iconKey: "gauge",
    roles: ["admin", "maestro", "adminSatelite"],
    destinoInicial: false,
  },
  {
    label: "Órdenes",
    href: "/ordenes",
    iconKey: "package",
    roles: ["maestro", "admin", "adminTienda"],
  },
  {
    // Feature 61: portal del mensajero (KPIs + asignaciones por recoger/gestionar).
    // Exclusivo del rol `mensajero`; la defensa real es el `notFound` de las páginas
    // `/mis-asignaciones/*` (resuelven el rol server-side).
    //
    // 2026-07-31 (decisión del humano): el portal se PARTE en dos pantallas hermanas, cada
    // una con su ruta y su subítem, porque son dos trabajos distintos del mismo turno:
    // repartir en la calle (mapa, ruta, panel de gestión) y recoger en el punto de origen
    // (escáner + listado). Antes convivían apiladas en una sola pantalla y el escáner
    // quedaba enterrado bajo el panel de reparto. Reparto va PRIMERO: es donde el mensajero
    // pasa el turno, y `/mis-asignaciones` redirige ahí (los enlaces viejos no se rompen).
    //
    // El `href` del padre NO navega —un ítem con `children` se renderiza como disparador
    // del desplegable, no como enlace (ver `Sidebar.tsx`)—, pero se conserva porque
    // identifica al ítem (clave de React y posición relativa a "Recolección").
    //
    // "Por recoger" y no "Recoger" a secas: el ítem hermano "Recolección" (167) es la
    // recolección EN TIENDA, otro flujo. La etiqueta larga los mantiene distinguibles.
    label: "Entregas",
    href: "/mis-asignaciones",
    iconKey: "truck",
    roles: ["mensajero"],
    children: [
      { label: "Reparto", href: "/mis-asignaciones/reparto" },
      { label: "Por recoger", href: "/mis-asignaciones/recoger" },
    ],
  },
  {
    // Feature 167 (R4): apartado PROPIO de la recolección en tienda. Va justo debajo de
    // "Entregas" porque son hermanos del mismo portal del mensajero, y es un ítem y no un
    // subítem de Entregas porque la 167 sacó la recolección de allí: el mensajero no la
    // encontraba enterrada dentro del módulo de reparto. Exclusivo del rol `mensajero`;
    // la defensa real es el `notFound` de `/recoleccion` (resuelve el rol server-side).
    label: "Recolección",
    href: "/recoleccion",
    iconKey: "store",
    roles: ["mensajero"],
  },
  {
    // Portal del adminSatelite (paridad con "Entregas" del mensajero): recepción de
    // órdenes ruteadas a su bodega (por recibir/recibidas) + asignación a mensajeros
    // de su zona. Exclusivo de `adminSatelite`; la defensa real es el `notFound` de
    // la página `/recepcion-satelite` (resuelve el rol server-side).
    label: "Órdenes",
    href: "/recepcion-satelite",
    iconKey: "package",
    roles: ["adminSatelite"],
  },
  {
    // Feature 87 (R20): lista de ordenes en devolucion de la tienda, con su causa y
    // el contacto del cliente. Exclusivo del `adminTienda` (el mensajero DEJA de verlo).
    // La defensa real es el `notFound` de la pagina (resuelve el rol server-side); este
    // item solo decide que se MUESTRA.
    label: "Novedades",
    href: "/novedades",
    iconKey: "megaphone",
    roles: ["adminTienda"],
  },
  {
    // Feature 76: ranking diario de mensajeros. Visible para `maestro`/`admin` (ven y
    // editan los premios — feature 94, paridad adm↔maestro) y `mensajero` (lo ve en
    // solo-lectura) de forma intencional; la defensa real es el `notFound` de la página
    // `/ranking`, que resuelve el rol server-side y decide el modo editable.
    label: "Ranking",
    href: "/ranking",
    iconKey: "trophy",
    roles: ["maestro", "admin", "mensajero"],
  },
  {
    // Feature 42: caja principal de Ordenex (balance + libro de movimientos).
    // Visible para `maestro`/`admin` (feature 94, paridad adm↔maestro). La defensa
    // real es el `notFound` de la página `/wallet`, que resuelve el rol server-side;
    // este item solo decide que se MUESTRA. Los subitems apuntan a las vistas por
    // contraparte (43/44) y heredan la visibilidad del padre.
    label: "Wallet",
    href: "/wallet",
    iconKey: "wallet",
    roles: ["maestro", "admin"],
    children: [
      { label: "Caja principal", href: "/wallet" },
      { label: "Tiendas", href: "/wallet/tiendas" },
      { label: "Mensajeros", href: "/wallet/mensajeros" },
    ],
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
      // Feature 107: CRUD de plantillas de mensaje. Hereda la visibilidad
      // maestro-only del ítem padre (R1/R2).
      { label: "Plantillas", href: "/configuracion/plantillas" },
    ],
  },
  {
    label: "Cierre del día",
    href: "/cierre-dia",
    iconKey: "clipboardCheck",
    roles: ["mensajero"],
  },
  {
    // Feature 38: cola de cierres del admin de bodega. Visible para
    // `maestro`/`admin` (feature 94, paridad adm↔maestro) y `adminSatelite`. Ruta y
    // roles distintos del ítem del mensajero ("/cierre-dia"); la defensa real es el
    // notFound de la página.
    label: "Cierres del día",
    href: "/cierres-admin",
    iconKey: "clipboardCheck",
    roles: ["maestro", "admin", "adminSatelite"],
  },
  {
    // Feature 158 (T2.8, Q-I): cola de aprobación de incidentes (paquetes dañados,
    // perdidos o robados reportados por un admin). PÁGINA PROPIA, no una sección de
    // "Cierres": un incidente no es un cierre. Los roles son los que el service autoriza
    // (`IncidenteAdminService.resolveAlcance`, R48): acceso total (maestro/admin) sin
    // restricción de zona y `adminSatelite` acotado a la suya. La defensa real es el
    // `notFound` de `/incidentes`; este ítem sólo decide qué se MUESTRA.
    label: "Incidentes",
    href: "/incidentes",
    iconKey: "shieldAlert",
    roles: ["maestro", "admin", "adminSatelite"],
  },
  // "Perfil" SALE del menú para todos los roles (pedido humano) y su página se ELIMINÓ:
  // era un placeholder sin contenido que solo ocupaba un sitio en la barra.
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

/**
 * Primer destino NAVEGABLE del menú de un actor: el `href` del primer item visible o, si ese
 * item es un desplegable, el de su primer subitem (un padre con `children` no navega, ver
 * `Sidebar.tsx`). `null` si el actor no ve ningún item elegible.
 *
 * Lo consume `/dashboard` para los roles que NO tienen inicio propio: en vez de dejarlos en
 * un "Bienvenido" vacío, entran directo a donde empieza su trabajo.
 *
 * Feature 133 (T5.1): se SALTAN los ítems marcados `destinoInicial: false` — hoy sólo
 * "Analítica". La decisión de qué ítem no sirve de aterrizaje vive en el ÍTEM; esta función
 * no conoce ni una ruta concreta (escribir `"/analitica"` aquí estaba explícitamente
 * prohibido por el design D7).
 */
export function primerDestino(items: readonly MenuItem[]): string | null {
  const primero = items.find((item) => item.destinoInicial !== false);
  if (!primero) return null;
  return primero.children?.[0]?.href ?? primero.href;
}
