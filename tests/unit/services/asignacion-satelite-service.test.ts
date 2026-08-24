import { describe, it, expect, vi } from "vitest";
import { AsignacionSateliteService } from "@/lib/services/AsignacionSateliteService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import { MSG_ORDEN_REPROGRAMADA_BLOQUEADA } from "@/lib/services/mensajes-bloqueo";
import type {
  IOrdenRepository,
  OrdenTransicionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
// Feature 246 (T3.2, D4): el UNICO traductor «hoy/mañana» -> fecha del repo. Se importa para
// afirmar que las dos superficies de asignacion producen el MISMO dia para la misma entrada.
import { resolverFechaReparto } from "@/lib/utils/dia-reparto";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";

// Feature 34 — service de la asignacion satelite. Dobles de repo (sin DB/HTTP),
// patron recepcion-satelite-service.test.ts. Cubre R3, R7, R8, R9, R10, R11, R12,
// R13, R14.

const ADMIN: Actor = { usuarioId: "as1", rol: "adminSatelite" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const MENSAJERO_ACTOR: Actor = { usuarioId: "m1", rol: "mensajero" };

const ZONA = "z-satelite";
const MENSAJERO = "m-zona";

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_bodega_satelite: "os-bodega-satelite",
  por_recoger: "os-espera",
};

type RepoMethods = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findMensajeroIdsValidosByZona"
  | "findByIdsForTransicion"
  | "findEstatusIdByValue"
  | "asignarSateliteLote"
  | "existeBodegaSateliteBloqueada" // feature 41/R18
  // ⚠️ FEATURE 241: el doble SIGUE OFRECIENDO el predicado, pero el service YA NO lo pide en su
  // `AsignacionSateliteRepo`. Esa diferencia es deliberada y es lo que hace que el
  // `not.toHaveBeenCalled()` de mas abajo afirme una decision de diseño y no solo la
  // implementacion de hoy: el espia esta ahi, disponible, y aun asi no se toca.
  | "findMensajerosBloqueadosPorCierres"
  | "findParaAsignabilidad" // feature 92/R8
>;

function transicionRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "en_bodega_satelite",
    numGuia: 10,
    deletedAt: null,
    zonaId: ZONA,
    zonaEsGam: false,
    tiendaId: "store-1",
    // Feature 262 (B3): `fechaReparto` pasa a ser OBLIGATORIO en la fila de transicion (es insumo
    // de una guarda de la correccion del dia). `null` = la orden aun no esta asignada, que es el
    // estado de partida de estos casos. Ninguna asercion de este archivo cambia.
    fechaReparto: null,
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<RepoMethods> = {}): RepoMethods {
  return {
    findUsuarioZonaId: vi.fn(async () => ZONA),
    findMensajeroIdsValidosByZona: vi.fn(async () => new Set([MENSAJERO])),
    findByIdsForTransicion: vi.fn(async () => [transicionRow()]),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    asignarSateliteLote: vi.fn(async () => 1),
    // Feature 41: por defecto bodega libre y mensajero no bloqueado (los tests de
    // bloqueo overridean estos dobles).
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set()),
    // Feature 92 (R8): filas que consume el gate de coordenadas.
    findParaAsignabilidad: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, direccion: "x", latitud: 9.9, longitud: -84.1, geocodeStatus: "OK" })),
    ),
    ...overrides,
  };
}

/**
 * Feature 92 (R8): el gate de asignabilidad es una dep REQUERIDA del service. Estos tests
 * no lo ejercitan (eso vive en `asignacion-satelite-gate-coordenadas.test.ts`), asi que se
 * inyecta un doble que declara TODA orden asignable — que es el estado real de una orden ya
 * geocodificada. Es el escenario feliz, no un aflojamiento: el gate tiene su test propio.
 */
function gateTodoAsignable(): IAsignabilidadCoordenadasService {
  return {
    evaluar: async (ordenes: OrdenAsignabilidadRow[]) =>
      new Map<string, EstadoAsignabilidad>(ordenes.map((o) => [o.id, "asignable"])),
  };
}

