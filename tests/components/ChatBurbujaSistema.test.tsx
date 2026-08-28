// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act } from "@testing-library/react";

// Feature 311 (R32, D3) — el cliente cambio su numero de WhatsApp.
//
// Lo que se fija aqui: la evidencia se ve, cita AMBOS numeros, y la fila NO es entrante ni
// saliente (no la escribio ninguno de los dos). Sin ella el mensajero veria el hilo continuar
// con otro numero sin explicacion.
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
import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import { burbuja, okHilo, ORDEN, renderChat } from "./_chat-hilo-harness";

const ANTERIOR = "50688887777";
const NUEVO = "50699996666";

const CAMBIO_NUMERO = burbuja({
  id: "m-sistema",
  tipo: "sistema",
  cuerpo: null,
  sistema: { telefonoAnterior: ANTERIOR, telefonoNuevo: NUEVO },
  ocurridoAt: "2026-08-27T15:02:00.000Z",
});

async function montar(mensajes: ChatMensajeVista[]): Promise<void> {
  listarHiloChatMock.mockResolvedValue(okHilo(mensajes));
  renderChat(<ChatConversacion orden={ORDEN} onVolver={() => {}} />);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  listarHiloChatMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockReset();
  listarPlantillasActivasParaEnvioMock.mockResolvedValue({ status: "ok", items: [] });
});

afterEach(cleanup);

describe("Burbuja de sistema — cambio de numero (R32)", () => {
  it("R32: cita el numero ANTERIOR y el NUEVO", async () => {
    await montar([CAMBIO_NUMERO]);

    const [fila] = screen.getAllByRole("listitem");
    expect(fila?.textContent).toContain(ANTERIOR);
    expect(fila?.textContent).toContain(NUEVO);
    expect(fila?.textContent).toMatch(/cambió su número/i);
  });

  it("R32/R16: junto a los dos numeros, avisa de que el numero nuevo no llega a esta orden", async () => {
    await montar([CAMBIO_NUMERO]);

    // La evidencia sola sugiere una continuidad que NO existe: un entrante se resuelve por
    // `orden.telefono_dest`, no por el telefono del hilo, asi que lo que mande el cliente desde
    // el numero NUEVO se cuenta `sinResolver` y nadie lo ve (ver LIMITACION CONOCIDA de R16).
    // Sin esta linea el mensajero espera respuestas que nunca van a aparecer.
    const [fila] = screen.getAllByRole("listitem");
    const texto = fila?.textContent ?? "";
    expect(texto).toContain(ANTERIOR);
    expect(texto).toContain(NUEVO);
    expect(texto).toContain("Sus mensajes desde el número nuevo no llegarán a esta orden.");
  });

  it("R32/R16: el aviso sigue ahi aunque falte un numero", async () => {
    await montar([
      burbuja({
        id: "m-sistema-parcial-aviso",
        tipo: "sistema",
        cuerpo: null,
        sistema: { telefonoAnterior: ANTERIOR, telefonoNuevo: null },
      }),
    ]);

    const [fila] = screen.getAllByRole("listitem");
    const texto = fila?.textContent ?? "";
    expect(texto).toMatch(/número desconocido/i);
    expect(texto).toContain("Sus mensajes desde el número nuevo no llegarán a esta orden.");
  });

  it("R32: la fila NO es entrante ni saliente (sin data-direccion)", async () => {
    await montar([CAMBIO_NUMERO]);

    const [fila] = screen.getAllByRole("listitem");
    expect(fila?.getAttribute("data-direccion")).toBeNull();
    expect(fila?.getAttribute("data-sistema")).toBe("cambio-numero");
  });

  it("R32: convive con las burbujas normales, que SI llevan su direccion", async () => {
    await montar([
      burbuja({ id: "m1", cuerpo: "Hola" }),
      CAMBIO_NUMERO,
      burbuja({ id: "m2", cuerpo: "Ya te escribo del nuevo", direccion: "entrante" }),
    ]);

    const filas = screen.getAllByRole("listitem");
    expect(filas).toHaveLength(3);
    expect(filas.filter((li) => li.getAttribute("data-direccion") !== null)).toHaveLength(2);
  });

  it("R32: si falta un numero se dice, no se inventa ni se deja la fila vacia", async () => {
    await montar([
      burbuja({
        id: "m-sistema-parcial",
        tipo: "sistema",
        cuerpo: null,
        sistema: { telefonoAnterior: null, telefonoNuevo: NUEVO },
      }),
    ]);

    const [fila] = screen.getAllByRole("listitem");
    expect(fila?.textContent).toContain(NUEVO);
    expect(fila?.textContent).toMatch(/número desconocido/i);
  });
});
