import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { handleProcesarDevueltasSla } from "@/app/api/cron/procesar-devueltas-sla/route";
import type {
  DevolucionSlaResult,
  IDevolucionSlaService,
} from "@/lib/interfaces/services/IDevolucionSlaService";

// Feature 99 (T11) — Controller del cron SLA. Valida el CRON_SECRET (401 sin efectos), delega en
// el service (200 con resumen sin PII), NUNCA loguea el secreto (R10/R11/R12), y le pasa el reloj
// inyectado CRUDO (R13). Se inyecta el secreto + un service fake (sin DB ni entorno). Tambien
// cubre la entrada de cron en vercel.json (path + schedule horario, R6).

const SECRET = "s3cr3t-cron";

function fakeService(
  spy = vi.fn<(now: Date) => Promise<DevolucionSlaResult>>(async () => ({
    evaluadas: 4,
    liberadas: 2,
    escaladas: 1,
    omitidas: 3,
    legadas: 0, // feature 239 (T3.3): quinto conteo, aditivo al contrato HTTP
  })),
): { service: IDevolucionSlaService; spy: typeof spy } {
  return { service: { ejecutar: spy }, spy };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/cron/procesar-devueltas-sla", { method: "GET", headers });
}

describe("handleProcesarDevueltasSla — autorizacion (R10)", () => {
  it("R10: sin header Authorization -> 401 SIN ejecutar el cron (ni construye el service)", async () => {
    const { service, spy } = fakeService();
    const res = await handleProcesarDevueltasSla(req(), { getSecret: () => SECRET, service });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R10: token incorrecto -> 401 sin efectos", async () => {
    const { service, spy } = fakeService();
    const res = await handleProcesarDevueltasSla(req({ authorization: "Bearer wrong" }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R10: secreto NO configurado (null) -> 401 aunque venga un token (endpoint no queda abierto)", async () => {
    const { service, spy } = fakeService();
    const res = await handleProcesarDevueltasSla(req({ authorization: "Bearer whatever" }), {
      getSecret: () => null,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R12/R11: token correcto -> 200 con conteos SIN PII (evaluadas/liberadas/escaladas/omitidas/legadas)", async () => {
    const { service, spy } = fakeService();
    const res = await handleProcesarDevueltasSla(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    // 2026-08-19 (feature 239/T3.3): el cuerpo gana `legadas`, el UNICO cambio del contrato HTTP
    // de este endpoint, y es aditivo. Cuenta las devoluciones ancladas por la rama LEGADA (sin
    // fila de `anclaje_devolucion`): sirve para ver extinguirse la poblacion que quedo en vuelo
    // el dia del despliegue. Sigue siendo un conteo agregado, sin PII (R11).
    expect(body).toEqual({
      evaluadas: 4,
      liberadas: 2,
      escaladas: 1,
      omitidas: 3,
      legadas: 0,
    });
    // R11: el cuerpo NO filtra el secreto.
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("R13: pasa el reloj inyectado CRUDO al service (ventana rolling, no corte diario)", async () => {
    const { service, spy } = fakeService();
    const now = new Date("2026-07-20T12:34:56.000Z");
    await handleProcesarDevueltasSla(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => now,
    });
    const arg = spy.mock.calls[0][0] as Date;
    // CRUDO: exactamente el `now` inyectado (no truncado a medianoche CR).
    expect(arg.toISOString()).toBe("2026-07-20T12:34:56.000Z");
  });
});

describe("handleProcesarDevueltasSla — errores del service (R11)", () => {
  it("R11: si el service lanza, responde error controlado sin filtrar el secreto", async () => {
    const boom = vi.fn(async () => {
      throw new Error("db down");
    });
    const res = await handleProcesarDevueltasSla(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service: { ejecutar: boom },
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET);
  });
});

describe("R6 — el cron esta registrado en vercel.json con schedule HORARIO", () => {
  it("vercel.json define /api/cron/procesar-devueltas-sla con schedule '0 * * * *'", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "..", "..", "vercel.json"), "utf8");
    const cfg = JSON.parse(raw) as { crons: { path: string; schedule: string }[] };
    const cron = cfg.crons.find((c) => c.path === "/api/cron/procesar-devueltas-sla");
    expect(cron).toBeDefined();
    expect(cron?.schedule).toBe("0 * * * *");
  });
});