function newService(
  repo: RepoMethods = fakeRepo(),
  gate: IAsignabilidadCoordenadasService = gateTodoAsignable(),
) {
  return new AsignacionSateliteService(repo as unknown as IOrdenRepository, gate, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);
}

describe("AsignacionSateliteService.asignar", () => {
  it("R13: rol != adminSatelite -> forbidden ANTES de tocar datos", async () => {
    const repo = fakeRepo();
    for (const actor of [MAESTRO, MENSAJERO_ACTOR]) {
      const res = await newService(repo).asignar(
        { ordenIds: ["o1"], mensajeroId: MENSAJERO },
        actor,
      );
      expect(res).toEqual({ status: "forbidden" });
    }
    // Sin efectos ni lecturas: la autorizacion corta antes de resolver la zona.
    expect(repo.findUsuarioZonaId).not.toHaveBeenCalled();
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R3: adminSatelite sin zona (zonaId null) -> sin_zona, sin escribir", async () => {
    const repo = fakeRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({ status: "sin_zona" });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R9: mensajero de otra zona / no-mensajero -> validation_error mensajero_invalido, sin escribir", async () => {
    const repo = fakeRepo({ findMensajeroIdsValidosByZona: vi.fn(async () => new Set<string>()) });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: "m-ajeno" },
      ADMIN,
    );
    expect(res).toEqual({
      status: "validation_error",
      fieldErrors: { mensajeroId: ["mensajero_invalido"] },
    });
    // Valida el mensajero contra la zona del actor (defensa en profundidad R5/R9).
    expect(repo.findMensajeroIdsValidosByZona).toHaveBeenCalledWith(["m-ajeno"], ZONA);
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R7/R8: lote OK -> ok, todas por_recoger; escribe con mensajero y NO toca num_guia", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        transicionRow({ id: "o1" }),
        transicionRow({ id: "o2" }),
      ]),
      asignarSateliteLote: vi.fn(async () => 2),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1", "o2"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "por_recoger" },
        { ordenId: "o2", estado: "por_recoger" },
      ],
    });
    // R8: escribe con estatus origen/destino resueltos, sin num_guia.
    // Feature 49/#7: pasa ademas el contexto de historial (actor = adminSatelite).
    // Feature 246 (T3.2, R4/R7): el dia de reparto YA RESUELTO viaja en la MISMA llamada. Sin
    // `dia` en la peticion se comporta como «hoy», igual que la bodega central (D4).
    expect(repo.asignarSateliteLote).toHaveBeenCalledWith(
      ["o1", "o2"],
      MENSAJERO,
      ZONA,
      "os-espera",
      "os-bodega-satelite",
      { actorUsuarioId: "as1", origenTipo: "asignacion_satelite" },
      expect.any(Date),
    );
  });

  it("R10/R11: orden de otra zona en el lote -> conflict/zona_ajena; ninguna transiciona", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        transicionRow({ id: "o1" }),
        transicionRow({ id: "o2", zonaId: "z-otra" }),
      ]),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1", "o2"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: "zona_ajena" }],
    });
    // R10 (todo-o-nada): no escribe si hay cualquier motivo.
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R10/R12: orden en estado != en_bodega_satelite -> conflict/estado_invalido con el estado actual", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        transicionRow({ id: "o1", estatusValue: "por_recoger" }),
      ]),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "estado_invalido: por_recoger" }],
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R10: orden inexistente o borrada -> conflict/no_encontrada", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        transicionRow({ id: "o1", deletedAt: new Date("2026-01-01") }),
        // o2 no existe (ausente del resultado)
      ]),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1", "o2"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "conflict",
      detalle: [
        { ordenId: "o1", motivo: "no_encontrada" },
        { ordenId: "o2", motivo: "no_encontrada" },
      ],
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("catalogo de estados incompleto -> validation_error, sin escribir", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "validation_error",
      fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R14: carrera (write count incompleto) -> conflict re-leido, sin efectos parciales", async () => {
    const findByIds = vi
      .fn()
      // 1a lectura: ambas validas.
      .mockResolvedValueOnce([transicionRow({ id: "o1" }), transicionRow({ id: "o2" })])
      // re-lectura tras el count incompleto: o2 ya se movio (carrera).
      .mockResolvedValueOnce([
        transicionRow({ id: "o1" }),
        transicionRow({ id: "o2", estatusValue: "por_recoger" }),
      ]);
    const repo = fakeRepo({
      findByIdsForTransicion: findByIds,
      asignarSateliteLote: vi.fn(async () => 1), // solo 1 de 2 transiciono
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1", "o2"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: "conflict" }],
    });
    // Re-lee para armar el detalle de la carrera.
    expect(findByIds).toHaveBeenCalledTimes(2);
  });
});

