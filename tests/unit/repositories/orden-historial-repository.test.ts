import { describe, it, expect, vi, beforeEach } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import type {
  CambioEstadoEntrada,
  CriterioIntento,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 49 — tests unit del OrdenHistorialRepository (mockea Prisma, sin DB real, patron
// wallet-movimiento-repository.test.ts). Cubre R6 (choke point centralizado), R7 (escribe
// en el `tx` recibido), R24 (conteo por destino con el indice del destino), R27
// (existeActuacionDe filtra por actor), y el mapeo a DTO legible (R26).
//
// Feature 160: `contarPorDestinoVigentes` se RENOMBRO a `contarIntentosVigentes(ordenId,
// criterio)` y gano su gemelo en lote. Aqui viven los tests del predicado UNICO
// (`whereIntentosVigentes`), incluido el corte que define la feature: la reprogramacion del
// MENSAJERO (#13, `gestion`) cuenta; la de la TIENDA (#22, `reprogramacion_tienda`) no.

function buildPrisma() {
  return {
    ordenHistorialEstado: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

// Feature 160: criterio COMPLETO (las dos ramas resueltas) y criterio DEGRADADO (catalogo sin
// `reprogramada`, R6: solo la rama A).
const CRITERIO: CriterioIntento = {
  devueltaId: idEstado("devuelta"),
  reprogramadaId: idEstado("reprogramada"),
};
const CRITERIO_SOLO_DEVUELTA: CriterioIntento = {
  devueltaId: idEstado("devuelta"),
  reprogramadaId: null,
};

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO
});

describe("registrarCambioEstado (R6/R7)", () => {
  it("R7: hace createMany en el `tx` recibido (no en el prisma del constructor)", async () => {
    const prisma = buildPrisma(); // cliente de lectura del constructor
    const tx = buildPrisma(); // transaccion en curso
    tx.ordenHistorialEstado.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    await repo.registrarCambioEstado(tx as never, [
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_reparto"),
        estatusDestinoId: idEstado("entregada"),
        actorUsuarioId: "u1",
        origenTipo: "gestion",
        motivo: "cliente ausente",
        gestionOrdenId: "g1",
      },
    ]);

    // El append va al `tx`, nunca al prisma del constructor (atomicidad R7).
    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("creacion (origen null) y sistema (actor null) se persisten como null; motivo/tipo/gestion correctos", async () => {
    const tx = buildPrisma();
    tx.ordenHistorialEstado.createMany.mockResolvedValue({ count: 2 });
    const repo = new OrdenHistorialRepository(buildPrisma() as unknown as PrismaClient);

    const entradas: CambioEstadoEntrada[] = [
      {
        ordenId: "o1",
        estatusOrigenId: null, // R1/R20: creacion
        estatusDestinoId: idEstado("en_preparacion"),
        actorUsuarioId: "u-tienda",
        origenTipo: "carga_masiva",
        // sin motivo ni gestionOrdenId
      },
      {
        ordenId: "o2",
        estatusOrigenId: idEstado("reprogramada"),
        estatusDestinoId: idEstado("en_bodega_central"),
        actorUsuarioId: null, // R21: sistema/cron
        origenTipo: "liberacion_reprogramada",
      },
    ];
    await repo.registrarCambioEstado(tx as never, entradas);

    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data[0]).toEqual({
      ordenId: "o1",
      estatusOrigenId: null,
      estatusDestinoId: idEstado("en_preparacion"),
      actorUsuarioId: "u-tienda",
      origenTipo: "carga_masiva",
      motivo: null, // defaulteado a null cuando no viene
      gestionOrdenId: null,
    });
    expect(arg.data[1]).toEqual({
      ordenId: "o2",
      estatusOrigenId: idEstado("reprogramada"),
      estatusDestinoId: idEstado("en_bodega_central"),
      actorUsuarioId: null,
      origenTipo: "liberacion_reprogramada",
      motivo: null,
      gestionOrdenId: null,
    });
  });

  it("lista vacia -> no llama createMany (no-op)", async () => {
    const tx = buildPrisma();
    const repo = new OrdenHistorialRepository(buildPrisma() as unknown as PrismaClient);
    await repo.registrarCambioEstado(tx as never, []);
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("findHistorialByOrden (R26/R5)", () => {
  it("ordena cronologicamente (created_at asc), incluye value/nombre y mapea a DTO legible", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findMany.mockResolvedValue([
      {
        id: "h1",
        ordenId: "o1",
        estatusOrigenId: null,
        estatusDestinoId: idEstado("en_preparacion"),
        actorUsuarioId: "u-tienda",
        origenTipo: "carga_masiva",
        motivo: null,
        gestionOrdenId: null,
        createdAt: new Date("2026-07-13T10:00:00.000Z"),
        estatusOrigen: null, // creacion
        estatusDestino: { value: "en_preparacion" },
        actor: { nombre: "Tienda X" },
      },
      {
        id: "h2",
        ordenId: "o1",
        estatusOrigenId: idEstado("en_reparto"),
        estatusDestinoId: idEstado("devuelta"),
        actorUsuarioId: null, // sistema
        origenTipo: "gestion",
        motivo: "cliente ausente",
        gestionOrdenId: "g1",
        createdAt: new Date("2026-07-13T12:00:00.000Z"),
        estatusOrigen: { value: "en_reparto" },
        estatusDestino: { value: "devuelta" },
        actor: null,
      },
    ]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const r = await repo.findHistorialByOrden("o1");

    const arg = prisma.ordenHistorialEstado.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ ordenId: "o1" });
    expect(arg.orderBy).toEqual({ createdAt: "asc" }); // R26 cronologico
    expect(arg.include).toEqual({
      estatusOrigen: { select: { value: true } },
      estatusDestino: { select: { value: true } },
      actor: { select: { nombre: true } },
    });

    expect(r).toEqual([
      {
        estatusOrigenValue: null, // creacion (R1/R20)
        estatusDestinoValue: "en_preparacion",
        origenTipo: "carga_masiva",
        actorNombre: "Tienda X",
        motivo: null,
        createdAt: new Date("2026-07-13T10:00:00.000Z"),
      },
      {
        estatusOrigenValue: "en_reparto",
        estatusDestinoValue: "devuelta",
        origenTipo: "gestion",
        actorNombre: null, // sistema (R21)
        motivo: "cliente ausente",
        createdAt: new Date("2026-07-13T12:00:00.000Z"),
      },
    ]);
  });
});

describe("contarIntentosVigentes (49/R24 + 67/R24-R26 + 160/R1)", () => {
  it("cuenta filtrando por ordenId + los destinos del criterio (usa el indice del destino)", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.count.mockResolvedValue(3);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const n = await repo.contarIntentosVigentes("o1", CRITERIO);

    expect(n).toBe(3);
    const arg = prisma.ordenHistorialEstado.count.mock.calls[0][0];
    expect(arg.where.ordenId).toBe("o1");
  });

  // Feature 160/R1: la forma EXACTA del OR de destinos. Rama A = `devuelta` con CUALQUIER
  // origen; rama B = `reprogramada` acotada por la lista de INCLUSION. Si alguien reescribe la
  // rama B como lista NEGRA (`notIn: ["reprogramacion_tienda"]`), este test rompe — y ese es el
  // punto: una familia futura no debe empezar a contar sola.
  it("160/R1: el OR de DESTINOS es (devuelta) | (reprogramada + origen `gestion`), por INCLUSION", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.count.mockResolvedValue(0);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    await repo.contarIntentosVigentes("o1", CRITERIO);

    const where = prisma.ordenHistorialEstado.count.mock.calls[0][0].where;
    const [ramaDestinos] = where.AND as Array<{ OR: unknown[] }>;
    expect(ramaDestinos.OR).toEqual([
      { estatusDestinoId: idEstado("devuelta") },
      {
        estatusDestinoId: idEstado("reprogramada"),
        origenTipo: { in: ["gestion"] },
      },
    ]);
    // Lista de INCLUSION, no de exclusion: el `where` no puede contener un `notIn` de origenes
    // en la rama de destinos (design 160 §1.3).
    expect(JSON.stringify(ramaDestinos.OR)).not.toContain("notIn");
  });

  // Feature 160/R6: sin `reprogramada` en el catalogo, la rama B DESAPARECE del where (no se
  // emite `estatusDestinoId: null`, que casaria filas equivocadas) y la lectura no falla.
  it("160/R6: sin `reprogramada` en el catalogo, el OR de destinos trae SOLO la rama A", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.count.mockResolvedValue(0);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    await repo.contarIntentosVigentes("o1", CRITERIO_SOLO_DEVUELTA);

    const where = prisma.ordenHistorialEstado.count.mock.calls[0][0].where;
    const [ramaDestinos] = where.AND as Array<{ OR: unknown[] }>;
    expect(ramaDestinos.OR).toEqual([{ estatusDestinoId: idEstado("devuelta") }]);
  });

  // Feature 67 (F1.4-a, design §4.2): el predicado discrimina por `origen_tipo`, NO por la
  // nulidad del enlace. Este test FIJA la forma exacta del OR: si alguien lo relaja al
  // predicado ingenuo (`{ gestionOrdenId: null }` a secas), rompe.
  it("67/R24-R26: el OR de VIGENCIA es (sin-gestion FUERA de la familia gestion) | (gestion vigente)", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.count.mockResolvedValue(0);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    await repo.contarIntentosVigentes("o1", CRITERIO);

    const where = prisma.ordenHistorialEstado.count.mock.calls[0][0].where;
    const [, ramaVigencia] = where.AND as Array<{ OR: unknown[] }>;
    expect(ramaVigencia.OR).toEqual([
      // R25: nunca vino de una gestion -> cuenta. R26: la exclusion de la familia gestion es
      // lo que impide que una HUERFANA (origen `gestion` + enlace vacio) entre por esta rama.
      { gestionOrdenId: null, origenTipo: { notIn: ["gestion", "deshacer_gestion"] } },
      // R24: vino de una gestion -> cuenta solo si esa gestion NO esta anulada.
      { gestion: { anuladaAt: null } },
    ]);
    // El predicado ingenuo (nulidad del enlace a secas) NO debe aparecer: `gestion_orden_id
    // IS NULL` es AMBIGUO (design §4.1) y devolveria al conteo el intento de una gestion
    // borrada -> escalado a `rechazada` antes de tiempo -> cobroRechazado (56) mal.
    expect(ramaVigencia.OR).not.toContainEqual({ gestionOrdenId: null });
  });
});

