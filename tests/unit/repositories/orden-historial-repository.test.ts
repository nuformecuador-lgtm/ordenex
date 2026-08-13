import { describe, it, expect, vi, beforeEach } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
import {
  prismaGestionSobreFilas,
  type FilaGestionFake,
} from "@/tests/fixtures/intentos-entrega";

// Feature 49 — tests unit del OrdenHistorialRepository (mockea Prisma, sin DB real, patron
// wallet-movimiento-repository.test.ts). Cubre R6 (choke point centralizado), R7 (escribe
// en el `tx` recibido), R27 (existeActuacionDe filtra por actor), y el mapeo a DTO legible (R26).
//
// Feature 215: el conteo de intentos deja de derivarse del historial y pasa a derivarse de
// `gestion_orden` con el cierre APROBADO. Aqui viven los tests del predicado UNICO
// (`whereIntentosVigentes`) con su criterio nuevo: resultado contable + gestion vigente +
// cierre `aprobado`, contando CIERRES DISTINTOS y no gestiones.

function buildPrisma() {
  return {
    ordenHistorialEstado: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      findFirst: vi.fn(),
    },
    gestionOrden: {
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

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

// Feature 215 (T8) — helpers de las suites del conteo.

/**
 * Fila de gestion CONTABLE por defecto: resultado `devuelta`, vigente, en cierre aprobado y —
 * feature 215/T21 — nacida de una VISITA REAL del mensajero (`origen_tipo = 'gestion'`). Los
 * casos que prueban el discriminador de las sinteticas sobrescriben `origenTiposHistorial`.
 */
function gestion(over: Partial<FilaGestionFake> = {}): FilaGestionFake {
  return {
    ordenId: "o1",
    resultado: "devuelta",
    anuladaAt: null,
    cierreId: "c1",
    cierreEstado: "aprobado",
    origenTiposHistorial: ["gestion"],
    ...over,
  };
}

/** Repo REAL montado sobre el doble que evalua el predicado contra `filas`. */
function repoSobre(filas: FilaGestionFake[]) {
  const prisma = prismaGestionSobreFilas(filas);
  return {
    prisma,
    repo: new OrdenHistorialRepository(prisma as unknown as PrismaClient),
  };
}

/** El `where` que el repo emite en la lectura INDIVIDUAL. */
async function whereIndividual(): Promise<Record<string, unknown>> {
  const prisma = buildPrisma();
  prisma.gestionOrden.groupBy.mockResolvedValue([]);
  const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
  await repo.contarIntentosVigentes("o1");
  return prisma.gestionOrden.groupBy.mock.calls[0][0].where;
}

describe("contarIntentosVigentes — el criterio NUEVO (215/R1/R2/R3/R5/R8/R29/R30/R31/R33)", () => {
  it("consulta `gestion_orden` acotando por ordenId (usa @@index([ordenId]))", async () => {
    const where = await whereIndividual();
    expect(where.ordenId).toBe("o1");
  });

  // R1: los TRES resultados que cuentan. `rechazada` es NUEVO — con el criterio viejo no
  // contaba por ninguna via (su destino no era `devuelta` ni `reprogramada`).
  it.each(["devuelta", "reprogramada", "rechazada"] as const)(
    "R1: el resultado `%s` en un cierre APROBADO cuenta como intento",
    async (resultado) => {
      const { repo } = repoSobre([gestion({ resultado })]);
      expect(await repo.contarIntentosVigentes("o1")).toBe(1);
    },
  );

  // R2: la entrega lograda no es un intento fallido, y el incidente es un desenlace propio.
  it.each(["entregada", "incidente"] as const)(
    "R2: el resultado `%s` NO cuenta, ni con el cierre aprobado",
    async (resultado) => {
      const { repo } = repoSobre([gestion({ resultado })]);
      expect(await repo.contarIntentosVigentes("o1")).toBe(0);
    },
  );

  // R3 — EL CORAZON DE LA FEATURE: el instante que suma es la APROBACION del cierre. Mientras
  // el cierre no este `aprobado`, la gestion NO aporta nada, aunque ya sea inmutable.
  it("R3: cierre `aprobado` -> cuenta", async () => {
    const { repo } = repoSobre([gestion({ cierreEstado: "aprobado" })]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(1);
  });

  it.each(["solicitado", "vencido", "rechazado"] as const)(
    "R3: cierre en `%s` -> NO cuenta (solo la aprobacion suma)",
    async (estado) => {
      const { repo } = repoSobre([gestion({ cierreEstado: estado })]);
      expect(await repo.contarIntentosVigentes("o1")).toBe(0);
    },
  );

  it("R3: gestion del dia AUN SIN CERRAR (`cierre_id` NULL) -> NO cuenta", async () => {
    const { repo } = repoSobre([gestion({ cierreId: null, cierreEstado: null })]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(0);
  });

  // R5: la vigencia se conserva. La exclusion es un filtro de LECTURA — el `where` no lleva
  // ningun update/delete detras y el doble solo expone lecturas.
  it("R5: una gestion ANULADA no cuenta, y la exclusion es un filtro de LECTURA", async () => {
    const { repo, prisma } = repoSobre([
      gestion({ anuladaAt: new Date("2026-08-01T10:00:00.000Z") }),
    ]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(0);
    const where = await whereIndividual();
    expect(where.anuladaAt).toBeNull();
    // No hay escritura: el doble de `gestionOrden` no expone update/delete que llamar.
    expect("update" in prisma.gestionOrden).toBe(false);
    expect("updateMany" in prisma.gestionOrden).toBe(false);
    expect("delete" in prisma.gestionOrden).toBe(false);
  });

  // R29 (D9) — GRANO POR ORDEN. Dos gestiones vigentes contables de la MISMA orden dentro del
  // MISMO cierre aprobado suman 1. Si alguien cambiara el `groupBy` por un `count()`, aqui
  // saldria 2: el cron escalaria antes de tiempo y se cobraria `cobroRechazado` (56) de mas.
  it("R29: DOS gestiones vigentes contables en el MISMO cierre aprobado -> 1, no 2", async () => {
    const { repo } = repoSobre([
      gestion({ resultado: "devuelta", cierreId: "c1" }),
      gestion({ resultado: "reprogramada", cierreId: "c1" }),
    ]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(1);
  });

  it('R29: el `by` del individual es ["cierreId"] (cuenta CIERRES, no gestiones)', async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.groupBy.mockResolvedValue([]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
    await repo.contarIntentosVigentes("o1");
    expect(prisma.gestionOrden.groupBy.mock.calls[0][0].by).toEqual(["cierreId"]);
    // Y no se cuela un `count()` por la puerta de atras (contaria gestiones).
    expect(prisma.gestionOrden.count).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
  });

  // R30 (D10) — ACUMULACION. Sin ella ninguna orden alcanzaria el umbral y el escalado
  // quedaria muerto.
  it("R30: 3 cierres aprobados distintos con resultado contable -> 3", async () => {
    const { repo } = repoSobre([
      gestion({ cierreId: "c1", resultado: "devuelta" }),
      gestion({ cierreId: "c2", resultado: "reprogramada" }),
      gestion({ cierreId: "c3", resultado: "rechazada" }),
    ]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(3);
  });

  // R31 (D11) — el conteo mide el HECHO, no donde esta la orden ahora.
  it("R31: el `where` no menciona el estado ACTUAL de la orden", async () => {
    const where = await whereIndividual();
    const json = JSON.stringify(where);
    expect(json).not.toContain("estatusId");
    expect(json).not.toContain("estatus_id");
    expect(json).not.toContain("estatusDestinoId");
    expect(where).not.toHaveProperty("orden");
  });

  it("R31: el resultado cuenta aunque la orden ya haya cambiado de estado despues", async () => {
    // La fila de gestion es la MISMA se haya reprogramado la tienda (#22), liberado el cron SLA
    // (#19/#20) o recuperado bodega a mano (#23/#24): el predicado no mira la orden.
    const { repo } = repoSobre([gestion({ resultado: "devuelta", cierreId: "c1" })]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(1);
  });

  // R32 (D12) — MONOTONIA. Lo que la anulacion impide es que el numero LLEGUE A SUBIR; nunca
  // lo hace bajar. Dos lecturas separadas por un evento: la segunda es >= la primera.
  it("R32: anadir una gestion ANULADA no hace bajar el conteo (no sube, no baja)", async () => {
    const antes = repoSobre([gestion({ cierreId: "c1" })]);
    const n1 = await antes.repo.contarIntentosVigentes("o1");
    const despues = repoSobre([
      gestion({ cierreId: "c1" }),
      gestion({ cierreId: "c2", anuladaAt: new Date("2026-08-02T10:00:00.000Z") }),
    ]);
    const n2 = await despues.repo.contarIntentosVigentes("o1");
    expect(n1).toBe(1);
    expect(n2).toBeGreaterThanOrEqual(n1);
    expect(n2).toBe(1);
  });

  it("R32: cuando el cierre pasa de `solicitado` a `aprobado`, el conteo SUBE (nunca baja)", async () => {
    const antes = repoSobre([gestion({ cierreId: "c1", cierreEstado: "solicitado" })]);
    const n1 = await antes.repo.contarIntentosVigentes("o1");
    const despues = repoSobre([gestion({ cierreId: "c1", cierreEstado: "aprobado" })]);
    const n2 = await despues.repo.contarIntentosVigentes("o1");
    expect(n1).toBe(0);
    expect(n2).toBeGreaterThanOrEqual(n1);
    expect(n2).toBe(1);
  });

  // R8: `0` explicito, no ausencia de dato ni error.
  it("R8: orden sin gestiones contables -> 0", async () => {
    const { repo } = repoSobre([gestion({ resultado: "entregada" })]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(0);
  });

  // R33 (D6) — la LIMITACION declarada de la feature: una orden cortada por el cron pasa a
  // `sin_gestionar` SIN fila de `gestion_orden`, asi que no tiene resultado y cuenta 0. El
  // agujero original (sale, se corta, vuelve a bodega y sale otra vez con el mismo contador)
  // SIGUE ABIERTO tras esta feature, y es deliberado.
  it("R33: una orden cortada por el cron (sin ninguna gestion) -> 0", async () => {
    const { repo } = repoSobre([]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(0);
  });

  // Es el caso que PROTEGE EL DINERO, heredado del proposito del test viejo de la rama B: la
  // lista de resultados es de INCLUSION. Con una lista negra, un `resultado` FUTURO del enum
  // empezaria a contar solo, adelantaria el escalado y cobraria `cobroRechazado` (56) antes de
  // tiempo, en silencio.
  it("INCLUSION: el filtro de resultados usa `in` y NO contiene ningun `notIn`", async () => {
    const where = await whereIndividual();
    expect(where.resultado).toEqual({
      in: ["rechazada", "devuelta", "reprogramada"],
    });
    expect(JSON.stringify(where)).not.toContain("notIn");
  });

  it("el `where` exige cierre no nulo Y cierre APROBADO (las dos condiciones)", async () => {
    const where = await whereIndividual();
    expect(where.cierreId).toEqual({ not: null });
    expect(where.cierre).toEqual({ estado: "aprobado" });
  });
});

describe("contarIntentosVigentesEnLote (215/R4/R7/R8/R29/R30)", () => {
  it("R7: con N ids emite EXACTAMENTE 1 consulta (groupBy) y CERO count/findMany", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.groupBy.mockResolvedValue([
      { ordenId: "o1", cierreId: "c1" },
      { ordenId: "o1", cierreId: "c2" },
      { ordenId: "o3", cierreId: "c1" },
    ]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const mapa = await repo.contarIntentosVigentesEnLote(["o1", "o2", "o3"]);

    expect(prisma.gestionOrden.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.gestionOrden.count).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
    // R30: `o1` aparece en 2 cierres aprobados -> 2.
    expect(mapa).toEqual(new Map([["o1", 2], ["o3", 1]]));
    // R8: `o2` no tiene filas -> NO aparece en el Map (el llamador aplica `?? 0`).
    expect(mapa.has("o2")).toBe(false);
  });

  it("R7: `ids` vacio -> Map vacio y CERO consultas", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const mapa = await repo.contarIntentosVigentesEnLote([]);

    expect(mapa.size).toBe(0);
    expect(prisma.gestionOrden.groupBy).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.count).not.toHaveBeenCalled();
  });

  it('R29: el `by` del lote es ["ordenId","cierreId"] — cuenta cierres por orden, no gestiones', async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.groupBy.mockResolvedValue([]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
    await repo.contarIntentosVigentesEnLote(["o1"]);
    expect(prisma.gestionOrden.groupBy.mock.calls[0][0].by).toEqual(["ordenId", "cierreId"]);
  });

  // R29 medido de verdad (no por la forma del `by`): con el doble que RESPETA el `by`, dos
  // gestiones de la misma orden en el mismo cierre colapsan a 1 tambien en el lote.
  it("R29: dos gestiones vigentes de la misma orden en el MISMO cierre -> 1 en el lote", async () => {
    const { repo } = repoSobre([
      gestion({ ordenId: "o1", cierreId: "c1", resultado: "devuelta" }),
      gestion({ ordenId: "o1", cierreId: "c1", resultado: "reprogramada" }),
      gestion({ ordenId: "o2", cierreId: "c1", resultado: "devuelta" }),
      gestion({ ordenId: "o2", cierreId: "c2", resultado: "devuelta" }),
    ]);
    const mapa = await repo.contarIntentosVigentesEnLote(["o1", "o2", "o3"]);
    expect(mapa.get("o1")).toBe(1);
    expect(mapa.get("o2")).toBe(2); // R30: dos cierres aprobados distintos
    expect(mapa.get("o3")).toBeUndefined(); // R8: `?? 0` en el llamador
  });

  // R4: UNA sola definicion de "intento". Si el lote se implementara con un `where` propio,
  // este test rompe: es la guarda contra la divergencia por copia-pega entre el numero que ve
  // la UI y el que dispara `rechazada` -> `cobroRechazado` (dinero).
  it("R4: el `where` del LOTE es IDENTICO al del individual salvo `ordenId`", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.groupBy.mockResolvedValue([]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    await repo.contarIntentosVigentes("o1");
    await repo.contarIntentosVigentesEnLote(["o1", "o2"]);

    const individual = { ...prisma.gestionOrden.groupBy.mock.calls[0][0].where };
    const lote = { ...prisma.gestionOrden.groupBy.mock.calls[1][0].where };
    expect(individual.ordenId).toBe("o1");
    expect(lote.ordenId).toEqual({ in: ["o1", "o2"] });
    // Feature 215/T20: el filtro de orden aparece DOS veces —fuera y repetido dentro del `some`
    // de `historialEstados`, por rendimiento (design §3.4)— y las dos son el MISMO valor. Se
    // comprueba antes de normalizarlas para comparar el resto.
    expect(individual.historialEstados.some.ordenId).toBe(individual.ordenId);
    expect(lote.historialEstados.some.ordenId).toEqual(lote.ordenId);
    const sinOrden = (w: Record<string, never>) => {
      const copia: Record<string, unknown> = { ...w };
      const rel = copia.historialEstados as { some: Record<string, unknown> };
      copia.historialEstados = { some: { ...rel.some } };
      delete (copia.historialEstados as { some: Record<string, unknown> }).some.ordenId;
      delete copia.ordenId;
      return copia;
    };
    expect(sinOrden(lote)).toEqual(sinOrden(individual));
  });
});

// Feature 215 — verificacion SEMANTICA extremo a extremo del predicado: el repo REAL sobre el
// doble que evalua el `where` contra filas de `gestion_orden`. Complementa a los tests de forma
// de arriba: esos fijan la QUERY, este fija el SIGNIFICADO en escenarios mezclados.
describe("whereIntentosVigentes — semantica del predicado (215/R1/R2/R3/R5/R29/R30)", () => {
  it("caso mixto: de 7 gestiones solo cuentan 2 cierres aprobados distintos", async () => {
    const { repo } = repoSobre([
      gestion({ cierreId: "c1", resultado: "devuelta" }), // cuenta
      gestion({ cierreId: "c1", resultado: "reprogramada" }), // mismo cierre -> no suma (R29)
      gestion({ cierreId: "c2", resultado: "rechazada" }), // cuenta (cierre distinto, R30)
      gestion({ cierreId: "c3", resultado: "entregada" }), // R2: no cuenta
      gestion({ cierreId: "c4", resultado: "incidente" }), // R2: no cuenta
      gestion({ cierreId: "c5", cierreEstado: "solicitado" }), // R3: no cuenta
      gestion({ cierreId: "c6", anuladaAt: new Date("2026-08-01T00:00:00.000Z") }), // R5: no
    ]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(2);
  });

  it("las gestiones de OTRA orden no contaminan el conteo", async () => {
    const { repo } = repoSobre([
      gestion({ ordenId: "o1", cierreId: "c1" }),
      gestion({ ordenId: "o2", cierreId: "c2" }),
      gestion({ ordenId: "o2", cierreId: "c3" }),
    ]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(1);
    expect(await repo.contarIntentosVigentes("o2")).toBe(2);
  });

  // R4/R29: individual y lote dan EL MISMO numero para la misma orden sobre las MISMAS filas.
  it("R4: individual y lote coinciden sobre las mismas filas", async () => {
    const filas = [
      gestion({ cierreId: "c1", resultado: "devuelta" }),
      gestion({ cierreId: "c1", resultado: "rechazada" }),
      gestion({ cierreId: "c2", resultado: "reprogramada" }),
    ];
    const { repo } = repoSobre(filas);
    const individual = await repo.contarIntentosVigentes("o1");
    const lote = await repo.contarIntentosVigentesEnLote(["o1"]);
    expect(individual).toBe(2);
    expect(lote.get("o1") ?? 0).toBe(individual);
  });
});

// Feature 215 (T21, design §3.4) — EL DISCRIMINADOR DE LAS GESTIONES SINTETICAS. [💰]
//
// El sistema crea gestiones que NO son visitas de nadie y que entran al cierre del mensajero por
// la puerta de atras: nacen con `cierre_id: null` y con el `mensajero_id` de la ultima `devuelta`
// vigente, asi que `CierreDiaRepository.crearCierre` las vincula al siguiente cierre de ese
// mensajero (`:480-483`). Sin la sexta condicion del predicado, al aprobarse ese cierre sumaban
// +1 y adelantaban el escalado del cron SLA -> `rechazada` -> `cobroRechazado` (56, dinero real).
describe("el discriminador de las gestiones SINTETICAS (215/R12/R18-b/R34) [💰]", () => {
  // R18-b: la gestion sintetica del escalado SLA (`DevolucionSlaRepository.escalarDevueltaSla`,
  // `resultado: rechazada`, historial `escalado_devuelta_sla`) NO cuenta como intento NI SIQUIERA
  // con su cierre APROBADO. Deja de contar como INTENTO; sigue cobrando como RECHAZO (R18-d, ver
  // `devolucion-sla-dinero.test.ts`, verde sin tocarse).
  it("R18-b: la sintetica del ESCALADO SLA no cuenta, aunque su cierre este APROBADO", async () => {
    const { repo } = repoSobre([
      gestion({
        resultado: "rechazada",
        cierreId: "c1",
        cierreEstado: "aprobado",
        origenTiposHistorial: ["escalado_devuelta_sla"],
      }),
    ]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(0);
  });

  // R12: la reprogramacion de ESCRITORIO de la tienda
  // (`GestionOrdenRepository.reprogramarDesdeDevuelta`, `resultado: reprogramada`, historial
  // `reprogramacion_tienda`) tampoco es una visita. Este es el caso que 7d9471c3 dejo INCUMPLIDO.
  it("R12: la reprogramacion de la TIENDA no cuenta, aunque su cierre este APROBADO", async () => {
    const { repo } = repoSobre([
      gestion({
        resultado: "reprogramada",
        cierreId: "c1",
        cierreEstado: "aprobado",
        origenTiposHistorial: ["reprogramacion_tienda"],
      }),
    ]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(0);
  });

  // R12 — EL DOBLE CONTEO COMPLETO, que es lo que R12 existe para impedir. La orden se devolvio
  // de verdad (visita real, cierre aprobado) y ADEMAS la tienda la reprogramo desde el escritorio;
  // la sintetica cayo en OTRO cierre del mismo mensajero, tambien aprobado. Son 2 cierres
  // aprobados con resultado contable: sin discriminador el conteo diria 2. La orden tuvo UNA
  // visita, asi que es 1. Con 2 el cron llega al umbral una vuelta antes y cobra el rechazo antes
  // de tiempo — exactamente el doble conteo que `160/R2` evitaba.
  it("R12: `devuelta` real + reprogramacion de la tienda en OTRO cierre aprobado -> 1, no 2", async () => {
    const { repo } = repoSobre([
      gestion({ resultado: "devuelta", cierreId: "c1", origenTiposHistorial: ["gestion"] }),
      gestion({
        resultado: "reprogramada",
        cierreId: "c2",
        origenTiposHistorial: ["reprogramacion_tienda"],
      }),
    ]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(1);
  });

  it("R12: las dos en el MISMO cierre aprobado tambien -> 1 (R29 no lo tapa: es el origen)", async () => {
    const { repo } = repoSobre([
      gestion({ resultado: "devuelta", cierreId: "c1", origenTiposHistorial: ["gestion"] }),
      gestion({
        resultado: "reprogramada",
        cierreId: "c1",
        origenTiposHistorial: ["reprogramacion_tienda"],
      }),
    ]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(1);
  });

  // R34-d: una gestion LEGADA (anterior al historial de la feature 49) no tiene fila que la
  // respalde. NO cuenta, y es deliberado: contar de menos retrasa el escalado (inofensivo para la
  // tienda); contar de mas cobra un rechazo antes de tiempo. Ante ausencia de dato, no se cuenta.
  it("R34-d: gestion contable, vigente y en cierre APROBADO pero SIN fila de historial -> 0", async () => {
    const { repo } = repoSobre([
      gestion({ resultado: "devuelta", cierreId: "c1", origenTiposHistorial: [] }),
    ]);
    expect(await repo.contarIntentosVigentes("o1")).toBe(0);
  });

  // El `some` es INCLUSION pura: `in` con la lista blanca, y el `ordenId` repetido dentro (que no
  // es decorativo — es lo que hace que el `EXISTS` entre por `@@index([ordenId, createdAt])` en
  // vez de por un `gestion_orden_id` SIN indice, design §3.4).
  it("R34-c: el `some` filtra por familia con `in` y repite el `ordenId` (sin `none`/`notIn`)", async () => {
    const where = await whereIndividual();
    expect(where.historialEstados).toEqual({
      some: { ordenId: "o1", origenTipo: { in: ["gestion"] } },
    });
    const json = JSON.stringify(where);
    expect(json).not.toContain("none");
    expect(json).not.toContain("notIn");
  });

  // La sexta condicion vale igual en el LOTE: un solo predicado para los dos conteos (R6).
  it("R6/R12/R18-b: en el LOTE las sinteticas tampoco cuentan, con el mismo predicado", async () => {
    const { repo } = repoSobre([
      gestion({ ordenId: "o1", cierreId: "c1", origenTiposHistorial: ["gestion"] }),
      gestion({
        ordenId: "o1",
        cierreId: "c2",
        resultado: "reprogramada",
        origenTiposHistorial: ["reprogramacion_tienda"],
      }),
      gestion({
        ordenId: "o2",
        cierreId: "c3",
        resultado: "rechazada",
        origenTiposHistorial: ["escalado_devuelta_sla"],
      }),
      gestion({ ordenId: "o3", cierreId: "c4", origenTiposHistorial: [] }), // legada (R34-d)
    ]);
    const mapa = await repo.contarIntentosVigentesEnLote(["o1", "o2", "o3"]);
    expect(mapa.get("o1")).toBe(1); // solo la visita real
    expect(mapa.get("o2")).toBeUndefined(); // solo la sintetica del cron -> `?? 0`
    expect(mapa.get("o3")).toBeUndefined(); // legada sin historial -> `?? 0`
    // Y el individual da EXACTAMENTE lo mismo (R6: una sola definicion).
    expect(await repo.contarIntentosVigentes("o1")).toBe(1);
    expect(await repo.contarIntentosVigentes("o2")).toBe(0);
    expect(await repo.contarIntentosVigentes("o3")).toBe(0);
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
