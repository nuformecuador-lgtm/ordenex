import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { WALLET_MOVIMIENTO_CATEGORIA_SEED, WALLET_ORIGEN_TIPO_SEED } from "@/lib/types/wallet";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  etiquetasDeEnum,
  serializarEscriturasReales,
} from "./_postgres-real";
import { sembrarPersonas461 } from "./_fixtures/personas-461";
import { soloEjecutable } from "./_fixtures/sql-ejecutable";
import { intentarSql as intentar } from "./_fixtures/sqlstate-461";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 461 / T B.10 — LAS TRES MIGRACIONES DEL COBRO (1, 2 y 3 de 6), contra Postgres (R62, R63, R64).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
//  (a) los tres catalogos de la caja y el libro de la tienda son EXACTAMENTE los seeds, con los valores
//      de la 461 al final (valor a valor);
//  (b) los dos CHECK tipo<->categoria ADMITEN `ingreso/ingreso_cobro_tienda`, `egreso/egreso_reverso_cobro_tienda`
//      y `credito/cobro_tienda_anulado`, y RECHAZAN los invertidos con 23514;
//  (c) `cobro_tienda_anulacion`: RLS activa (R64), UNIQUE(cobro_id) (R15), CHECK del motivo (R14) y FK RESTRICT;
//  (d) el `down` de la migracion 2 ABORTA con UNA fila que use lo suyo, sin borrar nada (R62);
//  (e) R63: el `down` dinamico lleva la funcion de la 459 byte a byte salvo el sufijo, y no recrea
//      ningun tipo con una lista escrita a mano.
//
// Todo en transacciones que SIEMPRE se revierten. La migracion 3 (los datos) tiene su propio archivo:
// `cobro-tienda-461-completar-migration.test.ts`.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MIGRACIONES = path.join(process.cwd(), "db", "migrations");
const leer = (dir: string, archivo: string) => fs.readFileSync(path.join(MIGRACIONES, dir, archivo), "utf8").replace(/\r\n/g, "\n");
const UP_1 = leer("20260926120000_cobro_tienda_461_enums", "migration.sql");
const DOWN_1 = leer("20260926120000_cobro_tienda_461_enums", "down.sql");
const UP_2 = leer("20260926120100_cobro_tienda_461_anulacion_y_checks", "migration.sql");
const DOWN_2 = leer("20260926120100_cobro_tienda_461_anulacion_y_checks", "down.sql");
const DOWN_459 = leer("20260925120000_caja_459_enums", "down.sql");

