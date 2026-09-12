// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import { PushReactivacion } from "@/components/shared/PushReactivacion";
import { PushOptIn } from "@/components/shared/PushOptIn";
import { ToastProvider } from "@/providers/ToastProvider";
import {
  ENDPOINT_FALSO,
  limpiarNavegadorPush,
  montarNavegadorPush,
  suscripcionFalsa,
} from "../fixtures/navegador-push";

/**
 * FICHA 422 (tanda 5, T5.1 — R14, R15, R16, R17, R18, R19, R20, R21, R23) — LA REACTIVACIÓN
 * SILENCIOSA, EN TODOS SUS CAMINOS.
 *
 * ## ⚠️ CADA CASO NEGATIVO LLEVA SU CONTROL POSITIVO AL LADO
 *
 * Este componente devuelve `null` y su trabajo entero es «no hacer nada» en la mayoría de los
 * escenarios. Un archivo de tests así es el terreno natural del fallo mudo: un montaje que no
 * llegara a correr —un fixture mal puesto, un efecto que no dispara, un mock que no resuelve—
 * pasaría en verde TODOS los `not.toHaveBeenCalled()` sin haber comprobado nada.
 *
 * Por eso aquí, para cada «no hace nada», está el MISMO escenario cambiando UNA sola condición y
 * afirmando lo contrario. Si el camino feliz se rompe, los negativos dejan de significar algo y se
 * ponen rojos con él.
 *
 * ## Qué NO se dobla
 *
 * `lib/pwa/alta-push.ts` corre de verdad: es la costura que sostiene R15 y R17 (comprueba el
 * permiso y no lo pide), y doblarla convertiría estos casos en una comprobación de que el doble
 * hace lo que el doble hace. Lo único doblado es el borde del servidor (`@/lib/actions/push`) y el
 * navegador (el fixture de la 410).
 */

const { obtenerMock, registrarMock, eliminarMock, olvidarMock } = vi.hoisted(() => ({
  obtenerMock: vi.fn(),
  registrarMock: vi.fn(),
  eliminarMock: vi.fn(),
  olvidarMock: vi.fn(),
}));

// El borde con el servidor. Las cuatro acciones, aunque este componente use dos: `baja-push.ts`
// —que entra por el hook cuando este archivo monta también el interruptor— importa las otras dos,
// y sin ellas el import se resuelve a `undefined` y el fallo sale como «no es una función».
vi.mock("@/lib/actions/push", () => ({
  obtenerClavePublicaPush: obtenerMock,
  registrarSuscripcionPush: registrarMock,
  eliminarSuscripcionPush: eliminarMock,
  olvidarPreferenciaDeAvisos: olvidarMock,
}));

const CLAVE = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

/** Los dos nombres del interruptor de la 410, escritos a mano: son el contrato con la persona. */
const SIN_ACTIVAR = "Avisarme en este dispositivo";
const ACTIVADO = "Activado en este dispositivo";

let errores: unknown[][];

function montar(avisosRecordados: boolean) {
  return render(<PushReactivacion avisosRecordados={avisosRecordados} />);
}

/**
 * Un respiro REAL antes de afirmar que algo NO pasó.
 *
 * `waitFor(() => expect(x).not.toHaveBeenCalled())` pasa en el primer intento y no espera nada: si
 * la llamada prohibida llegara un tick después, el caso estaría verde igual. Todo el camino de este
 * componente son promesas ya resueltas, así que 20 ms de reloj son varias vueltas enteras de la
 * cola de microtareas.
 */
function respiro(): Promise<void> {
  return new Promise((r) => setTimeout(r, 20));
}

/** Lo que la consola recibió, en una sola cadena, para poder afirmar qué NO hay ahí dentro. */
function loRegistrado(): string {
  return errores.map((args) => args.map((a) => String(a)).join(" ")).join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  obtenerMock.mockResolvedValue({ status: "ok", clavePublica: CLAVE });
  registrarMock.mockResolvedValue({ status: "ok" });
  eliminarMock.mockResolvedValue({ status: "ok" });
  olvidarMock.mockResolvedValue({ status: "ok" });
  errores = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errores.push(args);
  });
});

