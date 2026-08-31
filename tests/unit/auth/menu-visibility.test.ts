import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import {
  puedeVer,
  itemsVisibles,
  primerDestino,
  SIDEBAR_ITEMS,
  ROLES_ACCESO_ANALITICA,
  ROLES_MI_WALLET,
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
const cierreDia = byLabel("Cierre del día");
const cierresAdmin = byLabel("Cierres del día");
const novedades = byLabel("Novedades");
const wallet = byLabel("Wallet");
const ranking = byLabel("Ranking");
// Feature 158 (T2.8, Q-I): la cola de incidentes es PÁGINA PROPIA, así que trae ítem propio.
const incidentes = byLabel("Incidentes");
// Feature 129: tablero de analítica (ruta/shell + ítem de sidebar).
const analitica = byLabel("Analítica");
// Feature 167 (R4): apartado propio de recolección en tienda del mensajero.
const recoleccion = byLabel("Recolección");
// Feature 192 (R53): tablero del día en vivo (órdenes por mensajero).
const monitoreo = byLabel("Monitoreo");

const labels = (items: readonly MenuItem[]): string[] =>
  items.map((i) => i.label);

describe("puedeVer", () => {
  it("muestra el item cuando el rol del actor está autorizado", () => {
    expect(puedeVer(config, actor("maestro"))).toBe(true);
    expect(puedeVer(ordenes, actor("adminTienda"))).toBe(true);
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
    // Feature 158 (R48/R49): "Incidentes" lo ven los MISMOS roles que el service autoriza
    // a resolver un incidente: acceso total (maestro/admin) y adminSatelite (acotado a su
    // zona server-side). Si el menú y el service divergieran, o habría un ítem que lleva a
    // un `notFound`, o un rol autorizado sin puerta de entrada.
    expect(puedeVer(incidentes, actor("maestro"))).toBe(true);
    expect(puedeVer(incidentes, actor("admin"))).toBe(true);
    expect(puedeVer(incidentes, actor("adminSatelite"))).toBe(true);
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
    // Feature 158 (R48): "Incidentes" NO lo ven el mensajero ni el adminTienda. Es dinero
    // de Ordenex saliendo de la caja: el service les responde `forbidden` y el menú no les
    // ofrece la puerta.
    expect(puedeVer(incidentes, actor("mensajero"))).toBe(false);
    expect(puedeVer(incidentes, actor("adminTienda"))).toBe(false);
  });

  it("oculta todo cuando no hay actor (sesión ausente o inválida)", () => {
    expect(puedeVer(config, null)).toBe(false);
    expect(puedeVer(ordenes, null)).toBe(false);
    expect(puedeVer(novedades, null)).toBe(false);
    expect(puedeVer(wallet, null)).toBe(false);
  });
});

describe("itemsVisibles por rol (mapeo real de SIDEBAR_ITEMS)", () => {
  it("maestro ve Inicio, Analítica, Órdenes, Wallet, Configuración, Cierres del día e Incidentes en orden real", () => {
    // Feature 42: "Wallet" (caja principal, solo maestro) va antes de "Configuración".
    // Feature 92: "Inicio" (acceso a /dashboard) va PRIMERO en SIDEBAR_ITEMS.
    // Feature 129 (R16/R17, D7): "Analítica" entra en SEGUNDA posición, justo tras
    // "Inicio" y antes de "Órdenes" — el único cambio en el conjunto visible del
    // maestro respecto al de antes de esta feature.
    // Feature 158 (Q-I): "Incidentes" entra DESPUÉS de "Cierres del día" — el coste
    // declarado de que la cola sea página propia y no una sección de cierres. La lista se
    // compara por IGUALDAD: un ítem nuevo no declarado aquí pone el caso rojo.
    // Feature 192 (R53): "Monitoreo" entra JUSTO DESPUÉS de "Analítica" (los dos son
    // tableros de lectura). La lista se sigue comparando por IGUALDAD: un ítem nuevo no
    // declarado aquí pone el caso rojo. Que sea visible no lo hace aterrizaje: lleva
    // `destinoInicial: false` (ver el bloque de `primerDestino`).
    expect(labels(itemsVisibles(SIDEBAR_ITEMS, actor("maestro")))).toEqual([
      "Inicio",
      "Analítica",
      "Monitoreo",
      "Órdenes",
      "Ranking",
      "Wallet",
      "Configuración",
      "Cierres del día",
      "Incidentes",
      // Feature 321 (R2/R9): "Histórico" entra la ÚLTIMA, después de "Incidentes". La
      // posición NO es decorativa: es lo que hace que `primerDestino` no cambie para
      // ningún rol y por eso el ítem no necesita `destinoInicial: false`. La lista se
      // sigue comparando por IGUALDAD: un ítem nuevo no declarado aquí pone el caso rojo.
      "Histórico",
    ]);
  });

  it("admin ve Inicio, Analítica, Órdenes, Ranking, Wallet y Cierres del día, NO Configuración (paridad con maestro salvo Configuración)", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("admin")));
    // Feature 94 (paridad adm↔maestro): el admin ve Ranking, Wallet y Cierres del día
    // igual que el maestro; solo Configuración sigue siendo maestro-only.
    // Feature 129 (R16/R17, D7): "Analítica" entra en SEGUNDA posición (tras
    // "Inicio"), único cambio en el conjunto visible del admin.
    expect(visibles).toEqual([
      "Inicio",
      "Analítica",
      "Monitoreo", // feature 192 (R53)
      "Órdenes",
      "Ranking",
      "Wallet",
      "Cierres del día",
      "Incidentes", // feature 158 (Q-I)
      "Histórico", // feature 321 (R2/R9): el ÚLTIMO, para no mover el aterrizaje de nadie
    ]);
    expect(visibles).not.toContain("Configuración");
  });

  it("adminTienda ve Analítica + Órdenes + Novedades + Mi wallet, NO Configuración ni Incidentes", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("adminTienda")));
    // Feature 133 (T2.3, R1): "Analítica" entra en la lista del adminTienda, en la
    // posición 2 de SIDEBAR_ITEMS (justo tras "Inicio", que este rol no ve). La lista
    // se sigue comparando por IGUALDAD, no por `toContain`: la aserción NO se debilitó
    // —un ítem nuevo no declarado aquí sigue poniendo el caso rojo—, sólo incorpora el
    // ítem que esta feature le abre. Que ENTRE a la ruta no significa que vea el
    // dinero: la región financiera sigue siendo de `esAccesoTotal` (D2).
    // Ficha 335 (R31/R35): entra «Mi wallet», y entra EL ÚLTIMO. La lista se sigue comparando
    // por IGUALDAD y no se relaja a `toContain`: es el contrato de qué ve este rol, y un ítem
    // nuevo no declarado aquí tiene que seguir poniendo el caso rojo.
    //
    // Que vaya al final tampoco es cosmético: `primerDestino` devuelve el primer visible no
    // marcado `destinoInicial: false`, así que el aterrizaje post-login del rol sigue siendo
    // «Órdenes» (R35). Si algún día este literal pasara a ser
    // `["Analítica", "Mi wallet", "Órdenes", …]`, el rol habría cambiado de puerta de entrada.
    expect(visibles).toEqual(["Analítica", "Órdenes", "Novedades", "Mi wallet"]);
    expect(visibles).not.toContain("Incidentes"); // feature 158 (R48)
    expect(visibles).not.toContain("Configuración");
    // "Ranking" es solo del maestro.
    expect(visibles).not.toContain("Ranking");
  });

  it("mensajero ve Entregas + Recolección + Ranking + Cierre del día, NO Analítica, Órdenes, Novedades ni Configuración", () => {
    const visibles = labels(itemsVisibles(SIDEBAR_ITEMS, actor("mensajero")));
    // Feature 61: el mensajero usa "Entregas" (su portal); ya NO ve "Órdenes"
    // (lista genérica reservada a maestro/admin/adminTienda).
    // Feature 76 (R20): "Ranking" es visible para el mensajero en solo-lectura
    // (roles maestro+mensajero); su defensa real es el notFound de la página.
    // Feature 87 (R20): "Novedades" ahora es exclusivo del adminTienda; el
    // mensajero DEJA de verlo.
    // Feature 167 (R4): "Recolección" es el apartado propio de la recolección en
    // tienda, que dejó de vivir dentro de "Entregas". Va justo debajo de ella.
    // 2026-08-12 (decisión del humano): "Analítica" SALE de la barra del mensajero. La 133
    // (T2.3, R1) la había puesto PRIMERA en su lista —posición 2 de SIDEBAR_ITEMS, y este
    // rol no ve "Inicio"—; hoy el mensajero no la ve en ninguna posición y tampoco pasa el
    // `notFound()` de la ruta (las dos capas leen `ROLES_ACCESO_ANALITICA`, ver R10 abajo).
    // Su aterrizaje post-login no se mueve: ya era `/mis-asignaciones/reparto` por el
    // `destinoInicial: false` del ítem, y ahora lo es porque "Entregas" es su primer ítem.
    // Comparación por IGUALDAD intacta: la lista sigue siendo exhaustiva.
    expect(visibles).toEqual([
      "Entregas",
      "Recolección",
      "Ranking",
      "Cierre del día",
    ]);
    expect(visibles).not.toContain("Analítica");
    expect(visibles).not.toContain("Órdenes");
    expect(visibles).not.toContain("Novedades");
    expect(visibles).not.toContain("Configuración");
    // Feature 158 (R48): el mensajero NO entra en la cola de incidentes del admin. El suyo
    // se resuelve por el cierre del día, que es otra pantalla y otro camino.
    expect(visibles).not.toContain("Incidentes");
  });

  it("adminSatelite ve Analítica + Órdenes + Cierres del día + Incidentes", () => {
    // Feature 158 (R48): el adminSatelite SÍ resuelve incidentes, acotado a su zona por el
    // service; por eso gana el ítem. Su "Órdenes" apunta a /recepcion-satelite.
    // Feature 133 (T2.3, R1): "Analítica" entra PRIMERA (posición 2 de SIDEBAR_ITEMS; este
    // rol no ve "Inicio"). Igualdad conservada: la lista sigue siendo exhaustiva y un ítem
    // no declarado sigue rompiendo. Su aterrizaje post-login NO cambia: sigue siendo
    // `/recepcion-satelite` (T5.1, `destinoInicial: false`).
    // Feature 192 (R53): gana "Monitoreo", en segunda posición de su barra. Su aterrizaje
    // post-login SIGUE siendo `/recepcion-satelite` (R54): el ítem lleva
    // `destinoInicial: false` y `primerDestino` lo salta, igual que a "Analítica".
    expect(labels(itemsVisibles(SIDEBAR_ITEMS, actor("adminSatelite")))).toEqual(
      ["Analítica", "Monitoreo", "Órdenes", "Cierres del día", "Incidentes"],
    );
  });

  it("sin actor no ve ningún ítem", () => {
    expect(itemsVisibles(SIDEBAR_ITEMS, null)).toEqual([]);
  });

  it("«Perfil» ya no es un ítem del menú para NINGÚN rol (su ruta tampoco existe)", () => {
    expect(SIDEBAR_ITEMS.some((i) => i.label === "Perfil")).toBe(false);
    for (const rol of [
      "maestro",
      "admin",
      "adminTienda",
      "adminSatelite",
      "mensajero",
    ] as const) {
      expect(labels(itemsVisibles(SIDEBAR_ITEMS, actor(rol)))).not.toContain(
        "Perfil",
      );
    }
  });
});