// Feature 160/R12/R13 — el gemelo EN LOTE: UNA consulta para N ordenes, y el MISMO predicado.
describe("contarIntentosVigentesEnLote (160/R12/R13/R14)", () => {
  it("R12: con N ids emite EXACTAMENTE 1 consulta (groupBy), no una por orden", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.groupBy.mockResolvedValue([
      { ordenId: "o1", _count: { _all: 2 } },
      { ordenId: "o3", _count: { _all: 1 } },
    ]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const mapa = await repo.contarIntentosVigentesEnLote(["o1", "o2", "o3"], CRITERIO);

    expect(prisma.ordenHistorialEstado.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.ordenHistorialEstado.count).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.findMany).not.toHaveBeenCalled();
    // R14: `o2` no tiene filas -> NO aparece en el Map (el llamador aplica `?? 0`).
    expect(mapa).toEqual(new Map([["o1", 2], ["o3", 1]]));
    expect(mapa.has("o2")).toBe(false);
  });

  it("R13: `ids` vacio -> Map vacio y CERO consultas", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const mapa = await repo.contarIntentosVigentesEnLote([], CRITERIO);

    expect(mapa.size).toBe(0);
    expect(prisma.ordenHistorialEstado.groupBy).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.count).not.toHaveBeenCalled();
  });

  // R4: una sola definicion de "intento vigente". Si el lote se implementara con un `where`
  // propio, este test rompe: es la guarda contra la divergencia por copia-pega entre el numero
  // que ve la UI y el que dispara `rechazada` -> cobroRechazado (dinero).
  it("R4: el `where` del LOTE es el MISMO predicado que el individual (solo cambia `ordenId`)", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.count.mockResolvedValue(0);
    prisma.ordenHistorialEstado.groupBy.mockResolvedValue([]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    await repo.contarIntentosVigentes("o1", CRITERIO);
    await repo.contarIntentosVigentesEnLote(["o1", "o2"], CRITERIO);

    const individual = prisma.ordenHistorialEstado.count.mock.calls[0][0].where;
    const lote = prisma.ordenHistorialEstado.groupBy.mock.calls[0][0].where;
    expect(lote.AND).toEqual(individual.AND); // destinos + vigencia, identicos
    expect(individual.ordenId).toBe("o1");
    expect(lote.ordenId).toEqual({ in: ["o1", "o2"] });
    expect(prisma.ordenHistorialEstado.groupBy.mock.calls[0][0].by).toEqual(["ordenId"]);
  });
});

