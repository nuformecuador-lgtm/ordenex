import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { emitirWebhookSuscripcionPausada } from "@/lib/notificaciones/emitir";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 403 (T2, design §1.2/§4) — la migracion que anade el aviso a los DOS enums de
// `notificacion`, MAS **R12 medido contra Postgres**: una racha, un aviso; una racha nueva, otro.
//
// POR QUE ESTE ARCHIVO EXISTE, y es el molde literal de los de la 253, la 262, la 271 y la 333:
// en este repo anadir un valor a un enum de Postgres tiene trampa MEDIDA.
//
//  1. `ALTER TYPE ... DROP VALUE` NO EXISTE. El unico down posible es RECREAR el tipo con la lista
//     previa, y eso obliga a un `ALTER COLUMN ... TYPE` que DESTRUYE Y REHACE los indices de esa
//     columna. Uno de ellos, `notificacion_dedupe_key`, es UNICO, PARCIAL y con
//     `NULLS NOT DISTINCT` — y ese `NULLS NOT DISTINCT` es imprescindible AQUI: las dos filas de
//     una misma racha van dirigidas a un ROL, o sea con `destinatario_usuario_id = NULL` las dos;
//     sin el, Postgres las consideraria distintas y R12 se caeria en silencio.
//  2. Hay que mirar si el `down.sql` de la migracion que CREO los enums recrea-con-lista o solo
//     dropea. Aqui SOLO dropea (la 146 se lleva tambien las tablas), asi que aquel archivo NO se
//     toca. Y los de la 253, la 262, la 271 y la 333 SI recrean, cada uno con SU lista —«el enum
//     antes de MI migracion»—, que sigue siendo cierta: tampoco se tocan. Las CINCO cosas se
//     AFIRMAN abajo.
//  3. `notificacion_entidad_tipo` TAMBIEN se toca, y esa es la mitad que se olvida. Aqui hace
//     falta: la entidad del aviso es LA RACHA DE FALLOS —no la suscripcion (design §1.2)— y
//     ningun valor existente lo describe.
//
// ⚠️ Y LA CONSECUENCIA QUE UN DOWN RECREA-CON-LISTA TIENE: es una FOTO de su rama. Aplicado sobre
// una base que ya avanzo, borra en silencio los valores posteriores. Por eso el unico down que
// conoce la lista de HOY es el de ESTA migracion.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function carpetaQueTerminaEn(sufijo: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .find((n) => n.endsWith(sufijo));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${sufijo}`);
  return path.join(MIGRATIONS_DIR, dir);
}

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_webhook_suscripcion");
const dirCircuito = carpetaQueTerminaEn("_webhook_suscripcion_circuito");
const dir333 = carpetaQueTerminaEn("_notificacion_evento_gasto_fijo_cobro");
const dir271 = carpetaQueTerminaEn("_notificacion_evento_bloqueo_cierre");
const dir262 = carpetaQueTerminaEn("_notificacion_evento_dia_reparto_corregido");
const dir253 = carpetaQueTerminaEn("_notificacion_evento_postulacion_recurso");
const dir146 = carpetaQueTerminaEn("_notificacion");

const upSql = fs.readFileSync(path.join(dirNueva, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirNueva, "down.sql"), "utf8");
const down333 = fs.readFileSync(path.join(dir333, "down.sql"), "utf8");
const down271 = fs.readFileSync(path.join(dir271, "down.sql"), "utf8");
const down262 = fs.readFileSync(path.join(dir262, "down.sql"), "utf8");
const down253 = fs.readFileSync(path.join(dir253, "down.sql"), "utf8");
const down146 = fs.readFileSync(path.join(dir146, "down.sql"), "utf8");

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);
// Los downs anteriores se miden por su DDL, sin comentarios: sus cabeceras NOMBRAN los indices y
// los tipos al explicarse, y una asercion sobre el texto crudo mediria la prosa, no el SQL.
const down271Ddl = sinComentarios(down271);