// Aterrizaje de `/dashboard` para los roles sin inicio propio (pedido humano): el primer
// ítem ELEGIBLE de SU sidebar, no un "Bienvenido" vacío.
//
// Feature 133 (T5.1, Q2): desde que "Analítica" es visible para `adminTienda` y
// `adminSatelite`, es el primer ítem de su barra — y aun así NO es su aterrizaje: el ítem
// está marcado `destinoInicial: false` y `primerDestino` lo salta. El caso del
// `adminSatelite` sigue verde por eso, y no por casualidad. El del `mensajero` ya no
// depende de la marca desde que dejó de ver el ítem (2026-08-12): su primer ítem es
// "Entregas". El test que enumera los cinco destinos POR
// VALOR (sin derivarlos de `primerDestino`) vive en `tests/unit/auth/destino-post-login.test.ts`.
describe("primerDestino (aterrizaje de /dashboard)", () => {
  const destinoDe = (rol: RolValue) =>
    primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor(rol)));

  it("el mensajero aterriza en el primer SUBÍTEM de Entregas (el padre no navega)", () => {
    expect(destinoDe("mensajero")).toBe("/mis-asignaciones/reparto");
  });

  // Feature 279 (R12/R14, 2026-08-24): el portal del satélite pasó a tener subítems, así
  // que el aterrizaje deja de ser `/recepcion-satelite` (que ahora sólo redirige) y pasa a
  // ser el primer subítem. Cambio DELIBERADO y firmado: este caso se puso rojo con el
  // `children` nuevo y se actualizó a mano, no se relajó.
  it("el adminSatelite aterriza en el primer SUBÍTEM de su portal (el padre no navega)", () => {
    expect(destinoDe("adminSatelite")).toBe("/recepcion-satelite/por-recibir");
  });

  it("maestro y admin conservan su Inicio (/dashboard), así que no hay redirección circular", () => {
    expect(destinoDe("maestro")).toBe("/dashboard");
    expect(destinoDe("admin")).toBe("/dashboard");
  });

  it("sin ítems visibles no hay destino", () => {
    expect(primerDestino([])).toBeNull();
    expect(primerDestino(itemsVisibles(SIDEBAR_ITEMS, null))).toBeNull();
  });

  it("conserva los children del ítem padre visible (Configuración → Usuarios/Tarifas/API/Plantillas)", () => {
    const [visibleConfig] = itemsVisibles(SIDEBAR_ITEMS, actor("maestro"))
      .filter((i) => i.label === "Configuración");
    expect(visibleConfig.children?.map((c) => c.href)).toEqual([
      "/configuracion",
      "/configuracion/tarifas",
      "/configuracion/api",
      "/configuracion/plantillas",
      // Ficha 273: el catalogo de tipos de vehiculo pasa a administrarse por CRUD y
      // hereda la visibilidad maestro-only del item padre.
      "/configuracion/vehiculos",
    ]);
  });

  it("Feature 107 (R1): el maestro ve el subítem Plantillas en Configuración", () => {
    const [visibleConfig] = itemsVisibles(SIDEBAR_ITEMS, actor("maestro"))
      .filter((i) => i.label === "Configuración");
    const plantillas = visibleConfig.children?.find(
      (c) => c.label === "Plantillas",
    );
    expect(plantillas).toEqual({
      label: "Plantillas",
      href: "/configuracion/plantillas",
    });
  });

  it("Feature 107 (R2): un rol no maestro no ve Configuración ni su subítem Plantillas", () => {
    for (const rol of ["admin", "adminTienda", "adminSatelite", "mensajero"] as const) {
      const visibles = itemsVisibles(SIDEBAR_ITEMS, actor(rol));
      expect(visibles.some((i) => i.label === "Configuración")).toBe(false);
      // El subítem Plantillas solo existe bajo Configuración; si el padre se oculta,
      // el subítem no es alcanzable para el rol.
      const plantillas = visibles
        .flatMap((i) => i.children ?? [])
        .find((c) => c.href === "/configuracion/plantillas");
      expect(plantillas).toBeUndefined();
    }
  });

  // 2026-07-31 (decisión del humano): el portal del mensajero se partió en dos pantallas
  // hermanas y "Entregas" pasó a ser un ítem con submenú. El ORDEN importa y es parte de
  // la decisión: Reparto primero, porque es donde el mensajero pasa el turno.
  it("Entregas declara el submenú Reparto (primero) + Por recoger", () => {
    expect(entregas.children?.map((c) => [c.label, c.href])).toEqual([
      ["Reparto", "/mis-asignaciones/reparto"],
      ["Por recoger", "/mis-asignaciones/recoger"],
    ]);
  });

  it("los subítems de Entregas heredan la visibilidad del padre (solo mensajero)", () => {
    // Un subítem solo es alcanzable si su padre lo es: si "Entregas" se ocultara para un
    // rol, las dos pantallas del mensajero quedarían fuera de su menú.
    for (const rol of ["maestro", "admin", "adminTienda", "adminSatelite"] as const) {
      const alcanzables = itemsVisibles(SIDEBAR_ITEMS, actor(rol))
        .flatMap((i) => i.children ?? [])
        .map((c) => c.href);
      expect(alcanzables).not.toContain("/mis-asignaciones/reparto");
      expect(alcanzables).not.toContain("/mis-asignaciones/recoger");
    }
    const delMensajero = itemsVisibles(SIDEBAR_ITEMS, actor("mensajero"))
      .flatMap((i) => i.children ?? [])
      .map((c) => c.href);
    expect(delMensajero).toContain("/mis-asignaciones/reparto");
    expect(delMensajero).toContain("/mis-asignaciones/recoger");
  });

  it("Órdenes ya no tiene submenú (el listado vive en el ítem padre)", () => {
    const [ordenes] = itemsVisibles(SIDEBAR_ITEMS, actor("adminTienda")).filter(
      (i) => i.label === "Órdenes",
    );
    expect(ordenes.children).toBeUndefined();
    expect(ordenes.href).toBe("/ordenes");
  });
});

