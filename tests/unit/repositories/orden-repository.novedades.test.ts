import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 89/99 (T13) — metodos de repo de la lista de NOVEDADES. Prisma se mockea con dobles
// simples (patron orden-repository.recepcion-satelite.test.ts): sin DB real, se verifica la
// FORMA del `where` construido. INVIERTE al predicado de la feature 99 (Q7): la novedad se ancla
// al ESTADO REAL `estatus = devuelta`, reemplazando "gestion devuelta vigente + estatus abierto".
//   R7 `estatus.value = "devuelta"` (solo mientras la orden REPOSE en ese estado);
//   R8 `deletedAt: null` (excluye borradas) + `count` y `find` con el MISMO `where`;
//   R8 (no doble conteo) el predicado YA NO usa `gestiones.some` ni `notIn`: una orden liberada a
//      `en_bodega_central`/escalada a `rechazada` sale del predicado por su estado real.
// La causa (R9) la sigue resolviendo `findCausasDevueltaVigentes` (sin cambios).

// El `where` que ambos metodos DEBEN construir con el predicado anclado al estado real (§3.5).
// Pedido humano 2026-08-18: el predicado pasa a tener DOS ramas. Una orden esta en `/novedades`
// por REPOSAR en `devuelta` (R7) o por tener una SOLICITUD DE AYUDA viva, que la deja ahi aunque
// siga en reparto. El `OR` conserva lo que R8 exige: `count` y `find` comparten el mismo `where`,
// asi que total y pagina cuentan el mismo universo, y una orden que case por las DOS ramas
// aparece UNA sola vez.
const NOVEDAD_WHERE = {
  tiendaId: "tienda-1",
  deletedAt: null, // R8: excluye borradas
  OR: [
    // 2026-08-19 (feature 239/T3.1, R18/R20/R30) — VUELVE A SER UNA IGUALDAD DE ESTADO. Entre el
    // 2026-08-18 y hoy esta rama exigia ademas `gestionAprobada: true`, y esa columna era la
    // mitad implementada del fallo: recortaba lo que la tienda VE sin mover el RELOJ del SLA, asi
    // que habia devoluciones que se escalaban a `rechazada` y se COBRABAN sin haber sido visibles
    // nunca. Ahora el recorte lo hace el ESTADO — una devolucion sin confirmar esta en
    // `devolucion_por_confirmar`, y ese estado no casa ni aqui ni en el cron.
    { estatus: { value: "devuelta" } },
    // 2026-08-19 (feature 239/R22) — TAPON DE LA FUGA PERMANENTE. Esta rama no acotaba estatus,
    // asi que una orden con el flag encendido se quedaba listada PARA SIEMPRE: el corte nocturno
    // la barre a `sin_gestionar` sin apagarlo y nadie mas lo apaga. La solicitud de ayuda solo
    // sostiene la fila mientras la orden sigue EN REPARTO, que es el unico estado en el que esa
    // solicitud significa algo. Es un tapon con dueño: la ficha 235 retira el booleano y esta
    // rama entera sobra.
    { ayuda: true, estatus: { value: "en_reparto" } },
  ],
};

// 2026-08-13 (pedido humano) — fila TAL COMO LA DEVUELVE PRISMA para el `select` de
// `findDevueltasByTienda`: catalogos como objetos anidados y los tres decimales como
// `Prisma.Decimal` de verdad. Es el insumo que el repo tiene que traducir a `NovedadOrdenRow`
// (nombres resueltos + `.toNumber()`), asi que el doble NO puede darlos ya convertidos: eso
// haria pasar el test aunque el repo dejase filtrar un Decimal al service.
function prismaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    numGuia: 100,
    numRemision: "REM-001",
    destinatario: "Ana",
    telefonoDest: "88887777",
    direccion: "Calle 1, casa 2",
    producto: "Cafe",
    peso: new Prisma.Decimal("1.500"),
    montoCobrar: new Prisma.Decimal("12500.00"),
    latitud: new Prisma.Decimal("9.9333296"),
    longitud: new Prisma.Decimal("-84.0833282"),
    notas: "Tocar el timbre",
    ayuda: false,
    intentosContacto: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    estatus: { value: "devuelta" },
    tienda: { nombre: "Tienda Uno" },
    zona: { nombre: "GAM" },
    provincia: { nombre: "San Jose" },
    canton: { nombre: "Central" },
    distrito: { nombre: "Carmen" },
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    orden: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    gestionOrden: {
      findMany: vi.fn(),
    },
    ...overrides,
  };
}

