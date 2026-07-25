import { describe, it, expect, vi } from "vitest";
import { DevolucionSlaService } from "@/lib/services/DevolucionSlaService";
import type {
  DevueltaSlaRow,
  EscalarDevueltaSlaInput,
  IDevolucionSlaRepository,
  LiberarDevueltaSlaInput,
} from "@/lib/interfaces/repositories/IDevolucionSlaRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";

// Feature 99 (T9/T10) — service del cron SLA. Dobles de repo/servicio (sin DB/HTTP), reloj FIJO.
// Aqui aterrizan las aserciones de reintento/escalado MIGRADAS de la 47 (R30): la decision de
// reintentar a bodega (<umbral) o escalar a `rechazada` (>=umbral) YA NO vive en `gestionar`, vive
// aqui. Cubre R13/R14/R15/R16/R17/R22/R26/R27/R28 + idempotencia (R24/R25).

const CENTRAL = "z-central";
const SATELITE = "z-limon";
const NOW = new Date("2026-07-20T12:00:00.000Z");

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const ESTATUS: Record<string, string> = {
  devuelta: "os-devuelta",
  en_bodega_central: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
  rechazada: "os-rechazada",
};

function row(overrides: Partial<DevueltaSlaRow> = {}): DevueltaSlaRow {
  return {
    ordenId: "o1",
    zonaId: SATELITE,
    mensajeroId: "m1",
    causa: "not_found",
    ancladaAt: new Date(NOW.getTime() - 25 * HORA), // por defecto: not_found vencida
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<IDevolucionSlaRepository> = {}): IDevolucionSlaRepository {
  return {
    findDevueltasSla: vi.fn(async () => [row()]),
    liberarDevueltaSla: vi.fn(async () => true),
    escalarDevueltaSla: vi.fn(async () => true),
    ...overrides,
  };
}

function fakeZonaRepo(centralId: string | null = CENTRAL): Pick<IZonaRepository, "findCentralZonaId"> {
  return { findCentralZonaId: vi.fn(async () => centralId) };
}

function fakeOrdenRepo(
  map: Record<string, string> = ESTATUS,
): Pick<IOrdenRepository, "findEstatusIdByValue"> {
  return { findEstatusIdByValue: vi.fn(async (v: string) => map[v] ?? null) };
}

function fakeHistorial(
  intentos = 0,
): Pick<IOrdenHistorialService, "contarIntentos"> {
  return { contarIntentos: vi.fn(async () => intentos) };
}

function newService(
  repo: IDevolucionSlaRepository = fakeRepo(),
  historial: Pick<IOrdenHistorialService, "contarIntentos"> = fakeHistorial(),
  zonaRepo = fakeZonaRepo(),
  ordenRepo = fakeOrdenRepo(),
) {
  return new DevolucionSlaService(
    repo,
    zonaRepo as unknown as IZonaRepository,
    ordenRepo as unknown as IOrdenRepository,
    historial as unknown as IOrdenHistorialService,
    { warn: vi.fn() },
  );
}

describe("ejecutar — not_found: ventana de 24h (R14/R15/R16)", () => {
  it("R14: not_found AUN viva (<24h) -> evaluada, no actua", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "not_found", ancladaAt: new Date(NOW.getTime() - 23 * HORA) }),
      ]),
    });
    const res = await newService(repo).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 1, liberadas: 0, escaladas: 0, omitidas: 0 });
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  it("R15: not_found vencida + intentos < umbral (3) -> reintento a bodega", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ zonaId: SATELITE, ancladaAt: new Date(NOW.getTime() - 25 * HORA) }),
      ]),
    });
    const res = await newService(repo, fakeHistorial(2)).ejecutar(NOW); // 2 < 3
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
    const arg = (repo.liberarDevueltaSla as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as LiberarDevueltaSlaInput;
    expect(arg.destinoEstatusId).toBe("os-en-bodega-satelite"); // zona satelite
    expect(arg.estatusDevueltaId).toBe("os-devuelta");
  });

  it("R15: zona CENTRAL -> reintento a en_bodega_central (central)", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [row({ zonaId: CENTRAL })]),
    });
    await newService(repo, fakeHistorial(0)).ejecutar(NOW);
    const arg = (repo.liberarDevueltaSla as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as LiberarDevueltaSlaInput;
    expect(arg.destinoEstatusId).toBe("os-en-bodega");
  });

  it("R16: not_found vencida + intentos >= umbral (3) -> escala a rechazada", async () => {
    const repo = fakeRepo({ findDevueltasSla: vi.fn(async () => [row()]) });
    const res = await newService(repo, fakeHistorial(3)).ejecutar(NOW); // 3 >= 3
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0 });
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
    const arg = (repo.escalarDevueltaSla as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as EscalarDevueltaSlaInput;
    expect(arg.estatusRechazadaId).toBe("os-rechazada");
  });
});