// Feature 129 — el ítem de sidebar "Analítica" (R7, R8, R9, R11, R15, R16).
describe("Feature 129 — ítem de sidebar de Analítica", () => {
  it("R7: existe exactamente UN ítem con href '/analitica' y su label es 'Analítica'", () => {
    const conEseHref = SIDEBAR_ITEMS.filter((i) => i.href === "/analitica");
    expect(conEseHref).toHaveLength(1);
    expect(conEseHref[0].label).toBe("Analítica");
  });

  // Feature 133 (T2.3, R1): el bloque R8 pasó de dos roles a los CINCO lectores.
  // 2026-08-12: vuelve a CUATRO — el `mensajero` se mueve de esta lista a la de excluidos
  // del R9 de abajo, que es el otro lado exacto del reparto. Ninguna lista pierde fuerza y
  // ningún rol deja de estar enumerado: los seis siguen repartidos entre los dos casos.
  it("R8 (+133 R1, −mensajero 2026-08-12): puedeVer e itemsVisibles incluyen el ítem para los CUATRO roles con acceso", () => {
    for (const rol of [
      "maestro",
      "admin",
      "adminTienda",
      "adminSatelite",
    ] as RolValue[]) {
      expect(puedeVer(analitica, actor(rol))).toBe(true);
      expect(
        itemsVisibles(SIDEBAR_ITEMS, actor(rol)).some(
          (i) => i.href === "/analitica",
        ),
      ).toBe(true);
    }
  });

  // Feature 133 (T2.3, R1/R29): REEXPRESADO, no relajado. Antes decía «el resto de roles»
  // y ahí caían `mensajero`, `adminTienda` y `adminSatelite`, que esta feature admite. Los
  // que quedan fuera siguen fuera y siguen afirmándose: `apiKey` (cuenta de máquina, sin
  // sesión de UI: `lib/analytics/types.ts` la deja fuera de los cinco lectores a propósito)
  // y el actor ausente o inválido. La lista de excluidos se ENCOGE porque tres roles se
  // pasaron a la de incluidos (R8, arriba); no porque se haya dejado de comprobar nada.
  it("R9 (reexpresado por la 133; +mensajero 2026-08-12): apiKey, el mensajero y el actor ausente NO ven el ítem", () => {
    // El `mensajero` vuelve a esta lista por decisión del humano (2026-08-12). No es una
    // vuelta atrás de la 133 entera: `adminTienda` y `adminSatelite` siguen entrando, y el
    // mensajero conserva su ALCANCE en el catálogo de la 135 — lo que pierde es la puerta.
    for (const rol of ["apiKey", "mensajero"] as RolValue[]) {
      expect(puedeVer(analitica, actor(rol))).toBe(false);
      expect(
        itemsVisibles(SIDEBAR_ITEMS, actor(rol)).some(
          (i) => i.href === "/analitica",
        ),
      ).toBe(false);
    }
    expect(puedeVer(analitica, null)).toBe(false);
    expect(
      itemsVisibles(SIDEBAR_ITEMS, null).some((i) => i.href === "/analitica"),
    ).toBe(false);
  });

  // Feature 133 (T2.4) — R4: el conjunto de acceso es una WHITELIST.
  //
  // El rol es SINTÉTICO a propósito: representa un `RolValue` que alguien añada mañana al
  // esquema sin pasar por aquí. Lo que se afirma es la política de la puerta —lo no
  // enumerado queda FUERA por defecto—, no el nombre concreto. Si `puedeVer` cambiara
  // alguna vez a "deny-list" (excluir apiKey y admitir el resto), este caso sería el que
  // se pusiera rojo: hoy los cinco lectores son también todos los roles humanos, así que
  // ningún rol REAL puede distinguir una política de la otra.
  it("R4: un RolValue desconocido no ve el ítem ni pasaría el gate (whitelist, no deny-list)", () => {
    const rolSintetico = "rolQueNoExisteTodavia" as RolValue;

    expect(puedeVer(analitica, actor(rolSintetico))).toBe(false);
    expect(
      itemsVisibles(SIDEBAR_ITEMS, actor(rolSintetico)).some(
        (i) => i.href === "/analitica",
      ),
    ).toBe(false);
    // Y el gate de la página (`app/(app)/analitica/page.tsx`) lee esta misma constante:
    // si no está en ella, recibe `notFound()`.
    expect(
      (ROLES_ACCESO_ANALITICA as readonly string[]).includes(rolSintetico),
    ).toBe(false);
    // No ve NINGÚN ítem del sidebar, de hecho: ninguno lo enumera.
    expect(itemsVisibles(SIDEBAR_ITEMS, actor(rolSintetico))).toEqual([]);
  });

  it("R11: su iconKey es 'chartColumn' y ningún otro ítem de SIDEBAR_ITEMS usa esa clave", () => {
    expect(analitica.iconKey).toBe("chartColumn");
    const otrosConMismaClave = SIDEBAR_ITEMS.filter(
      (i) => i !== analitica && i.iconKey === "chartColumn",
    );
    expect(otrosConMismaClave).toHaveLength(0);
  });

  it("R15: el ítem de analítica no declara subítems (children)", () => {
    expect(analitica.children).toBeUndefined();
  });

  it("R16: el ítem de analítica va justo después de 'Inicio' y antes del primer 'Órdenes'", () => {
    const indiceInicio = SIDEBAR_ITEMS.findIndex((i) => i.label === "Inicio");
    const indiceAnalitica = SIDEBAR_ITEMS.findIndex(
      (i) => i.href === "/analitica",
    );
    const indicePrimerOrdenes = SIDEBAR_ITEMS.findIndex(
      (i) => i.href === "/ordenes",
    );
    expect(indiceAnalitica).toBe(indiceInicio + 1);
    expect(indiceAnalitica).toBeLessThan(indicePrimerOrdenes);
  });

  // R10 (T4.5) — el test más importante de este bloque: las dos capas de
  // autorización (el ítem del menú y el guard de la página) deben declarar
  // EXACTAMENTE el mismo conjunto de roles. Se compara por CONJUNTO (inclusión
  // mutua), no por identidad de referencia (`toBe`): un test que solo comprobara
  // `analitica.roles === ROLES_ACCESO_ANALITICA` pasaría igual aunque alguien copiara
  // los valores a mano en el ítem y luego cambiara sólo uno de los dos sitios — el
  // bug exacto que R10 existe para atrapar. La feature 133 ("recortes por rol")
  // debe tocar los DOS sitios (`lib/auth/menu-visibility.ts`: el `roles` del ítem,
  // Y `ROLES_ACCESO_ANALITICA`, que también usa el guard de
  // `app/(app)/analitica/page.tsx`) o este test se pone rojo.
  //
  // `ROLES_ACCESO_ANALITICA` se llamaba `ROLES_ANALITICA` hasta el rename de
  // 2026-07-31: colisionaba con la homónima de `lib/analytics/types.ts` (el
  // ALCANCE dentro de la analítica, cinco roles), que es otra cosa.
  it("R10: el 'roles' del ítem de analítica es el mismo CONJUNTO que ROLES_ACCESO_ANALITICA (usada por el guard de la página)", () => {
    const rolesItem = [...analitica.roles].sort();
    const rolesGuard = [...ROLES_ACCESO_ANALITICA].sort();
    expect(rolesItem).toEqual(rolesGuard);
    // Inclusión mutua explícita, además de la igualdad de arrays ordenados.
    for (const rol of ROLES_ACCESO_ANALITICA) {
      expect(analitica.roles).toContain(rol);
    }
    for (const rol of analitica.roles) {
      expect(ROLES_ACCESO_ANALITICA).toContain(rol);
    }
  });
});

