// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act, waitFor } from "@testing-library/react";
import type { ChatMensajeTipo } from "@prisma/client";

// Feature 299 (R14/R27) — NINGUNA burbuja del hilo queda vacia.
//
// El sintoma que arregla la feature: todo entrante que no fuera `text` ni `location` caia en
// `otro` con `cuerpo = null` y se pintaba como `<p>{cuerpo ?? ""}</p>`, o sea una burbuja con
// SOLO la hora. Aqui se monta el hilo REAL con los ocho tipos nuevos mas el sumidero `otro` y
// se comprueba, burbuja a burbuja, que hay algo que el mensajero pueda percibir.
const listarHiloChatMock = vi.fn();
vi.mock("@/lib/actions/chat-whatsapp", () => ({
  listarHiloChat: (...a: unknown[]) => listarHiloChatMock(...a),
  enviarMensajeChat: vi.fn(),
  enviarPlantillaChat: vi.fn(),
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
import { horaCorta } from "@/app/(app)/mis-asignaciones/_components/chat/chat-format";
import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import { burbuja, okHilo, ORDEN, renderChat } from "./_chat-hilo-harness";

const fetchMock = vi.fn();

const OCURRIDO = "2026-08-27T15:00:00.000Z";

/** Un mensaje por cada tipo NUEVO de la feature, con lo minimo que trae su contrato. */
const POR_TIPO: Record<string, Partial<ChatMensajeVista>> = {
  imagen: { media: { mime: "image/jpeg", nombre: null, tamanoBytes: null }, cuerpo: null },
  sticker: { media: { mime: "image/webp", nombre: null, tamanoBytes: null }, cuerpo: null },
  audio: { media: { mime: "audio/ogg", nombre: null, tamanoBytes: null }, cuerpo: null },
  video: { media: { mime: "video/mp4", nombre: null, tamanoBytes: null }, cuerpo: null },
  documento: {
    media: { mime: "application/pdf", nombre: "guia.pdf", tamanoBytes: null },
    cuerpo: null,
  },
  reaccion: { cuerpo: null },
  contactos: {
    cuerpo: null,
    contactos: [
      {
        nombre: "Ana Rojas",
        telefonos: [{ valor: "+50688887777", tipo: "CELL" }],
        correos: [],
        direcciones: [],
        organizacion: null,
        urls: [],
      },
    ],
  },
  sistema: {
    cuerpo: null,
    sistema: { telefonoAnterior: "50688887777", telefonoNuevo: "50699996666" },
  },
};

const TIPOS_NUEVOS = Object.keys(POR_TIPO) as ChatMensajeTipo[];

function mensajeDe(tipo: ChatMensajeTipo): ChatMensajeVista {
  return burbuja({ id: `m-${tipo}`, tipo, ocurridoAt: OCURRIDO, ...POR_TIPO[tipo] });
}

/**
 * Las burbujas del hilo son los `<li>` HIJOS DIRECTOS de la lista del historial. Se filtra asi
 * a proposito: la tarjeta de contacto lleva su propia `<ul>` con un `<li>` por dato copiable, y
 * contarlos como burbujas mediria otra cosa.
 */
function burbujasDelHilo(): HTMLLIElement[] {
  const hilo = screen.getByRole("list", { name: "Historial de mensajes" });
  return Array.from(hilo.querySelectorAll<HTMLLIElement>(":scope > li"));
}

async function montar(mensajes: ChatMensajeVista[]): Promise<void> {
  listarHiloChatMock.mockResolvedValue(okHilo(mensajes));
  renderChat(<ChatConversacion orden={ORDEN} onVolver={() => {}} />);
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Contenido PERCEPTIBLE de una burbuja: su texto sin la hora, o cualquier elemento con sentido
 * propio (imagen con `alt`, reproductor, enlace de descarga, boton). Que la hora no cuente es
 * justo el punto: la burbuja rota de antes tenia exactamente eso y nada mas.
 */
function contenidoPerceptible(fila: HTMLElement): string | Element | null {
  const sinHora = (fila.textContent ?? "").replace(horaCorta(OCURRIDO), "").trim();
  if (sinHora !== "") return sinHora;
  return fila.querySelector("img[alt]:not([alt='']), audio, video, a, button");
}

beforeEach(() => {
  listarHiloChatMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockResolvedValue({ status: "ok", items: [] });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    blob: async () => new Blob(["bin"], { type: "image/jpeg" }),
  });
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

describe("Contenido de la burbuja por tipo (R14/R27)", () => {
  it("R14: un mensaje `otro` con cuerpo null muestra el aviso, no una burbuja vacia", async () => {
    await montar([burbuja({ id: "m-otro", tipo: "otro", cuerpo: null })]);

    const [fila] = burbujasDelHilo();
    expect(fila?.textContent).toContain("Mensaje no compatible");
    // Y lo que se ve NO es solo la hora, que es como se veia antes de la feature.
    expect(contenidoPerceptible(fila as HTMLElement)).toBe("Mensaje no compatible");
  });

  it.each(TIPOS_NUEVOS)(
    "R27: una burbuja de tipo %s renderiza contenido perceptible",
    async (tipo) => {
      await montar([mensajeDe(tipo)]);

      const [fila] = burbujasDelHilo();
      await waitFor(() => {
        expect(contenidoPerceptible(fila as HTMLElement)).toBeTruthy();
      });
    },
  );

  it("R27: con los OCHO tipos nuevos en el mismo hilo, ninguna fila queda sin contenido", async () => {
    await montar(TIPOS_NUEVOS.map(mensajeDe));

    const filas = burbujasDelHilo();
    expect(filas).toHaveLength(TIPOS_NUEVOS.length);

    await waitFor(() => {
      for (const fila of filas) {
        expect(contenidoPerceptible(fila)).toBeTruthy();
      }
    });
  });

  it("R27/R33: el texto normal sigue pintandose y sus URL quedan enlazadas", async () => {
    await montar([burbuja({ id: "m-texto", cuerpo: "rastrea en https://ordenex.co/x" })]);

    expect(screen.getByRole("link", { name: "https://ordenex.co/x" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("R27: la ubicacion sigue siendo un boton y NO vuelca las coordenadas al DOM", async () => {
    await montar([
      burbuja({ id: "m-ubi", tipo: "ubicacion", cuerpo: null, latitud: 9.93, longitud: -84.09 }),
    ]);

    expect(screen.getByRole("button", { name: "Ver ubicación compartida" })).toBeInTheDocument();
    const [fila] = burbujasDelHilo();
    expect(fila?.textContent).not.toContain("9.93");
    expect(fila?.textContent).not.toContain("-84.09");
  });
});
