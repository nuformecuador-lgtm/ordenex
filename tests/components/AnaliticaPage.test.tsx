// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import type { RolValue } from "@prisma/client";

import AnaliticaPage from "@/app/(app)/analitica/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";

// Feature 129 (R1-R6, R24) — la PÁGINA de analítica resuelve el rol SOLO
// server-side. La entrada del menú decide qué se MUESTRA; ESTA es la defensa real.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  // Feature 131 (T6.2): el árbol de cliente que la 131 enchufa en los dos slots lee el
  // filtro de la URL (design §4.2). Es un mock del NAVEGADOR, no de una capa de datos.
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/analitica",
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

// Feature 131 (T6.2) — los mocks del nuevo árbol de CLIENTE. Ojo con lo que esto NO
// significa: la PÁGINA sigue sin importar `lib/actions` (R24 de la 129, comprobado sobre
// el código fuente más abajo). Quien invoca estas acciones son `FiltrosOperativos` y
// `PanelesOperativos`, que son componentes de cliente con su propio SWR; mockearlas aquí
// es lo que evita que jsdom intente arrancar Prisma al montarlos.
vi.mock("@/lib/actions/analitica-operativa", () => ({
  consultarAnaliticaOperativa: vi.fn(async () => ({ status: "forbidden" as const })),
}));
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(async () => ({ status: "forbidden" as const })),
}));
vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarUsuariosPorRol: vi.fn(async () => ({ status: "forbidden" as const })),
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

// R5: `AnaliticaPage` no acepta argumentos. Se tipa aquí como una función que sí
// los acepta para poder invocarla "a la fuerza" con un objeto arbitrario (como si
// fuera props/searchParams) y demostrar que ni siquiera así puede colarse un rol
// autorizado por esa vía.
const invocarConArgumento = AnaliticaPage as unknown as (
  arg?: unknown,
) => Promise<ReactElement>;

async function renderPage(props?: unknown) {
  render(await invocarConArgumento(props));
}

describe("Feature 129 (R1, R2) — maestro y admin ven el shell", () => {
  it.each(["maestro", "admin"] as RolValue[])(
    "el rol `%s` ve el encabezado y las dos regiones del tablero",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();

      expect(
        screen.getByRole("heading", { name: "Analítica" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Filtros" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Tablero operativo" }),
      ).toBeInTheDocument();
    },
  );
});

describe("Feature 129 (R3) — el resto de roles recibe notFound", () => {
  it.each([
    "mensajero",
    "adminTienda",
    "adminSatelite",
    "apiKey",
  ] as RolValue[])("el rol `%s` recibe notFound y no se pinta nada", async (rol) => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
    await expect(renderPage()).rejects.toThrow(NotFoundError);
    expect(screen.queryByRole("heading", { name: "Analítica" })).toBeNull();
  });
});

describe("Feature 129 (R4) — sin sesión", () => {
  it("actor nulo recibe notFound y no se pinta nada", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow(NotFoundError);
    expect(screen.queryByRole("heading", { name: "Analítica" })).toBeNull();
  });
});

describe("Feature 129 (R5) — el rol sale SOLO del mock de sesión", () => {
  it("AnaliticaPage no declara parámetros", () => {
    expect(AnaliticaPage.length).toBe(0);
  });

  it("pasarle un objeto con un rol autorizado como si fuera prop/searchParam no cambia nada: sigue lanzando notFound con sesión no autorizada", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    // Ni prop, ni query param, ni cabecera: nada de lo que se le "cuele" a la
    // función por sus argumentos puede sustituir a la sesión resuelta server-side.
    await expect(
      renderPage({ rol: "maestro", searchParams: { rol: "admin" } }),
    ).rejects.toThrow(NotFoundError);
  });

  it("lo mismo sin sesión: pasar un objeto con rol autorizado no evita el notFound", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(renderPage({ rol: "admin" })).rejects.toThrow(NotFoundError);
  });
});

describe("Feature 129 (R6) — el gate corre ANTES de renderizar", () => {
  it("con rol no autorizado, la promesa rechaza y ninguna región llega a pintarse", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminTienda" });
    await expect(renderPage()).rejects.toThrow(NotFoundError);
    expect(
      screen.queryByRole("region", { name: "Tablero operativo" }),
    ).toBeNull();
  });
});

describe("Feature 129 (R24) — la página no invoca acciones/servicios/repositorios de analítica", () => {
  it("renderiza con SOLO resolve-actor mockeado (no hay ninguna otra dependencia de datos que mockear)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    await renderPage();
    expect(
      screen.getByRole("region", { name: "Tablero operativo" }),
    ).toBeInTheDocument();
  });

  // Refuerzo sobre el CÓDIGO FUENTE: un test que solo verifique el render no
  // detectaría un `await listarAlgoDeAnalitica()` cuyo resultado se ignore o se
  // trague en un try/catch. Leer el archivo y buscar los prefijos de import de
  // Server Actions/servicios/repositorios es la única forma de afirmar con
  // certeza que la página no toca esas capas.
  it("el código fuente de la página no importa lib/actions, lib/services ni lib/repositories", () => {
    const ruta = join(
      process.cwd(),
      "app",
      "(app)",
      "analitica",
      "page.tsx",
    );
    const fuente = readFileSync(ruta, "utf-8");
    expect(fuente).not.toContain("lib/actions");
    expect(fuente).not.toContain("lib/services");
    expect(fuente).not.toContain("lib/repositories");
  });
});

describe("Feature 131 (T6.2, R26) — los dos slots ya están cableados", () => {
  it("las dos regiones ya NO muestran el placeholder «llega en una entrega posterior»", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    await renderPage();

    // El shell pinta ese `EmptyState` cuando su slot llega vacío
    // (`AnaliticaShell.tsx:48-63`). Verlo ahora sería una mentira en pantalla: los
    // controles y los paneles ya existen.
    expect(screen.queryByText(/llega en una entrega posterior/)).toBeNull();
    expect(
      screen.getByRole("region", { name: "Filtros" }).textContent ?? "",
    ).not.toContain("entrega posterior");
    expect(
      screen.getByRole("region", { name: "Tablero operativo" }).textContent ?? "",
    ).not.toContain("entrega posterior");
  });

  it("R26 — el gate de la ruta sigue siendo `maestro`/`admin` y la página sigue sin parámetros", () => {
    // Ampliar `ROLES_ACCESO_ANALITICA` es de la 133, no de esta feature; y darle un
    // parámetro a la página es lo que D7 decidió NO hacer.
    expect([...ROLES_ACCESO_ANALITICA]).toEqual(["maestro", "admin"]);
    expect(AnaliticaPage.length).toBe(0);
  });
});
