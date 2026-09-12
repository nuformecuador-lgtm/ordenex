// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { darDeBajaDeEsteDispositivo, type MotivoDeLaBaja } from "@/lib/pwa/baja-push";
import { eliminarSuscripcionPush } from "@/lib/actions/push";

// FICHA 410 (tanda 5 — R15, R19, R20, R23) + FICHA 422 (T3.1 — R7, R8, R9, R11, R12, R13).
//
// LA BAJA DE ESTE DISPOSITIVO, Y SU MOTIVO.
//
// La llaman dos superficies (el interruptor y el botón de salir) y las dos dependen de la misma
// promesa: que NO LANCE NUNCA. Si lanzara, cerrar sesión se quedaría a medias porque un servicio
// de push no respondió.
//
// Lo que la 422 añade a este archivo es UNA distinción y ninguna más: qué significa cada baja para
// la PREFERENCIA de la persona. El trabajo sobre el dispositivo tiene que seguir siendo idéntico
// con los dos motivos, y hay un caso abajo que lo compara llamada a llamada (R9).

const { eliminarMock, olvidarMock } = vi.hoisted(() => ({
  eliminarMock: vi.fn(),
  olvidarMock: vi.fn(),
}));

vi.mock("@/lib/actions/push", () => ({
  eliminarSuscripcionPush: eliminarMock,
  olvidarPreferenciaDeAvisos: olvidarMock,
  registrarSuscripcionPush: vi.fn(),
  obtenerClavePublicaPush: vi.fn(),
}));

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/eL-eNdPoInT-SeCrEtO";

/** El motivo del interruptor en OFF: DIJO QUE NO. */
const APAGAR: MotivoDeLaBaja = "la-persona-apago-el-interruptor";
/** El motivo del botón de salir: SOLO SE FUE. */
const SALIR: MotivoDeLaBaja = "cierre-de-sesion";

function montarServiceWorker(suscripcion: unknown, opciones: { registro?: unknown } = {}) {
  const registro =
    "registro" in opciones
      ? opciones.registro
      : { pushManager: { getSubscription: vi.fn().mockResolvedValue(suscripcion) } };
  const contenedor = { getRegistration: vi.fn().mockResolvedValue(registro) };
  Object.defineProperty(navigator, "serviceWorker", {
    value: contenedor,
    configurable: true,
    writable: true,
  });
  return contenedor;
}

function suscripcionFalsa(overrides: Partial<{ unsubscribe: () => Promise<boolean> }> = {}) {
  return {
    endpoint: ENDPOINT,
    unsubscribe: overrides.unsubscribe ?? vi.fn().mockResolvedValue(true),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  eliminarMock.mockResolvedValue({ status: "ok" });
  olvidarMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "serviceWorker");
  vi.restoreAllMocks();
});

