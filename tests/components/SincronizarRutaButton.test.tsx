// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SincronizarRutaButton } from "@/app/(app)/mis-asignaciones/_components/SincronizarRutaButton";
import { sincronizarRuta } from "@/lib/actions/ruta-mensajero";

// Feature 97 (R25/R32/R34) — botón de sincronización manual de la ruta. Se mockea la Server
// Action (`"use server"` con Prisma/servicios detrás), el toast, el router y
// `navigator.geolocation` para probar el flujo GPS best-effort sin red ni permisos reales.
vi.mock("@/lib/actions/ruta-mensajero", () => ({
  sincronizarRuta: vi.fn(),
}));

const { successMock, warningMock, errorMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  warningMock: vi.fn(),
  errorMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: warningMock,
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const sincronizarMock = vi.mocked(sincronizarRuta);

/** Instala un `navigator.geolocation` controlado; `null` = navegador sin geolocalización. */
function setGeolocation(
  impl:
    | ((success: PositionCallback, error?: PositionErrorCallback) => void)
    | null,
) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: impl ? { getCurrentPosition: impl } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sincronizarMock.mockResolvedValue({ status: "ok", omitida: false });
});

afterEach(() => {
  cleanup();
  setGeolocation(null);
});

describe("SincronizarRutaButton", () => {
  it("R32: con GPS concedido llama a sincronizarRuta CON la ubicación y refresca", async () => {
    const user = userEvent.setup();
    setGeolocation((success) =>
      success({
        coords: { latitude: 9.9281244, longitude: -84.0907246 },
      } as GeolocationPosition),
    );
    const onUbicacion = vi.fn();
    render(<SincronizarRutaButton onUbicacion={onUbicacion} />);

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() =>
      expect(sincronizarMock).toHaveBeenCalledWith({
        ubicacion: { lat: 9.9281244, lng: -84.0907246 },
      }),
    );
    expect(onUbicacion).toHaveBeenCalledWith({
      lat: 9.9281244,
      lng: -84.0907246,
    });
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R25: con GPS DENEGADO llama a sincronizarRuta SIN ubicación (no se bloquea)", async () => {
    const user = userEvent.setup();
    setGeolocation((_success, error) =>
      error?.({ code: 1, message: "denied" } as GeolocationPositionError),
    );
    const onUbicacion = vi.fn();
    render(<SincronizarRutaButton onUbicacion={onUbicacion} />);

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() => expect(sincronizarMock).toHaveBeenCalledTimes(1));
    expect(sincronizarMock).toHaveBeenCalledWith({});
    // R25: la denegación NO adjunta ubicación ni bloquea la sincronización.
    expect(onUbicacion).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R25: sin API de geolocalización tampoco bloquea; sincroniza SIN ubicación", async () => {
    const user = userEvent.setup();
    setGeolocation(null);
    render(<SincronizarRutaButton />);

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() => expect(sincronizarMock).toHaveBeenCalledTimes(1));
    expect(sincronizarMock).toHaveBeenCalledWith({});
  });

  it("R34: dos clicks seguidos NO disparan dos llamadas (cerrojo anti-doble-click)", async () => {
    const user = userEvent.setup();
    setGeolocation((success) =>
      success({
        coords: { latitude: 1, longitude: 2 },
      } as GeolocationPosition),
    );
    // La action queda EN VUELO (promesa pendiente) para mantener el cerrojo cerrado.
    let resolver: (v: { status: "ok"; omitida: boolean }) => void = () => {};
    sincronizarMock.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    render(<SincronizarRutaButton />);

    const boton = screen.getByRole("button", { name: "Sincronizar ruta" });
    await user.click(boton);
    await user.click(boton);

    expect(sincronizarMock).toHaveBeenCalledTimes(1);

    // Cierra la promesa para no dejar trabajo colgado.
    resolver({ status: "ok", omitida: false });
  });

  it("R34: un 'conflict' (intervalo mínimo) se avisa con warning y NO refresca", async () => {
    const user = userEvent.setup();
    setGeolocation(null);
    sincronizarMock.mockResolvedValue({
      status: "conflict",
      motivo: "la ruta se sincronizo hace muy poco; intenta de nuevo en unos segundos",
    });
    render(<SincronizarRutaButton />);

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() =>
      expect(warningMock).toHaveBeenCalledWith(
        "la ruta se sincronizo hace muy poco; intenta de nuevo en unos segundos",
      ),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
