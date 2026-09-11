import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, etiquetasDeEnum } from "./_postgres-real";

/**
 * ⭑ FICHA 373 / A5 (R27/R39) — LA MIGRACION DEL VALOR NUEVO DEL ENUM, LEIDA DE LA BASE APLICADA.
 *
 * Lo que se mide, y de DONDE sale cada cosa:
 *   · que `historial_accion_tipo` tiene `api_key_eliminada` -> de `pg_enum`, no del `.sql`
 *     (afirmarlo leyendo la migracion que lo escribe seguiria verde aunque nunca se hubiera
 *     aplicado);
 *   · que el catalogo de TypeScript y el enum de Postgres dicen LO MISMO -> dos fuentes
 *     independientes, comparadas entre si;
 *   · R39 — que el `up` es ADITIVO y va SOLO: ni una tabla, ni una columna, ni un backfill. Esta
 *     ficha NO introduce modelo de datos nuevo, ni borrado logico, ni archivado;
 *   · R27 — que el `down.sql` recrea el tipo con la lista PREVIA EXACTA (44, sin el valor nuevo) y
 *     que su `USING` es lo que hace fallar RUIDOSAMENTE la reversion mientras quede una fila con
 *     la accion nueva.
 *
 * LA LISTA PREVIA NO SE COPIA DE ESTE MISMO ARCHIVO: se deriva del `down.sql` de la ficha 371
 * (43 valores) MAS el que aquella migracion anadio y su propio `down` no podia listar. Comparar el
 * down contra si mismo estaria siempre verde.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const RAIZ = path.resolve(__dirname, "../../..");
const CARPETA = "20260904120000_historial_accion_api_key_eliminada";
const CARPETA_371 = "20260903150000_correccion_fecha_reprogramacion";
const VALOR_NUEVO = "api_key_eliminada";
/** El valor que anadio la 371 y que su propio `down` no podia listar (`ADD VALUE` APENDE). */
const ANADIDO_POR_LA_371 = "gestion_fecha_reprogramacion_corregida";

function sql(carpeta: string, archivo: string): string {
  return readFileSync(path.join(RAIZ, "db", "migrations", carpeta, archivo), "utf8");
}

