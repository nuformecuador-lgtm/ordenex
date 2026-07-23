// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { useState, type ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type {
  ChatMensajeVista,
  ListarHiloChatResult,
} from "@/lib/types/chat-whatsapp";
import type { PlantillaTextoDTO } from "@/lib/types/whatsapp-envio";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 109 (bloque G, R22-R24) + feature 120 — panel del chat del mensajero. Se mockean las
// Server Actions del chat y las de plantillas (feature 107, catálogo de la burbuja) para
// ejercitar la composición de la UI sin DB ni sesión.
const listarHiloChatMock = vi.fn();
const enviarMensajeChatMock = vi.fn();
const enviarPlantillaChatMock = vi.fn();
vi.mock("@/lib/actions/chat-whatsapp", () => ({
  listarHiloChat: (...a: unknown[]) => listarHiloChatMock(...a),
  enviarMensajeChat: (...a: unknown[]) => enviarMensajeChatMock(...a),
  enviarPlantillaChat: (...a: unknown[]) => enviarPlantillaChatMock(...a),
}));

// La burbuja de plantillas (feature 107) carga su catálogo de forma perezosa al abrir el
// sheet. Feature 120: al elegir una, ya no abre wa.me sino que "pega" el texto en el input.
const listarPlantillasParaEnvioMock = vi.fn();
vi.mock("@/lib/actions/whatsapp-envio", () => ({
  listarPlantillasParaEnvio: (...a: unknown[]) =>
    listarPlantillasParaEnvioMock(...a),
}));

import {
  ChatWhatsappPanel,
  BORRADOR_CHAT_VACIO,
  type BorradorChat,
} from "@/app/(app)/mis-asignaciones/_components/ChatWhatsappPanel";

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

