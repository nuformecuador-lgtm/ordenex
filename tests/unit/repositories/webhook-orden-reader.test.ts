import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WebhookOrdenReader } from "@/lib/repositories/WebhookOrdenReader";

// Feature 256 (T4) — PRIMER test unitario de `WebhookOrdenReader` (design §5.1.3: hasta esta
// feature no existia ninguno).
//
// El fake de Prisma no se limita a devolver una fila: REGISTRA los argumentos y ademas APLICA
// de verdad el `where` / `orderBy` / `take` que el repositorio le pasa a la relacion anidada.
// Es deliberado: el criterio de «gestion de devolucion vigente» (R8/R9/R10) lo ejecuta la BASE,
// no el codigo TypeScript. Un fake que devolviera siempre la fila buena daria verde aunque
// alguien borrase el `anuladaAt: null` o el `orderBy`; este se pone ROJO.

const ORDEN_ID = "orden-1";
const ESTATUS_DESTINO_ID = "s-devuelta";

/** Fila cruda de `gestion_orden` tal y como esta en la base, ANTES de filtrar y proyectar. */
interface FilaGestion {
  resultado: string;
  anuladaAt: Date | null;
  createdAt: Date;
  causaDevolucion: string | null;
  /** Enum HERMANO de la 158; nunca debe salir por este campo (R10). */
  causaIncidente?: string | null;
  /** TEXTO LIBRE del mensajero (36/R7). Comparte nombre con el campo de cable, y no se emite. */
  motivo?: string | null;
}

