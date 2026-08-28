// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

// Los dobles de las acciones de ESCRITURA del chat. Si el histórico llamara a cualquiera de
// ellas —aunque fuera por un import de paso— estos espías lo delatarían.
const enviarMensajeChatDoble = vi.fn();
const enviarPlantillaChatDoble = vi.fn();
const enviarMediaChatDoble = vi.fn();
const listarHiloChatDoble = vi.fn();

vi.mock("@/lib/actions/chat-whatsapp", () => ({
  enviarMensajeChat: (...a: unknown[]) => enviarMensajeChatDoble(...a),
  enviarPlantillaChat: (...a: unknown[]) => enviarPlantillaChatDoble(...a),
  enviarMediaChat: (...a: unknown[]) => enviarMediaChatDoble(...a),
  listarHiloChat: (...a: unknown[]) => listarHiloChatDoble(...a),
}));

import { HistoricoConversacionesModule } from "@/app/(app)/historico/conversaciones/_components/HistoricoConversacionesModule";

import {
  AHORA,
  HOY_ISO,
  hilo,
  instalarObservador,
  mensaje,
  okHilos,
  okMensajes,
  renderHistorico,
} from "./_historico-harness";

// Feature 321 / T6.5 (R24/R25) — el histórico es SOLO LECTURA.
//
// No es una promesa de un comentario: se afirma por ARIA. Con el hilo cargado y sus mensajes en
// pantalla, no existe campo de redacción, ni botón de enviar, ni de adjuntar, ni grupo de
// plantillas. Y tras interactuar con el hilo, ninguna de las cuatro acciones del chat del
// mensajero ha sido llamada — ni siquiera `listarHiloChat`, que es de lectura pero es la del
// OTRO camino: el histórico tiene el suyo, con su propia autorización (design §2.5).
//
// R25 (no escribir en la base) tiene además su prueba en el service (T3.6), con un doble de
// Prisma que LANZA ante cualquier `update`/`create`/`upsert`/`delete`. Esto es su mitad de
// pantalla: no hay ningún control que pueda producir un mensaje.

const listarHilos = vi.fn(async () => okHilos([hilo()]));
const listarMensajes = vi.fn(async () =>
  okMensajes([
    mensaje({ id: "e1", direccion: "entrante", cuerpo: "Hola", ocurridoAt: HOY_ISO }),
    mensaje({ id: "s1", direccion: "saliente", cuerpo: "Voy en camino", ocurridoAt: HOY_ISO }),
  ]),
);

beforeEach(() => {
  instalarObservador();
  enviarMensajeChatDoble.mockClear();
  enviarPlantillaChatDoble.mockClear();
  enviarMediaChatDoble.mockClear();
  listarHiloChatDoble.mockClear();
  listarHilos.mockClear();
  listarMensajes.mockClear();
});

afterEach(cleanup);

function renderPantalla() {
  return renderHistorico(
    <HistoricoConversacionesModule
      mensajeros={[]}
      acciones={{ listarHilos, listarMensajes }}
      ahora={AHORA}
    />,
  );
}

/** Abre el hilo y espera a sus mensajes: sin ellos, «no hay botón de enviar» no prueba nada. */
async function abrirHilo() {
  fireEvent.click(await screen.findByRole("button", { name: /María González/ }));
  return screen.findByRole("list", { name: "Historial de mensajes" });
}

describe("T6.5 — sin controles de escritura (R24)", () => {
  it("con el hilo cargado no hay campo de redacción", async () => {
    renderPantalla();
    const lista = await abrirHilo();

    expect(screen.getByText("Voy en camino")).toBeInTheDocument();
    // El buscador de la barra es `role="searchbox"`, no `textbox`: aquí no queda ni un campo
    // de escritura libre.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(lista.querySelector("textarea")).toBeNull();
  });

  it("no hay botón de enviar", async () => {
    renderPantalla();
    await abrirHilo();

    expect(screen.queryByRole("button", { name: /enviar/i })).toBeNull();
  });

  it("no hay botón de adjuntar", async () => {
    renderPantalla();
    await abrirHilo();

    expect(screen.queryByRole("button", { name: /adjuntar/i })).toBeNull();
  });

  it("no hay grupo de plantillas", async () => {
    renderPantalla();
    await abrirHilo();

    expect(screen.queryByRole("group", { name: /plantillas/i })).toBeNull();
  });

  // Reaccionar es escribir. Las reacciones se LEEN (R28) y no se ofrecen como acción.
  it("no hay forma de reaccionar a un mensaje", async () => {
    renderPantalla();
    await abrirHilo();

    expect(screen.queryByRole("button", { name: /reaccion/i })).toBeNull();
  });

  it("la pantalla no monta ningún formulario", async () => {
    const { container } = renderPantalla();
    await abrirHilo();

    expect(container.querySelector("form")).toBeNull();
  });
});

describe("T6.5 — ninguna acción de escritura del chat se llega a llamar (R25)", () => {
  it("tras abrir y recorrer el hilo, los cuatro dobles siguen sin llamarse", async () => {
    renderPantalla();
    const lista = await abrirHilo();

    // Interacción real con el hilo: clic en una burbuja y en la fila del listado.
    fireEvent.click(lista);
    fireEvent.click(await screen.findByRole("button", { name: /María González/ }));

    expect(enviarMensajeChatDoble).not.toHaveBeenCalled();
    expect(enviarPlantillaChatDoble).not.toHaveBeenCalled();
    expect(enviarMediaChatDoble).not.toHaveBeenCalled();
    // El histórico lee por SU camino, con su propia autorización: no reutiliza el del mensajero.
    expect(listarHiloChatDoble).not.toHaveBeenCalled();
    expect(listarMensajes).toHaveBeenCalled();
  });
});
