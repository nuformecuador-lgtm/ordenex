import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import type { CrearLiquidacionPagoInput } from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";

// Feature 172 / T B.1 + T B.4 (mitad del repositorio) — tests unit del LiquidacionPagoRepository
// (mockea Prisma, sin DB). Cubre R7 (las 10 columnas del documento), R9 (fecha real e instante
// de registro conviven y difieren), R80 (las sumas excluyen los anulados) y la mitad de R83/R85
// que solo se puede afirmar AQUI: el `SELECT … FOR UPDATE`.
//
// Por que estas afirmaciones viven en el repositorio y no en el servicio: los tests de servicio
// usan DOBLES y NO ven la traduccion a SQL. Una mutacion del `WHERE` —o quitar el `FOR UPDATE`—
// los pasa en verde. El WHERE se prueba donde vive.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo.

const CREATED_AT = new Date("2026-08-02T15:04:05.000Z"); // instante de REGISTRO
const FECHA_PAGO = new Date("2026-07-30T00:00:00.000Z"); // fecha REAL (medianoche UTC, @db.Date)

function documentoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pago-1",
    claveIdempotencia: "11111111-1111-4111-8111-111111111111",
    mensajeroId: null,
    tiendaId: "t1",
    cierreId: null,
    monto: new Prisma.Decimal("15000.00"),
    metodo: "SINPE",
    referencia: "1234567",
    nota: "Pago parcial de julio",
    fechaPago: FECHA_PAGO,
    registradoPor: "u-admin",
    createdAt: CREATED_AT,
    registrador: { nombre: "Ana Admin" },
    anulacion: null,
    ...overrides,
  };
}

function anulacionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "anu-1",
    pagoId: "pago-1",
    motivo: "Monto mal tecleado",
    anuladoPor: "u-maestro",
    createdAt: new Date("2026-08-03T09:00:00.000Z"),
    anulador: { nombre: "Mario Maestro" },
    ...overrides,
  };
}

function buildPrisma() {
  return {
    liquidacionPago: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    // T B.5: el cierre se LEE (R20/R22) y jamas se escribe (R42). El doble expone tambien las
    // escrituras, espiadas, para poder afirmar que ninguna se usa.
    cierreDia: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
}

/** La fila del cierre tal y como la devuelve Prisma: los dos totales como `Decimal`. */
function cierreRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    mensajeroId: "m1",
    estado: "aprobado",
    totalPagoMensajero: new Prisma.Decimal("50000.00"),
    totalEfectivo: new Prisma.Decimal("12345.6"), // escala 1 a proposito: se normaliza a 2
    ...overrides,
  };
}

function buildRepo(prisma: ReturnType<typeof buildPrisma>) {
  return new LiquidacionPagoRepository(prisma as unknown as PrismaClient);
}

/** Texto de la sentencia cruda, con `?` donde la template tag pone un PARAMETRO. */
function textoDeLaSentencia(call: unknown[]): string {
  const strings = call[0] as TemplateStringsArray;
  return strings.join("?").replace(/\s+/g, " ").trim();
}

/** Un P2002 de Prisma en su forma NATIVA (`meta.target`). */
function p2002Nativo(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.0.0",
    meta: { target },
  });
}

/** El MISMO P2002 tal y como llega bajo el driver adapter de Prisma 7 (sin `meta.target`). */
function p2002Adapter(constraint: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.0.0",
    meta: {
      driverAdapterError: {
        cause: {
          originalMessage: `llave duplicada viola restriccion de unicidad «${constraint}»`,
        },
      },
    },
  });
}

const INPUT: CrearLiquidacionPagoInput = {
  claveIdempotencia: "11111111-1111-4111-8111-111111111111",
  mensajeroId: null,
  tiendaId: "t1",
  cierreId: null,
  monto: "15000.00",
  metodo: "SINPE",
  referencia: "1234567",
  nota: "Pago parcial de julio",
  fechaPago: FECHA_PAGO,
  registradoPor: "u-admin",
};

