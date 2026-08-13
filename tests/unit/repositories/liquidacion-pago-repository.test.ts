import { describe, it, expect, vi } from "vitest";
import { CierreEstado, Prisma, type PrismaClient } from "@prisma/client";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import type { CrearLiquidacionPagoInput } from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// Feature 172 / T B.1 + T B.4 + T F.1 (mitad del repositorio) — tests unit del
// LiquidacionPagoRepository (mockea Prisma, sin DB). Cubre R7 (las 10 columnas del documento),
// R9 (fecha real e instante de registro conviven y difieren), R80 (las sumas excluyen los
// anulados), R73/R75 (la ANULACION: actor e instante persistidos; el segundo intento devuelve
// `ya_anulado` SIN insertar y sin tocar la fila del pago) y la mitad de R83/R85 que solo se
// puede afirmar AQUI: el `SELECT … FOR UPDATE`.
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
      // T F.1: las ESCRITURAS del pago, espiadas. Existen en el doble para poder afirmar que
      // anular no llama a NINGUNA (R41/R74: el pago es una fila inmutable).
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    // T F.1: la tabla de la anulacion. Mismo criterio: tambien con sus escrituras espiadas.
    liquidacionAnulacion: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    // T B.5: el cierre se LEE (R20/R22) y jamas se escribe (R42). El doble expone tambien las
    // escrituras, espiadas, para poder afirmar que ninguna se usa.
    cierreDia: {
      findUnique: vi.fn(),
      // Feature 205 (T2.2): el listado de imputables. Mismo criterio que arriba — se LEE y jamas
      // se escribe, y las escrituras siguen espiadas para poder afirmarlo.
      findMany: vi.fn(),
      // Feature 205 (T3.1, enmienda): el CONTEO por estado de R36 lo agrega la base. Esta aqui
      // junto a `findMany` a proposito: los dos espiados es lo que permite afirmar que el conteo
      // NO se hace trayendo las filas y contandolas en memoria.
      groupBy: vi.fn(),
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
  repartoId: null, // feature 205 (T2.2): pago suelto, no nace de ningun reparto
};

describe("LiquidacionPagoRepository.crear (R7/R9)", () => {
  it("R7: escribe las 11 columnas del documento, con el monto como Decimal", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockResolvedValue(documentoRow());
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, INPUT);

    expect(r.status).toBe("creado");
    const arg = prisma.liquidacionPago.create.mock.calls[0][0];
    // Las 11 columnas que el emisor decide (`created_at` lo pone la base): las 10 de la 172 mas
    // `repartoId` (feature 205/T2.2). La lista es EXHAUSTIVA a proposito: una columna nueva
    // escrita en silencio rompe este caso.
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
        "repartoId",
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

  // ── Feature 205 (T2.2/T2.3, R28): el pago se ata a su ACTO ──

  it("205/R28: emite `reparto_id` cuando el pago nace de un reparto", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockResolvedValue(documentoRow());
    const repo = buildRepo(prisma);

    await repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, {
      ...INPUT,
      mensajeroId: "m1",
      tiendaId: null,
      cierreId: "c1",
      repartoId: "rep-1",
    });

    expect(prisma.liquidacionPago.create.mock.calls[0][0].data.repartoId).toBe("rep-1");
  });

  it("205/R51: y emite `null` cuando no nace de ninguno — la clave SE EMITE, no se omite", async () => {
    // La diferencia entre `repartoId: null` y no mandar la clave no es cosmetica: con la clave
    // ausente, un `data` construido con spreads condicionales dejaria de decir nada sobre la
    // columna, y el dia que el caller se olvidara de pasarla el pago quedaria sin atar sin que
    // nada se queje. `null` es el DATO «pago suelto contra un cierre».
    const prisma = buildPrisma();
    prisma.liquidacionPago.create.mockResolvedValue(documentoRow());
    const repo = buildRepo(prisma);

    await repo.crear({ liquidacionPago: prisma.liquidacionPago } as never, INPUT);

    const { data } = prisma.liquidacionPago.create.mock.calls[0][0];
    expect(data).toHaveProperty("repartoId");
    expect(data.repartoId).toBeNull();
  });
});

// ── Feature 205 (T2.2/T2.3) — las dos LECTURAS nuevas. El WHERE se prueba donde vive ──

