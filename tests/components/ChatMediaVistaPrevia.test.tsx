// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BurbujaContenido } from "@/app/(app)/mis-asignaciones/_components/chat/BurbujaContenido";
import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import type { ChatMensajeTipo } from "@prisma/client";

// Vista previa de los adjuntos del chat (pedido humano 2026-08-31).
//
// EL SINTOMA: las fotos y los videos SE VEIAN, pero diminutos. La miniatura se dimensionaba por
// la altura (`max-h-64 w-full`), asi que una foto vertical de telefono tocaba el techo de 256 px
// de alto y se quedaba en ~144 px de ancho. Y no habia forma de verla mas grande: ni abrir, ni
// hacer zoom, ni cerrar.
//
// LO QUE SE PRUEBA AQUI es el CONTRATO de la vista previa —se abre desde la miniatura, monta el
// adjunto a pantalla completa, se cierra— y NO el gesto de pinza: el pellizco lo implementa
// `yet-another-react-lightbox` con eventos de puntero que jsdom no simula. Lo que si se afirma
// de los dedos es la decision que vive en NUESTRO codigo: que el zoom esta ENCHUFADO (plugin
// cargado) y que NO se pinta la lupita, porque en un movil el zoom se hace con los dedos.

const fetchMock = vi.fn();

function respuestaOk(): unknown {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["binario"], { type: "image/jpeg" }),
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
    ocurridoAt: "2026-08-31T15:00:00.000Z",
    ...extra,
  };
}

function pintar(m: ChatMensajeVista) {
  return render(<BurbujaContenido mensaje={m} onAbrirUbicacion={vi.fn()} />);
}

/** Todas las imagenes del DOM: la miniatura de la burbuja y la que monta la vista previa. */
function imagenesPintadas(): HTMLImageElement[] {
  return Array.from(document.querySelectorAll("img"));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(respuestaOk());
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:objeto-1");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Vista previa de imagen", () => {
  it("la miniatura es un disparador con nombre accesible, y sin tocarla NO hay vista previa", async () => {
    pintar(mensaje("imagen"));

    const disparador = await screen.findByRole("button", {
      name: "Ampliar: Imagen enviada por el cliente",
    });
    expect(disparador).toBeInTheDocument();
    // Cerrada = no hay nada del lightbox en el DOM (ni su boton de cerrar ni su contenedor).
    expect(screen.queryByRole("button", { name: "Cerrar vista previa" })).toBeNull();
    expect(document.querySelector(".yarl__root")).toBeNull();
  });

  it("al tocar la miniatura se abre la vista previa con la misma imagen ya descargada", async () => {
    pintar(mensaje("imagen", { cuerpo: "La puerta azul del fondo" }));

    await userEvent.click(
      await screen.findByRole("button", { name: "Ampliar: La puerta azul del fondo" }),
    );

    await waitFor(() => expect(document.querySelector(".yarl__root")).not.toBeNull());
    // Dos imagenes: la miniatura de la burbuja y la de la vista previa. Las DOS apuntan al
    // MISMO object URL: abrir la previa no vuelve a pedirle el binario al proxy (datos moviles).
    const imagenes = imagenesPintadas();
    expect(imagenes.length).toBeGreaterThan(1);
    for (const img of imagenes) expect(img.getAttribute("src")).toBe("blob:objeto-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("la vista previa se cierra desde su propio boton y deja el hilo como estaba", async () => {
    pintar(mensaje("imagen"));

    await userEvent.click(
      await screen.findByRole("button", { name: "Ampliar: Imagen enviada por el cliente" }),
    );
    const cerrar = await screen.findByRole("button", { name: "Cerrar vista previa" });

    await userEvent.click(cerrar);

    await waitFor(() => expect(document.querySelector(".yarl__root")).toBeNull());
    expect(
      screen.getByRole("button", { name: "Ampliar: Imagen enviada por el cliente" }),
    ).toBeInTheDocument();
  });

  it("el zoom va por gesto: el plugin esta enchufado y NO se pinta ninguna lupita", async () => {
    pintar(mensaje("imagen"));

    await userEvent.click(
      await screen.findByRole("button", { name: "Ampliar: Imagen enviada por el cliente" }),
    );
    await waitFor(() => expect(document.querySelector(".yarl__root")).not.toBeNull());

    // El plugin de zoom envuelve la imagen en su propio contenedor: si no estuviera cargado, la
    // imagen se pintaria "pelada" y no habria pinza posible.
    expect(document.querySelector(".yarl__slide_image")).not.toBeNull();
    // Y la lupita NO esta: en el movil se hace pinza, no se pulsan botones (pedido explicito).
    expect(screen.queryByRole("button", { name: /zoom/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /acercar|alejar/i })).toBeNull();
  });
});

describe("Vista previa de video", () => {
  const videoEntrante = () =>
    mensaje("video", { media: { mime: "video/mp4", nombre: null, tamanoBytes: null } });

  it("el video sigue siendo reproducible en la burbuja y ademas se puede ampliar", async () => {
    pintar(videoEntrante());

    await userEvent.click(screen.getByRole("button", { name: /Reproducir video/i }));

    const enLaBurbuja = await screen.findByLabelText("Video enviado por el cliente");
    expect(enLaBurbuja.tagName.toLowerCase()).toBe("video");
    // `playsInline`: sin el, iOS se lleva el video a su propia pantalla completa al darle a play.
    expect(enLaBurbuja).toHaveAttribute("playsinline");
    expect(
      screen.getByRole("button", { name: "Ampliar: Video enviado por el cliente" }),
    ).toBeInTheDocument();
  });

  it("al ampliar, la vista previa monta el video con su mime y se puede cerrar", async () => {
    pintar(videoEntrante());
    await userEvent.click(screen.getByRole("button", { name: /Reproducir video/i }));

    await userEvent.click(
      await screen.findByRole("button", { name: "Ampliar: Video enviado por el cliente" }),
    );

    await waitFor(() => expect(document.querySelector(".yarl__root")).not.toBeNull());
    const fuente = document.querySelector(".yarl__root source");
    expect(fuente).not.toBeNull();
    expect(fuente).toHaveAttribute("src", "blob:objeto-1");
    expect(fuente).toHaveAttribute("type", "video/mp4");

    await userEvent.click(screen.getByRole("button", { name: "Cerrar vista previa" }));
    await waitFor(() => expect(document.querySelector(".yarl__root")).toBeNull());
  });

  it("sin mime de Meta la vista previa no se queda sin type (Safari no lo intentaria)", async () => {
    pintar(mensaje("video", { media: { mime: null, nombre: null, tamanoBytes: null } }));
    await userEvent.click(screen.getByRole("button", { name: /Reproducir video/i }));

    await userEvent.click(
      await screen.findByRole("button", { name: "Ampliar: Video enviado por el cliente" }),
    );

    await waitFor(() => expect(document.querySelector(".yarl__root source")).not.toBeNull());
    expect(document.querySelector(".yarl__root source")).toHaveAttribute("type", "video/mp4");
  });
});
