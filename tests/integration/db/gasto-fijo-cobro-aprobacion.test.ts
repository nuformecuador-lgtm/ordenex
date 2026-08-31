import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { GastoFijoCobroRepository } from "@/lib/repositories/GastoFijoCobroRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { GastoFijoCobroService } from "@/lib/services/GastoFijoCobroService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  GastoFijoCobroTx,
  GastoFijoCobroTxRunner,
} from "@/lib/interfaces/services/IGastoFijoCobroService";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 333 (D7) — LA APROBACIÓN, MEDIDA CONTRA POSTGRES: **R15** (o quedan las dos escrituras o
// no queda ninguna), **R17** (un cobro ya decidido no escribe y responde `ya_decidido`), **R18**
// (dos aprobaciones SIMULTÁNEAS dejan UN movimiento y UNA decisión) y **R19** (si el libro ya
// tiene la clave, se enlaza ese movimiento y se avisa de que ya estaba).
//
// POR QUE NINGUNO DE LOS CUATRO PUEDE PROBARSE CON DOBLES:
//   · R15 es la transacción. Que el movimiento y la decisión commiteen juntos —o no commiteen— lo
//     decide Postgres.
//   · R17 y R18 son el `WHERE id = $1 AND estado = 'pendiente'` del `UPDATE`. Un doble que
//     devuelva `0` demuestra que el doble devuelve `0`; lo que hay que demostrar es que el
//     `WHERE` está, y que bajo `READ COMMITTED` la segunda transacción ESPERA el bloqueo de fila,
//     re-evalúa el `WHERE` tras el commit de la primera y afecta CERO filas.
//   · R19 es `wallet_movimiento_origen_categoria_uq`: el `ON CONFLICT DO NOTHING` que hace que
//     `crearMovimientos` devuelva 0 cuando la clave ya estaba.
//
// ⚠️ EL CASO CONCURRENTE (R18) NO PUEDE VIVIR DENTRO DE UNA TRANSACCIÓN REVERTIDA, y hay que
// decirlo en voz alta: dos transacciones que se pelean por una fila necesitan que esa fila esté
// COMMITEADA y necesitan DOS conexiones. Ese bloque —y solo ese— escribe de verdad y limpia lo
// suyo en un `finally` **y** en un barrido de `beforeAll`/`afterAll` por marca, para que una
// corrida que muera a mitad no deje basura para la siguiente. Todo lo demás corre dentro de
// `enTransaccionRevertida`.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const AHORA = new Date("2026-08-29T18:00:00.000Z");
const PERIODO = "2026-08";
/** Marca de estas pruebas. Es lo que permite barrer restos de una corrida que murió a mitad. */
const MARCA = "TEST-333-APROBACION";

function maestro(usuarioId: string): Actor {
  return { usuarioId, rol: "maestro", zonaId: null };
}

/** El `runTx` del servicio, cableado a un SAVEPOINT REAL: quien revierte es Postgres. */
function runnerConSavepoint(tx: TxDeTest): GastoFijoCobroTxRunner {
  return async (fn) => {
    const punto = `sp_${randomUUID().replace(/-/g, "")}`;
    await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
    try {
      const salida = await fn(tx as unknown as GastoFijoCobroTx);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
      return salida;
    } catch (error) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
      throw error;
    }
  };
}

/** El servicio con los DOS repositorios REALES sobre el cliente que se le pase. */
function servicioSobre(cliente: PrismaClient, runner: GastoFijoCobroTxRunner) {
  return new GastoFijoCobroService(
    new GastoFijoCobroRepository(cliente),
    new WalletMovimientoRepository(cliente),
    cliente,
    runner,
  );
}

