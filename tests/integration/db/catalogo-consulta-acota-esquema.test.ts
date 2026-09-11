import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import {
  HAY_BASE_DE_DATOS,
  SQL_ETIQUETAS_DE_ENUM,
  crearPrismaDeTest,
  etiquetasDeEnum,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 421 (R1, R2, R6) — EL CASO QUE REPRODUCE EL DEFECTO: DOS ESQUEMAS VIVOS A LA VEZ.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// EL DEFECTO NO SE VE CON UN TEST NORMAL, y por eso vivio hasta que enrojecio un gate de release.
// Solo aparece cuando existe, EN LA MISMA BASE, un segundo tipo con el mismo nombre. Eso pasa de
// verdad —29 archivos de esta carpeta se aislan creando un esquema temporal, y varios clonan ahi
// `notificacion_evento`— pero pasa por CONCURRENCIA: depende de quien corra al lado. El 2026-09-11
// dio «esperado 11, recibido 23 — cada etiqueta duplicada» en el gate, y 20 de 20 verdes en
// aislado.
//
// LO QUE HACE ESTE ARCHIVO: monta el escenario A PROPOSITO, con una CANARIA. Clona
// `notificacion_evento` en un esquema desechable **y le añade una etiqueta que `public` no tiene**.
// Entonces:
//   · la consulta REAL (`etiquetasDeEnum`, la que usan los doce archivos del enum) NO puede
//     devolver la canaria;
//   · la consulta VIEJA —la de antes de esta ficha, sin `pg_namespace`— SI la devuelve.
// La canaria es lo que hace el caso DETERMINISTA: no depende de cuantos esquemas haya vivos ni de
// que este corriendo en paralelo, que es justo lo que hacia indiagnosticable al original.
//
// ⚠️ LA BASE LOCAL ES COMPARTIDA entre worktrees. Este archivo NO escribe en `public`: crea su
// esquema, lo mide y lo suelta en un `finally` — tambien cuando el caso falla, que es el camino que
// se olvida y el que deja basura que pone en rojo la suite de otro.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const PREFIJO = "p421_";
const TIPO = "notificacion_evento";
const CANARIA = "canaria_solo_en_el_esquema_temporal_421";

/**
 * La consulta de antes de esta ficha, obtenida QUITANDOLE EL ARREGLO A LA DE VERDAD.
 *
 * No es una copia escrita a mano a proposito: una copia es una foto que se queda vieja el dia que
 * la consulta real cambie, y entonces el control estaria midiendo una consulta que ya no existe.
 * Asi el control es literalmente «la consulta real, mutada»: si el arreglo desaparece de
 * `_postgres-real.ts`, estas dos se vuelven la misma y el caso de control lo dice a gritos (lo
 * afirma la precondicion de abajo).
 */
const SQL_VIEJA_SIN_ESQUEMA = SQL_ETIQUETAS_DE_ENUM.split("\n")
  .filter((linea) => !linea.includes("pg_namespace"))
  .join("\n")
  .replace(" AND n.nspname = 'public'", "");

/** Los esquemas que ESTE proceso ha creado. Se sueltan pase lo que pase. */
const creados = new Set<string>();

function nombreDeEsquema(): string {
  // El sello de tiempo en base 36 va delante para que el barrido de huerfanos pueda ir POR EDAD.
  return `${PREFIJO}${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

/**
 * Crea un esquema desechable, se lo entrega a `fn` y lo SUELTA en un `finally`.
 *
 * El `finally` no es decorativo: si el cuerpo lanza —que es lo que pasa cuando el caso encuentra el
 * defecto, o cuando alguien mete una mutacion— el esquema tiene que irse igual. Un esquema
 * huerfano con un `notificacion_evento` dentro es EXACTAMENTE la condicion que provoca el rojo que
 * esta ficha arregla: dejarlo seria sembrar el fallo en la base de los demas.
 */
async function conEsquemaDesechable<T>(
  admin: PrismaClient,
  fn: (esquema: string) => Promise<T>,
): Promise<T> {
  const esquema = nombreDeEsquema();
  creados.add(esquema);
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
  try {
    return await fn(esquema);
  } finally {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    creados.delete(esquema);
  }
}

async function esquemasVivos(admin: PrismaClient, nombres: string[]): Promise<string[]> {
  if (nombres.length === 0) return [];
  const filas = await admin.$queryRawUnsafe<{ nspname: string }[]>(
    `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])`,
    nombres,
  );
  return filas.map((f) => f.nspname);
}

describeSiHayBase("FICHA 421 — la consulta al enum no se lleva por delante otro esquema", () => {
  let admin: PrismaClient;
  /** Las etiquetas de `public` ANTES de montar el escenario. */
  let referencia: string[];

  beforeAll(async () => {
    admin = crearPrismaDeTest();

    // Barrido de huerfanos de corridas ANTIGUAS (> 1 h). POR EDAD y no por prefijo a secas: dos
    // worktrees comparten esta base y un barrido ciego se llevaria el esquema de una corrida VIVA
    // a mitad de su medicion. (Idiom tomado de `push-cupo-carrera.test.ts`.)
    const previos = await admin.$queryRawUnsafe<{ nspname: string }[]>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE '${PREFIJO}%'`,
    );
    const haceUnaHora = Date.now() - 3_600_000;
    for (const { nspname } of previos) {
      const sello = Number.parseInt(nspname.slice(PREFIJO.length).split("_")[0], 36);
      if (Number.isNaN(sello) || sello >= haceUnaHora) continue;
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`);
    }

    referencia = await etiquetasDeEnum(admin, TIPO);
  });

  afterAll(async () => {
    // Cinturon y tirantes: si un `finally` no llego a correr, aqui se suelta igual.
    for (const esquema of creados) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    }
    creados.clear();
    await admin.$disconnect();
  });

  it("precondicion: el control ES la consulta real SIN el arreglo, no otra cosa", () => {
    expect(SQL_ETIQUETAS_DE_ENUM).toContain("n.nspname = 'public'");
    expect(SQL_VIEJA_SIN_ESQUEMA).not.toContain("nspname");
    expect(SQL_VIEJA_SIN_ESQUEMA).not.toBe(SQL_ETIQUETAS_DE_ENUM);
    // Y sigue siendo la MISMA consulta en todo lo demas: mismo catalogo, mismo filtro por nombre.
    expect(SQL_VIEJA_SIN_ESQUEMA).toContain("FROM pg_enum e");
    expect(SQL_VIEJA_SIN_ESQUEMA).toContain("t.typname = $1");
  });

  it("precondicion: el enum de `public` se lee, y sin etiquetas repetidas", () => {
    // Un enum de Postgres NO PUEDE tener etiquetas repetidas. Si esta lista las tiene, la consulta
    // esta viendo dos tipos — que es el sintoma exacto del 2026-09-11 (11 esperadas, 23 recibidas).
    expect(referencia.length, "no se pudo leer `notificacion_evento` de `public`").toBeGreaterThan(
      10,
    );
    expect(new Set(referencia).size, "el enum de `public` llego con etiquetas repetidas").toBe(
      referencia.length,
    );
    expect(referencia).not.toContain(CANARIA);
  });

  it("⭑ con un SEGUNDO `notificacion_evento` vivo en otro esquema, la lectura sigue dando la de `public` — ni una mas", async () => {
    await conEsquemaDesechable(admin, async (esquema) => {
      // El clon se construye LEYENDO el enum real: una lista escrita a mano aqui caducaria con la
      // siguiente ficha que anada un evento, y lo haria en silencio.
      const lista = [...referencia, CANARIA].map((v) => `'${v}'`).join(", ");
      await admin.$executeRawUnsafe(`CREATE TYPE "${esquema}"."${TIPO}" AS ENUM (${lista})`);

      // El escenario esta montado DE VERDAD: el segundo tipo existe y lleva la canaria.
      const enElTemporal = await admin.$queryRawUnsafe<{ etiqueta: string }[]>(
        `SELECT e.enumlabel AS etiqueta
           FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = $1 AND n.nspname = $2`,
        TIPO,
        esquema,
      );
      expect(
        enElTemporal.map((f) => f.etiqueta),
        "el clon no se creo: sin el, este caso no mide nada",
      ).toContain(CANARIA);

      // R1 — LA AFIRMACION DE LA FICHA.
      const acotada = await etiquetasDeEnum(admin, TIPO);
      expect(acotada, "la lectura se trajo la etiqueta del OTRO esquema").not.toContain(CANARIA);
      expect(new Set(acotada).size, "llegaron etiquetas repetidas: son dos tipos").toBe(
        acotada.length,
      );
      expect(acotada).toEqual(referencia);
    });
  });

  it("⭑ CONTROL — la consulta VIEJA, en ese mismo escenario, si se trae el otro esquema", async () => {
    // Anti-vacuidad del caso anterior. Sin esto, aquel pasaria igual en una base donde el segundo
    // esquema no se hubiera llegado a crear: un verde por vacio. Aqui se demuestra que el escenario
    // que el arreglo neutraliza es REAL, y se demuestra con la consulta literal que habia antes.
    await conEsquemaDesechable(admin, async (esquema) => {
      const lista = [...referencia, CANARIA].map((v) => `'${v}'`).join(", ");
      await admin.$executeRawUnsafe(`CREATE TYPE "${esquema}"."${TIPO}" AS ENUM (${lista})`);

      const filas = await admin.$queryRawUnsafe<{ etiqueta: string }[]>(
        SQL_VIEJA_SIN_ESQUEMA,
        TIPO,
      );
      const vieja = filas.map((f) => f.etiqueta);

      expect(vieja, "la consulta vieja NO vio el segundo tipo: el escenario no se monto").toContain(
        CANARIA,
      );
      // Y el sintoma exacto del gate: cada etiqueta DUPLICADA.
      expect(vieja.length).toBeGreaterThan(referencia.length);
      expect(new Set(vieja).size).toBeLessThan(vieja.length);
    });
  });

  it("R6 — el esquema desechable se suelta TAMBIEN cuando el cuerpo lanza", async () => {
    let nombre = "";
    await expect(
      conEsquemaDesechable(admin, async (esquema) => {
        nombre = esquema;
        await admin.$executeRawUnsafe(`CREATE TYPE "${esquema}"."${TIPO}" AS ENUM ('x')`);
        throw new Error("fallo simulado: el caso encontro el defecto, o alguien metio una mutacion");
      }),
    ).rejects.toThrow("fallo simulado");

    expect(nombre).not.toBe("");
    expect(await esquemasVivos(admin, [nombre]), "quedo un esquema huerfano en la base").toEqual([]);
  });

  it("R6 — al terminar, este archivo no deja ningun esquema suyo vivo", async () => {
    expect([...creados]).toEqual([]);
    const mios = await admin.$queryRawUnsafe<{ nspname: string }[]>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE '${PREFIJO}%'`,
    );
    // Los de ESTA corrida. Otro worktree podria tener el suyo vivo, y ese no es asunto de aqui.
    const recientes = mios
      .map((f) => f.nspname)
      .filter((n) => {
        const sello = Number.parseInt(n.slice(PREFIJO.length).split("_")[0], 36);
        return !Number.isNaN(sello) && sello >= Date.now() - 60_000;
      });
    expect(recientes.filter((n) => creados.has(n))).toEqual([]);
  });
});
