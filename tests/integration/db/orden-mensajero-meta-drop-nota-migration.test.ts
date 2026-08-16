import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

// Feature 227 (T4.10) — cobertura de la migracion M2 `*_orden_mensajero_meta_drop_nota`, la
// DESTRUCTIVA. Cubre R23 (el up retira `nota`, el down repone la ESTRUCTURA nullable) y, de
// paso, R24 (`marcar_luego` y el UNIQUE `(usuario_id, orden_id)` quedan INTACTOS en ambos
// sentidos) y R22 (ni el up ni el down leen o copian el CONTENIDO de las notas).
//
// POR QUE ESTE ARCHIVO NO SE CONFORMA CON REGEX SOBRE EL SQL. Un `expect(sql).toMatch(...)`
// demuestra que alguien ESCRIBIO una linea, no que Postgres la haya entendido asi. Que un
// `DROP COLUMN` no se lleve por delante un indice unico que NO menciona, o que un
// `ADD COLUMN ... TEXT` nazca NULLABLE y VACIO, son hechos del motor: o los verifica el
// motor, o no estan verificados. La feature 212 fue RECHAZADA por un test de migracion que
// solo miraba el texto; este ejecuta el DDL REAL, sentencia a sentencia.
//
// Como se mide sin ensuciar nada, y sin mentir sobre el estado PREVIO: dentro de una
// transaccion que SIEMPRE se revierte se crea un ESQUEMA temporal y se reconstruye ahi el
// estado anterior ejecutando el `migration.sql` REAL de la feature 115
// (`20260723120000_orden_mensajero_meta`), que es quien creo la tabla CON su columna `nota`.
// Sobre esa tabla —no sobre una de juguete escrita a mano— se corre el `migration.sql` de M2
// y despues su `down.sql`, midiendo los catalogos (`information_schema`, `pg_indexes`,
// `pg_constraint`, `pg_class`) en los tres momentos. `public` sigue en el `search_path`
// porque las dos FK apuntan a las tablas `usuario` y `orden` REALES.
//
// POR QUE NO PUEDE QUEDAR VERDE POR VACIO: no consulta ni una fila preexistente de negocio.
// Crea su propio usuario, su propia orden y sus propias filas de meta CON nota escrita, y
// comprueba que sobreviven al drop sin su columna. Si el `up` no se aplicara, la columna
// seguiria ahi y la asercion fallaria; si el `down` no repusiera nada, el INSERT posterior
// sobre `nota` reventaria. Lo unico que lo salta es la ausencia de `DATABASE_URL` (entonces
// vitest lo marca SKIPPED, nunca passed); si la base no tuviera catalogos sembrados, FALLA
// con el motivo escrito en vez de abstenerse.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFIJO = "_orden_mensajero_meta_drop_nota";
const MIGRACION_115 = "20260723120000_orden_mensajero_meta";

const carpeta = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .find((n) => n.endsWith(SUFIJO));
if (!carpeta) throw new Error(`No se encontro la carpeta de migracion ${SUFIJO}`);
const migrationDir = path.join(MIGRATIONS_DIR, carpeta);

const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const sql115 = fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRACION_115, "migration.sql"), "utf8");

