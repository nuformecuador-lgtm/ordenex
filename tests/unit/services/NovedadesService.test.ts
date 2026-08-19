import { describe, it, expect, vi } from "vitest";
import { NovedadesService } from "@/lib/services/NovedadesService";
import type {
  CausaDevueltaVigente,
  IOrdenRepository,
  NovedadOrdenRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { descargaConfig } from "@/lib/config/descarga";
import { fakeIntentosEnLote, llamadasIntentos } from "@/tests/fixtures/intentos-entrega";

// Feature 89/99 (T14) — service de NOVEDADES con el repo mockeado (sin DB/HTTP). INVIERTE al
// predicado de la feature 99 (Q7): la novedad se ancla al ESTADO REAL `estatus = devuelta`, no a
// "gestion devuelta vigente + estatus abierto". El service ya NO computa un conjunto de estatus
// CERRADOS; solo acota por tienda y delega el filtro de estado al repo. Cubre R8 (count y find
// sobre el mismo universo), R9 (acota `tienda = actor.usuarioId`), R10 (causa al DTO, null si no
// hay), R11 (rol != adminTienda -> forbidden), R12/R13 (paginacion 10, orden por recencia, shape).
// El predicado de la query (`estatus = devuelta`) se ejercita a nivel de repo en
// orden-repository.novedades.test.ts.

const ADMIN: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };
const OTRA_TIENDA: Actor = { usuarioId: "tienda-2", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const PAGE_SIZE = 10;

type RepoMethods = Pick<
  IOrdenRepository,
  "countDevueltasByTienda" | "findDevueltasByTienda" | "findCausasDevueltaVigentes"
>;

// 2026-08-13 (pedido humano): la fila del repo es AHORA la orden completa (`NovedadOrdenRow`
// espeja a `MiAsignacionRow`), porque `NovedadDTO` extiende `MiAsignacionDTO` y `/novedades`
// pinta las MISMAS cards POS que el portal del mensajero. El repo ya entrega todo
// serializable: los tres decimales (peso, monto, lat/lng) como `number | null` y los
// catalogos con el nombre resuelto.
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
    // Solicitud de ayuda (2026-08-18): el default es la fila que llega por ESTAR devuelta, no por
    // tener ayuda pedida. Los casos de ayuda lo sobreescriben.
    ayuda: false,
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
    countDevueltasByTienda: vi.fn(async () => 0),
    findDevueltasByTienda: vi.fn(async () => []),
    findCausasDevueltaVigentes: vi.fn(async () => new Map<string, CausaDevueltaVigente>()),
    ...overrides,
  };
}

// Feature 160: derivador de intentos EN LOTE, dependencia REQUERIDA del constructor. Por
// defecto Map vacio, que ejerce el `?? 0` del servicio (R14); los tests de la 160 usan su
// propio doble.
const intentos = fakeIntentosEnLote();

