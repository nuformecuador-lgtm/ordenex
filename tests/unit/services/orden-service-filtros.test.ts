import { describe, it, expect, vi } from "vitest";
import { OrdenService } from "@/lib/services/OrdenService";
import type { IOrdenRepository, ListOrdenesParams } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { listarOrdenesSchema } from "@/lib/types/orden";
import { ordenesConfig } from "@/lib/config/ordenes";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

// Feature 144/B1 (R33-R37, R41-R46) — traduccion del `filter` al `where`.
//
// El repositorio va MOCKEADO: lo que se afirma es exactamente el objeto `where` que el
// service construye, porque ahi viven las dos cosas que no pueden fallar: la semantica
// de combinacion (AND entre filtros, OR dentro de uno) y que el ACOTAMIENTO POR ROL se
// escribe AL FINAL y por tanto ningun filtro puede ampliar lo que un rol ve.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };

// 2026-07-15T20:00:00Z = 14:00 CR del 15 de julio.
const AHORA = new Date("2026-07-15T20:00:00.000Z");

function buildRepo() {
  const list = vi.fn().mockResolvedValue({ items: [], total: 0 });
  return { repo: { list } as unknown as IOrdenRepository, list };
}

/** Parsea por el schema REAL antes de llamar: nada entra al service sin pasar el borde. */
function input(filter?: Record<string, unknown>) {
  return listarOrdenesSchema.parse(filter === undefined ? {} : { filter });
}

async function whereDe(
  filter: Record<string, unknown> | undefined,
  actor: Actor = MAESTRO,
): Promise<ListOrdenesParams["where"]> {
  const { repo, list } = buildRepo();
  // Feature 160: `historial` es dependencia REQUERIDA y precede al `ahora` inyectable de
  // la 144. Aqui no se afirma nada sobre intentos: el doble vacio solo satisface el contrato.
  const service = new OrdenService(repo, fakeIntentosEnLote(), () => AHORA);
  await service.listar(input(filter), actor);
  return list.mock.calls[0][0].where;
}

describe("combinacion de filtros (R33/R34/R46)", () => {
  it("R34: un filtro multi-valor viaja como LISTA (el repo lo traduce a IN -> OR interno)", async () => {
    const where = await whereDe({ zona_id: ["z1", "z2", "z3"] });
    expect(where.zonaId).toEqual(["z1", "z2", "z3"]);
  });

  it("R33: filtros DISTINTOS son claves hermanas del mismo where -> AND", async () => {
    const where = await whereDe({
      zona_id: ["z1"],
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
      tienda_id: ["t1"],
    });
    expect(where).toEqual({
      zonaId: ["z1"],
      provinciaId: ["p1"],
      cantonId: ["c1"],
      distritoId: ["d1"],
      tiendaId: ["t1"],
    });
  });

  it("R46: los filtros nuevos combinan con status_id sin que ninguno anule al otro", async () => {
    const where = await whereDe({ status_id: ["os-a", "os-b"], zona_id: ["z1"] });
    expect(where.estatusId).toEqual(["os-a", "os-b"]);
    expect(where.zonaId).toEqual(["z1"]);
  });

  it("R46: los filtros nuevos combinan con el rango temporal (AND con la geografia)", async () => {
    const where = await whereDe({
      provincia_id: ["p1"],
      created_desde: "2026-07-01",
      created_hasta: "2026-07-15",
    });
    expect(where.provinciaId).toEqual(["p1"]);
    expect(where.createdAt).toEqual({
      gte: new Date("2026-07-01T06:00:00.000Z"),
      lt: new Date("2026-07-16T06:00:00.000Z"),
    });
  });

  it("R30: cada clave publica se traduce a SU columna, nunca al reves", async () => {
    const where = await whereDe({ tienda_id: ["t1"] });
    // La clave publica jamas aparece como nombre de columna en el where.
    expect(Object.keys(where)).toEqual(["tiendaId"]);
    expect((where as Record<string, unknown>).tienda_id).toBeUndefined();
  });
});

describe("un id inexistente NUNCA degrada a 'sin filtro' (R35)", () => {
  it("R35: un id inventado viaja tal cual como criterio (el resultado se estrecha, no se ensancha)", async () => {
    const where = await whereDe({ zona_id: ["zona-que-no-existe"] });
    // La clave SIGUE presente: si se omitiera, el listado devolveria TODAS las ordenes.
    expect(where.zonaId).toEqual(["zona-que-no-existe"]);
  });

  it("R35: mezclar un id real con uno inventado no descarta el filtro", async () => {
    const where = await whereDe({ canton_id: ["c-real", "c-inventado"] });
    expect(where.cantonId).toEqual(["c-real", "c-inventado"]);
  });
});

