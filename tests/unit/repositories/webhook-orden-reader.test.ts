import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WebhookOrdenReader } from "@/lib/repositories/WebhookOrdenReader";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";

// Feature 256 (T4) — PRIMER test unitario de `WebhookOrdenReader` (design §5.1.3: hasta esta
// feature no existia ninguno).
//
// ⏳ 2026-08-22 (feature 268, T6a) — AMPLIADO a la causa del INCIDENTE y a sus DOS procedencias
// (mensajero via `gestion_orden`, admin via `orden_incidente`). Los `describe` se prefijan con la
// feature porque los numeros de requisito se repiten entre 99, 256 y 268 y no son lo mismo.
//
// El fake de Prisma no se limita a devolver una fila: REGISTRA los argumentos y ademas APLICA
// de verdad el `where` / `orderBy` / `take` que el repositorio le pasa a las relaciones anidadas.
// Es deliberado: el criterio de «gestion vigente» (256/R8-R10) lo ejecuta la BASE, no el codigo
// TypeScript. Un fake que devolviera siempre la fila buena daria verde aunque alguien borrase el
// `anuladaAt: null` o el `orderBy`; este se pone ROJO.

const ORDEN_ID = "orden-1";
const ESTATUS_DESTINO_ID = "s-devuelta";

/** Fila cruda de `gestion_orden` tal y como esta en la base, ANTES de filtrar y proyectar. */
interface FilaGestion {
  resultado: string;
  anuladaAt: Date | null;
  createdAt: Date;
  causaDevolucion: string | null;
  /** Enum HERMANO de la 158; 268/R20 lo proyecta, pero SOLO por `causaIncidente`. */
  causaIncidente?: string | null;
  /** TEXTO LIBRE del mensajero (36/R7). Comparte nombre con el campo de cable, y no se emite. */
  motivo?: string | null;
}

/** Fila cruda de `orden_incidente` (el camino del ADMIN, 158/R38). */
interface FilaIncidenteAdmin {
  createdAt: Date;
  causa: string;
  /** Texto libre OBLIGATORIO del reporte (158/R45): nunca se proyecta ni se emite. */
  motivo?: string;
  /** Flujo de aprobacion del incidente (158/R43): ortogonal, el reader no lo filtra. */
  estado?: string;
}

interface ArgRelacion {
  where?: { resultado?: { in?: readonly string[] }; anuladaAt?: Date | null };
  orderBy?: { createdAt?: "asc" | "desc" };
  take?: number;
  select: Record<string, boolean>;
}