/** La fila de `cierre_dia` tal como la devuelve Prisma para el listado de imputables. */
function cierreImputableRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    mensajeroId: "m1",
    estado: "aprobado",
    totalPagoMensajero: new Prisma.Decimal("50000.00"),
    totalEfectivo: new Prisma.Decimal("12345.6"), // escala 1 a proposito: se normaliza a 2
    solicitadoAt: new Date("2026-07-05T10:00:00.000Z"),
    ...overrides,
  };
}

describe("LiquidacionPagoRepository.listarCierresImputables (205 / R5/R6/R8)", () => {
  it("R5/R24 — EL WHERE: filtra por mensajero Y por estado `aprobado`, los dos", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([cierreImputableRow()]);
    const repo = buildRepo(prisma);

    await repo.listarCierresImputables("m1");

    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    // ESTE es el where que ningun doble de servicio ve. Sin `estado`, el reparto imputaria a
    // cierres `solicitado`/`rechazado`/`vencido`, que no han devengado nada; sin `mensajeroId`,
    // a los cierres de OTRA persona (R24). Igualdad exacta: ni una clave de mas.
    expect(arg.where).toEqual({ mensajeroId: "m1", estado: "aprobado" });
  });

  it("R8 — EL ORDEN: `solicitadoAt` asc con desempate por `id` asc, y NUNCA por `resueltoAt`", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const repo = buildRepo(prisma);

    await repo.listarCierresImputables("m1");

    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual([{ solicitadoAt: "asc" }, { id: "asc" }]);
    // Q1/design §2.4: ordenar por la fecha de APROBACION haria que la prioridad de cobro la
    // fijara la latencia administrativa. Aqui no se nombra ni para leerla.
    expect(JSON.stringify(arg)).not.toContain("resueltoAt");
  });

  it("R53/§2.5.6 — SIN `take`: el tope acota la ESCRITURA, no la lectura", async () => {
    // La previsualizacion necesita TODOS los imputables para decir cuantos quedan fuera de la
    // ventana y cuanto suman (R56). Un `take` aqui haria que el aviso mintiera y que la deuda no
    // imputable de R37 se midiera contra un conjunto recortado.
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const repo = buildRepo(prisma);

    await repo.listarCierresImputables("m1");

    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(arg).not.toHaveProperty("take");
    expect(arg).not.toHaveProperty("skip");
    expect(arg).not.toHaveProperty("cursor");
  });

  it("lee SEIS columnas del cierre y emite los montos como STRING de escala 2", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([cierreImputableRow()]);
    const repo = buildRepo(prisma);

    const cierres = await repo.listarCierresImputables("m1");

    expect(prisma.cierreDia.findMany.mock.calls[0][0].select).toEqual({
      id: true,
      mensajeroId: true,
      estado: true,
      totalPagoMensajero: true,
      totalEfectivo: true,
      solicitadoAt: true,
    });
    expect(cierres).toEqual([
      {
        id: "c1",
        mensajeroId: "m1",
        estado: "aprobado",
        totalPagoMensajero: "50000.00",
        totalEfectivo: "12345.60", // Decimal -> STRING escala 2 (money-safe)
        solicitadoAt: "2026-07-05T10:00:00.000Z",
      },
    ]);
    // El PENDIENTE no sale de aqui: se deriva en el servicio (R6). Un pendiente calculado en el
    // repositorio seria logica de negocio en la capa equivocada.
    expect(cierres[0]).not.toHaveProperty("pendiente");
  });

  it("R23: con `tx` la relectura ocurre EN LA TRANSACCION, no en el cliente propio", async () => {
    const prisma = buildPrisma();
    const tx = { cierreDia: { findMany: vi.fn().mockResolvedValue([cierreImputableRow()]) } };
    const repo = buildRepo(prisma);

    await repo.listarCierresImputables("m1", tx as never);

    expect(tx.cierreDia.findMany).toHaveBeenCalledTimes(1);
    // Leer fuera de la transaccion dejaria una ventana entre el bloqueo y la escritura.
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });

  it("R26: listarlos no ESCRIBE nada en el cierre", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([cierreImputableRow()]);
    const repo = buildRepo(prisma);

    await repo.listarCierresImputables("m1");

    for (const metodo of ["update", "updateMany", "create", "delete", "upsert"] as const) {
      expect(prisma.cierreDia[metodo], `cierreDia.${metodo}`).not.toHaveBeenCalled();
    }
  });

  it("un mensajero sin cierres aprobados devuelve la lista vacia (no null)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const repo = buildRepo(prisma);
    expect(await repo.listarCierresImputables("m1")).toEqual([]);
  });
});