describe("LiquidacionPagoRepository.crear (R7/R9)", () => {
  it("R7: escribe las 10 columnas del documento, con el monto como Decimal", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockResolvedValue(documentoRow());
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, INPUT);

    expect(r.status).toBe("creado");
    const arg = prisma.liquidacionPago.create.mock.calls[0][0];
    // Las 10 columnas que el emisor decide (`created_at` lo pone la base).
    expect(Object.keys(arg.data).sort()).toEqual(
      [
        "claveIdempotencia",
        "mensajeroId",
        "tiendaId",
        "cierreId",
        "monto",
        "metodo",
        "referencia",
        "nota",
        "fechaPago",
        "registradoPor",
      ].sort(),
    );
    expect(arg.data).toMatchObject({
      claveIdempotencia: INPUT.claveIdempotencia,
      mensajeroId: null,
      tiendaId: "t1",
      cierreId: null,
      metodo: "SINPE",
      referencia: "1234567",
      nota: "Pago parcial de julio",
      fechaPago: FECHA_PAGO,
      registradoPor: "u-admin",
    });
    // Money-safe: STRING -> Prisma.Decimal al escribir (nunca un number por el medio).
    expect(arg.data.monto).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data.monto.toFixed(2)).toBe("15000.00");
    // R7: el documento NO lleva `created_at` del emisor; el instante lo sella la base.
    expect(arg.data).not.toHaveProperty("createdAt");
  });

  it("R9: la fecha REAL del pago y el instante de registro salen como dos datos distintos", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockResolvedValue(documentoRow());
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, INPUT);

    expect(r).toMatchObject({ status: "creado" });
    if (r.status !== "creado") return;
    expect(r.pago.fechaPago).toBe("2026-07-30"); // el dia en que el dinero cambio de manos
    expect(r.pago.registradoAt).toBe("2026-08-02T15:04:05.000Z"); // cuando se tecleo
    expect(r.pago.fechaPago).not.toBe(r.pago.registradoAt.slice(0, 10)); // difieren, y los dos viven
  });

  it("R9: los conserva aunque coincidan (un pago registrado el mismo dia)", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockResolvedValue(
      documentoRow({ fechaPago: new Date("2026-08-02T00:00:00.000Z") }),
    );
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, INPUT);
    if (r.status !== "creado") throw new Error("esperaba creado");
    expect(r.pago.fechaPago).toBe("2026-08-02");
    expect(r.pago.registradoAt).toBe("2026-08-02T15:04:05.000Z");
  });

  it("el comprobante sale con NOMBRES, no con ids de personas (R56)", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockResolvedValue(documentoRow());
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, INPUT);
    if (r.status !== "creado") throw new Error("esperaba creado");
    expect(r.pago.registradoPorNombre).toBe("Ana Admin");
    expect(JSON.stringify(r.pago)).not.toContain("u-admin");
    // Money-safe: el monto cruza como STRING de escala 2.
    expect(r.pago.monto).toBe("15000.00");
    expect(typeof r.pago.monto).toBe("string");
  });

  it("§4.1: el choque de la clave es un RESULTADO, no una excepcion que suba (forma nativa)", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockRejectedValue(p2002Nativo(["clave_idempotencia"]));
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, INPUT);

    expect(r).toEqual({ status: "clave_repetida" });
  });

  it("§4.1: tambien bajo el driver adapter de Prisma 7, donde `meta.target` viene vacio", async () => {
    // La cicatriz de `_shared/prisma-unique.ts`: con el adapter el nombre de la constraint solo
    // esta en el mensaje original. Un handler que leyera `meta.target` dejaria escalar el P2002
    // crudo a un 500 y el doble submit acabaria en pantalla de error en vez de en `ya_registrado`.
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockRejectedValue(
      p2002Adapter("liquidacion_pago_clave_idempotencia_key"),
    );
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, INPUT);

    expect(r).toEqual({ status: "clave_repetida" });
  });

  it("un P2002 de OTRA restriccion se propaga: no se disfraza de doble submit", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockRejectedValue(
      p2002Adapter("liquidacion_anulacion_pago_id_key"),
    );
    const repo = buildRepo(prisma);

    await expect(
      repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, INPUT),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("un error que NO es P2002 se propaga tal cual", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockRejectedValue(new Error("conexion caida"));
    const repo = buildRepo(prisma);

    await expect(
      repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, INPUT),
    ).rejects.toThrow("conexion caida");
  });
});

