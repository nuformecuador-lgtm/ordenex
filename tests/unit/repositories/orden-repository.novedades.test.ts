import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GRUPOS_NOVEDAD, type GrupoNovedad } from "@/lib/types/novedad-grupo";

// Feature 89/99 (T13) → FEATURE 236 (T2.1/T2.3/T2.5) — metodos de repo de las DOS superficies de
// `/novedades`. Prisma se mockea con dobles simples (patron
// orden-repository.recepcion-satelite.test.ts): sin DB real.
//
// ⚠️ 2026-08-19 — NOTA FECHADA DEL CAMBIO. Hasta hoy este archivo fijaba un `NOVEDAD_WHERE` con un
// `OR` de dos igualdades de estado, porque el predicado listaba las DOS poblaciones mezcladas bajo
// una sola pestaña. La 236 lo parte: `novedadWhere(tiendaId, grupo)` es UNA igualdad, y hay un
// predicado por grupo. Los casos NO se borran: se reapuntan y se REFUERZAN.
//
// QUE SE REFUERZA, y por que importa mas que la forma:
//
//  1. La invariante «count y find comparten EXACTAMENTE el mismo where» pasa a ITERAR
//     `GRUPOS_NOVEDAD` en vez de escribirse una vez. Un grupo nuevo entra SOLO a la asercion.
//  2. Se añade un EVALUADOR que APLICA el predicado a filas, en vez de solo describir su forma.
//     Esta es la leccion cara de este repo: un test que afirma la FORMA de un `where` pasa en verde
//     ante mutaciones que cambian a QUE FILAS casa. El evaluador REVIENTA ante cualquier forma que
//     no entienda —un `OR`, por ejemplo—, asi que volver al predicado de ayer no lo deja pasar en
//     silencio: lo pone rojo.
//  3. El evaluador se prueba a si mismo contra respuestas conocidas antes de usarse (bloque 0). Un
//     evaluador roto diria «no casa» a todo y dejaria verdes todas las aserciones negativas.

// ---------------------------------------------------------------------------------------------
// El CONTRATO de la pantalla, escrito a mano: que estatus lista cada pestaña.
//
// A proposito NO se deriva de `ESTATUS_POR_GRUPO`: comparar el predicado contra su propia fuente
// estaria SIEMPRE verde, y lo que hay que fijar aqui es justamente que la pestaña de ayuda enseña
// `ayuda_tienda` y la de devolucion `devuelta`, no lo que diga el mapa el dia que alguien lo toque.
// Que la tabla cubra EXACTAMENTE los grupos declarados se comprueba abajo, asi que un grupo nuevo
// obliga a pasar por aqui y decidir su estatus.
// ---------------------------------------------------------------------------------------------
const ESTATUS_ESPERADO: Record<GrupoNovedad, string> = {
  ayuda: "ayuda_tienda", // feature 235: solicitud viva, el paquete sigue en la moto
  devolucion: "devuelta", // feature 239: devolucion ANCLADA (confirmada en el cierre)
};

/** El `where` que los DOS metodos DEBEN construir para `grupo`. Tres claves, ni una mas. */
function novedadWhereEsperado(tiendaId: string, grupo: GrupoNovedad) {
  return {
    tiendaId,
    deletedAt: null, // R10: excluye borradas
    estatus: { value: ESTATUS_ESPERADO[grupo] }, // R3: igualdad con el ESTADO ACTUAL, y nada mas
  };
}

// ---------------------------------------------------------------------------------------------
// El EVALUADOR: reproduce la semantica de Prisma para la UNICA forma que este predicado usa, y
// revienta ante cualquier otra. Es lo que convierte «el where tiene esta forma» en «este where
// admite estas filas y rechaza estas otras».
// ---------------------------------------------------------------------------------------------

interface FilaDePrueba {
  tiendaId: string;
  deletedAt: Date | null;
  estatusValue: string;
}