describe("NovedadesService.listar (feature 89)", () => {
  it("R11: rol != adminTienda -> forbidden sin tocar el repo", async () => {
    for (const actor of [MENSAJERO, MAESTRO]) {
      const repo = fakeRepo();
      const service = new NovedadesService(repo, intentos);
      const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, actor);
      expect(res).toEqual({ status: "forbidden" });
      expect(repo.countDevueltasByTienda).not.toHaveBeenCalled();
      expect(repo.findDevueltasByTienda).not.toHaveBeenCalled();
    }
  });

  it("R9: acota al `tiendaId = actor.usuarioId` en count y en la lista", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 3),
      findDevueltasByTienda: vi.fn(async () => [ordenRow()]),
    });
    const service = new NovedadesService(repo, intentos);
    await service.listar({ page: 1, pageSize: PAGE_SIZE }, OTRA_TIENDA);

    // Feature 99: sin conjunto `cerrados` -> el service solo pasa la tienda (+ paginacion en find).
    expect(repo.countDevueltasByTienda).toHaveBeenCalledWith("tienda-2");
    expect(repo.findDevueltasByTienda).toHaveBeenCalledWith("tienda-2", {
      skip: 0,
      take: PAGE_SIZE,
    });
  });

  it("R8: count y find se invocan sobre el MISMO universo (misma tienda, sin conjunto de cerrados)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [ordenRow()]),
    });
    const service = new NovedadesService(repo, intentos);
    await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    // Feature 99 (Q7): el service YA NO computa un conjunto de estatus CERRADOS; el filtro de
    // estado (`estatus = devuelta`) vive en el repo (orden-repository.novedades.test.ts). Aqui se
    // afirma que ambos metodos reciben SOLO la tienda: sin segundo argumento `cerrados` que
    // pudiera divergir entre count y find.
    const argsCount = (repo.countDevueltasByTienda as ReturnType<typeof vi.fn>).mock.calls[0];
    const argsFind = (repo.findDevueltasByTienda as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(argsCount).toEqual(["tienda-1"]);
    expect(argsFind[0]).toBe("tienda-1");
    // find lleva la paginacion como 2.º argumento; NO un conjunto de estatus.
    expect(argsFind[1]).toEqual({ skip: 0, take: PAGE_SIZE });
    expect(argsFind).toHaveLength(2);
  });

  it("R10: la causa fluye al DTO desde la ultima gestion `devuelta` vigente", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
      findCausasDevueltaVigentes: vi.fn(
        async () =>
          new Map<string, CausaDevueltaVigente>([
            ["o1", { causa: "not_found", fecha: new Date("2026-02-01T00:00:00Z") }],
          ]),
      ),
    });
    const service = new NovedadesService(repo, intentos);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items[0].causa).toBe("not_found");
    // R8: una sola consulta agregada, con los ids de la pagina.
    expect(repo.findCausasDevueltaVigentes).toHaveBeenCalledTimes(1);
    expect(repo.findCausasDevueltaVigentes).toHaveBeenCalledWith(["o1"]);
  });

  it("R10: orden sin gestion vigente / causa nula -> causa null (no rompe)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 2),
      findDevueltasByTienda: vi.fn(async () => [
        ordenRow({ id: "sin-gestion" }),
        ordenRow({ id: "causa-nula" }),
      ]),
      findCausasDevueltaVigentes: vi.fn(
        async () =>
          new Map<string, CausaDevueltaVigente>([
            // "sin-gestion" no aparece -> causa ausente; "causa-nula" con causa null.
            ["causa-nula", { causa: null, fecha: new Date("2026-01-05T00:00:00Z") }],
          ]),
      ),
    });
    const service = new NovedadesService(repo, intentos);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    const byId = new Map(res.items.map((i) => [i.id, i.causa]));
    expect(byId.get("sin-gestion")).toBeNull();
    expect(byId.get("causa-nula")).toBeNull();
  });

  it("R12: ordena por la fecha de la ultima gestion vigente desc (mas reciente primero)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 3),
      findDevueltasByTienda: vi.fn(async () => [
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
    const service = new NovedadesService(repo, intentos);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items.map((i) => i.id)).toEqual(["vieja", "nueva"]);
  });

  it("R12 (fallback): sin gestion vigente ordena por Orden.createdAt desc", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 2),
      findDevueltasByTienda: vi.fn(async () => [
        ordenRow({ id: "b", createdAt: new Date("2026-01-01T00:00:00Z") }),
        ordenRow({ id: "a", createdAt: new Date("2026-05-01T00:00:00Z") }),
      ]),
      // Sin causas vigentes -> mapa vacio -> fallback a createdAt de la orden.
      findCausasDevueltaVigentes: vi.fn(
        async () => new Map<string, CausaDevueltaVigente>(),
      ),
    });
    const service = new NovedadesService(repo, intentos);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("R13/R12: respuesta { items, total, page, pageSize } y skip derivado de la pagina", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 25),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
    });
    const service = new NovedadesService(repo, intentos);
    const res = await service.listar({ page: 3, pageSize: PAGE_SIZE }, ADMIN);

    expect(res).toMatchObject({ status: "ok", total: 25, page: 3, pageSize: PAGE_SIZE });
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items).toHaveLength(1);
    // page 3, pageSize 10 -> skip 20 (paginacion de 10 por pagina, R12).
    expect(repo.findDevueltasByTienda).toHaveBeenCalledWith("tienda-1", {
      skip: 20,
      take: PAGE_SIZE,
    });
  });

  it("R8/R13: pagina vacia -> items [] con total, sin pedir causas (no N+1 en vacio)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 0),
      findDevueltasByTienda: vi.fn(async () => []),
    });
    const service = new NovedadesService(repo, intentos);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    expect(res).toEqual({ status: "ok", items: [], total: 0, page: 1, pageSize: PAGE_SIZE });
    expect(repo.findCausasDevueltaVigentes).not.toHaveBeenCalled();
  });
});