async function insertarPlantilla(tx: TxDeTest, id: string, concepto = MARCA): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO "gasto_fijo_plantilla"
       ("id","concepto","monto","activa","periodicidad_unidad","periodicidad_cantidad","fecha_cobro")
     VALUES ($1, $2, '80000.00'::numeric, false,
             'meses'::"PeriodicidadUnidad", 1, DATE '2026-08-01')`,
    id,
    concepto,
  );
}

async function insertarCobroPendiente(
  tx: TxDeTest,
  cobroId: string,
  plantillaId: string,
  monto = "80000.00",
  concepto = MARCA,
): Promise<string> {
  const origenId = `${plantillaId}:${PERIODO}`;
  await tx.$executeRawUnsafe(
    `INSERT INTO "gasto_fijo_cobro"
       ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el")
     VALUES ($1, $2, $3, $4, $5, $6::numeric,
             'pendiente'::"gasto_fijo_cobro_estado", DATE '2026-08-29')`,
    cobroId,
    plantillaId,
    origenId,
    PERIODO,
    concepto,
    monto,
  );
  return origenId;
}

/**
 * Usuarios REALES de la base: `decidido_por` es una FK `RESTRICT` contra `usuario`.
 *
 * NO se salta el test si faltan: se ROMPE. Un `return` silencioso aquí es exactamente el modo de
 * fallo que este repo ya tiene medido —«passed» sin haber comprobado nada—.
 */
async function idsDeUsuarios(
  cliente: { $queryRawUnsafe: <T>(sql: string) => Promise<T> },
  cuantos: number,
): Promise<string[]> {
  const filas = await cliente.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "usuario" ORDER BY "id" LIMIT ${cuantos}`,
  );
  if (filas.length < cuantos) {
    throw new Error(
      `La base tiene ${filas.length} usuarios y hacen falta ${cuantos}: siembra con ` +
        "`pnpm run db:seed` + `db:seed:maestro` antes de correr este archivo. Sin usuarios no se " +
        "puede ejercer la FK `decidido_por` ni distinguir QUIÉN ganó la carrera.",
    );
  }
  return filas.map((f) => f.id);
}

async function leerCobro(
  cliente: { $queryRawUnsafe: <T>(sql: string, ...args: unknown[]) => Promise<T> },
  cobroId: string,
) {
  const filas = await cliente.$queryRawUnsafe<
    {
      estado: string;
      decidido_por: string | null;
      decidido_at: Date | null;
      movimiento_id: string | null;
    }[]
  >(
    `SELECT "estado"::text AS estado, "decidido_por", "decidido_at", "movimiento_id"
       FROM "gasto_fijo_cobro" WHERE "id" = $1`,
    cobroId,
  );
  return filas[0];
}

async function movimientosDeLaClave(
  cliente: { $queryRawUnsafe: <T>(sql: string, ...args: unknown[]) => Promise<T> },
  origenId: string,
) {
  return cliente.$queryRawUnsafe<
    { id: string; monto: string; registrado_por: string | null; descripcion: string | null }[]
  >(
    `SELECT "id", "monto"::text AS monto, "registrado_por", "descripcion"
       FROM "wallet_movimiento"
      WHERE "origen_tipo" = 'gasto'::"wallet_origen_tipo"
        AND "origen_id" = $1
        AND "categoria" = 'egreso_gasto_fijo'::"wallet_movimiento_categoria"`,
    origenId,
  );
}