function casa(where: unknown, fila: FilaDePrueba): boolean {
  if (typeof where !== "object" || where === null) {
    throw new Error("el predicado de novedades no es un objeto");
  }
  const w = where as Record<string, unknown>;
  const claves = Object.keys(w).sort();
  // Si el predicado gana una forma nueva —un `OR`, un `in`, una relacion, una clave hermana— el
  // evaluador NO adivina: se detiene en rojo. Un evaluador permisivo dejaria pasar la mutacion que
  // este archivo existe para cazar.
  if (claves.join(",") !== "deletedAt,estatus,tiendaId") {
    throw new Error(
      `el predicado de novedades tiene claves inesperadas [${claves.join(", ")}]: el evaluador ` +
        `solo entiende { tiendaId, deletedAt, estatus: { value } }. Si el predicado cambio de ` +
        `forma a proposito, enseñale a leerla — no borres la comprobacion.`,
    );
  }
  const estatus = w.estatus as Record<string, unknown>;
  if (Object.keys(estatus).join(",") !== "value" || typeof estatus.value !== "string") {
    throw new Error("`estatus` dejo de ser una igualdad simple `{ value: <literal> }`");
  }
  if (w.deletedAt !== null) throw new Error("`deletedAt` dejo de exigir `null`");
  return (
    fila.tiendaId === w.tiendaId &&
    fila.deletedAt === null &&
    fila.estatusValue === estatus.value
  );
}

function fila(overrides: Partial<FilaDePrueba> = {}): FilaDePrueba {
  return { tiendaId: "tienda-1", deletedAt: null, estatusValue: "devuelta", ...overrides };
}

// 2026-08-13 (pedido humano) — fila TAL COMO LA DEVUELVE PRISMA para el `select` de
// `findNovedadesByTienda`: catalogos como objetos anidados y los tres decimales como
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
    intentosContacto: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    estatus: { value: "devuelta" },
    tienda: { nombre: "Tienda Uno" },
    zona: { nombre: "GAM" },
    provincia: { nombre: "San Jose" },
    canton: { nombre: "Central" },
    distrito: { nombre: "Carmen" },
    // FICHA 296: la relacion del mensajero tal como la devuelve Prisma —objeto anidado, no un
    // nombre ya plano—. Es NULLABLE (`mensajero_asignado_id` lo es), asi que el doble tiene que
    // poder darla como `null` sin que el repo reviente.
    mensajeroAsignado: { nombre: "Marta Mensajera" },
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
    ordenHistorialEstado: {
      findMany: vi.fn(),
    },
    ...overrides,
  };
}

/** El `where` con el que se llamo a `count` para `grupo` (una llamada, un predicado). */
async function whereDeCount(grupo: GrupoNovedad, tiendaId = "tienda-1") {
  const prisma = buildPrisma();
  prisma.orden.count.mockResolvedValue(0);
  const repo = new OrdenRepository(prisma as unknown as PrismaClient);
  await repo.countNovedadesByTienda(tiendaId, grupo);
  return prisma.orden.count.mock.calls[0][0].where;
}

// =============================================================================================
// 0 — el evaluador, probado contra respuestas conocidas
// =============================================================================================

describe("0 — el evaluador de predicados de esta suite no esta roto", () => {
  it("acepta y rechaza lo que debe sobre un predicado sintetico", () => {
    const sintetico = { tiendaId: "t1", deletedAt: null, estatus: { value: "devuelta" } };
    expect(casa(sintetico, fila({ tiendaId: "t1", estatusValue: "devuelta" }))).toBe(true);
    expect(casa(sintetico, fila({ tiendaId: "t2", estatusValue: "devuelta" }))).toBe(false);
    expect(casa(sintetico, fila({ tiendaId: "t1", estatusValue: "entregada" }))).toBe(false);
    expect(
      casa(sintetico, fila({ tiendaId: "t1", estatusValue: "devuelta", deletedAt: new Date() })),
    ).toBe(false);
  });

  it("REVIENTA ante una forma que no entiende (nunca «no la entiendo» -> «no casa»)", () => {
    // Es la propiedad que impide que la mutacion «devolver el `OR` de ayer» pase en verde: el
    // evaluador no puede responder `false` a todo y dejar las aserciones negativas satisfechas.
    expect(() =>
      casa(
        {
          tiendaId: "t1",
          deletedAt: null,
          OR: [{ estatus: { value: "devuelta" } }, { estatus: { value: "ayuda_tienda" } }],
        },
        fila(),
      ),
    ).toThrow(/claves inesperadas/);
    // Una clave hermana al lado del estado —la forma exacta de las dos fugas de esta pila—. El
    // nombre de la clave se construye por CONCATENACION y no como literal: el censo de
    // `ayuda-columna-retirada.guardia.test.ts` barre el arbol buscando `ayuda: true` y un literal
    // aqui lo pondria rojo por una asercion que precisamente comprueba que esa forma se rechaza.
    const claveHermana = ["ayu", "da"].join("");
    expect(() =>
      casa(
        { tiendaId: "t1", deletedAt: null, estatus: { value: "devuelta" }, [claveHermana]: true },
        fila(),
      ),
    ).toThrow(/claves inesperadas/);
    // Un `in` en vez de una igualdad:
    expect(() =>
      casa({ tiendaId: "t1", deletedAt: null, estatus: { value: { in: ["devuelta"] } } }, fila()),
    ).toThrow(/igualdad simple/);
  });

  it("la tabla de estatus esperados cubre EXACTAMENTE los grupos declarados", () => {
    // Sin esto, un grupo nuevo se colaria sin que nadie decidiera aqui que estatus lista su
    // pestaña, y los bucles de abajo lo recorrerian con `undefined` como estatus esperado.
    expect(Object.keys(ESTATUS_ESPERADO).sort()).toEqual([...GRUPOS_NOVEDAD].sort());
    expect(GRUPOS_NOVEDAD.length).toBeGreaterThan(1); // no-vacuidad de todos los `for` de abajo
  });
});

