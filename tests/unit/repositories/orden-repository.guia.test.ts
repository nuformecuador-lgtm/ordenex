import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { GenerarGuiaDecisionData } from "@/lib/interfaces/repositories/IOrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 17 — repo de "Generar guia"/asignacion de mensajero. $transaction se
// mockea ejecutando el callback con un tx fake (patron zona-repository.test.ts).
// Feature 49: el `tx` fake ademas expone `orden.findMany` (pre-lectura de origen),
// `orden.updateMany` (asignarBodegaLote envuelto) y el choke point
// `ordenHistorialEstado.createMany` para verificar el append en la misma tx.
function buildTx() {
  return {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    orden: {
      update: vi.fn(),
      updateMany: vi.fn(),
      // Feature 140: la pre-lectura del ORIGEN (feature 49/R20) modela la realidad — devuelve
      // el estado actual de cada orden consultada. Antes devolvia [] y el origen caia al
      // `?? null` defensivo, que con la guardia de fallo CERRADO seria una "creacion" ilegal.
      // Las suites que necesitan otro origen sobreescriben este mock.
      findMany: vi.fn(async (args?: { where?: { id?: { in?: string[] } } }) =>
        (args?.where?.id?.in ?? []).map((id) => ({ id, estatusId: idEstado("en_preparacion") })),
      ),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const tx = buildTx();
  const prisma = {
    orden: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    usuario: {
      findMany: vi.fn(),
    },
    orderStatus: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    ...overrides,
  };
  return { prisma, tx };
}

// Feature 49: contextos de historial (actor = el maestro) para los 3 puntos del maestro.
const HIST_GUIA = { actorUsuarioId: "maestro-1", origenTipo: "generacion_guia" } as const;
const HIST_BODEGA = { actorUsuarioId: "maestro-1", origenTipo: "asignacion_bodega" } as const;
// Feature 246 (T3.3): el dia de reparto YA RESUELTO por el servicio (convencion `@db.Date`:
// medianoche UTC de la fecha calendario CR). El repositorio no calcula fechas.
const FECHA_REPARTO = new Date("2026-08-20T00:00:00.000Z");
const HIST_RUTEO = { actorUsuarioId: "maestro-1", origenTipo: "ruteo_satelite" } as const;

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("OrdenRepository.findByIdsForTransicion (R27/R29 · feature 30/R8/R9)", () => {
  it("incluye ordenes borradas (deletedAt !== null) y mapea estatusValue/numGuia/zona", async () => {
    const { prisma } = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      {
        id: "o1",
        numGuia: null,
        deletedAt: null,
        estatus: { value: "en_preparacion" },
        zonaId: "z-gam",
        zona: { esCentral: true },
      },
      {
        id: "o2",
        numGuia: 5,
        deletedAt: new Date("2026-01-01"),
        estatus: { value: "entregada" },
        zonaId: "z-limon",
        zona: { esCentral: false },
      },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findByIdsForTransicion(["o1", "o2"]);

    // Feature 30/R8/R9: la fila de transicion suma zonaId + zonaEsGam.
    expect(rows).toEqual([
      {
        id: "o1",
        estatusValue: "en_preparacion",
        numGuia: null,
        deletedAt: null,
        zonaId: "z-gam",
        zonaEsGam: true,
      },
      {
        id: "o2",
        estatusValue: "entregada",
        numGuia: 5,
        deletedAt: new Date("2026-01-01"),
        zonaId: "z-limon",
        zonaEsGam: false,
      },
    ]);
    const arg = prisma.orden.findMany.mock.calls[0][0];
    // R29: NO filtra deletedAt — el service es quien reporta "orden borrada".
    expect(arg.where).toEqual({ id: { in: ["o1", "o2"] } });
    // Feature 30: proyecta zonaId + zona.esGam.
    expect(arg.select.zonaId).toBe(true);
    expect(arg.select.zona).toEqual({ select: { esCentral: true } });
  });

  it("devuelve vacio sin consultar cuando ids esta vacio", async () => {
    const { prisma } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findByIdsForTransicion([])).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});

// QR por guia: la recepcion satelite resuelve la orden por `num_guia` (UNIQUE).
describe("OrdenRepository.findByNumGuiaForTransicion (QR = num_guia)", () => {
  it("busca por num_guia (UNIQUE) e incluye borradas (el service decide no_encontrada)", async () => {
    const { prisma } = buildPrisma({
      orden: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    });
    const orden = prisma.orden as unknown as { findUnique: ReturnType<typeof vi.fn> };
    orden.findUnique.mockResolvedValue({
      id: "o2",
      numGuia: 5,
      deletedAt: new Date("2026-01-01"),
      estatus: { value: "entregada" },
      zonaId: "z-limon",
      zona: { esCentral: false },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const row = await repo.findByNumGuiaForTransicion(5);

    expect(row).toEqual({
      id: "o2",
      estatusValue: "entregada",
      numGuia: 5,
      deletedAt: new Date("2026-01-01"),
      zonaId: "z-limon",
      zonaEsGam: false,
    });
    const arg = orden.findUnique.mock.calls[0][0];
    // NO filtra deletedAt: el service distingue "no existe" de "borrada".
    expect(arg.where).toEqual({ numGuia: 5 });
    expect(arg.select.zona).toEqual({ select: { esCentral: true } });
  });

  it("null si ninguna orden tiene ese num_guia", async () => {
    const { prisma } = buildPrisma({
      orden: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    });
    const orden = prisma.orden as unknown as { findUnique: ReturnType<typeof vi.fn> };
    orden.findUnique.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findByNumGuiaForTransicion(999)).toBeNull();
  });
});

// QR por guia: la ruta /paquete/<numGuia> resuelve la etiqueta por `num_guia`.
describe("OrdenRepository.findEtiquetaByNumGuia (feature 32/R1/R3)", () => {
  it("R3: filtra deletedAt: null y mapea la fila de etiqueta", async () => {
    const { prisma } = buildPrisma({
      orden: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    });
    const orden = prisma.orden as unknown as { findFirst: ReturnType<typeof vi.fn> };
    orden.findFirst.mockResolvedValue({
      id: "o1",
      numGuia: 501,
      numRemision: "REM-1",
      destinatario: "Ana",
      telefonoDest: "099",
      direccion: "calle",
      producto: "caja",
      montoCobrar: null,
      createdAt: new Date("2026-08-25T15:00:00.000Z"), // feature 295
      tienda: { nombre: "T" },
      zona: { nombre: "Limon" },
      provincia: { nombre: "P" },
      canton: { nombre: "C" },
      distrito: { nombre: "D" },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const row = await repo.findEtiquetaByNumGuia(501);

    expect(row?.id).toBe("o1");
    expect(row?.numGuia).toBe(501);
    const arg = orden.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ numGuia: 501, deletedAt: null }); // R3
  });

  it("R3: null si la orden con ese num_guia esta borrada o no existe", async () => {
    const { prisma } = buildPrisma({
      orden: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    });
    const orden = prisma.orden as unknown as { findFirst: ReturnType<typeof vi.fn> };
    orden.findFirst.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findEtiquetaByNumGuia(501)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Feature 295 — la FECHA DE CREACION en la proyeccion de la etiqueta.
//
// Se prueba AQUI, en el repositorio, y no solo en el servicio: el servicio usa un
// doble del repo y con el la proyeccion es lo que el doble devuelva, asi que una
// columna que se caiga del `select` lo dejaria igual de verde. Lo que puede
// romperse en silencio es exactamente esto —que el `select` deje de pedir
// `created_at`, o que el dia se derive con `toISOString()`— y por eso son las dos
// aserciones de este bloque.
// ---------------------------------------------------------------------------

/** Fila cruda de Prisma para la proyeccion de etiqueta, con `createdAt` inyectable. */
function filaCrudaEtiqueta(createdAt: Date) {
  return {
    id: "o1",
    tiendaId: "tienda-1",
    numGuia: 501,
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle",
    producto: "caja",
    montoCobrar: null,
    createdAt,
    tienda: { nombre: "T" },
    zona: { nombre: "Limon" },
    provincia: { nombre: "P" },
    canton: { nombre: "C" },
    distrito: { nombre: "D" },
  };
}

describe("OrdenRepository — la etiqueta proyecta la fecha de creacion (feature 295)", () => {
  it("el SELECT de la etiqueta PIDE `createdAt`, por las dos vias (id y num_guia)", async () => {
    const { prisma } = buildPrisma({
      orden: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    });
    const orden = prisma.orden as unknown as {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    const fila = filaCrudaEtiqueta(new Date("2026-08-25T15:00:00.000Z"));
    orden.findFirst.mockResolvedValue(fila);
    orden.findMany.mockResolvedValue([fila]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findEtiquetaByNumGuia(501);
    await repo.findEtiquetasByIds(["o1"]);

    // Sin esta columna en la proyeccion el dato NO EXISTE en el camino al PDF: es
    // el estado exacto que la ficha 295 vino a arreglar.
    expect(orden.findFirst.mock.calls[0][0].select.createdAt).toBe(true);
    expect(orden.findMany.mock.calls[0][0].select.createdAt).toBe(true);
  });

  it("la sirve como fecha CALENDARIO de Costa Rica, no como el dia UTC", async () => {
    const { prisma } = buildPrisma({
      orden: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    });
    const orden = prisma.orden as unknown as { findFirst: ReturnType<typeof vi.fn> };
    // 20:00 del 25 en Costa Rica (UTC-6) es ya el 26 en UTC. `toISOString().slice(0,10)`
    // imprimiria "2026-08-26": la etiqueta diria MAÑANA. Ese off-by-one es el motivo
    // de que la conversion sea `fechaCalendarioCR`.
    orden.findFirst.mockResolvedValue(
      filaCrudaEtiqueta(new Date("2026-08-26T02:00:00.000Z")),
    );
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const row = await repo.findEtiquetaByNumGuia(501);

    expect(row?.fechaCreacion).toBe("2026-08-25");
    expect(row?.fechaCreacion).not.toBe(
      new Date("2026-08-26T02:00:00.000Z").toISOString().slice(0, 10),
    );
  });

  it("`findEtiquetasByIds` la sirve con la misma convencion (una sola derivacion)", async () => {
    const { prisma } = buildPrisma({
      orden: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    });
    const orden = prisma.orden as unknown as { findMany: ReturnType<typeof vi.fn> };
    orden.findMany.mockResolvedValue([
      filaCrudaEtiqueta(new Date("2026-08-26T02:00:00.000Z")),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findEtiquetasByIds(["o1"]);

    expect(rows).toHaveLength(1);
    expect(rows[0].fechaCreacion).toBe("2026-08-25");
  });
});

describe("OrdenRepository.findMensajeroIdsValidos (R28)", () => {
  it("filtra por rol mensajero, sin filtro de zona", async () => {
    const { prisma } = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([{ id: "m1" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const set = await repo.findMensajeroIdsValidos(["m1", "no-mensajero"]);

    expect(set.has("m1")).toBe(true);
    expect(set.has("no-mensajero")).toBe(false);
    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ["m1", "no-mensajero"] }, rol: { value: "mensajero" } });
    expect(arg.where).not.toHaveProperty("zonaId");
  });
});

describe("OrdenRepository.findAllMensajeros (R28/T15)", () => {
  it("devuelve TODOS los usuarios rol mensajero, sin filtro de zona", async () => {
    const { prisma } = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([
      { id: "m1", nombre: "Ana" },
      { id: "m2", nombre: "Beto" },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const mensajeros = await repo.findAllMensajeros();

    expect(mensajeros).toEqual([
      { id: "m1", nombre: "Ana" },
      { id: "m2", nombre: "Beto" },
    ]);
    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ rol: { value: "mensajero" } });
    expect(arg.where).not.toHaveProperty("zonaId");
  });
});

describe("OrdenRepository.findMensajerosByZona (feature 30/R5)", () => {
  it("filtra por rol mensajero Y zonaId = gamZonaId (excluye otras zonas y zonaId NULL)", async () => {
    const { prisma } = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([{ id: "m1", nombre: "Ana" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const mensajeros = await repo.findMensajerosByZona("z-gam");

    expect(mensajeros).toEqual([{ id: "m1", nombre: "Ana" }]);
    const arg = prisma.usuario.findMany.mock.calls[0][0];
    // R5: el filtro exige rol mensajero Y la zona GAM; sin zona (NULL) o de otra
    // zona no matchea la igualdad zonaId = gamZonaId.
    expect(arg.where).toEqual({ rol: { value: "mensajero" }, zonaId: "z-gam" });
    expect(arg.orderBy).toEqual({ nombre: "asc" });
  });
});

describe("OrdenRepository.findMensajeroIdsValidosByZona (feature 30/R6)", () => {
  it("subconjunto con rol mensajero Y zonaId = gamZonaId; excluye otras zonas/NULL", async () => {
    const { prisma } = buildPrisma();
    // La DB solo devuelve el mensajero GAM; m-otra-zona y m-sin-zona no matchean.
    prisma.usuario.findMany.mockResolvedValue([{ id: "m-gam" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const set = await repo.findMensajeroIdsValidosByZona(
      ["m-gam", "m-otra-zona", "m-sin-zona"],
      "z-gam",
    );

    expect(set.has("m-gam")).toBe(true);
    expect(set.has("m-otra-zona")).toBe(false);
    expect(set.has("m-sin-zona")).toBe(false);
    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      id: { in: ["m-gam", "m-otra-zona", "m-sin-zona"] },
      rol: { value: "mensajero" },
      zonaId: "z-gam",
    });
  });

  it("devuelve vacio sin consultar cuando ids esta vacio", async () => {
    const { prisma } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect((await repo.findMensajeroIdsValidosByZona([], "z-gam")).size).toBe(0);
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.rutearBodegaSateliteLote (feature 30/R10/R13)", () => {
  // Feature 156/R15: el origen de las filas pasa de `en_preparacion` a `en_bodega_central`.
  // `rutearABodegaSatelite` ya solo admite ese origen y la arista #7c se retiro del grafo,
  // asi que la guardia de fallo CERRADO del choke point rechazaba el fixture viejo. Lo que
  // se prueba (idempotencia de num_guia + estatus + mensajero NULL) no cambia.
  it("num_guia idempotente (WHERE num_guia IS NULL, secuencia constante) + estatus + mensajero NULL", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", estatusId: idEstado("en_bodega_central") },
      { id: "o2", estatusId: idEstado("en_bodega_central") },
    ]);
    tx.orden.update.mockResolvedValue({ id: "o1" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.rutearBodegaSateliteLote(["o1", "o2"], idEstado("en_ruta_bodega_satelite"), HIST_RUTEO);

    expect(count).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // R10: una asignacion de guia idempotente por orden.
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    const [sql, ordenId] = tx.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain("num_guia IS NULL");
    expect(sql).toContain("siguiente_num_guia()");
    // La guia NO debe salir de la secuencia en crudo: se imprime en la etiqueta
    // y viaja en el QR, asi que un contador visible filtra volumen de operacion
    // (migracion 20260720170000). Volver a `nextval(...)` directo aqui es
    // exactamente la regresion que este caso vigila.
    expect(sql).not.toContain("nextval");
    expect(ordenId).toBe("o1");
    // R9: fija estatus y deja mensajeroAsignadoId NULL. Feature 76/LC1 (C2): limpia asignado_at.
    // Feature 246 (T3.5, R9/R10): y limpia tambien `fechaReparto`, en la MISMA escritura. La orden
    // vuelve a bodega sin mensajero, asi que no puede conservar una reserva huerfana.
    expect(tx.orden.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: {
        estatusId: idEstado("en_ruta_bodega_satelite"),
        mensajeroAsignadoId: null,
        asignadoAt: null,
        fechaReparto: null,
      },
    });
  });

  // Feature 49/#5 (R13/R7): 1 historial por orden ruteada (origen leido -> en_ruta_bodega_satelite).
  // Feature 156/R15: idem — las dos filas vienen ya de `en_bodega_central` (unico origen
  // admitido). Lo que sigue verificandose es que el origen se LEE por orden dentro de la tx
  // y viaja al historial, no que se hardcodee.
  it("R13: registra historial por orden con origen pre-leido y tipo ruteo_satelite", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", estatusId: idEstado("en_bodega_central") },
      { id: "o2", estatusId: idEstado("en_bodega_central") },
    ]);
    tx.orden.update.mockResolvedValue({ id: "o1" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.rutearBodegaSateliteLote(["o1", "o2"], idEstado("en_ruta_bodega_satelite"), HIST_RUTEO);

    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_bodega_central"),
        estatusDestinoId: idEstado("en_ruta_bodega_satelite"),
        actorUsuarioId: "maestro-1",
        origenTipo: "ruteo_satelite",
        motivo: null,
        gestionOrdenId: null,
      },
      {
        ordenId: "o2",
        estatusOrigenId: idEstado("en_bodega_central"),
        estatusDestinoId: idEstado("en_ruta_bodega_satelite"),
        actorUsuarioId: "maestro-1",
        origenTipo: "ruteo_satelite",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  // Feature 156 (review, menor 1): el caso de arriba dejo de distinguir "lee el origen de CADA
  // orden" de "lee el de la primera" — tras retirar #7c el unico origen legal hacia
  // `en_ruta_bodega_satelite` es `en_bodega_central`, asi que ambas filas comparten origen.
  // Este caso recupera ese grado de libertad SIN apoyarse en #7b (la arista que retira la 155):
  // si la pre-lectura no devuelve `o2`, su origen tiene que caer a `null` — la rama
  // `origenById.get(id) ?? null` — y la guardia de fallo CERRADO lo rechaza como "creacion"
  // ilegal. Un repo que reusara `origenRows[0]` para todo el lote NO lanzaria y este caso lo
  // delata. (Por eso no basta con quitar `o2` del fixture del caso anterior: ahi la guardia
  // corre de verdad y el append nunca llegaria a `createMany`.)
  it("R13: el origen se resuelve POR ORDEN — la que no aparece en la pre-lectura cae a null y la guardia la rechaza", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", estatusId: idEstado("en_bodega_central") },
    ]);
    tx.orden.update.mockResolvedValue({ id: "o1" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.rutearBodegaSateliteLote(["o1", "o2"], idEstado("en_ruta_bodega_satelite"), HIST_RUTEO),
    ).rejects.toThrow(/creacion -> en_ruta_bodega_satelite/);

    // R7: la guardia corre ANTES del append, asi que no queda historial parcial del lote.
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("devuelve 0 sin abrir transaccion cuando el lote esta vacio", async () => {
    const { prisma } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.rutearBodegaSateliteLote([], idEstado("en_ruta_bodega_satelite"), HIST_RUTEO)).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.listOrderStatus (R15/R16)", () => {
  it("devuelve el catalogo completo con id y value", async () => {
    const { prisma } = buildPrisma({
      orderStatus: {
        findMany: vi.fn().mockResolvedValue([
          { id: "os-1", value: "por_recolectar_en_tienda" },
          { id: "os-2", value: "en_preparacion" },
        ]),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const estatus = await repo.listOrderStatus();

    expect(estatus).toEqual([
      { id: "os-1", value: "por_recolectar_en_tienda" },
      { id: "os-2", value: "en_preparacion" },
    ]);
    const arg = prisma.orderStatus.findMany.mock.calls[0][0];
    expect(arg.select).toEqual({ id: true, value: true });
  });

  it("feature 63/R5: incluye orderBy determinista (value asc) para tabs estables", async () => {
    const { prisma } = buildPrisma({
      orderStatus: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.listOrderStatus();

    const arg = prisma.orderStatus.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual({ value: "asc" });
  });
});

describe("OrdenRepository.generarGuiaLote (R5/R19/R25)", () => {
  // Feature 156: la decision por defecto pasa a ser la UNICA que el service produce hoy —
  // destino `en_bodega_central` y `mensajeroAsignadoId: null`. Antes era `por_recoger` + un
  // mensajero, que combinado con el origen del `tx` fake (`en_preparacion`) es la arista #4,
  // retirada por esta feature: la guardia de fallo CERRADO del choke point la rechaza.
  // El PARAMETRO `mensajeroAsignadoId` NO se retira del repo (design §6, alternativa E): queda
  // MUERTO —ningun productor lo rellena— y se limpia con el barrido de la 159. Los casos que
  // lo ejercitan siguen abajo, sobre pares que el grafo si declara.
  function decision(overrides: Partial<GenerarGuiaDecisionData> = {}): GenerarGuiaDecisionData {
    return {
      ordenId: "o1",
      estatusId: idEstado("en_bodega_central"),
      mensajeroAsignadoId: null,
      ...overrides,
    };
  }

  it("ejecuta TODO el lote dentro de una sola $transaction", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.update.mockResolvedValue({ numGuia: 10 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.generarGuiaLote(
      [decision({ ordenId: "o1" }), decision({ ordenId: "o2" })],
      HIST_GUIA,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(tx.orden.update).toHaveBeenCalledTimes(2);
  });

  it("el UPDATE crudo filtra WHERE num_guia IS NULL y usa la secuencia constante (R5/R3)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.update.mockResolvedValue({ numGuia: 10 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.generarGuiaLote([decision({ ordenId: "o1" })], HIST_GUIA);

    const [sql, ordenId] = tx.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain("num_guia IS NULL");
    expect(sql).toContain("siguiente_num_guia()");
    expect(ordenId).toBe("o1");
  });

  // Feature 76/R23 (W1) — el estampado de `asignado_at` cuando la decision trae mensajero.
  // Feature 156: ya ningun productor pasa por aqui con mensajero (el parametro queda muerto
  // hasta la 159), pero el comportamiento del repo se conserva y se sigue verificando. El
  // origen del `tx` se fija a `en_bodega_central` para que el par (origen, destino) sea uno
  // que el grafo declara (#8) y no la arista #4 que esta feature retiro.
  it("fija estatusId y mensajeroAsignadoId (con mensajero -> por_recoger, R21/R22)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([{ id: "o1", estatusId: idEstado("en_bodega_central") }]);
    tx.orden.update.mockResolvedValue({ numGuia: 7 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const resultados = await repo.generarGuiaLote(
      [decision({ ordenId: "o1", estatusId: idEstado("por_recoger"), mensajeroAsignadoId: "m1" })],
      HIST_GUIA,
    );

    // Feature 76/R23 (W1): con mensajero no nulo estampa asignado_at = now.
    // Feature 246 (T3.5, R8/R10): junto a `asignadoAt` va SIEMPRE `fechaReparto`. Esta via NO
    // ofrece la eleccion de dia, asi que estampa el dia de Costa Rica EN CURSO. La igualdad es
    // EXACTA a proposito: es la invariante «las dos columnas se escriben juntas», y esta rama es
    // justo la que la guardia `fecha-reparto-acompana-asignado-at` encontro y el spec no listaba.
    expect(tx.orden.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: {
        estatusId: idEstado("por_recoger"),
        mensajeroAsignadoId: "m1",
        asignadoAt: expect.any(Date),
        fechaReparto: expect.any(Date),
      },
      select: { numGuia: true },
    });
    expect(resultados).toEqual([{ ordenId: "o1", numGuia: 7 }]);
  });

  it("sin mensajero -> mensajeroAsignadoId NULL, estatus en_bodega_central, igual recibe num_guia (R23/R19)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.update.mockResolvedValue({ numGuia: 8 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const resultados = await repo.generarGuiaLote(
      [decision({ ordenId: "o2", estatusId: idEstado("en_bodega_central"), mensajeroAsignadoId: null })],
      HIST_GUIA,
    );

    // Feature 76/R23 (W1): SIN mensajero (null) NO estampa asignado_at (queda ausente).
    expect(tx.orden.update).toHaveBeenCalledWith({
      where: { id: "o2" },
      data: { estatusId: idEstado("en_bodega_central"), mensajeroAsignadoId: null },
      select: { numGuia: true },
    });
    const dataSinMensajero = tx.orden.update.mock.calls.at(-1)![0].data;
    expect(dataSinMensajero).not.toHaveProperty("asignadoAt");
    expect(resultados).toEqual([{ ordenId: "o2", numGuia: 8 }]);
  });

  // Feature 156: el lote sigue siendo heterogeneo (destinos y mensajeros distintos por
  // orden), pero cada fila usa un par que el grafo declara: o1 `en_bodega_central ->
  // por_recoger` (#8) y o2 `en_preparacion -> en_bodega_central` (#5).
  it("lote mixto (con y sin mensajero) en una sola llamada produce todos los resultados (R24)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", estatusId: idEstado("en_bodega_central") },
      { id: "o2", estatusId: idEstado("en_preparacion") },
    ]);
    tx.orden.update
      .mockResolvedValueOnce({ numGuia: 1 })
      .mockResolvedValueOnce({ numGuia: 2 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const resultados = await repo.generarGuiaLote(
      [
        decision({ ordenId: "o1", estatusId: idEstado("por_recoger"), mensajeroAsignadoId: "m1" }),
        decision({ ordenId: "o2", mensajeroAsignadoId: null, estatusId: idEstado("en_bodega_central") }),
      ],
      HIST_GUIA,
    );

    expect(resultados).toEqual([
      { ordenId: "o1", numGuia: 1 },
      { ordenId: "o2", numGuia: 2 },
    ]);
  });

  // Feature 49/#3 (R11/R7/R8): lote mixto deja historial con el destino REAL por orden
  // (por_recoger / en_bodega_central) y el origen pre-leido; en la misma tx.
  // Feature 156: los origenes pasan de dos iguales a `en_bodega_central` (#8) y
  // `en_preparacion` (#5). Ademas de usar pares vivos, el caso GANA discriminacion: ahora
  // las dos filas difieren TANTO en origen como en destino, asi que un repo que hardcodease
  // cualquiera de los dos lados fallaria aqui.
  it("R11: registra historial con destino real por orden y origen pre-leido", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", estatusId: idEstado("en_bodega_central") },
      { id: "o2", estatusId: idEstado("en_preparacion") },
    ]);
    tx.orden.update
      .mockResolvedValueOnce({ numGuia: 1 })
      .mockResolvedValueOnce({ numGuia: 2 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.generarGuiaLote(
      [
        decision({ ordenId: "o1", estatusId: idEstado("por_recoger"), mensajeroAsignadoId: "m1" }),
        decision({ ordenId: "o2", estatusId: idEstado("en_bodega_central"), mensajeroAsignadoId: null }),
      ],
      HIST_GUIA,
    );

    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_bodega_central"),
        estatusDestinoId: idEstado("por_recoger"),
        actorUsuarioId: "maestro-1",
        origenTipo: "generacion_guia",
        motivo: null,
        gestionOrdenId: null,
      },
      {
        ordenId: "o2",
        estatusOrigenId: idEstado("en_preparacion"),
        estatusDestinoId: idEstado("en_bodega_central"),
        actorUsuarioId: "maestro-1",
        origenTipo: "generacion_guia",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("lanza si num_guia queda NULL tras el UPDATE (guarda defensiva)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.update.mockResolvedValue({ numGuia: null });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(repo.generarGuiaLote([decision()], HIST_GUIA)).rejects.toThrow(/num_guia/);
  });

  it("devuelve vacio sin abrir transaccion cuando el lote esta vacio", async () => {
    const { prisma } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.generarGuiaLote([], HIST_GUIA)).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.asignarBodegaLote (R26 · feature 49/#4)", () => {
  it("actualiza mensajeroAsignadoId/estatusId en lote SIN tocar numGuia (dentro de $transaction)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", estatusId: idEstado("en_bodega_central") },
      { id: "o2", estatusId: idEstado("en_bodega_central") },
    ]);
    tx.orden.updateMany.mockResolvedValue({ count: 2 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarBodegaLote(
      ["o1", "o2"],
      "m1",
      idEstado("por_recoger"),
      HIST_BODEGA,
      FECHA_REPARTO,
    );

    expect(count).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const arg = tx.orden.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ["o1", "o2"] } });
    // Feature 76/R23 (W2): asignacion de bodega siempre estampa asignado_at = now.
    // Feature 101/R5 (gate F1.4-Q1): la reasignacion desde bodega central apaga prioridad: false.
    // Feature 246 (T3.3, R7): `fechaReparto` va en la MISMA `data` que `asignadoAt`. Igualdad
    // EXACTA a proposito: si se cayera del cableado, el lote quedaria con mensajero y sin dia
    // —indistinguible de una orden anterior a la feature— y el corte de esa noche se lo llevaria.
    expect(arg.data).toEqual({
      mensajeroAsignadoId: "m1",
      estatusId: idEstado("por_recoger"),
      asignadoAt: expect.any(Date),
      fechaReparto: FECHA_REPARTO,
      prioridad: false, // feature 101/R5
    });
    expect(arg.data).not.toHaveProperty("numGuia");
  });

  // Feature 49/#4 (R12/R8): 1 historial por orden afectada (origen pre-leido -> destino).
  it("R12: registra historial (asignacion_bodega) solo de las filas afectadas", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([{ id: "o1", estatusId: idEstado("en_bodega_central") }]);
    tx.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.asignarBodegaLote(["o1"], "m1", idEstado("por_recoger"), HIST_BODEGA, FECHA_REPARTO);

    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_bodega_central"),
        estatusDestinoId: idEstado("por_recoger"),
        actorUsuarioId: "maestro-1",
        origenTipo: "asignacion_bodega",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("devuelve 0 sin abrir transaccion cuando ordenIds esta vacio", async () => {
    const { prisma, tx } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(
      await repo.asignarBodegaLote([], "m1", idEstado("por_recoger"), HIST_BODEGA, FECHA_REPARTO),
    ).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
  });
});
