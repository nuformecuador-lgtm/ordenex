// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SincronizarRutaButton } from "@/app/(app)/mis-asignaciones/_components/SincronizarRutaButton";
import { sincronizarRuta } from "@/lib/actions/ruta-mensajero";
import type { SincronizarRutaResult } from "@/lib/types/ruta-mensajero";

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
  // Feature 265 (R39): la rama `ok` lleva la procedencia del orden recien calculado.
  // `proveedor` es el caso normal, el que NO cambia el mensaje del toast.
  sincronizarMock.mockResolvedValue({ status: "ok", omitida: false, secuenciaFuente: "proveedor" });
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
    let resolver: (v: SincronizarRutaResult) => void = () => {};
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
    resolver({ status: "ok", omitida: false, secuenciaFuente: "proveedor" });
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

  // ---------------- Feature 265 (FE2/FE3, R39-R42) ----------------
  //
  // «Ruta sincronizada.» pase lo que pase era una MEDIA VERDAD dicha en el peor momento: el
  // mensajero acaba de pulsar, va a guardar el teléfono y a salir. Si el orden lo calculó la
  // app por cercanía en línea recta, ése es justo el segundo en el que hay que decírselo.
  //
  // ⚠️ Los literales van escritos A MANO. Importar el texto del componente para compararlo
  // consigo mismo dejaría este bloque siempre verde.
  const TOAST_APROXIMADO =
    "Ruta ordenada de forma aproximada: revisa el orden de las paradas.";

  it("R39: con el orden calculado en la app el toast lo DICE, y no dice «Ruta sincronizada.»", async () => {
    const user = userEvent.setup();
    setGeolocation(null);
    sincronizarMock.mockResolvedValue({
      status: "ok",
      omitida: false,
      secuenciaFuente: "local",
    });
    render(<SincronizarRutaButton />);

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() =>
      expect(warningMock).toHaveBeenCalledWith(TOAST_APROXIMADO),
    );
    // Las dos mitades. Sin la segunda, decir las dos cosas a la vez pasaría el caso: el
    // mensajero vería «Ruta sincronizada.» y se quedaría con ésa, que es la tranquilizadora.
    expect(successMock).not.toHaveBeenCalled();
    // Y sigue refrescando: la ruta SÍ se recalculó, el orden nuevo tiene que llegar a la lista.
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R41/R42: ese aviso no lleva jerga interna ni datos de nadie", () => {
    // El texto es una constante de este archivo, así que se mide aquí mismo lo que el
    // componente va a mostrar. R41: nada de dentro de casa. R42: ni coordenadas ni guías.
    expect(TOAST_APROXIMADO).not.toMatch(
      /degrad|fallback|haversine|proveedor|optimizador|API|GPS/i,
    );
    expect(TOAST_APROXIMADO).not.toMatch(/-?\d+[.,]\d{2,}/);
  });

  it.each(["proveedor", null] as const)(
    "R39/R45: con `secuenciaFuente` = %s el toast sigue siendo «Ruta sincronizada.»",
    async (fuente) => {
      const user = userEvent.setup();
      setGeolocation(null);
      sincronizarMock.mockResolvedValue({
        status: "ok",
        omitida: false,
        secuenciaFuente: fuente,
      });
      render(<SincronizarRutaButton />);

      await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

      // La mitad negativa: avisar SIEMPRE convertiría el aviso en ruido y dejaría de leerse.
      // `null` (no consta) entra aquí a propósito: sin dato no se afirma nada de más, pero
      // tampoco se alarma sobre una ruta de la que no sabemos nada malo (R45).
      await vi.waitFor(() =>
        expect(successMock).toHaveBeenCalledWith("Ruta sincronizada."),
      );
      expect(warningMock).not.toHaveBeenCalled();
    },
  );

  it("R39: `omitida` conserva su propio mensaje — no se recalculó nada que contar", async () => {
    const user = userEvent.setup();
    setGeolocation(null);
    sincronizarMock.mockResolvedValue({
      status: "ok",
      omitida: true,
      secuenciaFuente: null,
    });
    render(<SincronizarRutaButton />);

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    // Los tres desenlaces de `ok` son tres, no dos: éste es el que no debe caer ni en el
    // aviso nuevo ni en «Ruta sincronizada.». El aviso PERSISTENTE de la pantalla ya cubre
    // el orden aproximado de una ruta que no se ha vuelto a calcular.
    await vi.waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("La ruta ya estaba al día."),
    );
    expect(warningMock).not.toHaveBeenCalled();
  });
});