describe("ejecutar — wrong_number / wrong_address: 5 dias -> rechazo directo (R13/R17)", () => {
  it("R13: wrong_number AUN viva (<5d) -> evaluada, no actua", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "wrong_number", ancladaAt: new Date(NOW.getTime() - 4 * DIA) }),
      ]),
    });
    const res = await newService(repo).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 1, liberadas: 0, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  it.each(["wrong_number", "wrong_address"] as const)(
    "R17: %s vencida (>=5d) -> escala DIRECTO a rechazada, sin mirar el conteo de intentos",
    async (causa) => {
      const historial = fakeHistorial(0); // aunque intentos=0, escala igual (sin bucle)
      const repo = fakeRepo({
        findDevueltasSla: vi.fn(async () => [
          row({ causa, ancladaAt: new Date(NOW.getTime() - 6 * DIA) }),
        ]),
      });
      const res = await newService(repo, historial).ejecutar(NOW);
      expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0 });
      expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
      // R17: no consulta el conteo de intentos para las causas de rechazo directo.
      expect(historial.contarIntentos).not.toHaveBeenCalled();
    },
  );
});

describe("ejecutar — atribucion del escalado (R22)", () => {
  it("R22: escalar atribuye el mensajero de la gestion devuelta vigente + motivo 'escalado SLA <causa>'", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "wrong_address", mensajeroId: "m-99", ancladaAt: new Date(NOW.getTime() - 6 * DIA) }),
      ]),
    });
    await newService(repo).ejecutar(NOW);
    const arg = (repo.escalarDevueltaSla as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as EscalarDevueltaSlaInput;
    expect(arg.mensajeroId).toBe("m-99");
    expect(arg.motivo).toBe("escalado SLA wrong_address");
  });
});

describe("ejecutar — reloj inyectable (R13)", () => {
  it("R13: la MISMA orden es viva con un `now` temprano y vencida con uno tardio", async () => {
    const ancladaAt = new Date("2026-07-20T00:00:00.000Z");
    const build = () =>
      fakeRepo({ findDevueltasSla: vi.fn(async () => [row({ causa: "not_found", ancladaAt })]) });

    const viva = build();
    const rViva = await newService(viva, fakeHistorial(0)).ejecutar(
      new Date(ancladaAt.getTime() + 23 * HORA),
    );
    expect(rViva).toEqual({ evaluadas: 1, liberadas: 0, escaladas: 0, omitidas: 0 });

    const vencida = build();
    const rVencida = await newService(vencida, fakeHistorial(0)).ejecutar(
      new Date(ancladaAt.getTime() + 25 * HORA),
    );
    expect(rVencida).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
  });
});

describe("ejecutar — resiliencia, idempotencia y datos incompletos (R24/R25/R26/R27/R28)", () => {
  it("R28: causa null -> omitida, sin adivinar ventana ni actuar", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [row({ causa: null })]),
    });
    const res = await newService(repo).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 1 });
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  it("R27: catalogo de estados incompleto -> conteos 0, no consulta candidatas, avisa", async () => {
    const warn = vi.fn();
    const repo = fakeRepo();
    const service = new DevolucionSlaService(
      repo,
      fakeZonaRepo() as unknown as IZonaRepository,
      fakeOrdenRepo({ devuelta: "os-devuelta" }) as unknown as IOrdenRepository, // faltan bodega/rechazada
      fakeHistorial() as unknown as IOrdenHistorialService,
      { warn },
    );
    const res = await service.ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 0 });
    expect(repo.findDevueltasSla).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("R26: una orden que lanza -> omitida, la corrida continua con las demas", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ ordenId: "o-boom", zonaId: SATELITE }),
        row({ ordenId: "o-ok", zonaId: SATELITE }),
      ]),
      liberarDevueltaSla: vi.fn(async (input: LiberarDevueltaSlaInput) => {
        if (input.ordenId === "o-boom") throw new Error("db down");
        return true;
      }),
    });
    const res = await newService(repo, fakeHistorial(0)).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 1 });
  });

  it("R24/R25: liberar guardado por estado devuelve false -> omitida (no re-actua)", async () => {
    const repo = fakeRepo({ liberarDevueltaSla: vi.fn(async () => false) });
    const res = await newService(repo, fakeHistorial(0)).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 1 });
  });

  it("R24/R25: escalar guardado por estado devuelve false -> omitida (no doble efecto)", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [row({ causa: "wrong_number", ancladaAt: new Date(NOW.getTime() - 6 * DIA) })]),
      escalarDevueltaSla: vi.fn(async () => false),
    });
    const res = await newService(repo).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 1 });
  });

  it("nada que procesar -> conteos en cero", async () => {
    const repo = fakeRepo({ findDevueltasSla: vi.fn(async () => []) });
    const res = await newService(repo).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 0 });
  });
});
