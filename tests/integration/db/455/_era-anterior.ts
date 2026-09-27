import fs from "node:fs";
import path from "node:path";

/**
 * FICHA 455 (T1.4, 2026-09-24) — ejecutar una migracion HISTORICA en el vocabulario de SU epoca.
 *
 * Las migraciones ya aplicadas no se editan nunca: su texto dice `'devuelta'`, `'rechazada'`… Los tests
 * que las reejecutan contra la base real (up → down → up dentro de una transaccion revertida) ya no
 * podrian hacerlo sobre una base migrada por la 455: el enum `gestion_resultado` ya no tiene esas
 * etiquetas y `order_status` ya no tiene esos `value`.
 *
 * Este helper envuelve la ejecucion: aplica los `down.sql` de M2 y M1 de la 455 (RENAME VALUE y UPDATE
 * de catalogo, ids y OIDs intactos), corre el SQL historico y vuelve a aplicar los `migration.sql` de M1
 * y M2. Todo en la transaccion del test, que se revierte. Lo que el test siembra y lee ANTES y DESPUES
 * lo hace con los codigos vigentes, igual que el resto de la suite.
 *
 * Si el SQL historico FALLA, se relanza el error original sin intentar restaurar (la transaccion ya esta
 * abortada en Postgres; se revierte entera al salir).
 */
const RAIZ = path.resolve(__dirname, "..", "..", "..", "..");
const leer = (carpeta: string, archivo: string) =>
  fs.readFileSync(path.join(RAIZ, "db", "migrations", carpeta, archivo), "utf8");

const M1 = "20260924120000_order_status_nombre_unico";
const M2 = "20260924120100_gestion_resultado_nombre_unico";

export const SQL_455 = {
  m1Up: leer(M1, "migration.sql"),
  m1Down: leer(M1, "down.sql"),
  m2Up: leer(M2, "migration.sql"),
  m2Down: leer(M2, "down.sql"),
};

interface EjecutaSql {
  $executeRawUnsafe(sql: string): Promise<unknown>;
}

/** Corre `sql` (una migracion anterior a la 455) con los codigos anteriores y restaura los vigentes. */
export async function enLaEraAnterior455(tx: EjecutaSql, sql: string): Promise<void> {
  await tx.$executeRawUnsafe(SQL_455.m2Down);
  await tx.$executeRawUnsafe(SQL_455.m1Down);
  await tx.$executeRawUnsafe(sql);
  await tx.$executeRawUnsafe(SQL_455.m1Up);
  await tx.$executeRawUnsafe(SQL_455.m2Up);
}