afterEach(() => {
  cleanup();
  limpiarNavegadorPush();
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R14 + R15 — EL CAMINO QUE ESTA FICHA EXISTE PARA QUE OCURRA
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/R14-R15 — con la preferencia puesta y el permiso concedido, vuelve a suscribir sola", () => {
  it("⭑ al montar evalúa y, sin pedir NADA, suscribe y registra este dispositivo", async () => {
    // El escenario real: la persona ya había dicho que sí, cerró sesión (y el dispositivo se dio de
    // baja, 410/R19), el permiso del navegador sigue concedido y hoy vuelve a entrar.
    const { subscribe, getSubscription, pedirPermiso } = montarNavegadorPush({ permiso: "granted" });

    montar(true);

    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    // Evaluó de verdad: preguntó al navegador si este dispositivo ya estaba suscrito (R14).
    expect(getSubscription).toHaveBeenCalledTimes(1);
    // Y suscribió: `userVisibleOnly` es obligatorio en Chrome y la clave va en bytes (410/R32).
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0][0]).toMatchObject({ userVisibleOnly: true });
    expect(subscribe.mock.calls[0][0].applicationServerKey).toBeInstanceOf(Uint8Array);
    // R15: se registra a nombre de la sesión abierta —el `usuarioId` NO viaja en el cuerpo
    // (410/R50)— y con la etiqueta de este dispositivo.
    expect(registrarMock).toHaveBeenCalledWith({
      endpoint: ENDPOINT_FALSO,
      p256dh: "PPP",
      auth: "AAA",
      etiqueta: "Chrome en Android",
    });
    // ⚠️ R16: NO se pidió el permiso. Ni una vez.
    expect(pedirPermiso).not.toHaveBeenCalled();
    // Y no se registró ningún fallo: el camino feliz es silencioso también en la consola.
    expect(loRegistrado()).toBe("");
  });

  it("⭑ sin canal configurado en el despliegue, se termina sin ruido (410/R13)", async () => {
    // `clavePublica: null` no es un error: es un despliegue sin claves. Lo que NO puede pasar es
    // que se intente suscribir con una clave que no existe.
    const { subscribe } = montarNavegadorPush({ permiso: "granted" });
    obtenerMock.mockResolvedValue({ status: "ok", clavePublica: null });

    montar(true);

    await waitFor(() => expect(obtenerMock).toHaveBeenCalledTimes(1));
    expect(subscribe).not.toHaveBeenCalled();
    expect(registrarMock).not.toHaveBeenCalled();
    expect(loRegistrado()).toBe("");
  });

  it("⭑ y en un navegador que no puede (iPhone sin instalar) no se intenta nada", async () => {
    const { subscribe } = montarNavegadorPush({ permiso: "granted", conPushManager: false });

    montar(true);

    // Ni siquiera se va al servidor a por la clave: el corte es local y anterior.
    await respiro();
    expect(subscribe).not.toHaveBeenCalled();
    expect(obtenerMock).not.toHaveBeenCalled();
    expect(registrarMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R16 + R17 — LA PREFERENCIA NO SE SALTA LA COMPROBACIÓN DEL PERMISO (mutación M2, su otra mitad)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/R16-R17 — la reactivación APROVECHA un permiso concedido; no lo pide ni lo suple", () => {
  for (const permiso of ["default", "denied"] as const) {
    it(`⭑ con el permiso en «${permiso}», la preferencia puesta NO se salta la comprobación`, async () => {
      // ⚠️ ÉSTE ES EL CASO QUE LA FICHA EXIGE. La preferencia es la decisión de la PERSONA; el
      // permiso es del DISPOSITIVO y no lo controla esta aplicación. Una preferencia puesta no
      // puede convertirse en un `subscribe` sin permiso: eso sería la aplicación decidiendo por el
      // navegador, y en «denied» ni siquiera funcionaría.
      const { subscribe, pedirPermiso, getSubscription } = montarNavegadorPush({ permiso });

      montar(true);

      // Se espera a que el efecto haya tenido ocasión de correr entero antes de afirmar el «no».
      await respiro();
      expect(pedirPermiso).not.toHaveBeenCalled();
      expect(subscribe).not.toHaveBeenCalled();
      expect(registrarMock).not.toHaveBeenCalled();
      // El corte es ANTES de preguntar nada más: no se mira la suscripción ni se va al servidor.
      expect(getSubscription).not.toHaveBeenCalled();
      expect(obtenerMock).not.toHaveBeenCalled();
    });
  }

  it("⭑ CONTROL POSITIVO: el MISMO escenario con el permiso concedido sí suscribe", async () => {
    // Sin esto, los dos casos de arriba estarían verdes con un componente que no hiciera nada
    // nunca — que es exactamente el fallo mudo que rompe esta ficha entera.
    const { subscribe } = montarNavegadorPush({ permiso: "granted" });

    montar(true);

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
  });

  it("⭑ R16: en NINGÚN escenario se llama a la petición de permiso del navegador", async () => {
    // El barrido completo: los tres permisos, con la preferencia puesta. La guardia del árbol
    // (`push-alta-punto-unico.guardia.test.ts`) sostiene lo mismo sobre la FORMA del código; esto
    // lo sostiene sobre el COMPORTAMIENTO, y la mutación M3 tiene que caer en los dos sitios.
    for (const permiso of ["default", "denied", "granted"] as const) {
      const { pedirPermiso } = montarNavegadorPush({ permiso });
      const { unmount } = montar(true);
      await respiro();
      expect(pedirPermiso, `se pidió el permiso con el navegador en «${permiso}»`).not.toHaveBeenCalled();
      unmount();
      limpiarNavegadorPush();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R18 — SIN PREFERENCIA, LA APLICACIÓN NO SUSCRIBE A NADIE POR SU CUENTA
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/R18 — mientras la preferencia no esté puesta no se registra nada", () => {
  it("⭑ con `avisosRecordados={false}` no se le pregunta ni al navegador", async () => {
    const { subscribe, getSubscription, pedirPermiso } = montarNavegadorPush({ permiso: "granted" });

    montar(false);

    await respiro();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(registrarMock).not.toHaveBeenCalled();
    expect(obtenerMock).not.toHaveBeenCalled();
    expect(pedirPermiso).not.toHaveBeenCalled();
  });

  it("⭑ CONTROL POSITIVO: el MISMO escenario con la preferencia puesta sí suscribe", async () => {
    const { subscribe } = montarNavegadorPush({ permiso: "granted" });

    montar(true);

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    expect(registrarMock).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R21 — YA HAY SUSCRIPCIÓN VIVA: SE REAFIRMA, NO SE CREA UNA SEGUNDA
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/R21 — con suscripción viva se reafirma el registro y no se duplica nada", () => {
  it("⭑ registra la suscripción QUE YA HAY y no llama a `subscribe`", async () => {
    // El estado que esto cura: el cierre de sesión a medias. El servidor borró la fila y el
    // `unsubscribe()` del navegador falló, así que el interruptor diría «Activado» y no llegaría
    // nada. El upsert por `endpoint` (410/R17) lo arregla sin crear una segunda suscripción.
    const viva = suscripcionFalsa("https://fcm.googleapis.com/fcm/send/ya-existia");
    const { subscribe, getSubscription } = montarNavegadorPush({
      permiso: "granted",
      suscripcionPrevia: viva,
    });

    montar(true);

    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    expect(getSubscription).toHaveBeenCalledTimes(1);
    expect(registrarMock).toHaveBeenCalledWith({
      endpoint: "https://fcm.googleapis.com/fcm/send/ya-existia",
      p256dh: "PPP",
      auth: "AAA",
      etiqueta: "Chrome en Android",
    });
    // ⚠️ LA MITAD QUE IMPORTA: no se crea una segunda suscripción para el mismo dispositivo...
    expect(subscribe).not.toHaveBeenCalled();
    // ...ni se toca la que había.
    expect(viva.unsubscribe).not.toHaveBeenCalled();
    // Y no se va a por la clave pública: no hace falta para reafirmar.
    expect(obtenerMock).not.toHaveBeenCalled();
  });

  it("⭑ si reafirmar falla, se registra la operación y no se lanza", async () => {
    const viva = suscripcionFalsa();
    montarNavegadorPush({ permiso: "granted", suscripcionPrevia: viva });
    registrarMock.mockResolvedValue({ status: "validation_error" });

    montar(true);

    await waitFor(() => expect(loRegistrado()).toContain("reafirmar el registro"));
    // R20/410/R23: la credencial de entrega NO aparece en el registro del fallo.
    expect(loRegistrado()).not.toContain(ENDPOINT_FALSO);
    // Y la suscripción del navegador se respeta: esto no la creó, así que no la deshace.
    expect(viva.unsubscribe).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R23 — COMO MUCHO UN INTENTO POR CARGA
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/R23 — se intenta como mucho UNA vez por carga del portal", () => {
  it("⭑ el doble montaje del modo estricto de React NO dispara un segundo intento", async () => {
    // En desarrollo React monta, desmonta y vuelve a montar cada componente. Sin la marca de «ya
    // se intentó», eso son DOS suscripciones y dos registros por cada carga, en cada máquina de
    // desarrollo y en cada `Fast Refresh`.
    const { subscribe } = montarNavegadorPush({ permiso: "granted" });

    render(
      <StrictMode>
        <PushReactivacion avisosRecordados />
      </StrictMode>,
    );

    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    // Un respiro por si el segundo intento llegara tarde: la aserción tiene que seguir siendo 1.
    await new Promise((r) => setTimeout(r, 20));
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(registrarMock).toHaveBeenCalledTimes(1);
    expect(obtenerMock).toHaveBeenCalledTimes(1);
  });

  it("⭑ ni lo dispara un re-render del layout con las mismas props", async () => {
    const { subscribe } = montarNavegadorPush({ permiso: "granted" });

    const { rerender } = montar(true);
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));

    rerender(<PushReactivacion avisosRecordados />);
    rerender(<PushReactivacion avisosRecordados />);

    await new Promise((r) => setTimeout(r, 20));
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(registrarMock).toHaveBeenCalledTimes(1);
  });

  it("⭑ CONTROL POSITIVO: DOS cargas distintas del portal sí intentan dos veces", async () => {
    // Sin esto, «una vez» estaría verde con un componente que no intentara nunca. Y además fija lo
    // que R23 dice de verdad: el límite es POR CARGA, no para siempre.
    montarNavegadorPush({ permiso: "granted" });

    const { unmount } = montar(true);
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    unmount();

    montar(true);
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(2));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R19 — SILENCIOSA: NI UN PÍXEL, NI UN AVISO
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/R19 — la reactivación no se ve ni se anuncia", () => {
  it("⭑ el componente no pinta NADA: su árbol renderizado está vacío", async () => {
    // Decisión del humano: el interruptor ya muestra el estado de este dispositivo (410/R14), así
    // que anunciar la reactivación sería contarle a la persona una gestión interna que no pidió.
    montarNavegadorPush({ permiso: "granted" });

    const { container } = montar(true);

    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    await respiro();
    // Ni un nodo, antes y después de que la reactivación termine.
    expect(container.innerHTML).toBe("");
    expect(document.body.textContent?.trim()).toBe("");
  });

  it("⭑ y NO aparece ningún aviso en la página al reactivar (ni toast, ni alerta)", async () => {
    // Se monta DENTRO del proveedor de toasts a propósito: si alguien pintara uno, aquí saldría
    // como texto de verdad en vez de reventar por falta de contexto, y este caso lo vería.
    montarNavegadorPush({ permiso: "granted" });

    render(
      <ToastProvider>
        <PushReactivacion avisosRecordados />
      </ToastProvider>,
    );

    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    await respiro();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    // El viewport de los toasts existe (el proveedor está montado) pero está VACÍO de texto: eso
    // es lo que separa «no hay toast» de «no hay proveedor».
    expect(document.body.textContent?.trim()).toBe("");
  });

  it("⭑ tampoco cuando falla: un fallo silencioso sigue siendo silencioso", async () => {
    montarNavegadorPush({ permiso: "granted" });
    registrarMock.mockResolvedValue({ status: "internal_error" });

    render(
      <ToastProvider>
        <PushReactivacion avisosRecordados />
      </ToastProvider>,
    );

    await waitFor(() => expect(loRegistrado()).not.toBe(""));
    await respiro();

    // Lo único que queda de un fallo es la línea de consola. La persona no ve nada.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent?.trim()).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R20 — SI FALLA, EL INTERRUPTOR NO PUEDE MENTIR
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/R20 — una reactivación fallida deja el estado «sin activar» y la preferencia intacta", () => {
  it("⭑ el servidor rechaza el registro: se deshace la suscripción y el interruptor NO dice «Activado»", async () => {
    // ⚠️ ESTO ES LO QUE HACE QUE EL CONTROL NO MIENTA. Una suscripción viva que el servidor no
    // conoce es un dispositivo que CREE que va a recibir avisos y no los va a recibir: peor que no
    // haberlo intentado, porque nadie va a volver a tocar un interruptor que ya dice «Activado».
    const nueva = suscripcionFalsa();
    montarNavegadorPush({ permiso: "granted", suscripcionNueva: nueva });
    registrarMock.mockResolvedValue({ status: "internal_error" });

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PushReactivacion avisosRecordados />
        <PushOptIn />
      </SWRConfig>,
    );

    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    // La suscripción del navegador se deshace: el dispositivo queda como estaba.
    await waitFor(() => expect(nueva.unsubscribe).toHaveBeenCalledTimes(1));
    // Y lo que la persona lee sigue siendo la verdad.
    expect(await screen.findByRole("switch", { name: SIN_ACTIVAR })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: ACTIVADO })).toBeNull();
    // La preferencia NO se toca: no se borra por un fallo de red (esa acción ni se llama).
    expect(olvidarMock).not.toHaveBeenCalled();
    // El fallo queda registrado con su operación y su causa, y SIN la credencial de entrega.
    expect(loRegistrado()).toContain("registrar la suscripción");
    expect(loRegistrado()).not.toContain(ENDPOINT_FALSO);
    expect(loRegistrado()).not.toContain("PPP");
    expect(loRegistrado()).not.toContain("AAA");
  });

  it("⭑ CONTROL POSITIVO: el MISMO escenario con el servidor diciendo que sí NO deshace nada", async () => {
    // Sin esto, el caso de arriba pasaría con un componente que deshiciera SIEMPRE la suscripción
    // —o que no llegara nunca a crearla—, y el interruptor diría «sin activar» por la razón
    // equivocada.
    const nueva = suscripcionFalsa();
    montarNavegadorPush({ permiso: "granted", suscripcionNueva: nueva });

    montar(true);

    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(nueva.unsubscribe).not.toHaveBeenCalled();
    expect(loRegistrado()).toBe("");
  });

  it("⭑ sin red, la promesa no se escapa sin capturar y nada explota", async () => {
    // Una acción de servidor RECHAZA cuando no hay red. Si eso no se capturara, sería un
    // «unhandled rejection» en cada carga del portal de quien tenga la preferencia puesta.
    montarNavegadorPush({ permiso: "granted" });
    registrarMock.mockRejectedValue(new Error("sin red"));

    montar(true);

    await waitFor(() => expect(loRegistrado()).toContain("sin red"));
    expect(loRegistrado()).toContain("activar los avisos en este dispositivo");
    expect(loRegistrado()).not.toContain(ENDPOINT_FALSO);
    expect(olvidarMock).not.toHaveBeenCalled();
  });

  it("⭑ y si el service worker no está activo, se termina sin colgarse ni registrar de más", async () => {
    // `getRegistration()` devuelve `undefined` mientras el worker no ha activado. Lo que NO puede
    // pasar es esperar a `ready`, que no resuelve NUNCA si no hay registro: el camino silencioso
    // se quedaría colgado para siempre.
    montarNavegadorPush({ permiso: "granted" });
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        getRegistration: vi.fn().mockResolvedValue(undefined),
        ready: new Promise(() => {}),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    montar(true);

    // Llega hasta el final del camino —pide la clave— y se corta sin suscribir ni registrar.
    await waitFor(() => expect(obtenerMock).toHaveBeenCalledTimes(1));
    expect(registrarMock).not.toHaveBeenCalled();
  });
});
