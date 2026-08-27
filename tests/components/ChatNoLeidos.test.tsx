// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Indicador de mensajes SIN LEER del chat del mensajero.
//
// Lo que se fija aquí: el botón flotante lleva la SUMA de entrantes pendientes, cada
// conversación lleva SU número, y la que está abierta delante del mensajero no cuenta (verla
// es leerla → se sella en el servidor). El tono suena con el chat cerrado, que era el hueco
// que dejó la 161 al quedarse el aviso solo dentro del hilo abierto.
//
// Se mockean las Server Actions del chat: la UI se ejercita sin DB ni sesión.
const resumenNoLeidosChatMock = vi.fn();
const marcarChatLeidoMock = vi.fn();
const listarHiloChatMock = vi.fn();
vi.mock("@/lib/actions/chat-whatsapp", () => ({
  resumenNoLeidosChat: (...a: unknown[]) => resumenNoLeidosChatMock(...a),
  marcarChatLeido: (...a: unknown[]) => marcarChatLeidoMock(...a),
  listarHiloChat: (...a: unknown[]) => listarHiloChatMock(...a),
  enviarMensajeChat: vi.fn(),
  enviarPlantillaChat: vi.fn(),
}));

const listarPlantillasActivasParaEnvioMock = vi.fn();
vi.mock("@/lib/actions/whatsapp-envio", () => ({
  listarPlantillasActivasParaEnvio: (...a: unknown[]) =>
    listarPlantillasActivasParaEnvioMock(...a),
}));

// jsdom no tiene Web Audio API: se espía el generador del tono. Aquí importa CUÁNDO se pide,
// no cómo suena (eso es `tono-notificacion.test.ts`).
const reproducirTonoMock = vi.fn();
vi.mock("@/lib/audio/tono-notificacion", () => ({
  reproducirTono: (...a: unknown[]) => reproducirTonoMock(...a),
  prepararAudio: vi.fn(),
  reiniciarAudioParaTests: vi.fn(),
}));

// El minimapa de ubicación arrastra Leaflet vía `next/dynamic`; irrelevante para el conteo.
vi.mock("@/app/(app)/mis-asignaciones/_components/UbicacionMapa", () => ({
  UbicacionMapa: () => null,
}));

import { ChatFlotante } from "@/app/(app)/mis-asignaciones/_components/chat/ChatFlotante";

function orden(id: string, destinatario: string, remision: string): MiAsignacionDTO {
  return {
    id,
    numGuia: 12345,
    numRemision: remision,
    estatusValue: "en_reparto",
    destinatario,
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
}

const ORDENES = [
  orden("orden-1", "María López", "R-001"),
  orden("orden-2", "Juan Pérez", "R-002"),
];

const HILO_VACIO = {
  status: "ok" as const,
  ventanaAbierta: false,
  ultimoEntranteAt: null,
  mensajes: [],
};

// jsdom no implementa `Element.scrollTo` y la conversación ancla el hilo abajo al montar.
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

/** Monta el chat y resuelve el primer fetch del resumen. */
async function montar(abierto: boolean, ordenEnDetalleId: string | null = null) {
  const r = renderChat(
    <ChatFlotante
      ordenes={ORDENES}
      ordenEnDetalleId={ordenEnDetalleId}
      abierto={abierto}
      onAbiertoChange={() => {}}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  resumenNoLeidosChatMock.mockReset();
  marcarChatLeidoMock.mockReset();
  marcarChatLeidoMock.mockResolvedValue({ status: "ok" });
  listarHiloChatMock.mockReset();
  listarHiloChatMock.mockResolvedValue(HILO_VACIO);
  listarPlantillasActivasParaEnvioMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockResolvedValue({ status: "ok", items: [] });
  reproducirTonoMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("distintivo del botón flotante", () => {
  it("sin pendientes no pinta distintivo", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({ status: "ok", conversaciones: [] });
    await montar(false);

    expect(screen.queryByTestId("chat-no-leidos-total")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Abrir chat con clientes" }),
    ).toBeInTheDocument();
  });

  it("suma los pendientes de todas las conversaciones", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({
      status: "ok",
      conversaciones: [
        { ordenId: "orden-1", noLeidos: 2 },
        { ordenId: "orden-2", noLeidos: 3 },
      ],
    });
    await montar(false);

    expect(screen.getByTestId("chat-no-leidos-total")).toHaveTextContent("5");
    // La cifra no puede vivir solo en el color: va también en el nombre accesible.
    expect(
      screen.getByRole("button", { name: "Abrir chat con clientes, 5 sin leer" }),
    ).toBeInTheDocument();
  });

  it("topa el distintivo en +9 (el ancho de la burbuja es fijo)", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({
      status: "ok",
      conversaciones: [{ ordenId: "orden-1", noLeidos: 27 }],
    });
    await montar(false);

    expect(screen.getByTestId("chat-no-leidos-total")).toHaveTextContent("+9");
    // El nombre accesible sí da la cifra exacta: ahí no hay límite de ancho.
    expect(
      screen.getByRole("button", { name: "Abrir chat con clientes, 27 sin leer" }),
    ).toBeInTheDocument();
  });

  it("ignora pendientes de órdenes que ya NO están en reparto (no habría fila que abrir)", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({
      status: "ok",
      conversaciones: [
        { ordenId: "orden-1", noLeidos: 1 },
        { ordenId: "orden-entregada", noLeidos: 4 }, // fuera de la lista del chat
      ],
    });
    await montar(false);

    expect(screen.getByTestId("chat-no-leidos-total")).toHaveTextContent("1");
  });

  it("una lectura fallida no pinta un cero falso ni rompe el botón", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({ status: "unauthenticated" });
    await montar(false);

    expect(screen.queryByTestId("chat-no-leidos-total")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Abrir chat con clientes" }),
    ).toBeInTheDocument();
  });
});