// Feature 167 — el ítem de sidebar "Recolección" (R4, R5). La 167 sacó la recolección en
// tienda de dentro de "Entregas" porque el mensajero no la encontraba; este ítem ES la pista
// permanente de dónde está ahora (design §11, riesgo 1). Si desaparece, la feature vuelve al
// problema que vino a resolver.
describe("Feature 167 — ítem de sidebar de Recolección", () => {
  it("R4: existe exactamente UN ítem con href '/recoleccion' y su label es 'Recolección'", () => {
    const conEseHref = SIDEBAR_ITEMS.filter((i) => i.href === "/recoleccion");
    expect(conEseHref).toHaveLength(1);
    expect(conEseHref[0].label).toBe("Recolección");
  });

  it("R4: lo ve el mensajero", () => {
    expect(puedeVer(recoleccion, actor("mensajero"))).toBe(true);
    expect(
      itemsVisibles(SIDEBAR_ITEMS, actor("mensajero")).some(
        (i) => i.href === "/recoleccion",
      ),
    ).toBe(true);
  });

  it("R4: NINGÚN otro rol lo ve, ni un actor ausente", () => {
    // El acto físico de recolectar en la tienda es del mensajero. El maestro asigna la
    // recolección (157) desde otra pantalla; nadie más tiene nada que hacer aquí.
    for (const rol of [
      "maestro",
      "admin",
      "adminTienda",
      "adminSatelite",
      "apiKey",
    ] as RolValue[]) {
      expect(puedeVer(recoleccion, actor(rol))).toBe(false);
      expect(
        itemsVisibles(SIDEBAR_ITEMS, actor(rol)).some(
          (i) => i.href === "/recoleccion",
        ),
      ).toBe(false);
    }
    expect(puedeVer(recoleccion, null)).toBe(false);
    expect(
      itemsVisibles(SIDEBAR_ITEMS, null).some((i) => i.href === "/recoleccion"),
    ).toBe(false);
  });

  it("R5: su iconKey es 'store' y ningún otro ítem de SIDEBAR_ITEMS usa esa clave", () => {
    expect(recoleccion.iconKey).toBe("store");
    const otrosConMismaClave = SIDEBAR_ITEMS.filter(
      (i) => i !== recoleccion && i.iconKey === "store",
    );
    expect(otrosConMismaClave).toHaveLength(0);
    // En particular NO reusa el `truck` de "Entregas": recolectar en la tienda y repartir
    // en la calle son dos trabajos distintos, y ese es el punto entero de la feature.
    expect(recoleccion.iconKey).not.toBe(entregas.iconKey);
  });

  it("decisión del humano (2026-07-31): va justo debajo de 'Entregas'", () => {
    const indiceEntregas = SIDEBAR_ITEMS.findIndex(
      (i) => i.href === "/mis-asignaciones",
    );
    const indiceRecoleccion = SIDEBAR_ITEMS.findIndex(
      (i) => i.href === "/recoleccion",
    );
    expect(indiceRecoleccion).toBe(indiceEntregas + 1);
  });

  it("R4: el ítem no declara subítems (no es una sección de Entregas)", () => {
    expect(recoleccion.children).toBeUndefined();
  });
});

