import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";

// FICHA 459 / T C.4 — el SQL REAL de la migracion de reclasificacion, listo para ejecutarse contra
// cobros SEMBRADOS en la base de test.
//
// Se lee el `migration.sql` (y el `down.sql`) tal como se desplegaran y se sustituyen SOLO los dos
// tramos marcados: la lista (`-- LISTA-INICIO`/`-- LISTA-FIN`) y las constantes de control
// (`-- CONTROL-INICIO`/`-- CONTROL-FIN`). Todo lo demas —comprobaciones, INSERT, ON CONFLICT,
// recuento final— es el texto de produccion. Los 203 ids aprobados no existen en una base de test:
// sin la sustitucion la migracion no escribiria nada (R83) y no probaria nada.
//
// Lo comparten `reclasificacion-459-migration.test.ts` (la migracion por si sola) y
// `caja-invariante-tiendas.test.ts` (R7/R8 tras reclasificar con ESTE SQL; revision m1).

const DIR = join(process.cwd(), "db/migrations/20260925120300_reclasificar_cobros_459");
export const UP_RECLASIFICACION_459 = readFileSync(join(DIR, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
export const DOWN_RECLASIFICACION_459 = readFileSync(join(DIR, "down.sql"), "utf8").replace(/\r\n/g, "\n");

export interface Aprobado {
  id: string;
  monto: string;
}

export interface ControlReclasificacion {
  n: number;
  suma: string;
  tienda: string;
}

function sustituir(texto: string, inicio: string, fin: string, nuevo: string): string {
  const i = texto.indexOf(inicio);
  const f = texto.indexOf(fin);
  if (i < 0 || f < i) throw new Error(`faltan las marcas ${inicio} / ${fin}`);
  return texto.slice(0, i + inicio.length) + "\n" + nuevo + "\n  " + texto.slice(f);
}

/** El `migration.sql` real con la lista y el control sustituidos. */
export function upCon(lista: Aprobado[], control: ControlReclasificacion): string {
  const valores = lista.map((a, i) => `    ('${a.id}', ${a.monto})${i === lista.length - 1 ? "" : ","}`).join("\n");
  const constantes = [
    `  n_esperados CONSTANT integer := ${control.n};`,
    `  suma_esperada CONSTANT numeric(14,2) := ${control.suma};`,
    `  tienda_aprobada CONSTANT text := '${control.tienda}';`,
  ].join("\n");
  return sustituir(
    sustituir(UP_RECLASIFICACION_459, "-- LISTA-INICIO", "-- LISTA-FIN", valores),
    "-- CONTROL-INICIO",
    "-- CONTROL-FIN",
    constantes,
  );
}

/** El `down.sql` real con la lista sustituida. */
export function downCon(lista: Aprobado[]): string {
  return sustituir(DOWN_RECLASIFICACION_459, "-- LISTA-INICIO", "-- LISTA-FIN", lista.map((a) => `    '${a.id}'`).join(",\n"));
}

export const sumaDe = (xs: Aprobado[]) =>
  xs.reduce((a, x) => a.add(new Prisma.Decimal(x.monto)), new Prisma.Decimal(0)).toFixed(2);
