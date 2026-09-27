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
  ReprogramadasEsperanCierreContexto,
} from "@/lib/notificaciones/emitir";
import type {
  AmbitoRetenidas,
  CierreQueRetiene,
  MensajeroSinCierre,
  ResumenRetenidas,
} from "@/lib/interfaces/services/IReprogramadasRetenidasService";

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

/**
 * FICHA 462 (T2.7): el conteo de retenidas es una dependencia REQUERIDA del servicio. Este doble
 * devuelve un resumen VACIO (nada retenido) para que los casos de la 409 sigan midiendo lo que
 * median sin emitir el tercer agregado.
 */
const sinRetenidas = {
  resumen: async (): Promise<ResumenRetenidas> => ({
    diaCR: DIA_CR,
    total: 0,
    porForma: { reprogramado: 0, enReparto: 0 },
    cierres: [],
    sinCierre: [],
  }),
};

/** Un resumen de retenidas con lo que el caso pida (cierres y grupos «sin cierre»). */
function retenidasDe(partes: {
  cierres?: Array<{ ambito: AmbitoRetenidas; cuantas: number }>;
  sinCierre?: Array<{ ambito: AmbitoRetenidas; cuantas: number }>;
}) {
  const cierres: CierreQueRetiene[] = (partes.cierres ?? []).map((c, i) => ({
    cierreId: `c-${i}`,
    mensajeroId: `m-${i}`,
    mensajeroNombre: `Mensajero ${i}`,
    estado: "solicitado",
    jornadaCR: "2026-09-10",
    ambito: c.ambito,
    cuantas: c.cuantas,
  }));
  const sinCierre: MensajeroSinCierre[] = (partes.sinCierre ?? []).map((m, i) => ({
    mensajeroId: `ms-${i}`,
    mensajeroNombre: `Sin cierre ${i}`,
    ambito: m.ambito,
    cuantas: m.cuantas,
  }));
  const total = [...cierres, ...sinCierre].reduce((acc, x) => acc + x.cuantas, 0);
  const llamadas: Date[] = [];
  return {
    llamadas,
    resumen: async (hoyCR: Date): Promise<ResumenRetenidas> => {
      llamadas.push(hoyCR);
      return { diaCR: DIA_CR, total, porForma: { reprogramado: total, enReparto: 0 }, cierres, sinCierre };
    },
  };
}

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
    const service = new AvisosDiariosService(repoDoble(), historialSinIntentos, sinRetenidas, 3, notificar);

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
      sinRetenidas,
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
      sinRetenidas,
      3,
      notificar,
      undefined,
      undefined, // FICHA 462: el notificador de retenidas va antes del logger
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
      sinRetenidas,
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
      sinRetenidas,
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
      sinRetenidas,
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
    await new AvisosDiariosService(repo, historialSinIntentos, sinRetenidas, 3).ejecutar(AHORA);

    expect(repo.llamadas.length).toBeGreaterThan(0); // autocomprobacion
    for (const cota of repo.llamadas) {
      expect(cota.toISOString()).toBe(hace(3).toISOString());
    }
  });

  it("con umbral 7 la cota se mueve: el numero NO esta escrito en el servicio", async () => {
    const repo = repoDoble();
    await new AvisosDiariosService(repo, historialSinIntentos, sinRetenidas, 7).ejecutar(AHORA);

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
      sinRetenidas,
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
      sinRetenidas,
      3,
    );

    await service.ejecutar(AHORA);

    expect(contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(contarIntentosEnLote.mock.calls[0][0]).toEqual(["t-1-orden-0", "t-2-orden-0"]);
  });
});

// ---------------------------------------------------------------------------------------------
// FICHA 462 (T2.7) — EL TERCER AGREGADO: reprogramadas de hoy que esperan la aprobacion de un cierre.
// ---------------------------------------------------------------------------------------------

const ZONA_C = "cccccccc-3333-4333-8333-cccccccccccc";
const CENTRAL: AmbitoRetenidas = { tipo: "central" };
const zona = (zonaId: string): AmbitoRetenidas => ({ tipo: "zona", zonaId });