describe("AsignacionSateliteService.asignar — bloqueo por reprogramacion (feature 46/R1/R3/R5)", () => {
  it("R3: orden reprogramada en el lote -> conflict con motivo tipado, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        transicionRow({ id: "o1" }),
        transicionRow({ id: "o2", estatusValue: "reprogramada" }),
      ]),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1", "o2"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA }],
    });
    // R5/R3: todo-o-nada, no escribe.
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });
});

describe("AsignacionSateliteService.asignar — bloqueo (feature 41/R14/R18)", () => {
  it("R18 (i): bodega bloqueada por cierres de sus mensajeros -> bodega_bloqueada, sin escribir", async () => {
    const repo = fakeRepo({
      existeBodegaSateliteBloqueada: vi.fn(async () => ({
        bloqueada: true,
        porMensajeros: true,
        porCierreBodega: false,
      })),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "bodega_bloqueada",
      causa: { porMensajeros: true, porCierreBodega: false },
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
    // R18: aborta ANTES de validar mensajero/ordenes.
    expect(repo.findMensajeroIdsValidosByZona).not.toHaveBeenCalled();
  });

  it("R18 (ii): bodega bloqueada por su propio CierreBodega pendiente -> bodega_bloqueada", async () => {
    const repo = fakeRepo({
      existeBodegaSateliteBloqueada: vi.fn(async () => ({
        bloqueada: true,
        porMensajeros: false,
        porCierreBodega: true,
      })),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "bodega_bloqueada",
      causa: { porMensajeros: false, porCierreBodega: true },
    });
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("R18: bloqueada por AMBAS causas -> los dos flags viajan", async () => {
    const repo = fakeRepo({
      existeBodegaSateliteBloqueada: vi.fn(async () => ({
        bloqueada: true,
        porMensajeros: true,
        porCierreBodega: true,
      })),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res).toEqual({
      status: "bodega_bloqueada",
      causa: { porMensajeros: true, porCierreBodega: true },
    });
  });

  // Pedido humano 2026-08-18 — R14 RETIRADA, RATIFICADA POR LA FEATURE 241 (regla 2, 2026-08-20).
  // Este test afirmaba que el mensajero con un cierre abierto se rechazaba con
  // `mensajero_bloqueado_por_cierre`; se invirtio entonces y SE QUEDA invertido.
  //
  // ⚠️ CUIDADO CON LO QUE ESTE TEST NO VE, y es la lección del §4.2. Aqui `asignarSateliteLote` es
  // un doble que devuelve 1 SIEMPRE, asi que este `ok` no prueba que la escritura real pase: el SQL
  // llevaba dentro su propio `NOT EXISTS` sobre `cierre_dia` y devolvia 0 filas, y este mismo test
  // estaba verde mientras la accion fallaba en produccion. Quien mide el WHERE es
  // `orden-repository.asignacion-satelite.test.ts`, y ahi esta la otra mitad de la propiedad.
  // ⚠️ ESTE CASO SE DIO LA VUELTA EL 2026-08-23 (FEATURE 271, R29/R30), Y ESTA ES LA SUPERFICIE DEL
  // INCIDENTE DEL 18/08. Decia «se asigna igual (R14 retirada)» y afirmaba que el predicado ni
  // siquiera estaba en el `Pick` del service. El humano revirtio esa mitad: acumular dos cierres —o
  // arrastrar uno re-solicitable— bloquea TAMBIEN recibir trabajo nuevo. El predicado VUELVE al
  // `Pick`, y su presencia alli es ahora el mecanismo (antes lo era su ausencia).
  it("mensajero BLOQUEADO -> conflict, y NINGUNA orden cambia (feature 271/R29/R30)", async () => {
    const repo = fakeRepo({
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set([MENSAJERO])),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res.status).toBe("conflict");
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled(); // R30: todo-o-nada
    expect(repo.findMensajerosBloqueadosPorCierres).toHaveBeenCalledWith([MENSAJERO]);
  });

  it("mensajero LIBRE -> se asigna: la guarda no bloquea de mas", async () => {
    // El contraste obligatorio: sin el, el `conflict` de arriba podria venir de otra guarda.
    const repo = fakeRepo({
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set()),
    });
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res.status).toBe("ok");
    expect(repo.asignarSateliteLote).toHaveBeenCalled();
  });

  it("camino feliz sin bloqueo -> ok (los dobles por defecto no bloquean)", async () => {
    const repo = fakeRepo();
    const res = await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
    );
    expect(res.status).toBe("ok");
    expect(repo.existeBodegaSateliteBloqueada).toHaveBeenCalledWith(ZONA);
  });
});

// =================================================================================================
// FEATURE 246 (T3.2, D4 firmada el 2026-08-20) — LA BODEGA SATELITE RESUELVE EL DIA IGUAL.
//
// D4 se firmo asi por una razon operativa, no por simetria estetica: dejar el satelite fuera haria
// que la regla del sistema dependiera de DESDE QUE BODEGA te asignaron, y eso no se le puede
// explicar a quien opera. Estos casos son el espejo EXACTO de los de `guia-asignacion-service`.
// =================================================================================================
describe("246/R2-R7 — asignarDesdeSatelite resuelve el dia de reparto", () => {
  const TARDE_DEL_20 = new Date("2026-08-20T20:00:00.000Z"); // 14:00 CR del 20
  const DIA_20 = new Date("2026-08-20T00:00:00.000Z");
  const DIA_21 = new Date("2026-08-21T00:00:00.000Z");

  /** La fecha que el servicio le pasa al repositorio (7.º argumento). */
  function fechaEscrita(repo: RepoMethods): Date {
    const call = (repo.asignarSateliteLote as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown[];
    return call[6] as Date;
  }

  it("R4: sin `dia` -> «hoy», igual que la bodega central", async () => {
    const repo = fakeRepo();
    await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO },
      ADMIN,
      TARDE_DEL_20,
    );
    expect(fechaEscrita(repo).toISOString()).toBe(DIA_20.toISOString());
  });

  it('R2/R5: `dia: "manana"` -> la fecha CR del dia siguiente', async () => {
    const repo = fakeRepo();
    await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO, dia: "manana" },
      ADMIN,
      TARDE_DEL_20,
    );
    expect(fechaEscrita(repo).toISOString()).toBe(DIA_21.toISOString());
  });

  it("R3: el lote entero recibe LA MISMA fecha, en una sola llamada", async () => {
    const repo = fakeRepo();
    await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO, dia: "manana" },
      ADMIN,
      TARDE_DEL_20,
    );
    const calls = (repo.asignarSateliteLote as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect((calls[0] as unknown[])[0]).toEqual(["o1"]);
  });

  it("R5/R17: a las 23:59 CR «mañana» es el dia siguiente en hora de Costa Rica, no en UTC", async () => {
    const repo = fakeRepo();
    await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO, dia: "manana" },
      ADMIN,
      new Date("2026-08-21T05:59:00.000Z"), // 23:59 CR del 20
    );
    expect(fechaEscrita(repo).toISOString()).toBe(DIA_21.toISOString());
  });

  it("D4: la MISMA entrada produce el MISMO dia que la bodega central", async () => {
    // La comprobacion literal de D4: si un dia las dos superficies divergieran, esto se rompe.
    const repo = fakeRepo();
    await newService(repo).asignar(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO, dia: "manana" },
      ADMIN,
      TARDE_DEL_20,
    );
    // `resolverFechaReparto` es el unico traductor del repo, y las dos superficies lo llaman.
    expect(fechaEscrita(repo).toISOString()).toBe(
      resolverFechaReparto("manana", TARDE_DEL_20).toISOString(),
    );
  });
});
