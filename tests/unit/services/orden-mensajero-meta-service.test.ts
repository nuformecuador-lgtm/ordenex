import { describe, it, expect, vi } from "vitest";
import { OrdenMensajeroMetaService } from "@/lib/services/OrdenMensajeroMetaService";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { OrdenDTO } from "@/lib/types/orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 115 — T4: logica de negocio del toggle "gestionar mas tarde". Dobles sin DB.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const OTRO: Actor = { usuarioId: "m2", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

// OrdenDTO minima para la guarda de propiedad (findById). Solo importan `id` y
// `mensajeroAsignadoId`; el resto se rellena para satisfacer el tipo.
function ordenDTO(over: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "o1",
    numGuia: 1001,
    numRemision: "REM-1",
    estatusId: "os-reparto",
    estatusValue: "en_reparto",
    destinatario: "Ana",
    telefonoDest: "88880000",
    tiendaId: "t1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1,
    notas: null,
    mensajeroAsignadoId: "m1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function fakeMetaRepo(
  over: Partial<IOrdenMensajeroMetaRepository> = {},
): IOrdenMensajeroMetaRepository {
  return {
    upsertMarcarLuego: vi.fn(async () => {}),
    findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()),
    // Feature 116: metodos `nota` de la misma interfaz; este service (marca) no los usa.
    upsertNota: vi.fn(async () => {}),
    limpiarNota: vi.fn(async () => {}),
    findNotasByMensajero: vi.fn(async () => new Map<string, string>()),
    ...over,
  };
}

// El service solo usa `findById` del OrdenRepository (Pick). El doble expone TODOS los
// metodos mutadores como spies para poder afirmar que NUNCA se llaman (R15/R16), aunque el
// service reciba solo el Pick.
function fakeOrdenRepo(orden: OrdenDTO | null = ordenDTO()) {
  return {
    findById: vi.fn(async () => orden),
    update: vi.fn(async () => orden),
    softDelete: vi.fn(async () => true),
    generarGuiaLote: vi.fn(async () => []),
    asignarBodegaLote: vi.fn(async () => 0),
  };
}

function build(orden: OrdenDTO | null = ordenDTO(), metaOver: Partial<IOrdenMensajeroMetaRepository> = {}) {
  const meta = fakeMetaRepo(metaOver);
  const ordenRepo = fakeOrdenRepo(orden);
  const service = new OrdenMensajeroMetaService(meta, ordenRepo as unknown as Pick<IOrdenRepository, "findById">);
  return { service, meta, ordenRepo };
}

describe("R5/R6 — marcar/desmarcar persiste el valor explicito (upsert)", () => {
  it("R5: marcar setea marcar_luego=true (upsert) para la pareja actor/orden", async () => {
    const { service, meta } = build();
    const r = await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO);
    expect(r).toEqual({ status: "ok", ordenId: "o1", marcarLuego: true });
    expect(meta.upsertMarcarLuego).toHaveBeenCalledWith("m1", "o1", true);
  });

  it("R6: quitar setea marcar_luego=false", async () => {
    const { service, meta } = build();
    const r = await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: false }, MENSAJERO);
    expect(r).toEqual({ status: "ok", ordenId: "o1", marcarLuego: false });
    expect(meta.upsertMarcarLuego).toHaveBeenCalledWith("m1", "o1", false);
  });
});

describe("R8/R12 — usuario_id SIEMPRE del actor, nunca del input", () => {
  it("R8: usa el usuario_id del actor aunque el input intente colar otro", async () => {
    const { service, meta } = build();
    // Un cliente malicioso podria inyectar propiedades extra; el schema/service SOLO usan
    // ordenId + marcarLuego, y el usuario_id lo fija el actor.
    await service.marcarGestionarLuego(
      { ordenId: "o1", marcarLuego: true, usuarioId: "m2" } as never,
      MENSAJERO,
    );
    const [usuarioId] = (meta.upsertMarcarLuego as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(usuarioId).toBe("m1"); // el del actor, no "m2"
  });

  it("R12: no puede escribir la fila de otro mensajero (el where fija su propio usuario_id)", async () => {
    const { service, meta } = build();
    await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, OTRO);
    // La orden es de m1 (mensajeroAsignadoId), asi que OTRO (m2) recibe forbidden y NO escribe.
    expect(meta.upsertMarcarLuego).not.toHaveBeenCalled();
  });
});

describe("R11 — solo el rol mensajero", () => {
  it("R11: forbidden si el rol no es mensajero, sin tocar la orden ni la meta", async () => {
    const { service, meta, ordenRepo } = build();
    const r = await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MAESTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(ordenRepo.findById).not.toHaveBeenCalled();
    expect(meta.upsertMarcarLuego).not.toHaveBeenCalled();
  });
});

describe("R13/R14 — propiedad y existencia de la orden", () => {
  it("R13: forbidden si la orden esta asignada a otro mensajero, sin escribir", async () => {
    const { service, meta } = build(ordenDTO({ mensajeroAsignadoId: "m2" }));
    const r = await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO);
    expect(r).toEqual({ status: "forbidden" });
    expect(meta.upsertMarcarLuego).not.toHaveBeenCalled();
  });

  it("R13: forbidden si la orden no tiene mensajero asignado (null), sin escribir", async () => {
    const { service, meta } = build(ordenDTO({ mensajeroAsignadoId: null }));
    const r = await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO);
    expect(r).toEqual({ status: "forbidden" });
    expect(meta.upsertMarcarLuego).not.toHaveBeenCalled();
  });

  it("R14: not_found si la orden no existe o esta borrada (findById -> null), sin escribir", async () => {
    const { service, meta } = build(null);
    const r = await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO);
    expect(r).toEqual({ status: "not_found" });
    expect(meta.upsertMarcarLuego).not.toHaveBeenCalled();
  });
});

describe("R15/R16 — solo informativo: no cambia estatus/prioridad/ruta ni historial", () => {
  it("R15/R16: el toggle NO llama a ningun mutador de la orden (solo lee findById + upsert de meta)", async () => {
    const { service, ordenRepo, meta } = build();
    await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO);
    // Unico acceso a la orden: la lectura de la guarda de propiedad.
    expect(ordenRepo.findById).toHaveBeenCalledTimes(1);
    // Ningun mutador de la orden fue tocado (estatus/prioridad/ruta/historial).
    expect(ordenRepo.update).not.toHaveBeenCalled();
    expect(ordenRepo.softDelete).not.toHaveBeenCalled();
    expect(ordenRepo.generarGuiaLote).not.toHaveBeenCalled();
    expect(ordenRepo.asignarBodegaLote).not.toHaveBeenCalled();
    // El unico efecto persistido vive en `orden_mensajero_meta`.
    expect(meta.upsertMarcarLuego).toHaveBeenCalledTimes(1);
  });
});
