import { readFileSync } from "node:fs";
import { join } from "node:path";

// FICHA 461 / R74 (auditoria T2) — el SQL REAL de la migracion de datos que mueve +6 h los asientos de
// pago a tienda y a mensajero fechados a medianoche UTC, y su `down`, listos para ejecutarse contra
// filas SEMBRADAS en la base de test.
//
// No lleva lista ni control: su criterio es por DATOS (origen `pago_tienda`/`pago_mensajero` y hora
// exacta 00:00:00.000Z), asi que el texto se ejecuta TAL CUAL se va a desplegar. Lo unico que hace el
// fixture es leerlo una vez, normalizar los finales de linea y quitarle al `down` el `BEGIN;`/`COMMIT;`
// (dentro de la transaccion revertida de un test no se puede abrir otra).

const DIR = join(process.cwd(), "db/migrations/20260926120500_wallet_461_fechas_cr_pagos");
export const UP_FECHAS_CR_461 = readFileSync(join(DIR, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
export const DOWN_FECHAS_CR_461 = readFileSync(join(DIR, "down.sql"), "utf8").replace(/\r\n/g, "\n");

export const DOWN_FECHAS_CR_461_EN_TX = DOWN_FECHAS_CR_461.replace(/^\s*BEGIN;\s*$/m, "").replace(
  /^\s*COMMIT;\s*$/m,
  "",
);
