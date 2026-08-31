import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 333 (A7) — la migracion `20260829120000_gasto_fijo_cobro`, medida CONTRA POSTGRES.
//
// POR QUE ESTE ARCHIVO EXISTE Y POR QUE NO PUEDE SER UN TEST DE SERVICIO. Todo lo que se afirma
// aqui vive EN EL MOTOR: la RLS es una propiedad del catalogo, un `CHECK` es una restriccion de
// tabla y el `DELETE` que aborta lo aborta Postgres, no una rama de codigo. Un doble no ve el
// SQL —medido cuatro veces en este repo—, asi que una mutacion del DDL pasaria en verde por el
// camino de los servicios.
//
// Cubre: R50 (RLS), R52 (monto > 0), R46 (una plantilla no puede desaparecer dejando cobros
// `pendiente` vivos) y R47 (los cobros ya decididos y los movimientos del libro sobreviven al
// borrado de la plantilla).
//
// Todo lo que escribe corre dentro de `enTransaccionRevertida`: si el test pasa, si falla o si
// el proceso muere a mitad, no queda ni una fila en la base compartida.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Monto SIEMPRE como texto: entra a la columna con un cast a `numeric`, nunca por un `number`. */
async function insertarPlantilla(
  tx: TxDeTest,
  id: string,
  monto = "80000.00",
): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO "gasto_fijo_plantilla"
       ("id","concepto","monto","activa","periodicidad_unidad","periodicidad_cantidad","fecha_cobro")
     VALUES ($1, 'Alquiler (ficha 333)', $2::numeric, false,
             'meses'::"PeriodicidadUnidad", 1, DATE '2026-08-01')`,
    id,
    monto,
  );
}

async function insertarCobroPendiente(
  tx: TxDeTest,
  id: string,
  plantillaId: string,
  monto = "80000.00",
  periodo = "2026-08",
): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO "gasto_fijo_cobro"
       ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el")
     VALUES ($1, $2, $3, $4, 'Alquiler (ficha 333)', $5::numeric,
             'pendiente'::"gasto_fijo_cobro_estado", DATE '2026-08-29')`,
    id,
    plantillaId,
    `${plantillaId}:${periodo}`,
    periodo,
    monto,
  );
}

/** Un usuario REAL de la base: `decidido_por` es una FK `RESTRICT` contra `usuario`. */
async function idDeUnUsuario(prisma: PrismaClient): Promise<string> {
  const fila = await prisma.usuario.findFirst({ select: { id: true } });
  if (fila === null) {
    // NO se salta el test: se rompe. Un `return` silencioso aqui es exactamente el modo de
    // fallo que este repo ya tiene medido —«passed» sin haber comprobado nada—.
    throw new Error(
      "La base no tiene ni un `usuario`: siembra con `pnpm run db:seed` + `db:seed:maestro` " +
        "antes de correr este archivo. Sin usuario no se puede ejercer la FK `decidido_por`.",
    );
  }
  return fila.id;
}

