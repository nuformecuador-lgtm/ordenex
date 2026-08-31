import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { GastoFijoCobroRepository } from "@/lib/repositories/GastoFijoCobroRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { GeneracionGastosFijosService } from "@/lib/services/GeneracionGastosFijosService";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type {
  GeneracionGastosFijosTx,
  GeneracionGastosFijosTxRunner,
} from "@/lib/interfaces/services/IGeneracionGastosFijosService";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 333 (D8) — LA IDEMPOTENCIA DE LA CORRIDA, MEDIDA CONTRA POSTGRES: **R9** (dos corridas
// del mismo día CR dejan UN cobro y UN egreso), **R10** (las dos escrituras son una sola
// transacción: si la segunda falla, la primera no queda), **R22** (un período RECHAZADO no vuelve
// a generar pendiente) y **R51** (la base rechaza dos cobros con la misma clave del libro).
//
// POR QUE NO PUEDE SER UN TEST DE DOBLES. Los cuatro requisitos SON el motor:
//   · R9 y R51 los decide `gasto_fijo_cobro_origen_uq` con el `ON CONFLICT DO NOTHING` que
//     compila `createMany({ skipDuplicates: true })`. Un doble que devuelva `0` no demuestra que
//     el índice exista — demuestra que el doble devuelve `0`.
//   · R10 lo decide la transacción: un error de sentencia en Postgres aborta lo escrito antes.
//   · R22 es un EFECTO LATERAL BUSCADO de que el índice sea TOTAL y no parcial (design §2, A9):
//     el cobro rechazado conserva su `origen_id`, así que el período no reaparece.
//
// CÓMO SE EJECUTA LA TRANSACCIÓN DE LA CORRIDA. El `runTx` del servicio se cablea con un
// **SAVEPOINT REAL** dentro de la transacción del test: `SAVEPOINT` / `RELEASE` / `ROLLBACK TO`.
// No es una simulación —quien revierte es Postgres— y permite que todo el archivo siga corriendo
// dentro de `enTransaccionRevertida`: si el test pasa, si falla o si el proceso muere, no queda ni
// una fila en la base compartida.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Mediodía CR del 15 de julio (UTC-6). El período mensual es `2026-07`. */
const NOW = new Date("2026-07-15T18:00:00.000Z");
const DIA_CR = "2026-07-15";
const PERIODO = "2026-07";

function plantillaDTO(id: string, overrides: Partial<GastoFijoPlantillaDTO> = {}): GastoFijoPlantillaDTO {
  return {
    id,
    concepto: "Alquiler (ficha 333)",
    monto: "80000.00",
    activa: true,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-15", // ancla el 15 -> aplica el 15 de julio
    requiereAprobacion: true,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Doble del repositorio de PLANTILLAS. Es el único doble del archivo, y es deliberado: el
 * repositorio real leería TODAS las plantillas activas de la base local —que tiene datos de otras
 * pruebas y del desarrollo— y la corrida dejaría de ser determinista. Lo que estos cuatro
 * requisitos miden son las DOS ESCRITURAS, y esas van con los repositorios REALES contra Postgres.
 */
function fakePlantillaRepo(activas: GastoFijoPlantillaDTO[]): IGastoFijoPlantillaRepository {
  return {
    crear: vi.fn(),
    actualizar: vi.fn(),
    setActiva: vi.fn(),
    listar: vi.fn(),
    listarActivas: vi.fn().mockResolvedValue(activas),
    listarPaginado: vi.fn(),
    obtenerPorId: vi.fn(),
    eliminar: vi.fn(),
  };
}

/**
 * El `runTx` del servicio, cableado a un SAVEPOINT REAL de Postgres.
 *
 * Es lo que hace que R10 se mida de verdad sin salirse de la transacción del test: cuando la
 * segunda escritura falla, quien deshace la primera es el motor con `ROLLBACK TO SAVEPOINT`,
 * exactamente igual que un `ROLLBACK` deshace una transacción entera en producción.
 */
function runnerConSavepoint(tx: TxDeTest): GeneracionGastosFijosTxRunner {
  return async (fn) => {
    const punto = `sp_${randomUUID().replace(/-/g, "")}`;
    await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
    try {
      const salida = await fn(tx as unknown as GeneracionGastosFijosTx);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
      return salida;
    } catch (error) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
      throw error;
    }
  };
}

/** La plantilla REAL en la base: sin ella el `plantilla_id` del cobro no tiene a qué apuntar. */
async function insertarPlantilla(tx: TxDeTest, id: string, activa = true): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO "gasto_fijo_plantilla"
       ("id","concepto","monto","activa","periodicidad_unidad","periodicidad_cantidad","fecha_cobro")
     VALUES ($1, 'Alquiler (ficha 333)', '80000.00'::numeric, $2,
             'meses'::"PeriodicidadUnidad", 1, DATE '2026-07-15')`,
    id,
    activa,
  );
}

/** El servicio con los DOS repositorios REALES y el savepoint como transacción. */
function servicioReal(tx: TxDeTest, activas: GastoFijoPlantillaDTO[]): GeneracionGastosFijosService {
  const cliente = tx as unknown as PrismaClient;
  return new GeneracionGastosFijosService(
    fakePlantillaRepo(activas),
    new WalletMovimientoRepository(cliente),
    new GastoFijoCobroRepository(cliente),
    runnerConSavepoint(tx),
  );
}

async function contarCobros(tx: TxDeTest, origenId: string): Promise<number> {
  const filas = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "gasto_fijo_cobro" WHERE "origen_id" = $1`,
    origenId,
  );
  return Number(filas[0].n);
}

