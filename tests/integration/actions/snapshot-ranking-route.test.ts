import { describe, it, expect, vi, afterEach } from "vitest";
import { handleSnapshotRanking } from "@/app/api/cron/snapshot-ranking/route";
import { defaultLogger } from "@/lib/errors/logger";
import type {
  CongelarResult,
  IRankingSnapshotService,
} from "@/lib/interfaces/services/IRankingSnapshotService";

// Feature 196 (R19-R22) — Controller del cron del snapshot diario del ranking. Valida el
// CRON_SECRET (401 sin efectos), delega en el service (200 con `{fecha, estado, filas}` y sin
// PII) y NUNCA emite el secreto ni datos personales en la respuesta ni en los logs. Se inyecta
// el secreto + un service fake + el reloj: sin DB real ni entorno.
//
// Patron: `tests/integration/actions/corte-diario-route.test.ts`.

const SECRET = "s3cr3t-cron";
const AHORA = new Date("2026-08-11T08:00:00.000Z"); // 02:00 CR del 11 -> congela el 10

/** Resultado tipico del service: fecha D−1, estado y conteo. Ni un nombre, ni un id. */
const RESULTADO_CREADO: CongelarResult = { status: "creado", fecha: "2026-08-10", filas: 4 };

type Congelar = (now: Date) => Promise<CongelarResult>;

function fakeService(impl: Congelar = async () => RESULTADO_CREADO): {
  service: IRankingSnapshotService;
  spy: ReturnType<typeof vi.fn<Congelar>>;
} {
  const spy = vi.fn<Congelar>(impl);
  return {
    service: {
      congelar: spy,
      obtenerPorFecha: vi.fn(async () => ({ status: "forbidden" }) as const),
    },
    spy,
  };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/cron/snapshot-ranking", { method: "GET", headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleSnapshotRanking — autorizacion (R19)", () => {
  it("R19: sin header Authorization -> 401 y el service NUNCA se invoca", async () => {
    const { service, spy } = fakeService();
    const res = await handleSnapshotRanking(req(), { getSecret: () => SECRET, service });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R19: header mal formado (sin el esquema Bearer) -> 401 sin efectos", async () => {
    const { service, spy } = fakeService();
    const res = await handleSnapshotRanking(req({ authorization: SECRET }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R19: token distinto -> 401 sin efectos", async () => {
    const { service, spy } = fakeService();
    const res = await handleSnapshotRanking(req({ authorization: "Bearer wrong" }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R19: secreto NO configurado (null) -> 401 aunque venga un token (el endpoint no queda abierto)", async () => {
    const { service, spy } = fakeService();
    const res = await handleSnapshotRanking(req({ authorization: "Bearer whatever" }), {
      getSecret: () => null,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R19: sin autorizar NO se construye el service por defecto (no se toca la DB)", async () => {
    // Sin `deps.service`, un 200 exigiria construir el service real (Prisma) y reventaria.
    // Que responda 401 limpio es la prueba de que la autorizacion corre ANTES de todo efecto.
    const res = await handleSnapshotRanking(req(), { getSecret: () => SECRET });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("handleSnapshotRanking — respuesta correcta (R20/R21)", () => {
  it("R20: token correcto -> 200 con EXACTAMENTE {fecha, estado, filas}", async () => {
    const { service, spy } = fakeService();
    const res = await handleSnapshotRanking(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => AHORA,
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(AHORA);
    const body = await res.json();
    expect(body).toEqual({ fecha: "2026-08-10", estado: "creado", filas: 4 });
    expect(Object.keys(body).sort()).toEqual(["estado", "fecha", "filas"]);
    // El dominio dice `status`; el borde HTTP dice `estado` (design §5).
    expect(body).not.toHaveProperty("status");
  });

  it("R20: reejecucion de una fecha ya congelada -> 200 con estado 'omitido' (no es un error)", async () => {
    const { service } = fakeService(async () => ({
      status: "omitido",
      fecha: "2026-08-10",
      filas: 7,
    }));
    const res = await handleSnapshotRanking(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => AHORA,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fecha: "2026-08-10", estado: "omitido", filas: 7 });
  });

  it("R20/R21: el cuerpo no lleva PII (ni nombres ni ids) ni el secreto", async () => {
    const { service } = fakeService();
    const res = await handleSnapshotRanking(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => AHORA,
    });
    const body = (await res.json()) as Record<string, unknown>;
    const texto = JSON.stringify(body);
    expect(texto).not.toContain(SECRET);
    // Ninguna clave de persona: el cuerpo son tres escalares agregados y nada mas.
    for (const clave of Object.keys(body)) {
      expect(["fecha", "estado", "filas"]).toContain(clave);
      expect(clave.toLowerCase()).not.toMatch(/nombre|mensajero|usuario|_?id$/);
    }
    // Ni un identificador tecnico colado como valor (cuid/uuid).
    expect(texto).not.toMatch(/c[a-z0-9]{24}/i);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
  });
});

describe("handleSnapshotRanking — fallo del congelado (R21/R22)", () => {
  it("R22: si el service lanza, responde error controlado y registra por logError", async () => {
    const logSpy = vi.spyOn(defaultLogger, "logError").mockImplementation(() => {});
    const { service } = fakeService(async () => {
      throw new Error("db down");
    });
    const res = await handleSnapshotRanking(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => AHORA,
    });
    // withErrorHandler normaliza a un AppErrorShape (5xx) y NO falla en silencio.
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("R21: ni el cuerpo del error ni las llamadas al logger contienen el secreto", async () => {
    const logSpy = vi.spyOn(defaultLogger, "logError").mockImplementation(() => {});
    const { service } = fakeService(async () => {
      throw new Error("db down");
    });
    const res = await handleSnapshotRanking(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => AHORA,
    });
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain(SECRET);
    const registrado = logSpy.mock.calls
      .flat()
      .map((arg) => (arg instanceof Error ? `${arg.message}${arg.stack ?? ""}` : String(arg)))
      .join("|");
    expect(registrado).not.toContain(SECRET);
  });
});
