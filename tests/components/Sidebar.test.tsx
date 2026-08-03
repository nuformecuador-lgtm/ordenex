// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { Sidebar } from "@/app/(app)/_components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SIDEBAR_ITEMS, type IconKey, type MenuItem } from "@/lib/auth/menu-visibility";

// usePathname es configurable por test; useRouter se mockea porque el patrón
// del repo lo espera aunque el Sidebar no lo consuma directamente.
const pushMock = vi.fn();
let currentPathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => currentPathname,
}));

// next/link se reemplaza por un <a> real. El Sidebar de shadcn lo pasa vía la
// prop `render` de SidebarMenuButton (variante base-ui), por lo que el <a>
// recibe className, data-* y children ya mergeados por useRender.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    onClick,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    onClick?: (e: React.MouseEvent) => void;
  } & ComponentProps<"a">) => (
    <a
      href={typeof href === "string" ? href : "#"}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

// El Sidebar de shadcn requiere el SidebarProvider (contexto useSidebar). Sin
// prop `items` usa el default (SIDEBAR_ITEMS de menu-visibility).
function renderSidebar(items?: readonly MenuItem[]) {
  return render(
    <SidebarProvider>
      <Sidebar items={items} />
    </SidebarProvider>,
  );
}

/**
 * Enlace del sidebar por `href`. Estos tests renderizan SIDEBAR_ITEMS COMPLETO (sin
 * filtrar por rol) y hay DOS items con el label "Órdenes": el de maestro/admin/
 * adminTienda (`/ordenes`) y el del adminSatelite (`/recepcion-satelite`). En la app
 * real nunca coexisten —`itemsVisibles` filtra por rol y ningún rol ve los dos—, así
 * que aquí se desambigua por destino en vez de por nombre.
 */
function linkPorHref(href: string): HTMLElement {
  const link = screen
    .getAllByRole("link")
    .find((l) => l.getAttribute("href") === href);
  if (!link) throw new Error(`No hay enlace del sidebar con href="${href}"`);
  return link;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentPathname = "/";
});

