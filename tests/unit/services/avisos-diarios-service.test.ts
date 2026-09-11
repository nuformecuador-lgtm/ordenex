import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AvisosDiariosService } from "@/lib/services/AvisosDiariosService";
import type {
  IAvisoAgregadoRepository,
  ResumenNovedadesTienda,
  ResumenRepresadas,
  ResumenRepresadasZona,
} from "@/lib/interfaces/repositories/IAvisoAgregadoRepository";
import type {
  DevolucionesRepresadasContexto,
  NovedadesSinGestionarContexto,
} from "@/lib/notificaciones/emitir";

// FICHA 409 (T4.2) — EL PROCESO DIARIO, con repositorio y notificadores dobles. Cubre R43 (tienda
// sin novedades no recibe), R48 (la zona lleva SU numero), R49 (la administracion central lleva el
// total), R52 (zona con cero no recibe), R53 (el umbral entra INYECTADO) y R60 (best-effort por
// destinatario: un fallo no tumba la corrida).

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DIA_MS = 24 * 60 * 60 * 1000;
/** 2026-09-11 a las 07:00 CR = 13:00 UTC, la hora real del cron. */
const AHORA = new Date("2026-09-11T13:00:00.000Z");
const DIA_CR = "2026-09-11";

const ZONA_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ZONA_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

function hace(dias: number): Date {
  return new Date(AHORA.getTime() - dias * DIA_MS);
}

interface RepoOpts {
  novedades?: ResumenNovedadesTienda[];
  porZona?: ResumenRepresadasZona[];
  global?: ResumenRepresadas;
}

function repoDoble(opts: RepoOpts = {}): IAvisoAgregadoRepository & { llamadas: Date[] } {
  const llamadas: Date[] = [];
  return {
    llamadas,
    async resumenNovedadesPorTienda() {
      return opts.novedades ?? [];
    },
    async contarNovedadesDeTienda() {
      return 0;
    },
    async resumenRepresadasPorZona(ancladaAntesDe) {
      llamadas.push(ancladaAntesDe);
      return opts.porZona ?? [];
    },
    async resumenRepresadasGlobal(ancladaAntesDe) {
      llamadas.push(ancladaAntesDe);
      return opts.global ?? { total: 0, masAntiguaAt: null };
    },
    async contarRepresadas() {
      return 0;
    },
  };
}

/** Historial doble: sin intentos, para que la homogeneidad la decidan las causas. */
const historialSinIntentos = { contarIntentosEnLote: async () => new Map<string, number>() };

const loggerDoble = () => ({ logError: vi.fn() });

function novedadesDe(tiendaId: string, dias: number, causas: Array<string | null>) {
  return {
    tiendaId,
    total: causas.length,
    masAntiguaAt: hace(dias),
    ordenes: causas.map((causa, i) => ({
      ordenId: `${tiendaId}-orden-${i}`,
      causa: causa as ResumenNovedadesTienda["ordenes"][number]["causa"],
    })),
  };
}

describe("R43 — la tienda sin novedades NO recibe aviso", () => {
  it("no se llama al notificador cuando el resumen viene vacio", async () => {
    const notificar = vi.fn();
    const service = new AvisosDiariosService(repoDoble(), historialSinIntentos, 3, notificar);

    const r = await service.ejecutar(AHORA);

    expect(notificar).not.toHaveBeenCalled();
    expect(r.tiendasConNovedades).toBe(0);
    expect(r.avisosNovedadesEmitidos).toBe(0);
  });

  it("una tienda con `total: 0` en el resumen tampoco emite", async () => {
    const notificar = vi.fn();
    const service = new AvisosDiariosService(
      repoDoble({
        novedades: [
          { tiendaId: "t-vacia", total: 0, masAntiguaAt: hace(2), ordenes: [] },
          novedadesDe("t-con", 3, ["wrong_address"]),
        ],
      }),
      historialSinIntentos,
      3,
      notificar,
    );

    await service.ejecutar(AHORA);

    expect(notificar).toHaveBeenCalledTimes(1);
    expect((notificar.mock.calls[0][0] as NovedadesSinGestionarContexto).tiendaId).toBe("t-con");
  });
});

