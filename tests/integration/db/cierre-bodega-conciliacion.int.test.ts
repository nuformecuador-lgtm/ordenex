import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 / T6 (R15) — LOS DOS `CHECK` EXISTEN Y MUERDEN. Contra Postgres de verdad.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ POR QUE ESTE ARCHIVO NO PUEDE SER UN TEST CON DOBLES, Y NO ES UNA OPINION: **un `CHECK` no
// existe para los dobles**. R15 dice «por NINGUN camino —aplicacion, script o SQL a mano—», y eso
// solo lo puede demostrar la base rechazando la escritura. Un doble devuelve lo que el test le diga.
//
// LO QUE MIDE, y cada caso es un estado malo que la ficha declara imposible:
//   (a) `estado='aprobado'` SIN datos de marca                      -> la base lo rechaza;
//   (b) datos de marca en una consolidacion que NO esta `aprobado`  -> la base lo rechaza;
//   (c) `monto_recibido` NEGATIVO                                   -> la base lo rechaza;
//   (d) EL CAMINO VIEJO: `resolverCierreBodega({nuevoEstado:'aprobado'})` -> ERROR DE LA BASE.
//       Es el punto del diseño: el camino de aprobar no se borra, se vuelve IMPOSIBLE DE ESCRIBIR.
//       Si alguien lo vuelve a montar, se entera con un error y no con una fila muda.
//   (e) el CONTROL POSITIVO: la forma coherente SI entra. Sin el, un `CHECK` que lo rechazara todo
//       pasaria (a)-(d) en verde y nadie podria marcar nada.
//
// ⚠️ NADA DE `if (!fks) return;`. Este archivo siembra SUS PROPIAS filas y falla RUIDOSAMENTE si no
// puede: un test de integracion que hace `return` cuando no halla datos reporta `passed` sin haber
// comprobado nada, y este repo ya se comio esa mentira.
//
// AISLAMIENTO: todo corre dentro de una transaccion que SIEMPRE se revierte, y las zonas llevan un
// sufijo propio, asi que no choca con la base local compartida entre worktrees ni deja rastro. Sin
// base alcanzable el archivo se SALTA — y en ese caso el resultado de esta task NO cuenta (mirar
// los `skipped`, no solo el exit).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const SUFIJO = `431-chk-${Date.now().toString(36)}`;

const RAIZ = path.resolve(__dirname, "../../..");
const DIR_MIGRACION = path.join(
  RAIZ,
  "db",
  "migrations",
  "20260919120100_cierre_bodega_conciliacion",
);

// ---------------------------------------------------------------------------------------------
// Estatico: corre SIEMPRE, tambien sin base. Es lo unico que no depende de que haya Postgres.
// ---------------------------------------------------------------------------------------------

/**
 * El SQL SIN sus lineas de comentario.
 *
 * ⚠️ NO ES COSMETICA, Y ESTA MEDIDO: la mutacion 2 de T24 —comentar el `DROP INDEX` del indice
 * unico parcial en vez de borrarlo— dejaba VERDE un barrido que leyera el archivo entero, porque la
 * linea comentada sigue conteniendo el texto. La prosa de esta migracion nombra a proposito lo que
 * hace y lo que NO hace; leerla como si fuera codigo es leer una intencion, no una sentencia.
 */
function soloEjecutable(sql: string): string {
  return sql
    .split("\n")
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");
}

