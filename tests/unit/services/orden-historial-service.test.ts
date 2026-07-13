import { describe, it, expect, vi } from "vitest";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

// Feature 49 (T4.1/T4.2) — tests del OrdenHistorialService (sin DB, dobles de repos).
// Cubre R26 (linea de tiempo cronologica), R27 (autorizacion por visibilidad de la orden,
// por rol) y R24/R25 (derivador de intentos = conteo de destinos `devuelta`).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const SATELITE: Actor = { usuarioId: "as1", rol: "adminSatelite" };

const ZONA = "z-limon";

function ordenDTO(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "o1",
    numGuia: 10,
    numRemision: "R-1",
    estatusId: "s-reparto",
    destinatario: "Ana",
    telefonoDest: "099",
    tiendaId: "u-tienda",
    zonaId: ZONA,
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "caja",
    peso: null,
    notas: null,
    mensajeroAsignadoId: null,
    createdAt: new Date("2026-07-13T09:00:00.000Z"),
    updatedAt: new Date("2026-07-13T09:00:00.000Z"),
    ...overrides,
  };
}

function entrada(overrides: Partial<OrdenHistorialEntradaDTO> = {}): OrdenHistorialEntradaDTO {
  return {
    estatusOrigenValue: null,
    estatusDestinoValue: "en_preparacion",
    origenTipo: "carga_masiva",
    actorNombre: "Tienda X",
    motivo: null,
    createdAt: new Date("2026-07-13T10:00:00.000Z"),
    ...overrides,
  };
}

type OrdenRepoMethods = Pick<
  IOrdenRepository,
  "findById" | "findUsuarioZonaId" | "findEstatusIdByValue"
>;
type HistorialRepoMethods = Pick<
  IOrdenHistorialRepository,
  "findHistorialByOrden" | "existeActuacionDe" | "contarPorDestino"
>;

function ordenRepo(overrides: Partial<OrdenRepoMethods> = {}): OrdenRepoMethods {
  return {
    findById: vi.fn(async () => ordenDTO()),
    findUsuarioZonaId: vi.fn(async () => ZONA),
    findEstatusIdByValue: vi.fn(async (v: string) => (v === "devuelta" ? "s-devuelta" : null)),
    ...overrides,
  };
}

function historialRepo(overrides: Partial<HistorialRepoMethods> = {}): HistorialRepoMethods {
  return {
    findHistorialByOrden: vi.fn(async () => [entrada()]),
    existeActuacionDe: vi.fn(async () => false),
    contarPorDestino: vi.fn(async () => 0),
    ...overrides,
  };
}

function newService(o: OrdenRepoMethods = ordenRepo(), h: HistorialRepoMethods = historialRepo()) {
  return new OrdenHistorialService(
    o as unknown as IOrdenRepository,
    h as unknown as IOrdenHistorialRepository,
  );
}

// --- obtenerHistorial: autorizacion (R27) + orden cronologico (R26) ---