/**
 * El SQL EJECUTABLE, sin lineas de comentario: la cabecera de esta migracion nombra a
 * proposito la columna que retira y la consulta del conteo, y sin limpiar primero se
 * ejecutarian trozos de documentacion.
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

function sentenciasDe(ddl: string): string[] {
  return ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);
const ddl115 = sinComentarios(sql115);

// ===========================================================================================
// Lo que NO es un hecho del motor: la cabecera obligatoria y el orden de la migracion
// ===========================================================================================

describe("227 / M2 — la migracion destructiva existe, va DESPUES de M1 y declara lo que borra", () => {
  it("la carpeta es posterior a `20260815120000_orden_nota` y trae migration.sql y down.sql", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    // El orden importa de verdad: M1 crea la tabla del hilo y M2 borra la columna vieja. Si
    // M2 corriera antes, un despliegue interrumpido entre las dos dejaria al sistema sin
    // ningun sitio donde escribir notas.
    expect(dirs.indexOf(path.basename(migrationDir))).toBeGreaterThan(
      dirs.indexOf("20260815120000_orden_nota"),
    );
    // Ultima de la lista ordenada: `scripts/db-rollback.ts` revierte SIEMPRE la ultima por
    // orden alfabetico. Si esta migracion no fuera la ultima, `pnpm run db:rollback` habria
    // revertido otra cosa.
    expect(dirs[dirs.length - 1]).toBe(path.basename(migrationDir));
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("R23: la cabecera declara la perdida DEFINITIVA Y DELIBERADA, su fecha y el conteo medido", () => {
    // Esto si es una asercion sobre el TEXTO, y es lo correcto: la cabecera es documentacion
    // para quien vaya a aplicar esto contra produccion, y su contenido no es un hecho que
    // Postgres pueda confirmar. Lo que el motor si verifica —el efecto— va mas abajo.
    expect(upSql).toMatch(/DEFINITIVA Y DELIBERADA/);
    expect(upSql).toMatch(/2026-08-14/); // fecha de la decision humana (P1)
    expect(upSql).toMatch(/filas = 0/); // conteo medido, con su entorno declarado
    expect(upSql).toMatch(/LOCAL/);
    // El conteo LOCAL es 0 sobre una tabla vacia: no dice nada de produccion, y la cabecera
    // tiene que decir que ese numero sigue PENDIENTE de medirse alli.
    expect(upSql).toMatch(/PENDIENTE/);
    expect(upSql).toMatch(/PRODUCCION/);
  });

  it("R22: ni el up ni el down LEEN o COPIAN el contenido de las notas", () => {
    // La decision P1 es que el contenido se pierde, no que se mueva a otro sitio. Una sola
    // sentencia de lectura o de copia aqui seria la fuga retroactiva que el spec prohibe.
    for (const sentencia of [...sentenciasDe(upDdl), ...sentenciasDe(downDdl)]) {
      expect(sentencia, sentencia).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|SELECT|COPY)\b/i);
      expect(sentencia, sentencia).not.toMatch(/orden_nota/i);
    }
  });

  it("el up es UNA sola sentencia (el DROP) y el down UNA sola (el ADD COLUMN)", () => {
    expect(sentenciasDe(upDdl)).toHaveLength(1);
    expect(sentenciasDe(downDdl)).toHaveLength(1);
    expect(sentenciasDe(upDdl)[0]).toMatch(/^ALTER TABLE "orden_mensajero_meta" DROP COLUMN "nota"$/);
    expect(sentenciasDe(downDdl)[0]).toMatch(
      /^ALTER TABLE "orden_mensajero_meta" ADD COLUMN "nota" TEXT$/,
    );
  });

  it("R24: ninguna de las dos sentencias nombra `marcar_luego`, el UNIQUE, las FK ni la RLS", () => {
    for (const sentencia of [...sentenciasDe(upDdl), ...sentenciasDe(downDdl)]) {
      expect(sentencia, sentencia).not.toMatch(/marcar_luego/i);
      expect(sentencia, sentencia).not.toMatch(/usuario_id_orden_id_key/i);
      expect(sentencia, sentencia).not.toMatch(/FOREIGN KEY|CONSTRAINT|ROW LEVEL SECURITY/i);
    }
  });

  it("R25: no menciona `orden.notas`, la nota de la TIENDA, que es otra cosa", () => {
    for (const sentencia of [...sentenciasDe(upDdl), ...sentenciasDe(downDdl)]) {
      expect(sentencia, sentencia).not.toMatch(/\borden\b\s*\./i);
      expect(sentencia, sentencia).not.toMatch(/"notas"/i);
    }
  });
});

// ===========================================================================================
// El DDL, EJECUTADO: los hechos del motor
// ===========================================================================================

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface ColumnaReal {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface IndiceReal {
  indexname: string;
  indexdef: string;
}

interface Foto {
  columnas: ColumnaReal[];
  indices: IndiceReal[];
  fks: { conname: string; confdeltype: string }[];
  rls: boolean;
  /** Filas de la tabla, con su `marcar_luego`, para ver que el drop no se lleva datos ajenos. */
  filas: { id: string; marcar_luego: boolean }[];
  /** Mensaje del INSERT duplicado sobre (usuario_id, orden_id): "" si NO fallo (=UNIQUE roto). */
  errorDuplicado: string;
}

interface Medicion {
  antes: Foto;
  trasElUp: Foto;
  trasElDown: Foto;
  /** Cuantas filas traen `nota IS NOT NULL` despues del down: el contenido NO vuelve. */
  notasTrasElDown: number;
  /** Mensaje al intentar leer `nota` cuando el up ya la retiro: "" si no fallo. */
  errorLeerNotaTrasElUp: string;
  /** Mensaje al ESCRIBIR `nota` despues del down: "" si la estructura volvio de verdad. */
  errorEscribirNotaTrasElDown: string;
}

