// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Feature 316 (E2) — LA NOTA DE VOZ.
//
// El riesgo de la feature esta aqui: Chrome en Android graba `audio/webm;codecs=opus` por
// defecto y Meta lo RECHAZA como `type: audio`. Por eso el formato se MIDE con
// `MediaRecorder.isTypeSupported` sobre la lista de los que Meta acepta (R14) y, si no hay
// ninguno, la via NO se ofrece (R15/D5, decision humana): es preferible que el mensajero use
// otra via a que el cliente reciba un archivo que no puede reproducir.
//
// El microfono se cierra SIEMPRE (R16): dejar el `MediaStream` vivo enciende el indicador del
// sistema hasta cerrar la pestana, y el mensajero no tiene forma de apagarlo.
const listarHiloChatMock = vi.fn();
const enviarMensajeChatMock = vi.fn();
const enviarPlantillaChatMock = vi.fn();
const enviarMediaChatMock = vi.fn();
vi.mock("@/lib/actions/chat-whatsapp", () => ({
  listarHiloChat: (...a: unknown[]) => listarHiloChatMock(...a),
  enviarMensajeChat: (...a: unknown[]) => enviarMensajeChatMock(...a),
  enviarPlantillaChat: (...a: unknown[]) => enviarPlantillaChatMock(...a),
  enviarMediaChat: (...a: unknown[]) => enviarMediaChatMock(...a),
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

import { ChatConversacion } from "@/app/(app)/mis-asignaciones/_components/chat/ChatConversacion";
import { okHilo, ORDEN, renderChat } from "./_chat-hilo-harness";

/** Formatos que el "dispositivo" del test dice soportar; cada caso pone los suyos. */
let soportados: string[] = [];

/** MIME que el grabador dice haber usado DE VERDAD (puede diferir del pedido). */
let mimeReal: string | null = null;

const stopPista = vi.fn();
const getUserMediaMock = vi.fn();

interface GrabadorFalso {
  mimeType: string;
  state: string;
  start: () => void;
  stop: () => void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

const MediaRecorderMock = vi.fn(function (
  this: GrabadorFalso,
  _stream: MediaStream,
  opciones?: { mimeType?: string },
) {
  const pedido = opciones?.mimeType ?? "";
  this.mimeType = mimeReal ?? pedido;
  this.state = "inactive";
  this.ondataavailable = null;
  this.onstop = null;
  this.start = () => {
    this.state = "recording";
  };
  this.stop = () => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    this.onstop?.();
  };
});

async function montar(): Promise<void> {
  listarHiloChatMock.mockResolvedValue(okHilo([]));
  renderChat(<ChatConversacion orden={ORDEN} onVolver={() => {}} />);
  await act(async () => {
    await Promise.resolve();
  });
}

const clip = () => screen.getByRole("button", { name: "Adjuntar" });
const viaNotaDeVoz = () => screen.getByRole("menuitem", { name: /nota de voz/i });
const textarea = () =>
  screen.getByLabelText("Mensaje para el destinatario") as HTMLTextAreaElement;

async function abrirMenu(): Promise<void> {
  await act(async () => {
    clip().click();
  });
}

/** Abre el menu y arranca la grabacion (dejando resolver el `getUserMedia`). */
async function grabar(): Promise<void> {
  await abrirMenu();
  await act(async () => {
    viaNotaDeVoz().click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function detener(): Promise<void> {
  await act(async () => {
    screen.getByRole("button", { name: "Detener" }).click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  soportados = ["audio/ogg;codecs=opus"];
  mimeReal = null;
  listarHiloChatMock.mockReset();
  enviarMensajeChatMock.mockReset();
  enviarPlantillaChatMock.mockReset();
  enviarMediaChatMock.mockReset();
  enviarMediaChatMock.mockResolvedValue({ status: "ok", mensajeChatId: "m-1" });
  listarPlantillasActivasParaEnvioMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockResolvedValue({ status: "ok", items: [] });
  MediaRecorderMock.mockClear();
  stopPista.mockClear();
  getUserMediaMock.mockReset();
  getUserMediaMock.mockResolvedValue({
    getTracks: () => [{ stop: stopPista, kind: "audio" }],
  });

  (MediaRecorderMock as unknown as { isTypeSupported: (m: string) => boolean })
    .isTypeSupported = (m: string) => soportados.includes(m);
  vi.stubGlobal("MediaRecorder", MediaRecorderMock);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: getUserMediaMock },
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => "blob:nota-1");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Nota de voz del composer (E2)", () => {
  it("R14: graba en el PRIMER formato de la lista de Meta que el dispositivo soporta", async () => {
    soportados = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
    await montar();

    await grabar();

    expect(MediaRecorderMock).toHaveBeenCalledTimes(1);
    const opciones = MediaRecorderMock.mock.calls[0][1] as { mimeType: string };
    expect(opciones.mimeType).toBe("audio/ogg;codecs=opus");
    expect(screen.getByText("Grabando nota de voz…")).toBeInTheDocument();
  });

  it("R14/R15: si SOLO hay `audio/webm`, no se construye ningun MediaRecorder", async () => {
    soportados = ["audio/webm;codecs=opus"];
    await montar();

    await abrirMenu();
    await act(async () => {
      viaNotaDeVoz().click();
      await Promise.resolve();
    });

    expect(MediaRecorderMock).not.toHaveBeenCalled();
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("R15: sin formato aceptado la via queda deshabilitada, se dice, y las otras TRES siguen", async () => {
    soportados = ["audio/webm;codecs=opus"];
    await montar();

    await abrirMenu();

    expect(viaNotaDeVoz()).toBeDisabled();
    expect(
      screen.getByText("La nota de voz no está disponible en este navegador."),
    ).toBeInTheDocument();
    for (const nombre of [/cámara/i, /archivo del dispositivo/i, /documento/i]) {
      expect(screen.getByRole("menuitem", { name: nombre })).toBeEnabled();
    }
  });

  it("R13: tras detener se puede ESCUCHAR la nota y 'Descartar' la borra sin enviar nada", async () => {
    await montar();
    await grabar();
    await detener();

    const reproductor = await screen.findByLabelText("Nota de voz grabada");
    expect(reproductor.tagName.toLowerCase()).toBe("audio");
    expect(reproductor).toHaveAttribute("controls");

    await act(async () => {
      screen.getByRole("button", { name: "Descartar nota de voz" }).click();
    });

    expect(screen.queryByLabelText("Nota de voz grabada")).not.toBeInTheDocument();
    expect(enviarMediaChatMock).not.toHaveBeenCalled();
    // R16: al terminar, el microfono queda cerrado.
    expect(stopPista).toHaveBeenCalled();
  });

  it("R14: lo que se sube lleva el mimeType REAL del grabador, no el que se pidio", async () => {
    // El navegador acepta la peticion pero graba con otro parametro: se detecta por el mismo
    // camino que cualquier archivo (`clasificarAdjunto` mira el MIME base), no por un supuesto.
    mimeReal = "audio/ogg";
    await montar();
    await grabar();
    await detener();

    await screen.findByLabelText("Nota de voz grabada");
    await act(async () => {
      screen.getByRole("button", { name: "Enviar mensaje" }).click();
    });

    const fd = enviarMediaChatMock.mock.calls[0][0] as FormData;
    expect((fd.get("archivo") as File).type).toBe("audio/ogg");
  });

  it("R16: si se deniega el microfono se dice, no se queda en 'Grabando' y no se envia nada", async () => {
    getUserMediaMock.mockRejectedValue(new Error("NotAllowedError"));
    await montar();

    await grabar();

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/micrófono/i);
    expect(screen.queryByText("Grabando nota de voz…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Detener" })).not.toBeInTheDocument();
    expect(enviarMediaChatMock).not.toHaveBeenCalled();
  });

  it("R16: si el permiso se concede pero el grabador no arranca, las pistas se paran igual", async () => {
    MediaRecorderMock.mockImplementationOnce(() => {
      throw new Error("NotSupportedError");
    });
    await montar();

    await grabar();

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/No se pudo grabar la nota de voz/i);
    expect(stopPista).toHaveBeenCalled();
    expect(screen.queryByText("Grabando nota de voz…")).not.toBeInTheDocument();
  });

  it("R6: la nota va SIN pie y el texto escrito NO se pierde al enviarla", async () => {
    await montar();
    await userEvent.type(textarea(), "Te dejo una nota");
    await grabar();
    await detener();
    await screen.findByLabelText("Nota de voz grabada");

    await act(async () => {
      screen.getByRole("button", { name: "Enviar mensaje" }).click();
    });

    expect(enviarMediaChatMock).toHaveBeenCalledTimes(1);
    const fd = enviarMediaChatMock.mock.calls[0][0] as FormData;
    // Meta no admite pie en audio: no se manda... y tampoco se tira lo escrito.
    expect(fd.get("caption")).toBeNull();
    await waitFor(() => {
      expect(screen.queryByLabelText("Nota de voz grabada")).not.toBeInTheDocument();
    });
    expect(textarea()).toHaveValue("Te dejo una nota");
  });
});
