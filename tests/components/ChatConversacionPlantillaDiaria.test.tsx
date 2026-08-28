// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type {
  ChatMensajeVista,
  ListarHiloChatResult,
} from "@/lib/types/chat-whatsapp";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// EL CHAT SE DESBLOQUEA CADA DIA — superficie de UI de la regla.
//
// El bug: al reasignar a un mensajero un paquete del dia anterior al que ya se le habia
// enviado una plantilla, el chat quedaba MUDO. Los dos predicados vivian aqui dentro
// (`!hayEntrante && haySaliente`) y corrian sobre el hilo ENTERO, que es por
// `(orden_id, telefono_e164)` y sobrevive a las reasignaciones: un saliente de ayer bastaba
// para deshabilitar las plantillas Y el composer, sin fecha de caducidad.
//
// Ahora las dos banderas llegan de `listarHiloChat`, que las mide contra el dia calendario de
// Costa Rica (eso se prueba en `tests/unit/actions/chat-whatsapp-actions.test.ts`). Aqui se
// prueba lo unico que le toca al componente: que las OBEDECE.
const listarHiloChatMock = vi.fn();
const enviarMensajeChatMock = vi.fn();
const enviarPlantillaChatMock = vi.fn();
vi.mock("@/lib/actions/chat-whatsapp", () => ({
  listarHiloChat: (...a: unknown[]) => listarHiloChatMock(...a),
  enviarMensajeChat: (...a: unknown[]) => enviarMensajeChatMock(...a),
  enviarPlantillaChat: (...a: unknown[]) => enviarPlantillaChatMock(...a),
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

// El minimapa de ubicacion arrastra Leaflet via `next/dynamic` y jsdom no pinta canvas.
vi.mock("@/app/(app)/mis-asignaciones/_components/UbicacionMapa", () => ({
  UbicacionMapa: () => null,
}));

import { ChatConversacion } from "@/app/(app)/mis-asignaciones/_components/chat/ChatConversacion";
import { VISTA_SIN_311 } from "@/tests/fixtures/chat-mensaje";

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
  ...VISTA_SIN_311,
  notas: null,
  tiendaNombre: "Tienda",
  zonaNombre: "Zona",
  provinciaNombre: "San José",
  cantonNombre: "Central",
  distritoNombre: "Carmen",
  secuenciaRuta: 1,
};

/** La plantilla de AYER que dejaba el chat mudo para siempre. */
const SALIENTE_DE_AYER: ChatMensajeVista = {
  id: "m1",
  direccion: "saliente",
  tipo: "plantilla",
  cuerpo: "Hola María, tu paquete sale hoy.",
  estado: "delivered",
  latitud: null,
  longitud: null,
  ...VISTA_SIN_311,
  ocurridoAt: "2026-07-22T20:00:00.000Z",
};

const PLANTILLA = {
  id: "pl-1",
  nombre: "aviso_entrega",
  cuerpo: "Hola, tu paquete llega hoy.",
  variables: [],
};

function hilo(
  plantillaBloqueada: boolean,
  textoLibreHabilitado: boolean,
  mensajes: ChatMensajeVista[] = [SALIENTE_DE_AYER],
): ListarHiloChatResult {
  return {
    status: "ok",
    ventanaAbierta: textoLibreHabilitado,
    ultimoEntranteAt: null,
    plantillaBloqueada,
    textoLibreHabilitado,
    mensajes,
  };
}

// jsdom no implementa `Element.scrollTo` y la conversacion ancla el hilo abajo en cada render.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function scrollToStub() {};
}

function renderChat(ui: ReactElement) {
  return render(
    <SWRConfig
      value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}
    >
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/** Monta la conversacion y resuelve el fetch inicial del hilo y del catalogo. */
async function montar(res: ListarHiloChatResult): Promise<void> {
  listarHiloChatMock.mockResolvedValue(res);
  renderChat(<ChatConversacion orden={ORDEN} onVolver={() => {}} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

const chipPlantilla = () => screen.getByRole("button", { name: "Aviso Entrega" });
const composer = () => screen.getByLabelText("Mensaje para el destinatario");
const AVISO_BLOQUEO = "Ya escribiste hoy a este cliente. Espera su respuesta para continuar.";

beforeEach(() => {
  listarHiloChatMock.mockReset();
  enviarMensajeChatMock.mockReset();
  enviarPlantillaChatMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockResolvedValue({
    status: "ok",
    items: [PLANTILLA],
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("ChatConversacion — el chat se desbloquea cada dia", () => {
  it("EL BUG: con una plantilla de AYER en el hilo, hoy se puede volver a enviar", async () => {
    await montar(hilo(false, false));

    // El saliente de ayer sigue VIENDOSE —el historial no se toca—, pero ya no manda.
    expect(screen.getByText("Hola María, tu paquete sale hoy.")).toBeInTheDocument();
    expect(chipPlantilla()).toBeEnabled();
    expect(screen.queryByText(AVISO_BLOQUEO)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "El cliente aún no ha respondido: solo puedes enviar una plantilla aprobada.",
      ),
    ).toBeInTheDocument();
  });

  it("con un saliente de HOY sin respuesta, la plantilla queda bloqueada y se explica", async () => {
    await montar(hilo(true, false));

    expect(chipPlantilla()).toBeDisabled();
    expect(screen.getByText(AVISO_BLOQUEO)).toBeInTheDocument();
  });

  it("sin texto libre habilitado el composer no acepta tecleo", async () => {
    await montar(hilo(false, false));

    expect(composer()).toBeDisabled();
    expect(composer()).toHaveAttribute(
      "placeholder",
      "Elige una plantilla para iniciar la conversación",
    );
  });

  it("elegir una plantilla llena el composer en solo lectura y permite enviarla", async () => {
    enviarPlantillaChatMock.mockResolvedValue({ status: "ok", mensajeChatId: "x" });
    await montar(hilo(false, false));

    await act(async () => {
      chipPlantilla().click();
    });

    expect(composer()).toHaveValue(PLANTILLA.cuerpo);
    expect(composer()).toHaveAttribute("readonly");

    await act(async () => {
      screen.getByRole("button", { name: "Enviar mensaje" }).click();
    });
    expect(enviarPlantillaChatMock).toHaveBeenCalledWith("orden-1", "pl-1");
    expect(enviarMensajeChatMock).not.toHaveBeenCalled();
  });

  it("con el texto libre habilitado se escribe y se envia como texto, no como plantilla", async () => {
    enviarMensajeChatMock.mockResolvedValue({ status: "ok", mensajeChatId: "x" });
    await montar(hilo(false, true));

    const campo = composer();
    expect(campo).toBeEnabled();
    expect(campo).toHaveAttribute("placeholder", "Escribe un mensaje…");
    expect(screen.queryByText(AVISO_BLOQUEO)).not.toBeInTheDocument();
  });
});
