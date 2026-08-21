// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mocks de las dependencias server-side de app/login/page.tsx. El propio
// page.tsx (Server Component real) se importa sin mockear: se ejercita su
// logica real de R24 (redireccion si hay sesion valida).
const cookieGetMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

const redirectMock = vi.fn((path: string) => {
  // Emula el comportamiento real de next/navigation redirect(): interrumpe
  // la ejecucion lanzando una excepcion especial.
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

const findValidByIdMock = vi.fn();
vi.mock("@/lib/repositories/SessionRepository", () => ({
  // Debe ser una funcion "normal" (no arrow) para poder invocarse con `new`,
  // igual que hace app/login/page.tsx.
  SessionRepository: vi.fn().mockImplementation(function SessionRepositoryMock(this: {
    findValidById: typeof findValidByIdMock;
  }) {
    this.findValidById = findValidByIdMock;
  }),
}));

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

// Aisla la logica de la pagina (R24) del formulario cliente (R1-R23, ya
// cubiertos en LoginForm.test.tsx) con un stub identificable.
vi.mock("@/app/login/_components/LoginForm", () => ({
  LoginForm: ({ redirectParam }: { redirectParam: string | null }) => (
    <div data-testid="login-form-stub">redirectParam:{redirectParam ?? "null"}</div>
  ),
}));

// El enlace de vuelta a la landing usa `next/link`; en jsdom se sustituye por
// un `<a>` equivalente, el mismo doble que usa
// tests/integration/login-form-reset-link.test.tsx.
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * Ancestros del elemento (incluido él mismo) que llevan la clase `hidden`.
 *
 * El panel de marca de esta pantalla es `hidden ... md:flex`: un enlace metido
 * ahí no existiría en móvil, que es justo donde es la única salida. jsdom no
 * resuelve media queries, así que la forma honesta de fijar "está presente sin
 * depender del breakpoint" es comprobar que ni el enlace ni ninguno de sus
 * ancestros arrastra ese `hidden`.
 */
function ancestrosOcultos(el: HTMLElement): string[] {
  const ocultos: string[] = [];
  for (let nodo: HTMLElement | null = el; nodo !== null; nodo = nodo.parentElement) {
    if (nodo.classList.contains("hidden")) ocultos.push(nodo.className);
  }
  return ocultos;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app/login/page.tsx — sesion activa (R24)", () => {
  it("redirige a /dashboard cuando la cookie de sesion es valida segun SessionRepository.findValidById", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    cookieGetMock.mockReturnValue({ value: "session-abc" });
    findValidByIdMock.mockResolvedValue({
      id: "session-abc",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 1000 * 60),
      createdAt: new Date(),
    });

    await expect(
      LoginPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(findValidByIdMock).toHaveBeenCalledWith("session-abc");
  });

  it("renderiza el formulario cuando no hay cookie de sesion", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    cookieGetMock.mockReturnValue(undefined);

    const element = await LoginPage({ searchParams: Promise.resolve({ redirect: "/dashboard" }) });
    render(element);

    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("login-form-stub")).toHaveTextContent("redirectParam:/dashboard");
  });

  it("renderiza el formulario cuando la sesion de la cookie esta expirada/invalida", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    cookieGetMock.mockReturnValue({ value: "session-expired" });
    findValidByIdMock.mockResolvedValue(null);

    const element = await LoginPage({ searchParams: Promise.resolve({}) });
    render(element);

    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("login-form-stub")).toBeInTheDocument();
  });
});

describe("app/login/page.tsx — salida a la landing", () => {
  it("ofrece un enlace accesible de vuelta cuyo href es exactamente / y que no depende del breakpoint", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    cookieGetMock.mockReturnValue(undefined);

    const element = await LoginPage({ searchParams: Promise.resolve({}) });
    render(element);

    // (a) existe la salida y lleva a la landing, no a "atrás" ni a otra ruta.
    const volver = screen.getByRole("link", { name: "Volver al inicio" });
    expect(volver).toHaveAttribute("href", "/");

    // (b) está en las dos anchuras: no vive bajo el `hidden md:flex` del panel de marca.
    expect(ancestrosOcultos(volver)).toEqual([]);
  });
});