describe("el alcance por ROL manda sobre el filtro (R36/R37)", () => {
  it("R36: adminTienda con filter.tienda_id de OTRA tienda -> el where queda con la SUYA", async () => {
    const where = await whereDe({ tienda_id: ["store2", "store3"] }, TIENDA);
    // El acotamiento por rol se escribe DESPUES y PISA el filtro. Escalar, no lista.
    expect(where.tiendaId).toBe("store1");
  });

  it("R36: adminTienda ni siquiera puede colar su tienda + otra (la lista se sustituye)", async () => {
    const where = await whereDe({ tienda_id: ["store1", "store2"] }, TIENDA);
    expect(where.tiendaId).toBe("store1");
    expect(Array.isArray(where.tiendaId)).toBe(false);
  });

  it("R36: el resto de filtros del adminTienda si se aplican (acotan dentro de SU alcance)", async () => {
    const where = await whereDe({ tienda_id: ["store2"], zona_id: ["z1"] }, TIENDA);
    expect(where).toEqual({ zonaId: ["z1"], tiendaId: "store1" });
  });

  it("R37: mensajero sigue acotado a sus asignadas CON filtros nuevos", async () => {
    const where = await whereDe(
      { zona_id: ["z1"], tienda_id: ["store2"], created_preset: "30d" },
      MENSAJERO,
    );
    expect(where.mensajeroAsignadoId).toBe("msg1");
    expect(where.zonaId).toEqual(["z1"]);
  });

  it("R37: mensajero sigue acotado a sus asignadas SIN filtros nuevos", async () => {
    const where = await whereDe(undefined, MENSAJERO);
    expect(where).toEqual({ mensajeroAsignadoId: "msg1" });
  });

  it("R36: maestro/admin no reciben acotamiento por rol (el filtro es el unico criterio)", async () => {
    const where = await whereDe({ tienda_id: ["store2"] }, MAESTRO);
    expect(where.tiendaId).toEqual(["store2"]);
  });
});