describe("431/T6 — la migracion de la conciliacion: forma en disco", () => {
  const upSql = soloEjecutable(fs.readFileSync(path.join(DIR_MIGRACION, "migration.sql"), "utf8"));
  const upCompleto = fs.readFileSync(path.join(DIR_MIGRACION, "migration.sql"), "utf8");
  const downSql = soloEjecutable(fs.readFileSync(path.join(DIR_MIGRACION, "down.sql"), "utf8"));
  const downCompleto = fs.readFileSync(path.join(DIR_MIGRACION, "down.sql"), "utf8");

  it("anti-vacuidad del filtro de comentarios: quita prosa y conserva sentencias", () => {
    // Si `soloEjecutable` devolviera vacio —o no filtrara nada—, todo lo de abajo mediria otra cosa
    // EN VERDE. Se prueba en las dos direcciones sobre el archivo real.
    expect(upSql.length).toBeGreaterThan(200);
    expect(upSql.length).toBeLessThan(upCompleto.length);
    expect(upSql).toContain('ALTER TABLE "cierre_bodega"');
    expect(upSql).not.toContain("EL CORAZON DE LA FICHA"); // una frase que solo vive en un comentario
    expect(soloEjecutable('-- DROP INDEX IF EXISTS "x";')).not.toContain("DROP INDEX");
  });

  it("trae migration.sql y down.sql", () => {
    expect(upSql.length).toBeGreaterThan(0);
    expect(downSql.length).toBeGreaterThan(0);
  });

  it("⭑ el BACKFILL va ANTES que los dos CHECK: por eso los CHECK lo validan", () => {
    // Si los `CHECK` fueran primero, un `aprobado` historico sin marca los reventaria y la
    // migracion no llegaria nunca al backfill que lo arregla. Al reves, el `CHECK` es la
    // comprobacion final: si el backfill dejara UNA fila fuera, la migracion NO TERMINA.
    const iBackfill = upSql.indexOf('UPDATE "cierre_bodega"');
    const iCoherente = upSql.indexOf('ADD CONSTRAINT "cierre_bodega_conciliacion_coherente"');
    const iNoNegativo = upSql.indexOf(
      'ADD CONSTRAINT "cierre_bodega_monto_recibido_no_negativo"',
    );
    expect(iBackfill).toBeGreaterThan(-1);
    expect(iCoherente).toBeGreaterThan(iBackfill);
    expect(iNoNegativo).toBeGreaterThan(iBackfill);
  });

  it("⭑ el backfill usa `total_efectivo` y NO `total_general` (decision Q2, medida)", () => {
    // ES LA CORRECCION MAS IMPORTANTE DE LA FICHA. El saldo mide EFECTIVO —lo que viaja en el
    // bulto—, y el SINPE (26,3 % del consolidado, medido en produccion el 2026-09-15) entra directo
    // a una cuenta. Con `total_general` aqui, la resta `total_efectivo - monto_recibido` daria
    // NEGATIVO por el importe del SINPE y la pantalla arrancaria debiendole dinero a las satelites
    // en vez de en ₡0,00.
    const backfill = upSql.slice(
      upSql.indexOf('UPDATE "cierre_bodega"'),
      upSql.indexOf("ALTER TABLE", upSql.indexOf('UPDATE "cierre_bodega"')),
    );
    expect(backfill).toMatch(/"monto_recibido"\s*=\s*"total_efectivo"/);
    expect(backfill).not.toMatch(/"monto_recibido"\s*=\s*"total_general"/);
  });

  it("⭑ el backfill copia la FECHA ORIGINAL y deja NOTA visible, y no toca `updated_at`", () => {
    const backfill = upSql.slice(upSql.indexOf('UPDATE "cierre_bodega"'));
    expect(backfill).toMatch(/"conciliado_at"\s*=\s*"resuelto_at"/); // no `now()`
    expect(backfill).toMatch(/"conciliado_por"\s*=\s*"resuelto_por"/);
    expect(backfill).toMatch(/Conciliación retroactiva \(ficha 431\)/);
    // `updated_at` intacto: es la prueba MEDIBLE de que el backfill no modifico nada mas (R30).
    expect(backfill).not.toMatch(/"updated_at"\s*=/);
  });

  it("⭑ el up BORRA el indice unico parcial, y el down lo RECREA con su aviso", () => {
    // El hallazgo que salva la ficha: con `cierre_bodega_zona_solicitado_uq` vivo, la satelite
    // podria asignar pero no volver a consolidar — el mismo freno mudado de sitio.
    expect(upSql).toMatch(/DROP INDEX IF EXISTS "cierre_bodega_zona_solicitado_uq"/);
    expect(downSql).toMatch(/CREATE UNIQUE INDEX "cierre_bodega_zona_solicitado_uq"/);
    // Y el `down` avisa de que su recreacion FALLA si alguna zona tiene dos `solicitado`, que es
    // justo lo que esta ficha hace posible. ESTE caso SI mira la prosa —el aviso ES prosa— y por eso
    // lee el archivo completo y no la parte ejecutable.
    expect(downCompleto).toMatch(/CONSOLIDACIONES `solicitado`/i);
    expect(downCompleto).toMatch(/ABORTA/);
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres: los CHECK muerden.
// ---------------------------------------------------------------------------------------------

describeSiHayBase("431/T6 — los dos CHECK de la conciliacion (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Zona satelite desechable: el dataset tiene que ser SOLO el que el test siembra. */
  async function sembrarZona(tx: TxDeTest, marca: string): Promise<string> {
    const fila = await tx.zona.create({
      data: {
        nombre: `Zona ${SUFIJO}-${marca}`,
        sinpeNumero: "80000000",
        sinpeNombre: "Titular de Prueba",
        cobroVehiculo: false,
        esCentral: false,
      },
      select: { id: true },
    });
    return fila.id;
  }

  /** Un usuario cualquiera al que colgar la consolidacion (`solicitado_por` es una FK). */
  async function algunUsuarioId(tx: TxDeTest): Promise<string> {
    const fila = await tx.usuario.findFirst({ select: { id: true } });
    if (!fila) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `usuario` esta vacia: sin FK no se puede sembrar un " +
          "cierre_bodega. Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    return fila.id;
  }

  it("⭑ (a) `aprobado` SIN datos de marca -> la base lo RECHAZA (R15)", async () => {
    const error = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "a");
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO "cierre_bodega" ("id","zona_id","solicitado_por","estado","total_efectivo","updated_at")
           VALUES ($1, $2, $3, 'aprobado', 100.00, now())`,
          `cb-${SUFIJO}-a`,
          zonaId,
          usuarioId,
        );
        return null;
      } catch (e) {
        return String(e);
      }
    });

    expect(error, "la base ACEPTO un `aprobado` sin datos de marca").not.toBeNull();
    expect(error).toMatch(/cierre_bodega_conciliacion_coherente/);
  });

  it("⭑ (b) datos de marca SIN `aprobado` -> la base lo RECHAZA (R15)", async () => {
    const error = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "b");
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO "cierre_bodega"
             ("id","zona_id","solicitado_por","estado","total_efectivo","updated_at",
              "conciliado_at","conciliado_por","monto_recibido")
           VALUES ($1, $2, $3, 'solicitado', 100.00, now(), now(), $3, 100.00)`,
          `cb-${SUFIJO}-b`,
          zonaId,
          usuarioId,
        );
        return null;
      } catch (e) {
        return String(e);
      }
    });

    expect(error, "la base ACEPTO datos de marca en una consolidacion sin aprobar").not.toBeNull();
    expect(error).toMatch(/cierre_bodega_conciliacion_coherente/);
  });

  it("⭑ (c) `monto_recibido` NEGATIVO -> la base lo RECHAZA", async () => {
    const error = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "c");
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO "cierre_bodega"
             ("id","zona_id","solicitado_por","estado","total_efectivo","updated_at",
              "conciliado_at","conciliado_por","monto_recibido")
           VALUES ($1, $2, $3, 'aprobado', 100.00, now(), now(), $3, -1.00)`,
          `cb-${SUFIJO}-c`,
          zonaId,
          usuarioId,
        );
        return null;
      } catch (e) {
        return String(e);
      }
    });

    expect(error, "la base ACEPTO un monto recibido negativo").not.toBeNull();
    expect(error).toMatch(/cierre_bodega_monto_recibido_no_negativo/);
  });

  it("⭑ (c bis) un monto MAYOR que el total SI se admite: llego de mas, no se maquilla", async () => {
    // Solo se prohibe el NEGATIVO. Que la diferencia quede en negativo y se ensene tal cual es el
    // mismo criterio con el que la ficha 393 decidio mostrar «Para la central» sin recortar a cero.
    const id = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "cbis");
      await tx.$executeRawUnsafe(
        `INSERT INTO "cierre_bodega"
           ("id","zona_id","solicitado_por","estado","total_efectivo","updated_at",
            "conciliado_at","conciliado_por","monto_recibido")
         VALUES ($1, $2, $3, 'aprobado', 100.00, now(), now(), $3, 150.00)`,
        `cb-${SUFIJO}-cbis`,
        zonaId,
        usuarioId,
      );
      const fila = await tx.cierreBodega.findUnique({
        where: { id: `cb-${SUFIJO}-cbis` },
        select: { montoRecibido: true },
      });
      return fila?.montoRecibido?.toFixed(2) ?? null;
    });

    expect(id).toBe("150.00");
  });

  it("⭑ (d) EL CAMINO VIEJO: `resolverCierreBodega('aprobado')` muere en la BASE (R15)", async () => {
    // Este es el caso que hace que la ficha no dependa de la disciplina de nadie. El codigo de
    // aprobar NO se arranca del arbol —arrancarlo exigiria quitar dos valores de un enum cerrado—,
    // pero queda IMPOSIBLE DE ESCRIBIR: pondria `estado='aprobado'` sin datos de marca.
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "d");
      const cb = await tx.cierreBodega.create({
        data: { zonaId, solicitadoPor: usuarioId, estado: "solicitado" },
        select: { id: true },
      });

      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      try {
        await repo.resolverCierreBodega({
          id: cb.id,
          nuevoEstado: "aprobado",
          resueltoPor: usuarioId,
          motivoRechazo: null,
        });
        return { error: null as string | null };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(
      resultado.error,
      "el camino viejo de APROBAR sigue pudiendo escribir: R15 no se cumple",
    ).not.toBeNull();
    expect(resultado.error).toMatch(/cierre_bodega_conciliacion_coherente/);
  });

  it("(d bis) RECHAZAR sigue siendo legal para la base (se retira de la pantalla, no de los datos)", async () => {
    // D2/R16: las rechazadas historicas PERMANECEN en la base. El `CHECK` no las toca.
    const estado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "dbis");
      const cb = await tx.cierreBodega.create({
        data: { zonaId, solicitadoPor: usuarioId, estado: "solicitado" },
        select: { id: true },
      });
      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      const r = await repo.resolverCierreBodega({
        id: cb.id,
        nuevoEstado: "rechazado",
        resueltoPor: usuarioId,
        motivoRechazo: "no llego el bulto",
      });
      const fila = await tx.cierreBodega.findUnique({
        where: { id: cb.id },
        select: { estado: true },
      });
      return { r, estado: fila?.estado };
    });

    expect(estado.r).toBe("updated");
    expect(estado.estado).toBe("rechazado");
  });

  it("⭑ (e) CONTROL POSITIVO: la forma COHERENTE si entra (el CHECK no lo rechaza todo)", async () => {
    // Sin este caso, un `CHECK (false)` pasaria los cuatro de arriba en verde y nadie podria marcar
    // nunca nada. Es la mitad que impide que este archivo sea un verde vacio.
    const fila = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "e");
      await tx.$executeRawUnsafe(
        `INSERT INTO "cierre_bodega"
           ("id","zona_id","solicitado_por","estado","total_efectivo","updated_at",
            "conciliado_at","conciliado_por","monto_recibido","conciliado_nota")
         VALUES ($1, $2, $3, 'aprobado', 500.00, now(), now(), $3, 485.00, 'faltaron 15')`,
        `cb-${SUFIJO}-e`,
        zonaId,
        usuarioId,
      );
      return tx.cierreBodega.findUnique({
        where: { id: `cb-${SUFIJO}-e` },
        select: { estado: true, montoRecibido: true, conciliadoNota: true },
      });
    });

    expect(fila?.estado).toBe("aprobado");
    expect(fila?.montoRecibido?.toFixed(2)).toBe("485.00");
    expect(fila?.conciliadoNota).toBe("faltaron 15");
  });

  it("(f) una `solicitado` LIMPIA tambien es coherente: el otro lado del OR", async () => {
    const fila = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "f");
      const cb = await tx.cierreBodega.create({
        data: {
          zonaId,
          solicitadoPor: usuarioId,
          estado: "solicitado",
          totalEfectivo: new Prisma.Decimal("250.00"),
        },
        select: { id: true },
      });
      return tx.cierreBodega.findUnique({
        where: { id: cb.id },
        select: { estado: true, conciliadoAt: true, montoRecibido: true },
      });
    });

    expect(fila?.estado).toBe("solicitado");
    expect(fila?.conciliadoAt).toBeNull();
    expect(fila?.montoRecibido).toBeNull();
  });
});
