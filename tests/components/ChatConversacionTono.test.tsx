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

// Feature 161 (R21-R24) — tono de aviso del chat del mensajero.
//
// PROCEDENCIA: estos casos vivían en `tests/components/ChatWhatsappPanel.test.tsx` y se
// borraron el 2026-08-07 junto al panel del detalle (`ChatWhatsappPanel`, PR #312). Con ellos
// se fue el ÚNICO enganche del tono en el chat: la feature 161 declaraba dos superficies
// (campana + chat) y quedó con una, en producción. Vuelven aquí, adaptados a
// `ChatConversacion`, que es la superficie viva del hilo (dentro de `ChatFlotante`, montado
// por `RepartoModule`).
//
// Se mockean las Server Actions del chat y el catálogo de plantillas para ejercitar la UI sin
// DB ni sesión.
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

// jsdom no tiene Web Audio API: se espía el generador del tono. Aquí se verifica CUÁNDO se
// pide el tono desde esta superficie, no cómo suena (eso es `tono-notificacion.test.ts`).
const reproducirTonoMock = vi.fn();
vi.mock("@/lib/audio/tono-notificacion", () => ({
  reproducirTono: (...a: unknown[]) => reproducirTonoMock(...a),
  prepararAudio: vi.fn(),
  reiniciarAudioParaTests: vi.fn(),
}));

// El minimapa de ubicación (feature 121) arrastra Leaflet vía `next/dynamic`; irrelevante para
// el tono y jsdom no pinta canvas.
vi.mock("@/app/(app)/mis-asignaciones/_components/UbicacionMapa", () => ({
  UbicacionMapa: () => null,
}));

import { ChatConversacion } from "@/app/(app)/mis-asignaciones/_components/chat/ChatConversacion";
import { VISTA_SIN_299 } from "@/tests/fixtures/chat-mensaje";

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
  ...VISTA_SIN_299,
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
  latitud: null,
  longitud: null,
  ...VISTA_SIN_299,
  ocurridoAt: "2026-07-23T15:00:00.000Z",
};

const SALIENTE: ChatMensajeVista = {
  id: "m2",
  direccion: "saliente",
  tipo: "texto",
  cuerpo: "En camino, llego en 20 minutos.",
  estado: "delivered",
  latitud: null,
  longitud: null,
  ...VISTA_SIN_299,
  ocurridoAt: "2026-07-23T15:05:00.000Z",
};

const ENTRANTE_2: ChatMensajeVista = {
  ...ENTRANTE,
  id: "m3",
  cuerpo: "¿Ya venís?",
  ocurridoAt: "2026-07-23T15:10:00.000Z",
};

const SALIENTE_2: ChatMensajeVista = {
  ...SALIENTE,
  id: "m4",
  cuerpo: "Sí, a 5 minutos.",
  ocurridoAt: "2026-07-23T15:11:00.000Z",
};

function okHilo(
  ventanaAbierta: boolean,
  mensajes: ChatMensajeVista[],
): ListarHiloChatResult {
  return {
    status: "ok",
    ventanaAbierta,
    ultimoEntranteAt: mensajes.length > 0 ? ENTRANTE.ocurridoAt : null,
    // Estas dos las decide el servidor por DIA (ver `ChatConversacionPlantillaDiaria`); aqui
    // se fijan al escenario "conversacion viva de hoy", que es el que ejercita el tono.
    plantillaBloqueada: false,
    textoLibreHabilitado:
      ventanaAbierta && mensajes.some((m) => m.direccion === "entrante"),
    mensajes,
  };
}

// jsdom no implementa `Element.scrollTo`, y la conversación ancla el hilo abajo en cada
// mensaje nuevo. Sin este stub el efecto lanza y tumba el render antes de llegar al tono.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function scrollToStub() {};
}

function renderChat(ui: ReactElement) {
  return render(
    // Caché propia por test y sin revalidación por foco: el refresco que interesa es el de
    // `refreshInterval` (10 s), que es el que trae el mensaje nuevo.
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

/** Monta la conversación, resuelve el fetch inicial y luego avanza un tick de refresco. */
async function conRefresco(
  inicial: ChatMensajeVista[],
  tras: ChatMensajeVista[],
): Promise<void> {
  listarHiloChatMock
    .mockResolvedValueOnce(okHilo(true, inicial))
    .mockResolvedValue(okHilo(true, tras));

  renderChat(<ChatConversacion orden={ORDEN} onVolver={() => {}} />);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
}

beforeEach(() => {
  listarHiloChatMock.mockReset();
  enviarMensajeChatMock.mockReset();
  enviarPlantillaChatMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockResolvedValue({
    status: "ok",
    items: [],
  });
  reproducirTonoMock.mockReset();
  // SWR solo refresca con el documento visible (`refreshWhenHidden` por defecto = false).
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

describe("ChatConversacion — tono de aviso (feature 161, R21-R24)", () => {
  it("R21: un mensaje entrante nuevo en el refresco suena", async () => {
    await conRefresco([ENTRANTE], [ENTRANTE, ENTRANTE_2]);

    expect(screen.getByText("¿Ya venís?")).toBeInTheDocument();
    expect(reproducirTonoMock).toHaveBeenCalledTimes(1);
  });

  it("R22: un saliente nuevo no suena", async () => {
    await conRefresco([ENTRANTE], [ENTRANTE, SALIENTE_2]);

    expect(screen.getByText("Sí, a 5 minutos.")).toBeInTheDocument();
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R23/R24: abrir el chat sobre un hilo con entrantes previos no suena", async () => {
    await conRefresco([ENTRANTE, SALIENTE], [ENTRANTE, SALIENTE]);

    expect(
      screen.getByText("Hola, ¿cuándo llega mi paquete?"),
    ).toBeInTheDocument();
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R24: la PRIMERA carga del hilo no suena, aunque llegue con varios entrantes", async () => {
    // Ni un solo refresco: solo el fetch inicial. Es el salto "sin dato -> N entrantes" que
    // R24 obliga a ignorar; con `contador` arrancando en 0 en vez de `null`, esto sonaría.
    listarHiloChatMock.mockResolvedValue(okHilo(true, [ENTRANTE, ENTRANTE_2]));

    renderChat(<ChatConversacion orden={ORDEN} onVolver={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("¿Ya venís?")).toBeInTheDocument();
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R13: dos entrantes de golpe suenan una sola vez", async () => {
    await conRefresco([], [ENTRANTE, ENTRANTE_2]);

    expect(reproducirTonoMock).toHaveBeenCalledTimes(1);
  });

  it("sin orden seleccionada no suena y no se pide el hilo", async () => {
    renderChat(<ChatConversacion orden={null} onVolver={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(listarHiloChatMock).not.toHaveBeenCalled();
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });
});
