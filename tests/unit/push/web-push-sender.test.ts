import { describe, it, expect, vi, beforeEach } from "vitest";

// FICHA 410 (T3.6) — LA TRADUCCION HTTP -> DOMINIO. Cubre R33 (404/410 = caducada, nunca se
// reintenta), R34 (red / 5xx / 429 = transitorio) y R23 (el `detalle` NO lleva endpoint ni claves).
//
// ⚠️ QUE SE PRUEBA DE VERDAD, dicho sin adornos: se dobla `web-push` ENTERA. Este test NO demuestra
// que la libreria hable bien con un servicio de push real —ninguna suite de este repo toca uno—;
// demuestra que CADA desenlace que la libreria puede producir acaba en el `PushOutcome` correcto y
// que NADA lanza. Esa es justo la mitad que puede romperse en silencio al tocar el codigo.

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { sendNotification: (...a: unknown[]) => sendNotification(...a) } }));

const { WebPushSender } = await import("@/lib/push/web-push-sender");

const CONFIG = {
  publicKey: "BPUBLICA-de-mentira",
  privateKey: "PRIVADA-de-mentira",
  subject: "mailto:soporte@ordenex.co",
};

const SUSCRIPCION = {
  id: "sus-7",
  endpoint: "https://fcm.googleapis.com/fcm/send/ENDPOINT-SECRETO-abc123",
  p256dh: "P256DH-SECRETO",
  auth: "AUTH-SECRETO",
};

/** Error tal y como lo lanza `web-push` ante un desenlace HTTP no-2xx. */
function errorHttp(statusCode: number): Error & { statusCode: number } {
  const e = new Error(`Received unexpected response code`) as Error & { statusCode: number };
  e.statusCode = statusCode;
  return e;
}

beforeEach(() => {
  sendNotification.mockReset();
});

describe("410 — la tabla de desenlaces, uno por uno", () => {
  it("⭑ 2xx -> ok", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const r = await new WebPushSender(CONFIG).enviar(SUSCRIPCION, "{}");
    expect(r).toEqual({ status: "ok" });
  });

  it("⭑ R33: 404 -> caducada (hay que BORRARLA y no reintentar)", async () => {
    sendNotification.mockRejectedValue(errorHttp(404));
    expect(await new WebPushSender(CONFIG).enviar(SUSCRIPCION, "{}")).toEqual({
      status: "caducada",
    });
  });

  it("⭑ R33: 410 Gone -> caducada", async () => {
    sendNotification.mockRejectedValue(errorHttp(410));
    expect(await new WebPushSender(CONFIG).enviar(SUSCRIPCION, "{}")).toEqual({
      status: "caducada",
    });
  });

  it("⭑ R34: 429 -> transitorio («ahora no», no «nunca»)", async () => {
    sendNotification.mockRejectedValue(errorHttp(429));
    const r = await new WebPushSender(CONFIG).enviar(SUSCRIPCION, "{}");
    expect(r.status).toBe("transitorio");
  });

  it("⭑ R34: 500 -> transitorio", async () => {
    sendNotification.mockRejectedValue(errorHttp(500));
    expect((await new WebPushSender(CONFIG).enviar(SUSCRIPCION, "{}")).status).toBe("transitorio");
  });

  it("⭑ R34: un fallo de RED (sin codigo) -> transitorio", async () => {
    sendNotification.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    expect((await new WebPushSender(CONFIG).enviar(SUSCRIPCION, "{}")).status).toBe("transitorio");
  });

  it("⭑ 400 -> rechazada: el problema es NUESTRO y la suscripcion NO se borra", async () => {
    sendNotification.mockRejectedValue(errorHttp(400));
    const r = await new WebPushSender(CONFIG).enviar(SUSCRIPCION, "{}");
    // Ni `caducada` (borraria la suscripcion de la persona por un bug nuestro) ni `transitorio`
    // (reintentar un payload mal formado gasta la cola tres veces para nada).
    expect(r.status).toBe("rechazada");
  });

  it("⭑ 403 (claves VAPID que no casan) -> rechazada, no caducada", async () => {
    sendNotification.mockRejectedValue(errorHttp(403));
    expect((await new WebPushSender(CONFIG).enviar(SUSCRIPCION, "{}")).status).toBe("rechazada");
  });
});

describe("410 — NUNCA lanza por un desenlace HTTP", () => {
  it("⭑ ninguno de los ocho caminos propaga una excepcion", async () => {
    const sender = new WebPushSender(CONFIG);
    const casos = [404, 410, 429, 500, 400, 403, 502];
    for (const status of casos) {
      sendNotification.mockRejectedValue(errorHttp(status));
      await expect(sender.enviar(SUSCRIPCION, "{}")).resolves.toBeDefined();
    }
    // Y tambien con un error de forma inesperada (un `throw "texto"`, por ejemplo).
    sendNotification.mockRejectedValue("algo raro");
    await expect(sender.enviar(SUSCRIPCION, "{}")).resolves.toEqual({
      status: "transitorio",
      detalle: "suscripcion sus-7: sin respuesta",
    });
  });
});

describe("410/R23 — el `detalle` cita el id PROPIO, jamas el endpoint ni las claves", () => {
  it("⭑ barrido sobre TODOS los desenlaces con detalle", async () => {
    const sender = new WebPushSender(CONFIG);
    const detalles: string[] = [];
    for (const status of [429, 500, 400, 403]) {
      sendNotification.mockRejectedValue(errorHttp(status));
      const r = await sender.enviar(SUSCRIPCION, "{}");
      if ("detalle" in r) detalles.push(r.detalle);
    }
    sendNotification.mockRejectedValue(new Error("red"));
    const red = await sender.enviar(SUSCRIPCION, "{}");
    if ("detalle" in red) detalles.push(red.detalle);

    // AUTOCOMPROBACION: si el barrido no recogiera nada, el `for` de abajo pasaria por vacio.
    expect(detalles).toHaveLength(5);
    for (const detalle of detalles) {
      expect(detalle).toContain("sus-7"); // el identificador PROPIO, que es lo unico citable
      expect(detalle).not.toContain(SUSCRIPCION.endpoint);
      expect(detalle).not.toContain("ENDPOINT-SECRETO");
      expect(detalle).not.toContain(SUSCRIPCION.p256dh);
      expect(detalle).not.toContain(SUSCRIPCION.auth);
    }
  });
});

describe("410 — lo que se le pasa a la libreria", () => {
  it("⭑ el trio de la suscripcion, las claves VAPID y un TTL corto", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    await new WebPushSender(CONFIG).enviar(SUSCRIPCION, '{"titulo":"hola"}');

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [suscripcion, payload, opciones] = sendNotification.mock.calls[0] as [
      { endpoint: string; keys: { p256dh: string; auth: string } },
      string,
      { vapidDetails: { publicKey: string; privateKey: string; subject: string }; TTL: number; timeout: number },
    ];
    expect(suscripcion.endpoint).toBe(SUSCRIPCION.endpoint);
    expect(suscripcion.keys).toEqual({ p256dh: "P256DH-SECRETO", auth: "AUTH-SECRETO" });
    expect(payload).toBe('{"titulo":"hola"}');
    expect(opciones.vapidDetails.privateKey).toBe("PRIVADA-de-mentira");
    // TTL de 4 h, escrito a mano: todo lo que este canal empuja tiene PLAZO, y un aviso de ayer
    // que aparece manana es ruido con la fecha equivocada.
    expect(opciones.TTL).toBe(4 * 60 * 60);
    expect(opciones.timeout).toBe(10_000);
  });
});
