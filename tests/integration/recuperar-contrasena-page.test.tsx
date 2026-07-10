// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mocks de las dependencias server-side de app/recuperar-contrasena/page.tsx.
// El page.tsx (Server Component real) se importa sin mockear: se ejercita su
// logica real de R12 (publico; redirige si hay sesion valida).
const cookieGetMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

const redirectMock = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

const findValidByIdMock = vi.fn();
vi.mock("@/lib/repositories/SessionRepository", () => ({
  SessionRepository: vi.fn().mockImplementation(function SessionRepositoryMock(this: {
    findValidById: typeof findValidByIdMock;
  }) {
    this.findValidById = findValidByIdMock;
  }),
}));

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

// Aisla la logica de la pagina del formulario cliente con un stub identificable.
vi.mock("@/app/recuperar-contrasena/_components/RecuperarContrasenaForm", () => ({
  RecuperarContrasenaForm: () => (
    <div data-testid="recuperar-form-stub">form</div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app/recuperar-contrasena/page.tsx — sesion activa (R12)", () => {
  it("redirige a / cuando la cookie de sesion es valida segun SessionRepository.findValidById", async () => {
    const { default: RecuperarContrasenaPage } = await import(
      "@/app/recuperar-contrasena/page"
    );
    cookieGetMock.mockReturnValue({ value: "session-abc" });
    findValidByIdMock.mockResolvedValue({
      id: "session-abc",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 1000 * 60),
      createdAt: new Date(),
    });

    await expect(RecuperarContrasenaPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(findValidByIdMock).toHaveBeenCalledWith("session-abc");
  });

  it("renderiza el formulario cuando no hay cookie de sesion", async () => {
    const { default: RecuperarContrasenaPage } = await import(
      "@/app/recuperar-contrasena/page"
    );
    cookieGetMock.mockReturnValue(undefined);

    const element = await RecuperarContrasenaPage();
    render(element);

    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("recuperar-form-stub")).toBeInTheDocument();
  });

  it("renderiza el formulario cuando la sesion de la cookie esta expirada/invalida", async () => {
    const { default: RecuperarContrasenaPage } = await import(
      "@/app/recuperar-contrasena/page"
    );
    cookieGetMock.mockReturnValue({ value: "session-expired" });
    findValidByIdMock.mockResolvedValue(null);

    const element = await RecuperarContrasenaPage();
    render(element);

    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("recuperar-form-stub")).toBeInTheDocument();
  });
});