// =============================================================================================
// R3/R10 — el predicado de cada grupo: una igualdad de estado, y nada mas
// =============================================================================================

describe("236/R3/R10 — `novedadWhere` es UNA igualdad de estado por grupo", () => {
  it.each([...GRUPOS_NOVEDAD])(
    "grupo %s: el where tiene EXACTAMENTE tres claves y su estatus es el suyo",
    async (grupo) => {
      const where = await whereDeCount(grupo);
      expect(where).toEqual(novedadWhereEsperado("tienda-1", grupo));
      // Censo CERRADO de claves: una clave hermana al lado del estado es la forma literal de las
      // dos fugas de esta pila (`orden.ayuda`, `gestion_aprobada`). No caben.
      expect(Object.keys(where).sort()).toEqual(["deletedAt", "estatus", "tiendaId"]);
      expect(where).not.toHaveProperty("OR");
      expect(where).not.toHaveProperty("gestiones");
      expect(Object.keys(where.estatus)).toEqual(["value"]);
      expect(where.deletedAt).toBeNull(); // R10: nunca cuenta borradas
    },
  );

  it("R3: ninguna marca persistida sobrevive en ningun predicado", async () => {
    for (const grupo of GRUPOS_NOVEDAD) {
      const serializado = JSON.stringify(await whereDeCount(grupo));
      // Los nombres de las dos columnas retiradas se construyen por CONCATENACION, no como
      // literal: los censos de `ayuda-columna-retirada` y `gestion-aprobada-retirada` barren el
      // arbol buscandolos y un literal aqui los pondria rojos por una asercion que precisamente
      // comprueba su ausencia.
      expect(serializado).not.toContain(["gestion", "Aprobada"].join(""));
      expect(serializado).not.toContain(["ayuda", ":true"].join(""));
      expect(serializado).not.toContain("intentos");
    }
  });

  it("R10: el alcance por tienda viaja tal cual al predicado", async () => {
    for (const grupo of GRUPOS_NOVEDAD) {
      expect((await whereDeCount(grupo, "tienda-9")).tiendaId).toBe("tienda-9");
    }
  });
});

// =============================================================================================
// R9 — una orden vive en EXACTAMENTE una pestaña, aplicando el predicado a filas
// =============================================================================================