/** Mini-motor: aplica el `where`/`orderBy`/`take`/`select` REALES sobre las filas dadas. */
function consultarRelacion(
  filas: readonly Record<string, unknown>[],
  arg: ArgRelacion,
): Array<Record<string, unknown>> {
  const where = arg.where ?? {};
  let rows = filas.filter((g) => {
    const enIn = where.resultado?.in;
    if (enIn !== undefined && !enIn.includes(g.resultado as string)) return false;
    if ("anuladaAt" in where && where.anuladaAt === null && g.anuladaAt !== null) return false;
    return true;
  });
  if (arg.orderBy?.createdAt === "desc") {
    rows = [...rows].sort(
      (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
    );
  } else if (arg.orderBy?.createdAt === "asc") {
    rows = [...rows].sort(
      (a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime(),
    );
  }
  if (typeof arg.take === "number") rows = rows.slice(0, arg.take);
  return rows.map((g) => {
    const proyectada: Record<string, unknown> = {};
    for (const [campo, pedido] of Object.entries(arg.select)) {
      if (pedido) proyectada[campo] = g[campo] ?? null;
    }
    return proyectada;
  });
}

function buildPrisma(
  filas: readonly FilaGestion[],
  incidentesAdmin: readonly FilaIncidenteAdmin[] = [],
  ordenOverride: Record<string, unknown> = {},
) {
  const prisma = {
    orden: {
      findUnique: vi.fn(async (arg: { where: unknown; select: Record<string, unknown> }) => ({
        tiendaId: "owner-A",
        numGuia: 12345,
        numRemision: "REM-0001",
        deletedAt: null,
        gestiones: consultarRelacion(
          filas as unknown as readonly Record<string, unknown>[],
          arg.select.gestiones as ArgRelacion,
        ),
        incidentesAdmin: consultarRelacion(
          incidentesAdmin as unknown as readonly Record<string, unknown>[],
          arg.select.incidentesAdmin as ArgRelacion,
        ),
        ...ordenOverride,
      })),
    },
    orderStatus: {
      findUnique: vi.fn(async () => ({ value: "devuelta" })),
    },
    // Delegates presentes SOLO para poder afirmar que NADIE los usa (256/R11, 268). El tipo real
    // que recibe el reader (`Pick<PrismaClient, "orden" | "orderStatus">`) ni los expone.
    gestionOrden: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    ordenIncidente: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
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
        select: Record<string, unknown>;
      };
      incidentesAdmin: {
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

/** Gestion de INCIDENTE del MENSAJERO (arista #44, familia `gestion`). */
function incidenteMensajero(over: Partial<FilaGestion> = {}): FilaGestion {
  return {
    resultado: "incidente",
    anuladaAt: null,
    createdAt: NUEVA,
    causaDevolucion: null,
    causaIncidente: "danado",
    ...over,
  };
}

/** Reporte de incidente del ADMIN (aristas #48-#52, familia `incidente`). */
function incidenteAdmin(over: Partial<FilaIncidenteAdmin> = {}): FilaIncidenteAdmin {
  return { createdAt: NUEVA, causa: "robado", ...over };
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
    // ⏳ 2026-08-22 (268): el `take: 1` de la 256 desaparece a proposito —Prisma no permite
    // proyectar `gestiones` dos veces, asi que el bloque es COMPARTIDO por los dos resultados y
    // un `take` comun perderia filas (ver el comentario del reader). Lo que la BASE sigue
    // haciendo, y lo que estos tests siguen protegiendo, es el `where` y el `orderBy`.
    expect(gestiones.select).toEqual({
      resultado: true,
      createdAt: true,
      causaDevolucion: true,
      causaIncidente: true,
    });
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
      resultado: { in: ["devuelta", "incidente"] },
      anuladaAt: null,
    });
    expect(datos?.causaDevolucion).toBe("not_found");
  });

  it("R10: una gestion `entregada`/`incidente` POSTERIOR no desplaza a la `devuelta` vigente, y su causa nunca sale por `causaDevolucion`", async () => {
    const prisma = buildPrisma([
      devuelta({ createdAt: VIEJA, causaDevolucion: "wrong_number" }),
      { resultado: "entregada", anuladaAt: null, createdAt: NUEVA, causaDevolucion: null },
      incidenteMensajero({ createdAt: POSTERIOR, causaIncidente: "danado" }),
    ]);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    // El campo de devolucion sigue siendo el de la `devuelta` vigente, aunque el incidente sea
    // posterior: son dos campos con dos vidas separadas.
    expect(datos?.causaDevolucion).toBe("wrong_number");
    expect(datos?.causaIncidente).toBe("danado"); // 268/R20: y el hermano SI lo ve
  });

  it("R11: las relaciones cuelgan de la orden PEDIDA; no hay consulta libre a gestionOrden ni a ordenIncidente", async () => {
    const prisma = buildPrisma([devuelta()], [incidenteAdmin()]);
    await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    expect(argOrden(prisma).where).toEqual({ id: ORDEN_ID });
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.findFirst).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.findUnique).not.toHaveBeenCalled();
    expect(prisma.ordenIncidente.findMany).not.toHaveBeenCalled();
    expect(prisma.ordenIncidente.findFirst).not.toHaveBeenCalled();
    expect(prisma.ordenIncidente.findUnique).not.toHaveBeenCalled();
  });

  it("R12: el reader hace exactamente 2 llamadas a Prisma, tambien con la relacion de incidentes del admin", async () => {
    const prisma = buildPrisma([devuelta()], [incidenteAdmin()]);
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

  it("R22: el TEXTO LIBRE `gestion_orden.motivo` no se proyecta siquiera: solo viajan los enums", async () => {
    const prisma = buildPrisma(
      [
        devuelta({
          causaDevolucion: "not_found",
          motivo: "el tipo vive en la casa azul, 0999123456",
        }),
      ],
      [incidenteAdmin({ motivo: "caja mojada en la bodega, hablar con el jefe" })],
    );
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    expect(argOrden(prisma).select.gestiones.select).not.toHaveProperty("motivo");
    expect(argOrden(prisma).select.incidentesAdmin.select).not.toHaveProperty("motivo");
    expect(JSON.stringify(datos)).not.toContain("casa azul");
    expect(JSON.stringify(datos)).not.toContain("caja mojada");
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
      // ⏳ 2026-08-22 (268): el DTO gana un campo REQUERIDO. `toEqual` lo exige presente.
      causaIncidente: null,
    });
  });
});

// -----------------------------------------------------------------------------------------------
// ⏳ 2026-08-22 — Feature 268 (R20): la causa del INCIDENTE y sus DOS procedencias.
// -----------------------------------------------------------------------------------------------

