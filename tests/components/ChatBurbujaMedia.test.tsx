// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Feature 316 (F1): la mitad de abajo de este archivo monta el HILO entero para ver la burbuja
// SALIENTE con adjunto de punta a punta. Estos mocks no afectan a los tests de arriba, que
// renderizan `BurbujaContenido` suelto y no tocan ninguna Server Action.
const listarHiloChatMock = vi.fn();
vi.mock("@/lib/actions/chat-whatsapp", () => ({
  listarHiloChat: (...a: unknown[]) => listarHiloChatMock(...a),
  enviarMensajeChat: vi.fn(),
  enviarPlantillaChat: vi.fn(),
  enviarMediaChat: vi.fn(),
}));

const listarPlantillasActivasParaEnvioMock = vi.fn();
vi.mock("@/lib/actions/whatsapp-envio", () => ({
  listarPlantillasActivasParaEnvio: (...a: unknown[]) =>
    listarPlantillasActivasParaEnvioMock(...a),
}));

vi.mock("@/lib/audio/tono-notificacion", () => ({
  reproducirTono: vi.fn(),
  prepararAudio: vi.fn(),
  reiniciarAudioParaTests: vi.fn(),
}));

vi.mock("@/app/(app)/mis-asignaciones/_components/UbicacionMapa", () => ({
  UbicacionMapa: () => null,
}));

import { BurbujaContenido } from "@/app/(app)/mis-asignaciones/_components/chat/BurbujaContenido";
import { ChatConversacion } from "@/app/(app)/mis-asignaciones/_components/chat/ChatConversacion";
import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import type { ChatMensajeTipo } from "@prisma/client";

import { burbuja, okHilo, ORDEN, renderChat } from "./_chat-hilo-harness";