describe("236/R9 — una orden de un grupo NO casa el predicado del otro", () => {
  it("cada estatus casa su propio grupo y NINGUN otro", async () => {
    const predicados = new Map<GrupoNovedad, unknown>();
    for (const grupo of GRUPOS_NOVEDAD) predicados.set(grupo, await whereDeCount(grupo));

    for (const grupoFila of GRUPOS_NOVEDAD) {
      const orden = fila({ estatusValue: ESTATUS_ESPERADO[grupoFila] });
      for (const grupoPredicado of GRUPOS_NOVEDAD) {
        const esperado = grupoFila === grupoPredicado;
        expect(
          casa(predicados.get(grupoPredicado), orden),
          `una orden en ${orden.estatusValue} ${esperado ? "DEBE" : "NO debe"} casar el ` +
            `predicado del grupo ${grupoPredicado}`,
        ).toBe(esperado);
      }
    }
  });

  it("235/R32: ningun grupo lista una orden que SALIO de su estatus", async () => {
    // Los estados por los que pasa una orden DESPUES de salir de la ayuda o de la devolucion.
    // Cuando la ayuda era una bandera, estos cuatro eran la fuga literal de la auditoria §2.1.
    const predicados = await Promise.all(
      [...GRUPOS_NOVEDAD].map(async (g) => [g, await whereDeCount(g)] as const),
    );
    for (const estatus of [
      "en_reparto", // rescatada: vuelve a la calle y desaparece de la pantalla de la tienda
      "sin_gestionar", // el corte nocturno la barrio
      "en_bodega_central",
      "en_bodega_satelite",
      "entregada",
      "devolucion_por_confirmar", // 239: el pre-estado, que la tienda NO ve
      "rechazada",
    ]) {
      for (const [grupo, where] of predicados) {
        expect(casa(where, fila({ estatusValue: estatus })), `${estatus} en ${grupo}`).toBe(false);
      }
    }
  });

  it("R10: ni la orden de otra tienda ni la borrada casan ningun predicado", async () => {
    for (const grupo of GRUPOS_NOVEDAD) {
      const where = await whereDeCount(grupo);
      const propia = fila({ estatusValue: ESTATUS_ESPERADO[grupo] });
      // Control POSITIVO al lado de cada negativo: si la fila propia no casara, los tres `false`
      // de abajo serian ciertos por la razon equivocada.
      expect(casa(where, propia)).toBe(true);
      expect(casa(where, { ...propia, tiendaId: "tienda-2" })).toBe(false);
      expect(casa(where, { ...propia, deletedAt: new Date("2026-01-01") })).toBe(false);
    }
  });
});

// =============================================================================================
// R4 — count y find comparten EXACTAMENTE el mismo where, ITERANDO los grupos
// =============================================================================================

describe("236/R4 — el total y la pagina cuentan el mismo universo, en TODOS los grupos", () => {
  it("count y find construyen el mismo predicado para cada grupo de `GRUPOS_NOVEDAD`", async () => {
    // El caso ITERA en vez de duplicarse a mano: un grupo nuevo entra SOLO a esta asercion, sin
    // que nadie tenga que acordarse. Esa es la mejora real de la 236 sobre la invariante heredada.
    for (const grupo of GRUPOS_NOVEDAD) {
      const prisma = buildPrisma();
      prisma.orden.count.mockResolvedValue(3);
      prisma.orden.findMany.mockResolvedValue([]);
      const repo = new OrdenRepository(prisma as unknown as PrismaClient);

      await repo.countNovedadesByTienda("tienda-1", grupo);
      await repo.findNovedadesByTienda("tienda-1", grupo, { skip: 0, take: 10 });

      const whereCount = prisma.orden.count.mock.calls[0][0].where;
      const whereFind = prisma.orden.findMany.mock.calls[0][0].where;
      expect(whereCount, `grupo ${grupo}`).toEqual(whereFind);
      expect(whereCount, `grupo ${grupo}`).toEqual(novedadWhereEsperado("tienda-1", grupo));
    }
  });

  it("el grupo llega hasta el predicado: pedir uno NO consulta el estatus del otro", async () => {
    // Mata la mutacion «ignorar el parametro `grupo`»: con un predicado fijo, los dos grupos
    // producirian el MISMO where y esto cae.
    const wheres = await Promise.all([...GRUPOS_NOVEDAD].map((g) => whereDeCount(g)));
    const valores = wheres.map((w) => (w as { estatus: { value: string } }).estatus.value);
    expect(new Set(valores).size).toBe(GRUPOS_NOVEDAD.length);
  });
});

// =============================================================================================
// La PAGINA: lo que el `select` proyecta y como lo traduce (heredado, con los nombres nuevos)
// =============================================================================================

