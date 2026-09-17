import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { AsistenteUsoRepository } from "@/lib/repositories/AsistenteUsoRepository";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

/**
 * ⭑ FICHA 436 · R16 y R17 — EL CONTADOR, CONTRA POSTGRES DE VERDAD.
 *
 * ⚠️ POR QUÉ ESTO NO SE PUEDE PROBAR CON UN DOBLE, Y NO ES UNA PREFERENCIA. Lo que hace que el tope
 * sea un tope es el ÍNDICE ÚNICO `(usuario_id, fecha)` y el `ON CONFLICT DO UPDATE` que choca contra
 * él. Un doble no tiene índice: con un doble, `upsert` atómico y leer-y-luego-escribir se comportan
 * IGUAL, y la mutación que rompe el requisito pasaría en verde. Es la lección de «probar el WHERE
 * donde vive», medida cuatro veces en este repo.
 *
 * ⚠️ POR QUÉ NO SE USA UNA TRANSACCIÓN REVERTIDA. Una carrera no existe dentro de una sola
 * transacción: las dos «peticiones» verían la misma instantánea. Hacen falta DOS CONEXIONES QUE
 * COMMITEAN. Lo que se escribe se limpia a mano y va acotado a fechas centinela del año 2999, que
 * ninguna consulta real puede producir: el `DELETE` de limpieza no puede tocar un dato de verdad.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Fechas centinela. El año 2999 no lo produce `fechaCalendarioCR` de ninguna corrida real. */
const FECHA = "2999-01-02";
const FECHA_PRECALENTADO = "2999-01-04";
const FECHA_CARRERA = "2999-01-05";
const FECHA_NO_LO_SE = "2999-01-07";

