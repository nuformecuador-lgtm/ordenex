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

// FICHA 403 (T1, design §1.1) — las DOS columnas del circuito en `webhook_suscripcion`, su
// ADITIVIDAD y su rollback.
//
// POR QUE ESTE ARCHIVO EXISTE, y por que la mitad de abajo va contra Postgres de verdad:
//
//  1. Los DEFAULTS son el mecanismo, no un adorno. `fallos_consecutivos` nace en 0 y
//     `sin_exito_desde` en `now()` PARA QUE las filas que ya existian queden tratadas como "sanas
//     ahora mismo": nadie entra en pausa por su historial previo. Que el default este escrito en
//     el `.sql` lo puede ver una regex; que la BASE lo aplique de verdad al insertar, no.
//  2. `sin_exito_desde` es NOT NULL a proposito. `estaPausada()` mide contra ese instante, y un
//     `NULL` no significa "nunca fallo": significa que no hay contra que medir. Se comprueba que
//     la base RECHAZA un `NULL` explicito.
//  3. La migracion tiene que ser ADITIVA de verdad: ni un `UPDATE`, ni un `DELETE`, ni un
//     `DROP`, ni tocar `activa` — que es el interruptor manual del dueño y lo que R5 protege.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function carpetaQueTerminaEn(sufijo: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .find((n) => n.endsWith(sufijo));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${sufijo}`);
  return path.join(MIGRATIONS_DIR, dir);
}

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const dirCircuito = carpetaQueTerminaEn("_webhook_suscripcion_circuito");
const upSql = fs.readFileSync(path.join(dirCircuito, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirCircuito, "down.sql"), "utf8");
const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);

const SCHEMA = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