describeSiHayBase("333/A7 — R50: la tabla nueva nace con RLS habilitada", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ `gasto_fijo_cobro` tiene ROW LEVEL SECURITY activada en el catalogo", async () => {
    const filas = await prisma.$queryRawUnsafe<{ rls: boolean }[]>(
      `SELECT c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'gasto_fijo_cobro'`,
    );
    expect(filas.length, "no existe la tabla `gasto_fijo_cobro`").toBe(1);
    expect(filas[0].rls).toBe(true);
  });

  it("CONTROL: la RLS que se mide es la de esta tabla, y el patron es el del libro", async () => {
    // Anti-vacuidad: si la consulta de arriba estuviera mal escrita y devolviera `true` para
    // cualquier cosa, esto lo delataria comparando con una tabla que TAMBIEN la tiene y con el
    // hecho de que la columna existe y es booleana.
    const filas = await prisma.$queryRawUnsafe<{ relname: string; rls: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('gasto_fijo_cobro', 'wallet_movimiento', 'gasto_fijo_plantilla')
        ORDER BY c.relname`,
    );
    expect(filas.map((f) => f.relname)).toEqual([
      "gasto_fijo_cobro",
      "gasto_fijo_plantilla",
      "wallet_movimiento",
    ]);
    expect(filas.every((f) => f.rls === true)).toBe(true);
  });
});

describeSiHayBase("333/A7 — R52: la base rechaza un cobro con monto cero o negativo", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ monto = 0 -> viola `gasto_fijo_cobro_monto_positivo`", async () => {
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const plantillaId = randomUUID();
        await insertarPlantilla(tx, plantillaId);
        await insertarCobroPendiente(tx, randomUUID(), plantillaId, "0.00");
      }),
    ).rejects.toThrow(/gasto_fijo_cobro_monto_positivo/);
  });

  it("⭑ monto negativo -> viola el MISMO CHECK", async () => {
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const plantillaId = randomUUID();
        await insertarPlantilla(tx, plantillaId);
        await insertarCobroPendiente(tx, randomUUID(), plantillaId, "-1.00");
      }),
    ).rejects.toThrow(/gasto_fijo_cobro_monto_positivo/);
  });

  it("⭑ CONTROL: el céntimo MAS PEQUEÑO si entra, y con su precisión intacta", async () => {
    // Sin este control, los dos casos de arriba pasarian aunque el `INSERT` fallara por otra
    // cosa —una columna mal escrita, un cast— y estarian midiendo su propio ruido.
    const monto = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const plantillaId = randomUUID();
      const cobroId = randomUUID();
      await insertarPlantilla(tx, plantillaId);
      await insertarCobroPendiente(tx, cobroId, plantillaId, "0.01");
      const filas = await tx.$queryRawUnsafe<{ monto: string }[]>(
        `SELECT "monto"::text AS monto FROM "gasto_fijo_cobro" WHERE "id" = $1`,
        cobroId,
      );
      return filas[0]?.monto;
    });
    expect(monto).toBe("0.01");
  });
});

describeSiHayBase("333/A7 — R46: una plantilla NO desaparece dejando pendientes vivos", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ borrar una plantilla con un cobro `pendiente` ABORTA RUIDOSAMENTE", async () => {
    // Es la cascada garantizada EN LA BASE (design §9.4): con `plantilla_id ON DELETE SET NULL`,
    // el `DELETE` intenta dejar el cobro pendiente sin plantilla y viola
    // `gasto_fijo_cobro_pendiente_con_plantilla`. Esto es lo que hace que el orden de llegada de
    // la 332 y la 333 no importe: un borrado sin cancelación previa falla con un error claro en
    // vez de dejar cobros huérfanos y aprobables sin plantilla.
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const plantillaId = randomUUID();
        await insertarPlantilla(tx, plantillaId);
        await insertarCobroPendiente(tx, randomUUID(), plantillaId);
        await tx.$executeRawUnsafe(
          `DELETE FROM "gasto_fijo_plantilla" WHERE "id" = $1`,
          plantillaId,
        );
      }),
    ).rejects.toThrow(/gasto_fijo_cobro_pendiente_con_plantilla/);
  });

  it("⭑ TRAS CANCELARLO, el MISMO borrado funciona y el cobro cancelado sobrevive", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const actorId = await idDeUnUsuario(prisma);
      const plantillaId = randomUUID();
      const cobroId = randomUUID();
      await insertarPlantilla(tx, plantillaId);
      await insertarCobroPendiente(tx, cobroId, plantillaId);

      // Exactamente lo que hace `cancelarPendientesDePlantilla`: estado + quién + cuándo.
      await tx.$executeRawUnsafe(
        `UPDATE "gasto_fijo_cobro"
            SET "estado" = 'cancelado'::"gasto_fijo_cobro_estado",
                "decidido_por" = $2, "decidido_at" = NOW()
          WHERE "id" = $1 AND "estado" = 'pendiente'::"gasto_fijo_cobro_estado"`,
        cobroId,
        actorId,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "gasto_fijo_plantilla" WHERE "id" = $1`,
        plantillaId,
      );

      const plantillas = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "gasto_fijo_plantilla" WHERE "id" = $1`,
        plantillaId,
      );
      const cobros = await tx.$queryRawUnsafe<
        { estado: string; plantilla_id: string | null; monto: string; periodo: string }[]
      >(
        `SELECT "estado"::text AS estado, "plantilla_id", "monto"::text AS monto, "periodo"
           FROM "gasto_fijo_cobro" WHERE "id" = $1`,
        cobroId,
      );
      return { plantillas: Number(plantillas[0].n), cobro: cobros[0] };
    });

    expect(resultado.plantillas).toBe(0); // la plantilla se fue
    expect(resultado.cobro.estado).toBe("cancelado"); // el cobro se queda
    expect(resultado.cobro.plantilla_id).toBeNull(); // ON DELETE SET NULL
    expect(resultado.cobro.monto).toBe("80000.00"); // con su copia intacta
    expect(resultado.cobro.periodo).toBe("2026-08");
  });
});

describeSiHayBase("333/A7 — R47: lo ya decidido y lo ya escrito en el libro sobreviven", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ borrada la plantilla, el cobro APROBADO conserva concepto, monto, periodo y decisión, y su movimiento sigue intacto", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const actorId = await idDeUnUsuario(prisma);
      const plantillaId = randomUUID();
      const cobroId = randomUUID();
      const movimientoId = randomUUID();
      const origenId = `${plantillaId}:2026-08`;

      await insertarPlantilla(tx, plantillaId);
      // El egreso que la aprobación escribió en el libro, con LA CLAVE del cobro.
      await tx.$executeRawUnsafe(
        `INSERT INTO "wallet_movimiento"
           ("id","tipo","categoria","monto","origen_tipo","origen_id","descripcion","registrado_por")
         VALUES ($1, 'egreso'::"wallet_movimiento_tipo",
                 'egreso_gasto_fijo'::"wallet_movimiento_categoria",
                 $2::numeric, 'gasto'::"wallet_origen_tipo", $3,
                 'Alquiler (ficha 333) — 2026-08', $4)`,
        movimientoId,
        "80000.00",
        origenId,
        actorId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "gasto_fijo_cobro"
           ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el",
            "decidido_por","decidido_at","movimiento_id")
         VALUES ($1, $2, $3, '2026-08', 'Alquiler (ficha 333)', $4::numeric,
                 'aprobado'::"gasto_fijo_cobro_estado", DATE '2026-08-29', $5, NOW(), $6)`,
        cobroId,
        plantillaId,
        origenId,
        "80000.00",
        actorId,
        movimientoId,
      );

      await tx.$executeRawUnsafe(
        `DELETE FROM "gasto_fijo_plantilla" WHERE "id" = $1`,
        plantillaId,
      );

      const cobro = await tx.$queryRawUnsafe<
        {
          estado: string;
          plantilla_id: string | null;
          concepto: string;
          monto: string;
          periodo: string;
          decidido_por: string | null;
          decidido_at: Date | null;
          movimiento_id: string | null;
        }[]
      >(
        `SELECT "estado"::text AS estado, "plantilla_id", "concepto", "monto"::text AS monto,
                "periodo", "decidido_por", "decidido_at", "movimiento_id"
           FROM "gasto_fijo_cobro" WHERE "id" = $1`,
        cobroId,
      );
      const mov = await tx.$queryRawUnsafe<
        { monto: string; origen_id: string; descripcion: string }[]
      >(
        `SELECT "monto"::text AS monto, "origen_id", "descripcion"
           FROM "wallet_movimiento" WHERE "id" = $1`,
        movimientoId,
      );
      return { cobro: cobro[0], mov: mov[0], actorId, movimientoId, origenId };
    });

    // El cobro decidido se queda entero: sólo pierde el puntero a la plantilla.
    expect(r.cobro.estado).toBe("aprobado");
    expect(r.cobro.plantilla_id).toBeNull();
    expect(r.cobro.concepto).toBe("Alquiler (ficha 333)");
    expect(r.cobro.monto).toBe("80000.00");
    expect(r.cobro.periodo).toBe("2026-08");
    expect(r.cobro.decidido_por).toBe(r.actorId);
    expect(r.cobro.decidido_at).not.toBeNull();
    expect(r.cobro.movimiento_id).toBe(r.movimientoId);
    // Y el libro no se enteró: la fila sigue ahí, con su monto y su clave.
    expect(r.mov.monto).toBe("80000.00");
    expect(r.mov.origen_id).toBe(r.origenId);
    expect(r.mov.descripcion).toBe("Alquiler (ficha 333) — 2026-08");
  });
});