describe("Sidebar", () => {
  it("render de los items principales (R1, R2, R3)", () => {
    renderSidebar();

    const nav = screen.getByRole("navigation", {
      name: /navegación principal/i,
    });
    expect(nav).toBeInTheDocument();

    // Ranking y Órdenes son enlaces directos (sin subítems).
    const ranking = screen.getByRole("link", { name: "Ranking" });
    const ordenes = linkPorHref("/ordenes");
    expect(ranking).toHaveAttribute("href", "/ranking");
    expect(ordenes).toHaveAccessibleName("Órdenes");

    // Configuración tiene subítems: es un botón colapsable, no un enlace.
    const config = screen.getByRole("button", { name: /configuración/i });
    expect(config).toBeInTheDocument();
    expect(config).toHaveAttribute("aria-expanded", "false");
  });

  it("cada item tiene un icono propio (svg de lucide)", () => {
    renderSidebar();

    const config = screen.getByRole("button", { name: /configuración/i });
    const ranking = screen.getByRole("link", { name: "Ranking" });
    const ordenes = linkPorHref("/ordenes");

    for (const el of [config, ranking, ordenes]) {
      expect(el.querySelector("svg")).not.toBeNull();
    }
  });

  it("los enlaces internos empiezan con '/' y no con '//'", () => {
    renderSidebar();
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("/")).toBe(true);
      expect(href.startsWith("//")).toBe(false);
    }
  });

  it("expande el submenú y muestra los subítems con href correctos", async () => {
    const user = userEvent.setup();
    renderSidebar();

    // Cerrado por defecto: los subítems no están en el DOM.
    expect(screen.queryByRole("link", { name: "Tarifas" })).toBeNull();
    expect(screen.queryByRole("link", { name: "API" })).toBeNull();

    // Al abrir el colapsable aparecen los subítems.
    await user.click(screen.getByRole("button", { name: /configuración/i }));

    const usuarios = screen.getByRole("link", { name: "Usuarios" });
    const tarifas = screen.getByRole("link", { name: "Tarifas" });
    const api = screen.getByRole("link", { name: "API" });
    expect(usuarios).toHaveAttribute("href", "/configuracion");
    expect(tarifas).toHaveAttribute("href", "/configuracion/tarifas");
    expect(api).toHaveAttribute("href", "/configuracion/api");
  });

  it("abre el submenú por defecto cuando un subítem está activo (R4)", () => {
    currentPathname = "/configuracion/tarifas";
    renderSidebar();

    const config = screen.getByRole("button", { name: /configuración/i });
    expect(config).toHaveAttribute("aria-expanded", "true");

    const tarifas = screen.getByRole("link", { name: "Tarifas" });
    expect(tarifas).toHaveAttribute("aria-current", "page");
    expect(tarifas).toHaveAttribute("data-active");

    const api = screen.getByRole("link", { name: "API" });
    expect(api).not.toHaveAttribute("aria-current");
  });

  it("marca item simple activo por ruta (R4, R5)", () => {
    // Por `href`: "Órdenes" está duplicado como label al renderizar sin filtrar.
    const cases: Array<{ path: string; activeHref: string }> = [
      { path: "/ordenes", activeHref: "/ordenes" },
      { path: "/ranking", activeHref: "/ranking" },
    ];

    for (const { path, activeHref } of cases) {
      currentPathname = path;
      const { unmount } = renderSidebar();

      const link = linkPorHref(activeHref);
      expect(link).toHaveAttribute("aria-current", "page");
      expect(link).toHaveAttribute("data-active");
      unmount();
    }

    // Ruta ajena: ningún item simple marcado como activo (R5).
    currentPathname = "/";
    renderSidebar();
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("los items son operables por teclado (R12)", () => {
    renderSidebar();

    for (const link of screen.getAllByRole("link")) {
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href");
    }
    // El trigger del submenú es un botón enfocable.
    const config = screen.getByRole("button", { name: /configuración/i });
    expect(config.tagName).toBe("BUTTON");
  });

  it("renderiza solo los items recibidos por prop (filtrado por rol en el server)", () => {
    // Set de prueba ya filtrado: un solo ítem (p.ej. el portal del adminSatelite).
    const items: readonly MenuItem[] = [
      { label: "Órdenes", href: "/recepcion-satelite", iconKey: "package", roles: [] },
    ];
    renderSidebar(items);

    expect(screen.getByRole("link", { name: "Órdenes" })).toHaveAttribute(
      "href",
      "/recepcion-satelite",
    );
    // Los items no incluidos en la prop no se renderizan.
    expect(screen.queryByRole("button", { name: /configuración/i })).toBeNull();
    expect(screen.queryByRole("link", { name: "Ranking" })).toBeNull();
  });

  it("resuelve el icono por iconKey en cada item recibido", () => {
    const items: readonly MenuItem[] = [
      { label: "Configuración", href: "/configuracion", iconKey: "settings", roles: [] },
      {
        label: "Órdenes",
        href: "/ordenes",
        iconKey: "package",
        roles: [],
        children: [{ label: "Todas", href: "/ordenes" }],
      },
    ];
    renderSidebar(items);

    expect(
      screen.getByRole("link", { name: "Configuración" }).querySelector("svg"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /órdenes/i }).querySelector("svg"),
    ).not.toBeNull();
  });
});

describe("Sidebar colapso (desktop)", () => {
  it("expone un control accesible de colapso", () => {
    renderSidebar();
    // Expandido por defecto (SidebarProvider defaultOpen): la acción es colapsar.
    expect(
      screen.getByRole("button", { name: /colapsar menú/i }),
    ).toBeInTheDocument();
  });

  it("alterna el estado al activarlo (colapsar/expandir)", async () => {
    const user = userEvent.setup();
    renderSidebar();

    // Estado inicial: expandido. El botón dice "Colapsar menú".
    const colapsar = screen.getByRole("button", { name: /colapsar menú/i });
    await user.click(colapsar);

    // Tras el click el estado cambió: ahora ofrece "Expandir menú".
    const expandir = await screen.findByRole("button", {
      name: /expandir menú/i,
    });
    expect(expandir).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /colapsar menú/i }),
    ).toBeNull();

    // Y vuelve a expandir.
    await user.click(expandir);
    expect(
      screen.getByRole("button", { name: /colapsar menú/i }),
    ).toBeInTheDocument();
  });
});

