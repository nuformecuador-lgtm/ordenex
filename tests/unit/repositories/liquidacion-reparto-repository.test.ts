import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { LiquidacionRepartoRepository } from "@/lib/repositories/LiquidacionRepartoRepository";
import type { CrearLiquidacionRepartoInput } from "@/lib/interfaces/repositories/ILiquidacionRepartoRepository";

// Feature 205 / T2.3 — tests unit del `LiquidacionRepartoRepository` (mockea Prisma, sin DB).
// Cubre R28 (la relectura por clave es lo que reconstruye el resultado original) y R29 (la
// barrera de la repeticion es DE DATOS: el choque del `UNIQUE` sale como RESULTADO, no como
// excepcion que suba, y el INSERT se INTENTA — no hay `SELECT` previo que decida si escribir).
//
// Por que estas afirmaciones viven aqui y no en el servicio: los tests de servicio usan DOBLES y
// NO ven la traduccion a SQL. Una mutacion del `where` de la relectura —o del `data` del INSERT—
// los pasa en verde. El WHERE se prueba donde vive.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo.

const CREATED_AT = new Date("2026-08-11T15:04:05.000Z");
const CLAVE = "11111111-1111-4111-8111-111111111111";

function repartoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rep-1",
    claveIdempotencia: CLAVE,
    mensajeroId: "m1",
    montoTotal: new Prisma.Decimal("45000.5"), // escala 1 a proposito: se normaliza a 2
    registradoPor: "u-admin",
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function buildPrisma() {
  return {
    liquidacionReparto: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      // Las ESCRITURAS que este repositorio NO debe tener, espiadas: es lo que hace observable
      // que un reparto es una fila INMUTABLE (R52) y no solo una promesa del docstring.
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

function buildRepo(prisma: ReturnType<typeof buildPrisma>) {
  return new LiquidacionRepartoRepository(prisma as unknown as PrismaClient);
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

/** Un P2002 SIN ninguna pista: ni `target` ni mensaje del adapter. */
function p2002SinPista() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.0.0",
    meta: { target: undefined },
  });
}

const INPUT: CrearLiquidacionRepartoInput = {
  claveIdempotencia: CLAVE,
  mensajeroId: "m1",
  montoTotal: "45000.50",
  registradoPor: "u-admin",
};