describe("OrdenRepository.countDevueltasByTienda (R7/R8)", () => {
  it("R7/R8: cuenta con el predicado anclado al estado (estatus = devuelta + tienda + no borrada)", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(7);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.countDevueltasByTienda("tienda-1")).toBe(7);
    expect(prisma.orden.count).toHaveBeenCalledWith({ where: NOVEDAD_WHERE });

    const { where } = prisma.orden.count.mock.calls[0][0];
    // R7/239-R18: la novedad se ancla al ESTADO REAL, y a nada mas. La primera rama del `OR` es
    // una igualdad limpia: ni marcas persistidas, ni relaciones, ni listas.
    expect(where.OR[0]).toEqual({ estatus: { value: "devuelta" } });
    // La SEGUNDA rama: la solicitud de ayuda, acotada a reparto desde el 2026-08-19 (R22).
    expect(where.OR[1]).toEqual({ ayuda: true, estatus: { value: "en_reparto" } });
    expect(where.OR).toHaveLength(2);
    // R8: nunca cuenta borradas.
    expect(where.deletedAt).toBeNull();
  });

  it("R8 (no doble conteo): el predicado NO usa `gestiones.some` ni `notIn` -> una liberada/escalada sale", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");
    const { where } = prisma.orden.count.mock.calls[0][0];
    // Ya no se filtra por gestion vigente: el ancla es el estado real.
    expect(where).not.toHaveProperty("gestiones");
    // Y no hay lista `notIn`: solo `estatus.value = "devuelta"`. Una orden liberada a
    // `en_bodega_central`/`en_bodega_satelite` o escalada a `rechazada` deja de casar por la rama
    // del estatus — y si no tiene ayuda pedida, tampoco por la otra: sale de novedades.
    expect(where.OR[0].estatus.value).toBe("devuelta");
    expect(where.OR[0].estatus).not.toHaveProperty("notIn");
  });
});