// Feature 67 (F1.4-a) + feature 160 — verificacion SEMANTICA del predicado: se evalua el WHERE
// que produce el repo contra filas de ejemplo (sin DB), para probar que cada caso cae del lado
// correcto. Complementa a los tests de forma de arriba: esos fijan la QUERY, este fija el
// SIGNIFICADO.
describe("whereIntentosVigentes — semantica del predicado (67/R24-R26 + 160/R1/R2/R3/R5)", () => {
  type Fila = {
    estatusDestinoId: string;
    gestionOrdenId: string | null;
    origenTipo: string;
    gestion: { anuladaAt: Date | null } | null;
  };

  // Mini-evaluador del `where` de Prisma que produce el repo (solo las ramas que usa):
  // AND de (OR de destinos) y (OR de vigencia).
  function cuentaSegunWhere(where: Record<string, unknown>, filas: Fila[]): number {
    const [ramaDestinos, ramaVigencia] = where.AND as Array<{ OR: unknown[] }>;
    const casaDestino = (f: Fila): boolean =>
      ramaDestinos.OR.some((rama) => {
        const r = rama as { estatusDestinoId: string; origenTipo?: { in: string[] } };
        if (f.estatusDestinoId !== r.estatusDestinoId) return false;
        return r.origenTipo === undefined || r.origenTipo.in.includes(f.origenTipo);
      });
    const casaVigencia = (f: Fila): boolean =>
      ramaVigencia.OR.some((rama) => {
        const r = rama as {
          gestionOrdenId?: null;
          origenTipo?: { notIn: string[] };
          gestion?: { anuladaAt: null };
        };
        if (r.gestion !== undefined) {
          // { gestion: { anuladaAt: null } }: exige gestion ENLAZADA y no anulada. Una fila con
          // el enlace vacio NO tiene gestion relacionada -> no casa.
          return f.gestion !== null && f.gestion.anuladaAt === null;
        }
        return (
          f.gestionOrdenId === null &&
          !(r.origenTipo as { notIn: string[] }).notIn.includes(f.origenTipo)
        );
      });
    return filas.filter((f) => casaDestino(f) && casaVigencia(f)).length;
  }

  async function whereDelRepo(
    criterio: CriterioIntento = CRITERIO,
  ): Promise<Record<string, unknown>> {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.count.mockResolvedValue(0);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
    await repo.contarIntentosVigentes("o1", criterio);
    return prisma.ordenHistorialEstado.count.mock.calls[0][0].where;
  }

  // Constructores de filas de ejemplo, una por arista relevante del mapa de la 140.
  const devueltaMensajero = (gestionId = "g1"): Fila => ({
    estatusDestinoId: idEstado("devuelta"),
    gestionOrdenId: gestionId,
    origenTipo: "gestion",
    gestion: { anuladaAt: null },
  });
  // #13 `en_reparto -> reprogramada` via `gestion`: el mensajero FUE y no entrego.
  const reprogramadaMensajero = (gestionId = "g2"): Fila => ({
    estatusDestinoId: idEstado("reprogramada"),
    gestionOrdenId: gestionId,
    origenTipo: "gestion",
    gestion: { anuladaAt: null },
  });
  // #22 `devuelta -> reprogramada` via `reprogramacion_tienda`: tramite de escritorio.
  const reprogramadaTienda = (gestionId = "g3"): Fila => ({
    estatusDestinoId: idEstado("reprogramada"),
    gestionOrdenId: gestionId,
    origenTipo: "reprogramacion_tienda",
    gestion: { anuladaAt: null },
  });

  it("160/R1a: la devolucion del mensajero cuenta (rama A, sin cambios)", async () => {
    expect(cuentaSegunWhere(await whereDelRepo(), [devueltaMensajero()])).toBe(1);
  });

  // EL CORAZON DE LA FEATURE (parte 1): la arista #13 es una VISITA real y hoy no contaba.
  it("160/R1b: la reprogramacion del MENSAJERO (#13, `gestion`) SI cuenta", async () => {
    expect(cuentaSegunWhere(await whereDelRepo(), [reprogramadaMensajero()])).toBe(1);
  });

  // EL CORAZON DE LA FEATURE (parte 2): la arista #22 seria DOBLE CONTEO. Si este test se pone
  // en verde por accidente (p. ej. cambiando la inclusion por una lista negra), el cron SLA
  // escala antes de tiempo y se le cobra `cobroRechazado` a la tienda sin motivo.
  it("160/R2: la reprogramacion de la TIENDA (#22, `reprogramacion_tienda`) NO cuenta", async () => {
    expect(cuentaSegunWhere(await whereDelRepo(), [reprogramadaTienda()])).toBe(0);
  });

  it("160/R2: 1 devuelta + 1 reprogramacion de la TIENDA sobre la misma orden -> 1, no 2", async () => {
    const where = await whereDelRepo();
    // Es EXACTAMENTE el escenario de `reprogramarDesdeDevuelta`: la gestion `devuelta` NO se
    // anula, asi que su fila sigue vigente y ya aporto el intento.
    expect(cuentaSegunWhere(where, [devueltaMensajero(), reprogramadaTienda()])).toBe(1);
  });

  it("160/R1: 2 reprogramaciones del mensajero + 1 devuelta -> 3 (el caso que cambia el escalado)", async () => {
    const where = await whereDelRepo();
    expect(
      cuentaSegunWhere(where, [
        reprogramadaMensajero("g-a"),
        reprogramadaMensajero("g-b"),
        devueltaMensajero("g-c"),
      ]),
    ).toBe(3);
  });

  // 160/R3: `incidente` NO cuenta, y no hace falta escribir una linea para ello: NINGUN destino
  // fuera de las dos ramas del criterio entra al conteo. El id se escribe literal porque el
  // catalogo de ESTA rama todavia no tiene `incidente` (la 154 vive en otra rama, ver bitacora):
  // el punto del test es justamente que un destino ajeno al criterio —sea cual sea— no suma.
  it("160/R3: una transicion con destino `incidente` (ajeno al criterio) no altera el conteo", async () => {
    const where = await whereDelRepo();
    const incidente: Fila = {
      estatusDestinoId: "os-incidente",
      gestionOrdenId: "g9",
      origenTipo: "gestion",
      gestion: { anuladaAt: null },
    };
    expect(cuentaSegunWhere(where, [incidente])).toBe(0);
    expect(cuentaSegunWhere(where, [devueltaMensajero(), incidente])).toBe(1);
    // Y tampoco lo hace un destino cualquiera del catalogo que no sea del criterio.
    const entregada: Fila = {
      estatusDestinoId: idEstado("entregada"),
      gestionOrdenId: "g10",
      origenTipo: "gestion",
      gestion: { anuladaAt: null },
    };
    expect(cuentaSegunWhere(where, [entregada])).toBe(0);
  });

  it("160/R6: con criterio degradado (sin `reprogramada`), la reprogramacion del mensajero no cuenta", async () => {
    const where = await whereDelRepo(CRITERIO_SOLO_DEVUELTA);
    expect(cuentaSegunWhere(where, [reprogramadaMensajero(), devueltaMensajero()])).toBe(1);
  });

  it("R25: la transicion SIN gestion de un ajuste administrativo SI cuenta (no es anulable)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [
      {
        estatusDestinoId: idEstado("devuelta"),
        gestionOrdenId: null,
        origenTipo: "ajuste_estado",
        gestion: null,
      },
    ];
    expect(cuentaSegunWhere(where, filas)).toBe(1);
  });

  it("cuenta la transicion de una gestion VIGENTE (no anulada)", async () => {
    expect(cuentaSegunWhere(await whereDelRepo(), [devueltaMensajero()])).toBe(1);
  });

  it("R24: NO cuenta la transicion de una gestion ANULADA (deshecha)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [
      {
        estatusDestinoId: idEstado("devuelta"),
        gestionOrdenId: "g1",
        origenTipo: "gestion",
        gestion: { anuladaAt: new Date("2026-07-14T10:00:00Z") },
      },
    ];
    expect(cuentaSegunWhere(where, filas)).toBe(0);
  });

  // 160/R5: la vigencia se conserva en las DOS ramas, no solo en la de `devuelta`.
  it("160/R5: la reprogramacion del mensajero de una gestion ANULADA tampoco cuenta", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [
      {
        estatusDestinoId: idEstado("reprogramada"),
        gestionOrdenId: "g2",
        origenTipo: "gestion",
        gestion: { anuladaAt: new Date("2026-07-14T10:00:00Z") },
      },
    ];
    expect(cuentaSegunWhere(where, filas)).toBe(0);
  });

  it("R26: NO cuenta la HUERFANA (origen `gestion` + enlace vacio: la gestion se borro)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [
      {
        estatusDestinoId: idEstado("devuelta"),
        gestionOrdenId: null,
        origenTipo: "gestion",
        gestion: null,
      },
    ];
    // Ante la duda, la huerfana NO cuenta: contar de menos = mas intentos que el minimo legal
    // (inofensivo); contar de mas = escalar antes de tiempo y cobrar cobroRechazado mal.
    expect(cuentaSegunWhere(where, filas)).toBe(0);
  });

  it("160/R5: tampoco cuenta la huerfana con destino `reprogramada` (misma familia)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [
      {
        estatusDestinoId: idEstado("reprogramada"),
        gestionOrdenId: null,
        origenTipo: "gestion",
        gestion: null,
      },
    ];
    expect(cuentaSegunWhere(where, filas)).toBe(0);
  });

  it("R26: tampoco cuenta la huerfana de un `deshacer_gestion` (misma familia)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [
      {
        estatusDestinoId: idEstado("devuelta"),
        gestionOrdenId: null,
        origenTipo: "deshacer_gestion",
        gestion: null,
      },
    ];
    expect(cuentaSegunWhere(where, filas)).toBe(0);
  });

  it("caso mixto: de 6 filas solo cuentan la devuelta vigente, la del ajuste y la reprogramacion del mensajero", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [
      devueltaMensajero("g1"), // vigente -> cuenta
      {
        estatusDestinoId: idEstado("devuelta"),
        gestionOrdenId: "g2",
        origenTipo: "gestion",
        gestion: { anuladaAt: new Date() },
      }, // anulada -> no
      {
        estatusDestinoId: idEstado("devuelta"),
        gestionOrdenId: null,
        origenTipo: "gestion",
        gestion: null,
      }, // huerfana -> no
      {
        estatusDestinoId: idEstado("devuelta"),
        gestionOrdenId: null,
        origenTipo: "ajuste_estado",
        gestion: null,
      }, // admin -> cuenta
      reprogramadaMensajero("g5"), // #13 -> cuenta
      reprogramadaTienda("g6"), // #22 -> NO cuenta (doble conteo)
    ];
    expect(cuentaSegunWhere(where, filas)).toBe(3);
  });
});

describe("existeActuacionDe (R27)", () => {
  it("true si hay una transicion actuada por el usuario", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findFirst.mockResolvedValue({ id: "h1" });
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const r = await repo.existeActuacionDe("o1", "m1");

    expect(r).toBe(true);
    expect(prisma.ordenHistorialEstado.findFirst).toHaveBeenCalledWith({
      where: { ordenId: "o1", actorUsuarioId: "m1" },
      select: { id: true },
    });
  });

  it("false si el usuario nunca actuo la orden", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findFirst.mockResolvedValue(null);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
    expect(await repo.existeActuacionDe("o1", "m2")).toBe(false);
  });
});
