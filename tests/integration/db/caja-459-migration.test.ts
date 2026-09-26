import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { WALLET_MOVIMIENTO_CATEGORIA_SEED, WALLET_ORIGEN_TIPO_SEED } from "@/lib/types/wallet";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";
import { HISTORIAL_ACCION_ENTIDADES, HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  etiquetasDeEnum,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 459 / T B.5 — LAS TRES MIGRACIONES DE LA 459, CONTRA POSTGRES (R98, R99).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
//  (a) los catalogos de `public` son EXACTAMENTE los seeds, con los valores nuevos AL FINAL;
//  (b) los dos CHECK tipo<->categoria admiten los pares nuevos y RECHAZAN los invertidos (23514);
//  (c) RLS activa en las cuatro tablas; cada documento con SOLO dos indices unicos (PK y clave);
//  (d) el `down` DINAMICO (P12): en un esquema temporal con una COPIA del tipo —y un valor ajeno
//      añadido DESPUES, como los de SF-001—, quita SOLO los valores de la 459, conserva el ajeno y
//      el orden, y restaura CHECK, indices y DEFAULT; con UNA fila que use un valor de la 459,
//      ABORTA sin tocar nada;
//  (e) el `down` de la migracion 3, con una fila de pago por cuenta, ABORTA sin borrar nada;
//  (f) los dos `down` dinamicos (enums de caja y historial) llevan la MISMA funcion, byte a byte.
//
// Todo en transacciones que SIEMPRE se revierten.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MIGRACIONES = path.join(process.cwd(), "db", "migrations");
const DOWN_ENUMS = fs.readFileSync(path.join(MIGRACIONES, "20260925120000_caja_459_enums", "down.sql"), "utf8");
const DOWN_HISTORIAL = fs.readFileSync(path.join(MIGRACIONES, "20260925120100_historial_accion_459", "down.sql"), "utf8");
const DOWN_TABLAS = fs.readFileSync(path.join(MIGRACIONES, "20260925120200_pago_por_cuenta_y_capital", "down.sql"), "utf8");

/** La funcion de reversion, tal cual esta en el `down.sql` (una sola sentencia). */
function funcionDe(down: string): string {
  const m = /CREATE OR REPLACE FUNCTION pg_temp\.quitar_valores_de_enum_459[\s\S]*?\$fn\$;/.exec(down);
  if (m === null) throw new Error("el down.sql no trae la funcion de reversion");
  return m[0];
}

const VALORES_CAJA_459 = [
  "egreso_pago_por_cuenta_tienda",
  "ingreso_reverso_pago_por_cuenta_tienda",
  "ingreso_aporte_capital",
  "egreso_reverso_aporte_capital",
];

describeSiHayBase("459/B.5 — las migraciones de la 459 contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("(a) los catalogos de `public` son EXACTAMENTE los seeds, con los valores de la 459 al final", async () => {
    const caja = await etiquetasDeEnum(prisma, "wallet_movimiento_categoria");
    const tienda = await etiquetasDeEnum(prisma, "wallet_tienda_movimiento_categoria");
    const origen = await etiquetasDeEnum(prisma, "wallet_origen_tipo");
    expect([...caja].sort()).toEqual([...WALLET_MOVIMIENTO_CATEGORIA_SEED].sort());
    expect([...tienda].sort()).toEqual([...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED].sort());
    expect([...origen].sort()).toEqual([...WALLET_ORIGEN_TIPO_SEED].sort());
    // Ficha 461 (2026-09-25): sus valores van DESPUES de los de la 459 (`20260926120000`), asi que los
    // de la 459 ya no cierran la lista: se leen justo antes de los de la 461. El orden relativo —los
    // de esta ficha, contiguos y al final de lo que habia antes— es lo que se afirma.
    // Ficha 457 (2026-09-25): sus valores van DESPUES de los de la 461 (`20260927120000`): dos en la
    // caja, dos en la tienda, uno en el origen. El orden relativo se afirma igual, un tramo mas atras.
    expect(caja.slice(-8, -4)).toEqual(VALORES_CAJA_459);
    expect(caja.slice(-4, -2)).toEqual(["ingreso_cobro_tienda", "egreso_reverso_cobro_tienda"]);
    expect(caja.slice(-2)).toEqual(["ingreso_abono_tienda", "egreso_reverso_abono_tienda"]);
    expect(tienda.slice(-5, -3)).toEqual(["pago_por_cuenta", "pago_por_cuenta_anulado"]);
    expect(tienda.slice(-3, -2)).toEqual(["cobro_tienda_anulado"]);
    expect(tienda.slice(-2)).toEqual(["abono_tienda", "abono_tienda_anulado"]);
    expect(origen.slice(-6, -3)).toEqual(["pago_por_cuenta_tienda", "aporte_capital", "cobro_manual_reclasificado"]);
    expect(origen.slice(-3, -1)).toEqual(["cobro_tienda", "cobro_tienda_completado"]);
    expect(origen.slice(-1)).toEqual(["abono_tienda"]);

    const tipos = await etiquetasDeEnum(prisma, "historial_accion_tipo");
    const entidades = await etiquetasDeEnum(prisma, "historial_accion_entidad");
    expect([...tipos].sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    expect([...entidades].sort()).toEqual([...HISTORIAL_ACCION_ENTIDADES].sort());
    // Ficha 461: DOS tipos detras de los de la 459 (`cobro_tienda_anulado` y, con la auditoria D3,
    // `wallet_movimiento_manual_anulado`).
    // Ficha 457: DOS tipos y UNA entidad detras de los de la 461.
    expect(tipos.slice(-8, -4)).toEqual([
      "pago_por_cuenta_tienda_registrado",
      "pago_por_cuenta_tienda_anulado",
      "aporte_capital_registrado",
      "aporte_capital_anulado",
    ]);
    expect(tipos.slice(-4, -2)).toEqual(["cobro_tienda_anulado", "wallet_movimiento_manual_anulado"]);
    expect(tipos.slice(-2)).toEqual(["abono_tienda_registrado", "abono_tienda_anulado"]);
    expect(entidades.slice(-3, -1)).toEqual(["pago_por_cuenta_tienda", "aporte_capital"]);
    expect(entidades.slice(-1)).toEqual(["abono_tienda"]);
  });

  it("(b) los CHECK admiten los pares nuevos y RECHAZAN los invertidos", async () => {
    const aceptados = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tienda = await crearTienda(tx);
      const intentar = async (sql: string, ...args: unknown[]): Promise<boolean> => {
        const punto = `sp_${randomUUID().replace(/-/g, "")}`;
        await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
        try {
          await tx.$executeRawUnsafe(sql, ...args);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
          return true;
        } catch {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
          return false;
        }
      };
      const caja = (tipo: string, cat: string) =>
        intentar(
          `INSERT INTO "wallet_movimiento" ("id","tipo","categoria","monto","origen_tipo","origen_id")
           VALUES ($1, $2::"wallet_movimiento_tipo", $3::"wallet_movimiento_categoria", 1, 'manual', NULL)`,
          randomUUID(),
          tipo,
          cat,
        );
      const libro = (tipo: string, cat: string) =>
        intentar(
          `INSERT INTO "wallet_tienda_movimiento" ("id","tienda_id","tipo","categoria","monto","origen_tipo","origen_id")
           VALUES ($1, $2, $3::"wallet_tienda_movimiento_tipo", $4::"wallet_tienda_movimiento_categoria", 1, 'manual', NULL)`,
          randomUUID(),
          tienda,
          tipo,
          cat,
        );
      return {
        cajaBien: [
          await caja("egreso", "egreso_pago_por_cuenta_tienda"),
          await caja("ingreso", "ingreso_reverso_pago_por_cuenta_tienda"),
          await caja("ingreso", "ingreso_aporte_capital"),
          await caja("egreso", "egreso_reverso_aporte_capital"),
        ],
        cajaInvertidos: [
          await caja("ingreso", "egreso_pago_por_cuenta_tienda"),
          await caja("egreso", "ingreso_reverso_pago_por_cuenta_tienda"),
          await caja("egreso", "ingreso_aporte_capital"),
          await caja("ingreso", "egreso_reverso_aporte_capital"),
        ],
        tiendaBien: [await libro("debito", "pago_por_cuenta"), await libro("credito", "pago_por_cuenta_anulado")],
        tiendaInvertidos: [await libro("credito", "pago_por_cuenta"), await libro("debito", "pago_por_cuenta_anulado")],
      };
    });
    expect(aceptados).toEqual({
      cajaBien: [true, true, true, true],
      cajaInvertidos: [false, false, false, false],
      tiendaBien: [true, true],
      tiendaInvertidos: [false, false],
    });
  });

  it("(c) R99: RLS activa en las cuatro tablas; cada documento con SOLO dos indices unicos", async () => {
    const rls = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN
          ('pago_por_cuenta_tienda','pago_por_cuenta_tienda_anulacion','aporte_capital','aporte_capital_anulacion')
        ORDER BY 1`,
    );
    expect(rls).toEqual([
      { relname: "aporte_capital", relrowsecurity: true },
      { relname: "aporte_capital_anulacion", relrowsecurity: true },
      { relname: "pago_por_cuenta_tienda", relrowsecurity: true },
      { relname: "pago_por_cuenta_tienda_anulacion", relrowsecurity: true },
    ]);
    const unicos = await prisma.$queryRawUnsafe<{ tabla: string; n: bigint }[]>(
      `SELECT c.relname AS tabla, count(*) AS n FROM pg_index ix JOIN pg_class c ON c.oid = ix.indrelid
         JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public' AND ix.indisunique
          AND c.relname IN ('pago_por_cuenta_tienda','aporte_capital') GROUP BY 1 ORDER BY 1`,
    );
    // Premisa del repositorio (P2002 sin pista = choque de la clave): PK + clave, y ni una mas.
    expect(unicos.map((u) => [u.tabla, Number(u.n)])).toEqual([
      ["aporte_capital", 2],
      ["pago_por_cuenta_tienda", 2],
    ]);
  });

  it("(d) P12/R98: el down dinamico quita SOLO los valores de la 459, conserva el ajeno y restaura todo", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const esquema = `t459_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const vigentes = await etiquetasDeEnum(tx, "wallet_movimiento_categoria");
      // La COPIA: los valores de hoy MAS uno ajeno añadido despues (como SF-001 en `dev`).
      const conAjeno = [...vigentes, "valor_ajeno_posterior"];
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
      await tx.$executeRawUnsafe(
        `CREATE TYPE "${esquema}"."wallet_movimiento_categoria" AS ENUM (${conAjeno.map((v) => `'${v}'`).join(", ")})`,
      );
      await tx.$executeRawUnsafe(
        `CREATE TABLE "${esquema}"."libro" (
           "id" text PRIMARY KEY,
           "tipo" text NOT NULL,
           "categoria" "${esquema}"."wallet_movimiento_categoria" NOT NULL DEFAULT 'ingreso_ajuste',
           CONSTRAINT "libro_check" CHECK ("categoria" NOT IN ('egreso_sueldo','valor_ajeno_posterior') OR "tipo" = 'egreso')
         )`,
      );
      await tx.$executeRawUnsafe(
        `CREATE INDEX "libro_parcial" ON "${esquema}"."libro" ("tipo") WHERE "categoria" <> 'egreso_sueldo'`,
      );
      await tx.$executeRawUnsafe(`CREATE INDEX "libro_col" ON "${esquema}"."libro" ("categoria", "tipo")`);
      await tx.$executeRawUnsafe(`INSERT INTO "${esquema}"."libro" ("id","tipo") VALUES ('f1','ingreso')`);
      const antes = await fotoDelEsquema(tx, esquema);

      await tx.$executeRawUnsafe(funcionDe(DOWN_ENUMS));

      // Con UNA fila que usa un valor de la 459: ABORTA y no toca nada.
      await tx.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."libro" ("id","tipo","categoria") VALUES ('f2','ingreso','ingreso_aporte_capital')`,
      );
      await tx.$executeRawUnsafe(`SAVEPOINT sp_abortar`);
      let error = "NO FALLO";
      try {
        await tx.$executeRawUnsafe(
          `SELECT pg_temp.quitar_valores_de_enum_459($1, 'wallet_movimiento_categoria', $2::text[])`,
          esquema,
          VALORES_CAJA_459,
        );
      } catch (e) {
        error = String((e as Error).message);
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT sp_abortar`);
      const trasAbortar = await etiquetasDelEsquema(tx, esquema);
      const filasTrasAbortar = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "${esquema}"."libro"`,
      );

      // Sin filas de la 459: quita SOLO sus valores.
      await tx.$executeRawUnsafe(`DELETE FROM "${esquema}"."libro" WHERE "id" = 'f2'`);
      await tx.$executeRawUnsafe(
        `SELECT pg_temp.quitar_valores_de_enum_459($1, 'wallet_movimiento_categoria', $2::text[])`,
        esquema,
        VALORES_CAJA_459,
      );
      const despues = await fotoDelEsquema(tx, esquema);
      // Idempotente: una segunda pasada no hace nada.
      await tx.$executeRawUnsafe(
        `SELECT pg_temp.quitar_valores_de_enum_459($1, 'wallet_movimiento_categoria', $2::text[])`,
        esquema,
        VALORES_CAJA_459,
      );
      const otraVez = await fotoDelEsquema(tx, esquema);
      return { conAjeno, antes, error, trasAbortar, filasTrasAbortar: Number(filasTrasAbortar[0].n), despues, otraVez };
    });

    // Anti-vacuidad: la copia SI tenia los valores de la 459.
    for (const v of VALORES_CAJA_459) expect(medido.antes.etiquetas).toContain(v);
    expect(medido.error).toContain("rollback 459");
    expect(medido.trasAbortar).toEqual(medido.conAjeno);
    expect(medido.filasTrasAbortar).toBe(2);
    expect(medido.despues.etiquetas).toEqual(medido.conAjeno.filter((v) => !VALORES_CAJA_459.includes(v)));
    expect(medido.despues.etiquetas.at(-1)).toBe("valor_ajeno_posterior");
    // CHECK, indices y DEFAULT: los MISMOS, con su definicion exacta.
    expect(medido.despues.check).toEqual(medido.antes.check);
    expect(medido.despues.indices).toEqual(medido.antes.indices);
    expect(medido.despues.defecto).toEqual(medido.antes.defecto);
    expect(medido.despues.filas).toEqual(["f1"]);
    expect(medido.otraVez).toEqual(medido.despues);
  });

  it("(e) R98: el down de la migracion 3, con una fila de pago por cuenta, ABORTA sin borrar nada", async () => {
    const bloque = /DO \$\$[\s\S]*?\$\$;/.exec(DOWN_TABLAS);
    if (bloque === null) throw new Error("el down de la migracion 3 no trae su precondicion");
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tienda = await crearTienda(tx);
      const pagoId = randomUUID();
      await tx.pagoPorCuentaTienda.create({
        data: {
          id: pagoId,
          claveIdempotencia: randomUUID(),
          tiendaId: tienda,
          beneficiario: "Facebook",
          monto: new Prisma.Decimal("10.00"),
          metodo: "efectivo",
          motivo: "prueba",
          fechaPago: new Date("2026-09-24T00:00:00.000Z"),
          registradoPor: tienda,
        },
      });
      await tx.$executeRawUnsafe(`SAVEPOINT sp_down3`);
      let error = "NO FALLO";
      try {
        await tx.$executeRawUnsafe(bloque[0]);
      } catch (e) {
        error = String((e as Error).message);
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT sp_down3`);
      const sigue = await tx.pagoPorCuentaTienda.count({ where: { id: pagoId } });
      return { error, sigue };
    });
    expect(medido.error).toContain("rollback 459");
    expect(medido.sigue).toBe(1);
  });

  it("(f) los dos down dinamicos llevan la MISMA funcion, byte a byte", () => {
    expect(funcionDe(DOWN_HISTORIAL)).toBe(funcionDe(DOWN_ENUMS));
    // Y ninguno recrea un tipo con una lista escrita a mano.
    for (const down of [DOWN_ENUMS, DOWN_HISTORIAL]) {
      expect(down).not.toMatch(/CREATE TYPE "[a-z_]+" AS ENUM \(\s*'/);
    }
  });
});