// Feature 192 (F3.2) — el ítem de sidebar "Monitoreo" (R35, R53, R54).
//
// El tablero del día es una pantalla de LECTURA con datos de todas las zonas (o de la zona
// del satélite): la lista de roles del ítem son los de R1 y ni uno más. Pero el caso que de
// verdad hay que atornillar aquí es R54: el aterrizaje post-login sale del PRIMER ítem
// visible del menú, y ya hubo un incidente exactamente así con "Analítica" (ver el campo
// `destinoInicial` en `lib/auth/menu-visibility.ts`). Añadir un ítem visible en posición 3
// mueve el aterrizaje de `adminSatelite` **en silencio** si falta la marca.
const ROLES_MONITOREO = ["admin", "maestro", "adminSatelite"] as const;
const ROLES_SIN_MONITOREO = ["adminTienda", "mensajero", "apiKey"] as const;

describe("Feature 192 — ítem de sidebar de Monitoreo", () => {
  it("R53: existe exactamente UN ítem con href '/monitoreo' y su label es 'Monitoreo'", () => {
    const conEseHref = SIDEBAR_ITEMS.filter((i) => i.href === "/monitoreo");
    expect(conEseHref).toHaveLength(1);
    expect(conEseHref[0].label).toBe("Monitoreo");
  });

  it("R35/R53: lo ven los TRES roles de R1 (admin, maestro, adminSatelite) y nadie más", () => {
    for (const rol of ROLES_MONITOREO) {
      expect(puedeVer(monitoreo, actor(rol))).toBe(true);
      expect(
        itemsVisibles(SIDEBAR_ITEMS, actor(rol)).some((i) => i.href === "/monitoreo"),
      ).toBe(true);
    }
    // El tablero enseña las órdenes de TODA una zona (o de todas): `adminTienda` y
    // `mensajero` no tienen nada que hacer ahí, y `apiKey` es una cuenta de máquina que no
    // navega. La defensa real es el `notFound()` de la ruta (R11); el menú no les ofrece la
    // puerta.
    for (const rol of ROLES_SIN_MONITOREO) {
      expect(puedeVer(monitoreo, actor(rol))).toBe(false);
      expect(
        itemsVisibles(SIDEBAR_ITEMS, actor(rol)).some((i) => i.href === "/monitoreo"),
      ).toBe(false);
    }
    expect(puedeVer(monitoreo, null)).toBe(false);
    expect(
      itemsVisibles(SIDEBAR_ITEMS, null).some((i) => i.href === "/monitoreo"),
    ).toBe(false);
    // Whitelist: un `RolValue` que alguien añada mañana al esquema NO entra por defecto.
    expect(puedeVer(monitoreo, actor("rolQueNoExisteTodavia" as RolValue))).toBe(false);
  });

  it("R35/R54: el ítem está marcado `destinoInicial: false` (visible sí, aterrizaje no)", () => {
    expect(monitoreo.destinoInicial).toBe(false);
  });

  it("R53: su iconKey es 'gauge' y ningún otro ítem usa esa clave (en particular, no comparte el de Analítica)", () => {
    expect(monitoreo.iconKey).toBe("gauge");
    const otrosConMismaClave = SIDEBAR_ITEMS.filter(
      (i) => i !== monitoreo && i.iconKey === "gauge",
    );
    expect(otrosConMismaClave).toHaveLength(0);
    expect(monitoreo.iconKey).not.toBe(analitica.iconKey);
  });

  it("R53: el ítem no declara subítems y va junto a 'Analítica'", () => {
    expect(monitoreo.children).toBeUndefined();
    const indiceAnalitica = SIDEBAR_ITEMS.findIndex((i) => i.href === "/analitica");
    const indiceMonitoreo = SIDEBAR_ITEMS.findIndex((i) => i.href === "/monitoreo");
    expect(indiceMonitoreo).toBe(indiceAnalitica + 1);
  });

  // R54, POR VALOR y escrito a mano: los cinco destinos son los mismos que antes de esta
  // feature. Está prohibido derivarlos de `primerDestino`/`SIDEBAR_ITEMS` — eso sería la
  // tautología que ya dejó pasar el incidente de "Analítica".
  it("R54: el aterrizaje post-login de CADA rol es el mismo que antes de añadir el ítem", () => {
    const destinoDe = (rol: RolValue) =>
      primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor(rol)));

    expect(destinoDe("maestro")).toBe("/dashboard");
    expect(destinoDe("admin")).toBe("/dashboard");
    expect(destinoDe("adminTienda")).toBe("/ordenes");
    // Los dos que esta feature podría haber roto sin que nada se pusiera rojo:
    // Feature 279 (R12): el valor del `adminSatelite` cambió a mano el 2026-08-24 al partir
    // su portal en dos subítems. Lo que este caso sigue afirmando es lo de siempre —que el
    // ítem "Monitoreo" no mueve el aterrizaje de nadie—; el destino nuevo es el primer
    // subítem, escrito aquí LITERAL y no derivado de `primerDestino`.
    expect(destinoDe("adminSatelite")).toBe("/recepcion-satelite/por-recibir");
    expect(destinoDe("mensajero")).toBe("/mis-asignaciones/reparto");
  });

  // Y la comprobación DIFERENCIAL, que es la que mata la mutación «quitar
  // `destinoInicial: false`»: el destino calculado con el menú REAL debe coincidir, rol por
  // rol, con el calculado sobre el mismo menú SIN el ítem de Monitoreo.
  it("R54: quitar el ítem del menú no cambia el destino de NINGÚN rol (comparación diferencial)", () => {
    const sinMonitoreo = SIDEBAR_ITEMS.filter((i) => i.href !== "/monitoreo");
    expect(sinMonitoreo).toHaveLength(SIDEBAR_ITEMS.length - 1);

    for (const rol of [
      "maestro",
      "admin",
      "adminTienda",
      "adminSatelite",
      "mensajero",
      "apiKey",
    ] as RolValue[]) {
      const conItem = primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor(rol)));
      const sinItem = primerDestino(itemsVisibles(sinMonitoreo, actor(rol)));
      expect(conItem).toBe(sinItem);
    }
  });
});