// --- Feature 160 (T11): el conteo de intentos en la pagina de novedades ---

describe("NovedadesService.listar — intentos de entrega en lote (160/R11-R15/R26)", () => {
  it("R11/R14: cada novedad sale con `intentosEntrega` numerico, el `0` INCLUIDO", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 2),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "n1" }), ordenRow({ id: "n2" })]),
    });
    // `n2` no viene en el mapa -> 0.
    const doble = fakeIntentosEnLote({ n1: 3 });
    const service = new NovedadesService(repo, doble);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    const porId = new Map(res.items.map((i) => [i.id, i.intentosEntrega]));
    expect(porId.get("n1")).toBe(3);
    expect(porId.get("n2")).toBe(0);
  });

  it("R12/R15: UNA sola llamada, con los ids de la pagina YA acotada a la tienda del actor", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 2),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "n1" }), ordenRow({ id: "n2" })]),
    });
    const doble = fakeIntentosEnLote();
    await new NovedadesService(repo, doble).listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    expect(doble.contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(llamadasIntentos(doble)).toEqual([["n1", "n2"]]);
    expect(repo.findDevueltasByTienda).toHaveBeenCalledWith("tienda-1", {
      skip: 0,
      take: PAGE_SIZE,
    });
  });

  it("R13: pagina vacia -> ni una llamada al derivador", async () => {
    const doble = fakeIntentosEnLote();
    await new NovedadesService(fakeRepo(), doble).listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);
    expect(doble.contarIntentosEnLote).not.toHaveBeenCalled();
  });

  it("R15: un rol no autorizado ni siquiera llega al derivador", async () => {
    const doble = fakeIntentosEnLote();
    const res = await new NovedadesService(fakeRepo(), doble).listar(
      { page: 1, pageSize: PAGE_SIZE },
      MENSAJERO,
    );
    expect(res).toEqual({ status: "forbidden" });
    expect(doble.contarIntentosEnLote).not.toHaveBeenCalled();
  });
});

// --- 2026-08-12 (pedido humano): producto y peso en el DTO ---
// `/novedades` monta la card POS en su vista MOSAICO, que pinta el producto (junto al icono
// de paquete) y el peso (`formatPeso`) SIN compuerta. La decision fue TRAER el dato real de
// la orden, no apagar la seccion. El servicio proyecta ambos campos SIEMPRE (patron aditivo:
// opcionales en el tipo para no romper fixtures, pero emitidos en cada item).

describe("NovedadesService.listar — producto y peso al DTO", () => {
  it("proyecta producto y peso de la orden en cada item", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [
        ordenRow({ id: "o1", producto: "Licuadora", peso: 2.75 }),
      ]),
    });
    const res = await new NovedadesService(repo, intentos).listar(
      { page: 1, pageSize: PAGE_SIZE },
      ADMIN,
    );

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items[0].producto).toBe("Licuadora");
    expect(res.items[0].peso).toBe(2.75);
  });

  it("peso ausente viaja como null: ni 0, ni cadena vacia (la card pinta la raya)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [
        ordenRow({ id: "sin-peso", producto: "Caja", peso: null }),
      ]),
    });
    const res = await new NovedadesService(repo, intentos).listar(
      { page: 1, pageSize: PAGE_SIZE },
      ADMIN,
    );

    if (res.status !== "ok") throw new Error("esperaba ok");
    const item = res.items[0];
    expect(item.peso).toBeNull();
    expect(item.peso).not.toBe(0);
    // `producto` es NOT NULL en el schema: siempre hay texto que pintar al lado del icono.
    expect(item.producto).toBe("Caja");
  });

  it("los campos son SIEMPRE emitidos y 100% serializables (borde RSC)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 2),
      findDevueltasByTienda: vi.fn(async () => [
        ordenRow({ id: "a", producto: "Uno", peso: 0.5 }),
        ordenRow({ id: "b", producto: "Dos", peso: null }),
      ]),
    });
    const res = await new NovedadesService(repo, intentos).listar(
      { page: 1, pageSize: PAGE_SIZE },
      ADMIN,
    );

    if (res.status !== "ok") throw new Error("esperaba ok");
    for (const item of res.items) {
      expect(Object.keys(item)).toEqual(expect.arrayContaining(["producto", "peso"]));
      expect(typeof item.producto).toBe("string");
      expect(item.peso === null || typeof item.peso === "number").toBe(true);
      // Sin Decimal ni Date: el DTO sobrevive a un round-trip JSON sin perder nada.
      expect(JSON.parse(JSON.stringify(item))).toEqual(item);
    }
  });
});