describeSiHayBase("436/R16-R17 — asistente_uso_diario contra Postgres real", () => {
  let admin: PrismaClient;
  let clienteA: PrismaClient;
  let clienteB: PrismaClient;
  let usuarioId: string;

  const limpiar = () =>
    admin.$executeRawUnsafe(`DELETE FROM "asistente_uso_diario" WHERE "fecha" >= DATE '2999-01-01'`);

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    clienteA = crearPrismaDeTest();
    clienteB = crearPrismaDeTest();

    const alguien = await admin.usuario.findFirst({ select: { id: true } });
    // ⚠️ SE ROMPE RUIDOSAMENTE Y NO SE SALTA. Un `if (!alguien) return;` dejaría el archivo en
    // «passed» sin haber comprobado nada, que es el modo de fallo que este repo ya se comió.
    expect(alguien, "la base no tiene ni un usuario: no hay FK que satisfacer").not.toBeNull();
    usuarioId = alguien!.id;

    // Restos de una corrida que muriera a mitad. Acotado a las centinela: no puede tocar nada real.
    await limpiar();

    await clienteA.$queryRawUnsafe("SELECT 1");
    await clienteB.$queryRawUnsafe("SELECT 1");
  });

  afterAll(async () => {
    await limpiar();
    await clienteA?.$disconnect();
    await clienteB?.$disconnect();
    await admin?.$disconnect();
  });

  it("AUTOCOMPROBACIÓN: el índice único (usuario_id, fecha) existe en la tabla real", async () => {
    // Sin él, TODO este archivo saldría verde sin haber medido nada: dos inserciones entrarían tan
    // ricamente y la carrera de más abajo se quedaría sin propiedad que comprobar.
    const indices = await admin.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'asistente_uso_diario'`,
    );
    const unicos = indices.map((i) => i.indexdef).filter((d) => d.includes("UNIQUE"));
    expect(unicos.length).toBeGreaterThanOrEqual(1);
    expect(unicos.join(" ")).toMatch(/usuario_id.*fecha/);
  });

  it("AUTOCOMPROBACIÓN: la RLS está habilitada en la tabla (tabla nueva con datos de persona)", async () => {
    const filas = await admin.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
      `SELECT c.relrowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'asistente_uso_diario'`,
    );
    expect(filas[0]?.relrowsecurity).toBe(true);
  });

  it("⭑ R16 — cuenta por usuario y día, y el día que se guarda es el que se pidió", async () => {
    const repo = new AsistenteUsoRepository(clienteA);

    expect(await repo.consumirUnaConsulta(usuarioId, FECHA)).toBe(1);
    expect(await repo.consumirUnaConsulta(usuarioId, FECHA)).toBe(2);
    expect(await repo.consumirUnaConsulta(usuarioId, FECHA)).toBe(3);

    const filas = await admin.$queryRawUnsafe<{ dia: string; consultas: number }[]>(
      `SELECT to_char("fecha", 'YYYY-MM-DD') AS dia, "consultas"
         FROM "asistente_uso_diario" WHERE "usuario_id" = $1 AND "fecha" = $2::date`,
      usuarioId,
      FECHA,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].consultas).toBe(3);
    // ⚠️ La fecha LEÍDA DE LA BASE es la misma cadena que se pidió. Si el `Date` de JavaScript se
    // colara por el camino, aquí saldría el día anterior o el siguiente según el huso de la
    // máquina — y el tope se reiniciaría a deshora sin que nadie lo notara.
    expect(filas[0].dia).toBe(FECHA);
  });

  it("⭑ R16 — EL BORDE DE MEDIANOCHE de Costa Rica: 23:59 CR sigue siendo el día de ayer", async () => {
    // 2999-01-03T05:59Z son las 23:59 del 2 de enero en Costa Rica (UTC-6). Y 06:00Z ya es el 3.
    // El instante se convierte a día calendario con la MISMA función que usa producción.
    const casiMedianoche = fechaCalendarioCR(new Date("2999-01-03T05:59:00.000Z"));
    const yaEsOtroDia = fechaCalendarioCR(new Date("2999-01-03T06:00:00.000Z"));
    expect(casiMedianoche).toBe("2999-01-02");
    expect(yaEsOtroDia).toBe("2999-01-03");

    const repo = new AsistenteUsoRepository(clienteA);
    // La consulta de las 23:59 CR cae en la fila del día 2, que ya tiene 3 de la prueba anterior.
    expect(await repo.consumirUnaConsulta(usuarioId, casiMedianoche)).toBe(4);
    // Y la de un minuto después estrena fila: el tope se reinicia con el día de Costa Rica.
    expect(await repo.consumirUnaConsulta(usuarioId, yaEsOtroDia)).toBe(1);

    const filas = await admin.$queryRawUnsafe<{ dia: string; consultas: number }[]>(
      `SELECT to_char("fecha", 'YYYY-MM-DD') AS dia, "consultas"
         FROM "asistente_uso_diario"
        WHERE "usuario_id" = $1 AND "fecha" >= DATE '2999-01-01' AND "fecha" <= DATE '2999-01-03'
        ORDER BY "fecha"`,
      usuarioId,
    );
    expect(filas).toEqual([
      { dia: "2999-01-02", consultas: 4 },
      { dia: "2999-01-03", consultas: 1 },
    ]);
  });

  it("el índice MUERDE: dos filas del mismo usuario y día son imposibles", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `INSERT INTO "asistente_uso_diario" ("id","usuario_id","fecha","consultas")
         VALUES (gen_random_uuid()::text, $1, $2::date, 99)`,
        usuarioId,
        FECHA,
      ),
    ).rejects.toThrow();
  });

  it("⭑⭑ R17 — DOS CONSULTAS SIMULTÁNEAS, retenidas en la misma ventana, dejan `consultas = 2`", async () => {
    // ⚠️ POR QUÉ HACE FALTA LA BARRERA Y NO BASTA UN `Promise.all`. Medido en el repo con el cupo
    // de push: dos llamadas lanzadas a la vez se SERIALIZAN solas en esta máquina la mayoría de las
    // veces, y entonces leer-y-luego-escribir también daría 1 y 2. La barrera fuerza la ventana:
    // las dos llegan al `$queryRaw` y ninguna sigue hasta que están las dos.
    //
    // QUÉ MIDE, Y QUÉ PASA SI EL CÓDIGO CAMBIA:
    //
    //   upsert atómico (el bueno)  -> las dos sentencias corren a la vez; Postgres serializa por el
    //                                 lock de fila y la segunda suma sobre lo ya escrito -> {1,2}
    //                                 y la fila queda en 2. VERDE.
    //   leer-y-luego-escribir      -> las dos leen 0 antes de la barrera y las dos escriben 1 ->
    //                                 {1,1} y la fila queda en 1. ROJO.
    //
    // ⚠️⚠️ Y HACE FALTA UNA TERCERA COSA, QUE COSTÓ DESCUBRIRLA: **CALENTAR EL CAMINO ENTERO EN LAS
    // DOS CONEXIONES**. Medido el 2026-09-17 con la mutación puesta a propósito:
    //
    //   - con este archivo corrido ENTERO, `clienteA` llegaba a la carrera con sus sentencias ya
    //     preparadas en su conexión (las usó en los casos de R16) y `clienteB` no. La preparación
    //     de B cuesta un viaje de ida y vuelta extra, y en ese hueco A terminaba SUS DOS
    //     sentencias: salía {1,2} y la mutación SOBREVIVÍA EN VERDE;
    //   - corriendo sólo este caso (`-t`), B tampoco estaba preparado pero A tampoco, la ventana
    //     se abría de verdad y salía {1,1} — rojo.
    //
    // O sea que el veredicto dependía de qué OTROS casos hubieran corrido antes, que es la peor
    // clase de test: el que mide una cosa distinta según el día. Se calientan los dos con una
    // consulta REAL sobre una fecha aparte —las mismas sentencias, la misma tabla— y a partir de
    // ahí las dos conexiones parten iguales.
    await new AsistenteUsoRepository(clienteA).consumirUnaConsulta(usuarioId, FECHA_PRECALENTADO);
    await new AsistenteUsoRepository(clienteB).consumirUnaConsulta(usuarioId, FECHA_PRECALENTADO);

    const barrera = crearBarrera(2);
    const repoA = new AsistenteUsoRepository(conBarreraEnLaPrimeraConsulta(clienteA, barrera));
    const repoB = new AsistenteUsoRepository(conBarreraEnLaPrimeraConsulta(clienteB, barrera));

    const [a, b] = await Promise.all([
      repoA.consumirUnaConsulta(usuarioId, FECHA_CARRERA),
      repoB.consumirUnaConsulta(usuarioId, FECHA_CARRERA),
    ]);

    // Si la barrera se abrió por el tope de seguridad, la ventana no se forzó y el caso no midió
    // lo que dice medir: se falla nombrando la causa en vez de dar un verde que no vale.
    expect(barrera.abiertaPorLlegadas, "la barrera se abrió por timeout: no hubo ventana").toBe(
      true,
    );

    expect([a, b].sort((x, y) => x - y)).toEqual([1, 2]);

    const filas = await admin.$queryRawUnsafe<{ consultas: number; n: bigint }[]>(
      `SELECT "consultas", COUNT(*) OVER ()::bigint AS n
         FROM "asistente_uso_diario" WHERE "usuario_id" = $1 AND "fecha" = $2::date`,
      usuarioId,
      FECHA_CARRERA,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].consultas, "dos consultas simultáneas cuentan dos").toBe(2);
  });

  it("Q5 — `contarNoLoSe` mueve SU columna y no toca `consultas`", async () => {
    const repo = new AsistenteUsoRepository(clienteA);
    expect(await repo.consumirUnaConsulta(usuarioId, FECHA_NO_LO_SE)).toBe(1);
    await repo.contarNoLoSe(usuarioId, FECHA_NO_LO_SE);
    await repo.contarNoLoSe(usuarioId, FECHA_NO_LO_SE);

    const filas = await admin.$queryRawUnsafe<{ consultas: number; no_lo_se: number }[]>(
      `SELECT "consultas", "no_lo_se" FROM "asistente_uso_diario"
        WHERE "usuario_id" = $1 AND "fecha" = $2::date`,
      usuarioId,
      FECHA_NO_LO_SE,
    );
    expect(filas[0]).toEqual({ consultas: 1, no_lo_se: 2 });
  });

  it("Q5 — sin fila previa, `contarNoLoSe` no crea nada y no revienta", async () => {
    const repo = new AsistenteUsoRepository(clienteA);
    await expect(repo.contarNoLoSe(usuarioId, "2999-01-09")).resolves.toBeUndefined();
    const filas = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "asistente_uso_diario"
        WHERE "usuario_id" = $1 AND "fecha" = DATE '2999-01-09'`,
      usuarioId,
    );
    expect(Number(filas[0].n)).toBe(0);
  });

  it("R30 — la tabla NO tiene ninguna columna de texto libre donde quepa una conversación", async () => {
    // La mitad de esquema de R30, medida en la base y no en el modelo: un `ALTER TABLE ... ADD
    // COLUMN pregunta TEXT` aplicado a mano en producción se vería aquí.
    const columnas = await admin.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'asistente_uso_diario'
        ORDER BY ordinal_position`,
    );
    expect(columnas.map((c) => c.column_name)).toEqual([
      "id",
      "usuario_id",
      "fecha",
      "consultas",
      "no_lo_se",
      "created_at",
      "updated_at",
    ]);
    // Los dos únicos textos son identificadores, no contenido.
    expect(columnas.filter((c) => c.data_type === "text").map((c) => c.column_name)).toEqual([
      "id",
      "usuario_id",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// LA BARRERA
// ---------------------------------------------------------------------------------------------

interface Barrera {
  esperar(): Promise<void>;
  readonly abiertaPorLlegadas: boolean;
}

/**
 * Compuerta de N llegadas: nadie pasa hasta que han llegado todos.
 *
 * El tope de seguridad no es decoración: si una implementación futura dejara de llamar a
 * `$queryRaw` en uno de los caminos, sin él este archivo se colgaría hasta el timeout de vitest y
 * el rojo no diría por qué. Con él, la compuerta se abre, `abiertaPorLlegadas` queda en `false` y
 * el caso falla NOMBRANDO la causa.
 */
function crearBarrera(cuantos: number, topeMs = 10_000): Barrera {
  let llegadas = 0;
  let porLlegadas = false;
  let abrir: () => void = () => {};
  const compuerta = new Promise<void>((r) => {
    abrir = r;
  });
  const tope = setTimeout(() => abrir(), topeMs);
  tope.unref?.();
  return {
    get abiertaPorLlegadas() {
      return porLlegadas;
    },
    async esperar() {
      llegadas += 1;
      if (llegadas >= cuantos) {
        porLlegadas = true;
        clearTimeout(tope);
        abrir();
      }
      await compuerta;
    },
  };
}

/**
 * El cliente REAL con su PRIMERA consulta cruda retenida en la barrera, y todo lo demás intacto.
 *
 * ⚠️ LA BARRERA VA EN `$queryRaw` Y NO EN UNA FUNCIÓN CONCRETA, A PROPÓSITO: es el único punto por
 * el que pasan LAS DOS implementaciones —la buena (una sentencia) y la de comprobar-antes (un
 * `SELECT` y luego una escritura)—. Si estuviera en algo que sólo llama la mala, con el código
 * bueno nadie la ejecutaría y el caso moriría por timeout en vez de por su aserción.
 *
 * El `bind` es necesario: las funciones del cliente de Prisma necesitan su `this`, y devolverlas
 * desatadas del proxy las rompe en silencio (misma técnica que `clienteConSavepoint`).
 */
function conBarreraEnLaPrimeraConsulta(cliente: PrismaClient, barrera: Barrera): PrismaClient {
  let yaEspero = false;
  return new Proxy(cliente as object, {
    get(objetivo, prop) {
      if (prop === "$queryRaw") {
        const original = Reflect.get(objetivo, prop) as (...a: unknown[]) => Promise<unknown>;
        return async (...args: unknown[]) => {
          if (!yaEspero) {
            yaEspero = true;
            await barrera.esperar();
          }
          return original.apply(objetivo, args);
        };
      }
      const valor = Reflect.get(objetivo, prop) as unknown;
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  }) as PrismaClient;
}