describe("268/R20 — el reader proyecta `causaIncidente` desde las DOS procedencias", () => {
  it("268/R20: procedencia MENSAJERO (gestion `incidente` vigente) -> la causa de `gestion_orden.causa_incidente`", async () => {
    // Sin ninguna fila en `orden_incidente`: si alguien resolviera solo el camino del admin,
    // este caso se pone rojo.
    const prisma = buildPrisma([incidenteMensajero({ causaIncidente: "perdido" })], []);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    expect(argOrden(prisma).select.gestiones.where).toMatchObject({
      resultado: { in: ["devuelta", "incidente"] },
      anuladaAt: null,
    });
    expect(datos?.causaIncidente).toBe("perdido");
    expect(datos?.causaDevolucion).toBeNull(); // no se contaminan
  });

  it("268/R20: procedencia ADMIN (`orden_incidente.causa`) -> la causa, SIN que exista ninguna gestion", async () => {
    // El admin NO crea gestion (design §7.3): la lista de gestiones va VACIA a proposito. Este
    // caso es el que falla si solo se lee la gestion del mensajero — 5 de las 6 aristas.
    const prisma = buildPrisma([], [incidenteAdmin({ causa: "robado" })]);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);

    const admin = argOrden(prisma).select.incidentesAdmin;
    expect(admin.orderBy).toEqual({ createdAt: "desc" });
    expect(admin.take).toBe(1);
    expect(admin.select).toEqual({ causa: true, createdAt: true });
    expect(datos?.causaIncidente).toBe("robado");
  });

  it("268/R20: una gestion `incidente` ANULADA no manda (el `where` de vigencia tambien la cubre)", async () => {
    const prisma = buildPrisma(
      [
        incidenteMensajero({ createdAt: VIEJA, causaIncidente: "danado" }),
        incidenteMensajero({
          createdAt: POSTERIOR,
          causaIncidente: "robado",
          anuladaAt: new Date(),
        }),
      ],
      [],
    );
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);
    expect(datos?.causaIncidente).toBe("danado");
  });

  it("268/R20: con dos gestiones `incidente` vigentes manda la de createdAt MAYOR", async () => {
    const prisma = buildPrisma(
      [
        incidenteMensajero({ createdAt: VIEJA, causaIncidente: "danado" }),
        incidenteMensajero({ createdAt: POSTERIOR, causaIncidente: "perdido" }),
      ],
      [],
    );
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);
    expect(datos?.causaIncidente).toBe("perdido");
  });

  it("268/R20: si las dos procedencias tuvieran causa, manda la MAS RECIENTE por createdAt (en los dos sentidos)", async () => {
    const adminMasNuevo = buildPrisma(
      [incidenteMensajero({ createdAt: VIEJA, causaIncidente: "danado" })],
      [incidenteAdmin({ createdAt: POSTERIOR, causa: "robado" })],
    );
    expect(
      (await readerWith(adminMasNuevo).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID))
        ?.causaIncidente,
    ).toBe("robado");

    const gestionMasNueva = buildPrisma(
      [incidenteMensajero({ createdAt: POSTERIOR, causaIncidente: "danado" })],
      [incidenteAdmin({ createdAt: VIEJA, causa: "robado" })],
    );
    expect(
      (await readerWith(gestionMasNueva).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID))
        ?.causaIncidente,
    ).toBe("danado");
  });

  it("268/R21: sin incidente de ninguna procedencia -> null (los dos caminos del null colapsan)", async () => {
    const prisma = buildPrisma([devuelta()], []);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);
    expect(datos?.causaIncidente).toBeNull();
  });

  it("268/R21: gestion `incidente` vigente SIN causa registrada -> null, sin inventar un valor", async () => {
    const prisma = buildPrisma([incidenteMensajero({ causaIncidente: null })], []);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);
    expect(datos?.causaIncidente).toBeNull();
  });

  it("268/R20: el reader NO filtra `orden_incidente` por su `estado` de aprobacion (es ortogonal al estado de la orden)", async () => {
    const prisma = buildPrisma([], [incidenteAdmin({ causa: "danado", estado: "solicitado" })]);
    const datos = await readerWith(prisma).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID);
    expect(argOrden(prisma).select.incidentesAdmin).not.toHaveProperty("where");
    expect(datos?.causaIncidente).toBe("danado");
  });

  it("268/R20: los tres values del SEED (en espanol, sin traducir) salen CRUDOS por las dos procedencias", async () => {
    for (const causa of CAUSA_INCIDENTE_SEED) {
      const mensajero = buildPrisma([incidenteMensajero({ causaIncidente: causa })], []);
      expect(
        (await readerWith(mensajero).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID))?.causaIncidente,
      ).toBe(causa);

      const admin = buildPrisma([], [incidenteAdmin({ causa })]);
      expect(
        (await readerWith(admin).findDatosEntrega(ORDEN_ID, ESTATUS_DESTINO_ID))?.causaIncidente,
      ).toBe(causa);
    }
    expect([...CAUSA_INCIDENTE_SEED]).toEqual(["danado", "perdido", "robado"]);
  });
});