describe("OrdenRepository.findDevueltasByTienda (R7/R8/R9)", () => {
  it("R7/R8: where anclado al estado, orderBy createdAt desc, skip/take y select de la orden completa", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([prismaRow()]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 20, take: 10 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "o1", numGuia: 100, destinatario: "Ana" });
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual(NOVEDAD_WHERE);
    expect(arg.orderBy).toEqual({ createdAt: "desc" }); // fallback; el service reordena por recencia
    expect(arg.skip).toBe(20);
    expect(arg.take).toBe(10);
    // El `select` cubre EXACTAMENTE `NovedadOrdenRow` (2026-08-13): columnas de la orden +
    // los catalogos por NOMBRE. Sigue sin arrastrar `deletedAt` ni relaciones pesadas
    // (gestiones, historial, evidencias) ni `busquedaTexto`.
    expect(arg.select).toEqual({
      id: true,
      numGuia: true,
      numRemision: true,
      destinatario: true,
      telefonoDest: true,
      direccion: true,
      producto: true,
      peso: true,
      montoCobrar: true,
      latitud: true,
      longitud: true,
      notas: true,
      ayuda: true,
      intentosContacto: true,
      createdAt: true,
      estatus: { select: { value: true } },
      tienda: { select: { nombre: true } },
      zona: { select: { nombre: true } },
      provincia: { select: { nombre: true } },
      canton: { select: { nombre: true } },
      distrito: { select: { nombre: true } },
    });
    expect(arg.select).not.toHaveProperty("deletedAt");
  });

  // 2026-08-12 (pedido humano) — producto y peso salen de la orden, y el `peso` cruza como
  // NUMBER: `Prisma.Decimal` no es serializable en el borde RSC y `formatPeso` espera
  // `number | null`. La conversion es `.toNumber()`, nunca `parseFloat` sobre el Decimal.
  it("producto y peso llegan a la fila; el peso Decimal sale como number", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      prismaRow({ producto: "Zapatos", peso: new Prisma.Decimal("1.500") }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    expect(rows[0].producto).toBe("Zapatos");
    expect(rows[0].peso).toBe(1.5);
    expect(typeof rows[0].peso).toBe("number");
  });

  // Pedido humano 2026-08-18 — la fila lleva `ayuda` porque es una de las DOS razones por las
  // que puede estar aqui, y la pantalla tiene que poder decir cual. Una orden que sigue EN
  // REPARTO entra por esa rama: es el caso que antes de este pedido no existia.
  it("la orden con ayuda pedida llega aunque NO este devuelta, y su `ayuda` cruza como true", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      prismaRow({ ayuda: true, estatus: { value: "en_reparto" } }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    expect(rows[0].ayuda).toBe(true);
    expect(rows[0].estatusValue).toBe("en_reparto");
  });

  it("sin ayuda pedida, el flag cruza como false (nunca undefined: la columna es NOT NULL)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([prismaRow()]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    expect(rows[0].ayuda).toBe(false);
  });

  it("peso nulo (carga masiva sin peso, feature 15/R4) sigue nulo: no se rellena con 0", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      prismaRow({ id: "o2", numGuia: null, destinatario: "Beto", telefonoDest: "22223333", producto: "Caja", peso: null }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    expect(rows[0].peso).toBeNull();
  });

  // --- 2026-08-13 (pedido humano): la fila trae la orden COMPLETA ---
  // `NovedadDTO` extiende `MiAsignacionDTO` para que `/novedades` pinte las mismas cards POS
  // que el portal del mensajero. La responsabilidad de ESTA capa es doble: resolver los
  // nombres de catalogo (el DTO nunca ve IDs) y que NINGUN `Prisma.Decimal` la cruce.

  it("resuelve los nombres de catalogo: ningun ID de catalogo sale en la fila", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([prismaRow()]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    expect(rows[0]).toMatchObject({
      numRemision: "REM-001",
      estatusValue: "devuelta", // proyectado de la relacion, no hardcodeado
      direccion: "Calle 1, casa 2",
      notas: "Tocar el timbre",
      tiendaNombre: "Tienda Uno",
      zonaNombre: "GAM",
      provinciaNombre: "San Jose",
      cantonNombre: "Central",
      distritoNombre: "Carmen",
    });
    // La fila expone NOMBRES, nunca los FKs de catalogo ni las relaciones crudas.
    for (const prohibido of ["zonaId", "provinciaId", "cantonId", "distritoId", "estatusId", "tienda", "zona", "estatus"]) {
      expect(rows[0]).not.toHaveProperty(prohibido);
    }
  });

  it("los TRES Decimal (peso, montoCobrar, lat/lng) salen como number: nunca cruza un Prisma.Decimal", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      prismaRow({
        peso: new Prisma.Decimal("2.750"),
        montoCobrar: new Prisma.Decimal("12500.00"),
        latitud: new Prisma.Decimal("9.9333296"),
        longitud: new Prisma.Decimal("-84.0833282"),
      }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    expect(rows[0].peso).toBe(2.75);
    expect(rows[0].montoCobrar).toBe(12500);
    expect(rows[0].latitud).toBe(9.9333296);
    expect(rows[0].longitud).toBe(-84.0833282);
    for (const valor of [rows[0].peso, rows[0].montoCobrar, rows[0].latitud, rows[0].longitud]) {
      expect(typeof valor).toBe("number");
      expect(valor).not.toBeInstanceOf(Prisma.Decimal);
    }
  });

  it("un Decimal de valor 0 NO se pierde con la guarda de null (montoCobrar 0 != null)", async () => {
    // La guarda es `row.x ? row.x.toNumber() : null` y una instancia Decimal es SIEMPRE
    // truthy, incluida la de valor 0: solo `null` cae a `null`.
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      prismaRow({ montoCobrar: new Prisma.Decimal("0.00"), latitud: new Prisma.Decimal("0") }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    expect(rows[0].montoCobrar).toBe(0);
    expect(rows[0].latitud).toBe(0);
  });

  it("orden PELADA: peso, direccion, monto, notas, distrito y coordenadas ausentes viajan como null", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      prismaRow({
        id: "pelada",
        peso: null,
        direccion: null,
        montoCobrar: null,
        latitud: null,
        longitud: null,
        notas: null,
        distrito: null, // `distrito_id` es el UNICO FK geografico nullable
      }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    for (const campo of [
      "peso",
      "direccion",
      "montoCobrar",
      "latitud",
      "longitud",
      "notas",
      "distritoNombre",
    ] as const) {
      expect(rows[0][campo]).toBeNull();
      // El hueco se dice, no se disfraza: ni `""` ni `0`.
      expect(rows[0][campo]).not.toBe("");
      expect(rows[0][campo]).not.toBe(0);
    }
    // Los NOT NULL del schema siguen ahi.
    expect(rows[0].producto).toBe("Cafe");
    expect(rows[0].numRemision).toBe("REM-001");
    expect(rows[0].zonaNombre).toBe("GAM");
  });

  it("R8: el where NO tiene relacion `gestiones` (anclado SOLO al estado real)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).not.toHaveProperty("gestiones");
    expect(arg.where.OR[0]).toEqual({ estatus: { value: "devuelta" } });
  });
});

