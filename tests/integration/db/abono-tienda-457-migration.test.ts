import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { HISTORIAL_ACCION_ENTIDADES, HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED, WALLET_ORIGEN_TIPO_SEED } from "@/lib/types/wallet";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";
import { TIPO_POR_CATEGORIA_TIENDA } from "@/lib/utils/invariante-tiendas";

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
// ⭑ FICHA 457 / T1.5 — LAS DOS MIGRACIONES DEL PAGO DE UNA TIENDA A ORDENEX, contra Postgres (R75, R76).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
//  (a) los CINCO catalogos son EXACTAMENTE los seeds, con los valores de la 457 AL FINAL (valor a valor);
//      el `up` de la 1 son OCHO `ADD VALUE IF NOT EXISTS` y nada mas;
//  (b) los dos CHECK tipo<->categoria ADMITEN los cuatro pares nuevos y RECHAZAN los invertidos (23514);
//  (c) `abono_tienda` y `abono_tienda_anulacion`: RLS activa (R76), EXACTAMENTE dos indices unicos en el
//      documento (PK y clave), UNIQUE(abono_id), los CHECK del documento y FK RESTRICT (23001);
//  (d) el `down` de la migracion 2 ABORTA con UNA fila que use lo suyo, sin borrar nada (R75); y sus CHECK
//      vuelven, byte a byte (normalizados), a las listas de la 461;
//  (e) el `down` dinamico lleva la funcion de la 461 byte a byte salvo el sufijo, quita EXACTAMENTE los
//      ocho valores de los cinco tipos y no recrea ningun tipo con una lista escrita a mano (R75);
//  (f) `TIPO_POR_CATEGORIA_TIENDA` coincide con el CHECK de la tienda LEIDO DEL MOTOR.
//
// Todo en transacciones que SIEMPRE se revierten. El ciclo real up → down → up sobre el clon esta anotado
// en `progress/impl_457.md` (catalogos 25/16/14/63/24 → 23/14/13/61/23 → 25/16/14/63/24).
//
// MUTACION 14 de design §13 (el `down` de la 2 borra aunque haya filas) → rojo en (d).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MIGRACIONES = path.join(process.cwd(), "db", "migrations");
const leer = (dir: string, archivo: string) =>
  fs.readFileSync(path.join(MIGRACIONES, dir, archivo), "utf8").replace(/\r\n/g, "\n");
const UP_1 = leer("20260927120000_abono_tienda_457_enums", "migration.sql");
const DOWN_1 = leer("20260927120000_abono_tienda_457_enums", "down.sql");
const UP_2 = leer("20260927120100_abono_tienda_457_tablas_y_checks", "migration.sql");
const DOWN_2 = leer("20260927120100_abono_tienda_457_tablas_y_checks", "down.sql");
const DOWN_461 = leer("20260926120000_cobro_tienda_461_enums", "down.sql");
const UP_461_2 = leer("20260926120100_cobro_tienda_461_anulacion_y_checks", "migration.sql");