// ---------------------------------------------------------------------------------------
// Feature 279 — el portal del `adminSatelite` se parte en dos subítems.
//
// TODO lo de este bloque se juzga sobre el VALOR importado `SIDEBAR_ITEMS` (R32), nunca
// sobre el texto del archivo que lo declara. No es una preferencia de estilo: hasta el
// 2026-08-24 este fuente tenía un comodín de ruta dentro de un comentario de línea que
// abría un bloque, y el quitador del repo se tragaba 151 líneas —entre ellas ESTE ítem—.
// Una guardia que hubiera leído el fuente habría aprobado el vacío en verde. El agujero
// está cerrado (ver el describe de legibilidad, más abajo), y aun así el menú se sigue
// juzgando por valor: eso es defensa en profundidad, no permiso para volver al texto.
// ---------------------------------------------------------------------------------------
describe("Feature 279 — subítems del portal del adminSatelite (sobre SIDEBAR_ITEMS)", () => {
  const portalSatelite = (): MenuItem => {
    const it = SIDEBAR_ITEMS.find((i) => i.href === "/recepcion-satelite");
    if (!it) throw new Error("sin ítem /recepcion-satelite");
    return it;
  };

  it("R8: el ítem conserva la etiqueta «Órdenes» y declara Por recibir (primero) y En bodega", () => {
    const item = portalSatelite();
    // Anti-vacuidad: el ítem que se está juzgando es el del satélite y no otro.
    expect(item.label).toBe("Órdenes");
    expect(item.roles).toEqual(["adminSatelite"]);

    expect(item.children).toBeDefined();
    expect(item.children?.map((c) => c.label)).toEqual(["Por recibir", "En bodega"]);
    expect(item.children?.map((c) => c.href)).toEqual([
      "/recepcion-satelite/por-recibir",
      "/recepcion-satelite/en-bodega",
    ]);
  });

  it("R9: el href del padre se conserva (identifica al ítem) y NO coincide con ningún subítem", () => {
    const item = portalSatelite();
    expect(item.href).toBe("/recepcion-satelite");
    expect(item.children?.map((c) => c.href)).not.toContain("/recepcion-satelite");
  });

  it("R10: los dos subítems sólo los alcanza el adminSatelite; ningún otro rol ni un actor sin sesión", () => {
    const subrutas = [
      "/recepcion-satelite/por-recibir",
      "/recepcion-satelite/en-bodega",
    ];
    const subrutasVisibles = (rol: RolValue | null): string[] =>
      itemsVisibles(SIDEBAR_ITEMS, rol === null ? null : actor(rol))
        .flatMap((i) => i.children ?? [])
        .map((c) => c.href)
        .filter((h) => subrutas.includes(h));

    // Positivo primero: si el filtro estuviera roto y devolviera siempre vacío, este
    // aserto lo denuncia en vez de dejar pasar las cinco ausencias de abajo.
    expect(subrutasVisibles("adminSatelite")).toEqual(subrutas);

    for (const rol of [
      "maestro",
      "admin",
      "adminTienda",
      "mensajero",
      "apiKey",
    ] as RolValue[]) {
      expect(subrutasVisibles(rol)).toEqual([]);
    }
    expect(subrutasVisibles(null)).toEqual([]);
  });

  it("R12: el aterrizaje post-login del adminSatelite es el PRIMER subítem, «Por recibir»", () => {
    const destino = primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor("adminSatelite")));
    expect(destino).toBe("/recepcion-satelite/por-recibir");
    // Y no la ruta del padre, que desde la 279 sólo redirige:
    expect(destino).not.toBe("/recepcion-satelite");
  });
});