describe("darDeBajaDeEsteDispositivo — R15/R19: las DOS mitades, siempre", () => {
  it("borra la fila en el servidor Y se da de baja en el navegador", async () => {
    const suscripcion = suscripcionFalsa();
    montarServiceWorker(suscripcion);

    const resultado = await darDeBajaDeEsteDispositivo(APAGAR);

    expect(eliminarMock).toHaveBeenCalledWith({ endpoint: ENDPOINT });
    expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ estado: "dada-de-baja", preferencia: "borrada" });
  });

  it("el SERVIDOR va primero: es el único que de verdad corta el push", async () => {
    const orden: string[] = [];
    eliminarMock.mockImplementation(async () => {
      orden.push("servidor");
      return { status: "ok" };
    });
    const suscripcion = suscripcionFalsa({
      unsubscribe: vi.fn().mockImplementation(async () => {
        orden.push("navegador");
        return true;
      }),
    });
    montarServiceWorker(suscripcion);

    await darDeBajaDeEsteDispositivo(SALIR);

    expect(orden).toEqual(["servidor", "navegador"]);
  });

  it("R46: sin suscripción en este dispositivo no se llama a nadie, y NO es un fallo", async () => {
    montarServiceWorker(null);

    const resultado = await darDeBajaDeEsteDispositivo(SALIR);

    expect(eliminarMock).not.toHaveBeenCalled();
    expect(resultado).toEqual({ estado: "sin-suscripcion", preferencia: "conservada" });
  });

  it("sin service worker en el navegador tampoco hay nada que hacer", async () => {
    const resultado = await darDeBajaDeEsteDispositivo(SALIR);

    expect(eliminarMock).not.toHaveBeenCalled();
    expect(resultado).toEqual({ estado: "sin-suscripcion", preferencia: "conservada" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 422 — LA INTENCIÓN
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/R7 — apagar el interruptor BORRA la preferencia: la persona dijo que no", () => {
  it("⭑ apagar el interruptor borra la preferencia", async () => {
    montarServiceWorker(suscripcionFalsa());

    const resultado = await darDeBajaDeEsteDispositivo(APAGAR);

    expect(olvidarMock).toHaveBeenCalledTimes(1);
    expect(resultado.preferencia).toBe("borrada");
  });
});

describe("422/R8 — cerrar sesión CONSERVA la preferencia: solo se fue", () => {
  it("⭑ cerrar sesión NO borra la preferencia", async () => {
    // ⚠️ ESTE ES EL CASO QUE LA FICHA EXIGE QUE SE PONGA ROJO SI ALGUIEN QUITA LA DISTINCIÓN
    // (mutación M1: cambiar el motivo del `LogoutButton` a «apagó el interruptor»). Sin él, salir
    // y decir que no serían indistinguibles, que es exactamente lo que la 422 vino a separar: la
    // persona seguiría perdiendo su decisión cada vez que cierra sesión.
    montarServiceWorker(suscripcionFalsa());

    const resultado = await darDeBajaDeEsteDispositivo(SALIR);

    expect(olvidarMock).not.toHaveBeenCalled();
    expect(resultado.preferencia).toBe("conservada");
  });

  it("control positivo: el mismo escenario con el OTRO motivo sí la borra", async () => {
    // Sin este control, el caso de arriba pasaría en verde con una función que no borrara NUNCA.
    montarServiceWorker(suscripcionFalsa());

    await darDeBajaDeEsteDispositivo(APAGAR);

    expect(olvidarMock).toHaveBeenCalledTimes(1);
  });
});

describe("422/R9 — los dos motivos hacen EXACTAMENTE el mismo trabajo con el dispositivo", () => {
  /** Todas las llamadas que la baja hace SOBRE EL DISPOSITIVO, en orden, para un motivo dado. */
  async function trabajoDelDispositivo(motivo: MotivoDeLaBaja): Promise<string[]> {
    vi.clearAllMocks();
    olvidarMock.mockResolvedValue({ status: "ok" });
    const huella: string[] = [];
    eliminarMock.mockImplementation(async (entrada: { endpoint: string }) => {
      huella.push(`servidor:${entrada.endpoint}`);
      return { status: "ok" };
    });
    const suscripcion = suscripcionFalsa({
      unsubscribe: vi.fn().mockImplementation(async () => {
        huella.push("navegador:unsubscribe");
        return true;
      }),
    });
    const contenedor = montarServiceWorker(suscripcion);
    const resultado = await darDeBajaDeEsteDispositivo(motivo);
    huella.push(`getRegistration:${contenedor.getRegistration.mock.calls.length}`);
    huella.push(`estado:${resultado.estado}`);
    return huella;
  }

  it("⭑ la huella sobre el dispositivo es IDÉNTICA con los dos motivos", async () => {
    // Separar la INTENCIÓN sin separar el TRABAJO. Si alguien mete una rama por motivo en la mitad
    // del dispositivo —«al salir no hace falta el unsubscribe», por ejemplo— esto se pone rojo.
    const alApagar = await trabajoDelDispositivo(APAGAR);
    const alSalir = await trabajoDelDispositivo(SALIR);

    expect(alApagar).toEqual(alSalir);
    // CONTROL POSITIVO: la huella no está vacía. Sin esto, dos listas vacías serían «idénticas».
    expect(alApagar).toEqual([
      `servidor:${ENDPOINT}`,
      "navegador:unsubscribe",
      "getRegistration:1",
      "estado:dada-de-baja",
    ]);
  });

  it("⭑ y lo ÚNICO que cambia entre los dos es la preferencia", async () => {
    montarServiceWorker(suscripcionFalsa());
    const apagando = await darDeBajaDeEsteDispositivo(APAGAR);
    vi.clearAllMocks();
    eliminarMock.mockResolvedValue({ status: "ok" });
    olvidarMock.mockResolvedValue({ status: "ok" });
    montarServiceWorker(suscripcionFalsa());
    const saliendo = await darDeBajaDeEsteDispositivo(SALIR);

    expect(apagando.estado).toBe(saliendo.estado);
    expect(apagando.preferencia).not.toBe(saliendo.preferencia);
  });
});

describe("422/R11 — la intención se trata ANTES del corte por «sin suscripción»", () => {
  it("⭑ apagar sin suscripción viva borra la preferencia igual", async () => {
    // EL CASO REAL: la suscripción se evaporó entre el render y el clic (el navegador la caducó,
    // otra pestaña se dio de baja). Si el tratamiento del motivo fuera DESPUÉS del corte, esto
    // saldría por `sin-suscripcion` con la preferencia PUESTA y la aplicación resucitaría los
    // avisos mañana: la persona habría dicho que no y la aplicación le habría dicho que sí.
    montarServiceWorker(null);

    const resultado = await darDeBajaDeEsteDispositivo(APAGAR);

    expect(olvidarMock).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ estado: "sin-suscripcion", preferencia: "borrada" });
  });

  it("⭑ y ni siquiera hace falta que haya service worker", async () => {
    // El corte más temprano de todos: un navegador sin `navigator.serviceWorker`. La intención ya
    // se resolvió antes de llegar aquí.
    const resultado = await darDeBajaDeEsteDispositivo(APAGAR);

    expect(olvidarMock).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ estado: "sin-suscripcion", preferencia: "borrada" });
  });

  it("control positivo: al SALIR sin suscripción no se toca la preferencia", async () => {
    montarServiceWorker(null);

    const resultado = await darDeBajaDeEsteDispositivo(SALIR);

    expect(olvidarMock).not.toHaveBeenCalled();
    expect(resultado).toEqual({ estado: "sin-suscripcion", preferencia: "conservada" });
  });
});

