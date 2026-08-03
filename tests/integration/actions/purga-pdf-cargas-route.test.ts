import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import type { PurgaResultado } from "@/lib/interfaces/services/IPurgaPdfCargasService";
import { etiquetasConfig } from "@/lib/config/etiquetas";
import { postulacionConfig } from "@/lib/config/postulacion";
import { loadPurgaPdfConfig } from "@/lib/config/purga-pdf";

// Feature 178 (Bloque E, T18-T22) — Controller del cron DIARIO de purga de los PDF de cargas.
// Valida el CRON_SECRET (401 sin efectos, R25), delega en el service (200 con el resumen agregado
// sin PII, R23/R24), distingue el fallo con un codigo != 200 (R23), construye el storage contra el
// BUCKET DE ETIQUETAS en el composition root (R11) y registra el cron en vercel.json a las 03:00 CR
// (R18). Los tests del handler inyectan secreto + service doble (sin DB, sin red, sin entorno); los
// del composition root ejercitan el `GET` REAL con los modulos de infraestructura mockeados.

// --- Dobles del composition root (solo los toca el `GET` real; el handler con `service` inyectado
// --- no los construye nunca, que es justo lo que afirman los tests de R25).
const infra = vi.hoisted(() => ({
  storageCtor: vi.fn<(...args: unknown[]) => void>(),
  repoCtor: vi.fn<(...args: unknown[]) => void>(),
  serviceCtor: vi.fn<(...args: unknown[]) => void>(),
  prismaCtor: vi.fn<() => unknown>(() => ({ marca: "prisma-doble" })),
  ejecutar: vi.fn<(now: Date) => Promise<PurgaResultado>>(async () => ({
    cargasPurgadas: 0,
    ordenesAfectadas: 0,
    objetosBorrados: 0,
    quedaPendiente: false,
  })),
}));

vi.mock("@/lib/db/prisma-client", () => ({ getPrismaClient: infra.prismaCtor }));

vi.mock("@/lib/storage/SupabaseFileStorage", () => ({
  // OJO: el doble NO reproduce el valor por defecto del 2o parametro
  // (`postulacionConfig.BUCKET`) a proposito: si la ruta dejara de pasarlo, el argumento capturado
  // seria `undefined` y el test de R11 se pondria ROJO en vez de tragarse el default silencioso.
  SupabaseFileStorage: class {
    constructor(...args: unknown[]) {
      infra.storageCtor(...args);
    }
  },
}));

vi.mock("@/lib/repositories/PurgaPdfCargasRepository", () => ({
  PurgaPdfCargasRepository: class {
    constructor(...args: unknown[]) {
      infra.repoCtor(...args);
    }
  },
}));

vi.mock("@/lib/services/PurgaPdfCargasService", () => ({
  PurgaPdfCargasService: class {
    ejecutar = infra.ejecutar;
    constructor(...args: unknown[]) {
      infra.serviceCtor(...args);
    }
  },
}));

const { handlePurgaPdfCargas, GET, maxDuration } = await import(
  "@/app/api/cron/purga-pdf-cargas/route"
);

const SECRET = "s3cr3t-cron";

const RESUMEN: PurgaResultado = {
  cargasPurgadas: 12,
  ordenesAfectadas: 348,
  objetosBorrados: 360,
  quedaPendiente: false,
};

function fakeService(spy = vi.fn<(now: Date) => Promise<PurgaResultado>>(async () => RESUMEN)): {
  service: { ejecutar: typeof spy };
  spy: typeof spy;
} {
  return { service: { ejecutar: spy }, spy };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/cron/purga-pdf-cargas", { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  infra.ejecutar.mockResolvedValue({
    cargasPurgadas: 0,
    ordenesAfectadas: 0,
    objetosBorrados: 0,
    quedaPendiente: false,
  });
});