describeSiHayBase("227 / M2 — el DDL REAL contra Postgres (R23, R24, R22)", () => {
  let prisma: PrismaClient;
  let medicion: Medicion;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    medicion = await enTransaccionRevertida(prisma, async (tx) => medir(tx));
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function medir(tx: Tx): Promise<Medicion> {
    // PRIMERA sentencia de la transaccion, antes de tocar nada: el DDL de la 115 que se
    // reconstruye aqui crea FK contra `public."usuario"` y `public."orden"` (y toma un lock
    // sobre ellas), y ademas el test inserta filas propias en las dos. Otros dos archivos de la
    // feature hacen lo mismo en paralelo y tomaban esos locks en distinto orden: `40P01`.
    await serializarEscriturasReales(tx);

    const esquema = `t227m2_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    // `public` se queda en el search_path: las dos FK de la tabla apuntan a `usuario` y
    // `orden` REALES. Contra tablas de juguete, lo medido seria de mentira.
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}", public`);

    // ESTADO PREVIO REAL: el `migration.sql` de la feature 115, que creo la tabla CON `nota`.
    for (const sentencia of sentenciasDe(ddl115)) await tx.$executeRawUnsafe(sentencia);

    // Datos PROPIOS del test. La nota escrita es lo que la migracion va a borrar: sin ella,
    // "la columna desaparece" seria una frase sobre una tabla vacia.
    const mensajero1 = await crearUsuario(tx);
    const mensajero2 = await crearUsuario(tx);
    const ordenId = await crearOrden(tx, mensajero1.id);
    const filaConNota = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO "orden_mensajero_meta" ("id","usuario_id","orden_id","marcar_luego","nota","updated_at")
       VALUES ($1, $2, $3, true, 'recoger en porton azul', now())`,
      filaConNota,
      mensajero1.id,
      ordenId,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "orden_mensajero_meta" ("id","usuario_id","orden_id","marcar_luego","nota","updated_at")
       VALUES ($1, $2, $3, false, 'la nota de otro mensajero', now())`,
      randomUUID(),
      mensajero2.id,
      ordenId,
    );

    const antes = await fotografiar(tx, esquema, mensajero1.id, ordenId);

    // --- UP REAL, sentencia a sentencia -----------------------------------------------
    for (const sentencia of sentenciasDe(upDdl)) await tx.$executeRawUnsafe(sentencia);
    const trasElUp = await fotografiar(tx, esquema, mensajero1.id, ordenId);
    const errorLeerNotaTrasElUp = await resultadoDe(
      tx,
      `SELECT "nota" FROM "orden_mensajero_meta" LIMIT 1`,
    );

    // --- DOWN REAL --------------------------------------------------------------------
    for (const sentencia of sentenciasDe(downDdl)) await tx.$executeRawUnsafe(sentencia);
    const trasElDown = await fotografiar(tx, esquema, mensajero1.id, ordenId);
    const [{ n: notasTrasElDown }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "orden_mensajero_meta" WHERE "nota" IS NOT NULL`,
    );
    // La estructura volvio de VERDAD si se puede volver a escribir en ella.
    const errorEscribirNotaTrasElDown = await resultadoDe(
      tx,
      `UPDATE "orden_mensajero_meta" SET "nota" = 'nota nueva, posterior al down' WHERE "id" = '${filaConNota}'`,
    );

    return {
      antes,
      trasElUp,
      trasElDown,
      notasTrasElDown: Number(notasTrasElDown),
      errorLeerNotaTrasElUp,
      errorEscribirNotaTrasElDown,
    };
  }

  /** Los catalogos + las filas + el ensayo del UNIQUE, en un instante concreto. */
  async function fotografiar(
    tx: Tx,
    esquema: string,
    usuarioId: string,
    ordenId: string,
  ): Promise<Foto> {
    const columnas = await tx.$queryRawUnsafe<ColumnaReal[]>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'orden_mensajero_meta'
        ORDER BY column_name`,
      esquema,
    );
    const indices = await tx.$queryRawUnsafe<IndiceReal[]>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = $1 AND tablename = 'orden_mensajero_meta'
        ORDER BY indexname`,
      esquema,
    );
    const fks = await tx.$queryRawUnsafe<{ conname: string; confdeltype: string }[]>(
      `SELECT c.conname, c.confdeltype::text AS confdeltype
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = 'orden_mensajero_meta' AND c.contype = 'f'
        ORDER BY c.conname`,
      esquema,
    );
    const [{ relrowsecurity }] = await tx.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
      `SELECT c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = 'orden_mensajero_meta'`,
      esquema,
    );
    const filas = await tx.$queryRawUnsafe<{ id: string; marcar_luego: boolean }[]>(
      `SELECT "id", "marcar_luego" FROM "orden_mensajero_meta" ORDER BY "marcar_luego"`,
    );
    // El UNIQUE, EJERCITADO: de el depende la idempotencia del upsert de `marcar_luego`
    // (feature 115/R7). Que el indice figure en `pg_indexes` no prueba que rechace nada.
    const errorDuplicado = await resultadoDe(
      tx,
      `INSERT INTO "orden_mensajero_meta" ("id","usuario_id","orden_id","updated_at")
       VALUES ('${randomUUID()}', '${usuarioId}', '${ordenId}', now())`,
    );
    return { columnas, indices, fks, rls: relrowsecurity, filas, errorDuplicado };
  }

  /**
   * Ejecuta `sql` dentro de un SAVEPOINT y devuelve el MENSAJE de error, o `""` si paso. Sin
   * el savepoint, la primera violacion esperada abortaria la transaccion entera y mataria el
   * resto de las mediciones.
   */
  async function resultadoDe(tx: Tx, sql: string): Promise<string> {
    await tx.$executeRawUnsafe("SAVEPOINT s227m2");
    try {
      await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s227m2");
      return "";
    } catch (error) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s227m2");
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Un usuario NUEVO, creado por el test. Si faltaran los catalogos, FALLA con el motivo
   * escrito en vez de saltarse: un test que se abstiene porque la base esta vacia es
   * exactamente el verde-en-falso que este archivo existe para evitar.
   */
  async function crearUsuario(tx: Tx): Promise<{ id: string }> {
    const [rol] = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM public."rol" LIMIT 1`);
    const [tipo] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public."tipo_identificacion" LIMIT 1`,
    );
    if (!rol || !tipo) {
      throw new Error(
        "La base de pruebas no tiene catalogos `rol`/`tipo_identificacion` sembrados: sin " +
          "ellos no se puede crear el usuario propio del test. Corre `pnpm db:seed`. Este " +
          "test NO se salta en ese caso a proposito.",
      );
    }
    const id = randomUUID();
    const sufijo = id.slice(0, 8);
    await tx.$executeRawUnsafe(
      `INSERT INTO public."usuario"
         ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","updated_at")
       VALUES ($1, $2, $3, '00000000', 'x', $4, $5, $6, now())`,
      id,
      `Usuario ${sufijo}`,
      `t227m2-${sufijo}@example.test`,
      `t227m2${sufijo}`,
      tipo.id,
      rol.id,
    );
    return { id };
  }

  /** Una orden NUEVA del test, con las FK obligatorias tomadas de los catalogos. */
  async function crearOrden(tx: Tx, mensajeroId: string): Promise<string> {
    const [geo] = await tx.$queryRawUnsafe<{
      zona_id: string;
      provincia_id: string;
      canton_id: string;
    }[]>(
      `SELECT z."id" AS zona_id, p."id" AS provincia_id, c."id" AS canton_id
         FROM public."zona" z, public."provincia" p, public."canton" c
        WHERE c."provincia_id" = p."id"
        LIMIT 1`,
    );
    const [estatus] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM public."order_status" LIMIT 1`,
    );
    if (!geo || !estatus) {
      throw new Error(
        "La base de pruebas no tiene catalogos de geografia/estatus sembrados: sin ellos no " +
          "se puede crear la orden propia del test. Corre `pnpm db:seed`. Este test NO se " +
          "salta en ese caso a proposito.",
      );
    }
    const id = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO public."orden"
         ("id","num_remision","estatus_id","destinatario","telefono_dest","tienda_id","zona_id",
          "provincia_id","canton_id","producto","mensajero_asignado_id","updated_at")
       VALUES ($1, $2, $3, 'Destinatario de prueba', '00000000', $4, $5, $6, $7, 'Producto', $8, now())`,
      id,
      `t227m2-${id.slice(0, 8)}`,
      estatus.id,
      mensajeroId,
      geo.zona_id,
      geo.provincia_id,
      geo.canton_id,
      mensajeroId,
    );
    return id;
  }

  function nombres(foto: Foto): string[] {
    return foto.columnas.map((c) => c.column_name);
  }

  it("el estado PREVIO tiene la columna `nota` con contenido escrito (si no, no habria nada que borrar)", () => {
    expect(nombres(medicion.antes)).toContain("nota");
    const nota = medicion.antes.columnas.find((c) => c.column_name === "nota")!;
    expect(nota.data_type).toBe("text");
    expect(nota.is_nullable).toBe("YES");
    expect(medicion.antes.filas).toHaveLength(2);
  });

  it("el up retira la columna y el down la repone nullable", () => {
    // R23, el requisito entero en una sola asercion de tres tiempos.
    expect(nombres(medicion.antes)).toContain("nota");

    // UP: la columna DESAPARECE del catalogo, y leerla revienta de verdad.
    expect(nombres(medicion.trasElUp)).not.toContain("nota");
    expect(medicion.errorLeerNotaTrasElUp).toMatch(/nota/i);

    // DOWN: vuelve, TEXT y NULLABLE, sin default (la estructura EXACTA que creo la 115).
    expect(nombres(medicion.trasElDown)).toContain("nota");
    const repuesta = medicion.trasElDown.columnas.find((c) => c.column_name === "nota")!;
    expect(repuesta.data_type).toBe("text");
    expect(repuesta.is_nullable).toBe("YES");
    expect(repuesta.column_default).toBeNull();
    // Y es una columna VIVA, no un hueco de catalogo: se puede volver a escribir en ella.
    expect(medicion.errorEscribirNotaTrasElDown).toBe("");
  });

  it("el down repone la ESTRUCTURA pero NO el CONTENIDO: las notas vuelven vacias", () => {
    // Esto es la mitad honesta de R23 y la razon de que la cabecera del up hable de perdida
    // DEFINITIVA. Antes habia dos notas escritas; tras el ciclo up+down, cero.
    expect(medicion.antes.filas).toHaveLength(2);
    expect(medicion.notasTrasElDown).toBe(0);
  });

  it("R24: el UNIQUE (usuario_id, orden_id) sigue RECHAZANDO duplicados antes, tras el up y tras el down", () => {
    // Ejercitado, no leido de un catalogo: de este rechazo depende la idempotencia del
    // upsert del toggle `marcar_luego` (feature 115/R7).
    expect(medicion.antes.errorDuplicado).toMatch(/orden_mensajero_meta_usuario_id_orden_id_key/);
    expect(medicion.trasElUp.errorDuplicado).toMatch(/orden_mensajero_meta_usuario_id_orden_id_key/);
    expect(medicion.trasElDown.errorDuplicado).toMatch(
      /orden_mensajero_meta_usuario_id_orden_id_key/,
    );
  });

  it("R24: `marcar_luego` conserva su valor por fila en los tres momentos", () => {
    const valores = (f: Foto) => f.filas.map((r) => r.marcar_luego);
    expect(valores(medicion.antes)).toEqual([false, true]);
    expect(valores(medicion.trasElUp)).toEqual([false, true]);
    expect(valores(medicion.trasElDown)).toEqual([false, true]);
    const marca = (f: Foto) => f.columnas.find((c) => c.column_name === "marcar_luego")!;
    for (const foto of [medicion.antes, medicion.trasElUp, medicion.trasElDown]) {
      expect(marca(foto).data_type).toBe("boolean");
      expect(marca(foto).is_nullable).toBe("NO");
      expect(marca(foto).column_default).toBe("false");
    }
  });

  it("R24: los indices, las dos FK en CASCADE y la RLS quedan intactos en los tres momentos", () => {
    const nombresIndices = (f: Foto) => f.indices.map((i) => i.indexname);
    const esperados = [
      "orden_mensajero_meta_orden_id_idx",
      "orden_mensajero_meta_pkey",
      "orden_mensajero_meta_usuario_id_idx",
      "orden_mensajero_meta_usuario_id_orden_id_key",
    ];
    for (const foto of [medicion.antes, medicion.trasElUp, medicion.trasElDown]) {
      expect(nombresIndices(foto)).toEqual(esperados);
      expect(foto.fks.map((f) => [f.conname, f.confdeltype])).toEqual([
        ["orden_mensajero_meta_orden_id_fkey", "c"],
        ["orden_mensajero_meta_usuario_id_fkey", "c"],
      ]);
      expect(foto.rls).toBe(true);
    }
  });

  it("el resto de columnas de la tabla no se mueve: solo cambia `nota`", () => {
    const sinNota = (f: Foto) => nombres(f).filter((c) => c !== "nota");
    const esperadas = ["created_at", "id", "marcar_luego", "orden_id", "updated_at", "usuario_id"];
    expect(sinNota(medicion.antes)).toEqual(esperadas);
    expect(sinNota(medicion.trasElUp)).toEqual(esperadas);
    expect(sinNota(medicion.trasElDown)).toEqual(esperadas);
  });
});