async function contarEgresos(tx: TxDeTest, origenId: string): Promise<number> {
  const filas = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "wallet_movimiento"
      WHERE "origen_tipo" = 'gasto'::"wallet_origen_tipo"
        AND "origen_id" = $1
        AND "categoria" = 'egreso_gasto_fijo'::"wallet_movimiento_categoria"`,
    origenId,
  );
  return Number(filas[0].n);
}

describeSiHayBase("333/D8 — R9: dos corridas del MISMO día dejan un cobro y un egreso", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ la segunda corrida inserta CERO y la corrida termina en éxito", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const idAprueba = randomUUID();
      const idSola = randomUUID();
      await insertarPlantilla(tx, idAprueba);
      await insertarPlantilla(tx, idSola);

      const svc = servicioReal(tx, [
        plantillaDTO(idAprueba, { requiereAprobacion: true }),
        plantillaDTO(idSola, { requiereAprobacion: false }),
      ]);

      const primera = await svc.ejecutarGeneracion(NOW);
      const segunda = await svc.ejecutarGeneracion(NOW); // el cron se re-ejecutó el MISMO día

      return {
        primera,
        segunda,
        cobros: await contarCobros(tx, `${idAprueba}:${PERIODO}`),
        egresos: await contarEgresos(tx, `${idSola}:${PERIODO}`),
      };
    });

    expect(r.primera).toMatchObject({ egresosGenerados: 1, cobrosPendientesCreados: 1 });
    // R9: la segunda corrida no crea NADA nuevo y no lanza.
    expect(r.segunda).toMatchObject({ egresosGenerados: 0, cobrosPendientesCreados: 0 });
    expect(r.cobros).toBe(1);
    expect(r.egresos).toBe(1);
  });

  it("⭑ y el `generado_el` del cobro es el día CR de la corrida, con su copia de concepto y monto", async () => {
    const fila = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const id = randomUUID();
      await insertarPlantilla(tx, id);
      await servicioReal(tx, [plantillaDTO(id)]).ejecutarGeneracion(NOW);
      const filas = await tx.$queryRawUnsafe<
        {
          plantilla_id: string;
          origen_id: string;
          periodo: string;
          concepto: string;
          monto: string;
          estado: string;
          generado_el: Date;
          decidido_por: string | null;
          decidido_at: Date | null;
          movimiento_id: string | null;
        }[]
      >(
        `SELECT "plantilla_id","origen_id","periodo","concepto","monto"::text AS monto,
                "estado"::text AS estado,"generado_el","decidido_por","decidido_at","movimiento_id"
           FROM "gasto_fijo_cobro" WHERE "origen_id" = $1`,
        `${id}:${PERIODO}`,
      );
      return { fila: filas[0], id };
    });

    expect(fila.fila.plantilla_id).toBe(fila.id);
    expect(fila.fila.origen_id).toBe(`${fila.id}:${PERIODO}`); // LA CLAVE, congelada
    expect(fila.fila.periodo).toBe(PERIODO);
    expect(fila.fila.concepto).toBe("Alquiler (ficha 333)");
    expect(fila.fila.monto).toBe("80000.00"); // la COPIA, con su precisión intacta
    expect(fila.fila.estado).toBe("pendiente");
    expect(fila.fila.generado_el.toISOString().slice(0, 10)).toBe(DIA_CR);
    // Un cobro `pendiente` nace SIN decisión y SIN movimiento (los dos CHECK de la tabla).
    expect(fila.fila.decidido_por).toBeNull();
    expect(fila.fila.decidido_at).toBeNull();
    expect(fila.fila.movimiento_id).toBeNull();
  });
});

describeSiHayBase("333/D8 — R10: las dos escrituras van en UNA transacción", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ si la escritura de cobros falla EN EL MOTOR, no queda ningún egreso de la corrida", async () => {
    // El fallo no se finge desde un doble: se provoca contra Postgres. El repositorio de cobros se
    // envuelve para que, ANTES de insertar, escriba una fila con `monto = 0` que viola
    // `gasto_fijo_cobro_monto_positivo`. Postgres aborta la sentencia, el error sube, y quien
    // deshace el egreso YA ESCRITO es el `ROLLBACK TO SAVEPOINT` — el motor, no el test.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const idSola = randomUUID();
      const idAprueba = randomUUID();
      await insertarPlantilla(tx, idSola);
      await insertarPlantilla(tx, idAprueba);

      const cliente = tx as unknown as PrismaClient;
      const cobroRepoReal = new GastoFijoCobroRepository(cliente);
      const cobroRepoQueRevienta = {
        ...cobroRepoReal,
        crearPendientes: async () => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "gasto_fijo_cobro"
               ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el")
             VALUES ($1, $2, $3, $4, 'Alquiler (ficha 333)', 0::numeric,
                     'pendiente'::"gasto_fijo_cobro_estado", DATE '2026-07-15')`,
            randomUUID(),
            idAprueba,
            `${idAprueba}:${PERIODO}`,
            PERIODO,
          );
          return 0; // inalcanzable: la sentencia de arriba aborta
        },
        contarPendientes: () => cobroRepoReal.contarPendientes(),
        obtenerPorId: (id: string) => cobroRepoReal.obtenerPorId(id),
        listarPendientes: (tope: number) => cobroRepoReal.listarPendientes(tope),
        contarPendientesDePlantilla: (p: string) => cobroRepoReal.contarPendientesDePlantilla(p),
        marcarDecidido: cobroRepoReal.marcarDecidido.bind(cobroRepoReal),
        enlazarMovimiento: cobroRepoReal.enlazarMovimiento.bind(cobroRepoReal),
        cancelarPendientesDePlantilla:
          cobroRepoReal.cancelarPendientesDePlantilla.bind(cobroRepoReal),
      };

      const svc = new GeneracionGastosFijosService(
        fakePlantillaRepo([
          plantillaDTO(idSola, { requiereAprobacion: false }),
          plantillaDTO(idAprueba, { requiereAprobacion: true }),
        ]),
        new WalletMovimientoRepository(cliente),
        cobroRepoQueRevienta,
        runnerConSavepoint(tx),
      );

      let mensaje = "";
      try {
        await svc.ejecutarGeneracion(NOW);
      } catch (error) {
        mensaje = (error as Error).message;
      }

      return {
        mensaje,
        egresos: await contarEgresos(tx, `${idSola}:${PERIODO}`),
        cobros: await contarCobros(tx, `${idAprueba}:${PERIODO}`),
      };
    });

    expect(r.mensaje, "la corrida no falló: el caso no está midiendo nada").toMatch(
      /gasto_fijo_cobro_monto_positivo/,
    );
    expect(r.egresos, "quedó un egreso de una corrida que falló").toBe(0); // R10
    expect(r.cobros).toBe(0);
  });

  it("⭑ CONTROL POSITIVO: la MISMA corrida sin el fallo SÍ deja el egreso", async () => {
    // Sin este control, el caso de arriba pasaría igual si el egreso no se hubiera escrito nunca
    // —por un `where` mal puesto, por una plantilla que no aplica— y estaría midiendo el vacío.
    const egresos = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const idSola = randomUUID();
      await insertarPlantilla(tx, idSola);
      await servicioReal(tx, [
        plantillaDTO(idSola, { requiereAprobacion: false }),
      ]).ejecutarGeneracion(NOW);
      return contarEgresos(tx, `${idSola}:${PERIODO}`);
    });

    expect(egresos).toBe(1);
  });
});

