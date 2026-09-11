// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LogoutButton } from "@/app/_components/LogoutButton";
import {
  ENDPOINT_FALSO,
  limpiarNavegadorPush,
  montarNavegadorPush,
  suscripcionFalsa,
} from "../fixtures/navegador-push";

/**
 * FICHA 410 (tanda 5, T5.5 — R19/R20) — AL SALIR, ESTE DISPOSITIVO SE DA DE BAJA.
 *
 * Sin esto, el siguiente aviso de esta persona suena en un teléfono donde ya no tiene sesión —y,
 * peor, en el que a lo mejor ya entró otra persona—. La baja va ANTES de `logout()` porque necesita
 * la sesión para autorizarse: el dueño de la suscripción sale de la cookie, no de la entrada (R50).
 *
 * Va en un archivo aparte de `LogoutButton.test.tsx`, que describe la feature 57 y no sabe nada del
 * canal de push. Aquellos casos siguen siendo suyos y siguen pasando.
 */

const { logoutMock, eliminarMock, pushMock, errorToastMock } = vi.hoisted(() => ({
  logoutMock: vi.fn(),
  eliminarMock: vi.fn(),
  pushMock: vi.fn(),
  errorToastMock: vi.fn(),
}));

vi.mock("@/lib/actions/auth", () => ({ logout: logoutMock }));

vi.mock("@/lib/actions/push", () => ({
  eliminarSuscripcionPush: eliminarMock,
  registrarSuscripcionPush: vi.fn(),
  obtenerClavePublicaPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

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

async function salir() {
  const user = userEvent.setup();
  render(<LogoutButton />);
  await user.click(screen.getByRole("button", { name: "Salir" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  logoutMock.mockResolvedValue(undefined);
  eliminarMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  cleanup();
  limpiarNavegadorPush();
  vi.restoreAllMocks();
});

describe("R19 — la baja es de ESTE dispositivo, y va antes de cerrar la sesión", () => {
  it("borra la suscripción de este navegador y solo después llama a `logout()`", async () => {
    const orden: string[] = [];
    const suscripcion = suscripcionFalsa();
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: suscripcion });
    eliminarMock.mockImplementation(async () => {
      orden.push("baja");
      return { status: "ok" };
    });
    logoutMock.mockImplementation(async () => {
      orden.push("logout");
    });

    await salir();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    // El endpoint es el de ESTE navegador: no se tocan las suscripciones de sus otros teléfonos.
    expect(eliminarMock).toHaveBeenCalledWith({ endpoint: ENDPOINT_FALSO });
    expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
    expect(orden).toEqual(["baja", "logout"]);
  });

  it("si este dispositivo nunca se suscribió, no se llama a nadie y la salida es la de siempre", async () => {
    montarNavegadorPush({ permiso: "default", suscripcionPrevia: null });

    await salir();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(eliminarMock).not.toHaveBeenCalled();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it("en un navegador sin service worker tampoco estorba", async () => {
    await salir();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(eliminarMock).not.toHaveBeenCalled();
  });
});

describe("R20 — si la baja falla, la sesión se cierra IGUAL y el fallo queda registrado", () => {
  it("la acción de borrado rechaza: se sale, se navega, y se registra qué falló", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: suscripcionFalsa() });
    eliminarMock.mockRejectedValue(new Error("el servidor no contestó"));

    await salir();

    // Lo que NO puede pasar: que alguien se quede dentro de la aplicación porque un servicio de
    // push no respondiera.
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(errorToastMock).not.toHaveBeenCalled();
    // Y no se absorbe en silencio (docs/conventions.md).
    expect(error).toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toContain("borrar la suscripción en el servidor");
  });

  it("MUTACIÓN: si la baja NO fallara, tampoco habría registro — el de arriba mide algo", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: suscripcionFalsa() });

    await salir();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(error).not.toHaveBeenCalled();
  });

  it("y si el que falla es `logout()`, la feature 57 sigue mandando: no se navega y avisa", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: suscripcionFalsa() });
    logoutMock.mockRejectedValue(new Error("boom"));

    await salir();

    await waitFor(() => expect(errorToastMock).toHaveBeenCalledWith("No se pudo cerrar sesión"));
    expect(pushMock).not.toHaveBeenCalled();
    // La baja sí se hizo: es lo correcto, este dispositivo ya no debe recibir.
    expect(eliminarMock).toHaveBeenCalledTimes(1);
  });
});