describe("LiquidacionPagoRepository.bloquearBeneficiario (R83/R85, §4.2)", () => {
  it("la tienda se serializa bloqueando SU fila de `usuario`, con FOR UPDATE", async () => {
    const prisma = buildPrisma();
    const repo = buildRepo(prisma);

    await repo.bloquearBeneficiario({ $queryRaw: prisma.$queryRaw } as never, {
      tipo: "tienda",
      tiendaId: "t1",
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); // R85: UNA adquisicion
    const call = prisma.$queryRaw.mock.calls[0];
    const texto = textoDeLaSentencia(call);
    expect(texto).toContain('FROM "usuario"');
    expect(texto).toContain("FOR UPDATE");
    expect(texto).not.toContain("cierre_dia");
    // El id va como PARAMETRO, no interpolado en el texto de la sentencia.
    expect(call.slice(1)).toEqual(["t1"]);
    expect(texto).not.toContain("t1");
  });

  it("el pago al mensajero bloquea la fila del CIERRE, que es el grano exacto de su pendiente", async () => {
    const prisma = buildPrisma();
    const repo = buildRepo(prisma);

    await repo.bloquearBeneficiario({ $queryRaw: prisma.$queryRaw } as never, {
      tipo: "cierre",
      cierreId: "c1",
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const call = prisma.$queryRaw.mock.calls[0];
    const texto = textoDeLaSentencia(call);
    expect(texto).toContain('FROM "cierre_dia"');
    expect(texto).toContain("FOR UPDATE");
    // NO se toca `usuario`, que es fila caliente (sesiones, perfil): dos pagos a cierres
    // distintos del mismo mensajero no se estorban.
    expect(texto).not.toContain("usuario");
    expect(call.slice(1)).toEqual(["c1"]);
  });

  it("bloquea EXACTAMENTE una fila, por igualdad de id (nunca un rango ni la tabla entera)", async () => {
    const prisma = buildPrisma();
    const repo = buildRepo(prisma);

    await repo.bloquearBeneficiario({ $queryRaw: prisma.$queryRaw } as never, {
      tipo: "tienda",
      tiendaId: "t1",
    });

    const texto = textoDeLaSentencia(prisma.$queryRaw.mock.calls[0]);
    expect(texto).toMatch(/WHERE "id" = \? FOR UPDATE$/);
    // Sin `SKIP LOCKED`: aqui la segunda transaccion debe ESPERAR, no saltarse la fila (a
    // diferencia de la cola de jobs, donde saltarsela es justo lo que se quiere).
    expect(texto).not.toContain("SKIP LOCKED");
    expect(texto).not.toContain("NOWAIT");
  });
});

describe("LiquidacionPagoRepository — las sumas excluyen los anulados (R80, §5)", () => {
  it("sumarVigentesPorTienda filtra por AUSENCIA de fila en `liquidacion_anulacion`", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.aggregate.mockResolvedValue({
      _sum: { monto: new Prisma.Decimal("15000.00") },
    });
    const repo = buildRepo(prisma);

    const total = await repo.sumarVigentesPorTienda("t1");

    const arg = prisma.liquidacionPago.aggregate.mock.calls[0][0];
    // ESTE es el where que ningun doble de servicio ve: sin `anulacion: { is: null }` la suma
    // contaria los pagos anulados y el disponible saldria BAJO (se pagaria de menos).
    expect(arg.where).toEqual({ tiendaId: "t1", anulacion: { is: null } });
    expect(arg._sum).toEqual({ monto: true });
    expect(total).toBe("15000.00");
    expect(typeof total).toBe("string");
  });

  it("una tienda sin pagos vigentes suma 0.00 (no null, no undefined)", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.aggregate.mockResolvedValue({ _sum: { monto: null } });
    const repo = buildRepo(prisma);
    expect(await repo.sumarVigentesPorTienda("t1")).toBe("0.00");
  });

  it("sumarVigentesPorCierre agrupa con el mismo filtro y en UNA sola consulta", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.groupBy.mockResolvedValue([
      { cierreId: "c1", _sum: { monto: new Prisma.Decimal("30000.00") } },
      { cierreId: "c2", _sum: { monto: new Prisma.Decimal("1234.56") } },
    ]);
    const repo = buildRepo(prisma);

    const total = await repo.sumarVigentesPorCierre(["c1", "c2", "c3"]);

    expect(prisma.liquidacionPago.groupBy).toHaveBeenCalledTimes(1); // no crece con la pagina
    const arg = prisma.liquidacionPago.groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(["cierreId"]);
    expect(arg.where).toEqual({ cierreId: { in: ["c1", "c2", "c3"] }, anulacion: { is: null } });
    // Una entrada por CADA id pedido: `c3` no tiene pagos y viene con "0.00", no ausente.
    expect(total).toEqual({ c1: "30000.00", c2: "1234.56", c3: "0.00" });
  });

  it("sin cierres que consultar no toca la base", async () => {
    const prisma = buildPrisma();
    const repo = buildRepo(prisma);
    expect(await repo.sumarVigentesPorCierre([])).toEqual({});
    expect(prisma.liquidacionPago.groupBy).not.toHaveBeenCalled();
  });
});