async function crearTienda(tx: TxDeTest): Promise<string> {
  const rol = await tx.rol.findUnique({ where: { value: "adminTienda" }, select: { id: true } });
  const tipo = await tx.tipoIdentificacion.findUnique({ where: { value: "cedula" }, select: { id: true } });
  if (rol === null || tipo === null) throw new Error("faltan `rol.adminTienda` o `cedula`: corre `pnpm run db:seed`.");
  const clave = randomUUID().slice(0, 8);
  const u = await tx.usuario.create({
    data: {
      nombre: `Tienda 459 mig ${clave}`,
      email: `t459mig-${clave}@example.test`,
      telefono: "88880000",
      passwordHash: "x",
      cedula: `459-MIG-${clave}`,
      tipoIdentificacionId: tipo.id,
      rolId: rol.id,
    },
    select: { id: true },
  });
  return u.id;
}

async function etiquetasDelEsquema(tx: TxDeTest, esquema: string): Promise<string[]> {
  const filas = await tx.$queryRawUnsafe<{ e: string }[]>(
    `SELECT e.enumlabel AS e FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = 'wallet_movimiento_categoria' AND n.nspname = $1 ORDER BY e.enumsortorder`,
    esquema,
  );
  return filas.map((f) => f.e);
}

async function fotoDelEsquema(tx: TxDeTest, esquema: string) {
  const check = await tx.$queryRawUnsafe<{ d: string }[]>(
    `SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1 AND c.conname = 'libro_check'`,
    esquema,
  );
  const indices = await tx.$queryRawUnsafe<{ d: string }[]>(
    `SELECT indexdef AS d FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
    esquema,
  );
  const defecto = await tx.$queryRawUnsafe<{ d: string | null }[]>(
    `SELECT pg_get_expr(d.adbin, d.adrelid) AS d FROM pg_attrdef d
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = 'libro' AND a.attname = 'categoria'`,
    esquema,
  );
  const filas = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${esquema}"."libro" ORDER BY "id"`);
  return {
    etiquetas: await etiquetasDelEsquema(tx, esquema),
    check: check.map((c) => c.d),
    indices: indices.map((i) => i.d),
    defecto: defecto.map((d) => d.d),
    filas: filas.map((f) => f.id),
  };
}