describeSiHayBase("333/D7 — R15: aprobar deja estado, decisor, instante y enlace, o no deja nada", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ el camino feliz deja LAS CUATRO cosas, y el movimiento lleva la clave y el monto copiado", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [actorId] = await idsDeUsuarios(tx, 1);
      const plantillaId = randomUUID();
      const cobroId = randomUUID();
      await insertarPlantilla(tx, plantillaId);
      const origenId = await insertarCobroPendiente(tx, cobroId, plantillaId, "12345.67");

      const svc = servicioSobre(tx as unknown as PrismaClient, runnerConSavepoint(tx));
      const salida = await svc.aprobar({ id: cobroId }, maestro(actorId), AHORA);

      return {
        salida,
        cobro: await leerCobro(tx, cobroId),
        movimientos: await movimientosDeLaClave(tx, origenId),
        actorId,
        origenId,
      };
    });

    expect(r.salida).toEqual({ status: "ok", yaEstabaEnElLibro: false });
    // Las CUATRO: estado, quién, cuándo y el enlace.
    expect(r.cobro.estado).toBe("aprobado");
    expect(r.cobro.decidido_por).toBe(r.actorId);
    expect(r.cobro.decidido_at).not.toBeNull();
    expect(r.cobro.movimiento_id).not.toBeNull();
    // Y el movimiento es UNO, con la clave del cobro, el monto COPIADO y el autor que aprobó.
    expect(r.movimientos).toHaveLength(1);
    expect(r.movimientos[0].id).toBe(r.cobro.movimiento_id); // el enlace apunta a ESA fila
    expect(r.movimientos[0].monto).toBe("12345.67");
    expect(r.movimientos[0].registrado_por).toBe(r.actorId);
    expect(r.movimientos[0].descripcion).toBe(`${MARCA} — ${PERIODO}`);
  });

  it("⭑ si la escritura del libro falla EN EL MOTOR, NO queda la decisión: o las dos, o ninguna", async () => {
    // El fallo se provoca contra Postgres, no desde un doble: se envuelve el repositorio del libro
    // para que intente un movimiento con un `registrado_por` que NO existe en `usuario`, lo que
    // viola `wallet_movimiento_registrado_por_fkey`. Quien deshace el `UPDATE` de la decisión —ya
    // ejecutado— es el `ROLLBACK TO SAVEPOINT`.
    //
    // Se eligió la FK y no un CHECK de monto A PROPÓSITO, y es un hallazgo que merece quedar
    // escrito: **`wallet_movimiento` NO tiene ningún CHECK** —ni de monto positivo— y por eso un
    // `monto = 0` entra sin protestar. El invariante del importe del libro vive en el borde (zod)
    // y en el servicio, no en la tabla; la tabla del COBRO sí lo tiene (R52).
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [actorId] = await idsDeUsuarios(tx, 1);
      const plantillaId = randomUUID();
      const cobroId = randomUUID();
      await insertarPlantilla(tx, plantillaId);
      const origenId = await insertarCobroPendiente(tx, cobroId, plantillaId);

      const cliente = tx as unknown as PrismaClient;
      const libroReal = new WalletMovimientoRepository(cliente);
      const libroQueRevienta = {
        ...libroReal,
        crearMovimientos: async () => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "wallet_movimiento"
               ("id","tipo","categoria","monto","origen_tipo","origen_id","descripcion","registrado_por")
             VALUES ($1, 'egreso'::"wallet_movimiento_tipo",
                     'egreso_gasto_fijo'::"wallet_movimiento_categoria",
                     '80000.00'::numeric, 'gasto'::"wallet_origen_tipo", $2, 'fallo provocado', $3)`,
            randomUUID(),
            origenId,
            randomUUID(), // usuario inexistente -> viola la FK y Postgres aborta la sentencia
          );
          return 0; // inalcanzable
        },
        obtenerPorOrigen: libroReal.obtenerPorOrigen.bind(libroReal),
        listar: libroReal.listar.bind(libroReal),
        agregarPorCategoriaYTipo: libroReal.agregarPorCategoriaYTipo.bind(libroReal),
        obtenerPorId: libroReal.obtenerPorId.bind(libroReal),
        agregarPorCategoria: libroReal.agregarPorCategoria.bind(libroReal),
      };
      const svc = new GastoFijoCobroService(
        new GastoFijoCobroRepository(cliente),
        libroQueRevienta,
        cliente,
        runnerConSavepoint(tx),
      );

      let mensaje = "";
      try {
        await svc.aprobar({ id: cobroId }, maestro(actorId), AHORA);
      } catch (error) {
        mensaje = (error as Error).message;
      }

      return {
        mensaje,
        cobro: await leerCobro(tx, cobroId),
        movimientos: await movimientosDeLaClave(tx, origenId),
      };
    });

    expect(r.mensaje, "la aprobación no falló: el caso no está midiendo nada").toMatch(
      /wallet_movimiento_registrado_por_fkey/i,
    );
    // R15: la decisión NO quedó. Un cobro aprobado sin movimiento detrás es dinero autorizado que
    // no está en el libro.
    expect(r.cobro.estado).toBe("pendiente");
    expect(r.cobro.decidido_por).toBeNull();
    expect(r.cobro.decidido_at).toBeNull();
    expect(r.cobro.movimiento_id).toBeNull();
    expect(r.movimientos).toHaveLength(0);
  });
});

describeSiHayBase("333/D7 — R17: un cobro ya decidido no escribe y responde `ya_decidido`", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ aprobar DOS veces seguidas: la segunda no toca el libro y no reescribe la decisión", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [actorId] = await idsDeUsuarios(tx, 1);
      const plantillaId = randomUUID();
      const cobroId = randomUUID();
      await insertarPlantilla(tx, plantillaId);
      const origenId = await insertarCobroPendiente(tx, cobroId, plantillaId);

      const svc = servicioSobre(tx as unknown as PrismaClient, runnerConSavepoint(tx));
      const primera = await svc.aprobar({ id: cobroId }, maestro(actorId), AHORA);
      const trasLaPrimera = await leerCobro(tx, cobroId);
      const segunda = await svc.aprobar(
        { id: cobroId },
        maestro(actorId),
        new Date("2026-08-30T18:00:00.000Z"),
      );

      return {
        primera,
        segunda,
        trasLaPrimera,
        trasLaSegunda: await leerCobro(tx, cobroId),
        movimientos: await movimientosDeLaClave(tx, origenId),
      };
    });

    expect(r.primera).toEqual({ status: "ok", yaEstabaEnElLibro: false });
    expect(r.segunda).toEqual({ status: "ya_decidido" }); // R17
    expect(r.movimientos, "la segunda aprobación escribió en el libro").toHaveLength(1);
    // Y el `decidido_at` NO se movió: la decisión es la primera, con su instante original.
    expect(r.trasLaSegunda.decidido_at?.toISOString()).toBe(
      r.trasLaPrimera.decidido_at?.toISOString(),
    );
  });

  it("⭑ un cobro RECHAZADO no se puede aprobar: `ya_decidido` y ni una fila en el libro", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [actorId] = await idsDeUsuarios(tx, 1);
      const plantillaId = randomUUID();
      const cobroId = randomUUID();
      await insertarPlantilla(tx, plantillaId);
      const origenId = await insertarCobroPendiente(tx, cobroId, plantillaId);

      const svc = servicioSobre(tx as unknown as PrismaClient, runnerConSavepoint(tx));
      const rechazo = await svc.rechazar({ id: cobroId }, maestro(actorId), AHORA);
      const aprobacion = await svc.aprobar({ id: cobroId }, maestro(actorId), AHORA);

      return {
        rechazo,
        aprobacion,
        cobro: await leerCobro(tx, cobroId),
        movimientos: await movimientosDeLaClave(tx, origenId),
      };
    });

    expect(r.rechazo).toEqual({ status: "ok" });
    expect(r.aprobacion).toEqual({ status: "ya_decidido" });
    expect(r.cobro.estado).toBe("rechazado");
    expect(r.cobro.movimiento_id).toBeNull();
    expect(r.movimientos, "un rechazo escribió en el libro").toHaveLength(0); // R21
  });

  it("⭑ el `WHERE estado = 'pendiente'` está EN LA SENTENCIA: sobre un decidido afecta 0 filas", async () => {
    // Se ejerce el `UPDATE` del repositorio directamente, sin pasar por el servicio, para que lo
    // que se mida sea la sentencia y no una rama de código. Quitar `estado = 'pendiente'` de ese
    // `where` mata este caso — es una de las tres mutaciones de dinero que la ficha obliga a
    // demostrar, y su salida ROJA está pegada en `progress/impl_333.md`.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [actorId] = await idsDeUsuarios(tx, 1);
      const plantillaId = randomUUID();
      const cobroId = randomUUID();
      await insertarPlantilla(tx, plantillaId);
      await insertarCobroPendiente(tx, cobroId, plantillaId);

      const repo = new GastoFijoCobroRepository(tx as unknown as PrismaClient);
      const primera = await repo.marcarDecidido(
        tx as unknown as PrismaClient,
        cobroId,
        "aprobado",
        actorId,
        AHORA,
      );
      const segunda = await repo.marcarDecidido(
        tx as unknown as PrismaClient,
        cobroId,
        "rechazado",
        actorId,
        AHORA,
      );
      return { primera, segunda, cobro: await leerCobro(tx, cobroId) };
    });

    expect(r.primera).toBe(1); // la decisión es tuya
    expect(r.segunda).toBe(0); // ya estaba decidido
    expect(r.cobro.estado).toBe("aprobado"); // el segundo intento NO lo reescribió a `rechazado`
  });
});

describeSiHayBase("333/D7 — R19: si el libro YA tiene la clave, se enlaza y se avisa", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ el caso MIXTO: no se crea un segundo movimiento y `yaEstabaEnElLibro` es `true`", async () => {
    // Pasa de verdad: alguien cambia el interruptor de la plantilla a mitad de período, el cron
    // escribe el egreso automático y el cobro pendiente del mismo período sigue en la cola.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [actorId] = await idsDeUsuarios(tx, 1);
      const plantillaId = randomUUID();
      const cobroId = randomUUID();
      const movimientoId = randomUUID();
      await insertarPlantilla(tx, plantillaId);
      const origenId = await insertarCobroPendiente(tx, cobroId, plantillaId);

      // El egreso que el cron ya escribió, con `registrado_por = NULL` (automático).
      await tx.$executeRawUnsafe(
        `INSERT INTO "wallet_movimiento"
           ("id","tipo","categoria","monto","origen_tipo","origen_id","descripcion","registrado_por")
         VALUES ($1, 'egreso'::"wallet_movimiento_tipo",
                 'egreso_gasto_fijo'::"wallet_movimiento_categoria",
                 '80000.00'::numeric, 'gasto'::"wallet_origen_tipo", $2, $3, NULL)`,
        movimientoId,
        origenId,
        `${MARCA} — ${PERIODO}`,
      );

      const svc = servicioSobre(tx as unknown as PrismaClient, runnerConSavepoint(tx));
      const salida = await svc.aprobar({ id: cobroId }, maestro(actorId), AHORA);

      return {
        salida,
        cobro: await leerCobro(tx, cobroId),
        movimientos: await movimientosDeLaClave(tx, origenId),
        movimientoId,
      };
    });

    expect(r.salida).toEqual({ status: "ok", yaEstabaEnElLibro: true }); // R19: dice la verdad
    expect(r.movimientos, "se cobró DOS veces el mismo período").toHaveLength(1);
    expect(r.movimientos[0].id).toBe(r.movimientoId); // el que ya estaba
    expect(r.movimientos[0].registrado_por).toBeNull(); // el original no se reescribió
    // Y el cobro queda `aprobado` ENLAZADO a ese movimiento.
    expect(r.cobro.estado).toBe("aprobado");
    expect(r.cobro.movimiento_id).toBe(r.movimientoId);
  });

  it("⭑ CONTROL: sin ese movimiento previo, la MISMA aprobación devuelve `yaEstabaEnElLibro: false`", async () => {
    // Sin el control, el caso de arriba pasaría igual si el servicio devolviera siempre `true`.
    const salida = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [actorId] = await idsDeUsuarios(tx, 1);
      const plantillaId = randomUUID();
      const cobroId = randomUUID();
      await insertarPlantilla(tx, plantillaId);
      await insertarCobroPendiente(tx, cobroId, plantillaId);
      const svc = servicioSobre(tx as unknown as PrismaClient, runnerConSavepoint(tx));
      return svc.aprobar({ id: cobroId }, maestro(actorId), AHORA);
    });

    expect(salida).toEqual({ status: "ok", yaEstabaEnElLibro: false });
  });

  it("⭑ R20: aprobar un cobro que no existe responde `not_found` sin escribir nada", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [actorId] = await idsDeUsuarios(tx, 1);
      const svc = servicioSobre(tx as unknown as PrismaClient, runnerConSavepoint(tx));
      const inexistente = randomUUID();
      const salida = await svc.aprobar({ id: inexistente }, maestro(actorId), AHORA);
      return { salida, movimientos: await movimientosDeLaClave(tx, `${inexistente}:${PERIODO}`) };
    });

    expect(r.salida).toEqual({ status: "not_found" });
    expect(r.movimientos).toHaveLength(0);
  });
});

describeSiHayBase("333/D7 — R55: el conteo por plantilla cuenta SOLO sus pendientes", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ el `WHERE` lleva las DOS condiciones: la plantilla Y el estado", async () => {
    // El método nace en la tanda D porque R55 lo necesita, y su `where` se prueba DONDE VIVE: con
    // una sola condición contaría cobros de otras plantillas —o los ya decididos, que el borrado
    // no cancela— y la confirmación anunciaría un número falso sobre una operación irreversible.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [actorId] = await idsDeUsuarios(tx, 1);
      const mia = randomUUID();
      const ajena = randomUUID();
      await insertarPlantilla(tx, mia);
      await insertarPlantilla(tx, ajena);

      // Dos pendientes míos (períodos distintos), uno ya decidido mío, y uno pendiente ajeno.
      for (const periodo of ["2026-08", "2026-09"]) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "gasto_fijo_cobro"
             ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el")
           VALUES ($1, $2, $3, $4, $5, '80000.00'::numeric,
                   'pendiente'::"gasto_fijo_cobro_estado", DATE '2026-08-29')`,
          randomUUID(),
          mia,
          `${mia}:${periodo}`,
          periodo,
          MARCA,
        );
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO "gasto_fijo_cobro"
           ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el",
            "decidido_por","decidido_at")
         VALUES ($1, $2, $3, '2026-07', $4, '80000.00'::numeric,
                 'rechazado'::"gasto_fijo_cobro_estado", DATE '2026-07-29', $5, NOW())`,
        randomUUID(),
        mia,
        `${mia}:2026-07`,
        MARCA,
        actorId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "gasto_fijo_cobro"
           ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el")
         VALUES ($1, $2, $3, '2026-08', $4, '80000.00'::numeric,
                 'pendiente'::"gasto_fijo_cobro_estado", DATE '2026-08-29')`,
        randomUUID(),
        ajena,
        `${ajena}:2026-08`,
        MARCA,
      );

      const repo = new GastoFijoCobroRepository(tx as unknown as PrismaClient);
      return {
        mios: await repo.contarPendientesDePlantilla(mia),
        ajenos: await repo.contarPendientesDePlantilla(ajena),
      };
    });

    expect(r.mios).toBe(2); // los DOS pendientes; el rechazado NO cuenta
    expect(r.ajenos).toBe(1); // y los de otra plantilla tampoco se mezclan
  });

  it("⭑ cancelar por plantilla devuelve el número REAL y deja los decididos intactos (R45/R56)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [actorId] = await idsDeUsuarios(tx, 1);
      const plantillaId = randomUUID();
      await insertarPlantilla(tx, plantillaId);
      const pendienteA = randomUUID();
      const pendienteB = randomUUID();
      const rechazado = randomUUID();
      await insertarCobroPendiente(tx, pendienteA, plantillaId);
      await tx.$executeRawUnsafe(
        `INSERT INTO "gasto_fijo_cobro"
           ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el")
         VALUES ($1, $2, $3, '2026-09', $4, '80000.00'::numeric,
                 'pendiente'::"gasto_fijo_cobro_estado", DATE '2026-09-29')`,
        pendienteB,
        plantillaId,
        `${plantillaId}:2026-09`,
        MARCA,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "gasto_fijo_cobro"
           ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el",
            "decidido_por","decidido_at")
         VALUES ($1, $2, $3, '2026-07', $4, '80000.00'::numeric,
                 'rechazado'::"gasto_fijo_cobro_estado", DATE '2026-07-29', $5, NOW())`,
        rechazado,
        plantillaId,
        `${plantillaId}:2026-07`,
        MARCA,
        actorId,
      );

      const svc = servicioSobre(tx as unknown as PrismaClient, runnerConSavepoint(tx));
      const cancelados = await svc.cancelarPorPlantilla(
        tx as unknown as PrismaClient,
        plantillaId,
        maestro(actorId),
        AHORA,
      );

      return {
        cancelados,
        a: await leerCobro(tx, pendienteA),
        b: await leerCobro(tx, pendienteB),
        rechazado: await leerCobro(tx, rechazado),
        actorId,
      };
    });

    expect(r.cancelados).toBe(2); // R56: el número REAL
    expect(r.a.estado).toBe("cancelado");
    expect(r.a.decidido_por).toBe(r.actorId);
    expect(r.a.decidido_at).not.toBeNull();
    expect(r.b.estado).toBe("cancelado");
    // R23/R47: lo ya decidido NO se toca. Su decisión es final y es evidencia.
    expect(r.rechazado.estado).toBe("rechazado");
  });
});

// ---------------------------------------------------------------------------
// R18 — DOS APROBACIONES SIMULTÁNEAS. El único bloque que COMMITEA.
// ---------------------------------------------------------------------------

describeSiHayBase("333/D7 — R18: dos aprobaciones simultáneas dejan UN movimiento y UNA decisión", () => {
  let prismaA: PrismaClient;
  let prismaB: PrismaClient;

  /**
   * Barre TODO lo que este bloque pudo dejar, por su MARCA. El orden es obligatorio: primero los
   * cobros (su `movimiento_id` es una FK `RESTRICT` contra el libro), después los movimientos y al
   * final las plantillas.
   *
   * Se ejecuta ANTES y DESPUÉS: si una corrida anterior murió a mitad, la siguiente arranca
   * limpia en vez de heredar su basura.
   */
  async function barrer(): Promise<void> {
    await prismaA.$executeRawUnsafe(`DELETE FROM "gasto_fijo_cobro" WHERE "concepto" = $1`, MARCA);
    await prismaA.$executeRawUnsafe(
      `DELETE FROM "wallet_movimiento" WHERE "descripcion" LIKE $1`,
      `${MARCA}%`,
    );
    await prismaA.$executeRawUnsafe(
      `DELETE FROM "gasto_fijo_plantilla" WHERE "concepto" = $1`,
      MARCA,
    );
  }

  beforeAll(async () => {
    prismaA = crearPrismaDeTest();
    prismaB = crearPrismaDeTest();
    await barrer();
  });
  afterAll(async () => {
    await barrer();
    await prismaA.$disconnect();
    await prismaB.$disconnect();
  });

  it("⭑ una gana con `ok` y la otra pierde con `ya_decidido`; el libro queda con UNA fila", async () => {
    // POR QUE ESTE CASO COMMITEA: dos transacciones que se pelean por una fila necesitan que esa
    // fila esté commiteada y necesitan DOS conexiones. Dentro de una transacción revertida no hay
    // concurrencia que medir — habría una sola transacción haciendo dos cosas seguidas.
    //
    // Lo que se demuestra: bajo `READ COMMITTED` la segunda transacción ESPERA el bloqueo de fila
    // que tomó la primera, re-evalúa el `WHERE ... AND estado = 'pendiente'` tras su commit,
    // afecta CERO filas y sale sin escribir. Con el `WHERE` mutado, las DOS escribirían y las dos
    // devolverían `ok`.
    const [actorGanador, actorPerdedor] = await idsDeUsuarios(prismaA, 2);
    const plantillaId = randomUUID();
    const cobroId = randomUUID();
    const origenId = `${plantillaId}:${PERIODO}`;

    try {
      // Fixture COMMITEADO: sin esto, la segunda conexión no vería el cobro.
      await prismaA.$transaction(async (tx) => {
        await insertarPlantilla(tx as unknown as TxDeTest, plantillaId);
        await insertarCobroPendiente(tx as unknown as TxDeTest, cobroId, plantillaId);
      });

      const svcA = servicioSobre(prismaA, (fn) =>
        prismaA.$transaction((tx) => fn(tx as unknown as GastoFijoCobroTx), {
          timeout: 20_000,
          maxWait: 15_000,
        }),
      );
      const svcB = servicioSobre(prismaB, (fn) =>
        prismaB.$transaction((tx) => fn(tx as unknown as GastoFijoCobroTx), {
          timeout: 20_000,
          maxWait: 15_000,
        }),
      );

      const [a, b] = await Promise.all([
        svcA.aprobar({ id: cobroId }, maestro(actorGanador), AHORA),
        svcB.aprobar({ id: cobroId }, maestro(actorPerdedor), AHORA),
      ]);

      const resultados = [a.status, b.status].sort();
      // R18: EXACTAMENTE una decisión. Que las dos digan `ok` es lo que la mutación produce.
      expect(resultados).toEqual(["ok", "ya_decidido"]);

      const movimientos = await movimientosDeLaClave(prismaA, origenId);
      expect(movimientos, "quedó más de un movimiento en el libro").toHaveLength(1);

      const cobro = await leerCobro(prismaA, cobroId);
      expect(cobro.estado).toBe("aprobado");
      expect(cobro.movimiento_id).toBe(movimientos[0].id);
      // Y el decisor registrado es EL MISMO que escribió el egreso: la decisión y el dinero no se
      // pueden atribuir a dos personas distintas.
      expect(cobro.decidido_por).toBe(movimientos[0].registrado_por);
      expect([actorGanador, actorPerdedor]).toContain(cobro.decidido_por);
    } finally {
      await barrer();
    }
  }, 60_000);

  it("⭑ y el barrido deja la base como estaba: ni una fila con la marca de esta prueba", async () => {
    const restos = await prismaA.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT (SELECT count(*) FROM "gasto_fijo_cobro" WHERE "concepto" = $1)
            + (SELECT count(*) FROM "gasto_fijo_plantilla" WHERE "concepto" = $1)
            + (SELECT count(*) FROM "wallet_movimiento" WHERE "descripcion" LIKE $2) AS n`,
      MARCA,
      `${MARCA}%`,
    );
    expect(Number(restos[0].n)).toBe(0);
  });
});