describe("bordes temporales calculados server-side (R41/R42/R43)", () => {
  it("R41: created_preset '7d' -> gte = 00:00 CR de hace 6 dias", async () => {
    const where = await whereDe({ created_preset: "7d" });
    expect(where.createdAt).toEqual({ gte: new Date("2026-07-09T06:00:00.000Z") });
    expect(where.createdAt?.lt).toBeUndefined(); // sin cota superior
  });

  it("R41: cada preset del dominio produce su propio borde", async () => {
    expect((await whereDe({ created_preset: "15d" })).createdAt).toEqual({
      gte: new Date("2026-07-01T06:00:00.000Z"),
    });
    expect((await whereDe({ created_preset: "30d" })).createdAt).toEqual({
      gte: new Date("2026-06-16T06:00:00.000Z"),
    });
    expect((await whereDe({ created_preset: "90d" })).createdAt).toEqual({
      gte: new Date("2026-04-17T06:00:00.000Z"),
    });
  });

  it("R42: hasta es INCLUSIVE (`lt` = 00:00 CR del dia siguiente)", async () => {
    const where = await whereDe({ created_hasta: "2026-07-15" });
    expect(where.createdAt).toEqual({ lt: new Date("2026-07-16T06:00:00.000Z") });
  });

  it("R42: solo desde -> rango abierto por arriba", async () => {
    const where = await whereDe({ created_desde: "2026-07-15" });
    expect(where.createdAt).toEqual({ gte: new Date("2026-07-15T06:00:00.000Z") });
  });

  it("R42: un dia unico (desde === hasta) cubre las 24 horas de ese dia CR", async () => {
    const where = await whereDe({ created_desde: "2026-07-15", created_hasta: "2026-07-15" });
    expect(where.createdAt).toEqual({
      gte: new Date("2026-07-15T06:00:00.000Z"),
      lt: new Date("2026-07-16T06:00:00.000Z"),
    });
  });

  it("R43: el instante del preset sale del reloj del SERVIDOR, no del cliente", async () => {
    // Mismo filter, otro reloj -> otro borde: la fuente es el servidor.
    const { repo, list } = buildRepo();
    const otroDia = new Date("2026-08-01T20:00:00.000Z");
    await new OrdenService(repo, fakeIntentosEnLote(), () => otroDia).listar(input({ created_preset: "7d" }), MAESTRO);
    expect(list.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date("2026-07-26T06:00:00.000Z"),
    });
  });

  it("R43/R44: el service delega UNA sola llamada al repo (count y pagina comparten where)", async () => {
    const { repo, list } = buildRepo();
    await new OrdenService(repo, fakeIntentosEnLote(), () => AHORA).listar(input({ zona_id: ["z1"] }), MAESTRO);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe("sin regresion del contrato previo (R45)", () => {
  it("R45: sin `filter`, el params del repo es EXACTAMENTE el previo a esta feature", async () => {
    const { repo, list } = buildRepo();
    await new OrdenService(repo, fakeIntentosEnLote(), () => AHORA).listar(input(undefined), MAESTRO);
    expect(list.mock.calls[0][0]).toEqual({
      where: {},
      sortBy: "created_at",
      // El default vigente es `desc` por pedido humano (ver el porque en
      // `listarOrdenesSchema`): lo ultimo que entro es lo primero que se mira. R45 sigue
      // afirmando lo suyo —que sin `filter` el params no gana NADA— sobre el contrato
      // vigente; fijar aqui una direccion retirada solo vigilaria el pasado.
      sortDir: "desc",
      skip: 0,
      take: ordenesConfig.DEFAULT_PAGE_SIZE,
    });
  });

  it("R45: con solo `status_id`, el where no gana ninguna clave nueva", async () => {
    const where = await whereDe({ status_id: ["os-a"] });
    expect(where).toEqual({ estatusId: ["os-a"] });
  });

  it("R45: el `estatusId` escalar heredado sigue funcionando igual", async () => {
    const { repo, list } = buildRepo();
    const parsed = listarOrdenesSchema.parse({ estatusId: "os-x" });
    await new OrdenService(repo, fakeIntentosEnLote(), () => AHORA).listar(parsed, MAESTRO);
    expect(list.mock.calls[0][0].where).toEqual({ estatusId: "os-x" });
  });

  it("R45: adminTienda sin filtros conserva su acotamiento previo", async () => {
    const where = await whereDe(undefined, TIENDA);
    expect(where).toEqual({ tiendaId: "store1" });
  });

  it("R45: `filter` vacio no introduce claves (ni temporales)", async () => {
    const where = await whereDe({});
    expect(where).toEqual({});
  });
});

describe("filtro REASIGNABLES (interruptor)", () => {
  it("marcado, viaja al `where` como bandera; el predicado lo resuelve el repositorio", async () => {
    const where = await whereDe({ reasignables: true });
    expect(where.reasignables).toBe(true);
  });

  it("ausente, no deja rastro en el `where` (sin filtro)", async () => {
    const where = await whereDe({ zona_id: ["z1"] });
    expect(where).not.toHaveProperty("reasignables");
  });

  it("solo ACOTA: no toca el acotamiento por rol, que se escribe despues", async () => {
    const where = await whereDe({ reasignables: true }, TIENDA);
    expect(where.tiendaId).toBe("store1");
    expect(where.reasignables).toBe(true);
  });

  it("el borde RECHAZA `false`: 'sin filtro' se expresa omitiendo la clave", () => {
    expect(() =>
      listarOrdenesSchema.parse({ filter: { reasignables: false } }),
    ).toThrow();
  });
});

describe("filtro por MENSAJERO (pedido humano 2026-08-25)", () => {
  it("traduce `mensajero_id` a la columna del mensajero ASIGNADO, como lista", async () => {
    const where = await whereDe({ mensajero_id: ["m1", "m2"] });
    expect(where).toEqual({ mensajeroAsignadoId: ["m1", "m2"] });
    // La clave publica jamas viaja como nombre de columna.
    expect(Object.keys(where)).toEqual(["mensajeroAsignadoId"]);
  });

  it("combina en AND con el resto de filtros, sin anular a ninguno", async () => {
    const where = await whereDe({
      mensajero_id: ["m1"],
      zona_id: ["z1"],
      status_id: ["os-a"],
    });
    expect(where).toEqual({
      estatusId: ["os-a"],
      zonaId: ["z1"],
      mensajeroAsignadoId: ["m1"],
    });
  });

  it("R36/R37: el rol MENSAJERO sigue acotado a SUS asignadas aunque pida otras", async () => {
    // El acotamiento por rol se escribe AL FINAL: su id escalar PISA la lista del filtro,
    // asi que un mensajero no puede usar este filtro para ver las de un companero.
    const where = await whereDe({ mensajero_id: ["otro-mensajero"] }, MENSAJERO);
    expect(where.mensajeroAsignadoId).toBe("msg1");
  });

  it("R36: el adminTienda que lo pida sigue viendo SOLO sus ordenes", async () => {
    const where = await whereDe({ mensajero_id: ["m1"] }, TIENDA);
    expect(where.tiendaId).toBe("store1");
    expect(where.mensajeroAsignadoId).toEqual(["m1"]);
  });
});

// ---------------------------------------------------------------------------------------
// Pedido humano (2026-08-27) — el interruptor ELIMINADAS: la unica clave del `filter` que no
// ACOTA el listado sino que le SUSTITUYE el universo, y la unica que ademas se AUTORIZA por rol.
// ---------------------------------------------------------------------------------------
describe("filtro ELIMINADAS", () => {
  const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };

  it("el maestro lo pide y viaja al repo como `soloEliminados`", async () => {
    const where = await whereDe({ eliminados: true });
    expect(where.soloEliminados).toBe(true);
  });

  it("ausente, la clave NO se escribe (el listado es el de siempre)", async () => {
    const where = await whereDe({ zona_id: ["z1"] });
    expect(where.soloEliminados).toBeUndefined();
  });

  it("convive con el resto de filtros como clave hermana (AND), sin pisarlos", async () => {
    const where = await whereDe({ eliminados: true, zona_id: ["z1"] });
    expect(where).toEqual({ soloEliminados: true, zonaId: ["z1"] });
  });

  it.each([
    ["admin", ADMIN],
    ["adminTienda", TIENDA],
    ["mensajero", MENSAJERO],
  ])("%s -> forbidden, y NI SIQUIERA se consulta", async (_n, actor) => {
    // Se RECHAZA, no se ignora: devolver el listado de las vivas con el interruptor puesto
    // haria concluir a quien lo pidiera que no hay ninguna orden eliminada.
    const { repo, list } = buildRepo();
    const service = new OrdenService(repo, fakeIntentosEnLote(), () => AHORA);

    const r = await service.listar(input({ eliminados: true }), actor);

    expect(r).toEqual({ status: "forbidden" });
    expect(list).not.toHaveBeenCalled();
  });

  it("el borde RECHAZA `eliminados: false` (no filtrar se expresa OMITIENDO la clave)", () => {
    expect(() => input({ eliminados: false })).toThrow();
  });
});

/**
 * FICHA 370 — la TRADUCCION de «salida a reparto» del vocabulario publico al del repositorio.
 *
 * OJO CON LO QUE ESTE BLOQUE **NO** PRUEBA: el repositorio va mockeado, asi que aqui nadie mira
 * el SQL. Que el `WHERE` seleccione las filas correctas se prueba contra Postgres de verdad en
 * `tests/integration/db/salida-a-reparto-sql-real.test.ts` — en este repo esta medido cuatro
 * veces que una mutacion del `WHERE` pasa en verde con dobles. Lo que si se prueba aqui es la
 * traduccion (dos vocabularios) y que la clave llega HERMANA del resto.
 */
describe("FICHA 370 — salida a reparto (traduccion al `where`)", () => {
  it("`ya_salio` -> `salioAReparto: 'ya'` y `nunca_salio` -> `'nunca'`", async () => {
    expect((await whereDe({ salio_a_reparto: "ya_salio" })).salioAReparto).toBe("ya");
    expect((await whereDe({ salio_a_reparto: "nunca_salio" })).salioAReparto).toBe("nunca");
  });

  it("ausente, la clave NO se escribe: el repositorio no recibe medio filtro", async () => {
    const where = await whereDe({ zona_id: ["z1"] });
    expect(where.salioAReparto).toBeUndefined();
    expect(Object.hasOwn(where, "salioAReparto")).toBe(false);
  });

  it("es una clave HERMANA (AND) y no pisa a `reasignables` ni al acotamiento por rol", async () => {
    expect(await whereDe({ reasignables: true, salio_a_reparto: "nunca_salio" })).toEqual({
      reasignables: true,
      salioAReparto: "nunca",
    });
    // El acotamiento por rol se sigue escribiendo AL FINAL y sigue mandando.
    expect(await whereDe({ salio_a_reparto: "ya_salio" }, MENSAJERO)).toEqual({
      salioAReparto: "ya",
      mensajeroAsignadoId: "msg1",
    });
  });
});
