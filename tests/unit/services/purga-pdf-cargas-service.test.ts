import { describe, it, expect, vi } from "vitest";
import type { PurgaPdfConfig } from "@/lib/config/purga-pdf";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type {
  CargaPurgable,
  IPurgaPdfCargasRepository,
} from "@/lib/interfaces/repositories/IPurgaPdfCargasRepository";
import { PurgaPdfCargasService } from "@/lib/services/PurgaPdfCargasService";

// Feature 178 (T9-T17) — service del cron diario de purga de los PDF de cargas antiguas.
// Repositorio y Storage son DOBLES (`vi.fn`): sin DB, sin red, reloj FIJO. El repo doble aplica el
// filtro REAL (`createdAt <= corte`, referencia viva, orden ASC, `limite`) sobre un fixture en
// memoria, para que los tests de ventana y de tope sean discriminantes y no tautologicos.

const NOW = new Date("2026-08-03T09:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;

/** Fila del fixture: lo que "hay en la base". Mutable: `limpiarReferencias` la anula (R20). */
interface CargaFixture {
  cargaId: string;
  createdAt: Date;
  cargaPath: string | null;
  ordenPaths: string[];
}

function carga(overrides: Partial<CargaFixture> = {}): CargaFixture {
  return {
    cargaId: "c1",
    createdAt: new Date(NOW.getTime() - 30 * DIA_MS),
    cargaPath: "u1/consolidado-c1.pdf",
    ordenPaths: ["u1/o1.pdf", "u1/o2.pdf"],
    ...overrides,
  };
}

function config(overrides: Partial<PurgaPdfConfig> = {}): PurgaPdfConfig {
  return {
    PURGA_PDF_RETENCION_DIAS: 7,
    PURGA_PDF_MAX_CARGAS_POR_CORRIDA: 200,
    ...overrides,
  };
}

/** R8: una carga sin ninguna referencia viva ya no es candidata. */
function tieneReferenciaViva(fila: CargaFixture): boolean {
  return fila.cargaPath !== null || fila.ordenPaths.length > 0;
}

/**
 * Repo doble con el filtro real sobre el fixture: `createdAt <= corte` (INCLUSIVO, R5), referencia
 * viva (R8), orden `createdAt` ASC y `limite` (R21). `limpiarReferencias` MUTA el fixture, que es
 * lo que hace idempotente a la segunda corrida (R20).
 */
function fakeRepo(fixture: CargaFixture[], log: string[] = []): IPurgaPdfCargasRepository {
  const candidatas = (corte: Date): CargaFixture[] =>
    fixture
      .filter((fila) => fila.createdAt.getTime() <= corte.getTime() && tieneReferenciaViva(fila))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return {
    findCargasPurgables: vi.fn(
      async (corte: Date, limite: number): Promise<CargaPurgable[]> =>
        candidatas(corte)
          .slice(0, limite)
          .map((fila) => ({
            cargaId: fila.cargaId,
            cargaPath: fila.cargaPath,
            ordenPaths: [...fila.ordenPaths],
          })),
    ),
    // R22: EXISTENCIA sobre el estado ACTUAL del fixture (el service la llama DESPUES del bucle,
    // cuando `limpiarReferencias` ya anulo las referencias de las purgadas). Nada de
    // `length > limite`: eso descontaria candidatas todavia vivas.
    existeAlgunaCandidata: vi.fn(async (corte: Date): Promise<boolean> => candidatas(corte).length > 0),
    limpiarReferencias: vi.fn(async (cargaId: string) => {
      log.push(`limpiar:${cargaId}`);
      const fila = fixture.find((f) => f.cargaId === cargaId);
      const ordenesActualizadas = fila?.ordenPaths.length ?? 0;
      if (fila) {
        fila.cargaPath = null;
        fila.ordenPaths = [];
      }
      return { ordenesActualizadas };
    }),
  };
}

function fakeStorage(log: string[] = [], overrides: Partial<IFileStorage> = {}): IFileStorage {
  return {
    upload: vi.fn(async () => "no-usado"),
    remove: vi.fn(async (paths: string[]) => {
      log.push(`remove:${paths.join(",")}`);
    }),
    ...overrides,
  };
}

describe("PurgaPdfCargasService", () => {
  it("R4/R5: el corte es `now - N dias` y la configuracion se relee en CADA corrida", async () => {
    const repo = fakeRepo([carga()]);
    const storage = fakeStorage();
    // Primera corrida con 7 dias, segunda con 30: el lector devuelve config DISTINTA cada vez.
    const leerConfig = vi
      .fn<() => PurgaPdfConfig>()
      .mockReturnValueOnce(config({ PURGA_PDF_RETENCION_DIAS: 7 }))
      .mockReturnValueOnce(config({ PURGA_PDF_RETENCION_DIAS: 30 }));
    const service = new PurgaPdfCargasService(repo, storage, leerConfig);

    await service.ejecutar(NOW);
    await service.ejecutar(NOW);

    expect(leerConfig).toHaveBeenCalledTimes(2);
    const find = vi.mocked(repo.findCargasPurgables);
    expect(find.mock.calls[0]?.[0]).toEqual(new Date(NOW.getTime() - 7 * DIA_MS));
    expect(find.mock.calls[1]?.[0]).toEqual(new Date(NOW.getTime() - 30 * DIA_MS));
    // Dos ventanas distintas de verdad: los dos cortes no coinciden.
    expect(find.mock.calls[0]?.[0]).not.toEqual(find.mock.calls[1]?.[0]);
  });

  it("R3/R5: con retencion 0 el corte es exactamente `now` y una carga creada esa misma manana entra", async () => {
    const estaManana = new Date(NOW.getTime() - 3 * 60 * 60 * 1000); // 06:00 del mismo dia
    const fixture = [carga({ cargaId: "c-hoy", createdAt: estaManana })];
    const repo = fakeRepo(fixture);
    const storage = fakeStorage();
    const service = new PurgaPdfCargasService(repo, storage, () =>
      config({ PURGA_PDF_RETENCION_DIAS: 0 }),
    );

    const resultado = await service.ejecutar(NOW);

    expect(vi.mocked(repo.findCargasPurgables).mock.calls[0]?.[0]).toEqual(NOW);
    expect(resultado.cargasPurgadas).toBe(1);
    expect(vi.mocked(repo.limpiarReferencias)).toHaveBeenCalledWith("c-hoy");
    expect(vi.mocked(storage.remove)).toHaveBeenCalledTimes(1);
  });

  it("R10: una sola llamada a `remove` por carga con el consolidado Y todas las rutas de sus ordenes", async () => {
    const fixture = [
      carga({
        cargaId: "c1",
        cargaPath: "u1/consolidado-c1.pdf",
        ordenPaths: ["u1/o1.pdf", "u1/o2.pdf", "u1/o3.pdf"],
      }),
    ];
    const repo = fakeRepo(fixture);
    const storage = fakeStorage();
    const service = new PurgaPdfCargasService(repo, storage, () => config());

    await service.ejecutar(NOW);

    const remove = vi.mocked(storage.remove);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0]).toEqual([
      "u1/consolidado-c1.pdf",
      "u1/o1.pdf",
      "u1/o2.pdf",
      "u1/o3.pdf",
    ]);
  });

  it("R10: el consolidado nulo no viaja a `remove`, pero si las rutas de las ordenes", async () => {
    const fixture = [carga({ cargaId: "c1", cargaPath: null, ordenPaths: ["u1/o1.pdf"] })];
    const repo = fakeRepo(fixture);
    const storage = fakeStorage();
    const service = new PurgaPdfCargasService(repo, storage, () => config());

    await service.ejecutar(NOW);

    expect(vi.mocked(storage.remove).mock.calls[0]?.[0]).toEqual(["u1/o1.pdf"]);
  });

  it("R12: una carga elegible sin ninguna ruta referenciada NO invoca `remove` (ni con lista vacia), pero si se limpia", async () => {
    // El fixture entra por `findCargasPurgables` (lo devuelve el doble) aunque no tenga rutas:
    // el caso real es la carga con `download_url` viva y `download_storage_path` nulo (136/141).
    const repo: IPurgaPdfCargasRepository = {
      findCargasPurgables: vi.fn(async () => [
        { cargaId: "c-sin-rutas", cargaPath: null, ordenPaths: [] },
      ]),
      existeAlgunaCandidata: vi.fn(async () => false),
      limpiarReferencias: vi.fn(async () => ({ ordenesActualizadas: 0 })),
    };
    const storage = fakeStorage();
    const service = new PurgaPdfCargasService(repo, storage, () => config());

    const resultado = await service.ejecutar(NOW);

    expect(vi.mocked(storage.remove)).not.toHaveBeenCalled();
    expect(vi.mocked(repo.limpiarReferencias)).toHaveBeenCalledWith("c-sin-rutas");
    expect(resultado.objetosBorrados).toBe(0);
    expect(resultado.cargasPurgadas).toBe(1);
  });

  it("R20: `remove` se invoca SIEMPRE antes de `limpiarReferencias` y el camino feliz limpia", async () => {
    const log: string[] = [];
    const fixture = [
      carga({ cargaId: "cA", cargaPath: "u1/a.pdf", ordenPaths: ["u1/a1.pdf"] }),
      carga({
        cargaId: "cB",
        createdAt: new Date(NOW.getTime() - 20 * DIA_MS),
        cargaPath: "u1/b.pdf",
        ordenPaths: [],
      }),
    ];
    const repo = fakeRepo(fixture, log);
    const storage = fakeStorage(log);
    const service = new PurgaPdfCargasService(repo, storage, () => config());

    await service.ejecutar(NOW);

    // Orden por carga, y cargas en secuencia (nunca entrelazadas: el bucle es secuencial).
    expect(log).toEqual([
      "remove:u1/a.pdf,u1/a1.pdf",
      "limpiar:cA",
      "remove:u1/b.pdf",
      "limpiar:cB",
    ]);
    const remove = vi.mocked(storage.remove);
    const limpiar = vi.mocked(repo.limpiarReferencias);
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(limpiar.mock.invocationCallOrder[0]!);
  });

  it("R19: si `remove` lanza, esa carga NO se limpia, el error se propaga y NO hay reintento interno", async () => {
    const fixture = [carga({ cargaId: "c-falla" })];
    const repo = fakeRepo(fixture);
    const storage = fakeStorage([], {
      remove: vi.fn(async () => {
        throw new Error("storage caido");
      }),
    });
    const service = new PurgaPdfCargasService(repo, storage, () => config());

    await expect(service.ejecutar(NOW)).rejects.toThrow("storage caido");

    // Sin limpieza: la referencia sigue viva y la carga vuelve a ser candidata manana (R19).
    expect(vi.mocked(repo.limpiarReferencias)).not.toHaveBeenCalled();
    // UNA sola invocacion: ni reintento, ni backoff, ni bucle de espera dentro de la corrida.
    expect(vi.mocked(storage.remove)).toHaveBeenCalledTimes(1);
    expect(fixture[0]?.cargaPath).toBe("u1/consolidado-c1.pdf");
  });

  it("R5/R6: con corte inclusivo entran las cargas de N y de N+1 dias, y la de N-1 queda intacta", async () => {
    const N = 7;
    const fixture = [
      carga({
        cargaId: "c-N-menos-1",
        createdAt: new Date(NOW.getTime() - (N - 1) * DIA_MS),
        cargaPath: "u1/joven.pdf",
        ordenPaths: ["u1/joven-o1.pdf"],
      }),
      carga({
        cargaId: "c-N",
        createdAt: new Date(NOW.getTime() - N * DIA_MS),
        cargaPath: "u1/justa.pdf",
        ordenPaths: [],
      }),
      carga({
        cargaId: "c-N-mas-1",
        createdAt: new Date(NOW.getTime() - (N + 1) * DIA_MS),
        cargaPath: "u1/vieja.pdf",
        ordenPaths: [],
      }),
    ];
    const repo = fakeRepo(fixture);
    const storage = fakeStorage();
    const service = new PurgaPdfCargasService(repo, storage, () =>
      config({ PURGA_PDF_RETENCION_DIAS: N }),
    );

    const resultado = await service.ejecutar(NOW);

    expect(resultado.cargasPurgadas).toBe(2);
    const limpiadas = vi
      .mocked(repo.limpiarReferencias)
      .mock.calls.map(([cargaId]) => cargaId);
    // ASC: primero lo mas viejo.
    expect(limpiadas).toEqual(["c-N-mas-1", "c-N"]);
    expect(limpiadas).not.toContain("c-N-menos-1");
    const rutasEnviadas = vi.mocked(storage.remove).mock.calls.flatMap(([paths]) => paths);
    expect(rutasEnviadas).not.toContain("u1/joven.pdf");
    expect(rutasEnviadas).not.toContain("u1/joven-o1.pdf");
    // La carga dentro de la ventana conserva sus referencias sin tocar (R6).
    expect(fixture[0]?.cargaPath).toBe("u1/joven.pdf");
    expect(fixture[0]?.ordenPaths).toEqual(["u1/joven-o1.pdf"]);
  });

  it("R17: ninguna consulta ni ningun `remove` alcanza a una orden con `carga_id` NULL", async () => {
    // La orden sin lote vive en el fixture como una fila NO agrupable: el repo agrupa por
    // `carga_id`, asi que jamas la devuelve. El test fija que el service tampoco la busca por otra
    // via (solo usa los tres metodos del contrato) ni envia su ruta a Storage.
    const RUTA_SIN_LOTE = "u9/orden-sin-lote.pdf";
    const ordenesSinLote = [{ ordenId: "o-huerfana", cargaId: null, path: RUTA_SIN_LOTE }];
    const fixture = [carga({ cargaId: "c1", cargaPath: "u1/c1.pdf", ordenPaths: ["u1/o1.pdf"] })];
    const repo = fakeRepo(fixture);
    const storage = fakeStorage();
    const service = new PurgaPdfCargasService(repo, storage, () => config());

    await service.ejecutar(NOW);

    const rutasEnviadas = vi.mocked(storage.remove).mock.calls.flatMap(([paths]) => paths);
    expect(rutasEnviadas).toEqual(["u1/c1.pdf", "u1/o1.pdf"]);
    expect(rutasEnviadas).not.toContain(RUTA_SIN_LOTE);
    // La orden sin lote sigue con su ruta poblada: nada la toco.
    expect(ordenesSinLote[0]?.path).toBe(RUTA_SIN_LOTE);
    expect(Object.keys(repo)).toEqual([
      "findCargasPurgables",
      "existeAlgunaCandidata",
      "limpiarReferencias",
    ]);
  });

  it("R24: el resumen trae los conteos agregados y SOLO numeros (ni rutas, ni carga_id, ni ids)", async () => {
    const fixture = [
      carga({
        cargaId: "c1",
        createdAt: new Date(NOW.getTime() - 30 * DIA_MS),
        cargaPath: "u1/c1.pdf",
        ordenPaths: ["u1/o1.pdf", "u1/o2.pdf"],
      }),
      carga({
        cargaId: "c2",
        createdAt: new Date(NOW.getTime() - 40 * DIA_MS),
        cargaPath: null,
        ordenPaths: ["u2/o3.pdf"],
      }),
    ];
    const repo = fakeRepo(fixture);
    const storage = fakeStorage();
    const service = new PurgaPdfCargasService(repo, storage, () => config());

    const resultado = await service.ejecutar(NOW);

    expect(resultado).toEqual({
      cargasPurgadas: 2,
      ordenesAfectadas: 3,
      objetosBorrados: 4, // 3 rutas de c1 + 1 de c2 (rutas ENVIADAS, no confirmadas)
      quedaPendiente: false,
    });
    // Ninguna clave nueva, y todo valor es numero salvo la bandera de pendiente.
    expect(Object.keys(resultado).sort()).toEqual([
      "cargasPurgadas",
      "objetosBorrados",
      "ordenesAfectadas",
      "quedaPendiente",
    ]);
    for (const [clave, valor] of Object.entries(resultado)) {
      if (clave === "quedaPendiente") expect(typeof valor).toBe("boolean");
      else expect(typeof valor).toBe("number");
    }
    // Serializado: cero cadenas (una ruta, un `carga_id` o un id de usuario irian entre comillas).
    const json = JSON.stringify(resultado);
    expect(json).not.toMatch(/:\s*"/);
    expect(json).not.toMatch(/u1|u2|c1|c2|\.pdf/);
  });

  it("R8/R20: la segunda corrida sobre el mismo estado no encuentra candidatas, no borra ni escribe", async () => {
    const fixture = [carga({ cargaId: "c1" })];
    const repo = fakeRepo(fixture);
    const storage = fakeStorage();
    const service = new PurgaPdfCargasService(repo, storage, () => config());

    const primera = await service.ejecutar(NOW);
    expect(primera.cargasPurgadas).toBe(1);

    vi.mocked(storage.remove).mockClear();
    vi.mocked(repo.limpiarReferencias).mockClear();

    const segunda = await service.ejecutar(NOW);

    expect(segunda).toEqual({
      cargasPurgadas: 0,
      ordenesAfectadas: 0,
      objetosBorrados: 0,
      quedaPendiente: false,
    });
    expect(vi.mocked(storage.remove)).not.toHaveBeenCalled();
    expect(vi.mocked(repo.limpiarReferencias)).not.toHaveBeenCalled();
  });

  // AL LIMITE a proposito: 3 candidatas con tope 2 deja EXACTAMENTE UNA sin purgar. Con mas
  // margen (p. ej. 5 y tope 2) el caso pasaria incluso con la semantica erronea de descontar el
  // tope una segunda vez.
  it("R21/R22: con una candidata mas que el tope se procesan exactamente el tope y la corrida termina con quedaPendiente true", async () => {
    const TOPE = 2;
    const fixture = [1, 2, 3].map((n) =>
      carga({
        cargaId: `c${n}`,
        createdAt: new Date(NOW.getTime() - (30 + n) * DIA_MS),
        cargaPath: `u1/c${n}.pdf`,
        ordenPaths: [`u1/c${n}-o1.pdf`],
      }),
    );
    const repo = fakeRepo(fixture);
    const storage = fakeStorage();
    const service = new PurgaPdfCargasService(repo, storage, () =>
      config({ PURGA_PDF_MAX_CARGAS_POR_CORRIDA: TOPE }),
    );

    const resultado = await service.ejecutar(NOW);

    expect(resultado.cargasPurgadas).toBe(TOPE);
    expect(resultado.quedaPendiente).toBe(true);
    expect(vi.mocked(storage.remove)).toHaveBeenCalledTimes(TOPE);
    expect(vi.mocked(repo.limpiarReferencias)).toHaveBeenCalledTimes(TOPE);
    // El tope viaja tal cual al repo en la SELECCION (R21)...
    expect(vi.mocked(repo.findCargasPurgables).mock.calls[0]?.[1]).toBe(TOPE);
    // ...y NO a la comprobacion de pendiente: esa es de mera existencia, sin tope ni skip (R22).
    expect(vi.mocked(repo.existeAlgunaCandidata).mock.calls[0]).toEqual([
      new Date(NOW.getTime() - 7 * DIA_MS),
    ]);
    // ASC: se purgaron las dos mas viejas (c3, c2). La menos vieja sigue VIVA para manana.
    expect(
      vi.mocked(repo.limpiarReferencias).mock.calls.map(([cargaId]) => cargaId),
    ).toEqual(["c3", "c2"]);
    expect(fixture[0]?.cargaPath).toBe("u1/c1.pdf");
    expect(fixture[0]?.ordenPaths).toEqual(["u1/c1-o1.pdf"]);
  });
});
