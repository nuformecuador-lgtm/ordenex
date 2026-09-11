import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { handleAvisosDiarios } from "@/app/api/cron/avisos-diarios/route";
import type {
  AvisosDiariosResumen,
  IAvisosDiariosService,
} from "@/lib/interfaces/services/IAvisosDiariosService";

// FICHA 409 (T4.3) — Controller del cron de avisos diarios. Cubre R59 (401 SIN EFECTOS: ni se
// construye el service ni se toca la DB, tampoco cuando el secreto no esta configurado) y R61 (el
// cuerpo 200 lleva SOLO conteos agregados y la fecha, ninguna clave con un identificador).

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SECRET = "s3cr3t-cron";

const RESUMEN: AvisosDiariosResumen = {
  fecha: "2026-09-11",
  tiendasConNovedades: 4,
  avisosNovedadesEmitidos: 4,
  ordenesRepresadas: 7,
  zonasConRepresadas: 2,
  avisosRepresadasEmitidos: 3,
  fallos: 0,
};

function fakeService(spy = vi.fn<(now: Date) => Promise<AvisosDiariosResumen>>(async () => RESUMEN)): {
  service: IAvisosDiariosService;
  spy: typeof spy;
} {
  return { service: { ejecutar: spy }, spy };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/cron/avisos-diarios", { method: "GET", headers });
}

describe("R59 — sin el secreto correcto, 401 y NINGUN efecto", () => {
  it("sin header Authorization -> 401 y el service no se invoca", async () => {
    const { service, spy } = fakeService();
    const res = await handleAvisosDiarios(req(), { getSecret: () => SECRET, service });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("token incorrecto -> 401 sin efectos", async () => {
    const { service, spy } = fakeService();
    const res = await handleAvisosDiarios(req({ authorization: "Bearer wrong" }), {
      getSecret: () => SECRET,
      service,
    });

    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("header mal formado (sin `Bearer`) -> 401", async () => {
    const { service, spy } = fakeService();
    const res = await handleAvisosDiarios(req({ authorization: SECRET }), {
      getSecret: () => SECRET,
      service,
    });

    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("secreto NO CONFIGURADO -> 401 aunque venga un token: el endpoint no queda abierto", async () => {
    const { service, spy } = fakeService();
    const res = await handleAvisosDiarios(req({ authorization: "Bearer loquesea" }), {
      getSecret: () => null,
      service,
    });

    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("el 401 NO se construye el service REAL: `deps.service` ni se mira", async () => {
    // Sin `service` en las deps, un 200 intentaria construir el real (y tocaria la DB). Que esto
    // responda 401 sin lanzar es la prueba de que la autorizacion va ANTES de cualquier efecto.
    const res = await handleAvisosDiarios(req(), { getSecret: () => SECRET });
    expect(res.status).toBe(401);
  });
});

describe("R61 — el cuerpo 200 lleva SOLO conteos y la fecha", () => {
  it("token correcto -> 200 con exactamente las claves declaradas", async () => {
    const { service, spy } = fakeService();
    const res = await handleAvisosDiarios(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => new Date("2026-09-11T13:00:00.000Z"),
    });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].toISOString()).toBe("2026-09-11T13:00:00.000Z");

    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        "avisosNovedadesEmitidos",
        "avisosRepresadasEmitidos",
        "fallos",
        "fecha",
        "ordenesRepresadas",
        "tiendasConNovedades",
        "zonasConRepresadas",
      ].sort(),
    );
    expect(body.fecha).toBe("2026-09-11");
    expect(body.ordenesRepresadas).toBe(7);
  });

  it("ninguna clave del cuerpo nombra un identificador", async () => {
    const { service } = fakeService();
    const res = await handleAvisosDiarios(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    const body = (await res.json()) as Record<string, unknown>;

    for (const clave of Object.keys(body)) {
      expect(clave).not.toMatch(/id$|ids$|Id$|Ids$|usuario|tiendaId|zonaId|orden(?!es)/);
    }
    // Y ningun VALOR es un uuid: si un identificador se colara, se veria aqui.
    for (const valor of Object.values(body)) {
      expect(String(valor)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    }
  });

  it("un campo nuevo en el resumen NO cruza solo a la respuesta (se enumera campo a campo)", async () => {
    // El servicio devuelve algo de mas —como pasaria el dia que gane un campo con un id— y el
    // controller lo deja fuera porque construye el cuerpo clave a clave.
    const conExtra = {
      ...RESUMEN,
      tiendaMasCargadaId: "11111111-1111-4111-8111-111111111111",
    } as AvisosDiariosResumen;
    const res = await handleAvisosDiarios(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service: { ejecutar: async () => conExtra },
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty("tiendaMasCargadaId");
  });
});

describe("el cron va a las 07:00 CR = 13:00 UTC, y esta escrito en `vercel.json`", () => {
  it("la entrada existe con `0 13 * * *` — y NO con `0 7 * * *`", () => {
    // ⚠️ `vercel.json` va en UTC y Costa Rica es UTC−6 FIJO. `0 7 * * *` pondria el aviso a la
    // 1:00 de la madrugada CR, que es justo la hora a la que la ficha 410 no debe empujar un push
    // al telefono de nadie. Los crons vecinos usan `0 6 * * *`, que es MEDIANOCHE CR.
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const entrada = vercel.crons.find((c) => c.path === "/api/cron/avisos-diarios");

    expect(entrada).toBeDefined();
    expect(entrada?.schedule).toBe("0 13 * * *");
  });
});
