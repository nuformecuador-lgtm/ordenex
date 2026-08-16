// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GestionarOrdenPanel } from "@/app/(app)/mis-asignaciones/_components/GestionarOrdenPanel";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 193 (T D.4 — R16/R17/R18/R19/R21/R22) — la captura de la ubicacion en el panel.
//
// Lo que este archivo protege y ningun test de backend puede:
//   - que el permiso se pida AL CONFIRMAR y no al abrir el panel (R22). Pedirlo sin una
//     accion que lo justifique es como se consigue que la persona lo deniegue para siempre,
//     y aqui denegarlo tiene consecuencias.
//   - que un fallo TECNICO deje pasar la gestion (R18) y una DENEGACION no (R19). Es la
//     asimetria entera de la feature; si se confundieran, o se traba al mensajero en una
//     bodega sin senal, o se pierde el dato justo cuando alguien lo nego a proposito.
//   - que el aviso de la denegacion diga DONDE se reactiva (R19). Un mensaje que solo diga
//     "falta la ubicacion" deja al mensajero en la calle sin salida.
//   - que no salgan dos gestiones si el boton se pulsa dos veces mientras captura (R21).

vi.mock("@/lib/actions/mis-asignaciones", () => ({ gestionar: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const gestionarMock = vi.mocked(gestionar);

function makeOrden(): MiAsignacionDTO {
  return {
    id: "g1",
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: null,
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: 1,
  } as MiAsignacionDTO;
}

/** Doble de la API del navegador. `code` null = exito. */
function instalarGeolocation(opts: { code: number | null; lat?: number; lng?: number }) {
  const getCurrentPosition = vi.fn(
    (
      ok: (p: { coords: { latitude: number; longitude: number } }) => void,
      err: (e: { code: number }) => void,
    ) => {
      if (opts.code === null) {
        ok({ coords: { latitude: opts.lat ?? 9.9281, longitude: opts.lng ?? -84.0907 } });
      } else {
        err({ code: opts.code });
      }
    },
  );
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
    writable: true,
  });
  return getCurrentPosition;
}

function montar() {
  render(
    <GestionarOrdenPanel
      orden={makeOrden()}
      yaActiva
      onGestionarPedido={vi.fn().mockResolvedValue(true)}
      onCancelarGestion={vi.fn()}
      onSuccess={vi.fn()}
      onAbrirChat={vi.fn()}
      count={1}
    />,
  );
}

/** Abre la rama `reprogramada` (la unica sin foto obligatoria) y la rellena. */
async function abrirYRellenarReprogramar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Reprogramar" }));
  fireEvent.change(screen.getByLabelText("Motivo"), {
    target: { value: "cliente ausente" },
  });
}

function botonGuardar(): HTMLElement {
  return screen.getByRole("button", { name: /Guardar gestión|Obteniendo ubicación/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  gestionarMock.mockResolvedValue({ status: "ok", estado: "reprogramada" } as never);
});

afterEach(() => {
  cleanup();
});

describe("Feature 193 — ubicacion al gestionar", () => {
  it("R22: no se pide la ubicacion al abrir el panel ni al elegir el resultado", async () => {
    const user = userEvent.setup();
    const getCurrentPosition = instalarGeolocation({ code: null });

    montar();
    await abrirYRellenarReprogramar(user);

    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("R16/R17: al confirmar se captura y las coordenadas viajan en el FormData", async () => {
    const user = userEvent.setup();
    const getCurrentPosition = instalarGeolocation({
      code: null,
      lat: 9.9281,
      lng: -84.0907,
    });

    montar();
    await abrirYRellenarReprogramar(user);
    await user.click(botonGuardar());

    await waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("ubicacionLat")).toBe("9.9281");
    expect(fd.get("ubicacionLng")).toBe("-84.0907");
    expect(fd.get("ubicacionAusencia")).toBeNull(); // R11: nunca las dos cosas
  });

  it.each([
    { code: 3, motivo: "timeout", nombre: "TIMEOUT" },
    { code: 2, motivo: "no_disponible", nombre: "POSITION_UNAVAILABLE" },
  ])(
    "R18: $nombre no bloquea — la gestion sale con el motivo tipificado",
    async ({ code, motivo }) => {
      const user = userEvent.setup();
      instalarGeolocation({ code });

      montar();
      await abrirYRellenarReprogramar(user);
      await user.click(botonGuardar());

      await waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
      const fd = gestionarMock.mock.calls[0][0] as FormData;
      expect(fd.get("ubicacionAusencia")).toBe(motivo);
      expect(fd.get("ubicacionLat")).toBeNull();
    },
  );

  it("R19: el permiso DENEGADO bloquea — la action no se llama", async () => {
    const user = userEvent.setup();
    instalarGeolocation({ code: 1 }); // PERMISSION_DENIED

    montar();
    await abrirYRellenarReprogramar(user);
    await user.click(botonGuardar());

    await waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(gestionarMock).not.toHaveBeenCalled();
  });

  it("R19: el aviso dice DONDE reactivar el permiso, no solo que falta", async () => {
    const user = userEvent.setup();
    instalarGeolocation({ code: 1 });

    montar();
    await abrirYRellenarReprogramar(user);
    await user.click(botonGuardar());

    await waitFor(() => expect(errorMock).toHaveBeenCalled());
    const mensaje = String(errorMock.mock.calls[0][0]);
    // El mensajero esta en la calle: sin la instruccion, el bloqueo es una llamada a soporte.
    expect(mensaje).toMatch(/permiso/i);
    expect(mensaje).toMatch(/candado|ajustes|permisos del sitio/i);
  });

  it("R21: pulsar dos veces mientras captura no dispara dos gestiones", async () => {
    const user = userEvent.setup();
    // Captura que no resuelve: deja el panel en el estado "ocupado" el tiempo del test.
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn(() => {}) },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
      writable: true,
    });

    montar();
    await abrirYRellenarReprogramar(user);
    await user.click(botonGuardar());
    await user.click(botonGuardar());

    expect(gestionarMock).not.toHaveBeenCalled();
  });

  it("R21: mientras captura, el CTA lo dice", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn(() => {}) },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
      writable: true,
    });

    montar();
    await abrirYRellenarReprogramar(user);
    await user.click(botonGuardar());

    expect(
      await screen.findByRole("button", { name: /Obteniendo ubicación/ }),
    ).toBeInTheDocument();
  });
});
