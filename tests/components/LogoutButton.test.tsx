// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogoutButton } from "@/app/_components/LogoutButton";
import { logout } from "@/lib/actions/auth";

vi.mock("@/lib/actions/auth", () => ({
  logout: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const { errorToastMock } = vi.hoisted(() => ({
  errorToastMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorToastMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const mockedLogout = vi.mocked(logout);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LogoutButton (R26)", () => {
  it("al hacer click invoca la Server Action logout y luego navega a /login", async () => {
    mockedLogout.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(mockedLogout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
  });

  it("R11: mientras logout está en curso el botón queda disabled y muestra 'Cerrando sesión…'", async () => {
    // Deferred: controlamos manualmente cuándo resuelve `logout()` para observar
    // el estado pendiente (progreso + anti-doble-click) ANTES de que termine.
    let resolveLogout: () => void = () => {};
    mockedLogout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    // Estado pendiente: el botón queda deshabilitado con el texto de progreso.
    const pendingButton = await screen.findByRole("button", {
      name: "Cerrando sesión...",
    });
    expect(pendingButton).toBeDisabled();
    // Aún no ha navegado porque el logout sigue en curso.
    expect(pushMock).not.toHaveBeenCalled();

    // Resolvemos el logout: el flujo debe completar la navegación.
    resolveLogout();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
  });

  it("R10: si logout rechaza, NO navega, re-habilita el botón y muestra toast de error", async () => {
    mockedLogout.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    // (a) No se navega a /login.
    await waitFor(() => expect(mockedLogout).toHaveBeenCalledTimes(1));
    expect(pushMock).not.toHaveBeenCalled();
    // (c) Feedback visible del error (toast, feature 11).
    await waitFor(() =>
      expect(errorToastMock).toHaveBeenCalledWith("No se pudo cerrar sesión"),
    );
    // (b) El control vuelve a estar accionable (no queda disabled).
    const button = await screen.findByRole("button", { name: "Cerrar sesión" });
    expect(button).not.toBeDisabled();
  });
});