describe("LiquidacionPagoRepository — los LISTADOS si traen los anulados (R74)", () => {
  it("listarPorTienda no filtra por vigencia y devuelve el pago anulado con su bloque", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.findMany.mockResolvedValue([
      documentoRow({ anulacion: anulacionRow() }),
    ]);
    const repo = buildRepo(prisma);

    const filas = await repo.listarPorTienda("t1");

    const arg = prisma.liquidacionPago.findMany.mock.calls[0][0];
    // El contraste con las sumas es el punto: la lista NO lleva `anulacion: { is: null }`. Un
    // pago anulado deja de descontar (R80) pero NO deja de verse (R74).
    expect(arg.where).toEqual({ tiendaId: "t1" });
    expect(arg.orderBy).toEqual([{ fechaPago: "desc" }, { createdAt: "desc" }]);
    expect(filas[0].anulacion).toEqual({
      motivo: "Monto mal tecleado",
      anuladoPorNombre: "Mario Maestro",
      anuladoAt: "2026-08-03T09:00:00.000Z",
    });
    // Y sigue mostrando TODOS sus datos originales, intactos.
    expect(filas[0]).toMatchObject({
      monto: "15000.00",
      metodo: "SINPE",
      referencia: "1234567",
      nota: "Pago parcial de julio",
      fechaPago: "2026-07-30",
      registradoPorNombre: "Ana Admin",
    });
  });

  it("listarPorCierre acota por cierre y marca `anulacion: null` en los vigentes", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.findMany.mockResolvedValue([
      documentoRow({ mensajeroId: "m1", tiendaId: null, cierreId: "c1" }),
    ]);
    const repo = buildRepo(prisma);

    const filas = await repo.listarPorCierre("c1");

    expect(prisma.liquidacionPago.findMany.mock.calls[0][0].where).toEqual({ cierreId: "c1" });
    expect(filas[0].anulacion).toBeNull(); // null = VIGENTE (estado derivado, no un flag)
  });
});