/** Mini-motor: aplica el `where`/`orderBy`/`take`/`select` REALES sobre las filas dadas. */
function consultarGestiones(
  filas: readonly FilaGestion[],
  arg: {
    where: { resultado?: string; anuladaAt?: Date | null };
    orderBy?: { createdAt?: "asc" | "desc" };
    take?: number;
    select: Record<string, boolean>;
  },
): Array<Record<string, unknown>> {
  let rows = filas.filter((g) => {
    if (arg.where.resultado !== undefined && g.resultado !== arg.where.resultado) return false;
    if ("anuladaAt" in arg.where && arg.where.anuladaAt === null && g.anuladaAt !== null) return false;
    return true;
  });
  if (arg.orderBy?.createdAt === "desc") {
    rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else if (arg.orderBy?.createdAt === "asc") {
    rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  if (typeof arg.take === "number") rows = rows.slice(0, arg.take);
  return rows.map((g) => {
    const proyectada: Record<string, unknown> = {};
    for (const [campo, pedido] of Object.entries(arg.select)) {
      if (pedido) proyectada[campo] = (g as unknown as Record<string, unknown>)[campo] ?? null;
    }
    return proyectada;
  });
}

function buildPrisma(filas: readonly FilaGestion[], ordenOverride: Record<string, unknown> = {}) {
  const prisma = {
    orden: {
      findUnique: vi.fn(async (arg: { where: unknown; select: Record<string, unknown> }) => ({
        tiendaId: "owner-A",
        numGuia: 12345,
        numRemision: "REM-0001",
        deletedAt: null,
        gestiones: consultarGestiones(
          filas,
          arg.select.gestiones as Parameters<typeof consultarGestiones>[1],
        ),
        ...ordenOverride,
      })),
    },
    orderStatus: {
      findUnique: vi.fn(async () => ({ value: "devuelta" })),
    },
    // Delegate presente SOLO para poder afirmar que NADIE lo usa (R11). El tipo real que recibe
    // el reader (`Pick<PrismaClient, "orden" | "orderStatus">`) ni siquiera lo expone.
    gestionOrden: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  };
  return prisma;
}

function readerWith(prisma: ReturnType<typeof buildPrisma>) {
  return new WebhookOrdenReader(prisma as unknown as PrismaClient);
}

/** Argumento REAL con el que se llamo a `orden.findUnique`. */
function argOrden(prisma: ReturnType<typeof buildPrisma>) {
  return prisma.orden.findUnique.mock.calls[0][0] as unknown as {
    where: Record<string, unknown>;
    select: {
      gestiones: {
        where: Record<string, unknown>;
        orderBy: Record<string, unknown>;
        take: number;
        select: Record<string, unknown>;
      };
    };
  };
}

const VIEJA = new Date("2026-08-18T09:00:00.000Z");
const NUEVA = new Date("2026-08-20T09:00:00.000Z");
const POSTERIOR = new Date("2026-08-21T09:00:00.000Z");

function devuelta(over: Partial<FilaGestion> = {}): FilaGestion {
  return {
    resultado: "devuelta",
    anuladaAt: null,
    createdAt: NUEVA,
    causaDevolucion: "not_found",
    ...over,
  };
}

describe("256/R8-R12 — que gestion manda al resolver la causa de la devolucion", () => {
  it("R8: con dos gestiones `devuelta` vigentes emite la causa de la de createdAt MAYOR", async () => {
    const prisma = buildPrisma([
      devuelta({ createdAt: VIEJA, causaDevolucion: "wrong_number" }),
      devuelta({ createdAt: NUEVA, causaDevolucion: "wrong_address" }),
    ]);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    const gestiones = argOrden(prisma).select.gestiones;
    expect(gestiones.orderBy).toEqual({ createdAt: "desc" });
    expect(gestiones.take).toBe(1);
    expect(gestiones.select).toEqual({ causaDevolucion: true });
    expect(datos?.causaDevolucion).toBe("wrong_address");
  });

  it("R9: una gestion `devuelta` ANULADA no se considera aunque sea la mas reciente", async () => {
    // La exclusion la hace el `where` (`anuladaAt: null`), no el codigo. Si alguien lo borrase,
    // una gestion deshecha (67/R11) volveria a mandar y este test caeria por las dos vias: el
    // assert sobre el `where` capturado Y el valor emitido.
    const prisma = buildPrisma([
      devuelta({ createdAt: VIEJA, causaDevolucion: "not_found" }),
      devuelta({ createdAt: POSTERIOR, causaDevolucion: "wrong_address", anuladaAt: new Date() }),
    ]);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    expect(argOrden(prisma).select.gestiones.where).toEqual({
      resultado: "devuelta",
      anuladaAt: null,
    });
    expect(datos?.causaDevolucion).toBe("not_found");
  });

  it("R10: una gestion `entregada`/`incidente` POSTERIOR no desplaza a la `devuelta` vigente y su causa de incidente nunca aparece", async () => {
    const prisma = buildPrisma([
      devuelta({ createdAt: VIEJA, causaDevolucion: "wrong_number" }),
      { resultado: "entregada", anuladaAt: null, createdAt: NUEVA, causaDevolucion: null },
      {
        resultado: "incidente",
        anuladaAt: null,
        createdAt: POSTERIOR,
        causaDevolucion: null,
        causaIncidente: "danado", // enum HERMANO (158): jamas sale por `causaDevolucion`
      },
    ]);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    const gestiones = argOrden(prisma).select.gestiones;
    expect(gestiones.where).toMatchObject({ resultado: "devuelta" });
    expect(gestiones.select).not.toHaveProperty("causaIncidente");
    expect(datos?.causaDevolucion).toBe("wrong_number");
    expect(JSON.stringify(datos)).not.toContain("danado");
  });

  it("R11: la relacion cuelga de la orden PEDIDA; no hay consulta libre a gestionOrden", async () => {
    const prisma = buildPrisma([devuelta()]);
    await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    expect(argOrden(prisma).where).toEqual({ id: ORDEN_ID });
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.findFirst).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.findUnique).not.toHaveBeenCalled();
  });

  it("R12: el reader hace exactamente 2 llamadas a Prisma, las mismas que antes de la feature", async () => {
    const prisma = buildPrisma([devuelta()]);
    await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    expect(prisma.orden.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.orderStatus.findUnique).toHaveBeenCalledTimes(1);
    const llamadas =
      prisma.orden.findUnique.mock.calls.length + prisma.orderStatus.findUnique.mock.calls.length;
    expect(llamadas).toBe(2);
  });

  it("R4: gestion `devuelta` VIGENTE con la causa sin registrar (historico previo a la 73) -> null, sin inventar un valor por defecto", async () => {
    const prisma = buildPrisma([devuelta({ causaDevolucion: null })]);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);
    expect(datos?.causaDevolucion).toBeNull();
  });

  it("R5: orden sin ninguna gestion `devuelta` vigente -> null (la relacion viene vacia)", async () => {
    const prisma = buildPrisma([
      { resultado: "reprogramada", anuladaAt: null, createdAt: NUEVA, causaDevolucion: null },
    ]);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);
    expect(datos?.causaDevolucion).toBeNull();
  });

  it("R22: el TEXTO LIBRE `gestion_orden.motivo` no se proyecta siquiera: solo viaja el enum", async () => {
    const prisma = buildPrisma([
      devuelta({ causaDevolucion: "not_found", motivo: "el tipo vive en la casa azul, 0999123456" }),
    ]);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    expect(argOrden(prisma).select.gestiones.select).not.toHaveProperty("motivo");
    expect(JSON.stringify(datos)).not.toContain("casa azul");
    expect(datos?.causaDevolucion).toBe("not_found");
  });

  it("R19: los campos que ya viajaban (tiendaId, numGuia, numRemision, deletedAt, estado) siguen igual", async () => {
    const prisma = buildPrisma([devuelta()]);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);
    expect(datos).toEqual({
      tiendaId: "owner-A",
      numGuia: 12345,
      numRemision: "REM-0001",
      deletedAt: null,
      estado: "devuelta",
      causaDevolucion: "not_found",
    });
  });
});
