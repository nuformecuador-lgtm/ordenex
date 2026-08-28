// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Feature 316 (E1) — EL COMPOSER CON ADJUNTO.
//
// Lo que se fija aqui es el ORDEN DE OPERACIONES del navegador, que es contraintuitivo y por
// eso se prueba: normalizar -> clasificar -> validar tamano -> subir (design 2.1). El limite de
// 5 MB de la imagen se mide sobre el RESULTADO de la conversion, no sobre el archivo original;
// esa es la razon por la que una foto de iPhone de 8 MB se puede enviar (R30) y por la que un
// HEIC de 200 KB TAMBIEN tiene que convertirse (R29) aunque "comprimir" no aporte nada.
//
// `comprimirImagen` se MOCKEA a proposito: su propio comportamiento (canvas, EXIF, toBlob nulo)
// esta cubierto en `tests/unit/utils/comprimir-imagen.test.ts`. Aqui lo que se prueba es que el
// composer lo llama con las opciones correctas y que interpreta bien lo que devuelve — incluido
// el caso en que devuelve el ORIGINAL, que es como el helper dice "no pude" (R31).
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

const comprimirImagenMock = vi.fn();
vi.mock("@/lib/utils/comprimir-imagen", () => ({
  comprimirImagen: (...a: unknown[]) => comprimirImagenMock(...a),
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
import { MAX_CAPTION } from "@/lib/config/chat-media-envio";
import { okHilo, ORDEN, renderChat } from "./_chat-hilo-harness";

const MB = 1024 * 1024;

/** `File` de un tamano dado sin reservar los bytes de verdad (una foto de 9 MB en jsdom). */
function archivo(nombre: string, tipo: string, bytes: number): File {
  const file = new File(["x"], nombre, { type: tipo });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

async function montar(textoLibreHabilitado = true): Promise<void> {
  listarHiloChatMock.mockResolvedValue({
    ...okHilo([]),
    textoLibreHabilitado,
  });
  renderChat(<ChatConversacion orden={ORDEN} onVolver={() => {}} />);
  await act(async () => {
    await Promise.resolve();
  });
}

const clip = () => screen.getByRole("button", { name: "Adjuntar" });
const textarea = () =>
  screen.getByLabelText("Mensaje para el destinatario") as HTMLTextAreaElement;
const botonEnviar = () => screen.getByRole("button", { name: "Enviar mensaje" });

async function abrirMenu(): Promise<void> {
  await act(async () => {
    clip().click();
  });
}

/** Elige un archivo por la via "archivo del dispositivo" (la que no abre la camara). */
async function elegir(file: File): Promise<void> {
  await abrirMenu();
  const input = screen.getByLabelText("Elegir un archivo del dispositivo");
  await userEvent.upload(input, file);
  await act(async () => {
    await Promise.resolve();
  });
}

/** Elige un documento por su propia via (su `accept` es el de los cinco MIME de oficina). */
async function elegirDocumento(file: File): Promise<void> {
  await abrirMenu();
  const input = screen.getByLabelText("Elegir un documento");
  await userEvent.upload(input, file);
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Entrega un archivo que el `accept` del input NO habria dejado pasar. No es una trampa del
 * test: `accept` es una SUGERENCIA para el selector del sistema —en Android se puede elegir
 * "cualquier archivo"— y por eso la lista blanca se aplica en el codigo, no en el atributo.
 */
async function elegirSaltandoAccept(file: File): Promise<void> {
  await abrirMenu();
  const input = screen.getByLabelText("Elegir un archivo del dispositivo") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    fireEvent.change(input);
    await Promise.resolve();
  });
}

beforeEach(() => {
  listarHiloChatMock.mockReset();
  enviarMensajeChatMock.mockReset();
  enviarPlantillaChatMock.mockReset();
  enviarMediaChatMock.mockReset();
  enviarMediaChatMock.mockResolvedValue({ status: "ok", mensajeChatId: "m-1" });
  comprimirImagenMock.mockReset();
  comprimirImagenMock.mockImplementation(async (f: File) => f);
  listarPlantillasActivasParaEnvioMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockResolvedValue({ status: "ok", items: [] });
  URL.createObjectURL = vi.fn(() => "blob:adjunto-1");
  URL.revokeObjectURL = vi.fn();
});

afterEach(cleanup);

describe("Composer con adjunto (E1)", () => {
  it("R1: el clip ofrece las CUATRO vias de adjuntar, cada una con nombre accesible", async () => {
    await montar();

    await abrirMenu();

    const vias = screen.getAllByRole("menuitem", {
      name: /cámara|archivo|nota de voz|documento/i,
    });
    expect(vias).toHaveLength(4);
    // D8/R10: el tope del video se dice ANTES de abrir la camara, no con el video ya grabado.
    expect(screen.getByText(/16 MB/)).toBeInTheDocument();
  });

  it("R2: sin texto libre habilitado el clip esta deshabilitado y se explica por que", async () => {
    await montar(false);

    expect(clip()).toBeDisabled();
    expect(
      screen.getByText(
        /Tampoco puedes enviar fotos, vídeos, notas de voz ni documentos hasta que el cliente responda/i,
      ),
    ).toBeInTheDocument();
  });

  it("R4: el adjunto se ve antes de enviarlo y 'Quitar adjunto' lo retira sin enviar nada", async () => {
    await montar();

    await elegir(archivo("puerta.jpg", "image/jpeg", 200 * 1024));

    expect(screen.getByText("puerta.jpg")).toBeInTheDocument();
    const quitar = screen.getByRole("button", { name: "Quitar adjunto" });

    await act(async () => {
      quitar.click();
    });

    expect(screen.queryByText("puerta.jpg")).not.toBeInTheDocument();
    expect(enviarMediaChatMock).not.toHaveBeenCalled();
    // El object URL de la previsualizacion no queda retenido.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:adjunto-1");
  });

  it("R5: con adjunto y texto sale UN SOLO mensaje, con el texto como pie", async () => {
    await montar();
    await elegir(archivo("puerta.jpg", "image/jpeg", 200 * 1024));

    await userEvent.type(textarea(), "La puerta azul");
    await act(async () => {
      botonEnviar().click();
    });

    expect(enviarMediaChatMock).toHaveBeenCalledTimes(1);
    const fd = enviarMediaChatMock.mock.calls[0][0] as FormData;
    expect(fd.get("caption")).toBe("La puerta azul");
    expect(fd.get("ordenId")).toBe(ORDEN.id);
    expect((fd.get("archivo") as File).name).toBe("puerta.jpg");
    // R5: NUNCA los dos caminos. El pie no viaja ademas como mensaje de texto suelto.
    expect(enviarMensajeChatMock).not.toHaveBeenCalled();
  });

  it("R7: con el envio en vuelo, un segundo click y un Enter no mandan el adjunto dos veces", async () => {
    await montar();
    let resolver: (v: unknown) => void = () => {};
    enviarMediaChatMock.mockReturnValue(
      new Promise((res) => {
        resolver = res;
      }),
    );
    await elegir(archivo("puerta.jpg", "image/jpeg", 200 * 1024));

    await act(async () => {
      botonEnviar().click();
      botonEnviar().click();
    });
    await userEvent.type(textarea(), "{Enter}");

    expect(enviarMediaChatMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver({ status: "ok", mensajeChatId: "m-1" });
      await Promise.resolve();
    });
  });

  it("R12: con adjunto el composer baja su tope al maximo de un pie de adjunto", async () => {
    await montar();

    expect(textarea()).toHaveAttribute("maxlength", "4096");

    await elegir(archivo("puerta.jpg", "image/jpeg", 200 * 1024));

    expect(textarea()).toHaveAttribute("maxlength", String(MAX_CAPTION));
  });

  it("R29: un HEIC de iPhone se sube convertido a JPEG y el ORIGINAL no se sube", async () => {
    await montar();
    comprimirImagenMock.mockResolvedValue(archivo("foto.jpg", "image/jpeg", 900 * 1024));

    await elegir(archivo("foto.heic", "image/heic", 3 * MB));
    await act(async () => {
      botonEnviar().click();
    });

    const fd = enviarMediaChatMock.mock.calls[0][0] as FormData;
    expect((fd.get("archivo") as File).type).toBe("image/jpeg");
    expect((fd.get("archivo") as File).type).not.toBe("image/heic");
  });

  it("R29: un HEIC PEQUENO tambien se convierte — el atajo por tamano se apaga a mano", async () => {
    await montar();
    comprimirImagenMock.mockResolvedValue(archivo("foto.jpg", "image/jpeg", 180 * 1024));

    await elegir(archivo("foto.heic", "image/heic", 200 * 1024));
    await act(async () => {
      botonEnviar().click();
    });

    expect(comprimirImagenMock).toHaveBeenCalledTimes(1);
    const opciones = comprimirImagenMock.mock.calls[0][1] as Record<string, unknown>;
    expect(opciones.saltarSiMenorA).toBe(0);
    expect(opciones.devolverOriginalSiMayor).toBe(false);
    const fd = enviarMediaChatMock.mock.calls[0][0] as FormData;
    expect((fd.get("archivo") as File).type).toBe("image/jpeg");
  });

  it("R30: una foto de 8 MB que al convertir pesa 1 MB SI se envia (el limite mira el resultado)", async () => {
    await montar();
    comprimirImagenMock.mockResolvedValue(archivo("foto.jpg", "image/jpeg", 1 * MB));

    await elegir(archivo("foto.heic", "image/heic", 8 * MB));
    await act(async () => {
      botonEnviar().click();
    });

    expect(enviarMediaChatMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R32: un JPEG de 9 MB se normaliza y se envia si queda por debajo del limite", async () => {
    await montar();
    comprimirImagenMock.mockResolvedValue(archivo("grande.jpg", "image/jpeg", 1 * MB));

    await elegir(archivo("grande.jpg", "image/jpeg", 9 * MB));
    await act(async () => {
      botonEnviar().click();
    });

    expect(comprimirImagenMock).toHaveBeenCalledTimes(1);
    expect(enviarMediaChatMock).toHaveBeenCalledTimes(1);
  });

  it("R32: si tras convertir sigue por encima de 5 MB se rechaza por TAMANO y no se sube", async () => {
    await montar();
    comprimirImagenMock.mockResolvedValue(archivo("grande.jpg", "image/jpeg", 7 * MB));

    await elegir(archivo("grande.jpg", "image/jpeg", 9 * MB));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/límite de 5 MB/i);
    expect(enviarMediaChatMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Quitar adjunto" })).not.toBeInTheDocument();
  });

  it("R31: si la conversion no se pudo completar, el aviso es propio y NO el de tipo no permitido", async () => {
    await montar();
    // El helper NUNCA lanza: cuando no puede, devuelve el ORIGINAL. Asi se detecta.
    comprimirImagenMock.mockImplementation(async (f: File) => f);

    await elegir(archivo("foto.heic", "image/heic", 3 * MB));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/No se pudo preparar la foto/i);
    expect(aviso).not.toHaveTextContent(/no se puede enviar por WhatsApp/i);
    expect(enviarMediaChatMock).not.toHaveBeenCalled();
  });

  it("R9: un tipo que no es imagen y no esta en la lista blanca se rechaza con OTRO texto", async () => {
    await montar();

    await elegirSaltandoAccept(archivo("virus.exe", "application/x-msdownload", 1024));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/no se puede enviar por WhatsApp/i);
    expect(aviso).not.toHaveTextContent(/No se pudo preparar la foto/i);
    // R29 aplica SOLO a imagenes: un ejecutable no pasa por el canvas.
    expect(comprimirImagenMock).not.toHaveBeenCalled();
    expect(enviarMediaChatMock).not.toHaveBeenCalled();
  });

  it("un documento valido no se toca: ni se convierte ni pierde su nombre", async () => {
    await montar();

    await elegirDocumento(archivo("factura-882.pdf", "application/pdf", 2 * MB));
    await act(async () => {
      botonEnviar().click();
    });

    expect(comprimirImagenMock).not.toHaveBeenCalled();
    const fd = enviarMediaChatMock.mock.calls[0][0] as FormData;
    expect((fd.get("archivo") as File).name).toBe("factura-882.pdf");
  });

  it("R19: si el envio falla, el adjunto SIGUE en el composer para reintentar", async () => {
    await montar();
    enviarMediaChatMock.mockResolvedValue({ status: "fallo_subida" });

    await elegir(archivo("puerta.jpg", "image/jpeg", 200 * 1024));
    await act(async () => {
      botonEnviar().click();
    });

    await waitFor(() => {
      expect(screen.getByText("puerta.jpg")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Quitar adjunto" })).toBeInTheDocument();
  });

  it("R22: tras el ok el adjunto se limpia y el hilo se revalida (sin recargar)", async () => {
    await montar();

    await elegir(archivo("puerta.jpg", "image/jpeg", 200 * 1024));
    const llamadasIniciales = listarHiloChatMock.mock.calls.length;
    await act(async () => {
      botonEnviar().click();
    });

    await waitFor(() => {
      expect(screen.queryByText("puerta.jpg")).not.toBeInTheDocument();
    });
    expect(listarHiloChatMock.mock.calls.length).toBeGreaterThan(llamadasIniciales);
  });

  it("las cuatro vias siguen ahi tras cerrar y reabrir el menu", async () => {
    await montar();

    await abrirMenu();
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(4);
    await abrirMenu();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
