// @vitest-environment jsdom
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app/login/page.tsx — sesion activa (R24)", () => {
  it("redirige a / cuando la cookie de sesion es valida segun SessionRepository.findValidById", async () => {
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
    ).rejects.toThrow("NEXT_REDIRECT:/");
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
