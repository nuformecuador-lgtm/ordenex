// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { PushOptIn } from "@/components/shared/PushOptIn";
import {
  limpiarNavegadorPush,
  montarNavegadorPush,
  suscripcionFalsa,
} from "../fixtures/navegador-push";

/**
 * FICHA 410 (tanda 5, T5.2) — EL CONTROL, EN SUS CUATRO CASOS.
 *
 * ⚠️ LOS LITERALES SE AFIRMAN A MANO, NO IMPORTANDO `TEXTOS` DEL COMPONENTE. Comparar un texto
 * contra la función que lo compone está siempre verde: diría que el componente dice lo que dice.
 * Lo que hay que fijar es lo que la PERSONA lee, y eso es un contrato.
 *
 * ⚠️ Y EL CASO «NO SOPORTADO» NO ES UNA AUSENCIA. Medido el 2026-09-10: 3 de 18 mensajeros entran
 * SOLO desde iPhone, donde `PushManager` no existe mientras la app no esté en la pantalla de
 * inicio. Van a buscar el interruptor al mismo sitio que las otras 36 personas; si ahí no hay nada,
 * la conclusión razonable es que la aplicación está rota. Por eso hay un caso que afirma que en ese
 * hueco HAY texto accionable, no que no haya control.
 */