describe("403/T1 — el UP añade EXACTAMENTE dos columnas, con sus defaults", () => {
  it("⭑ `fallos_consecutivos` INTEGER NOT NULL DEFAULT 0", () => {
    expect(upDdl).toMatch(/ADD COLUMN "fallos_consecutivos" INTEGER NOT NULL DEFAULT 0/);
  });

  it("⭑ `sin_exito_desde` TIMESTAMP(3) NOT NULL con default de reloj", () => {
    // `TIMESTAMP(3)` y no `TIMESTAMPTZ`: es a lo que Prisma mapea un `DateTime` sin `@db.`, y es
    // lo que tienen `created_at`/`updated_at` de esta misma tabla. Otro tipo dejaria drift
    // permanente entre `db/schema.prisma` y la base, y `migrate dev` propondria cambiarlo en cada
    // migracion futura.
    expect(upDdl).toMatch(
      /ADD COLUMN "sin_exito_desde" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/,
    );
  });

  it("⭑ NO hay una tercera columna `pausada`: el estado es DERIVADO", () => {
    // design §1.1 / alternativa descartada 3. Un booleano persistido en paralelo a los datos que
    // lo determinan puede divergir de ellos; con un valor derivado hay una sola fuente de verdad.
    expect(upDdl).not.toMatch(/pausad/i);
  });

  it("⭑ ADITIVA: ni un UPDATE, ni un DELETE, ni un DROP, ni un INSERT", () => {
    expect(upDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(upDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(upDdl).not.toMatch(/^\s*INSERT\s/im);
    expect(upDdl).not.toMatch(/TRUNCATE/i);
    expect(upDdl).not.toMatch(/DROP (TABLE|COLUMN|INDEX|CONSTRAINT)/i);
  });

  it("⭑ R5: el UP no menciona `activa` — la pausa no toca el interruptor del dueño", () => {
    expect(upDdl).not.toMatch(/"activa"/);
  });

  it("no toca RLS ni crea policies: la tabla conserva la de la feature 99", () => {
    expect(upDdl).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upDdl).not.toMatch(/CREATE POLICY/i);
  });

  it("una sola sentencia `ALTER TABLE`, y sobre `webhook_suscripcion`", () => {
    const sentencias = upDdl.split(";").filter((s) => s.trim().length > 0);
    expect(sentencias).toHaveLength(1);
    expect(sentencias[0]).toMatch(/ALTER TABLE\s+"webhook_suscripcion"/);
  });

  it("el modelo de Prisma declara las dos columnas con su @map y su default", () => {
    const modelo = /model WebhookSuscripcion \{([\s\S]*?)\n\}/.exec(SCHEMA)![1];
    expect(modelo).toMatch(/fallosConsecutivos\s+Int\s+@default\(0\)\s+@map\("fallos_consecutivos"\)/);
    expect(modelo).toMatch(/sinExitoDesde\s+DateTime\s+@default\(now\(\)\)\s+@map\("sin_exito_desde"\)/);
    // Y sigue sin haber ninguna columna de "pausada" en el modelo. Se mide sobre las DECLARACIONES,
    // no sobre el texto crudo: los comentarios de este bloque NOMBRAN a proposito la columna que el
    // modelo tiene prohibida, y un barrido sobre el texto denunciaria la explicacion, no el error.
    const declaraciones = modelo
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//"))
      .map((l) => l.split(/\s+\/\//)[0])
      .join("\n");
    expect(declaraciones).not.toMatch(/pausad/i);
  });
});

describe("403/T1 — el DOWN retira las dos, en orden inverso y sin tocar nada mas", () => {
  it("la migracion trae su `down.sql`", () => {
    expect(fs.existsSync(path.join(dirCircuito, "down.sql"))).toBe(true);
  });

  it("⭑ suelta las DOS columnas, `sin_exito_desde` antes que `fallos_consecutivos`", () => {
    expect(downDdl).toMatch(/DROP COLUMN IF EXISTS "sin_exito_desde"/);
    expect(downDdl).toMatch(/DROP COLUMN IF EXISTS "fallos_consecutivos"/);
    expect(downDdl.indexOf("sin_exito_desde")).toBeLessThan(downDdl.indexOf("fallos_consecutivos"));
  });

  it("⭑ el DOWN no borra filas ni toca `activa`", () => {
    // Lo que se pierde al revertir es informacion OPERATIVA y reconstruible sola (la siguiente
    // entrega aceptada vuelve a fijar el ancla). Lo que NO puede perderse es una suscripcion.
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/i);
    expect(downDdl).not.toMatch(/TRUNCATE/i);
    expect(downDdl).not.toMatch(/"activa"/);
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("403/T1 — la base aplicada, medida de verdad", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  interface ColumnaInfo {
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }

  async function columnas(): Promise<Record<string, ColumnaInfo>> {
    const filas = await prisma.$queryRawUnsafe<ColumnaInfo[]>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'webhook_suscripcion'
          AND column_name IN ('fallos_consecutivos','sin_exito_desde')`,
    );
    return Object.fromEntries(filas.map((f) => [f.column_name, f]));
  }

  it("⭑ las dos columnas EXISTEN, con su tipo, NOT NULL y su default", async () => {
    const cols = await columnas();
    expect(Object.keys(cols).sort()).toEqual(["fallos_consecutivos", "sin_exito_desde"]);

    expect(cols.fallos_consecutivos.data_type).toBe("integer");
    expect(cols.fallos_consecutivos.is_nullable).toBe("NO");
    expect(cols.fallos_consecutivos.column_default).toBe("0");

    expect(cols.sin_exito_desde.data_type).toBe("timestamp without time zone");
    expect(cols.sin_exito_desde.is_nullable).toBe("NO");
    expect(cols.sin_exito_desde.column_default).toMatch(/CURRENT_TIMESTAMP/i);
  });

  it("⭑ y NO existe ninguna columna con «pausad» en el nombre", async () => {
    const filas = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'webhook_suscripcion'
          AND column_name ILIKE '%pausad%'`,
    );
    expect(filas).toEqual([]);
  });

  it("⭑ una fila MINIMA nace con contador 0 y un ancla no nula: es el default aplicado", async () => {
    // Lo que ningun test estatico puede demostrar: que la BASE aplica los defaults al insertar.
    // De aqui sale la propiedad que R1 pide — «una suscripcion recien creada ya tiene un ancla
    // valida: su propia creacion»— y sin ella la ventana de R4 no tendria contra que medirse.
    const leido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      // La FK exige un usuario real: se toma uno cualquiera que ya exista.
      const dueños = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "usuario" LIMIT 1`);
      if (dueños.length === 0) return null;
      const id = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "webhook_suscripcion" ("id","owner_usuario_id","url","secret")
         VALUES ($1, $2, 'https://ejemplo.invalid/hook', 'ciphertext-de-prueba')`,
        id,
        dueños[0].id,
      );
      const filas = await tx.$queryRawUnsafe<
        { fallos_consecutivos: number; sin_exito_desde: Date; activa: boolean }[]
      >(
        `SELECT "fallos_consecutivos", "sin_exito_desde", "activa"
           FROM "webhook_suscripcion" WHERE "id" = $1`,
        id,
      );
      return filas[0];
    });

    // ⚠️ ANTI-VACUIDAD: si no hubiera ni un usuario en la base, este test estaria reportando
    // `passed` sin comprobar nada. Se falla ruidosamente en vez de abstenerse.
    expect(leido, "no hay ni un `usuario` en la base: el caso no midio nada").not.toBeNull();
    expect(leido!.fallos_consecutivos).toBe(0);
    expect(leido!.sin_exito_desde).toBeInstanceOf(Date);
    // Y el alta sigue naciendo activa (default de la 99), que la 403 no toca.
    expect(leido!.activa).toBe(true);
  });

  it("⭑ `sin_exito_desde` NOT NULL: un `NULL` explicito lo RECHAZA la base", async () => {
    // `estaPausada()` mide contra ese instante; un `NULL` no significa «nunca fallo», significa
    // que no hay contra que medir. Que sea imposible escribirlo es lo que hace que el predicado
    // no necesite una rama para el caso.
    const rechazo = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const dueños = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "usuario" LIMIT 1`);
      if (dueños.length === 0) return "sin-usuarios";
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO "webhook_suscripcion"
             ("id","owner_usuario_id","url","secret","sin_exito_desde")
           VALUES ($1, $2, 'https://ejemplo.invalid/hook', 'ciphertext', NULL)`,
          randomUUID(),
          dueños[0].id,
        );
        return "acepto-null";
      } catch {
        return "rechazo-null";
      }
    });
    expect(rechazo, "no hay ni un `usuario` en la base: el caso no midio nada").not.toBe(
      "sin-usuarios",
    );
    expect(rechazo).toBe("rechazo-null");
  });

  it("⭑ el DOWN corre entero y deja la tabla SIN las dos columnas y CON las de siempre", async () => {
    // El rollback ejercitado de verdad, dentro de una transaccion que SIEMPRE se revierte (el DDL
    // tambien es transaccional en Postgres, asi que la base queda como estaba). Sin esto, «el down
    // revierte» seria una afirmacion sobre un texto.
    const restantes = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      for (const sentencia of downDdl
        .split(";")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)) {
        await tx.$executeRawUnsafe(sentencia);
      }
      const filas = await tx.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'webhook_suscripcion'
          ORDER BY column_name`,
      );
      return filas.map((f) => f.column_name);
    });

    expect(restantes).not.toContain("fallos_consecutivos");
    expect(restantes).not.toContain("sin_exito_desde");
    // Y las de la 99 siguen ahi: el down no se lleva por delante nada mas.
    expect(restantes.sort()).toEqual([
      "activa",
      "created_at",
      "id",
      "owner_usuario_id",
      "secret",
      "updated_at",
      "url",
    ]);
  });

  it("⭑ y el DOWN no se lleva el indice unico de `owner_usuario_id` ni la FK", async () => {
    // `DROP COLUMN` puede arrastrar indices y constraints que mencionen la columna. Ninguno de los
    // de esta tabla la menciona, pero eso NO SE SUPONE: se mide DESPUES de correr el down.
    const objetos = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      for (const sentencia of downDdl
        .split(";")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)) {
        await tx.$executeRawUnsafe(sentencia);
      }
      const indices = await tx.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'webhook_suscripcion'`,
      );
      const fks = await tx.$queryRawUnsafe<{ conname: string }[]>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = '"webhook_suscripcion"'::regclass AND contype = 'f'`,
      );
      return {
        indices: indices.map((i) => i.indexname).sort(),
        fks: fks.map((f) => f.conname).sort(),
      };
    });

    expect(objetos.indices).toContain("webhook_suscripcion_owner_usuario_id_key");
    expect(objetos.indices).toContain("webhook_suscripcion_pkey");
    expect(objetos.fks).toContain("webhook_suscripcion_owner_usuario_id_fkey");
  });
});
