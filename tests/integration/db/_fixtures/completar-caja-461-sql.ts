import { readFileSync } from "node:fs";
import { join } from "node:path";

// FICHA 461 / T B.11 — el SQL REAL de la migracion de datos que COMPLETA la linea de caja de los
// cobros previos, y su `down`, listos para ejecutarse contra cobros SEMBRADOS en la base de test.
//
// A diferencia de la reclasificacion de la 459, esta migracion NO lleva lista: su criterio es por
// DATOS (todo `debito/cobro_manual` sin salida reclasificada y sin linea de cobro), asi que el texto
// se ejecuta TAL CUAL se va a desplegar, sin sustituir nada. Lo unico que hace el fixture es leerlo
// una vez y normalizar los finales de linea (el checkout en Windows es CRLF; Postgres no lo nota, pero
// las aserciones sobre el texto si).
//
// Lo comparten `cobro-tienda-461-completar-migration.test.ts` (la migracion por si sola) y
// `caja-invariante-tiendas.test.ts` (R7/R8 tras completar con ESTE SQL).

const DIR = join(process.cwd(), "db/migrations/20260926120200_cobro_tienda_461_completar_caja");
export const UP_COMPLETAR_461 = readFileSync(join(DIR, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
export const DOWN_COMPLETAR_461 = readFileSync(join(DIR, "down.sql"), "utf8").replace(/\r\n/g, "\n");

/**
 * El `down.sql` SIN el `BEGIN;`/`COMMIT;` de fuera: dentro de la transaccion revertida de un test no
 * se puede abrir otra. Lo que queda es el bloque `DO` de la precondicion y el `DELETE`, que es todo
 * lo que el `down` hace.
 */
export const DOWN_COMPLETAR_461_EN_TX = DOWN_COMPLETAR_461.replace(/^\s*BEGIN;\s*$/m, "").replace(
  /^\s*COMMIT;\s*$/m,
  "",
);