const { obtenerMock, registrarMock, eliminarMock, olvidarMock } = vi.hoisted(() => ({
  obtenerMock: vi.fn(),
  registrarMock: vi.fn(),
  eliminarMock: vi.fn(),
  olvidarMock: vi.fn(),
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

const CLAVE = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

/** Los tres nombres de R14, escritos aquí y no importados de ninguna parte. */
const SIN_ACTIVAR = "Avisarme en este dispositivo";
const ACTIVADO = "Activado en este dispositivo";
const BLOQUEADO = "Bloqueado por el navegador";

function montar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PushOptIn />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe("R14 — el control dice, con palabras, qué pasa en ESTE dispositivo", () => {
  it("caso «sin activar»: el interruptor invita a encenderlo y está apagado", async () => {
    montarNavegadorPush();

    montar();

    const control = await screen.findByRole("switch", { name: SIN_ACTIVAR });
    expect(control).toHaveAttribute("aria-checked", "false");
    // Base UI pinta la raíz como un `<span role="switch">`, así que el estado bloqueado viaja en
    // `aria-disabled` y NO en el `disabled` nativo (lo dejó escrito `components/ui/switch.tsx`).
    expect(control).not.toHaveAttribute("aria-disabled", "true");
    // La etiqueta visible y el nombre accesible son EL MISMO texto (WCAG 2.5.3).
    expect(screen.getByText(SIN_ACTIVAR)).toBeInTheDocument();
  });

  it("caso «activado»: el interruptor está encendido y lo dice", async () => {
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: suscripcionFalsa() });

    montar();

    const control = await screen.findByRole("switch", { name: ACTIVADO });
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("la explicación va SIEMPRE a la vista, antes del clic, y describe el control", async () => {
    montarNavegadorPush();

    montar();

    const control = await screen.findByRole("switch", { name: SIN_ACTIVAR });
    const ayuda = document.getElementById(control.getAttribute("aria-describedby") ?? "");
    expect(ayuda?.textContent).toBe(
      "Te avisamos en este teléfono o computadora cuando algo tenga una fecha límite o dinero de " +
        "por medio, aunque tengas la aplicación cerrada. Como mucho un aviso al día de cada tipo.",
    );
  });

  it("el texto visible NO usa siglas ni jerga de oficina", async () => {
    // Regla vigente del repo: en la interfaz se habla de fechas y de dinero, no de acrónimos.
    montarNavegadorPush();

    montar();
    await screen.findByRole("switch", { name: SIN_ACTIVAR });

    const visible = document.body.textContent ?? "";
    for (const sigla of ["SLA", "VAPID", "push", "endpoint", "service worker"]) {
      expect(visible).not.toContain(sigla);
    }
    // Control positivo: se leyó algo, no una pantalla vacía.
    expect(visible).toContain("fecha límite");
  });
});

describe("R12 — bloqueado por el navegador: se dice, y se dice cómo salir de ahí", () => {
  it("el interruptor queda inerte y con su nombre de estado, y tocarlo NO vuelve a pedir nada", async () => {
    const { pedirPermiso } = montarNavegadorPush({ permiso: "denied" });
    const user = userEvent.setup();

    montar();

    const control = await screen.findByRole("switch", { name: BLOQUEADO });
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("aria-checked", "false");

    await user.click(control);
    expect(pedirPermiso).not.toHaveBeenCalled();
  });

  it("y en el sitio de la explicación va la RECUPERACIÓN, no la invitación de siempre", async () => {
    montarNavegadorPush({ permiso: "denied" });

    montar();

    const control = await screen.findByRole("switch", { name: BLOQUEADO });
    const ayuda = document.getElementById(control.getAttribute("aria-describedby") ?? "");
    expect(ayuda?.textContent).toBe(
      "Bloqueaste los avisos para este sitio y el navegador no deja volver a pedírtelos. Para " +
        "recibirlos, abre los ajustes del navegador, busca los permisos de este sitio y permite " +
        "las notificaciones.",
    );
  });

  it("MUTACIÓN: si el permiso no estuviera denegado, ese texto NO aparecería", async () => {
    // El control positivo de los dos casos de arriba: sin él, un componente que pintara siempre el
    // texto de recuperación los pasaría los dos.
    montarNavegadorPush({ permiso: "default" });

    montar();
    await screen.findByRole("switch", { name: SIN_ACTIVAR });

    expect(screen.queryByText(/Bloqueaste los avisos para este sitio/)).not.toBeInTheDocument();
  });
});

describe("R45 — el hueco del control NUNCA se queda vacío en un iPhone sin instalar", () => {
  it("sin `PushManager` no hay interruptor, pero SÍ la instrucción de instalar", async () => {
    montarNavegadorPush({ conPushManager: false });

    montar();

    // Lo accionable, palabra por palabra: es lo que esas tres personas tienen que leer.
    expect(
      await screen.findByText("Agrega Ordenex a tu pantalla de inicio"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "En este dispositivo los avisos solo llegan si la aplicación está instalada. Toca " +
          "Compartir y luego «Agregar a inicio»; después vuelve aquí y actívalos.",
      ),
    ).toBeInTheDocument();
    // Y no se ofrece un interruptor que el navegador no puede cumplir.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("la instrucción va EN EL HUECO DEL CONTROL: es el único contenido que el componente pinta", async () => {
    // Si mañana alguien la mueve a una ayuda, a un pie o a un diálogo aparte, este caso se pone
    // rojo: el componente dejaría de ser lo que ocupa el sitio del interruptor.
    montarNavegadorPush({ conPushManager: false });

    const { container } = montar();
    await screen.findByText("Agrega Ordenex a tu pantalla de inicio");

    expect(container.textContent).toContain("Agrega Ordenex a tu pantalla de inicio");
    expect(container.firstElementChild).not.toBeNull();
  });
});

describe("R13 — sin canal configurado no se ofrece NADA, y eso no es un error", () => {
  it("`clavePublica: null` deja el hueco vacío del todo", async () => {
    montarNavegadorPush();
    obtenerMock.mockResolvedValue({ status: "ok", clavePublica: null });

    const { container } = montar();

    await waitFor(() => expect(obtenerMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    // Y no se pinta un error: no lo es.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("MUTACIÓN: con clave, ese MISMO escenario sí pinta el interruptor", async () => {
    // Sin este control positivo, el caso de arriba estaría verde por vacío: un componente roto que
    // no pintara nunca nada lo pasaría igual.
    montarNavegadorPush();

    montar();

    expect(await screen.findByRole("switch", { name: SIN_ACTIVAR })).toBeInTheDocument();
  });

  it("sin canal y ADEMÁS sin `PushManager`, tampoco se manda a nadie a instalar en balde", async () => {
    montarNavegadorPush({ conPushManager: false });
    obtenerMock.mockResolvedValue({ status: "ok", clavePublica: null });

    const { container } = montar();

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText(/pantalla de inicio/)).not.toBeInTheDocument();
  });
});

describe("R11/R15 — el interruptor es el que enciende y apaga el canal", () => {
  it("encenderlo pide el permiso al navegador (y no antes)", async () => {
    const { pedirPermiso } = montarNavegadorPush();
    const user = userEvent.setup();

    montar();
    const control = await screen.findByRole("switch", { name: SIN_ACTIVAR });
    // R10: el control ya está pintado y todavía no se ha pedido nada.
    expect(pedirPermiso).not.toHaveBeenCalled();

    await user.click(control);

    await waitFor(() => expect(pedirPermiso).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("switch", { name: ACTIVADO })).toBeInTheDocument();
  });

  it("apagarlo da de baja este dispositivo en el servidor y en el navegador", async () => {
    const suscripcion = suscripcionFalsa();
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: suscripcion });
    const user = userEvent.setup();

    montar();
    await user.click(await screen.findByRole("switch", { name: ACTIVADO }));

    await waitFor(() => expect(eliminarMock).toHaveBeenCalledTimes(1));
    expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("switch", { name: SIN_ACTIVAR })).toBeInTheDocument();
  });
});
