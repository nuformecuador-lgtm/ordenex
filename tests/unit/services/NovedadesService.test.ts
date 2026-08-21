import { describe, it, expect, vi } from "vitest";
import { NovedadesService } from "@/lib/services/NovedadesService";
import type {
  CausaDevueltaVigente,
  IOrdenRepository,
  NovedadOrdenRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { descargaConfig } from "@/lib/config/descarga";
import { GRUPOS_NOVEDAD, type GrupoNovedad } from "@/lib/types/novedad-grupo";
import { fakeIntentosEnLote, llamadasIntentos } from "@/tests/fixtures/intentos-entrega";

// Feature 89/99 (T14) → FEATURE 236 (T2.4/T2.5/T3.1/T3.3) — service de NOVEDADES con el repo
// mockeado (sin DB/HTTP).
//
// ⚠️ 2026-08-19 — NOTA FECHADA. Hasta hoy el service listaba UNA cosa que en realidad eran DOS: las
// devoluciones ancladas y las ordenes sobre las que un mensajero pidio ayuda, mezcladas bajo la
// misma pestaña. La 236 le da el GRUPO, y con el cambian tres cosas y solo tres: el predicado (que
// aplica el repo), si se consulta la CAUSA, y el ORDEN. Todo lo demas —el rol como primera guarda,
// el alcance saliendo del actor, la proyeccion unica compartida por pagina y archivo— se conserva y
// se sigue afirmando aqui.
//
// El PREDICADO en si se ejercita a nivel de repo (`orden-repository.novedades.test.ts`), donde vive:
// estos dobles no ven el SQL y afirmar aqui la forma del `where` seria afirmar nada.

const ADMIN: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };
const OTRA_TIENDA: Actor = { usuarioId: "tienda-2", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const PAGE_SIZE = 10;

type RepoMethods = Pick<
  IOrdenRepository,
  | "countNovedadesByTienda"
  | "findNovedadesByTienda"
  | "findCausasDevueltaVigentes"
  | "findFechaSolicitudAyuda"
>;

// 2026-08-13 (pedido humano): la fila del repo es la orden completa (`NovedadOrdenRow` espeja a
// `MiAsignacionRow`), porque `NovedadDTO` extiende `MiAsignacionDTO` y `/novedades` pinta las
// MISMAS cards POS que el portal del mensajero. El repo ya entrega todo serializable.
function ordenRow(overrides: Partial<NovedadOrdenRow> = {}): NovedadOrdenRow {
  return {
    id: "o1",
    numGuia: 100,
    numRemision: "REM-001",
    estatusValue: "devuelta",
    destinatario: "Ana",
    telefonoDest: "88887777",
    direccion: "Calle 1, casa 2",
    producto: "Zapatos",
    peso: 1.5,
    montoCobrar: 12500,
    latitud: 9.9333296,
    longitud: -84.0833282,
    notas: "Tocar el timbre",
    // Feature 235 (T6.1, R40): aqui vivia `ayuda: false`. Se retiro con la columna; la razon por
    // la que la fila esta en el listado la dice `estatusValue`, que ya viaja en esta misma fila.
    intentosContacto: 0,
    tiendaNombre: "Tienda Uno",
    zonaNombre: "GAM",
    provinciaNombre: "San Jose",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<RepoMethods> = {}): RepoMethods {
  return {
    countNovedadesByTienda: vi.fn(async () => 0),
    findNovedadesByTienda: vi.fn(async () => []),
    findCausasDevueltaVigentes: vi.fn(async () => new Map<string, CausaDevueltaVigente>()),
    findFechaSolicitudAyuda: vi.fn(async () => new Map<string, Date>()),
    ...overrides,
  };
}

// Feature 160: derivador de intentos EN LOTE, dependencia REQUERIDA del constructor. Por
// defecto Map vacio, que ejerce el `?? 0` del servicio (R14).
const intentos = fakeIntentosEnLote();

/** Atajo de lectura: la pagina 1 del grupo pedido. */
function paginaDe(grupo: GrupoNovedad) {
  return { page: 1, pageSize: PAGE_SIZE, grupo };
}

// =============================================================================================
// R11 — el rol es la PRIMERA guarda, en los dos grupos y en los dos metodos
// =============================================================================================

describe("236/R11 — sin rol de administracion de tienda no se devuelve nada, ni totales", () => {
  it("rol != adminTienda -> forbidden sin tocar el repo, en CADA grupo y CADA metodo", async () => {
    for (const actor of [MENSAJERO, MAESTRO]) {
      for (const grupo of GRUPOS_NOVEDAD) {
        const repo = fakeRepo();
        const service = new NovedadesService(repo, intentos);

        expect(await service.listar(paginaDe(grupo), actor)).toEqual({ status: "forbidden" });
        expect(await service.listarCompleto({ grupo }, actor)).toEqual({ status: "forbidden" });

        // R11 pide que NI SIQUIERA se revelen los totales: el conteo no llega a hacerse.
        expect(repo.countNovedadesByTienda, `${actor.rol}/${grupo}`).not.toHaveBeenCalled();
        expect(repo.findNovedadesByTienda).not.toHaveBeenCalled();
      }
    }
  });
});

// =============================================================================================
// R10 — el alcance sale del ACTOR, nunca del input
// =============================================================================================

describe("236/R10 — la tienda sale del actor y el grupo llega al repo", () => {
  it("acota al `tiendaId = actor.usuarioId` en count y en la lista, con el grupo pedido", async () => {
    for (const grupo of GRUPOS_NOVEDAD) {
      const repo = fakeRepo({
        countNovedadesByTienda: vi.fn(async () => 3),
        findNovedadesByTienda: vi.fn(async () => [ordenRow()]),
      });
      const service = new NovedadesService(repo, intentos);
      await service.listar(paginaDe(grupo), OTRA_TIENDA);

      expect(repo.countNovedadesByTienda).toHaveBeenCalledWith("tienda-2", grupo);
      expect(repo.findNovedadesByTienda).toHaveBeenCalledWith("tienda-2", grupo, {
        skip: 0,
        take: PAGE_SIZE,
      });
    }
  });

  it("R4: count y find reciben EXACTAMENTE los mismos tienda y grupo (nada que pueda divergir)", async () => {
    for (const grupo of GRUPOS_NOVEDAD) {
      const repo = fakeRepo({
        countNovedadesByTienda: vi.fn(async () => 1),
        findNovedadesByTienda: vi.fn(async () => [ordenRow()]),
      });
      await new NovedadesService(repo, intentos).listar(paginaDe(grupo), ADMIN);

      const argsCount = (repo.countNovedadesByTienda as ReturnType<typeof vi.fn>).mock.calls[0];
      const argsFind = (repo.findNovedadesByTienda as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(argsCount).toEqual(["tienda-1", grupo]);
      expect(argsFind.slice(0, 2)).toEqual(["tienda-1", grupo]);
      // find lleva la paginacion como 3.er argumento y NADA mas.
      expect(argsFind[2]).toEqual({ skip: 0, take: PAGE_SIZE });
      expect(argsFind).toHaveLength(3);
    }
  });
});

// =============================================================================================
// R26 — la causa SOLO se consulta para la devolucion
// =============================================================================================

describe("236/R26 — a una orden en ayuda no se le atribuye causa de devolucion", () => {
  it("grupo `ayuda`: `findCausasDevueltaVigentes` NO se llama, y la causa sale null", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 1),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: "ayuda_tienda" })]),
      // Si la consulta se hiciera, devolveria la causa de una devolucion ANTERIOR ya deshecha:
      // un dato cierto que NO describe por que la orden esta en la pantalla. Este doble la tiene
      // cargada a proposito, para que el caso caiga si alguien vuelve a consultarla.
      findCausasDevueltaVigentes: vi.fn(
        async () =>
          new Map<string, CausaDevueltaVigente>([
            ["o1", { causa: "not_found", fecha: new Date("2026-02-01T00:00:00Z") }],
          ]),
      ),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("ayuda"), ADMIN);

    expect(repo.findCausasDevueltaVigentes).not.toHaveBeenCalled();
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items[0].causa).toBeNull();
  });

  it("grupo `devolucion`: SI se llama, una vez, con los ids de la pagina (control positivo)", async () => {
    // El positivo del negativo de arriba: sin el, «no se llama» estaria verde tambien si nadie
    // llamara nunca.
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 1),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
      findCausasDevueltaVigentes: vi.fn(
        async () =>
          new Map<string, CausaDevueltaVigente>([
            ["o1", { causa: "not_found", fecha: new Date("2026-02-01T00:00:00Z") }],
          ]),
      ),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("devolucion"), ADMIN);

    expect(repo.findCausasDevueltaVigentes).toHaveBeenCalledTimes(1);
    expect(repo.findCausasDevueltaVigentes).toHaveBeenCalledWith(["o1"]);
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items[0].causa).toBe("not_found");
  });

  it("y a la inversa: la fecha de solicitud NO se consulta para el grupo de devolucion", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 1),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
    });
    await new NovedadesService(repo, intentos).listar(paginaDe("devolucion"), ADMIN);
    expect(repo.findFechaSolicitudAyuda).not.toHaveBeenCalled();
  });
});

