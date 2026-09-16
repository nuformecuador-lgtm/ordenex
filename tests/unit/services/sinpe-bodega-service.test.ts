import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";

import { SinpeBodegaService } from "@/lib/services/SinpeBodegaService";
import type {
  IZonaRepository,
  SinpeZonaRow,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IZonaService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T9 — LA MATRIZ DE PERMISOS (R19) Y LA ZONA QUE DECIDE (R20).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Aqui se mide la REGLA, con dobles. Lo que NO se puede medir aqui —que la zona del actor sale de
// verdad de `usuario.zona_id`— vive en `tests/integration/db/zona-sinpe-permisos.test.ts`, contra
// Postgres real: con `zonaIdDeUsuario` mockeado, afirmar «sale de la base» seria una asercion
// contra su propia fuente.
//
// ⚠️ NINGUN SINPE DE AQUI ES REAL. El repositorio es publico.

const NUM = "80000000";
const NOMBRE = "Titular de Prueba";

/** Las ocho bodegas de la operacion, con la central primero (como en produccion). */
const BODEGAS: SinpeZonaRow[] = Array.from({ length: 8 }, (_, i) => ({
  id: `z-${i}`,
  nombre: `Bodega ${i}`,
  esCentral: i === 0,
  sinpeNumero: NUM,
  sinpeNombre: NOMBRE,
  sinpeRevisadoAt: null,
}));

/** La zona que la BASE le asigna a cada usuario de prueba. */
const ZONA_DE: Record<string, string | null> = {
  "u-maestro": null,
  "u-admin": null,
  "u-satelite-3": "z-3",
  "u-mensajero": "z-4",
  "u-tienda": null,
};

function buildRepo(overrides: Partial<IZonaRepository> = {}): IZonaRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    listLite: vi.fn(),
    update: vi.fn(),
    hardDelete: vi.fn(),
    countExistingDistritos: vi.fn(),
    countExistingVehiculos: vi.fn(),
    findCentralZonaId: vi.fn().mockResolvedValue("z-0"),
    contarOrdenesVivasPorZona: vi.fn().mockResolvedValue([]),
    listarSinpe: vi.fn().mockResolvedValue(BODEGAS),
    findSinpeByZona: vi
      .fn()
      .mockImplementation(async (id: string) => BODEGAS.find((b) => b.id === id) ?? null),
    zonaIdDeUsuario: vi.fn().mockImplementation(async (id: string) => ZONA_DE[id] ?? null),
    guardarSinpe: vi
      .fn()
      .mockImplementation(async (id: string) => BODEGAS.find((b) => b.id === id) ?? null),
    confirmarSinpe: vi
      .fn()
      .mockImplementation(async (id: string) => BODEGAS.find((b) => b.id === id) ?? null),
    ...overrides,
  };
}

const actor = (usuarioId: string, rol: RolValue): Actor => ({ usuarioId, rol });

const INPUT = { numero: "70000001", nombre: "Otro Titular de Prueba" };