describe("LiquidacionRepartoRepository.crear (R29)", () => {
  it("escribe las CUATRO columnas del acto, con el monto como Decimal", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionReparto.create.mockResolvedValue(repartoRow());
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionReparto: prisma.liquidacionReparto } as never, INPUT);

    expect(r.status).toBe("creado");
    const arg = prisma.liquidacionReparto.create.mock.calls[0][0];
    // Las 4 que decide el emisor; el `id` y el instante los pone la base. Lista EXHAUSTIVA: una
    // columna nueva escrita en silencio rompe este caso.
    expect(Object.keys(arg.data).sort()).toEqual([
      "claveIdempotencia",
      "mensajeroId",
      "montoTotal",
      "registradoPor",
    ]);
    expect(arg.data).toMatchObject({
      claveIdempotencia: CLAVE,
      mensajeroId: "m1",
      registradoPor: "u-admin",
    });
    // Money-safe: STRING -> Prisma.Decimal al escribir (nunca un number por el medio).
    expect(arg.data.montoTotal).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data.montoTotal.toFixed(2)).toBe("45000.50");
    // El instante lo sella la base (`created_at DEFAULT now()`), como en `liquidacion_pago`.
    expect(arg.data).not.toHaveProperty("createdAt");
  });

  it("devuelve el acto con el monto como STRING de escala 2 y su instante en ISO", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionReparto.create.mockResolvedValue(repartoRow());
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionReparto: prisma.liquidacionReparto } as never, INPUT);

    if (r.status !== "creado") throw new Error("esperaba creado");
    expect(r.reparto).toEqual({
      id: "rep-1",
      claveIdempotencia: CLAVE,
      mensajeroId: "m1",
      montoTotal: "45000.50", // Decimal escala 1 -> STRING escala 2
      registradoPor: "u-admin",
      registradoAt: "2026-08-11T15:04:05.000Z",
    });
    expect(typeof r.reparto.montoTotal).toBe("string");
  });

  it("R29: el choque de la clave es un RESULTADO, no una excepcion que suba (forma nativa)", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionReparto.create.mockRejectedValue(p2002Nativo(["clave_idempotencia"]));
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionReparto: prisma.liquidacionReparto } as never, INPUT);

    expect(r).toEqual({ status: "clave_repetida" });
  });

  it("R29: tambien bajo el driver adapter de Prisma 7, donde `meta.target` viene vacio", async () => {
    // La cicatriz de `_shared/prisma-unique.ts`: con el adapter el nombre de la constraint solo
    // esta en el mensaje original. Un handler que leyera `meta.target` dejaria escalar el P2002
    // crudo a un 500 y el doble envio acabaria en pantalla de error en vez de en `ya_registrado`.
    const prisma = buildPrisma();
    prisma.liquidacionReparto.create.mockRejectedValue(
      p2002Adapter("liquidacion_reparto_clave_idempotencia_key"),
    );
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionReparto: prisma.liquidacionReparto } as never, INPUT);

    expect(r).toEqual({ status: "clave_repetida" });
  });

  it("un P2002 SIN pista se lee como choque de la clave (y la premisa que lo permite, abajo)", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionReparto.create.mockRejectedValue(p2002SinPista());
    const repo = buildRepo(prisma);

    const r = await repo.crear({ liquidacionReparto: prisma.liquidacionReparto } as never, INPUT);

    expect(r).toEqual({ status: "clave_repetida" });
  });

  it("LA PREMISA, bajo test: `liquidacion_reparto` tiene EXACTAMENTE dos restricciones unicas", async () => {
    // El caso de arriba solo es correcto mientras las unicas restricciones unicas de la tabla
    // sean la PK —sobre un uuid recien generado, imposible de repetir— y la clave. Si alguien le
    // anade una tercera, su choque llegaria sin pista (bajo el adapter el `target` viene vacio),
    // se leeria como clave repetida, el servicio releeria por la clave, no la encontraria y
    // responderia `no_encontrado` a un reparto legitimo. Es exactamente la trampa que
    // `liquidacion_pago` ya tiene documentada, y aqui se deja medida en vez de recordada.
    const schema = fs.readFileSync(path.join(process.cwd(), "db/schema.prisma"), "utf8");
    const modelo = /model LiquidacionReparto \{[\s\S]*?\n\}/.exec(schema)![0].replace(/\/\/.*$/gm, "");

    expect([...modelo.matchAll(/^\s*(\w+)\s+\S+\s+@unique/gm)].map((m) => m[1])).toEqual([
      "claveIdempotencia",
    ]);
    expect(modelo).not.toMatch(/@@unique/);
    // Y el `@id` sigue siendo un uuid generado, no una clave de negocio que pudiera repetirse.
    expect(modelo).toMatch(/id\s+String\s+@id @default\(uuid\(\)\)/);
  });

  it("un P2002 de OTRA restriccion, CON pista, se propaga: no se disfraza de doble envio", async () => {
    // La PK es la otra restriccion unica de la tabla, y un choque suyo es una anomalia de verdad
    // (dos uuid iguales), no un doble envio: tiene que subir. La diferencia con el caso de
    // arriba es la PISTA — sin ella no hay forma de distinguirlos y se elige el desenlace
    // benigno; con ella, tragarselo convertiria un defecto en un `ya_registrado` silencioso.
    const prisma = buildPrisma();
    prisma.liquidacionReparto.create.mockRejectedValue(p2002Adapter("liquidacion_reparto_pkey"));
    const repo = buildRepo(prisma);

    await expect(
      repo.crear({ liquidacionReparto: prisma.liquidacionReparto } as never, INPUT),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("un error que NO es P2002 se propaga tal cual", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionReparto.create.mockRejectedValue(new Error("conexion caida"));
    const repo = buildRepo(prisma);

    await expect(
      repo.crear({ liquidacionReparto: prisma.liquidacionReparto } as never, INPUT),
    ).rejects.toThrow("conexion caida");
  });

  it("R29 — CERO TOCTOU: no hay `SELECT` previo que decida si insertar", async () => {
    // El INSERT se INTENTA siempre; quien dice que no es la restriccion. Un `findUnique` antes
    // del `create` abriria la ventana entre comprobar y escribir que R29 prohibe, y dos envios
    // simultaneos pasarian los dos la comprobacion.
    const prisma = buildPrisma();
    prisma.liquidacionReparto.create.mockRejectedValue(p2002Nativo(["clave_idempotencia"]));
    const repo = buildRepo(prisma);

    await repo.crear({ liquidacionReparto: prisma.liquidacionReparto } as never, INPUT);

    expect(prisma.liquidacionReparto.create).toHaveBeenCalledTimes(1);
    expect(prisma.liquidacionReparto.findUnique).not.toHaveBeenCalled();
    expect(prisma.liquidacionReparto.findMany).not.toHaveBeenCalled();
  });

  it("escribe en el `tx` que recibe, NUNCA en el cliente propio del repositorio", async () => {
    // La fila del acto es la PRIMERA de la transaccion del reparto (§5.1). Escrita fuera, un
    // fallo posterior la dejaria viva sin ninguno de sus pagos: un acto sin dinero, y la clave
    // quemada para siempre.
    const prisma = buildPrisma();
    const tx = { liquidacionReparto: { create: vi.fn().mockResolvedValue(repartoRow()) } };
    const repo = buildRepo(prisma);

    await repo.crear(tx as never, INPUT);

    expect(tx.liquidacionReparto.create).toHaveBeenCalledTimes(1);
    expect(prisma.liquidacionReparto.create).not.toHaveBeenCalled();
  });
});

