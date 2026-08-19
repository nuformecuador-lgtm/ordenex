import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { DevolucionSlaRepository } from "@/lib/repositories/DevolucionSlaRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 140: la guardia del choke point es de FALLO CERRADO. Los ids de estatus son los del
// catalogo (`idEstado`) y el catalogo se siembra antes de cada test, asi el append valida de
// verdad el par `origen -> destino` contra `TRANSICIONES` en vez de saltarselo.

// Feature 99 (T6/T7/T8) — repo del cron SLA. Mockea Prisma (sin DB real, patron
// liberacion-reprogramada-repository.test.ts). Cubre: findDevueltasSla deriva causa + ancladaAt +
// mensajero de la gestion `devuelta` vigente (R5); liberar (UPDATE guardado por estado +
// mensajero null + append liberacion_devuelta_sla, R15/R18/R19/R24/R25); escalar (Option A del
// dinero: gestion sintetica `rechazada` del mensajero, `cierre_id null`, append
// escalado_devuelta_sla; idempotente por estado, R16/R17/R18/R19/R20-R25).

// El fake pasa el propio prisma como `tx` (tiene orden.updateMany + gestionOrden.create + el
// choke point ordenHistorialEstado.createMany).
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: { findMany: vi.fn(), updateMany: vi.fn() },
    gestionOrden: { create: vi.fn(async () => ({ id: "g-sintetica" })) },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function repoWith(prisma: ReturnType<typeof buildPrisma>) {
  return new DevolucionSlaRepository(prisma as unknown as PrismaClient);
}

beforeEach(async () => {
  await sembrarCatalogoEstados();
});

const ANCLA = new Date("2026-07-16T14:00:00.000Z"); // instante de la aprobacion del cierre
const GESTION = new Date("2026-07-15T06:00:00.000Z"); // el mensajero devolvio (32 h antes)

/** Fila cruda tal y como la devuelve la consulta, con sus DOS proyecciones anidadas. */
function filaCruda(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    zonaId: "z1",
    gestiones: [{ mensajeroId: "m1", causaDevolucion: "not_found", createdAt: GESTION }],
    historialEstados: [{ createdAt: ANCLA }],
    ...over,
  };
}