describe("429/R19 — la matriz de roles x bodegas", () => {
  it.each([
    ["maestro", "u-maestro"],
    ["admin", "u-admin"],
  ] as const)("`%s` puede guardar LAS OCHO", async (rol, usuarioId) => {
    // ⚠️ `admin` EN LAS OCHO Y NO SOLO EN LA CENTRAL (Q2, cerrada por el leader el 2026-09-15). El
    // motivo esta escrito en `ROLES_QUE_EDITAN_SINPE`: acotarlo aqui seria la primera excepcion del
    // patron «quien se acota por zona es `adminSatelite`», y devolveria la dependencia de una sola
    // persona que esta ficha viene a quitar.
    const repo = buildRepo();
    const service = new SinpeBodegaService(repo);
    for (const bodega of BODEGAS) {
      const r = await service.guardar(bodega.id, INPUT, actor(usuarioId, rol));
      expect(r.status, `${rol} en ${bodega.id}`).toBe("ok");
    }
    expect(repo.guardarSinpe).toHaveBeenCalledTimes(8);
  });

  it("`adminSatelite` puede SOLO con la suya, y con las otras siete recibe `forbidden`", async () => {
    const repo = buildRepo();
    const service = new SinpeBodegaService(repo);
    const a = actor("u-satelite-3", "adminSatelite");

    expect((await service.guardar("z-3", INPUT, a)).status).toBe("ok");
    for (const bodega of BODEGAS.filter((b) => b.id !== "z-3")) {
      expect((await service.guardar(bodega.id, INPUT, a)).status, bodega.id).toBe("forbidden");
    }
    // ⚠️ SIN ESCRITURA: el repositorio se llamo UNA sola vez, la de la suya. Un `forbidden` que
    // devolviera el error DESPUES de escribir seria peor que no tenerlo.
    expect(repo.guardarSinpe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["mensajero", "u-mensajero"],
    ["adminTienda", "u-tienda"],
  ] as const)("`%s` recibe `forbidden` en LAS OCHO y no emite ninguna consulta", async (rol, usuarioId) => {
    const repo = buildRepo();
    const service = new SinpeBodegaService(repo);
    for (const bodega of BODEGAS) {
      expect((await service.guardar(bodega.id, INPUT, actor(usuarioId, rol))).status).toBe(
        "forbidden",
      );
    }
    expect(repo.guardarSinpe).not.toHaveBeenCalled();
    // R31: quien no puede editar ninguna no paga ni la lectura de su zona.
    expect(repo.zonaIdDeUsuario).not.toHaveBeenCalled();
  });

  it("`listar` acota igual: el `adminSatelite` ve UNA ficha y el `maestro` las ocho", async () => {
    const service = new SinpeBodegaService(buildRepo());
    const deMaestro = await service.listar(actor("u-maestro", "maestro"));
    const deSatelite = await service.listar(actor("u-satelite-3", "adminSatelite"));
    expect(deMaestro.status === "ok" && deMaestro.items).toHaveLength(8);
    expect(deSatelite.status === "ok" && deSatelite.items).toHaveLength(1);
    expect(deSatelite.status === "ok" && deSatelite.items[0].zonaId).toBe("z-3");
  });

  it("⭑ `editable` lo decide el SERVIDOR, y es `true` solo donde el actor puede escribir", async () => {
    // Si la pantalla lo recalculara, habria dos reglas de permiso y divergirian sin que nada se
    // pusiera rojo. Aqui se afirma que el dato ya viene decidido.
    const service = new SinpeBodegaService(buildRepo());
    const deMaestro = await service.listar(actor("u-maestro", "maestro"));
    expect(deMaestro.status === "ok" && deMaestro.items.every((i) => i.editable)).toBe(true);
    const deSatelite = await service.listar(actor("u-satelite-3", "adminSatelite"));
    expect(deSatelite.status === "ok" && deSatelite.items[0].editable).toBe(true);
  });
});

describe("429/R20 — el `zonaId` del payload dice QUE, nunca SI", () => {
  it("⭑ un `adminSatelite` con un `zonaId` ajeno en la peticion NO cambia la zona que se usa", async () => {
    // El ataque que R20 cierra: mandar el id de otra bodega y confiar en que alguien lo crea. La
    // zona que decide sale de `zonaIdDeUsuario`, que consulta por `usuarioId` — nunca del payload.
    const repo = buildRepo();
    const service = new SinpeBodegaService(repo);
    const r = await service.guardar("z-0", INPUT, actor("u-satelite-3", "adminSatelite"));
    expect(r.status).toBe("forbidden");
    expect(repo.guardarSinpe).not.toHaveBeenCalled();
    // Y la consulta que decidio fue por el USUARIO, no por la zona pedida.
    expect(repo.zonaIdDeUsuario).toHaveBeenCalledWith("u-satelite-3");
  });

  it("un `adminSatelite` SIN zona no puede con ninguna: `null` es «ninguna», no «todas»", async () => {
    const repo = buildRepo({ zonaIdDeUsuario: vi.fn().mockResolvedValue(null) });
    const service = new SinpeBodegaService(repo);
    for (const bodega of BODEGAS) {
      expect((await service.guardar(bodega.id, INPUT, actor("u-huerfano", "adminSatelite"))).status)
        .toBe("forbidden");
    }
    expect(repo.guardarSinpe).not.toHaveBeenCalled();
  });

  it("confirmar exige EL MISMO permiso que guardar: quien no corrige, no aprueba", async () => {
    const repo = buildRepo();
    const service = new SinpeBodegaService(repo);
    expect((await service.confirmar("z-0", actor("u-satelite-3", "adminSatelite"))).status).toBe(
      "forbidden",
    );
    expect((await service.confirmar("z-3", actor("u-satelite-3", "adminSatelite"))).status).toBe(
      "ok",
    );
    expect(repo.confirmarSinpe).toHaveBeenCalledTimes(1);
  });
});

describe("429 — los desenlaces que no son permisos", () => {
  it("una zona que no existe es `not_found`, no `forbidden`", async () => {
    // Confundirlos manda a quien lo lee a buscar un problema de permisos que no existe.
    const service = new SinpeBodegaService(
      buildRepo({ guardarSinpe: vi.fn().mockResolvedValue(null) }),
    );
    expect((await service.guardar("z-99", INPUT, actor("u-maestro", "maestro"))).status).toBe(
      "not_found",
    );
  });

  it("`revisadoAt` viaja como ISO o como `null`, nunca como una fecha inventada", async () => {
    const cuando = new Date("2026-09-15T12:00:00.000Z");
    const service = new SinpeBodegaService(
      buildRepo({
        listarSinpe: vi
          .fn()
          .mockResolvedValue([
            { ...BODEGAS[0], sinpeRevisadoAt: cuando },
            { ...BODEGAS[1], sinpeRevisadoAt: null },
          ]),
      }),
    );
    const r = await service.listar(actor("u-maestro", "maestro"));
    expect(r.status === "ok" && r.items[0].revisadoAt).toBe(cuando.toISOString());
    // R5: la ausencia de revision NO puede confundirse con una revision.
    expect(r.status === "ok" && r.items[1].revisadoAt).toBeNull();
  });
});
