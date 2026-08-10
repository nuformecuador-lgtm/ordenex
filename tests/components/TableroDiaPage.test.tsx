// @vitest-environment jsdom
//
// Feature 192 (F1.2, R11) — LA PUERTA DE LA PANTALLA.
//
// El ítem de menú "Monitoreo" sólo decide qué se MUESTRA. Lo que impide de verdad que un
// `adminTienda` lea las órdenes por mensajero es el `notFound()` de esta página, y eso es lo
// único que este archivo mide: quién entra, quién no, y que la lista de roles de la puerta sea
// la MISMA que la del menú (una pantalla que se ve en el menú y responde 404 —o al revés— es
// peor que cualquiera de las dos).
//
// El módulo de cliente se sustituye por un doble: montarlo de verdad arrastraría SWR y las
// Server Actions a un test de jsdom, y lo que aquí se afirma es el gate, no el tablero.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RolValue } from "@prisma/client";

import MonitoreoPage from "@/app/(app)/monitoreo/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { SIDEBAR_ITEMS } from "@/lib/auth/menu-visibility";

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}

// El shell de página (`AppPage` → `PageHeader` → `LogoutButton`) es parte de lo que se
// renderiza, así que el doble de `next/navigation` cubre también los hooks del navegador.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/monitoreo",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const MARCA_MODULO = "modulo-tablero-dia";

vi.mock("@/app/(app)/monitoreo/_components/TableroDiaModule", () => ({
  TableroDiaModule: () => <div data-testid="modulo-tablero-dia" />,
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);

/** Actor mínimo con el rol pedido. La página sólo mira el rol. */
function actorConRol(rol: RolValue) {
  return {
    usuarioId: "u-1",
    rol,
    zonaId: rol === "adminSatelite" ? "z-1" : null,
    tiendaId: null,
  } as unknown as Awaited<ReturnType<typeof resolveActorFromSession>>;
}

async function renderPagina() {
  const elemento = await MonitoreoPage();
  return render(elemento);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Feature 192 · R11 — la ruta /monitoreo se cierra en el SERVIDOR", () => {
  it.each(["admin", "maestro", "adminSatelite"] as const)(
    "%s entra y ve el módulo del tablero",
    async (rol) => {
      resolveActorMock.mockResolvedValue(actorConRol(rol));

      await renderPagina();

      expect(screen.getByTestId(MARCA_MODULO)).toBeInTheDocument();
    },
  );

  it.each(["adminTienda", "mensajero"] as const)(
    "%s NO entra: la página responde 404, no una versión recortada del tablero",
    async (rol) => {
      resolveActorMock.mockResolvedValue(actorConRol(rol));

      // El fallo importa tanto como el mensaje: un rol denegado no puede recibir un tablero
      // vacío que se lea como "hoy no hay órdenes asignadas".
      await expect(renderPagina()).rejects.toThrow(NotFoundError);
      expect(screen.queryByTestId(MARCA_MODULO)).toBeNull();
    },
  );

  it("sin sesión, 404", async () => {
    resolveActorMock.mockResolvedValue(null);

    await expect(renderPagina()).rejects.toThrow(NotFoundError);
    expect(screen.queryByTestId(MARCA_MODULO)).toBeNull();
  });

  it("la puerta y el ítem de menú declaran EXACTAMENTE los mismos roles", () => {
    // Son dos listas en dos archivos, y la única forma de que no diverjan es medirlo. Si
    // alguien añade un rol al menú y olvida la página, el rol vería la entrada y se comería un
    // 404; si lo añade a la página y olvida el menú, tendría acceso sin forma de llegar.
    const item = SIDEBAR_ITEMS.find((entrada) => entrada.href === "/monitoreo");
    expect(item, "desapareció el ítem 'Monitoreo' del menú").toBeDefined();
    expect([...(item?.roles ?? [])].sort()).toEqual(
      ["admin", "adminSatelite", "maestro"].sort(),
    );
  });

  it("la página NO fetchea datos: no importa repositorios, servicios ni la base", () => {
    // Censo sobre el código fuente (mismo criterio que `AnaliticaPage.test.tsx`): la página es
    // el gate y el shell. Los conteos los pide el módulo de cliente por Server Action + SWR.
    const fuente = readFileSync(
      path.join(process.cwd(), "app/(app)/monitoreo/page.tsx"),
      "utf8",
    );
    for (const prohibido of ["lib/repositories", "lib/services", "@/lib/db", "$queryRaw"]) {
      expect(fuente, `la página importa ${prohibido}`).not.toContain(prohibido);
    }
    expect(MonitoreoPage.length, "la página no recibe props/params").toBe(0);
  });
});