// =============================================================================================
// R17 / D7 — el orden de la pestaña de ayuda: la que lleva MAS esperando, primero
// =============================================================================================

describe("236/R17 — la lista de ayuda se ordena por la fecha de la SOLICITUD", () => {
  it("UNA sola consulta para toda la pagina, con todos sus ids (nunca una por fila)", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 3),
      findNovedadesByTienda: vi.fn(async () => [
        ordenRow({ id: "a", estatusValue: "ayuda_tienda" }),
        ordenRow({ id: "b", estatusValue: "ayuda_tienda" }),
        ordenRow({ id: "c", estatusValue: "ayuda_tienda" }),
      ]),
    });
    await new NovedadesService(repo, intentos).listar(paginaDe("ayuda"), ADMIN);

    expect(repo.findFechaSolicitudAyuda).toHaveBeenCalledTimes(1);
    expect(repo.findFechaSolicitudAyuda).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("la que pidio ayuda ANTES va primero (ascendente), aunque su orden sea mas nueva", async () => {
    // El caso que separa D7-(a) de D7-(b): si se ordenara por `createdAt` desc —el fallback de
    // hoy—, «reciente» saldria primera. Lo que la tienda pregunta es cual lleva mas esperando.
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 2),
      findNovedadesByTienda: vi.fn(async () => [
        ordenRow({ id: "reciente", estatusValue: "ayuda_tienda", createdAt: new Date("2026-05-01T00:00:00Z") }),
        ordenRow({ id: "esperando", estatusValue: "ayuda_tienda", createdAt: new Date("2026-01-01T00:00:00Z") }),
      ]),
      findFechaSolicitudAyuda: vi.fn(
        async () =>
          new Map<string, Date>([
            ["reciente", new Date("2026-06-02T10:00:00Z")], // pidio ayuda hace un rato
            ["esperando", new Date("2026-06-01T08:00:00Z")], // lleva un dia mas esperando
          ]),
      ),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("ayuda"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items.map((i) => i.id)).toEqual(["esperando", "reciente"]);
  });

  it("una orden SIN fecha de solicitud cae al fallback `createdAt` sin romper el orden", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 2),
      findNovedadesByTienda: vi.fn(async () => [
        ordenRow({ id: "con-solicitud", estatusValue: "ayuda_tienda", createdAt: new Date("2026-05-01T00:00:00Z") }),
        ordenRow({ id: "sin-solicitud", estatusValue: "ayuda_tienda", createdAt: new Date("2026-01-01T00:00:00Z") }),
      ]),
      findFechaSolicitudAyuda: vi.fn(
        async () => new Map<string, Date>([["con-solicitud", new Date("2026-06-01T08:00:00Z")]]),
      ),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("ayuda"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    // La sin solicitud entra por su `createdAt` (2026-01), que es anterior: va primera. Lo que
    // importa es que NO desaparece ni rompe: el fallback esta documentado en el service.
    expect(res.items.map((i) => i.id)).toEqual(["sin-solicitud", "con-solicitud"]);
    expect(res.items).toHaveLength(2);
  });

  it("R12 (sin cambios): la DEVOLUCION sigue ordenando por su gestion vigente, desc", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 2),
      findNovedadesByTienda: vi.fn(async () => [
        ordenRow({ id: "vieja", createdAt: new Date("2026-01-01T00:00:00Z") }),
        ordenRow({ id: "nueva", createdAt: new Date("2026-01-02T00:00:00Z") }),
      ]),
      findCausasDevueltaVigentes: vi.fn(
        async () =>
          new Map<string, CausaDevueltaVigente>([
            // La gestion mas reciente es la de "vieja", asi que debe quedar primera pese a
            // tener createdAt de orden anterior.
            ["vieja", { causa: "not_found", fecha: new Date("2026-03-10T00:00:00Z") }],
            ["nueva", { causa: "wrong_number", fecha: new Date("2026-03-01T00:00:00Z") }],
          ]),
      ),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("devolucion"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items.map((i) => i.id)).toEqual(["vieja", "nueva"]);
  });

  it("R12 (fallback): sin gestion vigente la devolucion ordena por `createdAt` DESC", async () => {
    // Y aqui esta la diferencia con la ayuda, dicha sobre los mismos datos: mismo fallback,
    // sentido contrario. Si alguien unificara los dos ordenes, uno de los dos casos cae.
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 2),
      findNovedadesByTienda: vi.fn(async () => [
        ordenRow({ id: "b", createdAt: new Date("2026-01-01T00:00:00Z") }),
        ordenRow({ id: "a", createdAt: new Date("2026-05-01T00:00:00Z") }),
      ]),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("devolucion"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

// =============================================================================================
// La paginacion y el estado vacio (que es el PRIMER estado que la tienda va a conocer)
// =============================================================================================

describe("NovedadesService.listar — paginacion y lista vacia", () => {
  it("R13/R12: respuesta { items, total, page, pageSize } y skip derivado de la pagina", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 25),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
    });
    const res = await new NovedadesService(repo, intentos).listar(
      { page: 3, pageSize: PAGE_SIZE, grupo: "devolucion" },
      ADMIN,
    );

    expect(res).toMatchObject({ status: "ok", total: 25, page: 3, pageSize: PAGE_SIZE });
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items).toHaveLength(1);
    // page 3, pageSize 10 -> skip 20.
    expect(repo.findNovedadesByTienda).toHaveBeenCalledWith("tienda-1", "devolucion", {
      skip: 20,
      take: PAGE_SIZE,
    });
  });

  it("la pestaña VACIA responde `ok` con total y sin consultas agregadas, en los DOS grupos", async () => {
    // Medido el 2026-08-19 en produccion: `devuelta` = 0 y `ayuda_tienda` = 0 sobre 141 ordenes
    // vivas en 11 estatus. El camino vacio no es marginal — es el PRIMERO que va a correr.
    for (const grupo of GRUPOS_NOVEDAD) {
      const repo = fakeRepo();
      const doble = fakeIntentosEnLote();
      const res = await new NovedadesService(repo, doble).listar(paginaDe(grupo), ADMIN);

      expect(res).toEqual({ status: "ok", items: [], total: 0, page: 1, pageSize: PAGE_SIZE });
      expect(repo.findCausasDevueltaVigentes, grupo).not.toHaveBeenCalled();
      expect(repo.findFechaSolicitudAyuda, grupo).not.toHaveBeenCalled();
      expect(doble.contarIntentosEnLote, grupo).not.toHaveBeenCalled();
    }
  });
});

