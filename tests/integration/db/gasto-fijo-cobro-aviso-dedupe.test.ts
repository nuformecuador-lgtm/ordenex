import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { emitirGastoFijoCobroPendiente } from "@/lib/notificaciones/emitir";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 333 (E7) — EL RECORDATORIO, MEDIDO CONTRA POSTGRES: **R31** (dos corridas del MISMO día
// producen UN solo aviso) y su contraparte **R30** (dos días distintos producen DOS).
//
// POR QUE ESTE ARCHIVO NO PUEDE SER UN TEST DE DOBLES. Lo que decide si el segundo aviso existe
// son DOS mecanismos del motor, y ninguno es una rama de código:
//
//   1. `notificacion_dedupe_key` — `UNIQUE (evento, entidad_id, destinatario_rol,
//      destinatario_usuario_id)` con **`NULLS NOT DISTINCT`** y **`WHERE entidad_id IS NOT NULL`**.
//      El `NULLS NOT DISTINCT` es lo que hace que dos filas dirigidas a un ROL —las dos con
//      `destinatario_usuario_id = NULL`— colisionen; sin él, Postgres las consideraría distintas
//      y el índice no protegería nada. Eso no se ve desde un doble.
//   2. La guardia previa de `emitirFilas` (`existeNoLeidaPara`), que mira `notificacion_lectura`.
//
// Y sobre las dos se apoya la decisión de diseño que esta ficha existe para no repetir: **la
// entidad del aviso es EL DÍA CR, no el cobro** (design §4.2). Con el cobro, la clave admitiría
// UNA sola fila por (evento, cobro, maestro) PARA SIEMPRE y el recordatorio del día 2 no saldría
// nunca, en silencio — el fallo que la 262 documentó.
//
// Todo lo que escribe corre dentro de `enTransaccionRevertida`: si el test pasa, si falla o si el
// proceso muere a mitad, no queda ni una fila en la base compartida.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const EVENTO = "gasto_fijo_cobro_pendiente";

/** Cuántos avisos de esta ficha hay para un día concreto, dirigidos al rol `maestro`. */
async function avisosDelDia(tx: TxDeTest, diaCR: string): Promise<number> {
  const filas = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n
       FROM "notificacion"
      WHERE "evento" = $1::"notificacion_evento"
        AND "entidad_id" = $2
        AND "destinatario_rol" = 'maestro'::"rol_value"`,
    EVENTO,
    diaCR,
  );
  return Number(filas[0].n);
}

describeSiHayBase("333/E7 — R31: dos corridas del MISMO día producen UN solo aviso", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ la segunda emisión del mismo día no crea nada, y en la tabla queda UNA fila", async () => {
    const dia = "2091-03-11"; // fecha lejana: no puede colisionar con datos reales
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx);

      const primera = await emitirGastoFijoCobroPendiente(repo, { pendientes: 2, diaCR: dia }, tx);
      // Segunda corrida del MISMO día CR: el cron se re-ejecutó, o Vercel reintentó.
      const segunda = await emitirGastoFijoCobroPendiente(repo, { pendientes: 3, diaCR: dia }, tx);

      return { primera, segunda, filas: await avisosDelDia(tx, dia) };
    });

    expect(r.primera).toBe(1);
    expect(r.segunda).toBe(0); // R31: no se emite un segundo aviso del mismo día
    expect(r.filas).toBe(1);
  });

  it("⭑ y la fila que queda es la PRIMERA: el segundo intento no reescribe el número", async () => {
    // Importa porque el segundo intento traía `pendientes: 3`. Si el emisor hiciera un upsert, el
    // texto cambiaría bajo los pies de quien ya vio el aviso.
    const dia = "2091-03-12";
    const descripcion = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx);
      await emitirGastoFijoCobroPendiente(repo, { pendientes: 2, diaCR: dia }, tx);
      await emitirGastoFijoCobroPendiente(repo, { pendientes: 9, diaCR: dia }, tx);
      const filas = await tx.$queryRawUnsafe<{ descripcion: string }[]>(
        `SELECT "descripcion" FROM "notificacion"
          WHERE "evento" = $1::"notificacion_evento" AND "entidad_id" = $2`,
        EVENTO,
        dia,
      );
      return filas.map((f) => f.descripcion);
    });

    expect(descripcion).toEqual(["Hay 2 cobros de gasto fijo esperando tu aprobación."]);
  });
});

describeSiHayBase("333/E7 — R30: dos días distintos producen DOS avisos", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ el recordatorio del día siguiente SALE, sin que nadie haya leído el del día anterior", async () => {
    // ESTE ES EL CASO QUE LA ELECCIÓN DE ENTIDAD EXISTE PARA SALVAR. Con el cobro como entidad,
    // `notificacion_dedupe_key` mataría este segundo aviso en silencio absoluto.
    const dia1 = "2091-03-13";
    const dia2 = "2091-03-14";
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx);

      const primera = await emitirGastoFijoCobroPendiente(repo, { pendientes: 2, diaCR: dia1 }, tx);
      const segunda = await emitirGastoFijoCobroPendiente(repo, { pendientes: 2, diaCR: dia2 }, tx);

      return {
        primera,
        segunda,
        dia1: await avisosDelDia(tx, dia1),
        dia2: await avisosDelDia(tx, dia2),
      };
    });

    expect(r.primera).toBe(1);
    expect(r.segunda).toBe(1); // R30: el recordatorio diario es ESTRUCTURAL
    expect(r.dia1).toBe(1);
    expect(r.dia2).toBe(1);
  });

  it("⭑ CONTRAPRUEBA sobre el motor: la MISMA clave, insertada dos veces a pelo, la rechaza el índice", async () => {
    // Sin esto, el caso de R31 podría estar pasando por la guardia previa de no-leídas y el índice
    // único no estaría demostrando nada. Aquí se salta la guardia y se va directo al `INSERT`: lo
    // que rechaza la segunda fila es `notificacion_dedupe_key`, con su `NULLS NOT DISTINCT`.
    //
    // Es también la prueba de que el `NULLS NOT DISTINCT` sigue puesto: sin él, dos filas con
    // `destinatario_usuario_id = NULL` serían distintas para Postgres y este `INSERT` pasaría.
    const dia = "2091-03-15";
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        for (let i = 0; i < 2; i++) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "notificacion"
               ("id","tipo","evento","descripcion","anexo","entidad_tipo","entidad_id","destinatario_rol")
             VALUES (gen_random_uuid()::text, 'warning'::"notificacion_tipo", $1::"notificacion_evento",
                     'Hay 2 cobros de gasto fijo esperando tu aprobación.', NULL,
                     'gasto_fijo_cobro_dia'::"notificacion_entidad_tipo", $2,
                     'maestro'::"rol_value")`,
            EVENTO,
            dia,
          );
        }
      }),
    ).rejects.toThrow(/notificacion_dedupe_key/);
  });

  it("⭑ CONTROL: con entidades distintas (dos días), el MISMO `INSERT` a pelo entra dos veces", async () => {
    // El control positivo del caso anterior: si el `INSERT` fallara por cualquier otra cosa —una
    // columna mal escrita, un cast— aquel test seguiría en verde midiendo su propio ruido.
    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      for (const dia of ["2091-03-16", "2091-03-17"]) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion"
             ("id","tipo","evento","descripcion","anexo","entidad_tipo","entidad_id","destinatario_rol")
           VALUES (gen_random_uuid()::text, 'warning'::"notificacion_tipo", $1::"notificacion_evento",
                   'Hay 2 cobros de gasto fijo esperando tu aprobación.', NULL,
                   'gasto_fijo_cobro_dia'::"notificacion_entidad_tipo", $2,
                   'maestro'::"rol_value")`,
          EVENTO,
          dia,
        );
      }
      const r = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "notificacion"
          WHERE "evento" = $1::"notificacion_evento"
            AND "entidad_id" IN ('2091-03-16','2091-03-17')`,
        EVENTO,
      );
      return Number(r[0].n);
    });

    expect(filas).toBe(2);
  });
});