const PLANTILLA: PlantillaTextoDTO = {
  id: "plantilla-1",
  nombre: "Aviso de entrega",
  cuerpo: "Hola, tu pedido va en camino.",
  variables: [],
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

/**
 * Feature 120: el composer es CONTROLADO por un borrador que vive en el padre. Este harness
 * reproduce ese padre (estado + setter) para ejercitar el panel como en `GestionarOrdenPanel`.
 */
function PanelHarness({
  orden,
  borradorInicial = BORRADOR_CHAT_VACIO,
}: {
  orden: MiAsignacionDTO;
  borradorInicial?: BorradorChat;
}) {
  const [borrador, setBorrador] = useState<BorradorChat>(borradorInicial);
  return (
    <ChatWhatsappPanel
      orden={orden}
      borrador={borrador}
      onBorradorChange={setBorrador}
    />
  );
}

function renderPanel(ui: ReactElement) {
  return render(
    // `revalidateOnFocus: false`: al abrir la burbuja (base-ui Dialog) jsdom mueve el foco y
    // dispara la revalidación por foco de SWR, un artefacto de test (un navegador real no
    // re-enfoca la ventana al abrir un diálogo). El refresco por `refreshInterval` no se toca.
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        revalidateOnFocus: false,
      }}
    >
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  listarHiloChatMock.mockReset();
  enviarMensajeChatMock.mockReset();
  enviarPlantillaChatMock.mockReset();
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

    renderPanel(<PanelHarness orden={ORDEN} />);

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
  it("habilita el input dentro de la ventana y exige plantilla fuera de ella", async () => {
    // Dentro de la ventana: input de texto libre habilitado (y la burbuja para pegar plantillas).
    listarHiloChatMock.mockResolvedValue(okHilo(true, [ENTRANTE]));
    const { unmount } = renderPanel(<PanelHarness orden={ORDEN} />);

    expect(
      await screen.findByLabelText("Mensaje para el cliente"),
    ).toBeEnabled();
    // Feature 120: la burbuja de plantillas también se ofrece dentro de la ventana (para pegar).
    expect(
      screen.getByRole("button", { name: /Enviar plantilla de WhatsApp/i }),
    ).toBeInTheDocument();

    unmount();
    cleanup();

    // Fuera de la ventana y SIN plantilla elegida: sin input libre, con la burbuja para elegir.
    listarHiloChatMock.mockResolvedValue(okHilo(false, [ENTRANTE]));
    renderPanel(<PanelHarness orden={ORDEN} />);

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

      renderPanel(<PanelHarness orden={ORDEN} />);

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

  // Feature 120 (a): elegir una plantilla desde la burbuja pega su texto en el input.
  it("pega el texto de la plantilla elegida en el input del chat", async () => {
    const user = userEvent.setup();
    listarHiloChatMock.mockResolvedValue(okHilo(true, [ENTRANTE]));
    listarPlantillasParaEnvioMock.mockResolvedValue({
      status: "ok",
      items: [PLANTILLA],
    });

    renderPanel(<PanelHarness orden={ORDEN} />);

    // Espera a que el composer (dentro de la ventana) esté montado antes de abrir la burbuja.
    const input = await screen.findByLabelText<HTMLInputElement>(
      "Mensaje para el cliente",
    );

    // Abre la burbuja y elige la plantilla.
    await user.click(
      screen.getByRole("button", {
        name: /Enviar plantilla de WhatsApp/i,
      }),
    );
    await user.click(await screen.findByText(PLANTILLA.nombre));

    // El texto renderizado quedó pegado en el input, listo para editar/enviar.
    expect(input.value).toBe(PLANTILLA.cuerpo);
  });

  // Feature 120 (b): ventana ABIERTA -> enviar manda el texto libre por `enviarMensajeChat`.
  it("con la ventana abierta, envía el texto del input como texto libre", async () => {
    const user = userEvent.setup();
    listarHiloChatMock.mockResolvedValue(okHilo(true, [ENTRANTE]));
    enviarMensajeChatMock.mockResolvedValue({ status: "ok", mensajeChatId: "x" });

    renderPanel(<PanelHarness orden={ORDEN} />);

    const input = await screen.findByLabelText("Mensaje para el cliente");
    await user.type(input, "Voy llegando");
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    expect(enviarMensajeChatMock).toHaveBeenCalledWith(ORDEN.id, "Voy llegando");
    expect(enviarPlantillaChatMock).not.toHaveBeenCalled();
  });

  // Feature 120 (c): ventana CERRADA + plantilla elegida -> enviar manda la plantilla.
  it("con la ventana cerrada y plantilla elegida, envía como plantilla", async () => {
    const user = userEvent.setup();
    listarHiloChatMock.mockResolvedValue(okHilo(false, [ENTRANTE]));
    enviarPlantillaChatMock.mockResolvedValue({
      status: "ok",
      mensajeChatId: "x",
    });

    renderPanel(
      <PanelHarness
        orden={ORDEN}
        borradorInicial={{
          texto: PLANTILLA.cuerpo,
          plantillaId: PLANTILLA.id,
        }}
      />,
    );

    // El texto pegado se muestra y se avisa que se enviará como plantilla.
    expect(
      await screen.findByText("Se enviará como plantilla"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enviar plantilla" }));

    expect(enviarPlantillaChatMock).toHaveBeenCalledWith(ORDEN.id, PLANTILLA.id);
    expect(enviarMensajeChatMock).not.toHaveBeenCalled();
  });

  // Feature 120 (d): ventana CERRADA sin plantilla -> no hay envío de texto libre.
  it("con la ventana cerrada y sin plantilla, no permite enviar texto libre", async () => {
    listarHiloChatMock.mockResolvedValue(okHilo(false, [ENTRANTE]));

    renderPanel(<PanelHarness orden={ORDEN} />);

    // No hay input de texto libre ni botón de enviar: solo la burbuja para elegir plantilla.
    expect(
      await screen.findByRole("button", {
        name: /Enviar plantilla de WhatsApp/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensaje para el cliente")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Enviar plantilla" }),
    ).toBeNull();
    expect(enviarMensajeChatMock).not.toHaveBeenCalled();
    expect(enviarPlantillaChatMock).not.toHaveBeenCalled();
  });
});