// --- Feature 160 (T11): el conteo de intentos en la pagina de novedades ---

describe("NovedadesService.listar — intentos de entrega en lote (160/R11-R15/R26)", () => {
  it("R11/R14: cada novedad sale con `intentosEntrega` numerico, el `0` INCLUIDO", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 2),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "n1" }), ordenRow({ id: "n2" })]),
    });
    // `n2` no viene en el mapa -> 0.
    const doble = fakeIntentosEnLote({ n1: 3 });
    const res = await new NovedadesService(repo, doble).listar(paginaDe("devolucion"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    const porId = new Map(res.items.map((i) => [i.id, i.intentosEntrega]));
    expect(porId.get("n1")).toBe(3);
    expect(porId.get("n2")).toBe(0);
  });

  it("R12/R15: UNA sola llamada, con los ids de la pagina YA acotada a la tienda del actor", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 2),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "n1" }), ordenRow({ id: "n2" })]),
    });
    const doble = fakeIntentosEnLote();
    await new NovedadesService(repo, doble).listar(paginaDe("devolucion"), ADMIN);

    expect(doble.contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(llamadasIntentos(doble)).toEqual([["n1", "n2"]]);
    expect(repo.findNovedadesByTienda).toHaveBeenCalledWith("tienda-1", "devolucion", {
      skip: 0,
      take: PAGE_SIZE,
    });
  });

  it("R15: un rol no autorizado ni siquiera llega al derivador", async () => {
    const doble = fakeIntentosEnLote();
    const res = await new NovedadesService(fakeRepo(), doble).listar(
      paginaDe("devolucion"),
      MENSAJERO,
    );
    expect(res).toEqual({ status: "forbidden" });
    expect(doble.contarIntentosEnLote).not.toHaveBeenCalled();
  });

  it("la pagina de AYUDA tambien cuenta intentos, con la misma unica llamada", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 1),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "a1", estatusValue: "ayuda_tienda" })]),
    });
    const doble = fakeIntentosEnLote({ a1: 2 });
    const res = await new NovedadesService(repo, doble).listar(paginaDe("ayuda"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items[0].intentosEntrega).toBe(2);
    expect(doble.contarIntentosEnLote).toHaveBeenCalledTimes(1);
  });
});

