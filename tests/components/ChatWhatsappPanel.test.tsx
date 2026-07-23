// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type {
  ChatMensajeVista,
  ListarHiloChatResult,
} from "@/lib/types/chat-whatsapp";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 109 (bloque G, R22-R24) — panel del chat del mensajero. Se mockean las Server
// Actions del chat y las de plantillas (feature 107, fallback fuera de ventana) para
// ejercitar la composición de la UI sin DB ni sesión.
const listarHiloChatMock = vi.fn();
const enviarMensajeChatMock = vi.fn();
vi.mock("@/lib/actions/chat-whatsapp", () => ({
  listarHiloChat: (...a: unknown[]) => listarHiloChatMock(...a),
  enviarMensajeChat: (...a: unknown[]) => enviarMensajeChatMock(...a),
}));

// El fallback de plantilla (feature 107) carga su catálogo de forma perezosa al abrir el
// sheet; aquí solo comprobamos que el botón se ofrece, así que basta con neutralizar su
// Server Action para no arrastrar el backend.
const listarPlantillasParaEnvioMock = vi.fn();
vi.mock("@/lib/actions/whatsapp-envio", () => ({
  listarPlantillasParaEnvio: (...a: unknown[]) =>
    listarPlantillasParaEnvioMock(...a),
}));

import { ChatWhatsappPanel } from "@/app/(app)/mis-asignaciones/_components/ChatWhatsappPanel";

const ORDEN: MiAsignacionDTO = {
  id: "orden-1",
  numGuia: 12345,
  numRemision: "R-001",
  estatusValue: "en_reparto",
  destinatario: "María López",
  telefonoDest: "88887777",
  direccion: "Calle 1",
  producto: "Caja",
  peso: 1,
  montoCobrar: 5000,
  latitud: null,
  longitud: null,
  notas: null,
  tiendaNombre: "Tienda",
  zonaNombre: "Zona",
  provinciaNombre: "San José",
  cantonNombre: "Central",
  distritoNombre: "Carmen",
  secuenciaRuta: 1,
};

const ENTRANTE: ChatMensajeVista = {
  id: "m1",
  direccion: "entrante",
  tipo: "texto",
  cuerpo: "Hola, ¿cuándo llega mi paquete?",
  estado: null,
  ocurridoAt: "2026-07-23T15:00:00.000Z",
};

const SALIENTE: ChatMensajeVista = {
  id: "m2",
  direccion: "saliente",
  tipo: "texto",
  cuerpo: "En camino, llego en 20 minutos.",
  estado: "delivered",
  ocurridoAt: "2026-07-23T15:05:00.000Z",
};

function okHilo(
  ventanaAbierta: boolean,
  mensajes: ChatMensajeVista[],
): ListarHiloChatResult {
  return {
    status: "ok",
    ventanaAbierta,
    ultimoEntranteAt: mensajes.length > 0 ? ENTRANTE.ocurridoAt : null,
    mensajes,
  };
}

function renderPanel(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  listarHiloChatMock.mockReset();
  enviarMensajeChatMock.mockReset();
  listarPlantillasParaEnvioMock.mockReset();
  // SWR solo refresca con el documento visible (refreshWhenHidden por defecto = false).
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

afterEach(() => {
  cleanup();
});

describe("ChatWhatsappPanel", () => {
  // R22 (G1.T)
  it("muestra historial ordenado con entrante/saliente y estado", async () => {
    listarHiloChatMock.mockResolvedValue(okHilo(true, [ENTRANTE, SALIENTE]));

    renderPanel(<ChatWhatsappPanel orden={ORDEN} />);

    // Ambos cuerpos presentes.
    expect(
      await screen.findByText("Hola, ¿cuándo llega mi paquete?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("En camino, llego en 20 minutos."),
    ).toBeInTheDocument();

    // Orden cronológico: entrante antes que saliente (mismo orden que el backend).
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-direccion", "entrante");
    expect(items[1]).toHaveAttribute("data-direccion", "saliente");

    // Estado de entrega SOLO en el saliente (R22).
    expect(within(items[1]).getByText("Entregado")).toBeInTheDocument();
    expect(within(items[0]).queryByText("Entregado")).toBeNull();
  });

  // R23 (G2.T)
  it("habilita el input dentro de la ventana y ofrece plantilla fuera de ella", async () => {
    // Dentro de la ventana: input de texto libre habilitado.
    listarHiloChatMock.mockResolvedValue(okHilo(true, [ENTRANTE]));
    const { unmount } = renderPanel(<ChatWhatsappPanel orden={ORDEN} />);

    expect(
      await screen.findByLabelText("Mensaje para el cliente"),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", {
        name: /Enviar plantilla de WhatsApp/i,
      }),
    ).toBeNull();

    unmount();
    cleanup();

    // Fuera de la ventana: sin input libre, con fallback de plantilla (feature 107).
    listarHiloChatMock.mockResolvedValue(okHilo(false, [ENTRANTE]));
    renderPanel(<ChatWhatsappPanel orden={ORDEN} />);

    expect(
      await screen.findByRole("button", {
        name: /Enviar plantilla de WhatsApp/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensaje para el cliente")).toBeNull();
  });

  // R24 (G3.T)
  it("refresca el hilo sin recarga manual", async () => {
    vi.useFakeTimers();
    try {
      // Primer fetch: hilo sin mensajes. Segundo (tras el intervalo): llega un entrante.
      listarHiloChatMock
        .mockResolvedValueOnce(okHilo(true, []))
        .mockResolvedValue(okHilo(true, [ENTRANTE]));

      renderPanel(<ChatWhatsappPanel orden={ORDEN} />);

      // Resuelve el fetch inicial.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        screen.getByText("Aún no hay mensajes en esta conversación."),
      ).toBeInTheDocument();

      // Avanza el intervalo de refresco (~10 s): SWR revalida y aparece el nuevo mensaje.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(
        screen.getByText("Hola, ¿cuándo llega mi paquete?"),
      ).toBeInTheDocument();
      expect(listarHiloChatMock.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