/** `notificacion_evento` ANTES de esta migracion: 4 (146) + 1 (253) + 1 (262) + 2 (271) + 1 (333). */
const EVENTOS_PREVIOS = [
  "orden_rechazada",
  "carga_masiva_terminada",
  "postulacion_mensajero_pendiente",
  "cierre_dia_por_aprobar",
  "postulacion_recurso_pendiente",
  "dia_reparto_corregido",
  "cierre_dia_vencido",
  "mensajero_bloqueado_por_cierres",
  "gasto_fijo_cobro_pendiente",
];

/** `notificacion_entidad_tipo` ANTES de esta migracion: 4 (146) + 1 (253) + 1 (262) + 1 (333). */
const ENTIDADES_PREVIAS = [
  "orden",
  "usuario",
  "cierre_dia",
  "carga",
  "postulacion_recurso",
  "orden_dia_reparto_cambio",
  "gasto_fijo_cobro_dia",
];

const EVENTO_NUEVO = "webhook_suscripcion_pausada";
const ENTIDAD_NUEVA = "webhook_suscripcion_pausa";

function valoresDelCreateType(sql: string, tipo: string): string[] | null {
  const m = new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\)`).exec(sql);
  if (m === null) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("403/T2 — el UP de los enums es aditivo y no toca nada mas", () => {
  it("anade EXACTAMENTE los dos valores, con `IF NOT EXISTS`, y nada mas", () => {
    expect(upDdl).toMatch(
      new RegExp(`ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS '${EVENTO_NUEVO}'`),
    );
    expect(upDdl).toMatch(
      new RegExp(
        `ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS '${ENTIDAD_NUEVA}'`,
      ),
    );
    const sentencias = upDdl.split(";").filter((s) => s.trim().length > 0);
    expect(sentencias).toHaveLength(2);
  });

  it("el UP de los enums no crea tablas, no altera columnas y NO reescribe ninguna fila", () => {
    expect(upDdl).not.toMatch(/CREATE TABLE/i);
    expect(upDdl).not.toMatch(/ALTER TABLE/i);
    expect(upDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(upDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(upDdl).not.toMatch(/^\s*INSERT\s/im);
  });

  it("va SOLA y con timestamp POSTERIOR al de las columnas (55P04)", () => {
    // Postgres no permite USAR un valor de enum recien anadido en la transaccion que lo anadio, y
    // Prisma Migrate corre cada `migration.sql` en una. Que sean dos carpetas y en este orden no
    // es estetico.
    expect(path.basename(dirNueva) > path.basename(dirCircuito)).toBe(true);
  });
});

describe("403/T2 — el DOWN recrea con la lista de HOY y no borra nada", () => {
  it("⭑ recrea `notificacion_evento` con los NUEVE previos, en orden, y sin el nuevo", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_evento")).toEqual(EVENTOS_PREVIOS);
    expect(downDdl).not.toContain(EVENTO_NUEVO);
  });

  it("⭑ recrea `notificacion_entidad_tipo` con los SIETE previos, en orden, y sin el nuevo", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_entidad_tipo")).toEqual(ENTIDADES_PREVIAS);
    expect(downDdl).not.toContain(ENTIDAD_NUEVA);
  });

  it("lleva, para los DOS tipos, su RENAME, su ALTER COLUMN con USING y su DROP del `_old`", () => {
    for (const [tipo, columna] of [
      ["notificacion_evento", "evento"],
      ["notificacion_entidad_tipo", "entidad_tipo"],
    ]) {
      expect(downDdl).toMatch(new RegExp(`ALTER TYPE "${tipo}" RENAME TO "${tipo}_old"`));
      expect(downDdl).toMatch(new RegExp(`DROP TYPE "${tipo}_old"`));
      expect(downDdl).toMatch(
        new RegExp(
          `ALTER COLUMN "${columna}" TYPE "${tipo}"\\s*\\n?\\s*USING \\("${columna}"::text::"${tipo}"\\)`,
        ),
      );
    }
  });

  it("⭑ el down NO borra ni reescribe NINGUNA fila para «hacer sitio»", () => {
    // La precondicion ruidosa. Si quedaran filas con el valor nuevo, el `USING` debe fallar y
    // abortar el rollback: esas filas son el UNICO aviso de que un integrador lleva sin recibir
    // eventos —el silencio de cinco dias que esta ficha existe para romper—. Borrarlas en silencio
    // reproduciria la enfermedad.
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/);
    expect(downDdl).not.toMatch(/TRUNCATE/i);
  });
});

describe("403/T2 — los CINCO `down.sql` anteriores NO se tocan, y esta es la comprobacion", () => {
  it("⭑ el de la 146 SOLO dropea los dos tipos; no los recrea con lista", () => {
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_evento"/);
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_entidad_tipo"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_evento"/);
    for (const v of [EVENTO_NUEVO, ENTIDAD_NUEVA]) expect(down146).not.toContain(v);
  });

  it("⭑ el de la 253 recrea con SUS CUATRO valores en cada tipo, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down253, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 4));
    expect(valoresDelCreateType(down253, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 4),
    );
    expect(down253).not.toContain(EVENTO_NUEVO);
    expect(down253).not.toContain(ENTIDAD_NUEVA);
  });

  it("⭑ el de la 262 recrea con SUS CINCO valores en cada tipo, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down262, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 5));
    expect(valoresDelCreateType(down262, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 5),
    );
    expect(down262).not.toContain(EVENTO_NUEVO);
    expect(down262).not.toContain(ENTIDAD_NUEVA);
  });

  it("⭑ el de la 271 recrea SOLO `notificacion_evento` con SUS SEIS, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down271, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 6));
    expect(down271Ddl).not.toContain("notificacion_entidad_tipo");
    expect(down271).not.toContain(EVENTO_NUEVO);
  });

  it("⭑ el de la 333 recrea con SUS OCHO y SEIS, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down333, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 8));
    expect(valoresDelCreateType(down333, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 6),
    );
    expect(down333).not.toContain(EVENTO_NUEVO);
    expect(down333).not.toContain(ENTIDAD_NUEVA);
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("403/T2 — la base aplicada, y el DOWN ejercitado de verdad", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function valoresDe(tipo: string): Promise<string[]> {
    const filas = await prisma.$queryRawUnsafe<{ valores: string }[]>(
      `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1`,
      tipo,
    );
    return (filas[0]?.valores ?? "").split(",").filter((v) => v.length > 0);
  }

  it("la base tiene los ONCE eventos y los NUEVE entidad_tipo, con el de esta ficha y el posterior AL FINAL", async () => {
    // El orden (`enumsortorder`) es lo que demuestra que el valor se ANADIO y no que el tipo se
    // recreo por detras.
    //
    // ⚠️ AMPLIADA EL 2026-09-10 POR LA FICHA 401, y esa ampliacion ES el contrato en marcha: esta
    // lista lee la BASE APLICADA —el estado de HOY—, no una foto historica como las de los `down`
    // de arriba. La 401 entro DESPUES de esta ficha con
    // `20260910120000_notificacion_evento_geocodificacion_caida`, asi que la base tiene ahora un
    // evento y un `entidad_tipo` mas. Que este test se pusiera rojo es lo que obligo a mirarlo, que
    // es exactamente para lo que existe un inventario CERRADO: se AMPLIA a mano, no se relaja ni se
    // deriva del enum (una lista que se lee a si misma esta siempre verde y no dice nada).
    expect(await valoresDe("notificacion_evento")).toEqual([
      ...EVENTOS_PREVIOS,
      EVENTO_NUEVO,
      // FICHA 401 (design 3.3, 2026-09-10) - «el servicio de mapas esta rechazando nuestras
      // peticiones por un problema de configuracion de la cuenta». Lo emite `GeocodeSaludService`
      // desde la rama de configuracion del job de geocodificacion; va al `maestro` Y al `admin`.
      "geocodificacion_caida",
    ]);
    expect(await valoresDe("notificacion_entidad_tipo")).toEqual([
      ...ENTIDADES_PREVIAS,
      ENTIDAD_NUEVA,
      // FICHA 401 (design 3.3) - TERCER `entidad_tipo` que no apunta a una fila de tabla: la
      // entidad del aviso es LA JORNADA CR. Mismo argumento por el que esta ficha 403 eligio LA
      // RACHA y no la suscripcion.
      "geocodificacion_caida_dia",
    ]);
  });

  it("⭑ un aviso con el evento y la entidad nuevos se puede ESCRIBIR de verdad", async () => {
    const leido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const id = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "notificacion"
           ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
         VALUES ($1, 'warning'::"notificacion_tipo",
                 $2::"notificacion_evento",
                 'Un webhook lleva fallando y sus reintentos se espaciaron.',
                 $3::"notificacion_entidad_tipo", 'usr-x:2091-03-11T00:00:00.000Z',
                 'maestro'::"rol_value")`,
        id,
        EVENTO_NUEVO,
        ENTIDAD_NUEVA,
      );
      const filas = await tx.$queryRawUnsafe<{ evento: string; entidad: string }[]>(
        `SELECT "evento"::text AS evento, "entidad_tipo"::text AS entidad
           FROM "notificacion" WHERE "id" = $1`,
        id,
      );
      return filas[0];
    });
    expect(leido.evento).toBe(EVENTO_NUEVO);
    expect(leido.entidad).toBe(ENTIDAD_NUEVA);
  });

  it("⭑ el DOWN con una fila del evento nuevo ABORTA RUIDOSAMENTE (no borra nada)", async () => {
    // ES LA PRECONDICION DEL `down.sql`, EJERCITADA. Todo corre dentro de una transaccion que
    // SIEMPRE se revierte: el DDL tambien es transaccional en Postgres, asi que la base queda
    // exactamente como estaba.
    const sentencias = downDdl
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion"
             ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
           VALUES ($1, 'warning'::"notificacion_tipo",
                   '${EVENTO_NUEVO}'::"notificacion_evento",
                   'aviso sin leer', '${ENTIDAD_NUEVA}'::"notificacion_entidad_tipo",
                   'usr-x:2091-03-11T00:00:00.000Z', 'maestro'::"rol_value")`,
          randomUUID(),
        );
        for (const sentencia of sentencias) {
          await tx.$executeRawUnsafe(sentencia);
        }
      }),
    ).rejects.toThrow();
  });

  it("⭑ CONTROL: SIN filas del valor nuevo, ese MISMO down corre entero y el indice de dedupe SOBREVIVE", async () => {
    // Anti-vacuidad del caso anterior: sin este control, `rejects.toThrow()` pasaria aunque el
    // fallo viniera de cualquier otra cosa. Y de paso mide lo que importa — DESPUES de que el
    // `ALTER COLUMN ... TYPE` haya destruido y rehecho los indices de las dos columnas.
    const def = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await tx.$executeRawUnsafe(
        `DELETE FROM "notificacion"
          WHERE "evento"::text = $1 OR "entidad_tipo"::text = $2`,
        EVENTO_NUEVO,
        ENTIDAD_NUEVA,
      );
      for (const sentencia of downDdl
        .split(";")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)) {
        await tx.$executeRawUnsafe(sentencia);
      }
      const filas = await tx.$queryRawUnsafe<{ def: string }[]>(
        `SELECT indexdef AS def FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
      );
      return filas[0]?.def ?? "";
    });

    expect(def, "el down se llevo `notificacion_dedupe_key` por delante").not.toBe("");
    expect(def).toMatch(/CREATE UNIQUE INDEX/i);
    expect(def).toMatch(/NULLS NOT DISTINCT/i);
    expect(def).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
    expect(def).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);
  });

  it("⭑ y `notificacion_entidad_idx` sigue en pie tras el down", async () => {
    const def = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await tx.$executeRawUnsafe(
        `DELETE FROM "notificacion"
          WHERE "evento"::text = $1 OR "entidad_tipo"::text = $2`,
        EVENTO_NUEVO,
        ENTIDAD_NUEVA,
      );
      for (const sentencia of downDdl
        .split(";")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)) {
        await tx.$executeRawUnsafe(sentencia);
      }
      const filas = await tx.$queryRawUnsafe<{ def: string }[]>(
        `SELECT indexdef AS def FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'notificacion_entidad_idx'`,
      );
      return filas[0]?.def ?? "";
    });
    expect(def, "el down se llevo `notificacion_entidad_idx` por delante").not.toBe("");
    expect(def).toMatch(/\(entidad_tipo, entidad_id\)/);
  });
});

