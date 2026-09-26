import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";

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
// FICHA 461 / R62, R64, R67, R71 — LAS TRES MIGRACIONES DE LA AUDITORIA (4, 5 y 6 de 6), contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
//  (a) `historial_accion_tipo` es EXACTAMENTE el catalogo, con `wallet_movimiento_manual_anulado` al final;
//  (b) las dos columnas `clave_idempotencia` existen, admiten NULL y llevan su indice UNIQUE;
//  (c) `ajuste_caja_anulacion`: RLS activa, UNIQUE(movimiento_id) (23505), CHECK del motivo (23514) y
//      las dos FK RESTRICT (borrar la correccion o al anulador falla con 23503);
//  (d) el `down` de la migracion 5 ABORTA con una fila con clave o con una anulacion, sin borrar nada;
//  (e) el `down` dinamico de la migracion 4 lleva la MISMA funcion que el de la 1 de esta ficha, byte a byte.
//
// Todo en transacciones que SIEMPRE se revierten.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MIGRACIONES = path.join(process.cwd(), "db", "migrations");
const leer = (dir: string, archivo: string) => fs.readFileSync(path.join(MIGRACIONES, dir, archivo), "utf8").replace(/\r\n/g, "\n");
const DOWN_ENUM_461_1 = leer("20260926120000_cobro_tienda_461_enums", "down.sql");
const DOWN_ENUM_461_4 = leer("20260926120300_wallet_461_enum_anulacion_correccion", "down.sql");
const UP_5 = leer("20260926120400_wallet_461_idempotencia_y_anulacion_correccion", "migration.sql");
const DOWN_5 = leer("20260926120400_wallet_461_idempotencia_y_anulacion_correccion", "down.sql");

function funcionDe(down: string): string {
  const m = /CREATE OR REPLACE FUNCTION pg_temp\.quitar_valores_de_enum_461[\s\S]*?\$fn\$;/.exec(down);
  if (m === null) throw new Error("el down.sql no trae la funcion de reversion");
  return m[0];
}