describe("R60 — una emision que falla no se lleva por delante a las demas", () => {
  it("tres tiendas, la segunda lanza: 2 emisiones, 1 fallo registrado y la corrida termina", async () => {
    const logger = loggerDoble();
    const notificar = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("la base no responde"))
      .mockResolvedValueOnce(undefined);
    const service = new AvisosDiariosService(
      repoDoble({
        novedades: [
          novedadesDe("t-1", 2, ["wrong_address"]),
          novedadesDe("t-2", 3, ["wrong_number"]),
          novedadesDe("t-3", 4, ["not_found"]),
        ],
      }),
      historialSinIntentos,
      3,
      notificar,
      undefined,
      logger,
    );

    const r = await service.ejecutar(AHORA);

    expect(notificar).toHaveBeenCalledTimes(3);
    expect(r.tiendasConNovedades).toBe(3);
    expect(r.avisosNovedadesEmitidos).toBe(2);
    expect(r.fallos).toBe(1);
    // No es un `catch` vacio: el fallo queda REGISTRADO con su operacion.
    expect(logger.logError).toHaveBeenCalledTimes(1);
    const registrado = logger.logError.mock.calls[0][0] as Error;
    expect(registrado.message).toContain("novedades_sin_gestionar");
  });
});

describe("R48/R49/R52 — cada ambito con SU numero y SU antiguedad", () => {
  it("dos zonas y el global: tres avisos, cada uno con su ambito", async () => {
    const notificar = vi.fn();
    const service = new AvisosDiariosService(
      repoDoble({
        global: { total: 7, masAntiguaAt: hace(8) },
        porZona: [
          { zonaId: ZONA_A, total: 4, masAntiguaAt: hace(8) },
          { zonaId: ZONA_B, total: 3, masAntiguaAt: hace(5) },
        ],
      }),
      historialSinIntentos,
      3,
      undefined,
      notificar,
    );

    const r = await service.ejecutar(AHORA);

    const ctxs = notificar.mock.calls.map((c) => c[0] as DevolucionesRepresadasContexto);
    expect(ctxs).toHaveLength(3);
    expect(ctxs[0].ambito).toEqual({ tipo: "global" });
    expect(ctxs[0].diasMasAntigua).toBe(8);
    expect(ctxs[1].ambito).toEqual({ tipo: "zona", zonaId: ZONA_A });
    expect(ctxs[1].diasMasAntigua).toBe(8);
    // ⚠️ LA MUTACION: usar el total/la antiguedad GLOBAL en el aviso de una zona. La zona B lleva
    // 5 dias, no 8; si el servicio pasara el ambito global, esta linea se pone roja.
    expect(ctxs[2].ambito).toEqual({ tipo: "zona", zonaId: ZONA_B });
    expect(ctxs[2].diasMasAntigua).toBe(5);
    expect(ctxs.every((c) => c.diaCR === DIA_CR)).toBe(true);

    expect(r.ordenesRepresadas).toBe(7);
    expect(r.zonasConRepresadas).toBe(2);
    expect(r.avisosRepresadasEmitidos).toBe(3);
  });

  it("R52: una zona con cero no recibe aviso, las demas si", async () => {
    const notificar = vi.fn();
    const service = new AvisosDiariosService(
      repoDoble({
        global: { total: 3, masAntiguaAt: hace(4) },
        porZona: [
          { zonaId: ZONA_A, total: 0, masAntiguaAt: hace(4) },
          { zonaId: ZONA_B, total: 3, masAntiguaAt: hace(4) },
        ],
      }),
      historialSinIntentos,
      3,
      undefined,
      notificar,
    );

    const r = await service.ejecutar(AHORA);

    const ambitos = notificar.mock.calls.map(
      (c) => (c[0] as DevolucionesRepresadasContexto).ambito,
    );
    expect(ambitos).toEqual([{ tipo: "global" }, { tipo: "zona", zonaId: ZONA_B }]);
    expect(r.zonasConRepresadas).toBe(1);
  });

  it("sin represadas en ningun ambito no se emite nada", async () => {
    const notificar = vi.fn();
    const service = new AvisosDiariosService(
      repoDoble(),
      historialSinIntentos,
      3,
      undefined,
      notificar,
    );

    const r = await service.ejecutar(AHORA);

    expect(notificar).not.toHaveBeenCalled();
    expect(r.avisosRepresadasEmitidos).toBe(0);
  });
});