describe("422/R12 — si borrar la preferencia falla, todo lo demás se completa IGUAL", () => {
  it("⭑ la acción rechaza: la baja del dispositivo se hace entera y NADA lanza", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    olvidarMock.mockRejectedValue(new Error("el servidor no contestó"));
    const suscripcion = suscripcionFalsa();
    montarServiceWorker(suscripcion);

    const resultado = await darDeBajaDeEsteDispositivo(APAGAR);

    // Las dos mitades del dispositivo, intactas: el fallo de la preferencia no las encadena.
    expect(eliminarMock).toHaveBeenCalledWith({ endpoint: ENDPOINT });
    expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ estado: "dada-de-baja", preferencia: "fallo-al-borrar" });
    // Y no se absorbe en silencio: queda su operación y su causa (docs/conventions.md).
    const registrado = error.mock.calls.map((c) => c.map(String).join(" ")).join(" | ");
    expect(registrado).toContain("borrar la preferencia de avisos");
    expect(registrado).toContain("el servidor no contestó");
  });

  it("⭑ la acción devuelve un error de acción: mismo desenlace, con su estado registrado", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    olvidarMock.mockResolvedValue({ status: "unauthenticated" });
    const suscripcion = suscripcionFalsa();
    montarServiceWorker(suscripcion);

    const resultado = await darDeBajaDeEsteDispositivo(APAGAR);

    expect(resultado).toEqual({ estado: "dada-de-baja", preferencia: "fallo-al-borrar" });
    expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
    const registrado = error.mock.calls.map((c) => c.map(String).join(" ")).join(" | ");
    expect(registrado).toContain("unauthenticated");
  });

  it("control positivo: sin fallo NO hay registro y la preferencia sale `borrada`", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    montarServiceWorker(suscripcionFalsa());

    const resultado = await darDeBajaDeEsteDispositivo(APAGAR);

    expect(error).not.toHaveBeenCalled();
    expect(resultado.preferencia).toBe("borrada");
  });
});