describeSiHayBase("333/D8 — R22: un período RECHAZADO no vuelve a generar pendiente", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ tras rechazar, la corrida del día siguiente del MISMO período no crea nada, y el «no» se conserva", async () => {
    // Es el EFECTO LATERAL BUSCADO de que `gasto_fijo_cobro_origen_uq` sea TOTAL y no parcial
    // (design §2, A9): el cobro rechazado conserva su `origen_id`, así que la corrida siguiente
    // choca con el índice. Con una unicidad `WHERE estado = 'pendiente'`, lo rechazado volvería a
    // la mañana siguiente y el «no» del maestro no significaría nada.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const actorId = await idDeUnUsuario(tx);
      const id = randomUUID();
      await insertarPlantilla(tx, id);
      const svc = servicioReal(tx, [plantillaDTO(id)]);

      await svc.ejecutarGeneracion(NOW);
      // El maestro RECHAZA: exactamente lo que hace `marcarDecidido`.
      await tx.$executeRawUnsafe(
        `UPDATE "gasto_fijo_cobro"
            SET "estado" = 'rechazado'::"gasto_fijo_cobro_estado",
                "decidido_por" = $2, "decidido_at" = NOW()
          WHERE "origen_id" = $1 AND "estado" = 'pendiente'::"gasto_fijo_cobro_estado"`,
        `${id}:${PERIODO}`,
        actorId,
      );

      // Otra corrida del MISMO período (el cron corre a diario; una mensual sigue en `2026-07`).
      const otraCorrida = await svc.ejecutarGeneracion(new Date("2026-07-15T18:05:00.000Z"));

      const filas = await tx.$queryRawUnsafe<{ estado: string; n: bigint }[]>(
        `SELECT "estado"::text AS estado, count(*) AS n
           FROM "gasto_fijo_cobro" WHERE "origen_id" = $1 GROUP BY "estado"`,
        `${id}:${PERIODO}`,
      );
      return { otraCorrida, filas: filas.map((f) => ({ estado: f.estado, n: Number(f.n) })) };
    });

    expect(r.otraCorrida.cobrosPendientesCreados).toBe(0); // R22: no reaparece
    expect(r.filas).toEqual([{ estado: "rechazado", n: 1 }]); // y el «no» sigue ahí
    expect(r.otraCorrida.cobrosPendientesTotales).toBe(0); // ni cuenta como cola pendiente
  });
});

