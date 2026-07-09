// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const cookieGetMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

const findValidByIdMock = vi.fn();
vi.mock("@/lib/repositories/SessionRepository", () => ({
  // Debe ser una funcion "normal" (no arrow) para poder invocarse con `new`,
  // igual que hace app/page.tsx.
  SessionRepository: vi.fn().mockImplementation(function SessionRepositoryMock(this: {
    findValidById: typeof findValidByIdMock;
  }) {
    this.findValidById = findValidByIdMock;
  }),
}));

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

// El boton en si (invocacion de logout, R26) se cubre en LogoutButton.test.tsx;
// aqui se aisla la logica de visibilidad condicional de app/page.tsx (R25).
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-button-stub">Cerrar sesión</button>,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app/page.tsx — boton de cerrar sesion (R25)", () => {
  it("muestra el boton 'Cerrar sesión' cuando hay una sesion valida", async () => {
    const { default: Home } = await import("@/app/(app)/page");
    cookieGetMock.mockReturnValue({ value: "session-abc" });
    findValidByIdMock.mockResolvedValue({
      id: "session-abc",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 1000 * 60),
      createdAt: new Date(),
    });

    const element = await Home();
    render(element);

    expect(screen.getByTestId("logout-button-stub")).toBeInTheDocument();
  });

  it("NO muestra el boton cuando no hay sesion valida", async () => {
    const { default: Home } = await import("@/app/(app)/page");
    cookieGetMock.mockReturnValue(undefined);

    const element = await Home();
    render(element);

    expect(screen.queryByTestId("logout-button-stub")).not.toBeInTheDocument();
  });

  it("NO muestra el boton cuando la sesion de la cookie esta expirada/invalida", async () => {
    const { default: Home } = await import("@/app/(app)/page");
    cookieGetMock.mockReturnValue({ value: "session-expired" });
    findValidByIdMock.mockResolvedValue(null);

    const element = await Home();
    render(element);

    expect(screen.queryByTestId("logout-button-stub")).not.toBeInTheDocument();
  });
});