describe("422/R13 + 410/R19 — se toca ESTE dispositivo, y SOLO éste", () => {
  /**
   * ⚠️ ESTE ES EL CASO QUE PROTEGE LA PROPIEDAD MEDIDA EN PRODUCCIÓN: la suscripción de «Firefox en
   * Windows», donde no se cerró sesión, sigue viva. La 422 no puede erosionarla, y aquí se pone
   * roja si alguien lo intenta — por ejemplo convirtiendo la baja en «retira todos mis
   * dispositivos» al resolver la pregunta abierta P1 en el otro sentido.
   *
   * La afirmación es sobre lo que SALE de este módulo hacia el servidor: exactamente una llamada,
   * con exactamente el endpoint de ESTE navegador. Ni un borrado por usuario, ni una lista.
   */
  for (const motivo of [APAGAR, SALIR] as const) {
    it(`⭑ con motivo «${motivo}» se manda UN endpoint, el de este navegador, y nada más`, async () => {
      const suscripcion = suscripcionFalsa();
      montarServiceWorker(suscripcion);

      await darDeBajaDeEsteDispositivo(motivo);

      expect(eliminarMock).toHaveBeenCalledTimes(1);
      const entrada = eliminarMock.mock.calls[0]?.[0] as Record<string, unknown>;
      // La forma EXACTA del cuerpo: si alguien añadiera `todosLosDispositivos: true` o un
      // `usuarioId`, esto se pone rojo antes de llegar al servidor.
      expect(entrada).toEqual({ endpoint: ENDPOINT });
      // Y la baja del navegador es la de ESTA suscripción, no una barrida.
      expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
    });
  }

  it("⭑ borrar la preferencia NO es borrar suscripciones: la acción va SIN cuerpo", async () => {
    // R19 por el otro lado. `olvidarPreferenciaDeAvisos` no recibe endpoints ni identificadores:
    // si alguien le pasara algo, sería la puerta por la que apagar en el teléfono retirara la
    // suscripción de la computadora. La acción no tiene borde porque no tiene entrada.
    montarServiceWorker(suscripcionFalsa());

    await darDeBajaDeEsteDispositivo(APAGAR);

    expect(olvidarMock).toHaveBeenCalledTimes(1);
    expect(olvidarMock.mock.calls[0]).toEqual([]);
  });
});