// --- 2026-08-12/13 (pedido humano): la orden COMPLETA al DTO, con sus decimales y sus nulos ---

describe("NovedadesService.listar — la orden completa al DTO (card POS compartida)", () => {
  it("propaga TODOS los campos de la fila con su valor real", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 1),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("devolucion"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items[0]).toMatchObject({
      id: "o1",
      numGuia: 100,
      // El REAL de la orden, NO la etiqueta «Guia N»: esa la pone el front (R9).
      numRemision: "REM-001",
      estatusValue: "devuelta",
      destinatario: "Ana",
      telefonoDest: "88887777",
      direccion: "Calle 1, casa 2",
      producto: "Zapatos",
      peso: 1.5,
      montoCobrar: 12500,
      latitud: 9.9333296,
      longitud: -84.0833282,
      notas: "Tocar el timbre",
      tiendaNombre: "Tienda Uno",
      zonaNombre: "GAM",
      provinciaNombre: "San Jose",
      cantonNombre: "Central",
      distritoNombre: "Carmen",
    });
  });

  it("los campos AUSENTES viajan como null: ni cadena vacia ni cero", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 1),
      findNovedadesByTienda: vi.fn(async () => [
        ordenRow({
          id: "pelada",
          peso: null,
          direccion: null,
          montoCobrar: null,
          latitud: null,
          longitud: null,
          notas: null,
          distritoNombre: null,
        }),
      ]),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("devolucion"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    const item = res.items[0];
    for (const campo of [
      "peso",
      "direccion",
      "montoCobrar",
      "latitud",
      "longitud",
      "notas",
      "distritoNombre",
    ] as const) {
      expect(item[campo]).toBeNull();
      // Un dato ausente NO se disfraza: ni `""` (que la card leeria como etiqueta vacia)
      // ni `0` (que en `montoCobrar` seria una cifra inventada).
      expect(item[campo]).not.toBe("");
      expect(item[campo]).not.toBe(0);
    }
    expect(item.producto).toBe("Zapatos");
    expect(item.numRemision).toBe("REM-001");
    expect(item.zonaNombre).toBe("GAM");
  });

  it("`secuenciaRuta` es SIEMPRE null: una novedad no es parada de ninguna ruta", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 2),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "a" }), ordenRow({ id: "b" })]),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("devolucion"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    for (const item of res.items) expect(item.secuenciaRuta).toBeNull();
  });

  it("`estatusValue` sale de la fila (proyectado), no hardcodeado en el service", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 1),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: "otro_valor" })]),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("devolucion"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items[0].estatusValue).toBe("otro_valor");
  });

  it("`createdAt` NO viaja al DTO: es de la fila del repo y muere en el ordenamiento", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 1),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
    });
    const res = await new NovedadesService(repo, intentos).listar(paginaDe("devolucion"), ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    const item = res.items[0];
    expect(item).not.toHaveProperty("createdAt");
    // Ni un solo `Date` en el DTO: el borde RSC no lo transporta.
    for (const valor of Object.values(item)) expect(valor).not.toBeInstanceOf(Date);
    expect(JSON.parse(JSON.stringify(item))).toEqual(item);
  });

  it("R29: el DTO no gana NINGUNA clave de notas — el hilo no viaja en el listado", async () => {
    // Feature 236 (design §7.4): el hilo se lee SOLO al abrirlo. Si viajara aqui costaria una
    // consulta por orden de la pagina (N+1) para un dato que solo se mira al abrir una orden.
    // Se afirma sobre el DTO, no sobre un comentario.
    for (const grupo of GRUPOS_NOVEDAD) {
      const repo = fakeRepo({
        countNovedadesByTienda: vi.fn(async () => 1),
        findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
      });
      const res = await new NovedadesService(repo, intentos).listar(paginaDe(grupo), ADMIN);
      if (res.status !== "ok") throw new Error("esperaba ok");
      const claves = Object.keys(res.items[0]);
      for (const prohibida of ["notasHilo", "hilo", "notasOrden", "conversacion", "puedeEscribir"]) {
        expect(claves, `${grupo} / ${prohibida}`).not.toContain(prohibida);
      }
      // `notas` SI viaja y es OTRA cosa: la nota que la tienda escribio AL CREAR la orden.
      expect(claves).toContain("notas");
    }
  });
});

