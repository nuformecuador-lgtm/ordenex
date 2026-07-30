import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { WalletIndemnizacionIncidenteFeedService } from "@/lib/services/WalletIndemnizacionIncidenteFeedService";

// Feature 158 (T1.27, R52/R53/R55) — el SEGUNDO emisor de `egreso_indemnizacion`, el del camino
// del ADMIN. Se prueba con un doble de `tx`: el feed NO persiste nada, construye la fila.

const INCIDENTE_ID = "inc-1";

function txCon(fila: { indemnizacion: Prisma.Decimal | null } | null) {
  const findFirst = vi.fn(async (arg: { where: Record<string, unknown> }) => {
    void arg;
    return fila;
  });
  return { tx: { ordenIncidente: { findFirst } }, findFirst };
}

/**
 * Doble que HONRA el `where`, como la base: guarda una fila con su `estado` real y solo la
 * devuelve si el WHERE casa. Es lo que convierte «la guardia esta en el WHERE» en una
 * afirmacion de COMPORTAMIENTO y no de forma.
 */
function txConEstado(estado: string, indemnizacion: Prisma.Decimal | null) {
  const findFirst = vi.fn(
    async (arg: { where: Record<string, unknown> }) =>
      arg.where.estado === undefined || arg.where.estado === estado
        ? { indemnizacion }
        : null,
  );
  return { tx: { ordenIncidente: { findFirst } }, findFirst };
}

const feed = new WalletIndemnizacionIncidenteFeedService();

describe("R52 — el movimiento emitido", () => {
  it("emite UN egreso con tipo/categoria/origen_tipo/origen_id exactos", async () => {
    const { tx } = txCon({ indemnizacion: new Prisma.Decimal("2500.00") });

    const movs = await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never);

    expect(movs).toEqual([
      {
        tipo: "egreso",
        categoria: "egreso_indemnizacion",
        monto: "2500.00",
        origenTipo: "orden_incidente",
        origenId: INCIDENTE_ID,
        descripcion: null,
        registradoPor: null,
      },
    ]);
  });

  it("R37/§9.12: el origen es `orden_incidente`, NO el reservado `gestion_orden`", async () => {
    const { tx } = txCon({ indemnizacion: new Prisma.Decimal("10.00") });
    const movs = await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never);
    expect(movs[0].origenTipo).toBe("orden_incidente");
    expect(movs[0].origenTipo).not.toBe("gestion_orden");
    // Y NO es el del camino del mensajero: los dos egresos coexisten con origenes distintos.
    expect(movs[0].origenTipo).not.toBe("cierre_dia");
  });

  it("la autoria humana NO va en el movimiento (vive en `resuelto_por`/`resuelto_at`)", async () => {
    const { tx } = txCon({ indemnizacion: new Prisma.Decimal("10.00") });
    const movs = await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never);
    expect(movs[0].registradoPor).toBeNull();
    expect(movs[0].descripcion).toBeNull();
  });

  it("R52: solo lee el incidente APROBADO (la guardia va en el WHERE, no en memoria)", async () => {
    const { tx, findFirst } = txCon({ indemnizacion: new Prisma.Decimal("10.00") });

    await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never);

    const arg = findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ id: INCIDENTE_ID, estado: "aprobado" });
  });

  it("un incidente que NO esta aprobado no produce nada (el doble no lo encuentra)", async () => {
    const { tx } = txCon(null);
    expect(await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never)).toEqual([]);
  });

  it.each([
    ["solicitado", "solicitado"],
    ["rechazado", "rechazado"],
  ])(
    "R52 (COMPORTAMIENTO): un incidente `%s` CON monto guardado NO emite nada",
    async (_c, estado) => {
      // El doble honra el `where`: si la guardia `estado: "aprobado"` desapareciera, este caso
      // devolveria la fila y el feed emitiria dinero por un incidente que nadie aprobo. Es la
      // diferencia entre medir la FORMA del where y medir lo que pasa.
      const { tx } = txConEstado(estado, new Prisma.Decimal("2500.00"));
      expect(await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never)).toEqual(
        [],
      );
    },
  );

  it("R52 (control): con el MISMO doble, un `aprobado` SI emite (el arnes no esta siempre mudo)", async () => {
    const { tx } = txConEstado("aprobado", new Prisma.Decimal("2500.00"));
    const movs = await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never);
    expect(movs).toHaveLength(1);
    expect(movs[0].monto).toBe("2500.00");
  });
});

describe("R52/R55 — money-safe de extremo a extremo", () => {
  it.each([
    ["1500.5", "1500.50"],
    ["0.01", "0.01"],
    ["9999999999.99", "9999999999.99"],
    ["1000", "1000.00"],
  ])("un Decimal %s sale como STRING escala 2 (%s)", async (guardado, esperado) => {
    const { tx } = txCon({ indemnizacion: new Prisma.Decimal(guardado) });
    const movs = await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never);
    expect(movs[0].monto).toBe(esperado);
    expect(typeof movs[0].monto).toBe("string");
  });

  it("no acumula error de redondeo: 0.1 + 0.2 guardado como 0.30 sale 0.30", async () => {
    const { tx } = txCon({
      indemnizacion: new Prisma.Decimal("0.1").plus(new Prisma.Decimal("0.2")),
    });
    const movs = await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never);
    expect(movs[0].monto).toBe("0.30");
  });
});

describe("R52 — sin monto valido NO se emite ni una fila en 0.00", () => {
  it.each([
    ["monto ausente (NULL)", null],
    ["monto cero", new Prisma.Decimal("0")],
    ["monto cero con decimales", new Prisma.Decimal("0.00")],
    ["monto negativo (defensa de ultima linea)", new Prisma.Decimal("-5.00")],
  ])("%s -> lista VACIA", async (_caso, indemnizacion) => {
    const { tx } = txCon({ indemnizacion });
    expect(await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never)).toEqual([]);
  });
});

describe("R53/R64 — el feed NO persiste ni conoce el resto del mundo", () => {
  it("no escribe: el `tx` del doble solo expone una lectura y basta", async () => {
    // Si el feed intentara insertar (o leer otra tabla), este doble reventaria. Que pase con un
    // `tx` de UNA sola lectura es la prueba de que su unica responsabilidad es CONSTRUIR.
    const { tx, findFirst } = txCon({ indemnizacion: new Prisma.Decimal("10.00") });
    await feed.construirEgresoIndemnizacionIncidente(INCIDENTE_ID, tx as never);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(Object.keys(tx)).toEqual(["ordenIncidente"]);
  });

  it("R64: dos incidentes distintos producen movimientos con `origen_id` distinto", async () => {
    const a = txCon({ indemnizacion: new Prisma.Decimal("10.00") });
    const b = txCon({ indemnizacion: new Prisma.Decimal("20.00") });
    const movA = await feed.construirEgresoIndemnizacionIncidente("inc-a", a.tx as never);
    const movB = await feed.construirEgresoIndemnizacionIncidente("inc-b", b.tx as never);
    expect(movA[0].origenId).toBe("inc-a");
    expect(movB[0].origenId).toBe("inc-b");
    // Distinto `origen_id` => el indice unico parcial de la 42 NO los deduplica entre si.
    expect(movA[0].origenId).not.toBe(movB[0].origenId);
  });
});
