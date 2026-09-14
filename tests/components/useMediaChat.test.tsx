// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

import { useMediaChat } from "@/app/(app)/mis-asignaciones/_components/chat/hooks/useMediaChat";

/**
 * Feature 426 (R11) — el consumidor del navegador trata el 401 como FALLO, no como contenido.
 *
 * QUE SE MIDE AQUI Y POR QUE IMPORTA. `useMediaChat` pide el adjunto al proxy propio con un
 * `fetch` normal, que en modo `follow` (el de por defecto) SIGUE los redirects. Con el guard
 * respondiendo 307 a /login, el hook recibia el HTML de la pagina de login con `200`, `res.ok`
 * era TRUE, hacia `blob()` y declaraba el estado `"listo"`: el chat pintaba una imagen rota y
 * juraba que todo habia ido bien. El segundo caso de este archivo REPRODUCE ese desenlace con un
 * doble, para que se vea que el test mide al consumidor real y no a una maqueta.
 *
 * Se usa el hook REAL con `renderHook` (precedente: `usePagination.test.tsx`) y se dobla solo
 * `fetch`, que es su unica frontera.
 */

const fetchMock = vi.fn();

/** Doble de respuesta: el hook solo mira `status`, `ok` y `blob()`. */
function respuesta(status: number, cuerpo: string, mime: string): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: async () => new Blob([cuerpo], { type: mime }),
  };
}

/** El 401 del borde tras la feature 426: sesion vencida en una ruta de API. */
function respuesta401(): unknown {
  return respuesta(
    401,
    JSON.stringify({ status: "error", code: "UNAUTHORIZED", message: "No hay una sesion valida." }),
    "application/json",
  );
}

/** Lo que llegaba ANTES: el `fetch` seguia el 307 y recibia la pagina de login con 200. */
function respuestaHtmlDelLogin(): unknown {
  return respuesta(200, "<!DOCTYPE html><html><body>Iniciar sesion</body></html>", "text/html");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom no implementa estos dos; se parchean SOBRE el `URL` real para no dejar sin constructor
  // a nadie mas (mismo criterio que `ChatBurbujaMedia.test.tsx`).
  URL.createObjectURL = vi.fn(() => "blob:objeto-1");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMediaChat — un 401 es un fallo, no contenido (R11)", () => {
  it("un 401 deja el adjunto en estado error, nunca en listo", async () => {
    fetchMock.mockResolvedValue(respuesta401());

    const { result } = renderHook(() => useMediaChat("msg-1", true));

    await waitFor(() => expect(result.current.estado).toBe("error"));
    expect(result.current.estado).not.toBe("listo");
    expect(result.current.url).toBeNull();
    // No se fabrica ningun object URL con el cuerpo del error: no hay nada que pintar.
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/chat/media/msg-1");
  });

  it("CONTROL: con la respuesta de ANTES (200 + HTML del login) el hook si decia listo", async () => {
    // Este caso NO describe el comportamiento deseado: reproduce el defecto que la 426 cierra
    // rio arriba. Su unica razon de ser es demostrar que el caso anterior mide al consumidor de
    // verdad —si el hook ignorara el cuerpo y siempre diera "error", este caso fallaria—.
    fetchMock.mockResolvedValue(respuestaHtmlDelLogin());

    const { result } = renderHook(() => useMediaChat("msg-1", true));

    await waitFor(() => expect(result.current.estado).toBe("listo"));
    expect(result.current.url).toBe("blob:objeto-1");
  });

  it("el 410 sigue distinguiendose del 401: expirado no es error (R24 de la 311)", async () => {
    fetchMock.mockResolvedValue(respuesta(410, JSON.stringify({ error: "expirado" }), "application/json"));

    const { result } = renderHook(() => useMediaChat("msg-1", true));

    await waitFor(() => expect(result.current.estado).toBe("expirado"));
  });
});
