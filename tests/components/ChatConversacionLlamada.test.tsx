// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type { ListarHiloChatResult } from "@/lib/types/chat-whatsapp";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Pedido humano 2026-08-31 — el icono de LLAMADA en la cabecera de la conversacion.
//
// Lo que se fija aqui es el ENLACE, no el icono: el valor de la accion es que el numero al
// que salta sea el del CLIENTE DE LA ORDEN y que vaya normalizado a E.164 CR. Un test que
// solo comprobara "hay un boton" pasaria con el telefono equivocado, que es justo el fallo
// que importa (se llama a otra persona).
const listarHiloChatMock = vi.fn();
vi.mock("@/lib/actions/chat-whatsapp", () => ({
  listarHiloChat: (...a: unknown[]) => listarHiloChatMock(...a),
  enviarMensajeChat: vi.fn(),
  enviarPlantillaChat: vi.fn(),
  enviarMediaChat: vi.fn(),
}));

vi.mock("@/lib/actions/whatsapp-envio", () => ({
  listarPlantillasActivasParaEnvio: vi
    .fn()
    .mockResolvedValue({ status: "ok", items: [] }),
}));

// Leaflet via `next/dynamic`: irrelevante aqui y jsdom no pinta canvas.
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
  destinatario: "Maria Lopez",
  telefonoDest: "8888-7777",
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
  provinciaNombre: "San Jose",
  cantonNombre: "Central",
  distritoNombre: "Carmen",
  secuenciaRuta: 1,
};

const HILO_VACIO: ListarHiloChatResult = {
  status: "ok",
  ventanaAbierta: false,
  ultimoEntranteAt: null,
  plantillaBloqueada: false,
  textoLibreHabilitado: false,
  mensajes: [],
};

if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function scrollToStub() {};
}

async function montar(orden: MiAsignacionDTO): Promise<void> {
  listarHiloChatMock.mockResolvedValue(HILO_VACIO);
  render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        revalidateOnFocus: false,
      }}
    >
      <ToastProvider>
        <ChatConversacion orden={orden} onVolver={() => {}} />
      </ToastProvider>
    </SWRConfig>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  listarHiloChatMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ChatConversacion - icono de llamada", () => {
  it("abre WhatsApp hacia el telefono del cliente, normalizado con el prefijo 506", async () => {
    await montar(ORDEN);

    const enlace = screen.getByRole("link", {
      name: "Llamar por WhatsApp a Maria Lopez",
    });
    // Los separadores del crudo (`8888-7777`) desaparecen y entra el codigo de pais.
    expect(enlace).toHaveAttribute("href", "https://wa.me/50688887777");
    expect(enlace).toHaveAttribute("target", "_blank");
    expect(enlace).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("respeta un prefijo internacional ajeno, sin inventar `506`", async () => {
    await montar({ ...ORDEN, telefonoDest: "+1 305 555 0101" });

    expect(
      screen.getByRole("link", { name: "Llamar por WhatsApp a Maria Lopez" }),
    ).toHaveAttribute("href", "https://wa.me/13055550101");
  });

  it("sin telefono en la orden no pinta el enlace", async () => {
    await montar({ ...ORDEN, telefonoDest: "   " });

    expect(
      screen.queryByRole("link", { name: /Llamar por WhatsApp/ }),
    ).not.toBeInTheDocument();
  });
});
