// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { NotificationsBell } from "@/components/shared/NotificationsBell";
import {
  limpiarNavegadorPush,
  montarNavegadorPush,
  suscripcionFalsa,
} from "../fixtures/navegador-push";

/**
 * FICHA 410 (tanda 5, T5.3) — EL CONTROL ESTÁ DONDE LA GENTE LO VA A BUSCAR.
 *
 * El panel de la campana es la única superficie que ven los cinco roles en todas las pantallas
 * (vive en `PageHeader`), y es donde llega alguien que ya está mirando sus avisos: el contexto
 * correcto para pedir un permiso que, si se niega, casi no se puede revertir.
 *
 * Este archivo va aparte de `NotificationsBell.test.tsx` a propósito: aquel describe la campana de
 * la 409 y no conoce el canal de push. Aquí se monta el MISMO componente con un navegador que sí
 * puede, que es la única forma de ver el control renderizado dentro del panel.
 */

const { listarMock, obtenerMock, registrarMock, eliminarMock, olvidarMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  obtenerMock: vi.fn(),
  registrarMock: vi.fn(),
  eliminarMock: vi.fn(),
  olvidarMock: vi.fn(),
}));

vi.mock("@/lib/actions/notificaciones", () => ({
  listarNotificaciones: listarMock,
  marcarTodasLeidas: vi.fn(),
  descartarNotificacion: vi.fn(),
  notificarCargaMasivaTerminada: vi.fn(),
}));

// FICHA 422 — `lib/pwa/baja-push.ts` consume tambien la accion que olvida la preferencia, asi
// que el doble del modulo tiene que traerla: sin ella el import se resuelve a `undefined` y el
// fallo sale como «no es una funcion», que no dice nada de lo que este archivo mide.
vi.mock("@/lib/actions/push", () => ({
  obtenerClavePublicaPush: obtenerMock,
  registrarSuscripcionPush: registrarMock,
  eliminarSuscripcionPush: eliminarMock,
  olvidarPreferenciaDeAvisos: olvidarMock,
}));

vi.mock("@/lib/audio/tono-notificacion", () => ({
  reproducirTono: vi.fn(),
  prepararAudio: vi.fn(),
  reiniciarAudioParaTests: vi.fn(),
}));

const CLAVE = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const SIN_ACTIVAR = "Avisarme en este dispositivo";

function renderBell() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NotificationsBell />
    </SWRConfig>,
  );
}

async function abrirPanel() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^Notificaciones/ }));
  await screen.findByText("Marcar todas como leídas");
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({ status: "ok", items: [], noLeidas: 0, porHacer: 0 });
  obtenerMock.mockResolvedValue({ status: "ok", clavePublica: CLAVE });
  registrarMock.mockResolvedValue({ status: "ok" });
  eliminarMock.mockResolvedValue({ status: "ok" });
  olvidarMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  cleanup();
  limpiarNavegadorPush();
  vi.restoreAllMocks();
});

describe("T5.3 — el control de avisos vive DENTRO del panel de la campana", () => {
  it("al abrir el panel, el interruptor está ahí", async () => {
    montarNavegadorPush();

    renderBell();
    await abrirPanel();

    expect(await screen.findByRole("switch", { name: SIN_ACTIVAR })).toBeInTheDocument();
  });

  it("también con el panel vacío: el ajuste no depende de que haya avisos", async () => {
    // El estado vacío de la 409 («No tienes notificaciones») sigue siendo el estado vacío, pero el
    // interruptor no es un aviso: es el ajuste del dispositivo.
    montarNavegadorPush();

    renderBell();
    await abrirPanel();

    expect(screen.getByText("No tienes notificaciones.")).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: SIN_ACTIVAR })).toBeInTheDocument();
  });

  it("con el interruptor ya encendido, el panel lo dice", async () => {
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: suscripcionFalsa() });

    renderBell();
    await abrirPanel();

    expect(
      await screen.findByRole("switch", { name: "Activado en este dispositivo" }),
    ).toBeInTheDocument();
  });

  it("R45: en un navegador sin `PushManager`, en su sitio va la instrucción de instalar", async () => {
    montarNavegadorPush({ conPushManager: false });

    renderBell();
    await abrirPanel();

    expect(
      await screen.findByText("Agrega Ordenex a tu pantalla de inicio"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("R13: sin canal configurado el panel queda EXACTAMENTE como estaba antes de esta ficha", async () => {
    montarNavegadorPush();
    obtenerMock.mockResolvedValue({ status: "ok", clavePublica: null });

    renderBell();
    await abrirPanel();

    await waitFor(() => expect(obtenerMock).toHaveBeenCalled());
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/pantalla de inicio/)).not.toBeInTheDocument();
    // R46: y la campana sigue entera — el push no le quita ni le añade nada a lo que ya hacía.
    expect(screen.getByText("Marcar todas como leídas")).toBeInTheDocument();
    expect(screen.getByText("No tienes notificaciones.")).toBeInTheDocument();
  });

  it("con el panel cerrado no hay control NI lectura de la clave: se paga al abrir", async () => {
    // El popover monta su contenido al abrirse, así que la campana de cada pantalla no le cuesta
    // una petición de más a nadie. Es una propiedad que conviene fijar: si alguien sube el control
    // fuera del `Popover.Portal`, este caso se pone rojo.
    montarNavegadorPush();

    renderBell();
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(obtenerMock).not.toHaveBeenCalled();

    await abrirPanel();
    expect(await screen.findByRole("switch", { name: SIN_ACTIVAR })).toBeInTheDocument();
    expect(obtenerMock).toHaveBeenCalled();
  });
});

describe("R43 — la campana revalida cuando llega un push con la ventana visible", () => {
  it("el mensaje del service worker dispara una lectura nueva del listado", async () => {
    // El contenedor tiene que ser un `EventTarget` de verdad para poder despachar el mensaje.
    const contenedor = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", {
      value: contenedor,
      configurable: true,
      writable: true,
    });
    obtenerMock.mockResolvedValue({ status: "ok", clavePublica: null });

    renderBell();
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));

    // El literal va A MANO: es el contrato con `public/sw.js`, que no puede importar del bundle.
    contenedor.dispatchEvent(
      new MessageEvent("message", {
        data: { tipo: "ordenex:push-recibido", destino: "/cierre-dia" },
      }),
    );

    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(2));
  });

  it("MUTACIÓN: otro mensaje del service worker NO provoca esa lectura", async () => {
    const contenedor = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", {
      value: contenedor,
      configurable: true,
      writable: true,
    });
    obtenerMock.mockResolvedValue({ status: "ok", clavePublica: null });

    renderBell();
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));

    contenedor.dispatchEvent(
      new MessageEvent("message", { data: { tipo: "ordenex:relevo-ahora" } }),
    );

    await new Promise((resolver) => setTimeout(resolver, 50));
    expect(listarMock).toHaveBeenCalledTimes(1);
  });
});
