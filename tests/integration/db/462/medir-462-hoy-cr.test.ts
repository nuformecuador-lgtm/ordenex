import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { PrismaClient } from "@prisma/client";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "../_postgres-real";
import { diaCR } from "../454/_escenario";

/**
 * FICHA 462 (R55) — el «hoy» del script de produccion `scripts/medir-462-retenidas.sql` ES el dia
 * calendario de Costa Rica, a cualquier hora y sea cual sea la zona horaria de la SESION.
 *
 * Por que existe (2026-09-25, cierre de la 461): el script decia
 * `((now() AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')::date`. Esa doble conversion NO
 * resta 6 h: `timestamptz AT TIME ZONE 'UTC'` da un `timestamp` sin zona y `timestamp AT TIME ZONE
 * 'America/Costa_Rica'` lo REINTERPRETA como hora de CR (suma 6 h); el `::date` se evalua despues en
 * la zona de la sesion. Medido en Postgres (sesion `America/Bogota`, 23:22 UTC): `hoy_cr` = MAÑANA.
 * Con sesion UTC (Supabase) se equivoca de 18:00 a 06:00 UTC, o sea de las 12:00 CR a medianoche CR.
 *
 * El sintoma fue un test que cambiaba de color con la hora: `reprogramadas-retenidas-sql-real` (R55:
 * `SUM(retenidas)` del script = `resumen.total` del servicio) verde por la mañana y rojo por la tarde
 * (`expected 16 to be 13`: el script contaba las siembras con fecha de MAÑANA). Un gate que solo pasa
 * a ciertas horas es un fallo mudo: por eso este archivo fija la expresion REAL del script (leida del
 * archivo, no copiada) contra el dia CR que calcula JS, cada 30 minutos durante dos dias y bajo tres
 * zonas de sesion distintas.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SCRIPT = fs.readFileSync(
  path.join(process.cwd(), "scripts", "medir-462-retenidas.sql"),
  "utf8",
);

/** La expresion de `hoy_cr` tal y como esta en el archivo (dentro del CTE `params`). */
function expresionHoyCr(): string {
  const sinComentarios = SCRIPT.split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const m = /SELECT\s+([\s\S]+?)\s+AS hoy_cr/.exec(sinComentarios);
  if (!m?.[1]) throw new Error("el script ya no define `hoy_cr` en su CTE `params`");
  return m[1];
}

/** La forma que tenia el script antes del arreglo: sirve de contraprueba (el arnes tiene que verla mal). */
const EXPRESION_ANTERIOR = "((now() AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')::date";

const ZONAS_DE_SESION = ["UTC", "America/Bogota", "America/Costa_Rica"] as const;
const DESDE = "2026-09-25 00:00:00+00";
const HASTA = "2026-09-26 23:30:00+00";

/** `instante` viaja como texto ISO en UTC: el driver no conserva el desfase de un `timestamptz`. */
type Fila = { instante: string; hoy: string };

describeSiHayBase("462/R55 — `hoy_cr` del script de produccion es el dia de Costa Rica", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * Evalua `expr` (con `now()` sustituido por cada instante de la rejilla) dentro de UNA transaccion
   * con la zona de sesion pedida. `::text` para recibir `YYYY-MM-DD` y no depender de como el driver
   * convierte un `date` a `Date`.
   */
  async function evaluar(expr: string, zona: string): Promise<Fila[]> {
    const conInstante = expr.replace(/now\(\)/g, "t");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL TimeZone = '${zona}'`);
      return tx.$queryRawUnsafe<Fila[]>(
        `SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS instante,
                (${conInstante})::text AS hoy
           FROM generate_series('${DESDE}'::timestamptz, '${HASTA}'::timestamptz, interval '30 minutes') AS t`,
      );
    });
  }

  const diaCrDeJs = (instante: string) => diaCR(0, new Date(instante)).toISOString().slice(0, 10);

  it("la expresion se lee del archivo real y no pasa `now()` por 'UTC' antes de ir a Costa Rica", () => {
    const expr = expresionHoyCr();
    expect(expr).toContain("America/Costa_Rica");
    // La trampa exacta que se arreglo: `now()` (timestamptz) convertido primero a `timestamp` UTC y
    // reinterpretado despues como hora de CR. Para las COLUMNAS (`timestamp` sin zona en UTC) la forma
    // doble es la correcta y sigue en el script (`solicitado_cr`): aqui solo se vigila `now()`.
    expect(expr).not.toMatch(/now\(\)\s*AT TIME ZONE\s*'UTC'/);
  });

  for (const zona of ZONAS_DE_SESION) {
    it(`cada 30 min durante 48 h, con la sesion en ${zona}: coincide con el dia CR de JS`, async () => {
      const filas = await evaluar(expresionHoyCr(), zona);
      expect(filas.length).toBe(96); // anti-vacuidad: 48 h / 30 min
      const distintas = filas
        .filter((f) => f.hoy !== diaCrDeJs(f.instante))
        .map((f) => `${f.instante} -> script ${f.hoy}, CR ${diaCrDeJs(f.instante)}`);
      expect(distintas, `instantes en los que el script se equivoca de dia:\n${distintas.join("\n")}`).toEqual([]);
    }, 60_000);
  }

  it("contraprueba: la expresion ANTERIOR se equivoca en parte del dia, y este arnes lo ve", async () => {
    const filas = await evaluar(EXPRESION_ANTERIOR, "UTC");
    const malas = filas.filter((f) => f.hoy !== diaCrDeJs(f.instante));
    // Con sesion UTC la forma vieja daba `date(now + 6 h)`: falla de 18:00 a 06:00 UTC, 24 de las 48
    // medias horas de cada dia. Si esto saliera vacio, el arnes estaria midiendo aire.
    expect(malas.length).toBe(48);
    for (const f of malas) {
      const h = new Date(f.instante).getUTCHours();
      expect(h >= 18 || h < 6, `hora UTC ${h} fuera de la ventana esperada`).toBe(true);
    }
  }, 60_000);
});