describe("distintivo por conversación", () => {
  it("pinta el número de CADA conversación en su fila", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({
      status: "ok",
      conversaciones: [{ ordenId: "orden-2", noLeidos: 3 }],
    });
    // Con el chat abierto por `orden-1`: la otra conversación luce su pendiente.
    await montar(true, "orden-1");

    expect(screen.getByTestId("chat-no-leidos-orden-2")).toHaveTextContent("3");
    expect(screen.getByText("3 mensajes sin leer")).toBeInTheDocument();
  });

  it("la conversación ABIERTA no lleva distintivo: tenerla delante es leerla", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({
      status: "ok",
      conversaciones: [
        { ordenId: "orden-1", noLeidos: 2 },
        { ordenId: "orden-2", noLeidos: 1 },
      ],
    });
    await montar(true, "orden-1");

    expect(screen.queryByTestId("chat-no-leidos-orden-1")).toBeNull();
    expect(screen.getByTestId("chat-no-leidos-orden-2")).toHaveTextContent("1");
    // El total del botón tampoco la cuenta.
    expect(screen.getByTestId("chat-no-leidos-total")).toHaveTextContent("1");
  });

  it("sella en el servidor la conversación abierta y revalida el resumen", async () => {
    resumenNoLeidosChatMock
      .mockResolvedValueOnce({
        status: "ok",
        conversaciones: [{ ordenId: "orden-1", noLeidos: 2 }],
      })
      .mockResolvedValue({ status: "ok", conversaciones: [] });

    await montar(true, "orden-1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(marcarChatLeidoMock).toHaveBeenCalledWith("orden-1");
    expect(screen.queryByTestId("chat-no-leidos-total")).toBeNull();
  });

  it("con el chat CERRADO no sella nada, aunque haya una selección previa", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({
      status: "ok",
      conversaciones: [{ ordenId: "orden-1", noLeidos: 2 }],
    });
    await montar(false, "orden-1");

    expect(marcarChatLeidoMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-no-leidos-total")).toHaveTextContent("2");
  });
});

describe("tono con el chat cerrado", () => {
  it("la primera carga NO suena, por muchos pendientes que traiga", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({
      status: "ok",
      conversaciones: [{ ordenId: "orden-1", noLeidos: 4 }],
    });
    await montar(false);

    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("suena cuando el sondeo trae un entrante nuevo con el chat cerrado", async () => {
    resumenNoLeidosChatMock
      .mockResolvedValueOnce({
        status: "ok",
        conversaciones: [{ ordenId: "orden-1", noLeidos: 1 }],
      })
      .mockResolvedValue({
        status: "ok",
        conversaciones: [{ ordenId: "orden-1", noLeidos: 2 }],
      });

    await montar(false);
    expect(reproducirTonoMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(reproducirTonoMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("chat-no-leidos-total")).toHaveTextContent("2");
  });

  it("un salto de varios pendientes suena UNA vez, no una por mensaje", async () => {
    resumenNoLeidosChatMock
      .mockResolvedValueOnce({
        status: "ok",
        conversaciones: [{ ordenId: "orden-1", noLeidos: 1 }],
      })
      .mockResolvedValue({
        status: "ok",
        conversaciones: [
          { ordenId: "orden-1", noLeidos: 3 },
          { ordenId: "orden-2", noLeidos: 2 },
        ],
      });

    await montar(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(reproducirTonoMock).toHaveBeenCalledTimes(1);
  });

  it("que BAJE el contador no suena (leer una conversación no es un aviso)", async () => {
    resumenNoLeidosChatMock
      .mockResolvedValueOnce({
        status: "ok",
        conversaciones: [{ ordenId: "orden-1", noLeidos: 3 }],
      })
      .mockResolvedValue({ status: "ok", conversaciones: [] });

    await montar(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("con el sonido silenciado no suena, pero el distintivo sigue subiendo", async () => {
    window.localStorage.setItem("ordenex:sonido-notificaciones", "off");
    resumenNoLeidosChatMock
      .mockResolvedValueOnce({
        status: "ok",
        conversaciones: [{ ordenId: "orden-1", noLeidos: 1 }],
      })
      .mockResolvedValue({
        status: "ok",
        conversaciones: [{ ordenId: "orden-1", noLeidos: 2 }],
      });

    await montar(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(reproducirTonoMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-no-leidos-total")).toHaveTextContent("2");
  });
});