describe("LiquidacionPagoRepository — relecturas por clave y por id (§4.1/R70)", () => {
  it("obtenerPorClave busca por el UNIQUE de la clave de idempotencia", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.findUnique.mockResolvedValue(documentoRow());
    const repo = buildRepo(prisma);

    const pago = await repo.obtenerPorClave(INPUT.claveIdempotencia);

    expect(prisma.liquidacionPago.findUnique.mock.calls[0][0].where).toEqual({
      claveIdempotencia: INPUT.claveIdempotencia,
    });
    expect(pago?.id).toBe("pago-1");
  });

  it("una clave nunca usada devuelve null (y no un objeto vacio)", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.findUnique.mockResolvedValue(null);
    const repo = buildRepo(prisma);
    expect(await repo.obtenerPorClave("no-existe")).toBeNull();
  });

  it("R70: obtenerPorId trae el pago con su beneficiario, para leer el monto server-side", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.findUnique.mockResolvedValue(documentoRow());
    const repo = buildRepo(prisma);

    const pago = await repo.obtenerPorId("pago-1");

    expect(prisma.liquidacionPago.findUnique.mock.calls[0][0].where).toEqual({ id: "pago-1" });
    expect(pago?.monto).toBe("15000.00");
    expect(pago?.tiendaId).toBe("t1"); // el servicio necesita saber a QUIEN se le pago
  });
});

// ── T B.5: la lectura del cierre contra el que se paga (R20/R21/R22/R42) ──

describe("LiquidacionPagoRepository.obtenerCierreParaPago (R20/R22/R42)", () => {
  it("lee SOLO las cinco columnas que el pago necesita y devuelve los montos como STRING", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findUnique.mockResolvedValue(cierreRow());
    const repo = buildRepo(prisma);

    const cierre = await repo.obtenerCierreParaPago("c1");

    // `select` explicito: de una tabla que esta feature no gobierna no se trae nada de mas.
    expect(prisma.cierreDia.findUnique.mock.calls[0][0]).toEqual({
      where: { id: "c1" },
      select: {
        id: true,
        mensajeroId: true,
        estado: true,
        totalPagoMensajero: true,
        totalEfectivo: true,
      },
    });
    expect(cierre).toEqual({
      id: "c1",
      mensajeroId: "m1",
      estado: "aprobado",
      totalPagoMensajero: "50000.00",
      totalEfectivo: "12345.60", // Decimal -> STRING escala 2 (money-safe)
    });
  });

  it("R20: con `tx` la guardia se lee EN LA TRANSACCION, no en el cliente propio", async () => {
    const prisma = buildPrisma();
    const tx = { cierreDia: { findUnique: vi.fn().mockResolvedValue(cierreRow()) } };
    const repo = buildRepo(prisma);

    await repo.obtenerCierreParaPago("c1", tx as never);

    expect(tx.cierreDia.findUnique).toHaveBeenCalledTimes(1);
    // Y el cliente propio NO se toca: leer fuera de la transaccion dejaria una ventana entre la
    // comprobacion del estado y la escritura del pago.
    expect(prisma.cierreDia.findUnique).not.toHaveBeenCalled();
  });

  it("un cierre que no existe devuelve null (y no un objeto con ceros)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findUnique.mockResolvedValue(null);
    const repo = buildRepo(prisma);

    expect(await repo.obtenerCierreParaPago("no-existe")).toBeNull();
  });

  it("R42: leerlo no ESCRIBE nada en el cierre", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findUnique.mockResolvedValue(cierreRow());
    const repo = buildRepo(prisma);

    await repo.obtenerCierreParaPago("c1");

    for (const metodo of ["update", "updateMany", "create", "delete", "upsert"] as const) {
      expect(prisma.cierreDia[metodo], `cierreDia.${metodo}`).not.toHaveBeenCalled();
    }
  });

  it("el estado llega tal cual: quien decide si `aprobado` deja pagar es el SERVICIO", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findUnique.mockResolvedValue(cierreRow({ estado: "rechazado" }));
    const repo = buildRepo(prisma);

    // El repositorio no filtra por estado ni lanza: solo trae la fila (sin logica de negocio).
    const cierre = await repo.obtenerCierreParaPago("c1");
    expect(cierre?.estado).toBe("rechazado");
    expect(prisma.cierreDia.findUnique.mock.calls[0][0].where).toEqual({ id: "c1" });
  });
});