describe("LiquidacionPagoRepository.contarCierresNoAprobadosPorEstado (205 / T3.1, R36)", () => {
  /** Los grupos tal y como los devuelve un `groupBy` de Prisma: `_count._all` por grupo. */
  function grupo(estado: string, cantidad: number) {
    return { estado, _count: { _all: cantidad } };
  }

  it("R36 — EL WHERE: el mensajero Y el complemento EXACTO de `aprobado`", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue([]);
    const repo = buildRepo(prisma);

    await repo.contarCierresNoAprobadosPorEstado("m1");

    const arg = prisma.cierreDia.groupBy.mock.calls[0][0];
    // Igualdad EXACTA, y el `not` es lo que se mide: sin el, el conteo incluiria tambien los
    // cierres APROBADOS y la pantalla daria por excluido lo que si se puede pagar aqui mismo.
    // `not: aprobado` y no una lista de estados escrita a mano: con una lista, un estado nuevo
    // del enum se quedaria fuera del aviso en silencio y esos cierres DESAPARECERIAN, que es
    // justo lo que R36 existe para impedir. Y sin `mensajeroId`, contaria los de otra persona.
    expect(arg.where).toEqual({ mensajeroId: "m1", estado: { not: "aprobado" } });
  });

  it("R36 — AGREGA EN LA BASE: es un `groupBy`, y `findMany` no se llama ni una vez", async () => {
    // El corazon de la enmienda. Traer las filas y contarlas en memoria daria el MISMO numero y
    // dejaria intacto el problema: N filas sin tope viajando desde la base, que es lo que un
    // mensajero con dos años de cierres rechazados convertia en un payload enorme. Lo acotado no
    // es lo que se devuelve, es lo que se LEE — y eso solo se ve aqui.
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue([grupo("rechazado", 9)]);
    const repo = buildRepo(prisma);

    await repo.contarCierresNoAprobadosPorEstado("m1");

    expect(prisma.cierreDia.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
    expect(prisma.cierreDia.findUnique).not.toHaveBeenCalled();
    // Y el conteo lo pide la consulta, no el proceso.
    expect(prisma.cierreDia.groupBy.mock.calls[0][0]._count).toEqual({ _all: true });
  });

  it("R36 — agrupa por ESTADO y por nada mas: agrupar por otra columna devolveria la lista", async () => {
    // Con `by: ["solicitadoAt"]` —o con el `id` dentro— vuelve a salir practicamente una fila por
    // cierre, con otro nombre y sin tope: la enmienda quedaria deshecha sin que ningun test de
    // servicio se enterase. Y R36 pide decir POR QUE quedan fuera, que es exactamente el estado.
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue([]);
    const repo = buildRepo(prisma);

    await repo.contarCierresNoAprobadosPorEstado("m1");

    expect(prisma.cierreDia.groupBy.mock.calls[0][0].by).toEqual(["estado"]);
  });

  it("R36 — es el COMPLEMENTO de los imputables: ni un cierre en las dos lecturas, ni uno fuera", async () => {
    // Las dos consultas juntas tienen que cubrir TODOS los cierres del mensajero y ninguno dos
    // veces. Se mide comparando los dos `where` reales, que es donde vive la particion.
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([]);
    prisma.cierreDia.groupBy.mockResolvedValue([]);
    const repo = buildRepo(prisma);

    await repo.listarCierresImputables("m1");
    await repo.contarCierresNoAprobadosPorEstado("m1");

    const imputables = prisma.cierreDia.findMany.mock.calls[0][0].where;
    const excluidos = prisma.cierreDia.groupBy.mock.calls[0][0].where;
    expect(imputables.mensajeroId).toBe(excluidos.mensajeroId);
    expect(imputables.estado).toBe("aprobado");
    expect(excluidos.estado).toEqual({ not: "aprobado" });
  });

  it("R36/§7.2 — la consulta NO pide ningun monto: un cierre no aprobado no ha devengado nada", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue([grupo("solicitado", 3)]);
    const repo = buildRepo(prisma);

    await repo.contarCierresNoAprobadosPorEstado("m1");

    const arg = prisma.cierreDia.groupBy.mock.calls[0][0];
    // Un conteo no es un monto: ni `_sum`, ni `_avg`, ni una columna de dinero por ningun lado.
    expect(arg).not.toHaveProperty("_sum");
    expect(arg).not.toHaveProperty("_avg");
    expect(JSON.stringify(arg)).not.toContain("total");
    expect(JSON.stringify(arg)).not.toContain("Efectivo");
  });

  it("devuelve `{ estado, cantidad }` por grupo: el CONTEO, sin ningun cierre nombrado", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue([grupo("rechazado", 9), grupo("solicitado", 3)]);
    const repo = buildRepo(prisma);

    const excluidos = await repo.contarCierresNoAprobadosPorEstado("m1");

    expect(excluidos).toEqual([
      { estado: "rechazado", cantidad: 9 },
      { estado: "solicitado", cantidad: 3 },
    ]);
    // Se perdio poder nombrar un cierre concreto en el aviso (antes viajaba su `solicitadoAt`) y
    // es el precio aceptado de que la respuesta este acotada. Volver a emitir el id o la fecha
    // es deshacer la decision, no arreglar un olvido.
    for (const fila of excluidos) {
      expect(Object.keys(fila).sort()).toEqual(["cantidad", "estado"]);
    }
  });

  it("ACOTADO POR CONSTRUCCION: nunca mas entradas que valores tiene `CierreEstado`", async () => {
    // El tamaño de la respuesta depende del enum, no del historial: por eso esta lectura no
    // necesita `take` ni recorte. Se comprueba con el enum REAL de Prisma, no con una lista
    // escrita aqui: si un dia el enum crece, el limite crece con el y sigue siendo finito.
    const estados = Object.values(CierreEstado).filter((estado) => estado !== "aprobado");
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue(estados.map((estado) => grupo(estado, 900)));
    const repo = buildRepo(prisma);

    const excluidos = await repo.contarCierresNoAprobadosPorEstado("m1");

    expect(excluidos.length).toBe(estados.length);
    expect(excluidos.length).toBeLessThan(Object.values(CierreEstado).length);
    // 900 cierres por estado y la respuesta sigue teniendo un puñado de filas.
    expect(excluidos.every((fila) => fila.cantidad === 900)).toBe(true);
    expect(prisma.cierreDia.groupBy.mock.calls[0][0]).not.toHaveProperty("take");
  });

  it("orden determinista por `estado`: dos llamadas iguales pintan igual", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue([]);
    const repo = buildRepo(prisma);

    await repo.contarCierresNoAprobadosPorEstado("m1");

    expect(prisma.cierreDia.groupBy.mock.calls[0][0].orderBy).toEqual({ estado: "asc" });
  });

  it("R26: contarlos tampoco ESCRIBE nada en el cierre", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue([]);
    const repo = buildRepo(prisma);

    await repo.contarCierresNoAprobadosPorEstado("m1");

    for (const metodo of ["update", "updateMany", "create", "delete", "upsert"] as const) {
      expect(prisma.cierreDia[metodo], `cierreDia.${metodo}`).not.toHaveBeenCalled();
    }
  });
});

