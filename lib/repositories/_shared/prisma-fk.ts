import { Prisma } from "@prisma/client";

// FICHA 373 — Fix P2003 bajo el driver adapter de Prisma 7 (`@prisma/adapter-pg` / `PrismaPg`).
//
// ⚠️ MEDIDO EL 2026-09-04 CONTRA POSTGRES, no supuesto. Un `DELETE` que viola una FK `RESTRICT`
// **NO llega como `PrismaClientKnownRequestError` con `code === "P2003"`**. Llega como:
//
//   ctor: DriverAdapterError · name: "DriverAdapterError" · code: undefined
//   meta: undefined · cause.code: "23001"
//   message: 'update or delete on table "usuario" violates RESTRICT setting of foreign key
//            constraint "orden_nota_autor_id_fkey" on table "orden_nota"'
//
// Se comprobo en las DOS formas de invocacion —`prisma.usuario.delete(...)` suelto y dentro de una
// `$transaction` interactiva— y el resultado es el mismo. Es la MISMA cicatriz que ya documenta
// `_shared/prisma-unique.ts` para el P2002: bajo el adapter, el error crudo del driver no se
// traduce al codigo de Prisma.
//
// CONSECUENCIA SI ESTO NO EXISTIERA: un `catch` que solo mire `code === "P2003"` deja escapar el
// error del driver. En esta ficha eso convertiria «esta key tiene datos que el guard no mira» en un
// 500 sin explicacion, que es justo lo que R16 prohibe.
//
// LOS DOS SQLSTATE, y por que los dos:
//   · `23001` restrict_violation      — lo que produce `ON DELETE RESTRICT`, que es lo que este
//                                       esquema declara casi siempre (y lo medido arriba);
//   · `23503` foreign_key_violation   — lo que produce `NO ACTION` (la comprobacion diferida) y
//                                       tambien un INSERT/UPDATE que apunta a una fila inexistente.
// Ninguno de los dos significa «se cayo la base»: los dos significan «hay datos ahi».

/** SQLSTATE de Postgres que significan «una FK impide esta operacion». */
const SQLSTATE_FK = new Set(["23001", "23503"]);

/**
 * `true` si el error dice que una clave foranea impidio la operacion, en CUALQUIERA de las formas
 * en que puede llegar:
 *   - la de Prisma: `PrismaClientKnownRequestError` con `code === "P2003"` (motor nativo, o si
 *     alguna version futura del adapter vuelve a traducirlo);
 *   - la del adapter: `DriverAdapterError` con `cause.code` en `SQLSTATE_FK`;
 *   - la mixta: un error de Prisma que trae el del driver colgando de `meta.driverAdapterError`.
 *
 * Cualquier otro error devuelve `false` y quien llama DEBE re-lanzarlo: tragarse un fallo
 * desconocido como si fuera «tiene datos» es exactamente el fallo mudo que este repo persigue.
 */
export function esViolacionDeClaveForanea(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return true;

  const codigo = sqlStateDe(error);
  return codigo !== null && SQLSTATE_FK.has(codigo);
}

/** Lee el SQLSTATE del error del driver, mire donde mire que este colgado. Acceso defensivo. */
function sqlStateDe(error: unknown): string | null {
  if (error == null || typeof error !== "object") return null;

  // Forma adapter: el `DriverAdapterError` cuelga el error de `pg` de su `cause`.
  const directo = codigoDe((error as Record<string, unknown>).cause);
  if (directo !== null) return directo;

  // Forma mixta: un error de Prisma que trae el del driver en `meta.driverAdapterError.cause`.
  const meta = (error as Record<string, unknown>).meta;
  if (meta == null || typeof meta !== "object") return null;
  const dae = (meta as Record<string, unknown>).driverAdapterError;
  if (dae == null || typeof dae !== "object") return null;
  return codigoDe((dae as Record<string, unknown>).cause);
}

function codigoDe(cause: unknown): string | null {
  if (cause == null || typeof cause !== "object") return null;
  const codigo = (cause as Record<string, unknown>).code;
  return typeof codigo === "string" ? codigo : null;
}