// =============================================================================================
// La DESCARGA (T3.1/T3.3) — mismo predicado y mismo alcance que la pestaña, tope en el servidor
// =============================================================================================

describe("236/R37/R38/R40 — `listarCompleto`, una descarga por grupo", () => {
  it("R11: rol != adminTienda -> forbidden sin tocar el repo, en los dos grupos", async () => {
    for (const actor of [MENSAJERO, MAESTRO]) {
      for (const grupo of GRUPOS_NOVEDAD) {
        const repo = fakeRepo();
        const res = await new NovedadesService(repo, intentos).listarCompleto({ grupo }, actor);
        expect(res).toEqual({ status: "forbidden" });
        expect(repo.countNovedadesByTienda).not.toHaveBeenCalled();
        expect(repo.findNovedadesByTienda).not.toHaveBeenCalled();
      }
    }
  });

  it("R37: el listado ENTERO del grupo, con el MISMO alcance y el MISMO predicado que su pestaña", async () => {
    for (const grupo of GRUPOS_NOVEDAD) {
      const repo = fakeRepo({
        countNovedadesByTienda: vi.fn(async () => 25),
        findNovedadesByTienda: vi.fn(async () =>
          Array.from({ length: 25 }, (_, i) => ordenRow({ id: `o${i}` })),
        ),
      });
      const res = await new NovedadesService(repo, intentos).listarCompleto({ grupo }, ADMIN);

      if (res.status !== "ok") throw new Error("esperaba ok");
      expect(res.items).toHaveLength(25);
      expect(res.total).toBe(25);
      // El alcance sale del actor y el grupo es el pedido; la lectura pide las 25, no una pagina.
      expect(repo.countNovedadesByTienda).toHaveBeenCalledWith("tienda-1", grupo);
      expect(repo.findNovedadesByTienda).toHaveBeenCalledWith("tienda-1", grupo, {
        skip: 0,
        take: 25,
      });
    }
  });

  it("R38: el archivo de DEVOLUCIONES no puede traer una orden en ayuda", async () => {
    // El grupo con el que se pide el conteo y la lectura ES el predicado: pedir `devolucion` no
    // puede devolver `ayuda_tienda`, porque el repo filtra por igualdad de estado. Lo que se
    // afirma aqui —donde vive la decision— es que el service PIDE el grupo correcto y no toca
    // ningun camino que mezcle. El predicado en si se prueba en el repo.
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 1),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "d1", estatusValue: "devuelta" })]),
    });
    const res = await new NovedadesService(repo, intentos).listarCompleto(
      { grupo: "devolucion" },
      ADMIN,
    );

    expect(repo.countNovedadesByTienda).toHaveBeenCalledWith("tienda-1", "devolucion");
    expect(repo.findNovedadesByTienda).toHaveBeenCalledWith("tienda-1", "devolucion", {
      skip: 0,
      take: 1,
    });
    // Ni el conteo ni la lectura se hacen NUNCA sin grupo, que era la forma de mezclar.
    for (const llamada of (repo.countNovedadesByTienda as ReturnType<typeof vi.fn>).mock.calls) {
      expect(llamada).toHaveLength(2);
      expect(llamada[1]).toBe("devolucion");
    }
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items.map((i) => i.estatusValue)).toEqual(["devuelta"]);
  });

  it("misma proyeccion que la pagina, en los dos grupos: el archivo no puede decir otra cosa", async () => {
    for (const grupo of GRUPOS_NOVEDAD) {
      const repo = fakeRepo({
        countNovedadesByTienda: vi.fn(async () => 1),
        findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
        findCausasDevueltaVigentes: vi.fn(
          async () =>
            new Map<string, CausaDevueltaVigente>([
              ["o1", { causa: "not_found", fecha: new Date("2026-02-01T00:00:00Z") }],
            ]),
        ),
      });
      const service = new NovedadesService(repo, intentos);
      const completo = await service.listarCompleto({ grupo }, ADMIN);
      const pagina = await service.listar(paginaDe(grupo), ADMIN);

      if (completo.status !== "ok" || pagina.status !== "ok") throw new Error("esperaba ok");
      expect(completo.items, grupo).toEqual(pagina.items);
      expect(completo.items[0]).not.toHaveProperty("createdAt");
    }
  });

  it("235/R40: el DTO transporta `estatusValue` y NINGUNA marca de ayuda", async () => {
    const repo = fakeRepo({
      countNovedadesByTienda: vi.fn(async () => 1),
      findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: "ayuda_tienda" })]),
    });
    const service = new NovedadesService(repo, intentos);
    const pagina = await service.listar(paginaDe("ayuda"), ADMIN);

    if (pagina.status !== "ok") throw new Error("esperaba ok");
    expect(pagina.items[0].estatusValue).toBe("ayuda_tienda");
    // Ninguna marca paralela: una sola verdad sobre el mismo hecho.
    expect(pagina.items[0]).not.toHaveProperty("ayuda");
  });

  it("el listado vacio no consulta causas, ni solicitudes, ni intentos (los dos grupos)", async () => {
    for (const grupo of GRUPOS_NOVEDAD) {
      const repo = fakeRepo({ countNovedadesByTienda: vi.fn(async () => 0) });
      const res = await new NovedadesService(repo, intentos).listarCompleto({ grupo }, ADMIN);

      expect(res).toEqual({ status: "ok", items: [], total: 0 });
      expect(repo.findNovedadesByTienda, grupo).not.toHaveBeenCalled();
      expect(repo.findCausasDevueltaVigentes, grupo).not.toHaveBeenCalled();
      expect(repo.findFechaSolicitudAyuda, grupo).not.toHaveBeenCalled();
    }
  });

  it("R40: superado el tope -> `limite_excedido` con conteos y NINGUNA fila, por grupo", async () => {
    const limite = descargaConfig.MAX_FILAS;
    for (const grupo of GRUPOS_NOVEDAD) {
      const repo = fakeRepo({ countNovedadesByTienda: vi.fn(async () => limite + 1) });
      const res = await new NovedadesService(repo, intentos).listarCompleto({ grupo }, ADMIN);

      expect(res, grupo).toEqual({ status: "limite_excedido", total: limite + 1, limite });
      // Ni filas truncadas ni PII en el resultado: el aviso lleva SOLO conteos, y el tope se
      // evaluo con el CONTEO — sin leer una sola fila.
      expect(res).not.toHaveProperty("items");
      expect(repo.findNovedadesByTienda, grupo).not.toHaveBeenCalled();
    }
  });

  it("justo EN el tope todavia hay archivo (el limite no se pasa por uno), por grupo", async () => {
    const limite = descargaConfig.MAX_FILAS;
    for (const grupo of GRUPOS_NOVEDAD) {
      const repo = fakeRepo({
        countNovedadesByTienda: vi.fn(async () => limite),
        findNovedadesByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
      });
      const res = await new NovedadesService(repo, intentos).listarCompleto({ grupo }, ADMIN);

      expect(res.status, grupo).toBe("ok");
      expect(repo.findNovedadesByTienda).toHaveBeenCalledWith("tienda-1", grupo, {
        skip: 0,
        take: limite,
      });
    }
  });
});
