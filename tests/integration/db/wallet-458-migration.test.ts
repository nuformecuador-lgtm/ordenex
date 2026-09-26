import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { HISTORIAL_ACCION_ENTIDADES, HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED, WALLET_ORIGEN_TIPO_SEED } from "@/lib/types/wallet";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";
import { WALLET_COMPROBANTE_MIME } from "@/lib/config/wallet-comprobante";
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
import { cargarCatalogo459, enTransaccionRevertida459, sembrarEscenario459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 458-B / TB.2–TB.3 — LAS DOS MIGRACIONES DE LA WALLET, contra Postgres (R89, R92).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
//  (a) los cinco catalogos son EXACTAMENTE los seeds, con los seis valores de la 458 AL FINAL; el `up`
//      de la 1 son SEIS `ADD VALUE IF NOT EXISTS` y nada mas;
//  (b) los dos CHECK tipo<->categoria ADMITEN los cuatro pares nuevos y RECHAZAN los invertidos (23514);
//  (c) R92: las tres tablas laterales con RLS; `wallet_anotacion` (1:1, sin blancos, no vacia),
//      `wallet_comprobante` (UN destino, un UNIQUE por destino = R79, tipos de la 459) y
//      `rechazo_tienda_cobro_anulacion` (UNIQUE(cobro_id), motivo no vacio); FK RESTRICT (23001);
//  (d) R92: el `down` de la 2 ABORTA con UNA fila de sus tablas o de sus categorias, sin borrar nada; y
//      sus CHECK vuelven, byte a byte (normalizados), a las listas de la 457;
//  (e) R92: el `down` dinamico es la funcion de la 461 byte a byte salvo el sufijo, y quita EXACTAMENTE
//      los seis valores de los tres tipos, sin recrear ningun tipo con una lista escrita a mano;
//  (f) `TIPO_POR_CATEGORIA_TIENDA` coincide con el CHECK de la tienda LEIDO DEL MOTOR;
//  (g) R89: ninguna de las dos migraciones toca filas (ni UPDATE, ni DELETE, ni INSERT).
//
// El ciclo real up → down → up sobre el clon (y el down con una fila que falla sin borrar) esta anotado
// en `progress/impl_458-B.md` (TB.2/TB.3): ejecutarlo aqui tomaria un candado exclusivo sobre los dos
// libros en una base compartida con el resto de la suite.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MIGRACIONES = path.join(process.cwd(), "db", "migrations");
const leer = (dir: string, archivo: string) =>
  fs.readFileSync(path.join(MIGRACIONES, dir, archivo), "utf8").replace(/\r\n/g, "\n");
const UP_1 = leer("20260928120000_wallet_458_enums", "migration.sql");
const DOWN_1 = leer("20260928120000_wallet_458_enums", "down.sql");
const UP_2 = leer("20260928120100_wallet_458_tablas", "migration.sql");
const DOWN_2 = leer("20260928120100_wallet_458_tablas", "down.sql");
const DOWN_461 = leer("20260926120000_cobro_tienda_461_enums", "down.sql");
const UP_457_2 = leer("20260927120100_abono_tienda_457_tablas_y_checks", "migration.sql");

function funcionDe(down: string, sufijo: "461" | "458"): string {
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

const VALORES_458 = {
  wallet_movimiento_categoria: ["egreso_reverso_flete_devolucion", "egreso_reverso_iva_flete_devolucion"],
  wallet_tienda_movimiento_categoria: ["flete_devolucion_anulado", "iva_flete_devolucion_anulado"],
  historial_accion_tipo: ["cobro_rechazo_tienda_anulado", "egreso_caja_anulado"],
} as const;

describeSiHayBase("458-B/TB.2–TB.3 — las migraciones de la wallet contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("(a) los catalogos son EXACTAMENTE los seeds, con los seis valores de la 458 AL FINAL, valor a valor", async () => {
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
    expect(caja.slice(-2)).toEqual([...VALORES_458.wallet_movimiento_categoria]);
    expect(tienda.slice(-2)).toEqual([...VALORES_458.wallet_tienda_movimiento_categoria]);
    expect(tipos.slice(-2)).toEqual([...VALORES_458.historial_accion_tipo]);
    // Antes (457): 25 / 16 / 14 / 63 / 24. Despues (458-B): 27 / 18 / 14 / 65 / 24.
    expect([caja.length, tienda.length, origen.length, tipos.length, entidades.length]).toEqual([27, 18, 14, 65, 24]);
    const up1 = soloEjecutable(UP_1);
    expect(up1.match(/ADD VALUE IF NOT EXISTS/g)).toHaveLength(6);
    expect(up1).not.toMatch(/CHECK|CREATE TABLE|UPDATE|DELETE|INSERT/);
    for (const [tipo, valores] of Object.entries(VALORES_458)) {
      for (const v of valores) expect(up1).toContain(`ALTER TYPE "${tipo}" ADD VALUE IF NOT EXISTS '${v}';`);
    }
  });

  it("(b) los CHECK admiten los cuatro pares de la 458 y RECHAZAN los invertidos (23514)", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const caja = (tipo: string, cat: string) =>
        intentar(
          tx,
          `INSERT INTO "wallet_movimiento" ("id","tipo","categoria","monto","origen_tipo","origen_id")
           VALUES ($1, $2::"wallet_movimiento_tipo", $3::"wallet_movimiento_categoria", 1, 'gestion_orden', $4)`,
          randomUUID(),
          tipo,
          cat,
          randomUUID(),
        );
      const libro = (tipo: string, cat: string) =>
        intentar(
          tx,
          `INSERT INTO "wallet_tienda_movimiento" ("id","tienda_id","tipo","categoria","monto","origen_tipo","origen_id")
           VALUES ($1, $2, $3::"wallet_tienda_movimiento_tipo", $4::"wallet_tienda_movimiento_categoria", 1, 'gestion_orden', $5)`,
          randomUUID(),
          p.tiendaId,
          tipo,
          cat,
          randomUUID(),
        );
      return {
        bien: [
          await caja("egreso", "egreso_reverso_flete_devolucion"),
          await caja("egreso", "egreso_reverso_iva_flete_devolucion"),
          await libro("credito", "flete_devolucion_anulado"),
          await libro("credito", "iva_flete_devolucion_anulado"),
        ],
        invertidos: [
          await caja("ingreso", "egreso_reverso_flete_devolucion"),
          await caja("ingreso", "egreso_reverso_iva_flete_devolucion"),
          await libro("debito", "flete_devolucion_anulado"),
          await libro("debito", "iva_flete_devolucion_anulado"),
        ],
      };
    });
    expect(m.bien).toEqual([null, null, null, null]);
    expect(m.invertidos).toEqual(["23514", "23514", "23514", "23514"]);
  });

  it("(c) R92/R79: las tres tablas con RLS; anotacion 1:1 y sin blancos; comprobante con UN destino y uno por destino; FK RESTRICT", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const rls = await tx.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
        `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname IN ('wallet_anotacion','wallet_comprobante','rechazo_tienda_cobro_anulacion') ORDER BY 1`,
      );
      const mov = await tx.walletMovimiento.create({
        data: { tipo: "egreso", categoria: "egreso_sueldo", monto: new Prisma.Decimal("10.00"), origenTipo: "gasto", registradoPor: p.maestro.usuarioId },
        select: { id: true },
      });
      const mov2 = await tx.walletMovimiento.create({
        data: { tipo: "egreso", categoria: "egreso_gasto_variable", monto: new Prisma.Decimal("10.00"), origenTipo: "gasto", registradoPor: p.maestro.usuarioId },
        select: { id: true },
      });
      const cobro = await tx.walletTiendaMovimiento.create({
        data: { tiendaId: p.tiendaId, tipo: "debito", categoria: "cobro_manual", monto: new Prisma.Decimal("5.00"), origenTipo: "manual", registradoPor: p.maestro.usuarioId },
        select: { id: true },
      });
      const anotar = (movimientoId: string, nombre: string | null, referencia: string | null) =>
        intentar(
          tx,
          `INSERT INTO "wallet_anotacion" ("id","movimiento_id","contraparte_nombre","referencia") VALUES ($1, $2, $3, $4)`,
          randomUUID(),
          movimientoId,
          nombre,
          referencia,
        );
      const anotacionEnBlanco = await anotar(mov.id, "   ", null);
      const anotacionVacia = await anotar(mov.id, null, null);
      const referenciaEnBlanco = await anotar(mov.id, "Ana", " ");
      const anotacion = await anotar(mov.id, "Ana Pérez", null);
      const segundaAnotacion = await anotar(mov.id, "Otra", null);
      const comprobar = (caja: string | null, tienda: string | null, pago: string | null, contentType: string) =>
        intentar(
          tx,
          `INSERT INTO "wallet_comprobante" ("id","caja_movimiento_id","tienda_movimiento_id","liquidacion_pago_id","storage_path","content_type","subido_por")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          randomUUID(),
          caja,
          tienda,
          pago,
          `movimientos-caja/${randomUUID()}.pdf`,
          contentType,
          p.maestro.usuarioId,
        );
      const sinDestino = await comprobar(null, null, null, "application/pdf");
      const dosDestinos = await comprobar(mov2.id, cobro.id, null, "application/pdf");
      const tipoAjeno = await comprobar(mov2.id, null, null, "text/html");
      const primero = await comprobar(mov2.id, null, null, "application/pdf");
      const segundo = await comprobar(mov2.id, null, null, "image/png");
      const deLaTienda = await comprobar(null, cobro.id, null, "image/jpeg");
      const borrarMovAnotado = await intentar(tx, `DELETE FROM "wallet_movimiento" WHERE "id" = $1`, mov.id);
      const borrarMovConComprobante = await intentar(tx, `DELETE FROM "wallet_movimiento" WHERE "id" = $1`, mov2.id);
      const borrarSubidor = await intentar(tx, `DELETE FROM "usuario" WHERE "id" = $1`, p.maestro.usuarioId);
      const unicosComprobante = await tx.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'wallet_comprobante'
           AND indexdef LIKE 'CREATE UNIQUE INDEX%' ORDER BY 1`,
      );
      return {
        rls: rls.map((r) => [r.relname, r.relrowsecurity]),
        anotacionEnBlanco,
        anotacionVacia,
        referenciaEnBlanco,
        anotacion,
        segundaAnotacion,
        sinDestino,
        dosDestinos,
        tipoAjeno,
        primero,
        segundo,
        deLaTienda,
        borrarMovAnotado,
        borrarMovConComprobante,
        borrarSubidor,
        unicosComprobante: unicosComprobante.map((u) => u.indexname),
      };
    });
    expect(m.rls).toEqual([
      ["rechazo_tienda_cobro_anulacion", true],
      ["wallet_anotacion", true],
      ["wallet_comprobante", true],
    ]);
    expect([m.anotacionEnBlanco, m.anotacionVacia, m.referenciaEnBlanco]).toEqual(["23514", "23514", "23514"]);
    expect(m.anotacion).toBeNull();
    expect(m.segundaAnotacion).toBe("23505"); // 1:1
    expect([m.sinDestino, m.dosDestinos, m.tipoAjeno]).toEqual(["23514", "23514", "23514"]);
    expect(m.primero).toBeNull();
    expect(m.segundo).toBe("23505"); // R79: ni se reemplaza ni se suma otro
    expect(m.deLaTienda).toBeNull();
    expect([m.borrarMovAnotado, m.borrarMovConComprobante, m.borrarSubidor]).toEqual(["23001", "23001", "23001"]);
    expect(m.unicosComprobante).toEqual([
      "wallet_comprobante_caja_movimiento_id_key",
      "wallet_comprobante_liquidacion_pago_id_key",
      "wallet_comprobante_pkey",
      "wallet_comprobante_tienda_movimiento_id_key",
    ]);
    // La lista del CHECK de tipos es la de la 459 (la misma config que valida el borde).
    expect(checkEscrito(UP_2, "wallet_comprobante_content_type_check")).toBe(
      `"content_type" IN (${WALLET_COMPROBANTE_MIME.map((x) => `'${x}'`).join(", ")})`,
    );
  });

  it("(c) R92/R66: `rechazo_tienda_cobro_anulacion` — UNA por cobro, motivo no vacio, RESTRICT sobre el cobro y quien anulo", async () => {
    const cat = await cargarCatalogo459(prisma);
    const m = await enTransaccionRevertida459(prisma, async (tx) => {
      const esc = await sembrarEscenario459(tx, cat);
      const cobro = await tx.rechazoTiendaCobro.findFirstOrThrow({
        where: { tiendaId: esc.tiendaA, estado: "aprobado" },
        select: { id: true },
      });
      const anular = (motivo: string) =>
        intentar(
          tx,
          `INSERT INTO "rechazo_tienda_cobro_anulacion" ("id","cobro_id","motivo","anulado_por") VALUES ($1, $2, $3, $4)`,
          randomUUID(),
          cobro.id,
          motivo,
          esc.maestro.usuarioId,
        );
      const vacia = await anular("  ");
      const primera = await anular("Se cobró por error");
      const segunda = await anular("Otra vez");
      const borrarCobro = await intentar(tx, `DELETE FROM "rechazo_tienda_cobro" WHERE "id" = $1`, cobro.id);
      const borrarAnulador = await intentar(tx, `DELETE FROM "usuario" WHERE "id" = $1`, esc.maestro.usuarioId);
      const estado = await tx.rechazoTiendaCobro.findUniqueOrThrow({ where: { id: cobro.id }, select: { estado: true } });
      return { vacia, primera, segunda, borrarCobro, borrarAnulador, estado: estado.estado };
    });
    expect(m.vacia).toBe("23514");
    expect(m.primera).toBeNull();
    expect(m.segunda).toBe("23505");
    expect([m.borrarCobro, m.borrarAnulador]).toEqual(["23001", "23001"]);
    // R73: la constancia no toca el cobro; su estado sigue `aprobado`.
    expect(m.estado).toBe("aprobado");
  }, 300_000);

  it("(d) R92: el down de la migracion 2 ABORTA con UNA fila de sus tablas o de sus categorias, sin borrar nada; y devuelve los CHECK a las listas de la 457", async () => {
    const bloque = /DO \$\$[\s\S]*?\$\$;/.exec(DOWN_2);
    if (bloque === null) throw new Error("el down de la migracion 2 no trae su precondicion");
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const intentarDown = async (): Promise<string> => {
        const punto = `sp_${randomUUID().replace(/-/g, "")}`;
        await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
        let r = "NO FALLO";
        try {
          await tx.$executeRawUnsafe(bloque[0]);
        } catch (e) {
          r = String((e as Error).message);
        }
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
        return r;
      };
      const mov = await tx.walletMovimiento.create({
        data: { tipo: "egreso", categoria: "egreso_sueldo", monto: new Prisma.Decimal("1.00"), origenTipo: "gasto", registradoPor: p.maestro.usuarioId },
        select: { id: true },
      });
      // 1) una anotacion
      const anotacion = await tx.walletAnotacion.create({ data: { movimientoId: mov.id, contraparteNombre: "Ana" }, select: { id: true } });
      const conAnotacion = await intentarDown();
      const sigueAnotacion = await tx.walletAnotacion.count({ where: { id: anotacion.id } });
      await tx.walletAnotacion.delete({ where: { id: anotacion.id } });
      // 2) un comprobante
      const comp = await tx.walletComprobante.create({
        data: { cajaMovimientoId: mov.id, storagePath: "movimientos-caja/x.pdf", contentType: "application/pdf", subidoPor: p.maestro.usuarioId },
        select: { id: true },
      });
      const conComprobante = await intentarDown();
      const sigueComprobante = await tx.walletComprobante.count({ where: { id: comp.id } });
      await tx.walletComprobante.delete({ where: { id: comp.id } });
      // 3) una fila de caja con una categoria de la ficha
      await tx.walletMovimiento.create({
        data: { tipo: "egreso", categoria: "egreso_reverso_flete_devolucion", monto: new Prisma.Decimal("1.00"), origenTipo: "gestion_orden", origenId: randomUUID() },
      });
      const conCaja = await intentarDown();
      return { conAnotacion, sigueAnotacion, conComprobante, sigueComprobante, conCaja };
    });
    expect(m.conAnotacion).toContain("rollback 458");
    expect(m.sigueAnotacion).toBe(1);
    expect(m.conComprobante).toContain("rollback 458");
    expect(m.sigueComprobante).toBe(1);
    expect(m.conCaja).toContain("rollback 458");
    // El `up` de la 2 recrea los CHECK como AMPLIACION y crea las tres tablas con su RLS…
    expect(UP_2).toMatch(/'egreso_reverso_flete_devolucion','egreso_reverso_iva_flete_devolucion'\)\)/);
    expect(UP_2).toMatch(/'flete_devolucion_anulado','iva_flete_devolucion_anulado'\)\)/);
    for (const t of ["wallet_anotacion", "rechazo_tienda_cobro_anulacion", "wallet_comprobante"]) {
      expect(UP_2).toContain(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`);
    }
    // …y su `down` devuelve los dos CHECK EXACTAMENTE a como los escribio la 457 (blancos normalizados).
    for (const nombre of ["wallet_movimiento_tipo_categoria_check", "wallet_tienda_movimiento_tipo_categoria_check"]) {
      expect(checkEscrito(DOWN_2, nombre)).toBe(checkEscrito(UP_457_2, nombre));
    }
    const down2 = soloEjecutable(DOWN_2);
    expect(down2).toMatch(/DROP TABLE "wallet_comprobante";\s*\n\s*DROP TABLE "rechazo_tienda_cobro_anulacion";\s*\n\s*DROP TABLE "wallet_anotacion";/);
    expect(down2).not.toMatch(/DELETE FROM|ajuste_caja_anulacion/);
  });

  it("(e) R92: el down dinamico es la funcion de la 461 byte a byte salvo el sufijo, y quita los seis valores de los tres tipos", () => {
    const de458 = funcionDe(DOWN_1, "458");
    const de461 = funcionDe(DOWN_461, "461");
    expect(de458.replace(/_458/g, "_461").replace(/rollback 458/g, "rollback 461")).toBe(de461);
    expect(DOWN_1).not.toMatch(/CREATE TYPE "[a-z_]+" AS ENUM \(\s*'/);
    expect(DOWN_1.match(/SELECT pg_temp\.quitar_valores_de_enum_458\(/g)).toHaveLength(3);
    for (const [tipo, valores] of Object.entries(VALORES_458)) {
      const llamada = new RegExp(`quitar_valores_de_enum_458\\('public', '${tipo}', ARRAY\\[([\\s\\S]*?)\\]\\)`).exec(DOWN_1);
      expect(llamada, tipo).not.toBeNull();
      const listados = [...(llamada as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      expect(listados, tipo).toEqual([...valores]);
    }
  });

  it("(f) `TIPO_POR_CATEGORIA_TIENDA` coincide con el CHECK de la tienda LEIDO DEL MOTOR", async () => {
    const [check] = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND c.conname = 'wallet_tienda_movimiento_tipo_categoria_check'`;
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
    expect(rama("credito")).toContain("flete_devolucion_anulado");
    expect(rama("credito")).toContain("iva_flete_devolucion_anulado");
    expect(rama("credito")).toHaveLength(7);
    expect(rama("debito")).toHaveLength(11);
  });

  it("(g) R89: ninguna de las dos migraciones toca filas", () => {
    for (const sql of [UP_1, UP_2]) {
      // Sentencias, no palabras: `ON DELETE RESTRICT ON UPDATE CASCADE` de las FK no toca filas.
      expect(soloEjecutable(sql)).not.toMatch(/^\s*(UPDATE|DELETE\s+FROM|INSERT\s+INTO|TRUNCATE)\b/im);
    }
  });
});