describe("LiquidacionRepartoRepository.obtenerPorClave (R28)", () => {
  it("relee por el UNIQUE de la clave — y con el CLIENTE PROPIO, no con la transaccion", async () => {
    // La relectura ocurre necesariamente FUERA: en Postgres el choque de la clave deja la
    // transaccion ABORTADA y ninguna sentencia posterior sobreviviria dentro de ella.
    const prisma = buildPrisma();
    prisma.liquidacionReparto.findUnique.mockResolvedValue(repartoRow());
    const repo = buildRepo(prisma);

    const reparto = await repo.obtenerPorClave(CLAVE);

    expect(prisma.liquidacionReparto.findUnique.mock.calls[0][0].where).toEqual({
      claveIdempotencia: CLAVE,
    });
    expect(reparto?.id).toBe("rep-1");
    // El servicio necesita el mensajero para comprobar que el reparto releido es el que se pide.
    expect(reparto?.mensajeroId).toBe("m1");
    expect(reparto?.montoTotal).toBe("45000.50");
  });

  it("una clave nunca usada devuelve null (y no un objeto vacio)", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionReparto.findUnique.mockResolvedValue(null);
    const repo = buildRepo(prisma);
    expect(await repo.obtenerPorClave("no-existe")).toBeNull();
  });

  it("no busca por MENSAJERO ni por MONTO: dos repartos iguales del mismo dia son legitimos", async () => {
    // R30: abrir el formulario otra vez es un pago DISTINTO aunque coincidan mensajero, importe,
    // metodo y fecha. Si la relectura mirara cualquiera de esos campos, el segundo reparto
    // legitimo se responderia como «ya registrado» y el mensajero cobraria una sola vez.
    const prisma = buildPrisma();
    prisma.liquidacionReparto.findUnique.mockResolvedValue(repartoRow());
    const repo = buildRepo(prisma);

    await repo.obtenerPorClave(CLAVE);

    const arg = prisma.liquidacionReparto.findUnique.mock.calls[0][0];
    expect(Object.keys(arg.where)).toEqual(["claveIdempotencia"]);
    expect(JSON.stringify(arg)).not.toContain("mensajeroId");
    expect(JSON.stringify(arg)).not.toContain("montoTotal");
  });
});

describe("LiquidacionRepartoRepository — el acto es INMUTABLE (R52)", () => {
  it("ningun camino de la clase escribe mas alla del INSERT", async () => {
    const prisma = buildPrisma();
    prisma.liquidacionReparto.create.mockResolvedValue(repartoRow());
    prisma.liquidacionReparto.findUnique.mockResolvedValue(repartoRow());
    const repo = buildRepo(prisma);

    await repo.crear({ liquidacionReparto: prisma.liquidacionReparto } as never, INPUT);
    await repo.obtenerPorClave(CLAVE);

    for (const metodo of ["update", "updateMany", "delete", "deleteMany", "upsert"] as const) {
      expect(
        prisma.liquidacionReparto[metodo],
        `liquidacionReparto.${metodo}`,
      ).not.toHaveBeenCalled();
    }
  });

  it("CONTRAPRUEBA ESTRUCTURAL: en todo el archivo no existe una escritura que no sea el INSERT", async () => {
    // El caso de arriba mide DOS llamadas; este cierra la clase entera, incluidos los caminos
    // que ningun test recorra. Es lo que impide que manana aparezca un `editarReparto` (R52).
    const fuente = fs
      .readFileSync(path.join(process.cwd(), "lib/repositories/LiquidacionRepartoRepository.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    for (const escritura of ["update", "updateMany", "delete", "deleteMany", "upsert"]) {
      expect(fuente, `liquidacionReparto.${escritura}`).not.toContain(
        `liquidacionReparto.${escritura}`,
      );
    }
    expect(fuente.match(/liquidacionReparto\.create/g)).toEqual(["liquidacionReparto.create"]);
    // Y no toca ninguna otra tabla: el cliente esta acotado con `Pick` a un solo delegado.
    for (const ajena of ["liquidacionPago", "cierreDia", "pagoMensajeroMovimiento", "usuario"]) {
      expect(fuente, `nombra ${ajena}`).not.toContain(`${ajena}.`);
    }
  });
});