// Feature 57 — el control de logout ("Salir") vive ahora en el topbar del
// PageHeader compartido, NO en el sidebar. Su presencia se cubre en
// PageHeader.test.tsx y su comportamiento en LogoutButton.test.tsx; el sidebar
// ya no renderiza ningún control de logout.
it("el sidebar NO renderiza ningún control de logout (movido al PageHeader)", () => {
  renderSidebar();

  expect(screen.queryByRole("button", { name: "Salir" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Cerrar sesión" }),
  ).toBeNull();
});

// Guard: el submenú se agrupa dentro de un SidebarMenuItem del nav principal.
describe("Sidebar estructura", () => {
  it("el submenú vive dentro del landmark de navegación", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: /configuración/i }));

    const nav = screen.getByRole("navigation", {
      name: /navegación principal/i,
    });
    expect(
      within(nav).getByRole("link", { name: "Usuarios" }),
    ).toBeInTheDocument();
  });
});

// Feature 129 — el ítem de sidebar "Analítica" (R12, R13, R14).
describe("Feature 129 — ítem de sidebar de Analítica", () => {
  // R12: `IconKey` es un TIPO, no existe en runtime, así que no se puede iterar.
  // La garantía FUERTE de R12 la da el compilador: `ICON_BY_KEY` en
  // `app/(app)/_components/Sidebar.tsx` está tipado como `Record<IconKey, SidebarIcon>`,
  // así que si se añade una clave a `IconKey` sin darle icono, `pnpm run typecheck`
  // falla (ver T1.1). Este array literal, tipado con `satisfies readonly IconKey[]`,
  // hace que el compilador también se queje si aquí falta o sobra una clave respecto
  // al tipo real. Este test es la red de seguridad en RUNTIME (que de verdad se pinte
  // un <svg>), no la garantía principal.
  const TODAS_LAS_CLAVES = [
    "home",
    "settings",
    "user",
    "package",
    "clipboardCheck",
    "truck",
    "megaphone",
    "trophy",
    "wallet",
    "shieldAlert",
    "chartColumn",
    "store",
  ] as const satisfies readonly IconKey[];
  // Comprobación de exhaustividad tipada: si `IconKey` gana una clave que no está en
  // el array de arriba, `Exclude<IconKey, (typeof TODAS_LAS_CLAVES)[number]>` deja de
  // ser `never` y esta asignación deja de compilar.
  type ClavesFaltantes = Exclude<IconKey, (typeof TODAS_LAS_CLAVES)[number]>;
  const _exhaustividad: ClavesFaltantes extends never ? true : never = true;
  void _exhaustividad;

  it("R12: toda clave de IconKey resuelve a un ícono renderizado (svg) en el Sidebar", () => {
    const items: readonly MenuItem[] = TODAS_LAS_CLAVES.map((clave) => ({
      label: clave,
      href: `/prueba-${clave}`,
      iconKey: clave,
      roles: [],
    }));
    renderSidebar(items);

    for (const clave of TODAS_LAS_CLAVES) {
      const link = linkPorHref(`/prueba-${clave}`);
      expect(link.querySelector("svg")).not.toBeNull();
    }
  });

  it("R13: renderiza un enlace a /analitica con la etiqueta 'Analítica' y su icono", () => {
    renderSidebar(SIDEBAR_ITEMS);

    const link = linkPorHref("/analitica");
    expect(link).toHaveAccessibleName("Analítica");
    expect(link.querySelector("svg")).not.toBeNull();
  });

  it("R14: con pathname '/analitica' el enlace de Analítica queda activo", () => {
    currentPathname = "/analitica";
    renderSidebar(SIDEBAR_ITEMS);

    const link = linkPorHref("/analitica");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveAttribute("data-active");
  });

  // R11 / decision D4 / alternativa A2 del design.md: "compartir icono con otra
  // sección invita a leer analítica como parte de esa sección". El test R12 de
  // arriba solo prueba que la CLAVE `chartColumn` es única en el mapa `IconKey`
  // (garantía tipada) y que ALGÚN svg se pinta; no prueba que ese svg sea un
  // ícono PROPIO. Una mutación que resuelva `chartColumn` al mismo componente
  // que "Inicio" (`chartColumn: Home` en `ICON_BY_KEY`) pasaría esas
  // comprobaciones intactas: la clave sigue existiendo y sigue pintando un
  // <svg>, solo que es el ícono equivocado. Lucide marca cada ícono con una
  // clase `lucide-<nombre-kebab>` propia (`createLucideIcon`), así que
  // comparamos esa clase (no solo la presencia de un <svg>) contra la de
  // "Inicio" y la de TODOS los demás items del menú.
  it("R11/D4/A2: el icono de Analítica es propio — no coincide con el de Inicio ni con el de ningún otro item", () => {
    renderSidebar(SIDEBAR_ITEMS);

    const analiticaLink = linkPorHref("/analitica");
    const analiticaSvg = analiticaLink.querySelector("svg");
    expect(analiticaSvg).not.toBeNull();
    const analiticaClass = analiticaSvg!.getAttribute("class") ?? "";
    // El ícono real del mapa (`ChartColumn`) lleva esta clase; si la mutación
    // resuelve `chartColumn` a `Home`, esta clase deja de aparecer.
    expect(analiticaClass).toMatch(/lucide-chart-column/);

    // Contra "Inicio" en particular (el caso concreto de la mutación).
    const inicioSvg = linkPorHref("/dashboard").querySelector("svg");
    expect(inicioSvg).not.toBeNull();
    expect(inicioSvg!.getAttribute("class")).not.toBe(analiticaClass);

    // Contra CUALQUIER otro item/subitem del menú (enlaces y triggers
    // colapsables), no solo "Inicio": ningún ícono del menú debe reutilizarse.
    const otrosIconos = [...screen.getAllByRole("link"), ...screen.getAllByRole("button")]
      .filter((el) => el !== analiticaLink)
      .map((el) => el.querySelector("svg"))
      .filter((svg): svg is SVGSVGElement => svg !== null && svg !== analiticaSvg);

    expect(otrosIconos.length).toBeGreaterThan(0);
    for (const svg of otrosIconos) {
      expect(svg.getAttribute("class")).not.toBe(analiticaClass);
    }
  });

  // Feature 167 (R4/R5) — el apartado de recolección tiene entrada propia y su clave de
  // icono resuelve a un icono PROPIO. Mismo molde que el caso de Analítica de arriba: la
  // exhaustividad tipada de `TODAS_LAS_CLAVES` prueba que la clave existe en el mapa, pero
  // no que apunte al componente correcto. Una mutación `store: Truck` en `ICON_BY_KEY`
  // pasaría todo lo demás y dejaría la recolección con el icono de Entregas — precisamente
  // la confusión que R5 existe para impedir.
  it("R4/R5: el enlace a /recoleccion existe y su icono es PROPIO (no el de Entregas)", () => {
    renderSidebar(SIDEBAR_ITEMS);

    const recoleccionLink = linkPorHref("/recoleccion");
    expect(recoleccionLink).toHaveAccessibleName("Recolección");
    const recoleccionSvg = recoleccionLink.querySelector("svg");
    expect(recoleccionSvg).not.toBeNull();
    const recoleccionClass = recoleccionSvg!.getAttribute("class") ?? "";
    // `Store` de lucide marca su svg con esta clase; con `store: Truck` desaparece.
    expect(recoleccionClass).toMatch(/lucide-store/);

    // Contra "Entregas" en particular (el caso concreto de la mutación). Desde el
    // 2026-07-31 "Entregas" tiene submenú, así que NO es un enlace: se renderiza como el
    // disparador del desplegable (un `button`), y por ahí hay que buscar su icono.
    const entregasSvg = screen
      .getByRole("button", { name: "Entregas" })
      .querySelector("svg");
    expect(entregasSvg).not.toBeNull();
    expect(entregasSvg!.getAttribute("class")).not.toBe(recoleccionClass);

    // Contra CUALQUIER otro item/subitem del menú.
    const otrosIconos = [...screen.getAllByRole("link"), ...screen.getAllByRole("button")]
      .filter((el) => el !== recoleccionLink)
      .map((el) => el.querySelector("svg"))
      .filter((svg): svg is SVGSVGElement => svg !== null && svg !== recoleccionSvg);

    expect(otrosIconos.length).toBeGreaterThan(0);
    for (const svg of otrosIconos) {
      expect(svg.getAttribute("class")).not.toBe(recoleccionClass);
    }
  });
});
