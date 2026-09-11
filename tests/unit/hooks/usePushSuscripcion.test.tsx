// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { usePushSuscripcion } from "@/hooks/usePushSuscripcion";
import {
  ENDPOINT_FALSO,
  limpiarNavegadorPush,
  montarNavegadorPush,
  suscripcionFalsa,
} from "../../fixtures/navegador-push";

/**
 * FICHA 410 (tanda 5, T5.1) — EL ESTADO DEL CANAL EN ESTE DISPOSITIVO.
 *
 * Cubre R10 (jamás al montar), R11 (solo tras el gesto), R12 (denegado no se vuelve a pedir),
 * R13 (sin canal o sin soporte no hay control), R14 (los tres estados) y R15 (desactivar llama a
 * las dos mitades).
 *
 * ⚠️ EL CASO QUE MÁS FÁCIL SE COLA EN VERDE ES EL DE «SIN CANAL»: un escenario vacío lo pasa sin
 * haber comprobado nada. Por eso cada caso negativo va con su control positivo al lado — el mismo
 * escenario, con canal, tiene que dar OTRA cosa.
 */

const { obtenerMock, registrarMock, eliminarMock } = vi.hoisted(() => ({
  obtenerMock: vi.fn(),
  registrarMock: vi.fn(),
  eliminarMock: vi.fn(),
}));

vi.mock("@/lib/actions/push", () => ({
  obtenerClavePublicaPush: obtenerMock,
  registrarSuscripcionPush: registrarMock,
  eliminarSuscripcionPush: eliminarMock,
}));

/** Una clave pública base64url cualquiera; lo que importa es que NO sea `null`. */
const CLAVE = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

function Sonda() {
  const { estado, ocupado, activar, desactivar } = usePushSuscripcion();
  return (
    <div>
      <span data-testid="estado">{estado}</span>
      <span data-testid="ocupado">{String(ocupado)}</span>
      <button type="button" onClick={() => void activar()}>
        activar
      </button>
      <button type="button" onClick={() => void desactivar()}>
        desactivar
      </button>
    </div>
  );
}

function montar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Sonda />
    </SWRConfig>,
  );
}

async function esperarEstado(esperado: string) {
  await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent(esperado));
}

beforeEach(() => {
  vi.clearAllMocks();
  obtenerMock.mockResolvedValue({ status: "ok", clavePublica: CLAVE });
  registrarMock.mockResolvedValue({ status: "ok" });
  eliminarMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  cleanup();
  limpiarNavegadorPush();
  vi.restoreAllMocks();
});

describe("R10 — el permiso NO se pide al cargar, y esto es lo más importante del hook", () => {
  it("al montar con TODO a favor, `requestPermission` NO se ha llamado ni una vez", async () => {
    const { pedirPermiso } = montarNavegadorPush();

    montar();
    // Se espera al estado final para que no sea un «aún no ha dado tiempo»: el hook ya terminó de
    // resolver soporte, clave y suscripción, y aun así no pidió nada.
    await esperarEstado("sin-activar");

    expect(pedirPermiso).not.toHaveBeenCalled();
  });

  it("leer el permiso ya concedido tampoco lo pide: se lee, no se pregunta", async () => {
    const { pedirPermiso } = montarNavegadorPush({ permiso: "granted" });

    montar();
    await esperarEstado("sin-activar");

    expect(pedirPermiso).not.toHaveBeenCalled();
  });
});