// --- 2026-08-13 (pedido humano): la orden COMPLETA al DTO ---
// `NovedadDTO` extiende `MiAsignacionDTO`, asi que `/novedades` pinta las mismas cards POS
// que «En reparto»/«Entregas» con datos REALES y no con los rellenos que el adaptador de
// front inventaba. Aqui se afirma que cada campo de la fila llega al DTO con su valor, que
// los ausentes viajan como `null` (nunca `""` ni `0`), y las dos unicas cosas que el service
// decide por si mismo: `secuenciaRuta` fijo en `null` y `createdAt` que NO viaja.

describe("NovedadesService.listar — la orden completa al DTO (card POS compartida)", () => {
  it("propaga TODOS los campos de la fila con su valor real", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
    });
    const res = await new NovedadesService(repo, intentos).listar(
      { page: 1, pageSize: PAGE_SIZE },
      ADMIN,
    );

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
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [
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
    const res = await new NovedadesService(repo, intentos).listar(
      { page: 1, pageSize: PAGE_SIZE },
      ADMIN,
    );

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
    // Los NOT NULL del schema siguen presentes en la misma orden.
    expect(item.producto).toBe("Zapatos");
    expect(item.numRemision).toBe("REM-001");
    expect(item.zonaNombre).toBe("GAM");
  });

  it("`secuenciaRuta` es SIEMPRE null: una novedad no es parada de ninguna ruta", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 2),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "a" }), ordenRow({ id: "b" })]),
    });
    const res = await new NovedadesService(repo, intentos).listar(
      { page: 1, pageSize: PAGE_SIZE },
      ADMIN,
    );

    if (res.status !== "ok") throw new Error("esperaba ok");
    for (const item of res.items) expect(item.secuenciaRuta).toBeNull();
  });

  it("`estatusValue` sale de la fila (proyectado), no hardcodeado en el service", async () => {
    // El predicado del repo ya ancla la lista a `devuelta`; el service NO reafirma el valor
    // por su cuenta. Si la fila trae otra cosa, el DTO la refleja: es un dato, no una constante.
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "otro_valor" }),
      ]),
    });
    const res = await new NovedadesService(repo, intentos).listar(
      { page: 1, pageSize: PAGE_SIZE },
      ADMIN,
    );

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items[0].estatusValue).toBe("otro_valor");
  });

  it("`createdAt` NO viaja al DTO: es de la fila del repo y muere en el ordenamiento", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
    });
    const res = await new NovedadesService(repo, intentos).listar(
      { page: 1, pageSize: PAGE_SIZE },
      ADMIN,
    );

    if (res.status !== "ok") throw new Error("esperaba ok");
    const item = res.items[0];
    expect(item).not.toHaveProperty("createdAt");
    // Ni un solo `Date` en el DTO: el borde RSC no lo transporta.
    for (const valor of Object.values(item)) expect(valor).not.toBeInstanceOf(Date);
    expect(JSON.parse(JSON.stringify(item))).toEqual(item);
  });
});

