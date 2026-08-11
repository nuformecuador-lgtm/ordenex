import { describe, it, expect, vi, afterEach } from "vitest";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICierresAdminRepository } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { IAnaliticaCache, OrigenInvalidacion } from "@/lib/interfaces/external/IAnaliticaCache";
import {
  invalidarAnaliticaFinanciera,
  InvalidacionFinancieraFallida,
} from "@/lib/analytics/invalidacion-financiera";
import { TAGS_FINANCIERA } from "@/lib/analytics/cache-tags";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import { libroFinanciero } from "./_libro-financiero";

// Feature 179 / T3.10 — R16 (D4): UN FALLO DE INVALIDACION POSTERIOR AL COMMIT NO SE PROPAGA.
//
// ⚠ DESVIACION DECLARADA DE R11 DE LA 128, y este archivo es donde se paga.
//
// R11 de la 128 dice que una invalidacion fallida DEBE hacer fallar al llamador. **Aqui se hace
// lo contrario, a proposito.** Alli el llamador era un JOB idempotente con backoff y
// dead-letter, donde fallar es lo correcto porque el reintento es gratis y no lo ve nadie. Aqui
// el llamador es una SERVER ACTION de cara a un maestro sobre una escritura de dinero **ya
// confirmada**: fallar no reintenta nada, solo le dice al usuario que la aprobacion del cierre
// fallo cuando el dinero ya se movio, y provoca reintentos manuales sobre una operacion hecha.
//
// LAS DOS MUTACIONES SON LOS DOS EXTREMOS, Y LAS DOS TIENEN TEST:
//   (a) propagar el error            -> mentir sobre la operacion  -> rojo por el primer bloque
//   (b) `try {} catch {}` vacio      -> callar sobre la cache      -> rojo por el segundo
//
// El limite del alcance de D4 esta en el otro archivo: donde el llamador vuelve a ser un job
// (R27), R11 de la 128 sigue aplicando tal cual y una invalidacion fallida SI hace fallar el job
// (`cache-financiera-invalidacion-backfill.test.ts`, ultimo bloque).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const CLIENTE = {} as never;

/** Cache que confirma lecturas pero LANZA al invalidar (`revalidateTag` reventado). */
function cacheQueExplota(mensaje = "revalidateTag exploto"): IAnaliticaCache {
  return {
    async envolver<T>(_c: string, _t: readonly string[], producir: () => Promise<T>): Promise<T> {
      return producir();
    },
    async invalidar(): Promise<void> {
      throw new Error(mensaje);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R16 · una invalidacion que lanza tras una aprobacion confirmada no convierte la aprobacion en un fallo", () => {
  it("`aprobarCierre` devuelve `ok` aunque la cache reviente", async () => {
    vi.spyOn(defaultLogger, "logError").mockImplementation(() => {});
    const escrituras: unknown[] = [];
    const repo = {
      findGestionesIncidenteDelCierre: vi.fn(async () => []),
      resolverCierre: vi.fn(async () => {
        escrituras.push("egreso_pago_mensajero:5000.00"); // el dinero YA se movio
        return "updated" as const;
      }),
    } as unknown as ICierresAdminRepository;

    const servicio = new CierresAdminService(
      repo,
      { findCentralZonaId: vi.fn(async () => null) } as never,
      { findEstatusIdByValue: vi.fn(async () => "e1"), findUsuarioZonaId: vi.fn(async () => null) } as never,
      { firmar: vi.fn() } as never,
      { obtenerCierreParaPago: vi.fn(async () => null), sumarVigentesPorCierre: vi.fn(async () => ({})) } as never,
      cacheQueExplota(),
    );

    const r = await servicio.aprobarCierre("c1", MAESTRO);

    // Propagar aqui le diria a un maestro que la aprobacion fallo cuando el dinero ya se movio.
    expect(r.status).toBe("ok");
    // Y el dinero escrito SIGUE escrito: la operacion ocurrio, y por eso devuelve exito.
    expect(escrituras).toEqual(["egreso_pago_mensajero:5000.00"]);
  });

  it("y lo mismo con un egreso administrativo: el dinero escrito sigue escrito", async () => {
    vi.spyOn(defaultLogger, "logError").mockImplementation(() => {});
    const libro = libroFinanciero();
    const servicio = new WalletEgresoService(libro.cajaRepo, CLIENTE, cacheQueExplota());

    const r = await servicio.registrarEgreso(
      { tipoEgreso: "gasto_variable", monto: "250.00", descripcion: "combustible" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(libro.filas()).toHaveLength(1);
    expect(libro.filas()[0].monto).toBe("250.00");
  });
});

describe("R16 · y deja constancia, con su origen", () => {
  it("el canal de errores recibe un `InvalidacionFinancieraFallida` con origen y tags", async () => {
    const registrados: unknown[] = [];
    const logger: ErrorLogger = { logError: (e) => void registrados.push(e) };

    await invalidarAnaliticaFinanciera(cacheQueExplota("boom"), "ledger_cierre_dia", logger);

    expect(registrados).toHaveLength(1);
    const error = registrados[0] as InvalidacionFinancieraFallida;
    expect(error).toBeInstanceOf(InvalidacionFinancieraFallida);
    expect(error.origen).toBe("ledger_cierre_dia");
    expect(error.tags).toEqual(TAGS_FINANCIERA);
    // Un `catch {}` vacio es la otra mutacion: la operacion seguiria devolviendo exito y nadie
    // sabria nunca que la cache se quedo vieja. El daño de D4 esta acotado por el TTL **y con
    // senal**; sin esta asercion solo estaria acotado.
    expect(String(error.message)).toContain("ledger_cierre_dia");
  });

  it("la constancia lleva la causa original, para poder diagnosticar", async () => {
    const registrados: unknown[] = [];
    const logger: ErrorLogger = { logError: (e) => void registrados.push(e) };

    await invalidarAnaliticaFinanciera(cacheQueExplota("revalidateTag exploto"), "manual", logger);

    const error = registrados[0] as InvalidacionFinancieraFallida;
    expect((error.causa as Error).message).toBe("revalidateTag exploto");
  });

  it("y NO lleva PII ni ids de dominio: solo origen y tags", async () => {
    const registrados: InvalidacionFinancieraFallida[] = [];
    const logger: ErrorLogger = {
      logError: (e) => void registrados.push(e as InvalidacionFinancieraFallida),
    };

    await invalidarAnaliticaFinanciera(cacheQueExplota(), "ledger_liquidacion", logger);

    const error = registrados[0];
    // El registro sirve para saber CUAL invalidador no llego, no QUE fila lo disparo. Las
    // propiedades propias son exactamente tres: origen, tags y causa.
    expect(Object.keys(error).sort()).toEqual(["causa", "name", "origen", "tags"]);
    expect(error.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // ningun uuid
  });
});

describe("R16 · cuando NO falla, no se registra nada", () => {
  it("una invalidacion buena no ensucia el canal de errores", async () => {
    const registrados: unknown[] = [];
    const logger: ErrorLogger = { logError: (e) => void registrados.push(e) };
    const cache: IAnaliticaCache = {
      async envolver<T>(_c: string, _t: readonly string[], p: () => Promise<T>) {
        return p();
      },
      async invalidar(_o: OrigenInvalidacion) {},
    };

    await invalidarAnaliticaFinanciera(cache, "ledger_egreso_admin", logger);

    expect(registrados).toEqual([]);
  });
});