describeSiHayBase("333/D8 — R51: la base rechaza dos cobros con la misma clave del libro", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ dos `INSERT` con el mismo `origen_id` violan `gasto_fijo_cobro_origen_uq`", async () => {
    // Se va DIRECTO al motor, sin `skipDuplicates`: lo que rechaza la segunda fila es el índice.
    // Borrarlo mata este caso — es una de las tres mutaciones de dinero que la ficha obliga a
    // demostrar, y su salida ROJA está pegada en `progress/impl_333.md`.
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const id = randomUUID();
        await insertarPlantilla(tx, id);
        for (let i = 0; i < 2; i++) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "gasto_fijo_cobro"
               ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el")
             VALUES ($1, $2, $3, $4, 'Alquiler (ficha 333)', '80000.00'::numeric,
                     'pendiente'::"gasto_fijo_cobro_estado", DATE '2026-07-15')`,
            randomUUID(),
            id,
            `${id}:${PERIODO}`,
            PERIODO,
          );
        }
      }),
    ).rejects.toThrow(/gasto_fijo_cobro_origen_uq/);
  });

  it("⭑ la unicidad es TOTAL, no parcial: un cobro DECIDIDO sigue ocupando su clave (R22)", async () => {
    // La otra mitad de A9. Si el índice llevara `WHERE estado = 'pendiente'`, esta segunda fila
    // entraría y el período rechazado volvería a la cola.
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const actorId = await idDeUnUsuario(tx);
        const id = randomUUID();
        await insertarPlantilla(tx, id);
        await tx.$executeRawUnsafe(
          `INSERT INTO "gasto_fijo_cobro"
             ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el",
              "decidido_por","decidido_at")
           VALUES ($1, $2, $3, $4, 'Alquiler (ficha 333)', '80000.00'::numeric,
                   'rechazado'::"gasto_fijo_cobro_estado", DATE '2026-07-15', $5, NOW())`,
          randomUUID(),
          id,
          `${id}:${PERIODO}`,
          PERIODO,
          actorId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "gasto_fijo_cobro"
             ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el")
           VALUES ($1, $2, $3, $4, 'Alquiler (ficha 333)', '80000.00'::numeric,
                   'pendiente'::"gasto_fijo_cobro_estado", DATE '2026-07-15')`,
          randomUUID(),
          id,
          `${id}:${PERIODO}`,
          PERIODO,
        );
      }),
    ).rejects.toThrow(/gasto_fijo_cobro_origen_uq/);
  });

  it("⭑ CONTROL: dos períodos DISTINTOS de la misma plantilla SÍ conviven", async () => {
    // Sin este control, los dos casos de arriba pasarían igual si el `INSERT` fallara por otra
    // cosa —una columna mal escrita, un cast— y estarían midiendo su propio ruido.
    const n = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const id = randomUUID();
      await insertarPlantilla(tx, id);
      for (const periodo of ["2026-07", "2026-08"]) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "gasto_fijo_cobro"
             ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el")
           VALUES ($1, $2, $3, $4, 'Alquiler (ficha 333)', '80000.00'::numeric,
                   'pendiente'::"gasto_fijo_cobro_estado", DATE '2026-07-15')`,
          randomUUID(),
          id,
          `${id}:${periodo}`,
          periodo,
        );
      }
      const filas = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "gasto_fijo_cobro" WHERE "plantilla_id" = $1`,
        id,
      );
      return Number(filas[0].n);
    });

    expect(n).toBe(2);
  });

  it("⭑ y la CLAVE DEL COBRO es la misma cadena que acaba en el libro al aprobar (§2)", async () => {
    // El puente entre los dos índices. Si alguien cambiara la derivación en uno solo de los dos
    // sitios, el egreso de la aprobación dejaría de colisionar con el del cron y se cobraría dos
    // veces — el escenario que `GeneracionGastosFijosService` advierte por escrito.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const idAprueba = randomUUID();
      const idSola = randomUUID();
      await insertarPlantilla(tx, idAprueba);
      await insertarPlantilla(tx, idSola);
      await servicioReal(tx, [
        plantillaDTO(idAprueba, { requiereAprobacion: true }),
        plantillaDTO(idSola, { requiereAprobacion: false }),
      ]).ejecutarGeneracion(NOW);

      const cobro = await tx.$queryRawUnsafe<{ origen_id: string }[]>(
        `SELECT "origen_id" FROM "gasto_fijo_cobro" WHERE "plantilla_id" = $1`,
        idAprueba,
      );
      const egreso = await tx.$queryRawUnsafe<{ origen_id: string }[]>(
        `SELECT "origen_id" FROM "wallet_movimiento" WHERE "origen_id" = $1`,
        `${idSola}:${PERIODO}`,
      );
      return { cobro: cobro[0].origen_id, egreso: egreso[0].origen_id, idAprueba, idSola };
    });

    // Misma FORMA exacta: `<uuid>:<periodo>`, con el mismo período y sin un segundo formato.
    expect(r.cobro).toBe(`${r.idAprueba}:${PERIODO}`);
    expect(r.egreso).toBe(`${r.idSola}:${PERIODO}`);
  });
});

/**
 * Un usuario REAL de la base: `decidido_por` es una FK `RESTRICT` contra `usuario`.
 *
 * NO se salta el test si no hay ninguno: se ROMPE. Un `return` silencioso aquí es exactamente el
 * modo de fallo que este repo ya tiene medido —«passed» sin haber comprobado nada—.
 */
async function idDeUnUsuario(tx: TxDeTest): Promise<string> {
  const filas = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "usuario" LIMIT 1`);
  if (filas.length === 0) {
    throw new Error(
      "La base no tiene ni un `usuario`: siembra con `pnpm run db:seed` + `db:seed:maestro` " +
        "antes de correr este archivo. Sin usuario no se puede ejercer la FK `decidido_por`.",
    );
  }
  return filas[0].id;
}