function funcionDe(down: string, sufijo: "461" | "457"): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION pg_temp\\.quitar_valores_de_enum_${sufijo}[\\s\\S]*?\\$fn\\$;`);
  const m = re.exec(down);
  if (m === null) throw new Error(`el down.sql no trae la funcion _${sufijo}`);
  return m[0];
}

/** El cuerpo del CHECK `nombre` tal como lo ESCRIBE un `.sql`, con los blancos normalizados. */
function checkEscrito(sql: string, nombre: string): string {
  const re = new RegExp(`ADD CONSTRAINT "${nombre}"\\s*CHECK \\(([\\s\\S]*?)\\);`);
  const m = re.exec(sql);
  if (m === null) throw new Error(`el sql no recrea ${nombre}`);
  return m[1].replace(/\s+/g, " ").trim();
}

const VALORES_457 = {
  wallet_movimiento_categoria: ["ingreso_abono_tienda", "egreso_reverso_abono_tienda"],
  wallet_tienda_movimiento_categoria: ["abono_tienda", "abono_tienda_anulado"],
  wallet_origen_tipo: ["abono_tienda"],
  historial_accion_tipo: ["abono_tienda_registrado", "abono_tienda_anulado"],
  historial_accion_entidad: ["abono_tienda"],
} as const;

describeSiHayBase("457/T1.5 — las migraciones del pago de una tienda a Ordenex contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("(a) los cinco catalogos son EXACTAMENTE los seeds, con los valores de la 457 AL FINAL, valor a valor", async () => {
    const caja = await etiquetasDeEnum(prisma, "wallet_movimiento_categoria");
    const tienda = await etiquetasDeEnum(prisma, "wallet_tienda_movimiento_categoria");
    const origen = await etiquetasDeEnum(prisma, "wallet_origen_tipo");
    const tipos = await etiquetasDeEnum(prisma, "historial_accion_tipo");
    const entidades = await etiquetasDeEnum(prisma, "historial_accion_entidad");
    expect([...caja].sort()).toEqual([...WALLET_MOVIMIENTO_CATEGORIA_SEED].sort());
    expect([...tienda].sort()).toEqual([...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED].sort());
    expect([...origen].sort()).toEqual([...WALLET_ORIGEN_TIPO_SEED].sort());
    expect([...tipos].sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    expect([...entidades].sort()).toEqual([...HISTORIAL_ACCION_ENTIDADES].sort());
    expect(caja.slice(-2)).toEqual([...VALORES_457.wallet_movimiento_categoria]);
    expect(tienda.slice(-2)).toEqual([...VALORES_457.wallet_tienda_movimiento_categoria]);
    expect(origen.slice(-1)).toEqual([...VALORES_457.wallet_origen_tipo]);
    expect(tipos.slice(-2)).toEqual([...VALORES_457.historial_accion_tipo]);
    expect(entidades.slice(-1)).toEqual([...VALORES_457.historial_accion_entidad]);
    // Los conteos de design §14 «despues»: 25 / 16 / 14 / 63 / 24.
    expect([caja.length, tienda.length, origen.length, tipos.length, entidades.length]).toEqual([25, 16, 14, 63, 24]);
    // El `up` de la 1 es aditivo y solo eso: ocho `ADD VALUE IF NOT EXISTS`, ni un CHECK ni una tabla.
    const up1 = soloEjecutable(UP_1);
    expect(up1.match(/ADD VALUE IF NOT EXISTS/g)).toHaveLength(8);
    expect(up1).not.toMatch(/CHECK|CREATE TABLE|UPDATE|DELETE|INSERT/);
    for (const [tipo, valores] of Object.entries(VALORES_457)) {
      for (const v of valores) expect(up1).toContain(`ALTER TYPE "${tipo}" ADD VALUE IF NOT EXISTS '${v}';`);
    }
  });

  it("(b) los CHECK admiten los cuatro pares de la 457 y RECHAZAN los invertidos (23514)", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const caja = (tipo: string, cat: string) =>
        intentar(
          tx,
          `INSERT INTO "wallet_movimiento" ("id","tipo","categoria","monto","origen_tipo","origen_id")
           VALUES ($1, $2::"wallet_movimiento_tipo", $3::"wallet_movimiento_categoria", 1, 'abono_tienda', $4)`,
          randomUUID(),
          tipo,
          cat,
          randomUUID(),
        );
      const libro = (tipo: string, cat: string) =>
        intentar(
          tx,
          `INSERT INTO "wallet_tienda_movimiento" ("id","tienda_id","tipo","categoria","monto","origen_tipo","origen_id")
           VALUES ($1, $2, $3::"wallet_tienda_movimiento_tipo", $4::"wallet_tienda_movimiento_categoria", 1, 'abono_tienda', $5)`,
          randomUUID(),
          p.tiendaId,
          tipo,
          cat,
          randomUUID(),
        );
      return {
        bien: [
          await caja("ingreso", "ingreso_abono_tienda"),
          await caja("egreso", "egreso_reverso_abono_tienda"),
          await libro("credito", "abono_tienda"),
          await libro("debito", "abono_tienda_anulado"),
        ],
        invertidos: [
          await caja("egreso", "ingreso_abono_tienda"),
          await caja("ingreso", "egreso_reverso_abono_tienda"),
          await libro("debito", "abono_tienda"),
          await libro("credito", "abono_tienda_anulado"),
        ],
      };
    });
    expect(m.bien).toEqual([null, null, null, null]);
    expect(m.invertidos).toEqual(["23514", "23514", "23514", "23514"]);
  });

  it("(c) R76: las dos tablas con RLS, dos indices unicos en el documento, UNIQUE(abono_id), los CHECK y FK RESTRICT", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const rls = await tx.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
        `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname IN ('abono_tienda','abono_tienda_anulacion') ORDER BY 1`,
      );
      const unicos = await tx.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'abono_tienda'
           AND indexdef LIKE 'CREATE UNIQUE INDEX%' ORDER BY 1`,
      );
      const insertarAbono = (monto: string, motivo: string, path: string | null, ct: string | null, clave = randomUUID()) =>
        intentar(
          tx,
          `INSERT INTO "abono_tienda" ("id","clave_idempotencia","tienda_id","monto","metodo","motivo","fecha_pago","comprobante_path","comprobante_content_type","registrado_por")
           VALUES ($1, $2, $3, $4::numeric, 'SINPE'::"metodo_pago_value", $5, DATE '2026-09-20', $6, $7, $8)`,
          randomUUID(),
          clave,
          p.tiendaId,
          monto,
          motivo,
          path,
          ct,
          p.maestro.usuarioId,
        );
      const clave = randomUUID();
      const montoCero = await insertarAbono("0", "x", null, null);
      const motivoVacio = await insertarAbono("10.00", "   ", null, null);
      const comprobanteSinTipo = await insertarAbono("10.00", "x", "abonos-tienda/a.pdf", null);
      const primero = await insertarAbono("10.00", "x", null, null, clave);
      const claveRepetida = await insertarAbono("20.00", "y", null, null, clave);
      const abono = await tx.abonoTienda.findFirstOrThrow({ where: { claveIdempotencia: clave }, select: { id: true } });
      const insertarAnulacion = (motivo: string) =>
        intentar(
          tx,
          `INSERT INTO "abono_tienda_anulacion" ("id","abono_id","motivo","anulado_por") VALUES ($1, $2, $3, $4)`,
          randomUUID(),
          abono.id,
          motivo,
          p.maestro.usuarioId,
        );
      const anulacionVacia = await insertarAnulacion("");
      const primeraAnulacion = await insertarAnulacion("Cobro equivocado");
      const segundaAnulacion = await insertarAnulacion("Otra vez");
      const borrarAbono = await intentar(tx, `DELETE FROM "abono_tienda" WHERE "id" = $1`, abono.id);
      const borrarTienda = await intentar(tx, `DELETE FROM "usuario" WHERE "id" = $1`, p.tiendaId);
      const borrarRegistrador = await intentar(tx, `DELETE FROM "usuario" WHERE "id" = $1`, p.maestro.usuarioId);
      return {
        rls: rls.map((r) => [r.relname, r.relrowsecurity]),
        unicos: unicos.map((u) => u.indexname),
        montoCero,
        motivoVacio,
        comprobanteSinTipo,
        primero,
        claveRepetida,
        anulacionVacia,
        primeraAnulacion,
        segundaAnulacion,
        borrarAbono,
        borrarTienda,
        borrarRegistrador,
      };
    });
    expect(m.rls).toEqual([["abono_tienda", true], ["abono_tienda_anulacion", true]]);
    // SOLO DOS restricciones unicas: la premisa que el repositorio usa para leer un P2002 como choque de clave.
    expect(m.unicos).toEqual(["abono_tienda_clave_idempotencia_key", "abono_tienda_pkey"]);
    expect([m.montoCero, m.motivoVacio, m.comprobanteSinTipo]).toEqual(["23514", "23514", "23514"]);
    expect(m.primero).toBeNull();
    expect(m.claveRepetida).toBe("23505");
    expect(m.anulacionVacia).toBe("23514");
    expect(m.primeraAnulacion).toBeNull();
    expect(m.segundaAnulacion).toBe("23505");
    // `ON DELETE RESTRICT` es SQLSTATE 23001 (restrict_violation): ni el documento con anulacion, ni la tienda, ni quien registro se borran.
    expect(m.borrarAbono).toBe("23001");
    expect(m.borrarTienda).toBe("23001");
    expect(m.borrarRegistrador).toBe("23001");
  });

  it("(d) R75: el down de la migracion 2 ABORTA con UNA fila que use el pago o su anulacion, sin borrar nada; y devuelve los CHECK a las listas de la 461", async () => {
    const bloque = /DO \$\$[\s\S]*?\$\$;/.exec(DOWN_2);
    if (bloque === null) throw new Error("el down de la migracion 2 no trae su precondicion");
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const abono = await tx.abonoTienda.create({
        data: {
          claveIdempotencia: randomUUID(),
          tiendaId: p.tiendaId,
          monto: new Prisma.Decimal("1.00"),
          metodo: "efectivo",
          motivo: "x",
          fechaPago: new Date("2026-09-20T00:00:00.000Z"),
          registradoPor: p.maestro.usuarioId,
        },
        select: { id: true },
      });
      await tx.$executeRawUnsafe(`SAVEPOINT sp_down2`);
      let conDocumento = "NO FALLO";
      try {
        await tx.$executeRawUnsafe(bloque[0]);
      } catch (e) {
        conDocumento = String((e as Error).message);
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT sp_down2`);
      const sigue = await tx.abonoTienda.count({ where: { id: abono.id } });
      // Sin documento pero con UNA fila de caja del concepto: tambien aborta.
      await tx.abonoTienda.delete({ where: { id: abono.id } });
      await tx.walletMovimiento.create({
        data: { tipo: "ingreso", categoria: "ingreso_abono_tienda", monto: new Prisma.Decimal("1.00"), origenTipo: "abono_tienda", origenId: randomUUID(), registradoPor: p.maestro.usuarioId },
      });
      await tx.$executeRawUnsafe(`SAVEPOINT sp_down2b`);
      let conCaja = "NO FALLO";
      try {
        await tx.$executeRawUnsafe(bloque[0]);
      } catch (e) {
        conCaja = String((e as Error).message);
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT sp_down2b`);
      return { conDocumento, sigue, conCaja };
    });
    expect(m.conDocumento).toContain("rollback 457");
    expect(m.sigue).toBe(1);
    expect(m.conCaja).toContain("rollback 457");
    // El `up` de la 2 recrea los CHECK como AMPLIACION (los nombra), crea las dos tablas con su RLS…
    expect(UP_2).toMatch(/'ingreso_abono_tienda'\)\)/);
    expect(UP_2).toMatch(/'egreso_reverso_abono_tienda'\)\)/);
    expect(UP_2).toMatch(/'abono_tienda'\)\)/);
    expect(UP_2).toMatch(/'abono_tienda_anulado'\)\)/);
    expect(UP_2).toMatch(/ALTER TABLE "abono_tienda" ENABLE ROW LEVEL SECURITY/);
    expect(UP_2).toMatch(/ALTER TABLE "abono_tienda_anulacion" ENABLE ROW LEVEL SECURITY/);
    // …y su `down` devuelve los dos CHECK EXACTAMENTE a como los escribio la 461 (blancos normalizados).
    for (const nombre of ["wallet_movimiento_tipo_categoria_check", "wallet_tienda_movimiento_tipo_categoria_check"]) {
      expect(checkEscrito(DOWN_2, nombre)).toBe(checkEscrito(UP_461_2, nombre));
    }
    const down2 = soloEjecutable(DOWN_2);
    expect(down2).toMatch(/DROP TABLE "abono_tienda_anulacion";\s*\n\s*DROP TABLE "abono_tienda";/);
    expect(down2).not.toMatch(/DELETE FROM/);
  });

  it("(e) R75: el down dinamico es la funcion de la 461 byte a byte salvo el sufijo, quita los ocho valores de los cinco tipos y no recrea ningun tipo con lista fija", () => {
    const de457 = funcionDe(DOWN_1, "457");
    const de461 = funcionDe(DOWN_461, "461");
    expect(de457.replace(/_457/g, "_461").replace(/rollback 457/g, "rollback 461")).toBe(de461);
    expect(DOWN_1).not.toMatch(/CREATE TYPE "[a-z_]+" AS ENUM \(\s*'/);
    expect(DOWN_1.match(/SELECT pg_temp\.quitar_valores_de_enum_457\(/g)).toHaveLength(5);
    for (const [tipo, valores] of Object.entries(VALORES_457)) {
      const llamada = new RegExp(`quitar_valores_de_enum_457\\('public', '${tipo}', ARRAY\\[([\\s\\S]*?)\\]\\)`).exec(DOWN_1);
      expect(llamada, tipo).not.toBeNull();
      const listados = [...(llamada as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      expect(listados, tipo).toEqual([...valores]);
    }
  });

  it("(f) `TIPO_POR_CATEGORIA_TIENDA` coincide con el CHECK de la tienda LEIDO DEL MOTOR", async () => {
    const [check] = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'wallet_tienda_movimiento_tipo_categoria_check'`;
    expect(check).toBeDefined();
    const rama = (tipo: "credito" | "debito"): string[] => {
      const m = new RegExp(`tipo = '${tipo}'::wallet_tienda_movimiento_tipo\\) AND \\(categoria = ANY \\(ARRAY\\[([^\\]]*)\\]`).exec(check.def);
      if (m === null) throw new Error(`sin rama ${tipo}`);
      return [...m[1].matchAll(/'([^']+)'::wallet_tienda_movimiento_categoria/g)].map((x) => x[1]).sort();
    };
    const esperado = (tipo: "credito" | "debito") =>
      (Object.keys(TIPO_POR_CATEGORIA_TIENDA) as (keyof typeof TIPO_POR_CATEGORIA_TIENDA)[])
        .filter((c) => TIPO_POR_CATEGORIA_TIENDA[c] === tipo)
        .sort();
    expect(rama("credito")).toEqual(esperado("credito"));
    expect(rama("debito")).toEqual(esperado("debito"));
    expect(rama("credito")).toContain("abono_tienda");
    expect(rama("debito")).toContain("abono_tienda_anulado");
    expect(rama("credito")).toHaveLength(5);
    expect(rama("debito")).toHaveLength(11);
  });
});