describe("handlePurgaPdfCargas — corrida correcta (R23/R24)", () => {
  it("R23/R24: token correcto -> 200 con el resumen agregado SOLO numerico (sin PII ni rutas)", async () => {
    const { service, spy } = fakeService();
    const res = await handlePurgaPdfCargas(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toEqual({
      cargasPurgadas: 12,
      ordenesAfectadas: 348,
      objetosBorrados: 360,
      quedaPendiente: false,
    });
    // R24: el cuerpo NO filtra el secreto ni ninguna cadena (rutas, ids): solo numeros y un bool.
    const texto = JSON.stringify(body);
    expect(texto).not.toContain(SECRET);
    expect(
      Object.values(body as Record<string, unknown>).every(
        (v) => typeof v === "number" || typeof v === "boolean",
      ),
    ).toBe(true);
  });

  it("R23/R22: propaga quedaPendiente=true en el 200 (la corrida acotada termina en EXITO)", async () => {
    const { service } = fakeService(vi.fn(async () => ({ ...RESUMEN, quedaPendiente: true })));
    const res = await handlePurgaPdfCargas(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).quedaPendiente).toBe(true);
  });

  it("R23: pasa el reloj inyectado CRUDO al service (el corte es now − N dias, no un dia natural)", async () => {
    const { service, spy } = fakeService();
    const now = new Date("2026-08-03T09:00:00.000Z");
    await handlePurgaPdfCargas(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => now,
    });
    const arg = spy.mock.calls[0][0];
    expect(arg.toISOString()).toBe("2026-08-03T09:00:00.000Z");
  });

  it("R23: la ruta declara maxDuration para que el tope por corrida tenga presupuesto explicito", () => {
    expect(typeof maxDuration).toBe("number");
    expect(maxDuration).toBeGreaterThan(10); // por encima del default de plataforma
  });
});