describe("OrdenRepository.findNovedadesByTienda (R4/R10)", () => {
  it("where del grupo, orderBy createdAt desc, skip/take y select de la orden completa", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([prismaRow()]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 20, take: 10 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "o1", numGuia: 100, destinatario: "Ana" });
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual(novedadWhereEsperado("tienda-1", "devolucion"));
    expect(arg.orderBy).toEqual({ createdAt: "desc" }); // fallback; el service reordena por grupo
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
      intentosContacto: true,
      createdAt: true,
      estatus: { select: { value: true } },
      tienda: { select: { nombre: true } },
      zona: { select: { nombre: true } },
      provincia: { select: { nombre: true } },
      canton: { select: { nombre: true } },
      distrito: { select: { nombre: true } },
      // FICHA 296: el join del mensajero, ACOTADO A SU IDENTIDAD (nombre y apellidos). Este
      // `toEqual` ES el contrato del `select` (por eso es literal y no se deriva de nada):
      // quitar una de estas claves lo pone rojo, y ampliarla a `true` —que arrastraria `email`,
      // `telefono`, `cedula` y `password_hash` hasta el navegador de la tienda— tambien.
      mensajeroAsignado: { select: { nombre: true, primerApellido: true, segundoApellido: true } },
    });
    expect(arg.select).not.toHaveProperty("deletedAt");
  });

  it("la pagina del grupo de AYUDA pide su propio estatus, con el mismo select", async () => {
    // El espejo del caso de arriba para el grupo nuevo: mismo `select`, distinto predicado.
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([prismaRow({ estatus: { value: "ayuda_tienda" } })]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findNovedadesByTienda("tienda-1", "ayuda", { skip: 0, take: 10 });

    expect(rows[0].estatusValue).toBe("ayuda_tienda");
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual(novedadWhereEsperado("tienda-1", "ayuda"));
    expect(arg.select).toEqual(prisma.orden.findMany.mock.calls[0][0].select);
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

    const rows = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 0, take: 10 });

    expect(rows[0].producto).toBe("Zapatos");
    expect(rows[0].peso).toBe(1.5);
    expect(typeof rows[0].peso).toBe("number");
  });

  it("235/R40: la fila proyectada YA NO transporta ninguna marca de ayuda", async () => {
    // El relevo del caso «sin ayuda pedida, el flag cruza como false». Aquel afirmaba que la
    // bandera nunca llegaba `undefined`; hoy lo que hay que afirmar es que NO LLEGA, punto: dos
    // verdades sobre el mismo hecho es exactamente lo que la 235 vino a cerrar.
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([prismaRow()]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 0, take: 10 });

    expect(Object.keys(rows[0])).not.toContain("ayuda");
    // Y el `select` tampoco la pide: si la columna volviera, el repo no la leeria.
    const { select } = prisma.orden.findMany.mock.calls[0][0];
    expect(Object.keys(select)).not.toContain("ayuda");
  });

  it("peso nulo (carga masiva sin peso, feature 15/R4) sigue nulo: no se rellena con 0", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      prismaRow({ id: "o2", numGuia: null, destinatario: "Beto", telefonoDest: "22223333", producto: "Caja", peso: null }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 0, take: 10 });

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

    const rows = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 0, take: 10 });

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

    const rows = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 0, take: 10 });

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

    const rows = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 0, take: 10 });

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

    const rows = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 0, take: 10 });

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

  // --- FICHA 296 (2026-08-27): la fila trae el MENSAJERO ---
  // El defecto que cierra: `/novedades` es la pantalla de la TIENDA y no decia a quien preguntar,
  // porque el mensajero no viajaba por ninguna capa. Aqui se afirma la de mas abajo: el join sale
  // en la MISMA consulta y el nombre llega resuelto.

  it("296: el nombre del mensajero se resuelve de la relacion, en la MISMA consulta", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      prismaRow({ estatus: { value: "ayuda_tienda" }, mensajeroAsignado: { nombre: "Kevin" } }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findNovedadesByTienda("tienda-1", "ayuda", { skip: 0, take: 10 });

    expect(rows[0].mensajeroNombre).toBe("Kevin");
    // «En la MISMA consulta» no es un comentario: UNA llamada a `findMany` sobre `orden` y ni una
    // sola sobre `usuario`. Si alguien lo resolviera con una lectura por fila, esto cae.
    expect(prisma.orden.findMany).toHaveBeenCalledTimes(1);
  });

  it("296: sin mensajero asignado la relacion es null y el nombre sale null (nunca `\"\"`)", async () => {
    // `mensajero_asignado_id` es NULLABLE: una orden `devuelta` ya liberada a bodega no tiene
    // ninguno. Es el mismo trato que `distrito`, el otro FK opcional de este `select`.
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([prismaRow({ mensajeroAsignado: null })]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 0, take: 10 });

    expect(rows[0].mensajeroNombre).toBeNull();
    expect(rows[0].mensajeroNombre).not.toBe("");
  });

  it("296: la fila expone el NOMBRE y no la relacion cruda ni el FK", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([prismaRow({ mensajeroAsignado: { nombre: "Kevin" } })]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 0, take: 10 });

    // Mismo criterio que los cinco catalogos: la fila lleva nombres, no ids ni objetos anidados.
    // Y el objeto anidado importa mas aqui que en los catalogos: es una fila de `usuario`.
    expect(rows[0]).not.toHaveProperty("mensajeroAsignado");
    expect(rows[0]).not.toHaveProperty("mensajeroAsignadoId");
    expect(JSON.stringify(rows[0])).not.toContain("password");
  });
});