describeSiHayBase("461 — migraciones 4, 5 y 6 (auditoria D2/D3/T2) contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("(a) el enum del historial es EXACTAMENTE el catalogo, y `wallet_movimiento_manual_anulado` cierra lo de la 461", async () => {
    const tipos = await etiquetasDeEnum(prisma, "historial_accion_tipo");
    expect([...tipos].sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    // Ficha 457 (2026-09-25): sus dos tipos (`20260927120000`) van DETRAS; el orden relativo se conserva.
    expect(tipos.slice(-4, -2)).toEqual(["cobro_tienda_anulado", "wallet_movimiento_manual_anulado"]);
  });

  it("(b) R67: las dos columnas `clave_idempotencia` existen, admiten NULL y tienen su indice UNIQUE", async () => {
    const columnas = await prisma.$queryRawUnsafe<{ table_name: string; is_nullable: string; data_type: string }[]>(
      `SELECT table_name, is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'clave_idempotencia'
          AND table_name IN ('wallet_movimiento','wallet_tienda_movimiento') ORDER BY 1`,
    );
    expect(columnas).toEqual([
      { table_name: "wallet_movimiento", is_nullable: "YES", data_type: "text" },
      { table_name: "wallet_tienda_movimiento", is_nullable: "YES", data_type: "text" },
    ]);
    const indices = await prisma.$queryRawUnsafe<{ tablename: string; indexname: string; indexdef: string }[]>(
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%(clave_idempotencia)%'
          AND tablename IN ('wallet_movimiento','wallet_tienda_movimiento') ORDER BY 1`,
    );
    expect(indices.map((i) => [i.tablename, i.indexname, /UNIQUE/.test(i.indexdef)])).toEqual([
      ["wallet_movimiento", "wallet_movimiento_clave_idempotencia_key", true],
      ["wallet_tienda_movimiento", "wallet_tienda_movimiento_clave_idempotencia_key", true],
    ]);
  });

  it("(c) R64/R71: `ajuste_caja_anulacion` con RLS, UNIQUE(movimiento_id), CHECK del motivo y FK RESTRICT", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const rls = await tx.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
        `SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'ajuste_caja_anulacion'`,
      );
      const correccion = await tx.walletMovimiento.create({
        data: { tipo: "ingreso", categoria: "ingreso_ajuste", monto: new Prisma.Decimal("10.00"), origenTipo: "manual", origenId: null, registradoPor: p.maestro.usuarioId, claveIdempotencia: randomUUID() },
        select: { id: true },
      });
      const insertar = (motivo: string) =>
        intentar(
          tx,
          `INSERT INTO "ajuste_caja_anulacion" ("id","movimiento_id","motivo","anulado_por") VALUES ($1, $2, $3, $4)`,
          randomUUID(),
          correccion.id,
          motivo,
          p.maestro.usuarioId,
        );
      const motivoVacio = await insertar("   ");
      const primera = await insertar("Duplicada");
      const segunda = await insertar("Otra vez");
      const borrarCorreccion = await intentar(tx, `DELETE FROM "wallet_movimiento" WHERE "id" = $1`, correccion.id);
      const borrarAnulador = await intentar(tx, `DELETE FROM "usuario" WHERE "id" = $1`, p.maestro.usuarioId);
      const fkInexistente = await intentar(
        tx,
        `INSERT INTO "ajuste_caja_anulacion" ("id","movimiento_id","motivo","anulado_por") VALUES ($1, $2, 'x', $3)`,
        randomUUID(),
        randomUUID(),
        p.maestro.usuarioId,
      );
      return { rls: rls[0]?.relrowsecurity, motivoVacio, primera, segunda, borrarCorreccion, borrarAnulador, fkInexistente };
    });
    expect(m.rls).toBe(true);
    expect(m.motivoVacio).toBe("23514"); // CHECK btrim(motivo) <> ''
    expect(m.primera).toBeNull();
    expect(m.segunda).toBe("23505"); // UNIQUE(movimiento_id): se anula UNA vez
    expect(m.borrarCorreccion).toBe("23001"); // ON DELETE RESTRICT (restrict_violation): la correccion anulada no se borra
    expect(m.borrarAnulador).toBe("23001"); // ON DELETE RESTRICT: quien anulo es evidencia
    expect(m.fkInexistente).toBe("23503"); // FK a una fila que no existe
  });

  it("(d) R62: el down de la migracion 5 ABORTA con una fila con clave o con una anulacion, sin borrar nada", async () => {
    const bloque = /DO \$\$[\s\S]*?\$\$;/.exec(DOWN_5);
    if (bloque === null) throw new Error("el down de la migracion 5 no trae su precondicion");
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      // Con una fila con clave (en el libro de la tienda), aborta.
      const conClave = await tx.walletTiendaMovimiento.create({
        data: { tiendaId: p.tiendaId, tipo: "debito", categoria: "cobro_manual", monto: new Prisma.Decimal("1.00"), origenTipo: "manual", origenId: null, registradoPor: p.maestro.usuarioId, claveIdempotencia: randomUUID() },
        select: { id: true },
      });
      const mensajes: string[] = [];
      const probar = async () => {
        await tx.$executeRawUnsafe(`SAVEPOINT sp_down5`);
        try {
          await tx.$executeRawUnsafe(bloque[0]);
          mensajes.push("NO FALLO");
        } catch (e) {
          mensajes.push(String((e as Error).message));
        }
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT sp_down5`);
      };
      await probar();
      const sigueClave = await tx.walletTiendaMovimiento.count({ where: { id: conClave.id } });
      // Se quita la clave y se pone una anulacion: tambien aborta.
      await tx.walletTiendaMovimiento.update({ where: { id: conClave.id }, data: { claveIdempotencia: null } });
      const correccion = await tx.walletMovimiento.create({
        data: { tipo: "egreso", categoria: "egreso_ajuste", monto: new Prisma.Decimal("1.00"), origenTipo: "manual", origenId: null, registradoPor: p.maestro.usuarioId },
        select: { id: true },
      });
      await tx.ajusteCajaAnulacion.create({ data: { movimientoId: correccion.id, motivo: "x", anuladoPor: p.maestro.usuarioId } });
      await probar();
      const sigueAnulacion = await tx.ajusteCajaAnulacion.count({ where: { movimientoId: correccion.id } });
      return { mensajes, sigueClave, sigueAnulacion };
    });
    expect(m.mensajes).toHaveLength(2);
    for (const mensaje of m.mensajes) expect(mensaje).toContain("rollback 461");
    expect(m.sigueClave).toBe(1);
    expect(m.sigueAnulacion).toBe(1);
  });

  it("(e) el `up` de la 5 es ADITIVO (columnas, indices, tabla) y su `down` lo revierte completo; el down dinamico de la 4 es la MISMA funcion que el de la 1", () => {
    expect(UP_5.match(/ADD COLUMN\s+"clave_idempotencia" TEXT/g)).toHaveLength(2);
    expect(UP_5.match(/CREATE UNIQUE INDEX "wallet_(tienda_)?movimiento_clave_idempotencia_key"/g)).toHaveLength(2);
    expect(UP_5).toMatch(/CREATE TABLE "ajuste_caja_anulacion"/);
    expect(UP_5).toMatch(/ENABLE ROW LEVEL SECURITY/);
    // Ninguna sentencia empieza por UPDATE/DELETE/DROP (los `ON DELETE RESTRICT` de las FK no cuentan).
    expect(soloEjecutable(UP_5)).not.toMatch(/^\s*(UPDATE|DELETE|DROP)\b/m);
    expect(DOWN_5).toMatch(/DROP TABLE "ajuste_caja_anulacion"/);
    expect(DOWN_5.match(/DROP INDEX "wallet_(tienda_)?movimiento_clave_idempotencia_key"/g)).toHaveLength(2);
    expect(DOWN_5.match(/DROP COLUMN "clave_idempotencia"/g)).toHaveLength(2);
    expect(funcionDe(DOWN_ENUM_461_4)).toBe(funcionDe(DOWN_ENUM_461_1));
    expect(DOWN_ENUM_461_4).toMatch(/'wallet_movimiento_manual_anulado'/);
    expect(DOWN_ENUM_461_4).not.toMatch(/CREATE TYPE "[a-z_]+" AS ENUM \(\s*'/);
  });
});