describe("R53 — el umbral entra INYECTADO y no vive dentro del servicio", () => {
  it("con umbral 3, la cota que se pide al repositorio son 3 dias antes de ahora", async () => {
    const repo = repoDoble();
    await new AvisosDiariosService(repo, historialSinIntentos, 3).ejecutar(AHORA);

    expect(repo.llamadas.length).toBeGreaterThan(0); // autocomprobacion
    for (const cota of repo.llamadas) {
      expect(cota.toISOString()).toBe(hace(3).toISOString());
    }
  });

  it("con umbral 7 la cota se mueve: el numero NO esta escrito en el servicio", async () => {
    const repo = repoDoble();
    await new AvisosDiariosService(repo, historialSinIntentos, 7).ejecutar(AHORA);

    for (const cota of repo.llamadas) {
      expect(cota.toISOString()).toBe(hace(7).toISOString());
    }
  });

  it("el fuente del servicio no contiene el literal del umbral", () => {
    const fuente = fs.readFileSync(
      path.join(ROOT, "lib", "services", "AvisosDiariosService.ts"),
      "utf8",
    );
    // Ni `= 3`, ni `DIAS_REPRESAMIENTO = 3`: el valor llega por constructor.
    expect(fuente).not.toMatch(/DIAS_REPRESAMIENTO\s*=/);
    expect(fuente).not.toMatch(/diasRepresamiento\s*=\s*\d/);
  });
});

describe("R39/R40 — la homogeneidad del plazo la decide el servicio", () => {
  async function plazoDe(
    causas: Array<string | null>,
    intentos: Record<string, number> = {},
  ): Promise<string> {
    const notificar = vi.fn();
    const historial = {
      contarIntentosEnLote: async () => new Map(Object.entries(intentos)),
    };
    const service = new AvisosDiariosService(
      repoDoble({ novedades: [novedadesDe("t-1", 3, causas)] }),
      historial,
      3,
      notificar,
    );
    await service.ejecutar(AHORA);
    return (notificar.mock.calls[0][0] as NovedadesSinGestionarContexto).plazo;
  }

  it("todas `wrong_*` y ninguna en el tope -> cinco dias", async () => {
    expect(await plazoDe(["wrong_address", "wrong_number"])).toBe("cinco_dias");
  });

  it("todas `not_found` y ninguna en el tope -> veinticuatro horas", async () => {
    expect(await plazoDe(["not_found", "not_found"])).toBe("veinticuatro_horas");
  });

  it("causas MEZCLADAS -> mezclado", async () => {
    expect(await plazoDe(["wrong_address", "not_found"])).toBe("mezclado");
  });

  it("una gestion SIN causa cuenta como mezcla: no se adivina ventana", async () => {
    expect(await plazoDe(["wrong_address", null])).toBe("mezclado");
  });

  it("⚠️ todas de cinco dias pero UNA en el tope -> mezclado (mutacion: ignorar el tope)", async () => {
    // El umbral por defecto es 3 (`REINTENTOS_MIN_INTENTOS`), y `alcanzaElTope` compara
    // `intentos >= umbral - 1`, o sea 2. Con 2 intentos esa orden escala en la corrida SIGUIENTE
    // sin esperar sus cinco dias: prometerle cinco dias a la tienda seria darle mas tiempo del
    // que tiene.
    expect(await plazoDe(["wrong_address", "wrong_address"], { "t-1-orden-1": 2 })).toBe(
      "mezclado",
    );
    // Y con UN solo intento (por debajo del tope) sigue siendo homogeneo:
    expect(await plazoDe(["wrong_address", "wrong_address"], { "t-1-orden-1": 1 })).toBe(
      "cinco_dias",
    );
  });

  it("los intentos se piden UNA sola vez, para todas las tiendas de la corrida", async () => {
    const contarIntentosEnLote = vi.fn().mockResolvedValue(new Map<string, number>());
    const service = new AvisosDiariosService(
      repoDoble({
        novedades: [
          novedadesDe("t-1", 2, ["wrong_address"]),
          novedadesDe("t-2", 3, ["not_found"]),
        ],
      }),
      { contarIntentosEnLote },
      3,
    );

    await service.ejecutar(AHORA);

    expect(contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(contarIntentosEnLote.mock.calls[0][0]).toEqual(["t-1-orden-0", "t-2-orden-0"]);
  });
});

describe("el dia CR sale de la hora de pared de Costa Rica, no de UTC", () => {
  it("a las 19:00 CR sigue siendo el MISMO dia (en UTC ya seria el siguiente)", async () => {
    const notificar = vi.fn();
    // 2026-09-11 a las 19:00 CR = 2026-09-12T01:00:00Z.
    const nocheCR = new Date("2026-09-12T01:00:00.000Z");
    const service = new AvisosDiariosService(
      repoDoble({ novedades: [novedadesDe("t-1", 2, ["wrong_address"])] }),
      historialSinIntentos,
      3,
      notificar,
    );

    const r = await service.ejecutar(nocheCR);

    expect(r.fecha).toBe("2026-09-11");
    expect((notificar.mock.calls[0][0] as NovedadesSinGestionarContexto).diaCR).toBe("2026-09-11");
  });
});