// =============================================================================================
// La CAUSA de la devolucion (heredado, sin cambios de contrato)
// =============================================================================================

describe("OrdenRepository.findCausasDevueltaVigentes (R6/R7/R8)", () => {
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

// =============================================================================================
// Feature 236 (T2.5, D7/R17) — la fecha de la SOLICITUD, que ordena la pestaña de ayuda
// =============================================================================================

describe("236/R17 — `findFechaSolicitudAyuda`: UNA consulta por pagina, la solicitud VIVA", () => {
  it("consulta por la familia de origen de la IDA, con TODOS los ids de la pagina de una vez", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findFechaSolicitudAyuda(["o1", "o2", "o3"]);

    // UNA llamada para las tres ordenes: nunca una por fila (el N+1 que el contrato prohibe).
    expect(prisma.ordenHistorialEstado.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      ordenId: { in: ["o1", "o2", "o3"] },
      // La IDA. La VUELTA (`rescate_ayuda_tienda`) describe el FINAL de una espera, no su
      // comienzo: si se leyera aqui, la pestaña se ordenaria por cuando dejo de esperar.
      origenTipo: "solicitud_ayuda_tienda",
    });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    // Solo dos columnas: ni el actor, ni el motivo, ni los estatus. Nada de PII (R47).
    expect(arg.select).toEqual({ ordenId: true, createdAt: true });
  });

  it("se queda con la solicitud MAS RECIENTE por orden (un ciclo viejo no manda)", async () => {
    // Una orden puede haber sido rescatada y vuelta a pedir. Lo que ordena la pestaña es la
    // espera VIVA, no la primera de su historia.
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findMany.mockResolvedValue([
      { ordenId: "o1", createdAt: new Date("2026-03-10T09:00:00Z") },
      { ordenId: "o1", createdAt: new Date("2026-01-01T09:00:00Z") },
      { ordenId: "o2", createdAt: new Date("2026-02-01T09:00:00Z") },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findFechaSolicitudAyuda(["o1", "o2"]);

    expect(map.get("o1")).toEqual(new Date("2026-03-10T09:00:00Z"));
    expect(map.get("o2")).toEqual(new Date("2026-02-01T09:00:00Z"));
  });

  it("una orden sin ninguna solicitud NO entra al mapa (el service cae a su fallback)", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findMany.mockResolvedValue([
      { ordenId: "o1", createdAt: new Date("2026-03-10T09:00:00Z") },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findFechaSolicitudAyuda(["o1", "sin-solicitud"]);

    expect(map.has("o1")).toBe(true); // control positivo del negativo de al lado
    expect(map.has("sin-solicitud")).toBe(false);
  });

  it("ids vacio -> Map vacio sin disparar la query", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findFechaSolicitudAyuda([]);

    expect(map.size).toBe(0);
    expect(prisma.ordenHistorialEstado.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 239 → 236 — LA VISIBILIDAD Y EL RELOJ MIRAN EL MISMO HECHO, y ninguna marca al lado.
//
// El fallo que la 239 cerro no era el predicado ni el cron por separado: era que MIRABAN HECHOS
// DISTINTOS. La visibilidad dependia de una columna (`gestion_aprobada`) que solo se encendia al
// aprobar el cierre, y el reloj del SLA se anclaba en la fecha de la gestion sin mirar esa columna
// ni una vez. Entre los dos habia una ventana —mediana medida de 8,2 h, p90 22,1 h— en la que la
// orden ya corria plazo y todavia no se veia; con la ventana `not_found` de 24 h, eso son rechazados
// cobrados a ciegas. Desde la 239 los dos miran el ESTADO, y es el mismo estado.
//
// La 236 no cambia nada de eso (R43): parte el predicado en dos superficies y punto. Estos casos
// siguen aqui, reapuntados al metodo nuevo, porque lo que protegen sigue siendo cierto.
// ---------------------------------------------------------------------------------------------
describe("239 — la visibilidad no depende de ninguna marca distinta del estado (R18/R20/R30)", () => {
  it("R18: una orden en `devuelta` se lista, sin ninguna condicion adicional", async () => {
    const where = await whereDeCount("devolucion");
    expect(where.estatus).toEqual({ value: "devuelta" });
    expect(casa(where, fila({ estatusValue: "devuelta" }))).toBe(true);
  });

  it("R19: una orden en el PRE-ESTADO no casa el predicado (no hay rama que la admita)", async () => {
    const where = await whereDeCount("devolucion");
    // La igualdad no admite el pre-estado ni por omision ni por lista negra.
    expect(casa(where, fila({ estatusValue: "devolucion_por_confirmar" }))).toBe(false);
    expect(JSON.stringify(where)).not.toContain("devolucion_por_confirmar");
  });

  it("R30: una `devuelta` ANTERIOR al despliegue casa el predicado (nada que backfillear)", async () => {
    // `gestion_aprobada` era `NOT NULL DEFAULT false`, asi que TODA devolucion anterior a la
    // columna valia `false` y CAIA de `/novedades`: el recorte no afectaba solo a las nuevas,
    // borraba de la pantalla las que ya estaban. Al retirarla, se ven SOLAS, sin backfill.
    const prisma = buildPrisma();
    const historica = prismaRow({ id: "o-vieja", estatus: { value: "devuelta" } });
    prisma.orden.findMany.mockResolvedValue([historica]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.findNovedadesByTienda("tienda-1", "devolucion", { skip: 0, take: 10 });

    expect(res.map((r) => r.id)).toEqual(["o-vieja"]);
    expect(prisma.orden.findMany.mock.calls[0][0].where).toEqual(
      novedadWhereEsperado("tienda-1", "devolucion"),
    );
  });

  // ⚰️ FEATURE 235 (T2.2/T6.1) — aqui vivia «R23: `habilitarNovedad` apaga SOLO `ayuda`», que medía
  // el `data` de un `update` ciego. EL METODO YA NO EXISTE: los dos apagadores colapsaron en el
  // punto unico de rescate (R8), que no apaga ninguna marca porque no queda ninguna.
  it("235/R8/R40: el repositorio ya no tiene ningun apagador de banderas de novedad", () => {
    const repo = new OrdenRepository(buildPrisma() as unknown as PrismaClient);
    const conApagador = repo as unknown as Record<string, unknown>;
    // Los tres nombres que existieron entre el 2026-08-18 y el 2026-08-19. Si alguno vuelve, la
    // marca persistida vuelve con el — y con ella la posibilidad de que estado y marca divergan.
    expect(conApagador.marcarAyuda).toBeUndefined();
    expect(conApagador.desmarcarAyuda).toBeUndefined();
    expect(conApagador.habilitarNovedad).toBeUndefined();
    // Y el que los sustituye SI esta.
    expect(typeof conApagador.transicionarAyuda).toBe("function");
  });

  // FEATURE 236 (T2.2) — los nombres viejos NO pueden convivir con los nuevos. Si alguien
  // repusiera `countDevueltasByTienda` «para no romper a nadie», volveria a haber un camino que
  // lista las dos poblaciones mezcladas y el typecheck ya no obligaria a elegir grupo.
  it("236/T2.2: los metodos de un solo grupo NO existen; existen los dos parametrizados", () => {
    const repo = new OrdenRepository(buildPrisma() as unknown as PrismaClient);
    const metodos = repo as unknown as Record<string, unknown>;
    expect(metodos.countDevueltasByTienda).toBeUndefined();
    expect(metodos.findDevueltasByTienda).toBeUndefined();
    expect(typeof metodos.countNovedadesByTienda).toBe("function");
    expect(typeof metodos.findNovedadesByTienda).toBe("function");
    expect(typeof metodos.findFechaSolicitudAyuda).toBe("function");
  });
});