// ---------------------------------------------------------------------------------------
// Feature 279 (R45/R46, T1.6) — el fuente del menú sigue siendo LEGIBLE para las guardias.
//
// Hasta el 2026-08-24 la línea 228 escribía una ruta con comodín dentro de un comentario
// de línea. Esa barra-asterisco ABRE un bloque de comentario, y `quitarComentarios` —el
// quitador único del repo— lo cerraba en el siguiente cierre de bloque del archivo (el
// JSDoc de `puedeVer`, línea 378): 151 líneas desaparecían del texto que lee CUALQUIER
// guardia que escanee este fuente. Medido con el propio quitador: 76 líneas no vacías
// sobrevivían antes del arreglo, 156 después.
//
// Este describe es el que impide que vuelva a pasar. No mide el número —que cambia con
// cada ítem nuevo— sino la PERTENENCIA: el último ítem de la lista y las dos subrutas del
// satélite tienen que verse en el texto barrido.
// ---------------------------------------------------------------------------------------
describe("Feature 279 — el fuente del menú es legible para las guardias que lo escanean", () => {
  const RUTA_MENU = "lib/auth/menu-visibility.ts";
  const fuenteCrudo = readFileSync(path.join(process.cwd(), RUTA_MENU), "utf8");

  it("R45: ninguna línea abre un bloque de comentario dentro de un comentario de línea", () => {
    // Anti-vacuidad (R31): el texto que se está leyendo es el del menú de verdad.
    expect(fuenteCrudo).toContain("SIDEBAR_ITEMS");
    expect(fuenteCrudo.split("\n").length).toBeGreaterThan(300);

    const infractoras = fuenteCrudo
      .split("\n")
      .map((linea, i) => ({ n: i + 1, linea }))
      .filter(({ linea }) => {
        const posLinea = linea.indexOf("//");
        const posBloque = linea.indexOf("/" + "*");
        return posLinea !== -1 && posBloque !== -1 && posBloque > posLinea;
      })
      .map(({ n, linea }) => `${n}: ${linea.trim()}`);

    expect(infractoras).toEqual([]);
  });

  it("R46: el fuente pasado por el quitador conserva el ÚLTIMO ítem y las dos subrutas del satélite", () => {
    const barrido = quitarComentarios(fuenteCrudo);

    // Anti-vacuidad (R31): el quitador devolvió código, no un archivo vaciado. Si el
    // agujero volviera, estos tres anclajes desaparecen y el caso se pone rojo — que es
    // exactamente lo que la mutación (f) de T5.2 comprueba.
    expect(barrido).toContain("export const SIDEBAR_ITEMS");
    expect(barrido.split("\n").filter((l) => l.trim() !== "").length).toBeGreaterThan(100);

    expect(barrido).toContain('label: "Incidentes"');
    expect(barrido).toContain('"/recepcion-satelite/por-recibir"');
    expect(barrido).toContain('"/recepcion-satelite/en-bodega"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FICHA 335 — D4 (R31/R32): la puerta a `/mi-wallet`.
//
// La pantalla existía desde la feature 43 y no tenía entrada de menú: se llegaba escribiendo la
// URL, o sea que no se llegaba. Lo que se afirma aquí es que la entrada existe, que la ve UN
// solo rol, y que su lista de roles es LA MISMA constante que lee el gate de la ruta — no una
// copia con los mismos nombres, que es la que puede divergir en silencio.
// ─────────────────────────────────────────────────────────────────────────────

describe("SIDEBAR_ITEMS — «Mi wallet», la puerta del adminTienda a su saldo (R31/R32) [335]", () => {
  it("R31: existe exactamente UN ítem con href `/mi-wallet` y su `roles` es la CONSTANTE", () => {
    const conEseHref = SIDEBAR_ITEMS.filter((i) => i.href === "/mi-wallet");
    expect(conEseHref).toHaveLength(1);

    const item = conEseHref[0];
    expect(item.label).toBe("Mi wallet");
    expect(item.iconKey).toBe("wallet");

    // `toBe`, no `toEqual`: se afirma la IDENTIDAD de la tupla. Un `["adminTienda"]` escrito a
    // mano aquí pasaría un `toEqual` y sería justo el defecto —dos listas capaces de divergir,
    // una que muestra y otra que cierra—. Con la identidad, copiarla no compila la excusa.
    expect(item.roles).toBe(ROLES_MI_WALLET);
    expect(ROLES_MI_WALLET).toEqual(["adminTienda"]);

    // No tiene subítems: es una pantalla, no un apartado. (Un ítem con `children` no navega, y
    // este tiene que navegar.)
    expect(item.children).toBeUndefined();
  });

  it("R32: ningún rol distinto de `adminTienda` lo ve, ni el actor ausente", () => {
    // El barrido va sobre TODOS los `RolValue` del esquema, `apiKey` incluida — que hoy no se
    // afirma en ningún otro caso de este archivo y es precisamente un rol sin persona detrás.
    const TODOS: RolValue[] = [
      "maestro",
      "admin",
      "adminSatelite",
      "adminTienda",
      "mensajero",
      "apiKey",
    ];
    const item = SIDEBAR_ITEMS.find((i) => i.href === "/mi-wallet")!;

    const loVen = TODOS.filter((rol) => puedeVer(item, actor(rol)));
    expect(loVen).toEqual(["adminTienda"]);

    // Y sin sesión no lo ve nadie: `puedeVer` con actor nulo.
    expect(puedeVer(item, null)).toBe(false);

    // Control de no-vacuidad del barrido: si `puedeVer` devolviera siempre `false`, el
    // `toEqual` de arriba pasaría sin decir nada.
    expect(loVen.length).toBeGreaterThan(0);
  });

  it("R35: el ítem va DESPUÉS de «Órdenes» y de «Novedades», así que no mueve el aterrizaje", () => {
    // La posición es la que protege el aterrizaje post-login del rol, no una preferencia
    // estética: `primerDestino` devuelve el `href` del primer visible no marcado
    // `destinoInicial: false`. Se afirma sobre los ítems VISIBLES del rol, que es lo que esa
    // función mira.
    const visibles = itemsVisibles(SIDEBAR_ITEMS, actor("adminTienda"));
    const posiciones = visibles.map((i) => i.label);

    expect(posiciones.indexOf("Mi wallet")).toBeGreaterThan(posiciones.indexOf("Órdenes"));
    expect(primerDestino(visibles)).toBe("/ordenes");

    // Contraprueba directa del incidente que documentan «Analítica» (133) y «Monitoreo» (192):
    // con el ítem colado ANTES de «Órdenes», el rol cambiaría de puerta de entrada.
    const conElItemArriba = [
      visibles.find((i) => i.label === "Mi wallet")!,
      ...visibles.filter((i) => i.label !== "Mi wallet"),
    ];
    expect(primerDestino(conElItemArriba)).toBe("/mi-wallet");
  });
});