describe("obtenerHistorial — autorizacion por visibilidad (R27)", () => {
  it("orden inexistente/borrada -> not_found (findById excluye borradas)", async () => {
    const h = historialRepo();
    const r = await newService(ordenRepo({ findById: vi.fn(async () => null) }), h).obtenerHistorial(
      "o1",
      MAESTRO,
    );
    expect(r.status).toBe("not_found");
    expect(h.findHistorialByOrden).not.toHaveBeenCalled();
  });

  it("rol desconocido -> forbidden, sin tocar datos", async () => {
    const o = ordenRepo();
    const r = await newService(o).obtenerHistorial("o1", {
      usuarioId: "x",
      rol: "desconocido" as Actor["rol"],
    });
    expect(r.status).toBe("forbidden");
    expect(o.findById).not.toHaveBeenCalled();
  });

  it("maestro -> ok con las entradas (cualquier orden)", async () => {
    const r = await newService().obtenerHistorial("o1", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.entradas).toHaveLength(1);
  });

  // Feature 47 (R15/R17): el ok expone el conteo de intentos DERIVADO y el umbral, con la
  // MISMA autorizacion de la orden (no se añade regla nueva). Aqui hay 2 destinos `devuelta`.
  it("R15/R17: el ok incluye intentos (derivado) y umbral, tras autorizar la orden", async () => {
    const o = ordenRepo({ findEstatusIdByValue: vi.fn(async () => "s-devuelta") });
    const h = historialRepo({ contarPorDestino: vi.fn(async () => 2) });
    const r = await newService(o, h).obtenerHistorial("o1", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.intentos).toBe(2); // consume el derivador de la 49 (contarPorDestino a `devuelta`)
    expect(r.umbral).toBe(3); // default por ley (reintentosConfig, env no seteado en test)
    expect(h.contarPorDestino).toHaveBeenCalledWith("o1", "s-devuelta");
  });

  it("R15: sin devoluciones -> intentos 0 (no bloquea el ok)", async () => {
    const o = ordenRepo({ findEstatusIdByValue: vi.fn(async () => "s-devuelta") });
    const h = historialRepo({ contarPorDestino: vi.fn(async () => 0) });
    const r = await newService(o, h).obtenerHistorial("o1", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.intentos).toBe(0);
  });

  it("admin -> ok con las entradas (cualquier orden)", async () => {
    const r = await newService().obtenerHistorial("o1", ADMIN);
    expect(r.status).toBe("ok");
  });

  it("adminTienda de SU tienda -> ok", async () => {
    const o = ordenRepo({ findById: vi.fn(async () => ordenDTO({ tiendaId: "u-tienda" })) });
    const r = await newService(o).obtenerHistorial("o1", TIENDA);
    expect(r.status).toBe("ok");
  });

  it("adminTienda con orden AJENA -> not_found (no filtra datos)", async () => {
    const o = ordenRepo({ findById: vi.fn(async () => ordenDTO({ tiendaId: "otra-tienda" })) });
    const h = historialRepo();
    const r = await newService(o, h).obtenerHistorial("o1", TIENDA);
    expect(r.status).toBe("not_found");
    expect(h.findHistorialByOrden).not.toHaveBeenCalled();
  });

  it("mensajero ASIGNADO a la orden -> ok (sin consultar el rastro)", async () => {
    const o = ordenRepo({ findById: vi.fn(async () => ordenDTO({ mensajeroAsignadoId: "m1" })) });
    const h = historialRepo();
    const r = await newService(o, h).obtenerHistorial("o1", MENSAJERO);
    expect(r.status).toBe("ok");
    expect(h.existeActuacionDe).not.toHaveBeenCalled();
  });

  it("mensajero NO asignado pero que ACTUO la orden (estuvo asignada) -> ok", async () => {
    const o = ordenRepo({ findById: vi.fn(async () => ordenDTO({ mensajeroAsignadoId: null })) });
    const h = historialRepo({ existeActuacionDe: vi.fn(async () => true) });
    const r = await newService(o, h).obtenerHistorial("o1", MENSAJERO);
    expect(r.status).toBe("ok");
    expect(h.existeActuacionDe).toHaveBeenCalledWith("o1", "m1");
  });

  it("mensajero NO asignado y sin rastro -> forbidden, sin listar el historial", async () => {
    const o = ordenRepo({ findById: vi.fn(async () => ordenDTO({ mensajeroAsignadoId: "otro" })) });
    const h = historialRepo({ existeActuacionDe: vi.fn(async () => false) });
    const r = await newService(o, h).obtenerHistorial("o1", MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(h.findHistorialByOrden).not.toHaveBeenCalled();
  });

  it("adminSatelite con orden de SU zona -> ok", async () => {
    const o = ordenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: ZONA })),
      findUsuarioZonaId: vi.fn(async () => ZONA),
    });
    const r = await newService(o).obtenerHistorial("o1", SATELITE);
    expect(r.status).toBe("ok");
  });

  it("adminSatelite con orden FUERA de su zona -> forbidden", async () => {
    const o = ordenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: "z-otra" })),
      findUsuarioZonaId: vi.fn(async () => ZONA),
    });
    const h = historialRepo();
    const r = await newService(o, h).obtenerHistorial("o1", SATELITE);
    expect(r.status).toBe("forbidden");
    expect(h.findHistorialByOrden).not.toHaveBeenCalled();
  });

  it("adminSatelite sin zona asignada -> forbidden", async () => {
    const o = ordenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: ZONA })),
      findUsuarioZonaId: vi.fn(async () => null),
    });
    const r = await newService(o).obtenerHistorial("o1", SATELITE);
    expect(r.status).toBe("forbidden");
  });

  it("R26: devuelve las entradas ordenadas tal como las provee el repo (cronologico)", async () => {
    const e1 = entrada({ estatusDestinoValue: "en_preparacion", createdAt: new Date("2026-07-13T10:00:00.000Z") });
    const e2 = entrada({
      estatusOrigenValue: "en_reparto",
      estatusDestinoValue: "devuelta",
      origenTipo: "gestion",
      actorNombre: null,
      motivo: "cliente ausente",
      createdAt: new Date("2026-07-13T12:00:00.000Z"),
    });
    const h = historialRepo({ findHistorialByOrden: vi.fn(async () => [e1, e2]) });
    const r = await newService(ordenRepo(), h).obtenerHistorial("o1", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.entradas).toEqual([e1, e2]);
      expect(h.findHistorialByOrden).toHaveBeenCalledWith("o1");
    }
  });
});

// --- contarIntentos: derivador (R24/R25) ---

describe("contarIntentos — derivador de intentos (R24/R25)", () => {
  it("N transiciones a `devuelta` -> N", async () => {
    const o = ordenRepo({ findEstatusIdByValue: vi.fn(async () => "s-devuelta") });
    const h = historialRepo({ contarPorDestino: vi.fn(async () => 3) });
    const n = await newService(o, h).contarIntentos("o1");
    expect(n).toBe(3);
    expect(o.findEstatusIdByValue).toHaveBeenCalledWith("devuelta");
    expect(h.contarPorDestino).toHaveBeenCalledWith("o1", "s-devuelta");
  });

  it("sin devueltas -> 0", async () => {
    const o = ordenRepo({ findEstatusIdByValue: vi.fn(async () => "s-devuelta") });
    const h = historialRepo({ contarPorDestino: vi.fn(async () => 0) });
    expect(await newService(o, h).contarIntentos("o1")).toBe(0);
  });

  it("catalogo sin `devuelta` (seed pendiente) -> 0 sin contar", async () => {
    const o = ordenRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const h = historialRepo();
    expect(await newService(o, h).contarIntentos("o1")).toBe(0);
    expect(h.contarPorDestino).not.toHaveBeenCalled();
  });
});
