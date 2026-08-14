// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { useSeguimientoUbicacion } from "@/app/(app)/mis-asignaciones/_components/useSeguimientoUbicacion";

// Feature 92 (seguimiento) — la posición en vivo del mensajero en el mapa.
//
// LA ASERCIÓN QUE MÁS IMPORTA EN ESTE ARCHIVO ES `expect(watchPosition).not.toHaveBeenCalled()`:
// `watchPosition` abre el diálogo del navegador cuando el permiso no está resuelto, y R25
// prohíbe forzarlo. Cada camino por el que el permiso NO consta concedido tiene su test de
// CERO llamadas, no solo de que el resultado sea `null`.

type Escucha = (pos: unknown) => void;

let watchPosition: ReturnType<typeof vi.fn>;
let clearWatch: ReturnType<typeof vi.fn>;
let escucha: Escucha | null;
/** Resuelve la consulta de permiso; `null` = la API no existe. */
let estadoPermiso: { state: string; addEventListener: () => void; removeEventListener: () => void } | null;

function posicion(lat: number, lng: number, accuracy = 10, timestamp = 0) {
  return { coords: { latitude: lat, longitude: lng, accuracy }, timestamp };
}

beforeEach(() => {
  escucha = null;
  estadoPermiso = null;
  watchPosition = vi.fn((ok: Escucha) => {
    escucha = ok;
    return 7; // id del watch
  });
  clearWatch = vi.fn();

  vi.stubGlobal("navigator", {
    geolocation: { watchPosition, clearWatch, getCurrentPosition: vi.fn() },
    get permissions() {
      return estadoPermiso === null
        ? undefined
        : { query: async () => estadoPermiso };
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function permiso(state: string) {
  estadoPermiso = { state, addEventListener: () => {}, removeEventListener: () => {} };
}

describe("R25 — el permiso no se fuerza JAMAS", () => {
  it("sin permiso concedido y sin prueba, NO se llama a watchPosition", async () => {
    permiso("prompt");
    const { result } = renderHook(() => useSeguimientoUbicacion(false));

    // Se espera a que la consulta de permiso se resuelva antes de afirmar el negativo: sin
    // esto el test pasaría por llegar demasiado pronto, no por el comportamiento.
    await waitFor(() => expect(estadoPermiso).not.toBeNull());
    expect(watchPosition).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("con el permiso DENEGADO tampoco se intenta", async () => {
    permiso("denied");
    renderHook(() => useSeguimientoUbicacion(false));

    await waitFor(() => expect(estadoPermiso).not.toBeNull());
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("con el permiso ya CONCEDIDO arranca solo, sin que nadie pulse nada (sirve tras un F5)", async () => {
    permiso("granted");
    renderHook(() => useSeguimientoUbicacion(false));

    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
  });

  it("sin Permissions API, la prueba del boton basta", async () => {
    // Safari no la tuvo durante anos: si el seguimiento dependiera solo de ella, en ese
    // navegador no habria marcador en vivo nunca.
    estadoPermiso = null;
    renderHook(() => useSeguimientoUbicacion(true));

    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
  });

  it("sin Permissions API y sin prueba, no se intenta", async () => {
    estadoPermiso = null;
    renderHook(() => useSeguimientoUbicacion(false));

    await new Promise((r) => setTimeout(r, 10));
    expect(watchPosition).not.toHaveBeenCalled();
  });
});

describe("lecturas", () => {
  it("una lectura buena se devuelve", async () => {
    permiso("granted");
    const { result } = renderHook(() => useSeguimientoUbicacion(false));
    await waitFor(() => expect(watchPosition).toHaveBeenCalled());

    act(() => escucha?.(posicion(9.93, -84.09, 10, 1_000_000)));

    expect(result.current).toEqual({ lat: 9.93, lng: -84.09 });
  });

  it("una lectura IMPRECISA se descarta: movería el marcador a otro cantón", async () => {
    permiso("granted");
    const { result } = renderHook(() => useSeguimientoUbicacion(false));
    await waitFor(() => expect(watchPosition).toHaveBeenCalled());

    act(() => escucha?.(posicion(9.93, -84.09, 2_000, 1_000_000)));

    expect(result.current).toBeNull();
  });

  it("las lecturas muy seguidas se ignoran: a esa frecuencia el ojo no ve diferencia", async () => {
    permiso("granted");
    const { result } = renderHook(() => useSeguimientoUbicacion(false));
    await waitFor(() => expect(watchPosition).toHaveBeenCalled());

    act(() => escucha?.(posicion(9.93, -84.09, 10, 1_000_000)));
    act(() => escucha?.(posicion(9.94, -84.08, 10, 1_001_000))); // +1 s
    expect(result.current).toEqual({ lat: 9.93, lng: -84.09 });

    act(() => escucha?.(posicion(9.95, -84.07, 10, 1_006_000))); // +6 s
    expect(result.current).toEqual({ lat: 9.95, lng: -84.07 });
  });
});

describe("apagado", () => {
  it("al desmontar se libera el watch (el GPS no se queda encendido)", async () => {
    permiso("granted");
    const { unmount } = renderHook(() => useSeguimientoUbicacion(false));
    await waitFor(() => expect(watchPosition).toHaveBeenCalled());

    unmount();

    expect(clearWatch).toHaveBeenCalledWith(7);
  });
});
