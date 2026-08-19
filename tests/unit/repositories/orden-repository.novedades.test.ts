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
    // 2026-08-19 (feature 235/R30) — ⚰️ EL TAPON DE LA 239 MURIO AQUI, con su dueño. Esta rama fue
    // primero `{ ayuda: true }` a secas (la fuga permanente: una orden con el flag encendido se
    // quedaba listada PARA SIEMPRE porque el corte nocturno la barria sin apagarlo), luego
    // `{ ayuda: true, estatus: { value: "en_reparto" } }` —el tapon con dueño de la 239, que decia
    // literalmente «la ficha 235 retira el booleano y esta rama entera sobra»—, y hoy es una
    // IGUALDAD DE ESTADO como su hermana: la solicitud de ayuda ya no existe como dato separado
    // del estado, asi que no puede quedarse encendida sobre una orden que salio de el.
    { estatus: { value: "ayuda_tienda" } },
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
    // La SEGUNDA rama: la solicitud de ayuda, que desde la feature 235 es otra igualdad de estado
    // (R30/R33) — ni marcas persistidas, ni claves hermanas.
    expect(where.OR[1]).toEqual({ estatus: { value: "ayuda_tienda" } });
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
    // del estatus — y como tampoco esta en `ayuda_tienda`, no casa por la otra: sale de novedades.
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

  // Pedido humano 2026-08-18 — la fila entra por una de las DOS razones que tiene la pantalla, y
  // la tienda tiene que poder decir CUAL. Hasta el 2026-08-19 eso viajaba en un campo aparte
  // (`ayuda: boolean`); desde la feature 235 (R40) lo dice el ESTATUS, que ya viajaba.
  it("235/R30: la orden con ayuda pedida llega con `estatusValue = ayuda_tienda`", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      prismaRow({ estatus: { value: "ayuda_tienda" } }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    expect(rows[0].estatusValue).toBe("ayuda_tienda");
  });

  it("235/R40: la fila proyectada YA NO transporta ninguna marca de ayuda", async () => {
    // El relevo del caso «sin ayuda pedida, el flag cruza como false». Aquel afirmaba que la
    // bandera nunca llegaba `undefined`; hoy lo que hay que afirmar es que NO LLEGA, punto: dos
    // verdades sobre el mismo hecho es exactamente lo que la 235 vino a cerrar.
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([prismaRow()]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

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

  // =============================================================================================
  // R22 (239) → R30/R32/R33 (235) — ⚰️ EL TAPON DE LA 239, CERRADO CON SU DUEÑO.
  //
  // QUE HUBO AQUI. La rama de ayuda de `novedadWhere` nacio el 2026-08-18 como `{ ayuda: true }` a
  // secas, SIN acotar estatus: una orden con el flag encendido se quedaba en `/novedades` PARA
  // SIEMPRE, porque el corte nocturno la barria a `sin_gestionar` sin apagar el flag y nadie mas
  // lo apagaba (la fuga permanente de la auditoria §2.1). La 239 le puso la clave `estatus:
  // en_reparto` como TAPON CON DUEÑO y lo escribio en el codigo: «la ficha 235 RETIRA el booleano
  // `ayuda`; cuando entre, esta rama entera sobra».
  //
  // SOBRA. La rama es ahora una IGUALDAD DE ESTADO, igual que la de la devolucion. R32 y R33 se
  // cumplen POR CONSTRUCCION y no por una clave que alguien deba recordar: una solicitud antigua
  // ya no puede sostener la fila, porque no existe ninguna solicitud antigua que pueda quedarse
  // encendida.
  //
  // LA MUTACION QUE MATA ESTOS CASOS: cambiar la segunda igualdad a otro value (p. ej. volver a
  // `en_reparto`), o colapsar el `OR` a un `in`.
  // =============================================================================================
  it("235/R30/R33: el predicado son DOS igualdades de estado, y NADA mas", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");

    const { where } = prisma.orden.count.mock.calls[0][0];
    // Igualdad EXACTA del `OR`: si alguien anadiera una tercera rama, o le colgara una clave
    // hermana a cualquiera de las dos, esto cae. R33 pide literalmente que la visibilidad no
    // dependa de ninguna marca persistida distinta del estado.
    expect(where.OR).toEqual([
      { estatus: { value: "devuelta" } },
      { estatus: { value: "ayuda_tienda" } },
    ]);
    // Y las claves del predicado entero siguen siendo las tres de siempre.
    expect(Object.keys(where).sort()).toEqual(["OR", "deletedAt", "tiendaId"]);
  });

  it("235/R32: ninguna rama lista una orden que SALIO del estatus de ayuda", async () => {
    // El caso de negocio, enunciado como lo que la tienda ve. Se prueba sobre el PREDICADO porque
    // es lo unico que decide: este doble no ejecuta SQL. `casa` reproduce la semantica de Prisma
    // para la unica forma que este predicado usa (`OR` de igualdades de estado).
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");
    const { where } = prisma.orden.count.mock.calls[0][0];

    const casa = (estatus: string) =>
      (where.OR as Array<{ estatus: { value: string } }>).some(
        (rama) => rama.estatus.value === estatus,
      );

    // Los dos que SI se listan, cada uno por su rama.
    expect(casa("ayuda_tienda")).toBe(true);
    expect(casa("devuelta")).toBe(true);
    // Y los estados por los que pasa una orden DESPUES de salir de la ayuda. Estos cuatro eran la
    // fuga literal de la auditoria §2.1 cuando la ayuda era una bandera; hoy no pueden listarse
    // porque la orden simplemente ya no esta en el estatus.
    for (const estatus of [
      "en_reparto", // rescatada: vuelve a la calle y desaparece de la pantalla de la tienda
      "sin_gestionar", // el corte nocturno la barrio
      "en_bodega_central",
      "en_bodega_satelite",
      "entregada",
    ]) {
      expect(casa(estatus), `${estatus} NO debe listarse`).toBe(false);
    }
  });

  // R23 (239) — «HABILITAR» YA NO PUEDE ESCONDER UNA DEVOLUCION CON EL RELOJ CORRIENDO. Antes
  // apagaba `gestion_aprobada`, la fila caia del listado y la orden seguia en `devuelta`: a los 5
  // dias el cron la escalaba a `rechazada` y la cobraba, sin aviso (auditoria §2.2).
  //
  // ⚰️ FEATURE 235 (T2.2/T6.1) — aqui vivia «R23: `habilitarNovedad` apaga SOLO `ayuda`», que
  // media el `data` de aquel `update` ciego. EL METODO YA NO EXISTE: los dos apagadores colapsaron
  // en el punto unico de rescate (R8), que no apaga ninguna marca porque no queda ninguna. Lo que
  // aquel caso protegia —que «Habilitar» no pueda sacar de la pantalla una devolucion viva— lo
  // protege ahora el caso de arriba, que fija el predicado entero en DOS igualdades de estado: sin
  // marcas en el `OR`, no hay nada que apagar para esconder una fila.
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
});