// ---------------------------------------------------------------------------
// R12 CONTRA POSTGRES — la mitad que un doble no puede demostrar.
//
// Lo que decide si el segundo aviso existe son DOS mecanismos del MOTOR:
//   1. `notificacion_dedupe_key` con `NULLS NOT DISTINCT` — es lo que hace que dos filas dirigidas
//      a un ROL (las dos con `destinatario_usuario_id = NULL`) colisionen. Sin el, Postgres las
//      trataria como distintas y R12 se caeria en silencio;
//   2. la guardia previa de `emitirFilas` (`existeNoLeidaPara`), que mira `notificacion_lectura`.
//
// Y sobre las dos se apoya la decision de diseño: **la entidad es LA RACHA, no la suscripcion**.
// ---------------------------------------------------------------------------

const OWNER = "usr-403-integrador";

/** Cuantos avisos de esta ficha hay para una racha concreta, dirigidos al rol `maestro`. */
async function avisosDeLaRacha(tx: TxDeTest, entidadId: string): Promise<number> {
  const filas = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n
       FROM "notificacion"
      WHERE "evento" = $1::"notificacion_evento"
        AND "entidad_id" = $2
        AND "destinatario_rol" = 'maestro'::"rol_value"`,
    EVENTO_NUEVO,
    entidadId,
  );
  return Number(filas[0].n);
}

describeSiHayBase("403/R12 — una racha produce UN solo aviso, por muchos fallos que tenga", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ tres intentos fallidos de la MISMA racha dejan UNA fila en la tabla", async () => {
    // El incidente medido tuvo 1.958 jobs muertos contra un solo destino. Sin esto, serian 1.958
    // avisos — y una campana con 1.958 avisos iguales es tan muda como no avisar.
    const racha = new Date("2091-03-11T10:00:00.000Z");
    const entidadId = `${OWNER}:${racha.toISOString()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx);
      const creadas: number[] = [];
      for (let i = 0; i < 3; i++) {
        creadas.push(
          await emitirWebhookSuscripcionPausada(
            repo,
            { ownerUsuarioId: OWNER, sinExitoDesde: racha },
            tx,
          ),
        );
      }
      return { creadas, filas: await avisosDeLaRacha(tx, entidadId) };
    });

    expect(r.creadas).toEqual([1, 0, 0]);
    expect(r.filas).toBe(1);
  });

  it("⭑ una racha NUEVA (tras recuperarse) SI avisa: es el caso que justifica el diseño", async () => {
    // Con la SUSCRIPCION como entidad, `notificacion_dedupe_key` mataria este segundo aviso en
    // silencio absoluto para siempre. Con la racha, `sinExitoDesde` cambia tras el 2xx ⇒ otra
    // entidad ⇒ aviso independiente (R12, segunda frase).
    const racha1 = new Date("2091-03-12T10:00:00.000Z");
    const racha2 = new Date("2091-04-20T08:30:00.000Z");
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx);
      const primera = await emitirWebhookSuscripcionPausada(
        repo,
        { ownerUsuarioId: OWNER, sinExitoDesde: racha1 },
        tx,
      );
      const segunda = await emitirWebhookSuscripcionPausada(
        repo,
        { ownerUsuarioId: OWNER, sinExitoDesde: racha2 },
        tx,
      );
      return {
        primera,
        segunda,
        r1: await avisosDeLaRacha(tx, `${OWNER}:${racha1.toISOString()}`),
        r2: await avisosDeLaRacha(tx, `${OWNER}:${racha2.toISOString()}`),
      };
    });

    expect(r.primera).toBe(1);
    expect(r.segunda).toBe(1);
    expect(r.r1).toBe(1);
    expect(r.r2).toBe(1);
  });

  it("⭑ CONTRAPRUEBA sobre el motor: la MISMA clave insertada dos veces a pelo, la rechaza el indice", async () => {
    // Sin esto, el primer caso podria estar pasando solo por la guardia previa de no-leidas y el
    // indice unico no estaria demostrando nada. Aqui se salta la guardia y se va directo al
    // `INSERT`: lo que rechaza la segunda fila es `notificacion_dedupe_key` con su
    // `NULLS NOT DISTINCT` — y es la prueba de que ese modificador sigue puesto.
    const entidadId = `${OWNER}:2091-03-13T10:00:00.000Z`;
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        for (let i = 0; i < 2; i++) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "notificacion"
               ("id","tipo","evento","descripcion","anexo","entidad_tipo","entidad_id","destinatario_rol")
             VALUES (gen_random_uuid()::text, 'warning'::"notificacion_tipo", $1::"notificacion_evento",
                     'Un webhook lleva fallando.', NULL,
                     '${ENTIDAD_NUEVA}'::"notificacion_entidad_tipo", $2,
                     'maestro'::"rol_value")`,
            EVENTO_NUEVO,
            entidadId,
          );
        }
      }),
    ).rejects.toThrow(/notificacion_dedupe_key/);
  });

  it("⭑ CONTROL: con entidades distintas (dos rachas), el MISMO `INSERT` a pelo entra dos veces", async () => {
    // El control positivo del caso anterior: si el `INSERT` fallara por cualquier otra cosa —una
    // columna mal escrita, un cast— aquel test seguiria en verde midiendo su propio ruido.
    const ids = [`${OWNER}:2091-03-14T10:00:00.000Z`, `${OWNER}:2091-03-15T10:00:00.000Z`];
    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      for (const entidadId of ids) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion"
             ("id","tipo","evento","descripcion","anexo","entidad_tipo","entidad_id","destinatario_rol")
           VALUES (gen_random_uuid()::text, 'warning'::"notificacion_tipo", $1::"notificacion_evento",
                   'Un webhook lleva fallando.', NULL,
                   '${ENTIDAD_NUEVA}'::"notificacion_entidad_tipo", $2,
                   'maestro'::"rol_value")`,
          EVENTO_NUEVO,
          entidadId,
        );
      }
      const r = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "notificacion"
          WHERE "evento" = $1::"notificacion_evento" AND "entidad_id" = ANY($2::text[])`,
        EVENTO_NUEVO,
        ids,
      );
      return Number(r[0].n);
    });

    expect(filas).toBe(2);
  });

  it("⭑ la fila que llega a la base es la que R9/R13 describen, y NO dice «desactiv»", async () => {
    const racha = new Date("2091-03-16T10:00:00.000Z");
    const fila = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await emitirWebhookSuscripcionPausada(
        new NotificacionRepository(tx),
        { ownerUsuarioId: OWNER, sinExitoDesde: racha },
        tx,
      );
      const filas = await tx.$queryRawUnsafe<
        {
          tipo: string;
          evento: string;
          descripcion: string;
          anexo: string | null;
          entidad_tipo: string;
          entidad_id: string | null;
          destinatario_rol: string | null;
          destinatario_usuario_id: string | null;
          tienda_id: string | null;
          zona_id: string | null;
        }[]
      >(
        `SELECT "tipo"::text AS tipo, "evento"::text AS evento, "descripcion", "anexo",
                "entidad_tipo"::text AS entidad_tipo, "entidad_id",
                "destinatario_rol"::text AS destinatario_rol, "destinatario_usuario_id",
                "tienda_id", "zona_id"
           FROM "notificacion"
          WHERE "evento" = $1::"notificacion_evento" AND "entidad_id" = $2`,
        EVENTO_NUEVO,
        `${OWNER}:${racha.toISOString()}`,
      );
      return filas[0];
    });

    expect(fila.tipo).toBe("warning"); // no `alert`: la suscripcion sigue viva
    expect(fila.entidad_tipo).toBe(ENTIDAD_NUEVA);
    expect(fila.entidad_id).toBe(`${OWNER}:${racha.toISOString()}`); // ⚠️ LA RACHA
    expect(fila.destinatario_rol).toBe("maestro");
    expect(fila.destinatario_usuario_id).toBeNull();
    expect(fila.anexo).toBeNull(); // R13: no hay hueco por el que colar un dato de mas
    expect(fila.tienda_id).toBeNull();
    expect(fila.zona_id).toBeNull();
    // R9, ultima frase, medido sobre lo que de verdad quedo escrito.
    expect(fila.descripcion).not.toMatch(/desactiv/i);
    // R13: ni la URL ni el secreto.
    expect(fila.descripcion).not.toMatch(/https?:\/\//);
    expect(fila.descripcion).not.toMatch(/ordx_whsec_/);
  });
});
