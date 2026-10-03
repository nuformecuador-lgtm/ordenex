import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PurgaDescargasResultado } from "@/lib/interfaces/services/IPurgaDescargasService";
import type { IAlmacenDescargas } from "@/lib/interfaces/external/IAlmacenDescargas";

// Ficha 470 (T2.3, R17–R20) — el cron de purga de las descargas temporales. Los dobles del composition
// root impiden que ningun camino construya el Storage real (el `.env` local apunta a PRODUCCION).
const infra = vi.hoisted(() => ({
  almacenCtor: vi.fn<(...args: unknown[]) => void>(),
  serviceCtor: vi.fn<(...args: unknown[]) => void>(),
  ejecutar: vi.fn<(now: Date) => Promise<PurgaDescargasResultado>>(async () => ({ objetosBorrados: 0, quedaPendiente: false })),
}));

vi.mock("@/lib/storage/SupabaseAlmacenDescargas", () => ({
  SupabaseAlmacenDescargas: class {
    constructor(...args: unknown[]) {
      infra.almacenCtor(...args);
    }
  },
}));
vi.mock("@/lib/services/PurgaDescargasService", async (original) => {
  const real = await original<typeof import("@/lib/services/PurgaDescargasService")>();
  return {
    ...real,
    PurgaDescargasService: class {
      ejecutar = infra.ejecutar;
      constructor(...args: unknown[]) {
        infra.serviceCtor(...args);
      }
    },
  };
});

import { GET, handlePurgaDescargas, maxDuration, runtime } from "@/app/api/cron/purga-descargas/route";

const SECRETO = "s3cr3t";
const conAuth = (token?: string) =>
  new Request("http://localhost/api/cron/purga-descargas", token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } });

beforeEach(() => {
  infra.almacenCtor.mockClear();
  infra.serviceCtor.mockClear();
  infra.ejecutar.mockClear();
});

describe("R19 — sin el secreto correcto: 401 y NADA se construye ni se lee", () => {
  it.each([
    ["sin header", conAuth(), SECRETO],
    ["secreto incorrecto", conAuth("otro"), SECRETO],
    ["secreto no configurado (null)", conAuth(SECRETO), null],
    ["secreto no configurado (vacio)", conAuth(""), ""],
  ])("%s ⇒ 401", async (_caso, req, esperado) => {
    const service = { ejecutar: vi.fn() };
    const res = await handlePurgaDescargas(req, { getSecret: () => esperado, service });
    expect(res.status).toBe(401);
    expect(service.ejecutar).not.toHaveBeenCalled();
    expect(infra.almacenCtor).not.toHaveBeenCalled();
    expect(infra.serviceCtor).not.toHaveBeenCalled();
  });

  it("el GET real sin header tambien es 401 sin construir nada", async () => {
    const res = await GET(conAuth());
    expect(res.status).toBe(401);
    expect(infra.almacenCtor).not.toHaveBeenCalled();
  });
});

describe("R20 — 200 con SOLO conteos", () => {
  it("el cuerpo es exactamente { objetosBorrados, quedaPendiente }", async () => {
    const service = { ejecutar: vi.fn(async () => ({ objetosBorrados: 7, quedaPendiente: true, ruta: "tmp/x.json.gz" }) as never) };
    const res = await handlePurgaDescargas(conAuth(SECRETO), { getSecret: () => SECRETO, service });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ objetosBorrados: 7, quedaPendiente: true });
  });

  it("un fallo del servicio sale con codigo de error (no 200) y sin rutas", async () => {
    const service = { ejecutar: vi.fn(async () => Promise.reject(new Error("fallo al borrar descargas temporales: boom"))) };
    const res = await handlePurgaDescargas(conAuth(SECRETO), { getSecret: () => SECRETO, service });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/tmp\//);
  });
});

describe("R17 — el corte es now − RETENCION_MINUTOS exacto", () => {
  it("PurgaDescargasService pide al almacen el corte exacto y el tope por corrida", async () => {
    const { PurgaDescargasService, MAX_OBJETOS_POR_CORRIDA } = await vi.importActual<typeof import("@/lib/services/PurgaDescargasService")>(
      "@/lib/services/PurgaDescargasService",
    );
    const purgarAnterioresA = vi.fn<IAlmacenDescargas["purgarAnterioresA"]>(async () => ({ borrados: 3, quedaPendiente: false }));
    const almacen: IAlmacenDescargas = { guardar: vi.fn(), firmar: vi.fn(), purgarAnterioresA };
    const leer = vi.fn(() => ({ RETENCION_MINUTOS: 60 }));
    const now = new Date("2026-10-02T12:00:00.000Z");
    const r = await new PurgaDescargasService(almacen, leer).ejecutar(now);
    expect(purgarAnterioresA).toHaveBeenCalledWith(new Date("2026-10-02T11:00:00.000Z"), MAX_OBJETOS_POR_CORRIDA);
    expect(MAX_OBJETOS_POR_CORRIDA).toBe(5000);
    expect(r).toEqual({ objetosBorrados: 3, quedaPendiente: false });
    // La retencion se lee EN CADA corrida.
    leer.mockReturnValue({ RETENCION_MINUTOS: 15 });
    await new PurgaDescargasService(almacen, leer).ejecutar(now);
    expect(purgarAnterioresA).toHaveBeenLastCalledWith(new Date("2026-10-02T11:45:00.000Z"), 5000);
  });

  it("el GET real construye el almacen con el bucket «descargas» y pasa el reloj al servicio", async () => {
    vi.stubEnv("CRON_SECRET", SECRETO);
    try {
      const res = await GET(conAuth(SECRETO));
      expect(res.status).toBe(200);
      expect(infra.almacenCtor).toHaveBeenCalledWith(undefined, "descargas");
      expect(infra.ejecutar).toHaveBeenCalledTimes(1);
      expect(infra.ejecutar.mock.calls[0][0]).toBeInstanceOf(Date);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("runtime nodejs y maxDuration 60", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });
});

describe("R18 — vercel.json la programa al menos cada 15 minutos", () => {
  it("la ruta esta en los crons con */15 (o mas frecuente)", () => {
    const json = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const entradas = json.crons.filter((c) => c.path === "/api/cron/purga-descargas");
    expect(entradas).toHaveLength(1);
    const m = /^\*\/(\d+) \* \* \* \*$/.exec(entradas[0].schedule) ?? /^(\*) \* \* \* \*$/.exec(entradas[0].schedule);
    expect(m, `cadencia no reconocida: ${entradas[0].schedule}`).not.toBeNull();
    const cada = m![1] === "*" ? 1 : Number(m![1]);
    expect(cada).toBeLessThanOrEqual(15);
  });
});
