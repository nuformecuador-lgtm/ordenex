import { describe, it, expect, vi } from "vitest";
import type { PostulacionRecursoConfig } from "@/lib/config/postulacion-recurso";
import type { IPostulacionRecursoRepository } from "@/lib/interfaces/repositories/IPostulacionRecursoRepository";
import {
  PurgaPostulacionRecursoService,
  restarMesesUTC,
} from "@/lib/services/PurgaPostulacionRecursoService";

// Feature 253 (P2) — el cron de purga, con dobles.
//
// ⚠️ LO QUE ESTE ARCHIVO **NO** DEMUESTRA, y hay que decirlo aqui arriba: un doble NO VE EL SQL.
// Que el service pase el corte correcto al repositorio no prueba que Postgres deje viva una fila
// PENDIENTE de hace dos anos. Eso —la unica garantia que de verdad importa en un borrado
// irreversible— se mide contra la base real en
// `tests/integration/db/postulacion-recurso-migration.test.ts`. Lo de aqui es la aritmetica del
// corte y el tope por corrida.

function configDoble(overrides: Partial<PostulacionRecursoConfig> = {}): PostulacionRecursoConfig {
  return {
    NOMBRE_MAX_CHARS: 120,
    TELEFONO_MAX_CHARS: 30,
    CORREO_MAX_CHARS: 254,
    MENSAJE_MAX_CHARS: 1000,
    RATE_MAX: 3,
    RATE_WINDOW_MINUTES: 60,
    PAGE_SIZE_DEFAULT: 20,
    PAGE_SIZE_MAX: 50,
    PURGA_RETENCION_MESES: 6,
    PURGA_MAX_POR_CORRIDA: 500,
    ...overrides,
  };
}

function repoDoble(
  overrides: Partial<IPostulacionRecursoRepository> = {},
): IPostulacionRecursoRepository {
  return {
    crear: vi.fn(),
    listar: vi.fn(),
    marcarAtendida: vi.fn(),
    findById: vi.fn(),
    purgarAtendidasAnterioresA: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("253 / P2 — la aritmetica del corte: 6 meses de calendario, hacia atras", () => {
  it("resta meses en UTC sin tocar la hora", () => {
    expect(restarMesesUTC(new Date("2026-08-20T09:30:00.000Z"), 6).toISOString()).toBe(
      "2026-02-20T09:30:00.000Z",
    );
  });

  it("cruza el cambio de ano", () => {
    expect(restarMesesUTC(new Date("2026-03-15T00:00:00.000Z"), 6).toISOString()).toBe(
      "2025-09-15T00:00:00.000Z",
    );
  });

  it("un dia que no existe en el mes destino se ACOTA al ultimo, nunca se desborda hacia adelante", () => {
    // 31 de agosto - 6 meses = 28 de febrero (2026 no es bisiesto). `setUTCMonth` a secas daria el
    // 3 de MARZO, o sea un corte MAS NUEVO: en una purga, eso son tres dias de mas borrados.
    expect(restarMesesUTC(new Date("2026-08-31T00:00:00.000Z"), 6).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    // Y en bisiesto, el 29.
    expect(restarMesesUTC(new Date("2024-08-31T00:00:00.000Z"), 6).toISOString()).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });

  it("el corte NUNCA queda por delante del instante de la corrida", () => {
    for (const iso of [
      "2026-01-31T23:59:59.999Z",
      "2026-03-31T00:00:00.000Z",
      "2026-05-31T12:00:00.000Z",
      "2026-12-31T00:00:00.000Z",
    ]) {
      const now = new Date(iso);
      expect(restarMesesUTC(now, 6).getTime()).toBeLessThan(now.getTime());
    }
  });
});

describe("253 / P2 — la corrida", () => {
  it("pide el borrado con el corte `now - RETENCION` y el tope de la config", async () => {
    const repo = repoDoble();
    const service = new PurgaPostulacionRecursoService(repo, () => configDoble());

    const r = await service.ejecutar(new Date("2026-08-20T09:00:00.000Z"));

    expect(repo.purgarAtendidasAnterioresA).toHaveBeenCalledTimes(1);
    const [corte, tope] = (repo.purgarAtendidasAnterioresA as ReturnType<typeof vi.fn>).mock
      .calls[0] as [Date, number];
    expect(corte.toISOString()).toBe("2026-02-20T09:00:00.000Z");
    expect(tope).toBe(500);
    expect(r.corte).toBe("2026-02-20T09:00:00.000Z");
  });

  it("una retencion distinta mueve el corte (la config manda, no un numero escondido)", async () => {
    const repo = repoDoble();
    await new PurgaPostulacionRecursoService(repo, () =>
      configDoble({ PURGA_RETENCION_MESES: 24 }),
    ).ejecutar(new Date("2026-08-20T00:00:00.000Z"));

    const [corte] = (repo.purgarAtendidasAnterioresA as ReturnType<typeof vi.fn>).mock.calls[0] as [
      Date,
    ];
    expect(corte.toISOString()).toBe("2024-08-20T00:00:00.000Z");
  });

  it("la config se lee EN CADA corrida, no al construir el service", async () => {
    const leer = vi.fn(() => configDoble());
    const service = new PurgaPostulacionRecursoService(repoDoble(), leer);
    expect(leer).not.toHaveBeenCalled();
    await service.ejecutar(new Date());
    await service.ejecutar(new Date());
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it("devuelve el resumen SOLO numerico: sin ids, sin nombres, sin correos (R19)", async () => {
    const repo = repoDoble({ purgarAtendidasAnterioresA: vi.fn().mockResolvedValue(7) });
    const r = await new PurgaPostulacionRecursoService(repo, () => configDoble()).ejecutar(
      new Date("2026-08-20T09:00:00.000Z"),
    );
    expect(Object.keys(r).sort()).toEqual(["borradas", "corte", "quedaPendiente"]);
    expect(r.borradas).toBe(7);
  });

  it("`quedaPendiente` solo cuando la corrida agoto el tope", async () => {
    const conBorradas = async (n: number, tope: number) =>
      new PurgaPostulacionRecursoService(
        repoDoble({ purgarAtendidasAnterioresA: vi.fn().mockResolvedValue(n) }),
        () => configDoble({ PURGA_MAX_POR_CORRIDA: tope }),
      ).ejecutar(new Date("2026-08-20T00:00:00.000Z"));

    expect((await conBorradas(0, 500)).quedaPendiente).toBe(false);
    expect((await conBorradas(499, 500)).quedaPendiente).toBe(false);
    expect((await conBorradas(500, 500)).quedaPendiente).toBe(true);
  });

  it("una corrida sin nada que borrar no es un error: devuelve 0", async () => {
    const r = await new PurgaPostulacionRecursoService(repoDoble(), () => configDoble()).ejecutar(
      new Date(),
    );
    expect(r.borradas).toBe(0);
  });

  it("⛔ el service NO llama a ningun otro metodo del repositorio: solo puede purgar", async () => {
    const repo = repoDoble();
    await new PurgaPostulacionRecursoService(repo, () => configDoble()).ejecutar(new Date());
    expect(repo.crear).not.toHaveBeenCalled();
    expect(repo.listar).not.toHaveBeenCalled();
    expect(repo.marcarAtendida).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
  });
});