function funcionDe(down: string, sufijo: "459" | "461"): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION pg_temp\\.quitar_valores_de_enum_${sufijo}[\\s\\S]*?\\$fn\\$;`);
  const m = re.exec(down);
  if (m === null) throw new Error(`el down.sql no trae la funcion _${sufijo}`);
  return m[0];
}

describeSiHayBase("461/T B.10 — las migraciones del cobro a una tienda contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("(a) los catalogos son EXACTAMENTE los seeds, con los valores de la 461 AL FINAL, valor a valor", async () => {
    const caja = await etiquetasDeEnum(prisma, "wallet_movimiento_categoria");
    const tienda = await etiquetasDeEnum(prisma, "wallet_tienda_movimiento_categoria");
    const origen = await etiquetasDeEnum(prisma, "wallet_origen_tipo");
    expect([...caja].sort()).toEqual([...WALLET_MOVIMIENTO_CATEGORIA_SEED].sort());
    expect([...tienda].sort()).toEqual([...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED].sort());
    expect([...origen].sort()).toEqual([...WALLET_ORIGEN_TIPO_SEED].sort());
    // Ficha 457 (2026-09-25): sus valores (`20260927120000`) van DETRAS de los de la 461, asi que los de
    // esta ficha ya no cierran la lista: se leen justo antes (dos en la caja, dos en la tienda, uno en el
    // origen). Lo que se afirma es el orden relativo: contiguos y al final de lo que habia antes.
    expect(caja.slice(-4, -2)).toEqual(["ingreso_cobro_tienda", "egreso_reverso_cobro_tienda"]);
    expect(tienda.slice(-3, -2)).toEqual(["cobro_tienda_anulado"]);
    expect(origen.slice(-3, -1)).toEqual(["cobro_tienda", "cobro_tienda_completado"]);
    // El `up` de la 1 es aditivo y solo eso: seis `ADD VALUE IF NOT EXISTS`, ni un CHECK ni una tabla.
    expect(soloEjecutable(UP_1).match(/ADD VALUE IF NOT EXISTS/g)).toHaveLength(6);
    expect(soloEjecutable(UP_1)).not.toMatch(/CHECK|CREATE TABLE|UPDATE|DELETE/);
  });

  it("(b) los CHECK admiten los tres pares de la 461 y RECHAZAN los invertidos (23514)", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const caja = (tipo: string, cat: string) =>
        intentar(
          tx,
          `INSERT INTO "wallet_movimiento" ("id","tipo","categoria","monto","origen_tipo","origen_id")
           VALUES ($1, $2::"wallet_movimiento_tipo", $3::"wallet_movimiento_categoria", 1, 'cobro_tienda', $4)`,
          randomUUID(),
          tipo,
          cat,
          randomUUID(),
        );
      const libro = (tipo: string, cat: string) =>
        intentar(
          tx,
          `INSERT INTO "wallet_tienda_movimiento" ("id","tienda_id","tipo","categoria","monto","origen_tipo","origen_id")
           VALUES ($1, $2, $3::"wallet_tienda_movimiento_tipo", $4::"wallet_tienda_movimiento_categoria", 1, 'cobro_tienda', $5)`,
          randomUUID(),
          p.tiendaId,
          tipo,
          cat,
          randomUUID(),
        );
      return {
        bien: [
          await caja("ingreso", "ingreso_cobro_tienda"),
          await caja("egreso", "egreso_reverso_cobro_tienda"),
          await libro("credito", "cobro_tienda_anulado"),
        ],
        invertidos: [
          await caja("egreso", "ingreso_cobro_tienda"),
          await caja("ingreso", "egreso_reverso_cobro_tienda"),
          await libro("debito", "cobro_tienda_anulado"),
        ],
      };
    });
    expect(m.bien).toEqual([null, null, null]);
    expect(m.invertidos).toEqual(["23514", "23514", "23514"]);
  });

  it("(c) R14/R15/R64: `cobro_tienda_anulacion` con RLS, UNIQUE(cobro_id), CHECK del motivo y FK RESTRICT", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const rls = await tx.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
        `SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'cobro_tienda_anulacion'`,
      );
      const cobro = await tx.walletTiendaMovimiento.create({
        data: { tiendaId: p.tiendaId, tipo: "debito", categoria: "cobro_manual", monto: new Prisma.Decimal("10.00"), origenTipo: "manual", origenId: null, registradoPor: p.maestro.usuarioId },
        select: { id: true },
      });
      const insertar = (motivo: string) =>
        intentar(tx, `INSERT INTO "cobro_tienda_anulacion" ("id","cobro_id","motivo","anulado_por") VALUES ($1, $2, $3, $4)`, randomUUID(), cobro.id, motivo, p.maestro.usuarioId);
      const motivoVacio = await insertar("");
      const primera = await insertar("Cobro equivocado");
      const segunda = await insertar("Otra vez");
      const borrarCobro = await intentar(tx, `DELETE FROM "wallet_tienda_movimiento" WHERE "id" = $1`, cobro.id);
      const borrarAnulador = await intentar(tx, `DELETE FROM "usuario" WHERE "id" = $1`, p.maestro.usuarioId);
      return { rls: rls[0]?.relrowsecurity, motivoVacio, primera, segunda, borrarCobro, borrarAnulador };
    });
    expect(m.rls).toBe(true);
    expect(m.motivoVacio).toBe("23514");
    expect(m.primera).toBeNull();
    expect(m.segunda).toBe("23505");
    // `ON DELETE RESTRICT` es SQLSTATE 23001 (restrict_violation), no 23503: la fila referenciada no se borra.
    expect(m.borrarCobro).toBe("23001");
    expect(m.borrarAnulador).toBe("23001");
  });

  it("(d) R62: el down de la migracion 2 ABORTA con UNA fila que use el cobro en la caja o su anulacion, sin borrar nada", async () => {
    const bloque = /DO \$\$[\s\S]*?\$\$;/.exec(DOWN_2);
    if (bloque === null) throw new Error("el down de la migracion 2 no trae su precondicion");
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const cargo = await tx.walletMovimiento.create({
        data: { tipo: "ingreso", categoria: "ingreso_cobro_tienda", monto: new Prisma.Decimal("1.00"), origenTipo: "cobro_tienda", origenId: randomUUID(), registradoPor: p.maestro.usuarioId },
        select: { id: true },
      });
      await tx.$executeRawUnsafe(`SAVEPOINT sp_down2`);
      let error = "NO FALLO";
      try {
        await tx.$executeRawUnsafe(bloque[0]);
      } catch (e) {
        error = String((e as Error).message);
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT sp_down2`);
      return { error, sigue: await tx.walletMovimiento.count({ where: { id: cargo.id } }) };
    });
    expect(m.error).toContain("rollback 461");
    expect(m.sigue).toBe(1);
    // Y el `up` de la 2 recrea los CHECK como AMPLIACION (los nombra) y crea la tabla con su RLS.
    expect(UP_2).toMatch(/'ingreso_cobro_tienda'\)\)/);
    expect(UP_2).toMatch(/'egreso_reverso_cobro_tienda'\)\)/);
    expect(UP_2).toMatch(/'cobro_tienda_anulado'\)\)/);
    expect(UP_2).toMatch(/ALTER TABLE "cobro_tienda_anulacion" ENABLE ROW LEVEL SECURITY/);
  });

  it("(e) R63: el down dinamico es la funcion de la 459 byte a byte salvo el sufijo, y no recrea ningun tipo con lista fija", () => {
    const de461 = funcionDe(DOWN_1, "461");
    const de459 = funcionDe(DOWN_459, "459");
    expect(de461.replace(/_461/g, "_459").replace(/rollback 461/g, "rollback 459")).toBe(de459);
    expect(DOWN_1).not.toMatch(/CREATE TYPE "[a-z_]+" AS ENUM \(\s*'/);
    // Quita EXACTAMENTE los seis valores de la migracion 1, de los cuatro tipos.
    for (const v of ["ingreso_cobro_tienda", "egreso_reverso_cobro_tienda", "cobro_tienda_anulado", "cobro_tienda", "cobro_tienda_completado"]) {
      expect(DOWN_1).toContain(`'${v}'`);
    }
    expect(DOWN_1.match(/SELECT pg_temp\.quitar_valores_de_enum_461\(/g)).toHaveLength(4);
  });
});