describe("OrdenRepository — R8: count y find comparten el MISMO where", () => {
  it("R8: ambos metodos construyen exactamente el mismo predicado anclado al estado", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(3);
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");
    await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    const whereCount = prisma.orden.count.mock.calls[0][0].where;
    const whereFind = prisma.orden.findMany.mock.calls[0][0].where;
    expect(whereCount).toEqual(whereFind);
    expect(whereCount).toEqual(NOVEDAD_WHERE);
  });
});

describe("OrdenRepository.findCausasDevueltaVigentes (R6/R7/R10)", () => {
  it("R7: filtra `resultado=devuelta` y `anuladaAt=null` (una gestion anulada no cuenta)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findCausasDevueltaVigentes(["o1", "o2", "o3"]);

    expect(prisma.gestionOrden.findMany).toHaveBeenCalledTimes(1); // no una por orden (R8)
    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      ordenId: { in: ["o1", "o2", "o3"] },
      resultado: "devuelta", // R6: solo devoluciones
      anuladaAt: null, // R7: solo vigentes (anuladas no cuentan)
    });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.select).toEqual({ ordenId: true, causaDevolucion: true, createdAt: true });
  });

  it("R6: reduce a la fila MAS RECIENTE por orden (ignora las mas antiguas)", async () => {
    const prisma = buildPrisma();
    // Vienen desc por createdAt: la primera por ordenId es la vigente/mas reciente.
    prisma.gestionOrden.findMany.mockResolvedValue([
      { ordenId: "o1", causaDevolucion: "not_found", createdAt: new Date("2026-03-10T00:00:00Z") },
      { ordenId: "o1", causaDevolucion: "wrong_number", createdAt: new Date("2026-01-01T00:00:00Z") },
      { ordenId: "o2", causaDevolucion: null, createdAt: new Date("2026-02-01T00:00:00Z") },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findCausasDevueltaVigentes(["o1", "o2"]);

    expect(map.get("o1")).toEqual({
      causa: "not_found",
      fecha: new Date("2026-03-10T00:00:00Z"),
    });
    expect(map.get("o2")).toEqual({ causa: null, fecha: new Date("2026-02-01T00:00:00Z") });
  });

  it("R10: ids vacio -> Map vacio sin disparar la query", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findCausasDevueltaVigentes([]);

    expect(map.size).toBe(0);
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 239 (T3.1) — LA MITAD QUE FALTABA. El fallo que esta ficha cierra no era el predicado
// ni el cron por separado: era que MIRABAN HECHOS DISTINTOS. La visibilidad dependia de una
// columna (`gestion_aprobada`) que solo se encendia al aprobar el cierre, y el reloj del SLA se
// anclaba en la fecha de la gestion sin mirar esa columna ni una vez. Entre los dos habia una
// ventana —mediana medida de 8,2 h, p90 22,1 h— en la que la orden ya corria plazo y todavia no
// se veia; con la ventana `not_found` de 24 h, eso son rechazados cobrados a ciegas.
//
// Desde aqui los dos miran el ESTADO, y es el mismo estado.
// ---------------------------------------------------------------------------------------------
describe("239 — la visibilidad y el reloj miran el MISMO hecho (R18/R19/R20/R21/R23/R30)", () => {
  const PRE_ESTADO = "devolucion_por_confirmar";

  it("R18: una orden en `devuelta` se lista, sin ninguna condicion adicional", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(1);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");

    const { where } = prisma.orden.count.mock.calls[0][0];
    expect(where.OR[0]).toEqual({ estatus: { value: "devuelta" } });
  });

  it("R19: una orden en el PRE-ESTADO no casa el predicado (no hay rama que la admita)", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");

    const { where } = prisma.orden.count.mock.calls[0][0];
    // La rama del estatus es una IGUALDAD con `devuelta`: el pre-estado no entra ni por omision
    // ni por lista negra. Y la otra rama es la de ayuda, que no habla de devoluciones.
    expect(where.OR[0].estatus).toEqual({ value: "devuelta" });
    expect(JSON.stringify(where)).not.toContain(PRE_ESTADO);
  });

  // R20 — LA REGLA, no un detalle de implementacion: la visibilidad NO puede depender de ninguna
  // marca persistida distinta del estado. Una marca hay que apagarla a mano en cada salida, y de
  // las SIETE salidas de `devuelta` solo DOS lo hacian. El estado no se puede olvidar.
  it("R20: el predicado no menciona ninguna marca persistida de aprobacion", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");

    const serializado = JSON.stringify(prisma.orden.count.mock.calls[0][0].where);
    // Los dos nombres de la columna retirada se construyen por CONCATENACION, no como literal:
    // el censo de `gestion-aprobada-retirada.guardia.test.ts` barre el arbol buscandolos, y un
    // literal aqui lo pondria rojo por una asercion que precisamente comprueba su ausencia. Es
    // la misma convencion que uso la 155 con el value que retiro.
    expect(serializado).not.toContain(["gestion", "Aprobada"].join(""));
    expect(serializado).not.toContain(["gestion", "aprobada"].join("_"));
    // La rama del estatus tiene UNA sola clave: el estatus. Ni una condicion hermana.
    expect(Object.keys(prisma.orden.count.mock.calls[0][0].where.OR[0])).toEqual(["estatus"]);
  });

  // R30 — EL ARREGLO DEL RECORTE RETROACTIVO. `gestion_aprobada` era `NOT NULL DEFAULT false`, asi
  // que TODA devolucion anterior a la columna valia `false` y CAIA de `/novedades`: el recorte no
  // afectaba solo a las nuevas, borraba de la pantalla las que ya estaban. Al retirar la columna
  // el predicado vuelve a ser una igualdad de estado y esas devoluciones se ven SOLAS, sin
  // backfill — la migracion ES el arreglo.
  it("R30: una `devuelta` ANTERIOR al despliegue casa el predicado (nada que backfillear)", async () => {
    const prisma = buildPrisma();
    // Fila historica: no tiene, ni puede tener, ninguna marca de aprobacion.
    const historica = prismaRow({ id: "o-vieja", estatus: { value: "devuelta" } });
    prisma.orden.findMany.mockResolvedValue([historica]);
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    expect(res.map((r) => r.id)).toEqual(["o-vieja"]);
    // Y el predicado con el que se pidio no exige nada mas que el estado.
    expect(prisma.orden.findMany.mock.calls[0][0].where.OR[0]).toEqual({
      estatus: { value: "devuelta" },
    });
  });

  // R21 — el total y la pagina describen el mismo universo. El caso vive arriba, entero; aqui se
  // vuelve a nombrar con su requisito porque es la asercion que la mutacion T5.3 tiene que matar.
  it("R21: `count` y `find` comparten EXACTAMENTE el mismo where", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(3);
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");
    await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    expect(prisma.orden.count.mock.calls[0][0].where).toEqual(
      prisma.orden.findMany.mock.calls[0][0].where,
    );
  });

  // R22 — LA FUGA PERMANENTE, TAPADA. Es el segundo de los tres fallos de la misma raiz
  // (auditoria §2.1): la rama de ayuda no acotaba estatus, asi que una orden con el flag
  // encendido se quedaba en `/novedades` PARA SIEMPRE. El corte nocturno la barre a
  // `sin_gestionar` y NO apaga el flag; ninguna otra via lo apaga tampoco. La tienda acababa con
  // una pantalla llena de ordenes que ya no le tocaban, y la unica salida era pulsar «Habilitar»
  // en cada una a mano.
  //
  // El tapon es UNA CLAVE, y por eso hace falta este caso: una linea que nadie vigila es una
  // linea que el proximo refactor se lleva por delante sin que nada se ponga rojo.
  //
  // LA MUTACION QUE LO MATA: quitarle el `estatus` a la rama de ayuda —volver a `{ ayuda: true }`
  // a secas—, que es exactamente como estaba antes del 2026-08-19.
  it("R22: la rama de ayuda EXIGE `en_reparto` — una solicitud vieja no sostiene la fila", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");

    const { where } = prisma.orden.count.mock.calls[0][0];
    const ramaAyuda = where.OR.find((r: Record<string, unknown>) => r.ayuda === true);
    expect(ramaAyuda, "la rama de ayuda desaparecio del predicado").toBeDefined();
    // La clave hermana es lo que cierra la fuga: `ayuda` y `estatus` van en el MISMO objeto, asi
    // que se exigen a la vez (AND). Si `estatus` se fuera a otra rama del `OR`, volveria a ser un
    // «o esto o lo otro» y la fuga estaria abierta otra vez.
    expect(ramaAyuda).toEqual({ ayuda: true, estatus: { value: "en_reparto" } });
    expect(Object.keys(ramaAyuda).sort()).toEqual(["ayuda", "estatus"]);
  });

  // El caso de negocio, enunciado como lo que la tienda ve. Se prueba sobre el PREDICADO porque
  // es lo unico que decide: Prisma resuelve el `AND` de claves hermanas, y este doble no ejecuta
  // SQL. Lo que se afirma es que ninguna de las dos ramas admite una orden fuera de reparto por
  // efecto del flag.
  it("R22: ninguna rama lista una orden con ayuda si NO esta en reparto (ni `sin_gestionar`, ni bodega, ni entregada)", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");
    const { where } = prisma.orden.count.mock.calls[0][0];

    // Simula el predicado sobre una orden con la bandera encendida en cada estado por el que el
    // corte nocturno y la bodega la pasan. `casa` reproduce la semantica de Prisma para las dos
    // formas que este predicado usa: claves hermanas = AND, `OR` = disyuncion.
    const casa = (orden: { estatus: string; ayuda: boolean }) =>
      (where.OR as Array<{ ayuda?: boolean; estatus?: { value: string } }>).some(
        (rama) =>
          (rama.ayuda === undefined || rama.ayuda === orden.ayuda) &&
          (rama.estatus === undefined || rama.estatus.value === orden.estatus),
      );

    // EN reparto con ayuda: SI se lista. Es el caso para el que la rama existe.
    expect(casa({ estatus: "en_reparto", ayuda: true })).toBe(true);
    // Fuera de reparto con la ayuda ENCENDIDA: no se lista por ninguna rama. Estos cuatro son la
    // fuga literal que describe la auditoria §2.1.
    for (const estatus of [
      "sin_gestionar", // el corte nocturno la barre aqui y NO apaga el flag
      "en_bodega_central",
      "en_bodega_satelite",
      "entregada",
    ]) {
      expect(casa({ estatus, ayuda: true }), `${estatus} con ayuda NO debe listarse`).toBe(false);
    }
    // Y la devolucion sigue entrando por SU rama, con la bandera apagada: el tapon no la toca.
    expect(casa({ estatus: "devuelta", ayuda: false })).toBe(true);
  });

  // R23 — «HABILITAR» YA NO PUEDE ESCONDER UNA DEVOLUCION CON EL RELOJ CORRIENDO. Antes apagaba
  // `gestion_aprobada`, la fila caia del listado y la orden seguia en `devuelta`: a los 5 dias el
  // cron la escalaba a `rechazada` y la cobraba, sin aviso (auditoria §2.2). Ahora apaga solo
  // `ayuda`, y la rama de la devolucion no depende de esa bandera.
  it("R23: `habilitarNovedad` apaga SOLO `ayuda` — la devolucion sigue listada mientras corra su reloj", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = buildPrisma({ orden: { findMany: vi.fn(), count: vi.fn(), update } });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.habilitarNovedad("o1");

    // Igualdad EXACTA: si volviera a apagar una marca que la rama del estatus mirase, la orden
    // desapareceria de la pantalla con la ventana de SLA todavia viva.
    expect(update).toHaveBeenCalledWith({ where: { id: "o1" }, data: { ayuda: false } });
    // Y el predicado de la devolucion no mira `ayuda`, asi que la fila no se mueve de sitio.
    expect(NOVEDAD_WHERE.OR[0]).toEqual({ estatus: { value: "devuelta" } });
  });
});