/** Los literales `'x'` del PRIMER bloque `CREATE TYPE "historial_accion_tipo" AS ENUM ( ... )`. */
function valoresDelCreateType(texto: string): string[] {
  const inicio = texto.indexOf('CREATE TYPE "historial_accion_tipo" AS ENUM');
  if (inicio === -1) return [];
  const fin = texto.indexOf(");", inicio);
  const cuerpo = texto.slice(inicio, fin);
  return [...cuerpo.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** Las lineas del SQL que Postgres EJECUTA (sin comentarios ni blancos). */
function sentencias(texto: string): string[] {
  return texto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--") && l.trim().length > 0);
}

describe("373/A5 — el `migration.sql`, como texto (R39)", () => {
  it("⭑ el UP es UNA sola sentencia: `ADD VALUE IF NOT EXISTS`, sin backfill ni uso del valor", () => {
    const up = sql(CARPETA, "migration.sql");
    expect(up).toContain(
      `ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS '${VALOR_NUEVO}';`,
    );
    // Postgres prohibe USAR el valor recien anadido en la misma transaccion (55P04): va solo.
    expect(sentencias(up), "el up tiene que ir SOLO").toHaveLength(1);
  });

  it("⭑ R39: el SQL de esta ficha no crea NI UNA tabla, columna, indice o fila", () => {
    // Medido sobre el SQL SIN COMENTARIOS, que es lo unico que Postgres ejecuta: la prosa de
    // arriba si nombra `api_key`, `usuario` y `webhook_suscripcion`.
    const ejecutable = sentencias(sql(CARPETA, "migration.sql")).join("\n");
    expect(ejecutable).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(ejecutable).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(ejecutable).not.toMatch(/\bCREATE\s+INDEX\b/i);
    expect(ejecutable).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    // Ni rastro de `deleted_at`, papelera ni archivado: la frontera del humano, en el SQL.
    expect(ejecutable).not.toMatch(/deleted_at|archivad|papelera/i);
  });
});

describe("373/A5 — el `down.sql` (R27)", () => {
  it("⭑ recrea el tipo con la lista PREVIA EXACTA: los 43 de la 371 MAS el que ella anadio", () => {
    const previos = [...valoresDelCreateType(sql(CARPETA_371, "down.sql")), ANADIDO_POR_LA_371];
    const recreados = valoresDelCreateType(sql(CARPETA, "down.sql"));

    // Anti-vacuidad: si el parser no encontrara nada, los dos arrays serian [] y esto pasaria.
    expect(previos).toHaveLength(44);
    expect(recreados).toHaveLength(44);
    // MISMO orden, mismos valores: es la foto de lo que habia antes de esta migracion.
    expect(recreados).toEqual(previos);
    expect(recreados).not.toContain(VALOR_NUEVO);
  });

  it("⭑ R27: el rollback falla RUIDOSAMENTE si queda una fila con la accion nueva", () => {
    // El mecanismo es el `USING` del `ALTER COLUMN`: castear 'api_key_eliminada' a un tipo que ya
    // no lo tiene revienta y aborta el rollback. NO hay ningun `DELETE FROM historial_accion` ni
    // ningun `UPDATE` que reescriba esas filas — que es justo lo que R27 prohibe: esas filas son
    // lo UNICO que queda de una key ya borrada.
    const down = sql(CARPETA, "down.sql");
    expect(down).toContain('USING ("accion"::text::"historial_accion_tipo")');
    const ejecutable = sentencias(down).join("\n");
    expect(ejecutable).not.toMatch(/DELETE\s+FROM\s+"?historial_accion"?/i);
    expect(ejecutable).not.toMatch(/UPDATE\s+"?historial_accion"?\s+SET/i);
    // Y la precondicion queda ESCRITA en el archivo, para quien lo corra a mano.
    expect(down).toMatch(/PRECONDICION/);
  });

  it("hace el rito completo: renombrar, recastear la unica columna, soltar el viejo", () => {
    const down = sql(CARPETA, "down.sql");
    expect(down).toContain('ALTER TYPE "historial_accion_tipo" RENAME TO "historial_accion_tipo_old"');
    expect(down).toContain('DROP TYPE "historial_accion_tipo_old"');
    // Postgres NO tiene `DROP VALUE`: si alguien lo escribiera, el rollback fallaria en produccion.
    // Medido sobre lo EJECUTABLE: el comentario de cabecera si nombra `DROP VALUE` para explicar
    // por que NO se usa.
    expect(sentencias(down).join("\n")).not.toMatch(/ALTER\s+TYPE[^\n]*DROP\s+VALUE/i);
  });

  it("no toca ningun `down.sql` anterior (son fotos historicas)", () => {
    // Contraprueba directa sobre el vecino: la lista de la 371 sigue teniendo SUS 43 y NO el valor
    // de esta ficha. Si alguien la «actualizara», su rollback dejaria de reproducir su momento.
    const previos = valoresDelCreateType(sql(CARPETA_371, "down.sql"));
    expect(previos).toHaveLength(43);
    expect(previos).not.toContain(VALOR_NUEVO);
    expect(previos).not.toContain(ANADIDO_POR_LA_371);
  });
});

describeSiHayBase("373/A5 — el enum en la base APLICADA", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // FICHA 421 — acota `nspname = 'public'`: ver `etiquetasDeEnum` en `_postgres-real.ts`.
  async function etiquetasDelEnum(): Promise<string[]> {
    return etiquetasDeEnum(prisma, "historial_accion_tipo");
  }

  it("⭑ `pg_enum` tiene `api_key_eliminada`, y el catalogo y la base dicen lo mismo", async () => {
    const enLaBase = await etiquetasDelEnum();
    expect(enLaBase, "la migracion no esta aplicada en esta base").toContain(VALOR_NUEVO);
    // Las DOS direcciones: ni el catalogo nombra algo que la base no tiene, ni al reves.
    expect(enLaBase.slice().sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    // ⚠️ EL CONTEO SE COMPARA CONTRA EL CATALOGO, NO CONTRA UN NUMERO CONGELADO. Aqui decia 45, y
    // la ficha 374 lo dejo obsoleto al añadir dos tipos. Un literal en este sitio obliga a que
    // CADA ficha que amplie el enum venga a editar la suite de la ficha anterior — y lo que este
    // caso quiere afirmar no es «son 45», es «la base y el catalogo dicen lo mismo». El numero
    // duro sigue existiendo, en el sitio que le corresponde:
    // `historial-accion-escrituras-cubiertas.guardia.test.ts`, que ademas obliga a censar el
    // productor del tipo nuevo.
    expect(enLaBase).toHaveLength(HISTORIAL_ACCION_TIPOS.length);
  });

  it("el valor nuevo va DESPUES del de la 371: `ADD VALUE` sin BEFORE/AFTER apende", async () => {
    // Es de donde sale la lista previa del `down.sql` de la SIGUIENTE ficha que amplie el enum.
    //
    // ⚠️ SE MIDE LA POSICION RELATIVA Y NO «el ultimo», y ese cambio lo forzo la ficha 374, que
    // apendio dos valores detras. Lo que la 373 necesitaba demostrar es que `ADD VALUE` APENDE
    // —o sea, que su valor quedo justo detras del de la 371—, y eso sigue siendo cierto y sigue
    // siendo lo que sostiene la lista previa de cualquier `down.sql` posterior.
    const enLaBase = await etiquetasDelEnum();
    const iNuevo = enLaBase.indexOf(VALOR_NUEVO);
    const i371 = enLaBase.indexOf(ANADIDO_POR_LA_371);
    expect(i371).toBeGreaterThanOrEqual(0);
    expect(iNuevo).toBe(i371 + 1);
  });

  it("una fila con el valor nuevo se puede escribir (el enum lo acepta de verdad)", async () => {
    // Castea el literal al tipo: si el valor no existiera, Postgres lo rechazaria aqui. No escribe.
    const filas = await prisma.$queryRawUnsafe<{ ok: string }[]>(
      `SELECT '${VALOR_NUEVO}'::"historial_accion_tipo"::text AS ok`,
    );
    expect(filas[0].ok).toBe(VALOR_NUEVO);
  });

  it("R39: la migracion no dejo ninguna tabla ni columna nueva de esta ficha", async () => {
    const filas = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'api_key'
          AND column_name IN ('deleted_at', 'archivada_at', 'eliminada_at')`,
    );
    expect(Number(filas[0].n)).toBe(0);
  });
});
