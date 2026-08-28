// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BurbujaContenido } from "@/app/(app)/mis-asignaciones/_components/chat/BurbujaContenido";
import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import type { ChatMensajeTipo } from "@prisma/client";

// Feature 308 (R24/R27/R28/R29) — las burbujas con ADJUNTO.
//
// El binario NO viaja en el hilo: la burbuja se lo pide al proxy propio
// (`/api/chat/media/<id-interno>`), que es quien autoriza y quien distingue "caducado" (410) de
// "fallo". Por eso aqui se mockea `fetch` y se comprueba QUE se pide y COMO se pinta cada
// desenlace, incluido el que esta feature vino a arreglar: la burbuja vacia.

const fetchMock = vi.fn();

/** Respuesta binaria del proxy (lo que devuelve para un adjunto vivo). */
function respuestaOk(): unknown {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["binario"], { type: "image/jpeg" }),
  };
}

/** R24: el proxy responde 410 con `{ error: "expirado" }` cuando Meta ya borro el binario. */
function respuestaExpirada(): unknown {
  return {
    ok: false,
    status: 410,
    json: async () => ({ error: "expirado" }),
    blob: async () => new Blob([]),
  };
}

function mensaje(
  tipo: ChatMensajeTipo,
  extra: Partial<ChatMensajeVista> = {},
): ChatMensajeVista {
  return {
    id: "msg-1",
    direccion: "entrante",
    tipo,
    cuerpo: null,
    estado: null,
    latitud: null,
    longitud: null,
    media: { mime: "image/jpeg", nombre: null, tamanoBytes: null },
    contactos: null,
    sistema: null,
    reacciones: [],
    ocurridoAt: "2026-08-27T15:00:00.000Z",
    ...extra,
  };
}

function pintar(m: ChatMensajeVista) {
  return render(<BurbujaContenido mensaje={m} onAbrirUbicacion={vi.fn()} />);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(respuestaOk());
  vi.stubGlobal("fetch", fetchMock);
  // OJO: se parchean los DOS metodos sobre el `URL` real, NO se sustituye el objeto. jsdom no
  // implementa `createObjectURL`, pero cambiar `URL` entero por un literal deja sin constructor
  // a `linkificar` (que valida el esquema con `new URL`) y las burbujas dejarian de enlazar sin
  // que ningun test lo dijera.
  URL.createObjectURL = vi.fn(() => "blob:objeto-1");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Burbuja con adjunto (R24/R27/R28/R29)", () => {
  it("R28: la imagen se pide al proxy por el id INTERNO y se pinta con alt no vacio", async () => {
    pintar(mensaje("imagen"));

    const imagen = await screen.findByRole("img");
    expect(imagen).toHaveAttribute("src", "blob:objeto-1");
    expect(imagen.getAttribute("alt")?.trim()).not.toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/chat/media/msg-1");
  });

  it("R28: el pie de foto se usa como texto alternativo de la imagen", async () => {
    pintar(mensaje("imagen", { cuerpo: "La puerta azul del fondo" }));

    expect(await screen.findByAltText("La puerta azul del fondo")).toBeInTheDocument();
  });

  it("R28: el sticker tambien carga solo y lleva su propio alt", async () => {
    pintar(mensaje("sticker"));

    expect(
      await screen.findByAltText("Sticker enviado por el cliente"),
    ).toBeInTheDocument();
  });

  it("R28: el audio expone un control con nombre accesible (y NO se baja hasta pedirlo)", async () => {
    pintar(mensaje("audio", { media: { mime: "audio/ogg", nombre: null, tamanoBytes: null } }));

    // P3: audio y video esperan accion explicita — el polling de 10 s no le gasta los datos
    // moviles al repartidor.
    expect(fetchMock).not.toHaveBeenCalled();
    const disparador = screen.getByRole("button", { name: /Reproducir nota de voz/i });

    await userEvent.click(disparador);

    const reproductor = await screen.findByLabelText("Nota de voz del cliente");
    expect(reproductor.tagName.toLowerCase()).toBe("audio");
    expect(reproductor).toHaveAttribute("controls");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("R28: el video expone un reproductor con controles y nombre accesible", async () => {
    pintar(mensaje("video", { media: { mime: "video/mp4", nombre: null, tamanoBytes: null } }));

    await userEvent.click(screen.getByRole("button", { name: /Reproducir video/i }));

    const reproductor = await screen.findByLabelText("Video enviado por el cliente");
    expect(reproductor.tagName.toLowerCase()).toBe("video");
    expect(reproductor).toHaveAttribute("controls");
  });

  it("R29: el documento muestra su nombre de archivo y ofrece la descarga", () => {
    pintar(
      mensaje("documento", {
        media: { mime: "application/pdf", nombre: "factura-882.pdf", tamanoBytes: 2048 },
      }),
    );

    expect(screen.getByText("factura-882.pdf")).toBeInTheDocument();
    const descarga = screen.getByRole("link", { name: /Descargar/i });
    expect(descarga).toHaveAttribute("href", "/api/chat/media/msg-1?descarga=1");
    expect(descarga).toHaveAttribute("download", "factura-882.pdf");
  });

  it("R29: un documento sin nombre de archivo cae en una etiqueta generica, no en vacio", () => {
    const { container } = pintar(
      mensaje("documento", {
        media: { mime: "application/pdf", nombre: null, tamanoBytes: null },
      }),
    );

    expect(screen.getByText("Documento adjunto")).toBeInTheDocument();
    expect(container.textContent?.trim()).not.toBe("");
  });

  it("R24: ante un 410 la burbuja dice que el archivo ya no esta disponible y NO deja un img roto", async () => {
    fetchMock.mockResolvedValue(respuestaExpirada());
    const { container } = pintar(mensaje("imagen"));

    await waitFor(() => {
      expect(screen.getByText(/ya no está disponible/i)).toBeInTheDocument();
    });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/30 días/i)).toBeInTheDocument();
  });

  it("R24: un 410 en el audio tambien se explica; no se queda un reproductor mudo", async () => {
    fetchMock.mockResolvedValue(respuestaExpirada());
    const { container } = pintar(
      mensaje("audio", { media: { mime: "audio/ogg", nombre: null, tamanoBytes: null } }),
    );

    await userEvent.click(screen.getByRole("button", { name: /Reproducir nota de voz/i }));

    await waitFor(() => {
      expect(screen.getByText(/ya no está disponible/i)).toBeInTheDocument();
    });
    expect(container.querySelector("audio")).toBeNull();
  });

  it("R24: un fallo que NO es 410 se distingue del caducado (no dice que expiro)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, blob: async () => new Blob([]) });
    pintar(mensaje("imagen"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.queryByText(/ya no está disponible/i)).toBeNull();
  });

  it("R27: ninguna burbuja con adjunto queda sin contenido perceptible", async () => {
    const casos: ChatMensajeTipo[] = ["imagen", "sticker", "audio", "video", "documento"];

    for (const tipo of casos) {
      const { container, unmount } = pintar(mensaje(tipo));
      await waitFor(() => {
        const texto = container.textContent?.trim() ?? "";
        const elementoConSentido = container.querySelector("img, audio, video, a, button");
        // O hay texto, o hay un elemento con nombre accesible. Lo que NO puede pasar es que
        // la burbuja quede en blanco, que es el sintoma que arregla la feature.
        expect(texto !== "" || elementoConSentido !== null).toBe(true);
      });
      unmount();
    }
  });
});
