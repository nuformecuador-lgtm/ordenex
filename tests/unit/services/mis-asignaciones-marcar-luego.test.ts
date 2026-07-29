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
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

// Feature 115 — T6: reflejo de `marcarLuego` en el listado (R17) y privacidad por actor (R20).

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

function row(over: Partial<MiAsignacionRow> & { id: string }): MiAsignacionRow {
  return {
    numGuia: 1,
    numRemision: "R-1",
    estatusValue: "en_reparto",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle",
    producto: "caja",
    peso: null,
    montoCobrar: 100,
    latitud: null,
    longitud: null,
    notas: null,
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

function build(rows: MiAsignacionRow[], marcadas: Set<string>) {
  const metaRepo: Pick<
    IOrdenMensajeroMetaRepository,
    "findMarcarLuegoByMensajero" | "findNotasByMensajero"
  > = {
    findMarcarLuegoByMensajero: vi.fn(async () => marcadas),
    findNotasByMensajero: vi.fn(async () => new Map<string, string>()), // feature 116
  };
  const service = new MisAsignacionesService(
    fakeRepo(rows),
    fakeOrdenRepo,
    {} as IFileStorage,
    {} as ISignedUrlProvider,
    fakeRutaRepo,
    metaRepo,
    fakeIntentosEnLote(), // feature 160: dep requerida, no ejercitada aqui
  );
  return { service, metaRepo };
}

describe("R17 — el DTO refleja marcar_luego del mensajero", () => {
  it("marcarLuego=true para las ordenes con fila marcada; false para el resto", async () => {
    const rows = [
      row({ id: "o1", estatusValue: "en_reparto" }),
      row({ id: "o2", estatusValue: "en_reparto" }),
    ];
    const { service } = build(rows, new Set(["o1"]));
    const r = await service.listarMisAsignaciones(MENSAJERO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const byId = new Map(r.porGestionar.map((d) => [d.id, d.marcarLuego]));
    expect(byId.get("o1")).toBe(true);
    expect(byId.get("o2")).toBe(false);
  });

  it("R17: false por defecto cuando no existe NINGUNA fila de marca", async () => {
    const rows = [row({ id: "o1", estatusValue: "en_reparto" })];
    const { service } = build(rows, new Set());
    const r = await service.listarMisAsignaciones(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porGestionar[0].marcarLuego).toBe(false);
  });

  it("R17: la marca tambien viaja en 'Por recoger' (dato de la pareja mensajero/orden)", async () => {
    const rows = [row({ id: "o3", estatusValue: "por_recoger" })];
    const { service } = build(rows, new Set(["o3"]));
    const r = await service.listarMisAsignaciones(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porRecoger[0].marcarLuego).toBe(true);
  });
});

describe("R20 — privacidad: el listado solo refleja las marcas del propio actor", () => {
  it("solo consulta las marcas del actor (usuarioId) y no las de otro mensajero", async () => {
    const rows = [row({ id: "o1", estatusValue: "en_reparto" })];
    // El repo mock devolveria un Set solo con las del actor; aqui verificamos que el service
    // consulta EXCLUSIVAMENTE con el usuarioId del actor (nunca con otro).
    const { service, metaRepo } = build(rows, new Set(["o1"]));
    await service.listarMisAsignaciones(MENSAJERO);
    expect(metaRepo.findMarcarLuegoByMensajero).toHaveBeenCalledWith("m1");
    expect(metaRepo.findMarcarLuegoByMensajero).toHaveBeenCalledTimes(1);
  });

  it("una marca de otra orden (no listada) no ensucia el DTO de las ordenes del actor", async () => {
    const rows = [row({ id: "o1", estatusValue: "en_reparto" })];
    // El Set del actor trae "o9" (otra orden suya no presente en el listado): no debe afectar o1.
    const { service } = build(rows, new Set(["o9"]));
    const r = await service.listarMisAsignaciones(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.porGestionar[0].marcarLuego).toBe(false);
  });
});