describe("darDeBajaDeEsteDispositivo — R20: no lanza, y el fallo queda registrado", () => {
  it("si el servidor RECHAZA, la baja en el navegador se hace igual y nada lanza", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    eliminarMock.mockRejectedValue(new Error("la red se cayó"));
    const suscripcion = suscripcionFalsa();
    montarServiceWorker(suscripcion);

    const resultado = await darDeBajaDeEsteDispositivo(SALIR);

    // Las dos mitades son independientes: que una falle no puede impedir la otra.
    expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ estado: "fallo-parcial", preferencia: "conservada" });
    expect(error).toHaveBeenCalledTimes(1);
    // El registro dice QUÉ operación falló y con qué causa (docs/conventions.md).
    expect(String(error.mock.calls[0]?.[0])).toContain("borrar la suscripción en el servidor");
    expect(String(error.mock.calls[0]?.[1])).toContain("la red se cayó");
  });

  it("si el servidor responde un error de acción, también se registra con su estado", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    eliminarMock.mockResolvedValue({ status: "unauthenticated" });
    const suscripcion = suscripcionFalsa();
    montarServiceWorker(suscripcion);

    const resultado = await darDeBajaDeEsteDispositivo(SALIR);

    expect(resultado).toEqual({ estado: "fallo-parcial", preferencia: "conservada" });
    expect(String(error.mock.calls[0]?.[1])).toContain("unauthenticated");
  });

  it("si `unsubscribe()` revienta, el servidor ya quedó limpio y tampoco lanza", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const suscripcion = suscripcionFalsa({
      unsubscribe: vi.fn().mockRejectedValue(new Error("el navegador dijo que no")),
    });
    montarServiceWorker(suscripcion);

    const resultado = await darDeBajaDeEsteDispositivo(SALIR);

    expect(eliminarMock).toHaveBeenCalledWith({ endpoint: ENDPOINT });
    expect(resultado).toEqual({ estado: "fallo-parcial", preferencia: "conservada" });
    expect(String(error.mock.calls[0]?.[0])).toContain("darse de baja en el navegador");
  });

  it("leer el registro del service worker puede fallar, y tampoco lanza", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(navigator, "serviceWorker", {
      value: { getRegistration: vi.fn().mockRejectedValue(new Error("sin registro")) },
      configurable: true,
      writable: true,
    });

    const resultado = await darDeBajaDeEsteDispositivo(APAGAR);

    // 422/R11 otra vez: aunque la lectura del dispositivo falle, la intención ya se resolvió.
    expect(resultado).toEqual({ estado: "fallo-parcial", preferencia: "borrada" });
    expect(String(error.mock.calls[0]?.[0])).toContain("leer la suscripción de este dispositivo");
  });
});

describe("R23 — el endpoint NO puede acabar en la consola, ni dentro del mensaje de un error", () => {
  it("un error que lleva el endpoint dentro se registra SIN él", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Así es exactamente como se filtraría en producción: `TypeError: Failed to fetch <url>`.
    eliminarMock.mockRejectedValue(new Error(`Failed to fetch ${ENDPOINT}`));
    montarServiceWorker(suscripcionFalsa());

    await darDeBajaDeEsteDispositivo(SALIR);

    const registrado = error.mock.calls.map((c) => c.map(String).join(" ")).join(" | ");
    expect(registrado).not.toContain(ENDPOINT);
    expect(registrado).not.toContain("eL-eNdPoInT-SeCrEtO");
    // Control positivo: se registró algo útil, no se silenció el fallo.
    expect(registrado).toContain("borrar la suscripción en el servidor");
    expect(registrado).toContain("«dirección omitida»");
  });

  it("⭑ y tampoco por el camino nuevo: un fallo de la preferencia se limpia igual", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    olvidarMock.mockRejectedValue(new Error(`Failed to fetch ${ENDPOINT}`));
    montarServiceWorker(suscripcionFalsa());

    await darDeBajaDeEsteDispositivo(APAGAR);

    const registrado = error.mock.calls.map((c) => c.map(String).join(" ")).join(" | ");
    expect(registrado).not.toContain("eL-eNdPoInT-SeCrEtO");
    expect(registrado).toContain("borrar la preferencia de avisos");
  });
});

describe("el contrato del módulo", () => {
  it("la acción que consume es la del canal, no una ruta de API inventada", () => {
    // Control de la frontera: si alguien cambiara la baja por un `fetch('/api/...')`, este import
    // dejaría de ser el que se usa y el mock de arriba no espiaría nada.
    expect(vi.isMockFunction(eliminarSuscripcionPush)).toBe(true);
  });
});