describeSiHayBase("333/E7 — el aviso que llega a la base es el que R35 describe", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ `warning`, entidad `gasto_fijo_cobro_dia` con la fecha, rol `maestro`, sin anexo y sin usuario", async () => {
    const dia = "2091-03-18";
    const fila = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await emitirGastoFijoCobroPendiente(
        new NotificacionRepository(tx),
        { pendientes: 1, diaCR: dia },
        tx,
      );
      const filas = await tx.$queryRawUnsafe<
        {
          tipo: string;
          evento: string;
          descripcion: string;
          anexo: string | null;
          entidad_tipo: string;
          entidad_id: string | null;
          destinatario_rol: string | null;
          destinatario_usuario_id: string | null;
          tienda_id: string | null;
          zona_id: string | null;
        }[]
      >(
        `SELECT "tipo"::text AS tipo, "evento"::text AS evento, "descripcion", "anexo",
                "entidad_tipo"::text AS entidad_tipo, "entidad_id",
                "destinatario_rol"::text AS destinatario_rol, "destinatario_usuario_id",
                "tienda_id", "zona_id"
           FROM "notificacion"
          WHERE "evento" = $1::"notificacion_evento" AND "entidad_id" = $2`,
        EVENTO,
        dia,
      );
      return filas[0];
    });

    expect(fila).toEqual({
      tipo: "warning",
      evento: "gasto_fijo_cobro_pendiente",
      descripcion: "Hay 1 cobro de gasto fijo esperando tu aprobación.",
      anexo: null, // R35: ni monto, ni concepto, ni nombre
      entidad_tipo: "gasto_fijo_cobro_dia",
      entidad_id: dia, // ⚠️ EL DÍA, no el cobro
      destinatario_rol: "maestro", // y NO el admin (R24: no puede decidir)
      destinatario_usuario_id: null,
      tienda_id: null,
      zona_id: null,
    });
  });
});