describe("findDevueltasSla (R5 - 239 R12/R13/R14/R15)", () => {
  it("R5: filtra por estatus devuelta + no borrada; deriva causa y mensajero de la gestion vigente", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([filaCruda()]);
    const rows = await repoWith(prisma).findDevueltasSla();

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ deletedAt: null, estatus: { value: "devuelta" } });
    // La gestion vigente = la mas reciente NO anulada.
    expect(arg.select.gestiones).toMatchObject({
      where: { resultado: "devuelta", anuladaAt: null },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(rows).toEqual([
      {
        ordenId: "o1",
        zonaId: "z1",
        mensajeroId: "m1",
        causa: "not_found",
        ancladaAt: ANCLA,
        origenAncla: "aprobacion",
      },
    ]);
  });

  // EL CASO DE LA FEATURE (239/R12). El reloj arranca cuando la BODEGA CONFIRMA, no cuando el
  // mensajero devuelve. Con el retraso medido contra produccion (mediana 8,2 h, p90 22,1 h) y la
  // ventana `not_found` de 24 h, anclar en la gestion escalaba y COBRABA ordenes que la tienda no
  // habia podido ver nunca. La mutacion que mata este caso es exactamente esa: devolver el ancla
  // al `createdAt` de la gestion.
  it("239/R12: el ancla es el instante del ANCLAJE, no el `created_at` de la gestion", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([filaCruda()]);

    const rows = await repoWith(prisma).findDevueltasSla();

    expect(rows[0].ancladaAt).toEqual(ANCLA);
    expect(rows[0].ancladaAt).not.toEqual(GESTION); // la fecha de la gestion NO manda
    expect(rows[0].origenAncla).toBe("aprobacion");
  });

  it("239/R12: la proyeccion del ancla pide la ULTIMA fila de familia `anclaje_devolucion`", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([filaCruda()]);

    await repoWith(prisma).findDevueltasSla();

    // Se mira el ARGUMENTO porque es lo que separa "salio el numero correcto por casualidad" de
    // "pidio exactamente esa fila". `desc` + `take 1` es lo que implementa R15.
    expect(prisma.orden.findMany.mock.calls[0][0].select.historialEstados).toEqual({
      where: { origenTipo: "anclaje_devolucion" },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { createdAt: true },
    });
  });

  // R14 - LA RAMA LEGADA, con nombre. Son las ordenes que ya estaban en `devuelta` el dia del
  // despliegue: no tienen fila de anclaje y su ventana se queda donde ya estaba, sin moverles el
  // plazo por debajo (grandfather, P6/R30).
  it("239/R14: sin fila de anclaje, ancla en la gestion Y sale MARCADA como legada", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([filaCruda({ historialEstados: [] })]);

    const rows = await repoWith(prisma).findDevueltasSla();

    expect(rows[0].ancladaAt).toEqual(GESTION);
    // Lo que hace que esto NO sea un fallback silencioso: viaja en el DTO y el servicio lo cuenta.
    expect(rows[0].origenAncla).toBe("legado");
  });

  // R15 - LA VUELTA COMPLETA: devolucion -> aprobacion -> liberacion a bodega -> reasignacion ->
  // nueva devolucion -> nueva aprobacion. El historial es append-only, asi que la orden acumula
  // DOS filas de anclaje. Tiene que ganar la MAS RECIENTE; si ganara la primera, el plazo de la
  // devolucion nueva se contaria desde la vuelta anterior y la orden se escalaria -y se
  // cobraria- de inmediato.
  it("239/R15: tras la vuelta completa gana el anclaje MAS RECIENTE", async () => {
    const prisma = buildPrisma();
    const anclaVieja = new Date("2026-07-01T08:00:00.000Z");
    const anclaNueva = new Date("2026-07-20T09:00:00.000Z");
    // El doble honra el contrato del `take 1` + `orderBy desc`: la base devuelve UNA fila, la mas
    // reciente. Lo que este caso fija es que la consulta PIDE ese orden, no que el doble acierte.
    prisma.orden.findMany.mockResolvedValue([
      filaCruda({ historialEstados: [{ createdAt: anclaNueva }] }),
    ]);

    const rows = await repoWith(prisma).findDevueltasSla();

    expect(rows[0].ancladaAt).toEqual(anclaNueva);
    expect(rows[0].ancladaAt).not.toEqual(anclaVieja);
    expect(prisma.orden.findMany.mock.calls[0][0].select.historialEstados.orderBy).toEqual({
      createdAt: "desc",
    });
    expect(prisma.orden.findMany.mock.calls[0][0].select.historialEstados.take).toBe(1);
  });

  // R13 - la mitad que faltaba del fallo. Una orden en el pre-estado NO entra en esta lista, asi
  // que el cron no la puede liberar, ni escalar, ni cobrar mientras su cierre siga sin aprobar.
  it("239/R13: una orden en `devolucion_por_confirmar` NO es candidata del cron", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);

    await repoWith(prisma).findDevueltasSla();

    const where = prisma.orden.findMany.mock.calls[0][0].where;
    // IGUALDAD, no `in` ni `notIn`: el pre-estado no puede colarse ni por omision ni por lista
    // negra. Es la MISMA igualdad que usa `novedadWhere`, y esa coincidencia es el punto de toda
    // la feature: lo que la tienda ve y lo que el reloj mira son el mismo hecho.
    expect(where.estatus).toEqual({ value: "devuelta" });
    expect(JSON.stringify(where)).not.toContain("devolucion_por_confirmar");
  });

  it("R28: una orden con gestion vigente pero SIN causa (pre-73) SI sale (el service la omite)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      filaCruda({
        gestiones: [{ mensajeroId: "m1", causaDevolucion: null, createdAt: new Date() }],
      }),
    ]);
    const rows = await repoWith(prisma).findDevueltasSla();
    expect(rows).toHaveLength(1);
    expect(rows[0].causa).toBeNull();
  });

  it("ignora ordenes en devuelta SIN gestion `devuelta` vigente (anomalia sin mensajero)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      filaCruda({ id: "o1", gestiones: [] }),
      filaCruda({
        id: "o2",
        zonaId: "z2",
        gestiones: [
          {
            mensajeroId: "m2",
            causaDevolucion: "wrong_number",
            createdAt: new Date("2026-07-10T00:00:00Z"),
          },
        ],
      }),
    ]);
    const rows = await repoWith(prisma).findDevueltasSla();
    expect(rows.map((r) => r.ordenId)).toEqual(["o2"]);
  });
});

