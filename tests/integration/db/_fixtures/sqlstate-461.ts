import { randomUUID } from "node:crypto";

import type { TxDeTest } from "../_postgres-real";

// FICHA 461 — leer el SQLSTATE de un error de Prisma, venga como venga.
//
// Con el driver adapter de Prisma 7 el codigo de Postgres NO esta en `error.meta.code`: viaja en
// `meta.driverAdapterError.cause.code` o solo en el mensaje. Los tests de esta ficha afirman CODIGOS
// (23505 unico, 23514 CHECK, 23503 FK a una fila inexistente, 23001 `ON DELETE RESTRICT`) y no textos,
// asi que se busca el codigo en todo el error
// serializado. Solo los codigos que estos tests esperan: cualquier otro fallo vuelve como texto para
// que el `toEqual` lo nombre.

const CODIGOS = ["23505", "23514", "23503", "23001", "22P02", "55P04", "40P01", "42703", "42P01"];

export function sqlstateDe(error: unknown): string {
  const texto = JSON.stringify(error, Object.getOwnPropertyNames(error as object)) + String((error as Error)?.message ?? "");
  // Forma del driver adapter (Prisma 7): «Raw query failed. Code: `23514`. Message: …».
  const conCode = /Code: `([0-9A-Z]{5})`/.exec(texto);
  if (conCode !== null && CODIGOS.includes(conCode[1])) return conCode[1];
  for (const c of CODIGOS) if (texto.includes(`"${c}"`) || texto.includes(`code: ${c}`) || texto.includes(` ${c} `) || texto.includes(`(${c})`)) return c;
  return `?? ${String((error as Error)?.message ?? error).replace(/\s+/g, " ").slice(0, 120)}`;
}

/** Ejecuta `sql` en un SAVEPOINT y devuelve el SQLSTATE si fallo, o `null` si paso. */
export async function intentarSql(tx: TxDeTest, sql: string, ...args: unknown[]): Promise<string | null> {
  const punto = `sp_${randomUUID().replace(/-/g, "")}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
  try {
    await tx.$executeRawUnsafe(sql, ...args);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
    return null;
  } catch (e) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
    return sqlstateDe(e);
  }
}
