import { describe, it, expect, vi } from "vitest";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import type {
  IGestionOrdenRepository,
  MiAsignacionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 116 — E1: reflejo de `notaPrivada` en el listado (R6/R8). Espejo del test de
// `marcarLuego` (115): el service mergea la nota del PROPIO actor por orden, y la privacidad es
// estructural (consulta acotada por `usuario_id = actor`).

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

function row(over: Partial<MiAsignacionRow> & { id: string }): MiAsignacionRow {
  return {
    numGuia: 1,
    numRemision: "R-1",
    estatusValue: "en_ruta",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle",
    producto: "caja",
    peso: null,
    montoCobrar: 100,
    latitud: null,
    longitud: null,
    notas: null, // nota de la TIENDA (orden.notas): DISTINTA de la privada
    tiendaNombre: "T",
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: "D",
    mensajeroAsignadoId: "m1",
    ...over,
  };
}

function fakeRepo(rows: MiAsignacionRow[]): IGestionOrdenRepository {
  return {
    findMisAsignaciones: vi.fn(async () => rows),
    contarEntregadas: vi.fn(async () => 0),
    sumMontoCobrarEntregadas: vi.fn(async () => 0),
    findByIdsParaGestion: vi.fn(async () => []),
    getOrdenEnGestion: vi.fn(async () => null),
    setOrdenEnGestion: vi.fn(async () => true),
    liberarOrdenEnGestion: vi.fn(async () => true),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    crearGestionYTransicionar: vi.fn(async () => "g1"),
    reprogramarDesdeDevuelta: vi.fn(async () => true),
  };
}

const fakeOrdenRepo = {
  findEstatusIdByValue: vi.fn(async () => "x"),
  findMensajerosBloqueados: vi.fn(async () => new Set<string>()),
} as unknown as Pick<IOrdenRepository, "findEstatusIdByValue" | "findMensajerosBloqueados">;

const fakeRutaRepo = {
  findByMensajero: vi.fn(async () => null),
  upsertOrigen: vi.fn(async () => {}),
} as unknown as Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen">;

function build(rows: MiAsignacionRow[], notas: Map<string, string>) {
  const metaRepo: Pick<
    IOrdenMensajeroMetaRepository,
    "findMarcarLuegoByMensajero" | "findNotasByMensajero"
  > = {
    findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()),
    findNotasByMensajero: vi.fn(async () => notas),
  };
  const service = new MisAsignacionesService(
    fakeRepo(rows),
    fakeOrdenRepo,
    {} as IFileStorage,
    {} as ISignedUrlProvider,
    fakeRutaRepo,
    metaRepo,
  );
  return { service, metaRepo };
}

describe("R6 — el DTO refleja la nota privada del mensajero", () => {
  it("notaPrivada con el texto para las ordenes con nota; null para el resto", async () => {
    const rows = [
      row({ id: "o1", estatusValue: "en_ruta" }),
      row({ id: "o2", estatusValue: "en_ruta" }),
    ];
    const { service } = build(rows, new Map([["o1", "recoger atras"]]));
    const r = await service.listarMisAsignaciones(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    const byId = new Map(r.porGestionar.map((d) => [d.id, d.notaPrivada]));
    expect(byId.get("o1")).toBe("recoger atras");
    expect(byId.get("o2")).toBeNull();
  });

  it("null por defecto cuando no existe NINGUNA nota", async () => {
    const rows = [row({ id: "o1", estatusValue: "en_ruta" })];
    const { service } = build(rows, new Map());
    const r = await service.listarMisAsignaciones(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porGestionar[0].notaPrivada).toBeNull();
  });

  it("la nota privada NO altera `notas` (nota de la tienda): son campos distintos (R7)", async () => {
    const rows = [row({ id: "o1", estatusValue: "en_ruta", notas: "nota de la tienda" })];
    const { service } = build(rows, new Map([["o1", "mi nota privada"]]));
    const r = await service.listarMisAsignaciones(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porGestionar[0].notas).toBe("nota de la tienda");
    expect(r.porGestionar[0].notaPrivada).toBe("mi nota privada");
  });
});

describe("R8 — privacidad: el listado solo consulta y refleja las notas del propio actor", () => {
  it("consulta findNotasByMensajero EXCLUSIVAMENTE con el usuarioId del actor", async () => {
    const rows = [row({ id: "o1", estatusValue: "en_ruta" })];
    const { service, metaRepo } = build(rows, new Map([["o1", "x"]]));
    await service.listarMisAsignaciones(MENSAJERO);
    expect(metaRepo.findNotasByMensajero).toHaveBeenCalledWith("m1");
    expect(metaRepo.findNotasByMensajero).toHaveBeenCalledTimes(1);
  });

  it("una nota de otra orden (no listada) no ensucia el DTO de las ordenes del actor", async () => {
    const rows = [row({ id: "o1", estatusValue: "en_ruta" })];
    const { service } = build(rows, new Map([["o9", "nota de otra orden"]]));
    const r = await service.listarMisAsignaciones(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porGestionar[0].notaPrivada).toBeNull();
  });

  it("la nota tambien viaja en 'Por recoger' (dato de la pareja mensajero/orden)", async () => {
    const rows = [row({ id: "o3", estatusValue: "por_recoger" })];
    const { service } = build(rows, new Map([["o3", "nota por recoger"]]));
    const r = await service.listarMisAsignaciones(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porRecoger[0].notaPrivada).toBe("nota por recoger");
  });
});