describe("liberarDevueltaSla (R15/R18/R19/R24/R25)", () => {
  it("R15/R18/R19: UPDATE guardado por estatus=devuelta -> destino, limpia mensajero + asignadoAt, append actor NULL", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });

    const ok = await repoWith(prisma).liberarDevueltaSla({
      ordenId: "o1",
      destinoEstatusId: idEstado("en_bodega_satelite"),
      estatusDevueltaId: idEstado("devuelta"),
    });

    expect(ok).toBe(true);
    const upd = prisma.orden.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "o1", estatusId: idEstado("devuelta"), deletedAt: null });
    // Feature 101/R2 (gate F1.4-Q5): la liberacion por SLA enciende `prioridad: true` en el
    // MISMO `data` guardado (junto al destino y el handoff limpio del mensajero).
    // 2026-08-19 (feature 239/T3.1): el `data` ya NO apaga `gestion_aprobada`. Esa columna se
    // retiro: la orden SALE de `devuelta` en este mismo `data`, asi que deja de ser novedad y
    // deja de correr su reloj por construccion, sin ninguna bandera que alguien tenga que
    // acordarse de apagar. Igualdad EXACTA a proposito: lo que se afirma es que no queda ni un
    // resto de la columna en la escritura.
    expect(upd.data).toEqual({
      estatusId: idEstado("en_bodega_satelite"),
      mensajeroAsignadoId: null, // R15: handoff limpio a la bodega
      asignadoAt: null,
      prioridad: true, // feature 101/R2
    });
    // R18/R19: append por el choke point, actor NULL, origen_tipo liberacion_devuelta_sla.
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const hist = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(hist.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("devuelta"),
        estatusDestinoId: idEstado("en_bodega_satelite"),
        actorUsuarioId: null,
        origenTipo: "liberacion_devuelta_sla",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
    // No crea gestion sintetica al liberar (eso es del escalado).
    expect(prisma.gestionOrden.create).not.toHaveBeenCalled();
  });

  it("R24/R25: 2.ª corrida -> la orden ya salio de devuelta -> count 0 -> false, sin append", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });

    const ok = await repoWith(prisma).liberarDevueltaSla({
      ordenId: "o1",
      destinoEstatusId: idEstado("en_bodega_central"),
      estatusDevueltaId: idEstado("devuelta"),
    });

    expect(ok).toBe(false);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("escalarDevueltaSla — Option A del dinero (R16/R17/R18/R19/R20-R25)", () => {
  it("R20/R22: escala a rechazada + crea 1 gestion sintetica `rechazada` del mensajero, cierre_id null", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });

    const ok = await repoWith(prisma).escalarDevueltaSla({
      ordenId: "o1",
      estatusDevueltaId: idEstado("devuelta"),
      estatusRechazadaId: idEstado("rechazada"),
      mensajeroId: "m1",
      motivo: "escalado SLA not_found",
    });

    expect(ok).toBe(true);
    // R16/R17: transiciona a rechazada, guardado por estado; NO toca el mensajero (paridad rechazo).
    const upd = prisma.orden.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "o1", estatusId: idEstado("devuelta"), deletedAt: null });
    expect(upd.data).toEqual({ estatusId: idEstado("rechazada") });
    expect(upd.data).not.toHaveProperty("mensajeroAsignadoId");
    // Feature 101/R3: el ESCALADO a `rechazada` NO enciende `prioridad` (solo la liberacion SLA).
    expect(upd.data).not.toHaveProperty("prioridad");

    // R20/R22: UNA gestion sintetica rechazada del mensajero atribuido, sin cierre.
    expect(prisma.gestionOrden.create).toHaveBeenCalledTimes(1);
    const gArg = (prisma.gestionOrden.create.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(gArg.data).toMatchObject({
      ordenId: "o1",
      mensajeroId: "m1",
      resultado: "rechazada",
      motivo: "escalado SLA not_found",
      cierreId: null,
    });
    // R23: sin aritmetica con `number` (no hay montos coercionados aqui; el ingreso lo cobra el
    // snapshot 56). La gestion sintetica no lleva montoRecibido ni ingreso pre-computado.
    expect(gArg.data).not.toHaveProperty("montoRecibido");
    expect(gArg.data).not.toHaveProperty("ingresoBodegaRechazo");

    // R18/R19: append por el choke point, actor NULL, enlaza la gestion sintetica.
    const hist = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(hist.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("devuelta"),
        estatusDestinoId: idEstado("rechazada"),
        actorUsuarioId: null,
        origenTipo: "escalado_devuelta_sla",
        motivo: null,
        gestionOrdenId: "g-sintetica",
      },
    ]);
  });

  it("R21/R24/R25: 2.ª corrida -> count 0 -> false, NO crea 2.ª gestion ni append (sin doble dinero)", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });

    const ok = await repoWith(prisma).escalarDevueltaSla({
      ordenId: "o1",
      estatusDevueltaId: idEstado("devuelta"),
      estatusRechazadaId: idEstado("rechazada"),
      mensajeroId: "m1",
      motivo: "escalado SLA wrong_number",
    });

    expect(ok).toBe(false);
    expect(prisma.gestionOrden.create).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});