describe("LiquidacionPagoRepository.listarPorReparto (205 / R28)", () => {
  it("acota por `reparto_id` — es lo que reconstruye el resultado original en vez de inferirlo", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.findMany.mockResolvedValue([
      documentoRow({ mensajeroId: "m1", tiendaId: null, cierreId: "c1" }),
    ]);
    const repo = buildRepo(prisma);

    const filas = await repo.listarPorReparto("rep-1");

    const arg = prisma.liquidacionPago.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ repartoId: "rep-1" });
    expect(arg.orderBy).toEqual([{ fechaPago: "desc" }, { createdAt: "desc" }]);
    expect(filas[0].cierreId).toBe("c1"); // cada imputacion conserva SU cierre (R18)
    expect(filas[0].monto).toBe("15000.00");
  });

  it("R74: trae tambien los ANULADOS, igual que el listado por cierre", async () => {
    // Un pago anulado deja de descontar (R80) pero NO deja de verse. Si este listado filtrara
    // por vigencia, la respuesta idempotente de un reparto con una imputacion anulada mostraria
    // menos filas de las que ese acto escribio.
    const prisma = buildPrisma();
    prisma.liquidacionPago.findMany.mockResolvedValue([
      documentoRow({ anulacion: anulacionRow() }),
    ]);
    const repo = buildRepo(prisma);

    const filas = await repo.listarPorReparto("rep-1");

    expect(prisma.liquidacionPago.findMany.mock.calls[0][0].where).toEqual({ repartoId: "rep-1" });
    expect(prisma.liquidacionPago.findMany.mock.calls[0][0].where).not.toHaveProperty("anulacion");
    expect(filas[0].anulacion?.motivo).toBe("Monto mal tecleado");
  });

  it("un reparto sin pagos devuelve la lista vacia", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionPago.findMany.mockResolvedValue([]);
    const repo = buildRepo(prisma);
    expect(await repo.listarPorReparto("rep-1")).toEqual([]);
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

// ── T F.1: la ANULACION (R73/R75). Anular es AÑADIR una fila, jamas tocar la del pago ──

/**
 * Mini-store del `UNIQUE(pago_id)` de `liquidacion_anulacion`. No es un mock que «devuelve lo
 * que se le dice»: guarda las filas y RECHAZA la segunda del mismo pago, que es lo que hace
 * observable el criterio de T F.1 — «el segundo intento devuelve `ya_anulado` **sin insertar**».
 * Con un `mockRejectedValueOnce` no se podria contar cuantas filas quedaron.
 */
function storeDeAnulaciones(adapter = false) {
  const filas: Array<Record<string, unknown>> = [];
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (filas.some((f) => f.pagoId === data.pagoId)) {
      throw adapter
        ? p2002Adapter("liquidacion_anulacion_pago_id_key")
        : p2002Nativo(["pago_id"]);
    }
    const fila = {
      id: `anu-${filas.length + 1}`,
      ...data,
      createdAt: new Date("2026-08-03T09:00:00.000Z"),
      anulador: { nombre: "Mario Maestro" },
    };
    filas.push(fila);
    return fila;
  });
  return { filas, create };
}