describe("handlePurgaPdfCargas — autorizacion (R25)", () => {
  it("R25: sin header Authorization -> 401 SIN ejecutar la purga (el service no se invoca)", async () => {
    const { service, spy } = fakeService();
    const res = await handlePurgaPdfCargas(req(), { getSecret: () => SECRET, service });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R25: token incorrecto -> 401 sin efectos (el service no se invoca)", async () => {
    const { service, spy } = fakeService();
    const res = await handlePurgaPdfCargas(req({ authorization: "Bearer wrong" }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R25: secreto NO configurado en el entorno -> 401 aunque venga un token (el endpoint no queda abierto)", async () => {
    for (const noConfigurado of [null, ""] as const) {
      const { service, spy } = fakeService();
      const res = await handlePurgaPdfCargas(req({ authorization: "Bearer whatever" }), {
        getSecret: () => noConfigurado,
        service,
      });
      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("handlePurgaPdfCargas — fallo observable (R23)", () => {
  it("R23: si el service lanza, la respuesta NO es 200, el cuerpo no filtra secreto ni PII, y el error queda registrado", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const boom = vi.fn(async () => {
        throw new Error(`fallo borrando 9f3a/1b2c.pdf con secreto ${SECRET}`);
      });
      const res = await handlePurgaPdfCargas(req({ authorization: `Bearer ${SECRET}` }), {
        getSecret: () => SECRET,
        service: { ejecutar: boom },
      });
      expect(res.status).not.toBe(200);
      expect(res.status).toBeGreaterThanOrEqual(500);
      const texto = JSON.stringify(await res.json());
      expect(texto).not.toContain(SECRET); // sin secreto
      expect(texto).not.toContain("9f3a"); // sin rutas de objeto (llevan el id del usuario)
      expect(texto).not.toContain("1b2c.pdf");
      // el fallo queda registrado por el canal de servidor (unica traza sin cola de jobs)
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("GET — composition root (R11/R25)", () => {
  const envPrevia = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    if (envPrevia === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = envPrevia;
  });

  it("R11: construye SupabaseFileStorage con ETIQUETAS_BUCKET y NUNCA con el bucket de postulaciones", async () => {
    // Guardia del propio test: si los dos buckets coincidieran, la asercion no discriminaria.
    expect(etiquetasConfig.ETIQUETAS_BUCKET).not.toBe(postulacionConfig.BUCKET);

    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);

    expect(infra.storageCtor).toHaveBeenCalledTimes(1);
    const args = infra.storageCtor.mock.calls[0];
    // Se pasan LOS DOS argumentos: cliente perezoso (undefined) + bucket EXPLICITO. Omitir el 2o
    // dejaria `args[1] === undefined` y este bloque en rojo.
    expect(args).toHaveLength(2);
    expect(args[0]).toBeUndefined();
    expect(args[1]).toBe(etiquetasConfig.ETIQUETAS_BUCKET);
    expect(args[1]).not.toBe(postulacionConfig.BUCKET);
  });

  it("R11/R4: cablea repo + storage + el LECTOR de config (funcion sin invocar) en el service", async () => {
    await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(infra.repoCtor).toHaveBeenCalledTimes(1);
    expect(infra.serviceCtor).toHaveBeenCalledTimes(1);
    const [repo, storage, leerConfig] = infra.serviceCtor.mock.calls[0];
    expect(repo).toBeDefined();
    expect(storage).toBeDefined();
    // R4: se pasa la FUNCION, no su resultado ya resuelto.
    expect(leerConfig).toBe(loadPurgaPdfConfig);
  });

  it("R25: sin Authorization, el GET real responde 401 sin construir NADA (ni repo, ni storage, ni service)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(infra.storageCtor).not.toHaveBeenCalled();
    expect(infra.repoCtor).not.toHaveBeenCalled();
    expect(infra.serviceCtor).not.toHaveBeenCalled();
    expect(infra.prismaCtor).not.toHaveBeenCalled();
    expect(infra.ejecutar).not.toHaveBeenCalled();
  });

  it("R25: con CRON_SECRET ausente del entorno, el GET real responde 401 sin construir NADA", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ authorization: "Bearer whatever" }));
    expect(res.status).toBe(401);
    expect(infra.storageCtor).not.toHaveBeenCalled();
    expect(infra.repoCtor).not.toHaveBeenCalled();
    expect(infra.serviceCtor).not.toHaveBeenCalled();
    expect(infra.prismaCtor).not.toHaveBeenCalled();
    expect(infra.ejecutar).not.toHaveBeenCalled();
  });
});

describe("R18 — el cron esta registrado en vercel.json a las 03:00 America/Costa_Rica", () => {
  const RUTA = "/api/cron/purga-pdf-cargas";
  const SCHEDULE = "0 9 * * *"; // 03:00 CR; Costa Rica es UTC−6 FIJO (sin horario de verano)

  function leerCrons(): { path: string; schedule: string }[] {
    const raw = fs.readFileSync(path.join(__dirname, "..", "..", "..", "vercel.json"), "utf8");
    return (JSON.parse(raw) as { crons: { path: string; schedule: string }[] }).crons;
  }

  it("R18: vercel.json define /api/cron/purga-pdf-cargas con schedule '0 9 * * *' (= 03:00 CR)", () => {
    const cron = leerCrons().find((c) => c.path === RUTA);
    expect(cron).toBeDefined();
    expect(cron?.schedule).toBe(SCHEDULE);
  });

  it("R18: el schedule es DIARIO (5 campos, minuto y hora fijos, dia/mes/dia-semana '*')", () => {
    const campos = leerCrons().find((c) => c.path === RUTA)!.schedule.split(/\s+/);
    expect(campos).toHaveLength(5);
    const [minuto, hora, diaMes, mes, diaSemana] = campos;
    expect(minuto).toMatch(/^\d+$/);
    expect(hora).toMatch(/^\d+$/);
    expect([diaMes, mes, diaSemana]).toEqual(["*", "*", "*"]);
    expect(`${minuto} ${hora}`).toBe("0 9");
  });

  it("R18: ningun otro cron diario comparte su 'minuto hora' (no colisiona con corte-diario, generar-gastos-fijos ni sync-plantillas-whatsapp)", () => {
    const crons = leerCrons();
    const propio = crons.find((c) => c.path === RUTA)!;
    const franja = (s: string) => s.split(/\s+/).slice(0, 2).join(" ");
    const esDiario = (s: string) => {
      const [minuto, hora, ...resto] = s.split(/\s+/);
      return /^\d+$/.test(minuto) && /^\d+$/.test(hora) && resto.every((c) => c === "*");
    };

    const otrosDiarios = crons.filter((c) => c.path !== RUTA && esDiario(c.schedule));
    // control: si no hubiera otros crons diarios, la asercion de abajo no discriminaria nada.
    expect(otrosDiarios.length).toBeGreaterThan(0);
    for (const otro of otrosDiarios) {
      expect(franja(otro.schedule)).not.toBe(franja(propio.schedule));
    }

    // Franjas concretas medidas hoy, nombradas para que el choque salte por su nombre.
    expect(crons.find((c) => c.path === "/api/cron/corte-diario")?.schedule).toBe("0 6 * * *");
    expect(crons.find((c) => c.path === "/api/cron/generar-gastos-fijos")?.schedule).toBe(
      "0 6 * * *",
    );
    expect(crons.find((c) => c.path === "/api/cron/sync-plantillas-whatsapp")?.schedule).toBe(
      "0 3 * * *",
    );
  });

  it("R18: la entrada nueva no altera ni reordena las cinco existentes", () => {
    const crons = leerCrons();
    expect(crons.map((c) => c.path)).toEqual([
      "/api/cron/corte-diario",
      "/api/cron/generar-gastos-fijos",
      "/api/cron/procesar-jobs",
      "/api/cron/procesar-devueltas-sla",
      "/api/cron/sync-plantillas-whatsapp",
      RUTA,
    ]);
  });
});