// Feature 311 (R24/R27/R28/R29) — las burbujas con ADJUNTO.
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

  // Feature 316 (E3/R23) — los textos accesibles se resuelven por DIRECCION. La 311 los cableo
  // a "del cliente" porque solo existia el entrante; con salientes eso le mentiria al lector de
  // pantalla sobre quien mando el adjunto.

  it("R23: la imagen SALIENTE no se anuncia como enviada por el cliente", async () => {
    pintar(mensaje("imagen", { direccion: "saliente" }));

    const imagen = await screen.findByRole("img");
    const alternativo = imagen.getAttribute("alt") ?? "";
    expect(alternativo).not.toMatch(/cliente/i);
    expect(alternativo).toMatch(/enviaste/i);
  });

  it("R23: la imagen ENTRANTE conserva el texto de la 311 (regresion)", async () => {
    pintar(mensaje("imagen", { direccion: "entrante" }));

    expect(
      await screen.findByAltText("Imagen enviada por el cliente"),
    ).toBeInTheDocument();
  });

  it("R23: el sticker saliente dice que lo enviaste tu", async () => {
    pintar(mensaje("sticker", { direccion: "saliente" }));

    expect(await screen.findByAltText("Sticker que enviaste")).toBeInTheDocument();
  });

  it("R23: el reproductor de la nota de voz SALIENTE no la atribuye al cliente", async () => {
    pintar(
      mensaje("audio", {
        direccion: "saliente",
        media: { mime: "audio/ogg", nombre: null, tamanoBytes: null },
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /Reproducir nota de voz/i }));

    const reproductor = await screen.findByLabelText("Nota de voz que enviaste");
    expect(reproductor.tagName.toLowerCase()).toBe("audio");
    expect(screen.queryByLabelText(/cliente/i)).toBeNull();
  });

  it("R23: la nota de voz ENTRANTE conserva su nombre accesible de la 311 (regresion)", async () => {
    pintar(
      mensaje("audio", {
        direccion: "entrante",
        media: { mime: "audio/ogg", nombre: null, tamanoBytes: null },
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /Reproducir nota de voz/i }));

    expect(await screen.findByLabelText("Nota de voz del cliente")).toBeInTheDocument();
  });

  it("R23: el video saliente tampoco se atribuye al cliente", async () => {
    pintar(
      mensaje("video", {
        direccion: "saliente",
        media: { mime: "video/mp4", nombre: null, tamanoBytes: null },
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /Reproducir video/i }));

    expect(await screen.findByLabelText("Video que enviaste")).toBeInTheDocument();
  });

  // Reintento tras un fallo. El adjunto que fallaba quedaba MUERTO hasta desmontar la burbuja:
  // el efecto de descarga solo dependia de `pedido`, que tras el fallo ya valia `true`, asi que
  // no se relanzaba ningun `fetch`. Por eso el assert que importa aqui es el NUMERO DE LLAMADAS
  // al proxy, no que el boton exista.

  it("Reintento: tras un 502 aparece el boton y al pulsarlo se pide OTRA VEZ el binario", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, blob: async () => new Blob([]) });
    pintar(mensaje("imagen"));

    const reintentar = await screen.findByRole("button", {
      name: "Reintentar la descarga de la imagen",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(reintentar);

    // El binario se vuelve a pedir de verdad: segunda llamada al proxy, mismo id interno.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("/api/chat/media/msg-1");
  });

  it("Reintento: si el segundo intento responde 200 la burbuja queda lista y el aviso se va", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, blob: async () => new Blob([]) });
    fetchMock.mockResolvedValue(respuestaOk());
    pintar(mensaje("imagen"));

    await userEvent.click(
      await screen.findByRole("button", { name: "Reintentar la descarga de la imagen" }),
    );

    const imagen = await screen.findByRole("img");
    expect(imagen).toHaveAttribute("src", "blob:objeto-1");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reintentar la descarga de la imagen" }),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Reintento: desde un 410 tambien hay salida, y el aviso de caducado sigue siendo texto", async () => {
    fetchMock.mockResolvedValueOnce(respuestaExpirada());
    fetchMock.mockResolvedValue(respuestaOk());
    pintar(mensaje("imagen"));

    await waitFor(() => {
      expect(screen.getByText(/ya no está disponible/i)).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Reintentar la descarga de la imagen" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole("img")).toBeInTheDocument();
    expect(screen.queryByText(/ya no está disponible/i)).toBeNull();
  });

  it("Reintento: el audio caducado ofrece reintentar con nombre accesible propio y repite la peticion", async () => {
    fetchMock.mockResolvedValue(respuestaExpirada());
    pintar(mensaje("audio", { media: { mime: "audio/ogg", nombre: null, tamanoBytes: null } }));

    await userEvent.click(screen.getByRole("button", { name: /Reproducir nota de voz/i }));

    const reintentar = await screen.findByRole("button", {
      name: "Reintentar la descarga de la nota de voz",
    });
    expect(screen.getByText(/ya no está disponible/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(reintentar);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("Reintento: un fetch RECHAZADO (sin cobertura) tambien se puede reintentar", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockResolvedValue(respuestaOk());
    pintar(mensaje("imagen"));

    await userEvent.click(
      await screen.findByRole("button", { name: "Reintentar la descarga de la imagen" }),
    );

    expect(await screen.findByRole("img")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

// Feature 316 (F1/R22/R25) — LA BURBUJA SALIENTE CON ADJUNTO, EN EL HILO DE VERDAD.
//
// Los tests de arriba montan `BurbujaContenido` suelto; este monta la conversacion entera con
// el hilo que devuelve la Server Action, que es donde se ve lo que la feature promete: el
// adjunto propio a la derecha, con su acuse de entrega y sin recargar la pagina.
describe("Burbuja SALIENTE con adjunto en el hilo (F1/R22/R25)", () => {
  const SALIENTE_CON_FOTO: ChatMensajeVista = burbuja({
    id: "msg-1",
    direccion: "saliente",
    tipo: "imagen",
    cuerpo: null,
    estado: "sent",
    media: { mime: "image/jpeg", nombre: null, tamanoBytes: 120_000 },
  });

  async function montarHilo(mensajes: ChatMensajeVista[]): Promise<void> {
    listarHiloChatMock.mockResolvedValue(okHilo(mensajes));
    listarPlantillasActivasParaEnvioMock.mockResolvedValue({ status: "ok", items: [] });
    renderChat(<ChatConversacion orden={ORDEN} onVolver={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("R22: el adjunto propio se pinta a la derecha, con su adjunto y su acuse", async () => {
    await montarHilo([SALIENTE_CON_FOTO]);

    const fila = await waitFor(() => {
      const li = screen.getByRole("listitem");
      expect(li).toHaveAttribute("data-direccion", "saliente");
      return li;
    });

    // El adjunto esta DENTRO de la burbuja saliente, pedido al proxy por el id INTERNO.
    const imagen = await within(fila).findByRole("img");
    expect(imagen).toHaveAttribute("src", "blob:objeto-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/chat/media/msg-1");
    // R23: y no se le atribuye al cliente.
    expect(imagen.getAttribute("alt") ?? "").not.toMatch(/cliente/i);
    // Los acuses de entrega son los mismos que ya tiene un saliente de texto.
    expect(fila.querySelector("svg.lucide-check")).not.toBeNull();
  });

  it("R25: un adjunto PROPIO caducado dice que el archivo ya no esta disponible", async () => {
    fetchMock.mockResolvedValue(respuestaExpirada());
    await montarHilo([SALIENTE_CON_FOTO]);

    await waitFor(() => {
      expect(screen.getByText(/Este archivo ya no está disponible/i)).toBeInTheDocument();
    });
    const fila = screen.getByRole("listitem");
    expect(fila).toHaveAttribute("data-direccion", "saliente");
    expect(fila.querySelector("img")).toBeNull();
  });
});