// 2026-08-14 (pedido humano) — el MISMO listado sin recorte por pagina, que es de donde sale el
// archivo de la descarga. Lo que estos casos fijan es lo que separa «el listado entero» de «una
// pagina grande»: el tope se evalua en el SERVIDOR y con el CONTEO (superarlo no lee ni una fila
// ni devuelve un dataset truncado), el alcance sigue saliendo del actor y la proyeccion es la
// MISMA que la de la pagina —dos proyecciones distintas de la misma fila serian dos listados—.
describe("NovedadesService.listarCompleto (descarga)", () => {
  it("rol != adminTienda -> forbidden sin tocar el repo", async () => {
    for (const actor of [MENSAJERO, MAESTRO]) {
      const repo = fakeRepo();
      const res = await new NovedadesService(repo, intentos).listarCompleto(actor);
      expect(res).toEqual({ status: "forbidden" });
      expect(repo.countDevueltasByTienda).not.toHaveBeenCalled();
      expect(repo.findDevueltasByTienda).not.toHaveBeenCalled();
    }
  });

  it("devuelve el listado ENTERO de la tienda del actor, sin recorte por pagina", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 25),
      findDevueltasByTienda: vi.fn(async () =>
        Array.from({ length: 25 }, (_, i) => ordenRow({ id: `o${i}` })),
      ),
    });
    const res = await new NovedadesService(repo, intentos).listarCompleto(ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items).toHaveLength(25);
    expect(res.total).toBe(25);
    // El alcance sale del actor (R9) y la lectura pide las 25, no una pagina de 10.
    expect(repo.countDevueltasByTienda).toHaveBeenCalledWith("tienda-1");
    expect(repo.findDevueltasByTienda).toHaveBeenCalledWith("tienda-1", { skip: 0, take: 25 });
  });

  it("misma proyeccion que la pagina: causa vigente, intentos y ningun `Date`", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
      findCausasDevueltaVigentes: vi.fn(
        async () =>
          new Map<string, CausaDevueltaVigente>([
            ["o1", { causa: "not_found", fecha: new Date("2026-02-01T00:00:00Z") }],
          ]),
      ),
    });
    const service = new NovedadesService(repo, intentos);
    const completo = await service.listarCompleto(ADMIN);
    const pagina = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    if (completo.status !== "ok" || pagina.status !== "ok") throw new Error("esperaba ok");
    expect(completo.items).toEqual(pagina.items);
    expect(completo.items[0].causa).toBe("not_found");
    expect(completo.items[0]).not.toHaveProperty("createdAt");
  });

  // Pedido humano 2026-08-18 — `ayuda` viaja al DTO. La pantalla NO puede derivarlo del estatus:
  // una orden devuelta tambien puede tener ayuda pedida de antes, y una en reparto solo esta en
  // este listado por la ayuda. Sin el campo, el badge no podria distinguirlas.
  it("`ayuda` se proyecta al DTO tal cual llega de la fila, en la pagina y en el archivo", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 2),
      findDevueltasByTienda: vi.fn(async () => [
        ordenRow({ id: "o1", ayuda: true, estatusValue: "en_reparto" }),
        ordenRow({ id: "o2", ayuda: false }),
      ]),
      findCausasDevueltaVigentes: vi.fn(async () => new Map<string, CausaDevueltaVigente>()),
    });
    const service = new NovedadesService(repo, intentos);
    const pagina = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);
    const completo = await service.listarCompleto(ADMIN);

    if (pagina.status !== "ok" || completo.status !== "ok") throw new Error("esperaba ok");
    expect(pagina.items.map((i) => [i.id, i.ayuda])).toEqual([
      ["o1", true],
      ["o2", false],
    ]);
    // El `false` SIEMPRE se emite: es un valor conocido, no un dato ausente.
    expect(pagina.items[1]).toHaveProperty("ayuda", false);
    // Una sola proyeccion: el archivo no puede decir otra cosa que la pagina.
    expect(completo.items).toEqual(pagina.items);
  });

  it("el listado vacio no consulta causas ni intentos", async () => {
    const repo = fakeRepo({ countDevueltasByTienda: vi.fn(async () => 0) });
    const res = await new NovedadesService(repo, intentos).listarCompleto(ADMIN);

    expect(res).toEqual({ status: "ok", items: [], total: 0 });
    expect(repo.findDevueltasByTienda).not.toHaveBeenCalled();
    expect(repo.findCausasDevueltaVigentes).not.toHaveBeenCalled();
  });

  it("superado el tope: `limite_excedido` con conteos, sin leer una sola fila", async () => {
    const limite = descargaConfig.MAX_FILAS;
    const repo = fakeRepo({ countDevueltasByTienda: vi.fn(async () => limite + 1) });
    const res = await new NovedadesService(repo, intentos).listarCompleto(ADMIN);

    expect(res).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    // Ni filas truncadas ni PII en el resultado: el aviso lleva SOLO conteos.
    expect(res).not.toHaveProperty("items");
    expect(repo.findDevueltasByTienda).not.toHaveBeenCalled();
  });

  it("justo EN el tope todavia hay archivo (el limite no se pasa por uno)", async () => {
    const limite = descargaConfig.MAX_FILAS;
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => limite),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
    });
    const res = await new NovedadesService(repo, intentos).listarCompleto(ADMIN);

    expect(res.status).toBe("ok");
    expect(repo.findDevueltasByTienda).toHaveBeenCalledWith("tienda-1", { skip: 0, take: limite });
  });
});