const ANULAR = { pagoId: "pago-1", motivo: "Monto mal tecleado", anuladoPor: "u-maestro" };

describe("LiquidacionPagoRepository.anular (R73/R75)", () => {
  it("R73: escribe las TRES columnas de la anulacion y devuelve quien y cuando", async () => {
    const prisma = buildPrisma();
    const store = storeDeAnulaciones();
    prisma.liquidacionAnulacion.create = store.create;
    const repo = buildRepo(prisma);

    const r = await repo.anular(
      { liquidacionAnulacion: prisma.liquidacionAnulacion } as never,
      ANULAR,
    );

    const arg = store.create.mock.calls[0][0] as { data: Record<string, unknown> };
    // Las 3 que decide el emisor. El `id` y el instante los pone la base, igual que en el pago.
    expect(Object.keys(arg.data).sort()).toEqual(["anuladoPor", "motivo", "pagoId"]);
    expect(arg.data).toEqual({
      pagoId: "pago-1",
      motivo: "Monto mal tecleado",
      anuladoPor: "u-maestro",
    });
    expect(arg.data).not.toHaveProperty("createdAt");
    // R70/R76: no hay ninguna columna de MONTO en la anulacion. El del contraasiento sale del
    // pago, en el servidor, y no hay por donde pedir una anulacion parcial.
    expect(arg.data).not.toHaveProperty("monto");

    expect(r).toEqual({
      status: "anulado",
      anulacion: {
        motivo: "Monto mal tecleado",
        anuladoPorNombre: "Mario Maestro", // R56: NOMBRE, no id
        anuladoAt: "2026-08-03T09:00:00.000Z", // R73: el instante
      },
    });
    expect(JSON.stringify(r)).not.toContain("u-maestro");
  });

  it("R75: el SEGUNDO intento devuelve `ya_anulado` y NO inserta nada", async () => {
    const prisma = buildPrisma();
    const store = storeDeAnulaciones();
    prisma.liquidacionAnulacion.create = store.create;
    const repo = buildRepo(prisma);
    const tx = { liquidacionAnulacion: prisma.liquidacionAnulacion } as never;

    const primera = await repo.anular(tx, ANULAR);
    const segunda = await repo.anular(tx, { ...ANULAR, motivo: "Otro motivo, otro actor" });

    expect(primera.status).toBe("anulado");
    expect(segunda).toEqual({ status: "ya_anulado" }); // R75, y NO una excepcion que suba
    // «Sin insertar», medido contando filas: queda UNA, la de la primera vez, con SU motivo.
    expect(store.filas).toHaveLength(1);
    expect(store.filas[0]).toMatchObject({ motivo: "Monto mal tecleado" });
    // R44 (misma filosofia que la clave): el INSERT se INTENTA las dos veces; quien dice que no
    // es la restriccion, no un `SELECT` previo del repositorio.
    expect(store.create).toHaveBeenCalledTimes(2);
  });

  it("R75: tambien bajo el driver adapter de Prisma 7, donde `meta.target` viene vacio", async () => {
    // La cicatriz de `_shared/prisma-unique.ts`: leyendo solo `meta.target`, el segundo intento
    // escalaria a un 500 en vez de responder `ya_anulado`.
    const prisma = buildPrisma();
    const store = storeDeAnulaciones(true);
    prisma.liquidacionAnulacion.create = store.create;
    const repo = buildRepo(prisma);
    const tx = { liquidacionAnulacion: prisma.liquidacionAnulacion } as never;

    await repo.anular(tx, ANULAR);
    expect(await repo.anular(tx, ANULAR)).toEqual({ status: "ya_anulado" });
    expect(store.filas).toHaveLength(1);
  });

  it("un P2002 de OTRA restriccion se propaga: no se disfraza de `ya_anulado`", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionAnulacion.create.mockRejectedValue(
      p2002Adapter("liquidacion_pago_clave_idempotencia_key"),
    );
    const repo = buildRepo(prisma);

    await expect(
      repo.anular({ liquidacionAnulacion: prisma.liquidacionAnulacion } as never, ANULAR),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("un error que NO es P2002 se propaga tal cual", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionAnulacion.create.mockRejectedValue(new Error("conexion caida"));
    const repo = buildRepo(prisma);

    await expect(
      repo.anular({ liquidacionAnulacion: prisma.liquidacionAnulacion } as never, ANULAR),
    ).rejects.toThrow("conexion caida");
  });

  it("R41/R74 — EL CRITERIO DURO: anular no toca la fila del pago (cero `update`)", async () => {
    const prisma = buildPrisma();
    const store = storeDeAnulaciones();
    prisma.liquidacionAnulacion.create = store.create;
    const repo = buildRepo(prisma);
    const tx = {
      liquidacionAnulacion: prisma.liquidacionAnulacion,
      liquidacionPago: prisma.liquidacionPago,
    } as never;

    await repo.anular(tx, ANULAR);
    await repo.anular(tx, ANULAR); // y tampoco en el camino que rechaza

    for (const metodo of ["update", "updateMany", "delete", "deleteMany", "upsert", "create"] as const) {
      expect(prisma.liquidacionPago[metodo], `liquidacionPago.${metodo}`).not.toHaveBeenCalled();
    }
    // Ni siquiera se LEE el pago desde aqui: el monto lo lee el servicio con `obtenerPorId`.
    expect(prisma.liquidacionPago.findUnique).not.toHaveBeenCalled();
    // Y la propia anulacion es append-only: solo `create`.
    for (const metodo of ["update", "updateMany", "delete", "deleteMany", "upsert"] as const) {
      expect(
        prisma.liquidacionAnulacion[metodo],
        `liquidacionAnulacion.${metodo}`,
      ).not.toHaveBeenCalled();
    }
  });

  it("R41/R82 — contraprueba ESTRUCTURAL: en toda la clase no existe una escritura del pago", async () => {
    // El test de arriba mide UNA llamada; este cierra el archivo entero, incluidos los caminos
    // que ningun test recorra. Tambien fija R82: no hay ningun `delete` de una anulacion, asi
    // que no existe forma de deshacerla.
    const fuente = codigoSinComentarios("lib/repositories/LiquidacionPagoRepository.ts");

    for (const escritura of ["update", "updateMany", "delete", "deleteMany", "upsert"]) {
      expect(fuente, `liquidacionPago.${escritura}`).not.toContain(`liquidacionPago.${escritura}`);
      expect(fuente, `liquidacionAnulacion.${escritura}`).not.toContain(
        `liquidacionAnulacion.${escritura}`,
      );
    }
    // Las dos unicas escrituras de toda la clase son los dos INSERT.
    expect(fuente.match(/liquidacionPago\.create|liquidacionAnulacion\.create/g)).toEqual([
      "liquidacionPago.create",
      "liquidacionAnulacion.create",
    ]);
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