describe("R11 — el permiso sale del gesto de la persona, y de ningún otro sitio", () => {
  it("al activar: pide permiso, se suscribe con la clave pública y registra en el servidor", async () => {
    const { pedirPermiso, subscribe } = montarNavegadorPush();
    const user = userEvent.setup();

    montar();
    await esperarEstado("sin-activar");
    await user.click(screen.getByRole("button", { name: "activar" }));

    await waitFor(() => expect(pedirPermiso).toHaveBeenCalledTimes(1));
    expect(subscribe).toHaveBeenCalledTimes(1);
    // `userVisibleOnly: true` es obligatorio en Chrome: sin él, `subscribe` rechaza.
    const opciones = subscribe.mock.calls[0]?.[0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(opciones.userVisibleOnly).toBe(true);
    expect(opciones.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(opciones.applicationServerKey.length).toBeGreaterThan(0);

    await esperarEstado("activado");
  });

  it("R50 (mitad de cliente): lo que se registra son las TRES piezas y la etiqueta, sin usuario", async () => {
    montarNavegadorPush();
    const user = userEvent.setup();

    montar();
    await esperarEstado("sin-activar");
    await user.click(screen.getByRole("button", { name: "activar" }));

    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    // Los nombres se afirman A MANO: son el contrato con el schema `strict()` del servidor, que
    // rechaza cualquier campo de más — incluido un `usuarioId` inyectado.
    expect(registrarMock).toHaveBeenCalledWith({
      endpoint: ENDPOINT_FALSO,
      p256dh: "PPP",
      auth: "AAA",
      etiqueta: "Chrome en Android",
    });
    expect(Object.keys(registrarMock.mock.calls[0][0]).sort()).toEqual([
      "auth",
      "endpoint",
      "etiqueta",
      "p256dh",
    ]);
  });

  it("si la persona dice que NO en el diálogo del navegador, queda bloqueado y no se suscribe", async () => {
    const { subscribe } = montarNavegadorPush({ respuestaAlPedir: "denied" });
    const user = userEvent.setup();

    montar();
    await esperarEstado("sin-activar");
    await user.click(screen.getByRole("button", { name: "activar" }));

    await esperarEstado("bloqueado");
    expect(subscribe).not.toHaveBeenCalled();
    expect(registrarMock).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza el registro, la suscripción del navegador se DESHACE", async () => {
    const suscripcion = suscripcionFalsa();
    montarNavegadorPush({ suscripcionNueva: suscripcion });
    registrarMock.mockResolvedValue({ status: "validation_error" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();

    montar();
    await esperarEstado("sin-activar");
    await user.click(screen.getByRole("button", { name: "activar" }));

    // Un dispositivo suscrito que el servidor no conoce cree que va a recibir avisos y no los
    // recibe nunca: es el fallo mudo que esta ficha existe para cerrar.
    await waitFor(() => expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1));
    await esperarEstado("sin-activar");
  });
});

describe("R12 — «denegado» no se vuelve a pedir", () => {
  it("al montar con el permiso denegado el estado es «bloqueado»", async () => {
    montarNavegadorPush({ permiso: "denied" });

    montar();

    await esperarEstado("bloqueado");
  });

  it("y pulsar activar en ese estado NO llama a `requestPermission`", async () => {
    const { pedirPermiso, subscribe } = montarNavegadorPush({ permiso: "denied" });
    const user = userEvent.setup();

    montar();
    await esperarEstado("bloqueado");
    await user.click(screen.getByRole("button", { name: "activar" }));

    expect(pedirPermiso).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    await esperarEstado("bloqueado");
  });
});

describe("R13 — sin canal o sin soporte, no hay control que ofrecer", () => {
  it("`clavePublica: null` NO es un error: es el estado «sin canal»", async () => {
    montarNavegadorPush();
    obtenerMock.mockResolvedValue({ status: "ok", clavePublica: null });

    montar();

    await esperarEstado("sin-canal");
  });

  it("una lectura FALLIDA de la clave cae también hacia «sin canal», nunca hacia «hay canal»", async () => {
    montarNavegadorPush();
    obtenerMock.mockResolvedValue({ status: "unauthenticated" });

    montar();

    await esperarEstado("sin-canal");
  });

  it("sin `PushManager` (iPhone sin instalar) el estado es «no soportado», NO «sin canal»", async () => {
    // El control positivo del caso de arriba: MISMO navegador sin PushManager pero CON canal da
    // otra cosa. Es lo que impide que un escenario vacío pase por bueno.
    montarNavegadorPush({ conPushManager: false });

    montar();

    await esperarEstado("no-soportado");
  });

  it("sin `PushManager` Y sin canal manda el canal: no se manda a nadie a instalar en balde", async () => {
    montarNavegadorPush({ conPushManager: false });
    obtenerMock.mockResolvedValue({ status: "ok", clavePublica: null });

    montar();

    await esperarEstado("sin-canal");
  });
});

describe("R14 — el control dice el estado de ESTE dispositivo", () => {
  it("con una suscripción ya viva aquí, el estado es «activado»", async () => {
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: suscripcionFalsa() });

    montar();

    await esperarEstado("activado");
  });

  it("sin suscripción aquí, «sin activar» — y la campana no se entera de nada (R46)", async () => {
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: null });

    montar();

    await esperarEstado("sin-activar");
    // R46: el hook no toca ni pide nada de la campana. Su única lectura de servidor es la clave.
    expect(registrarMock).not.toHaveBeenCalled();
    expect(eliminarMock).not.toHaveBeenCalled();
  });
});

describe("R15 — desactivar es DOS cosas: el servidor y el navegador", () => {
  it("llama a `unsubscribe()` Y a la acción de borrado, y el dispositivo queda sin activar", async () => {
    const suscripcion = suscripcionFalsa();
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: suscripcion });
    const user = userEvent.setup();

    montar();
    await esperarEstado("activado");
    await user.click(screen.getByRole("button", { name: "desactivar" }));

    await waitFor(() => expect(eliminarMock).toHaveBeenCalledWith({ endpoint: ENDPOINT_FALSO }));
    expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
    await esperarEstado("sin-activar");
  });

  it("si la baja falla en el servidor, el control no se queda mintiendo «activado»", async () => {
    const suscripcion = suscripcionFalsa();
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: suscripcion });
    eliminarMock.mockRejectedValue(new Error("sin red"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();

    montar();
    await esperarEstado("activado");
    await user.click(screen.getByRole("button", { name: "desactivar" }));

    // La baja en el navegador sí se hizo, así que este dispositivo ya no recibe: decir «activado»
    // sería la mentira contraria.
    await waitFor(() => expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1));
    await esperarEstado("sin-activar");
  });
});
