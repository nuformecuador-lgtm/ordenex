// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act, within } from "@testing-library/react";

// Feature 311 (R30, D4) — las reacciones se pintan ANCLADAS a su mensaje.
//
// Lo que se fija aqui: el chip de emoji vive DENTRO del mismo `<li>` que el mensaje al que
// reacciono el cliente, y el hilo NO gana una burbuja suelta por la reaccion. Un "👍" cinco
// burbujas mas abajo no dice a que reacciono nadie.
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
import { burbuja, okHilo, ORDEN, renderChat } from "./_chat-hilo-harness";

const OBJETIVO = burbuja({
  id: "m1",
  cuerpo: "Ya salí para allá",
  direccion: "saliente",
  estado: "read",
  reacciones: [{ emoji: "👍", conteo: 1 }],
});

const OTRO = burbuja({
  id: "m2",
  cuerpo: "Perfecto, gracias",
  ocurridoAt: "2026-08-27T15:05:00.000Z",
});

async function montar(mensajes = [OBJETIVO, OTRO]): Promise<void> {
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

describe("Reacciones del hilo (R30/D4)", () => {
  it("R30: el chip del emoji esta DENTRO del <li> del mensaje al que reacciono", async () => {
    await montar();

    const burbujas = screen.getAllByRole("listitem");
    const objetivo = burbujas.find((li) => li.textContent?.includes("Ya salí para allá"));
    expect(objetivo).toBeDefined();

    expect(
      within(objetivo as HTMLElement).getByLabelText(/Reaccionó con 👍/),
    ).toBeInTheDocument();
  });

  it("R30: la reaccion NO añade ninguna burbuja al hilo (conteo invariante)", async () => {
    await montar();

    // Dos mensajes en el hilo => DOS `<li>`. La reaccion viaja anclada, no como fila propia:
    // `listarHiloChat` ya la saco de las burbujas (R19).
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("R30: el mensaje SIN reaccion no lleva ningun chip", async () => {
    await montar();

    const sinReaccion = screen
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes("Perfecto, gracias"));

    expect(
      within(sinReaccion as HTMLElement).queryByLabelText(/Reaccionó con/),
    ).toBeNull();
  });

  it("R30: un hilo sin ninguna reaccion no pinta chips", async () => {
    await montar([burbuja({ id: "m9", cuerpo: "Solo texto" })]);

    expect(screen.queryByLabelText(/Reaccionó con/)).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("R30: dos emojis distintos sobre el mismo mensaje se pintan juntos, con su conteo", async () => {
    await montar([
      burbuja({
        id: "m1",
        cuerpo: "Ya salí para allá",
        reacciones: [
          { emoji: "👍", conteo: 2 },
          { emoji: "❤️", conteo: 1 },
        ],
      }),
    ]);

    const [unico] = screen.getAllByRole("listitem");
    expect(within(unico as HTMLElement).getByLabelText(/Reaccionó con 👍/)).toHaveTextContent(
      "2",
    );
    expect(
      within(unico as HTMLElement).getByLabelText(/Reaccionó con ❤️/),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