describe("462/R9/R12 — UN aviso por AMBITO con retenidas, con el ambito y el dia, y nada mas", () => {
  it("⭑ el central y dos zonas: TRES avisos, cada uno con SU ambito; cierres y «sin cierre» del mismo ambito se SUMAN", async () => {
    const notificar = vi.fn();
    const retenidas = retenidasDe({
      cierres: [
        { ambito: CENTRAL, cuantas: 2 },
        { ambito: CENTRAL, cuantas: 1 },
        { ambito: zona(ZONA_A), cuantas: 1 },
      ],
      sinCierre: [
        { ambito: CENTRAL, cuantas: 1 },
        { ambito: zona(ZONA_B), cuantas: 2 },
      ],
    });
    const service = new AvisosDiariosService(
      repoDoble(),
      historialSinIntentos,
      retenidas,
      3,
      undefined,
      undefined,
      notificar,
    );

    const r = await service.ejecutar(AHORA);

    const ctxs = notificar.mock.calls.map((c) => c[0] as ReprogramadasEsperanCierreContexto);
    expect(ctxs.map((c) => c.ambito)).toEqual([CENTRAL, zona(ZONA_A), zona(ZONA_B)]);
    // El contexto es SOLO ambito y dia: el numero lo compone el catalogo con la cifra viva (R13).
    for (const c of ctxs) {
      expect(Object.keys(c).sort()).toEqual(["ambito", "diaCR"]);
      expect(c.diaCR).toBe(DIA_CR);
    }
    expect(r.reprogramadasRetenidas).toBe(7);
    expect(r.ambitosConRetenidas).toBe(3);
    expect(r.avisosRetenidasEmitidos).toBe(3);
    expect(r.fallos).toBe(0);
  });

  it("R10: sin retenidas en ningun ambito NO se emite nada, y los tres conteos son 0", async () => {
    const notificar = vi.fn();
    const service = new AvisosDiariosService(
      repoDoble(),
      historialSinIntentos,
      sinRetenidas,
      3,
      undefined,
      undefined,
      notificar,
    );

    const r = await service.ejecutar(AHORA);

    expect(notificar).not.toHaveBeenCalled();
    expect(r.reprogramadasRetenidas).toBe(0);
    expect(r.ambitosConRetenidas).toBe(0);
    expect(r.avisosRetenidasEmitidos).toBe(0);
  });

  it("R10: un ambito con retenidas y OTRO sin ellas: solo el primero recibe", async () => {
    const notificar = vi.fn();
    const service = new AvisosDiariosService(
      repoDoble(),
      historialSinIntentos,
      retenidasDe({ cierres: [{ ambito: zona(ZONA_C), cuantas: 1 }] }),
      3,
      undefined,
      undefined,
      notificar,
    );

    const r = await service.ejecutar(AHORA);

    expect(notificar).toHaveBeenCalledTimes(1);
    expect((notificar.mock.calls[0][0] as ReprogramadasEsperanCierreContexto).ambito).toEqual(zona(ZONA_C));
    expect(r.ambitosConRetenidas).toBe(1);
  });

  it("⭑ el conteo se pide con `startOfDayCR(now)` (convencion @db.Date), UNA sola vez por corrida", async () => {
    const retenidas = retenidasDe({ cierres: [{ ambito: CENTRAL, cuantas: 1 }] });
    const service = new AvisosDiariosService(repoDoble(), historialSinIntentos, retenidas, 3);

    await service.ejecutar(AHORA); // 07:00 CR del 11 = 13:00Z

    expect(retenidas.llamadas).toHaveLength(1);
    // Medianoche UTC de la fecha CR: NO 06:00Z (eso seria `inicioDelDiaCREnUtc`, seis horas de mas).
    expect(retenidas.llamadas[0].toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });
});

describe("462/R18 — best-effort por ambito: una zona que falla no deja sin aviso a las demas ni tumba la corrida", () => {
  it("tres ambitos, el segundo lanza: 2 emisiones, 1 fallo registrado, los otros dos agregados intactos", async () => {
    const logger = loggerDoble();
    const notificarRetenidas = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("la base no responde"))
      .mockResolvedValueOnce(undefined);
    const notificarRepresadas = vi.fn(async () => undefined);
    const service = new AvisosDiariosService(
      repoDoble({ global: { total: 2, masAntiguaAt: hace(5) } }),
      historialSinIntentos,
      retenidasDe({
        cierres: [
          { ambito: CENTRAL, cuantas: 1 },
          { ambito: zona(ZONA_A), cuantas: 1 },
          { ambito: zona(ZONA_B), cuantas: 1 },
        ],
      }),
      3,
      undefined,
      notificarRepresadas,
      notificarRetenidas,
      logger,
    );

    const r = await service.ejecutar(AHORA);

    expect(notificarRetenidas).toHaveBeenCalledTimes(3);
    expect(r.ambitosConRetenidas).toBe(3);
    expect(r.avisosRetenidasEmitidos).toBe(2);
    expect(r.fallos).toBe(1);
    expect(logger.logError).toHaveBeenCalledTimes(1);
    expect((logger.logError.mock.calls[0][0] as Error).message).toContain("reprogramadas_esperan_cierre");
    // R50: el agregado de represadas se emitio igual, con su cifra de siempre.
    expect(notificarRepresadas).toHaveBeenCalledTimes(1);
    expect(r.ordenesRepresadas).toBe(2);
    expect(r.avisosRepresadasEmitidos).toBe(1);
  });

  it("si el propio conteo de retenidas revienta, la corrida NO termina en error: los otros dos agregados salen", async () => {
    // El conteo va dentro de la misma envoltura best-effort que las emisiones? NO: `resumen` corre
    // ANTES del bucle. Por eso aqui se afirma la propiedad que de verdad importa —los otros dos
    // agregados ya se emitieron— y que el fallo se propaga con su causa, en vez de esconderse como
    // «cero retenidas» (que apagaria el aviso en silencio).
    const notificarNovedades = vi.fn();
    const service = new AvisosDiariosService(
      repoDoble({ novedades: [novedadesDe("t-1", 2, ["wrong_address"])] }),
      historialSinIntentos,
      {
        resumen: async () => {
          throw new Error("conteo caido");
        },
      },
      3,
      notificarNovedades,
    );

    await expect(service.ejecutar(AHORA)).rejects.toThrow(/conteo caido/);
    expect(notificarNovedades).toHaveBeenCalledTimes(1);
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
      sinRetenidas,
      3,
      notificar,
    );

    const r = await service.ejecutar(nocheCR);

    expect(r.fecha).toBe("2026-09-11");
    expect((notificar.mock.calls[0][0] as NovedadesSinGestionarContexto).diaCR).toBe("2026-09-11");
  });
});
