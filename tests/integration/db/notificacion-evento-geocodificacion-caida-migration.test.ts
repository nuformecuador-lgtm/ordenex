import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { emitirGeocodificacionCaida } from "@/lib/notificaciones/emitir";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  soltarDependientesPosterioresDelEnumDeEventos,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 401 (T5, design §3.3) — la migración que añade el aviso a los DOS enums de `notificacion`,
// y las propiedades de dedupe que dependen de ella (**R9** y **R10**).
//
// POR QUÉ ESTE ARCHIVO EXISTE, y es el molde literal de los de la 253, la 262, la 271 y la 333: en
// este repo añadir un valor a un enum de Postgres tiene trampa MEDIDA.
//
//  1. `ALTER TYPE ... DROP VALUE` NO EXISTE. El único down posible es RECREAR el tipo con la lista
//     previa, y eso obliga a un `ALTER COLUMN ... TYPE` que DESTRUYE Y REHACE los índices de esa
//     columna. Uno de ellos, `notificacion_dedupe_key`, es ÚNICO, PARCIAL y con
//     `NULLS NOT DISTINCT` — y de ese índice depende R9 entero. Que sobreviva a la reconstrucción
//     NO SE SUPONE: se mide abajo, y DESPUÉS de correr el down, no sólo sobre la base tal cual.
//  2. Hay que mirar si el `down.sql` de la migración que CREÓ los enums recrea-con-lista o sólo
//     dropea. Aquí sólo dropea (la 146 se lleva también las tablas), así que ese archivo NO se
//     toca. Y los de la 253, la 262, la 271, la 333 y la 403 SÍ recrean, cada uno con SU lista
//     —«el enum antes de MI migración»—, que sigue siendo cierta: tampoco se tocan. Las SEIS cosas
//     se AFIRMAN abajo.
//     ⚠️ Y la contrapartida, que es la que estuvo mal hasta el 2026-09-10: el down de ESTA ficha
//     —el único que conoce «la lista de HOY»— SÍ tuvo que reescribirse cuando la 403 entró en
//     `dev` antes que ella. Ver la nota de `EVENTOS_PREVIOS`.
//  3. `notificacion_entidad_tipo` TAMBIÉN se toca, y esa es la mitad que se olvida: la entidad de
//     este aviso es LA JORNADA CR, y ningún valor existente la describe.

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

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_geocodificacion_caida");
const dirIndice = carpetaQueTerminaEn("_jobs_geocodificacion_salud_idx");
const dir333 = carpetaQueTerminaEn("_notificacion_evento_gasto_fijo_cobro");
const dir271 = carpetaQueTerminaEn("_notificacion_evento_bloqueo_cierre");
const dir262 = carpetaQueTerminaEn("_notificacion_evento_dia_reparto_corregido");
const dir253 = carpetaQueTerminaEn("_notificacion_evento_postulacion_recurso");
const dir403 = carpetaQueTerminaEn("_notificacion_evento_webhook_suscripcion");
const dir146 = carpetaQueTerminaEn("_notificacion");

const upSql = fs.readFileSync(path.join(dirNueva, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirNueva, "down.sql"), "utf8");
const upIndice = fs.readFileSync(path.join(dirIndice, "migration.sql"), "utf8");
const downIndice = fs.readFileSync(path.join(dirIndice, "down.sql"), "utf8");
const down333 = fs.readFileSync(path.join(dir333, "down.sql"), "utf8");
const down271 = fs.readFileSync(path.join(dir271, "down.sql"), "utf8");
const down262 = fs.readFileSync(path.join(dir262, "down.sql"), "utf8");
const down253 = fs.readFileSync(path.join(dir253, "down.sql"), "utf8");
const down403 = fs.readFileSync(path.join(dir403, "down.sql"), "utf8");
const down146 = fs.readFileSync(path.join(dir146, "down.sql"), "utf8");

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);
const upIndiceDdl = sinComentarios(upIndice);
const downIndiceDdl = sinComentarios(downIndice);
const down271Ddl = sinComentarios(down271);

// ⚠️ ESTAS DOS LISTAS SE REESCRIBIERON EL 2026-09-10, Y ESE ES EL PUNTO. Son «los enums ANTES de
// esta migración», y ANTES cambió: la **ficha 403** se mergeó en `dev` primero (PR #767, merge
// `9aba74cc`) y añadió sus dos valores a estos MISMOS dos enums. Con las listas de la versión
// anterior —nueve eventos y siete entidades, la foto de `origin/dev` @ `7a23c0f3`— el `down.sql`
// de esta ficha habría BORRADO EN SILENCIO `webhook_suscripcion_pausada` y
// `webhook_suscripcion_pausa` al revertir. Es el modo de fallo que este repo ya tiene documentado,
// y por eso el down se revisa AL MERGEAR y no al escribirlo.

/** `notificacion_evento` ANTES de esta migración: 4 (146) + 253 + 262 + 2 (271) + 333 + 403. */
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
  "webhook_suscripcion_pausada", // ficha 403 — entró en `dev` ANTES que esta ficha
];

/** `notificacion_entidad_tipo` ANTES de esta migración: 4 (146) + 253 + 262 + 333 + 403. */
const ENTIDADES_PREVIAS = [
  "orden",
  "usuario",
  "cierre_dia",
  "carga",
  "postulacion_recurso",
  "orden_dia_reparto_cambio",
  "gasto_fijo_cobro_dia",
  "webhook_suscripcion_pausa", // ficha 403 — entró en `dev` ANTES que esta ficha
];

const EVENTO_NUEVO = "geocodificacion_caida";
const ENTIDAD_NUEVA = "geocodificacion_caida_dia";

function valoresDelCreateType(sql: string, tipo: string): string[] | null {
  const m = new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\)`).exec(sql);
  if (m === null) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("401/T5 — el UP de los enums es aditivo y no toca nada más", () => {
  it("añade EXACTAMENTE los dos valores, con `IF NOT EXISTS`, y nada más", () => {
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

  it("R31: el UP no crea tablas, no altera columnas y NO reescribe ninguna fila", () => {
    expect(upDdl).not.toMatch(/CREATE TABLE/i);
    expect(upDdl).not.toMatch(/ALTER TABLE/i);
    expect(upDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(upDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(upDdl).not.toMatch(/^\s*INSERT\s/im);
  });

  it("va SOLA y con timestamp POSTERIOR al del índice (55P04)", () => {
    // Postgres no permite USAR un valor de enum recién añadido en la transacción que lo añadió, y
    // Prisma Migrate corre cada `migration.sql` en una. Que sean dos carpetas no es estética.
    expect(path.basename(dirNueva) > path.basename(dirIndice)).toBe(true);
  });

  it("R31: la migración del ÍNDICE no crea tabla ni columna, y trae su down", () => {
    expect(fs.existsSync(path.join(dirIndice, "down.sql"))).toBe(true);
    expect(fs.existsSync(path.join(dirNueva, "down.sql"))).toBe(true);
    expect(upIndiceDdl).not.toMatch(/CREATE TABLE/i);
    expect(upIndiceDdl).not.toMatch(/ADD COLUMN/i);
    expect(upIndiceDdl).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\s/im);
    // Es PARCIAL: sólo cubre las filas de `geocodificacion`, uno de los nueve tipos de job.
    expect(upIndiceDdl).toMatch(/CREATE INDEX IF NOT EXISTS "jobs_geocodificacion_estado_updated_idx"/);
    expect(upIndiceDdl).toMatch(/WHERE "tipo" = 'geocodificacion'/);
    expect(downIndiceDdl).toMatch(/DROP INDEX IF EXISTS "jobs_geocodificacion_estado_updated_idx"/);
  });
});

describe("401/T5 — el DOWN recrea con la lista de HOY y no borra nada", () => {
  it("⭑ recrea `notificacion_evento` con los DIEZ previos, en orden, y sin el nuevo", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_evento")).toEqual(EVENTOS_PREVIOS);
    expect(downDdl).not.toContain(EVENTO_NUEVO);
  });

  it("⭑ recrea `notificacion_entidad_tipo` con los OCHO previos, en orden, y sin el nuevo", () => {
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
    // La precondición ruidosa. Si quedaran filas con el valor nuevo, el `USING` debe fallar y
    // abortar el rollback: son avisos de que el servicio de mapas está caído por configuración
    // nuestra, que ni el maestro ni los admins tienen por qué haber leído — y el silencio de 19
    // horas es exactamente lo que esta ficha existe para romper.
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/);
    expect(downDdl).not.toMatch(/TRUNCATE/i);
  });
});

describe("401/T5 — los SEIS `down.sql` anteriores NO se tocan, y esta es la comprobación", () => {
  it("⭑ el de la 146 SÓLO dropea los dos tipos; no los recrea con lista", () => {
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_evento"/);
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_entidad_tipo"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_evento"/);
    for (const v of [EVENTO_NUEVO, ENTIDAD_NUEVA]) expect(down146).not.toContain(v);
  });

  it("⭑ el de la 253 recrea con SUS CUATRO en cada tipo, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down253, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 4));
    expect(valoresDelCreateType(down253, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 4),
    );
    expect(down253).not.toContain(EVENTO_NUEVO);
  });

  it("⭑ el de la 262 recrea con SUS CINCO en cada tipo, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down262, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 5));
    expect(valoresDelCreateType(down262, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 5),
    );
    expect(down262).not.toContain(EVENTO_NUEVO);
  });

  it("⭑ el de la 271 recrea SÓLO `notificacion_evento` con SUS SEIS, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down271, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 6));
    expect(down271Ddl).not.toContain("notificacion_entidad_tipo");
    expect(down271).not.toContain(EVENTO_NUEVO);
  });

  it("⭑ el de la 333 recrea los DOS con SUS OCHO y SUS SEIS, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down333, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 8));
    expect(valoresDelCreateType(down333, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 6),
    );
    expect(down333).not.toContain(EVENTO_NUEVO);
    expect(down333).not.toContain(ENTIDAD_NUEVA);
  });

  it("⭑ el de la 403 recrea los DOS con SUS NUEVE y SUS SIETE, y sigue siendo cierto", () => {
    // La 403 entró en `dev` el 2026-09-10, JUSTO ANTES que esta ficha. Su down es la foto de «los
    // enums antes de la 403» —nueve eventos y siete entidades—, que sigue siendo cierta: esta
    // ficha añade DESPUÉS, así que no la invalida. Es el archivo que NO se toca; el que sí tuvo
    // que reescribirse es el de aquí (ver la nota de `EVENTOS_PREVIOS`).
    expect(valoresDelCreateType(down403, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 9));
    expect(valoresDelCreateType(down403, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 7),
    );
    expect(down403).not.toContain(EVENTO_NUEVO);
    expect(down403).not.toContain(ENTIDAD_NUEVA);
  });

  it("⭑ y el de ESTA ficha SÍ los lista: revertir no puede llevarse los de la 403 por delante", () => {
    // LA MITAD QUE IMPORTA, y la que estuvo mal hasta el 2026-09-10. El down recrea-con-lista; si
    // la lista no incluyera los valores de la 403 —que ya estaban en `dev` cuando esta migración
    // se aplica—, revertirla los BORRARÍA EN SILENCIO. Se afirma por nombre, no por conteo.
    const eventos = valoresDelCreateType(downDdl, "notificacion_evento")!;
    const entidades = valoresDelCreateType(downDdl, "notificacion_entidad_tipo")!;
    expect(eventos).toContain("webhook_suscripcion_pausada");
    expect(entidades).toContain("webhook_suscripcion_pausa");
    // Y van ANTES del hueco que deja el valor de esta ficha: el orden del enum se conserva.
    expect(eventos[eventos.length - 1]).toBe("webhook_suscripcion_pausada");
    expect(entidades[entidades.length - 1]).toBe("webhook_suscripcion_pausa");
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Cuántos avisos de esta ficha hay para un día, por rol. */
async function avisosDelDia(tx: TxDeTest, diaCR: string): Promise<{ rol: string }[]> {
  return tx.$queryRawUnsafe<{ rol: string }[]>(
    `SELECT "destinatario_rol"::text AS rol
       FROM "notificacion"
      WHERE "evento" = $1::"notificacion_evento" AND "entidad_id" = $2
      ORDER BY "destinatario_rol"::text`,
    EVENTO_NUEVO,
    diaCR,
  );
}

describeSiHayBase("401/T5 — la base aplicada, y las dos propiedades de dedupe", () => {
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

  it("⭑ la base tiene los dos valores nuevos, y AÑADIDOS al final (no recreados por detrás)", async () => {
    // ⚠️ NO se compara contra una lista literal cerrada: la base local es COMPARTIDA entre
    // worktrees y puede traer ya los valores de OTRA ficha en curso (medido el 2026-09-09: la 403
    // tenía sus dos migraciones aplicadas aquí sin estar mergeada en `dev`). Lo que sí es cierto
    // pase lo que pase: los previos siguen estando, en su orden, y el nuevo va DESPUÉS de todos
    // ellos — que es lo que demuestra que se AÑADIÓ con `ADD VALUE` y no que el tipo se recreó.
    const eventos = await valoresDe("notificacion_evento");
    const entidades = await valoresDe("notificacion_entidad_tipo");

    expect(eventos.slice(0, EVENTOS_PREVIOS.length)).toEqual(EVENTOS_PREVIOS);
    expect(entidades.slice(0, ENTIDADES_PREVIAS.length)).toEqual(ENTIDADES_PREVIAS);
    expect(eventos).toContain(EVENTO_NUEVO);
    expect(entidades).toContain(ENTIDAD_NUEVA);
    expect(eventos.indexOf(EVENTO_NUEVO)).toBeGreaterThan(
      eventos.indexOf("gasto_fijo_cobro_pendiente"),
    );
    expect(entidades.indexOf(ENTIDAD_NUEVA)).toBeGreaterThan(
      entidades.indexOf("gasto_fijo_cobro_dia"),
    );
  });

  it("⭑ R7: una emisión deja DOS filas en la base, `maestro` y `admin`, con el MISMO texto", async () => {
    const dia = "2091-04-08"; // fecha lejana: no puede colisionar con datos reales
    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await emitirGeocodificacionCaida(new NotificacionRepository(tx), { afectados: 25, diaCR: dia }, tx);
      return tx.$queryRawUnsafe<
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
          WHERE "evento" = $1::"notificacion_evento" AND "entidad_id" = $2
          ORDER BY "created_at" ASC, "destinatario_rol"::text DESC`,
        EVENTO_NUEVO,
        dia,
      );
    });

    expect(filas, "no se escribió ninguna fila: el test no está midiendo nada").toHaveLength(2);
    expect(filas.map((f) => f.destinatario_rol)).toEqual(["maestro", "admin"]);
    expect(filas[0].descripcion).toBe(filas[1].descripcion);
    for (const fila of filas) {
      expect(fila.tipo).toBe("alert");
      expect(fila.entidad_tipo).toBe(ENTIDAD_NUEVA);
      expect(fila.entidad_id).toBe(dia); // ⚠️ LA JORNADA
      expect(fila.anexo).toBeNull();
      expect(fila.destinatario_usuario_id).toBeNull();
      expect(fila.tienda_id).toBeNull();
      expect(fila.zona_id).toBeNull();
    }
  });

  it("⭑ R9: dos emisiones el MISMO día CR dejan DOS filas en total, no cuatro", async () => {
    const dia = "2091-04-09";
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx);
      const primera = await emitirGeocodificacionCaida(repo, { afectados: 3, diaCR: dia }, tx);
      // El drenador corre CADA MINUTO: la segunda evaluación es lo normal, no lo raro.
      const segunda = await emitirGeocodificacionCaida(repo, { afectados: 7, diaCR: dia }, tx);
      return { primera, segunda, filas: await avisosDelDia(tx, dia) };
    });

    expect(r.primera).toBe(2);
    expect(r.segunda).toBe(0);
    expect(r.filas.map((f) => f.rol)).toEqual(["admin", "maestro"]);
  });

  // ⚠️ POR QUÉ EL CASO «CON LA DEL MAESTRO YA LEÍDA» SE MIDE EN DOS PIEZAS Y NO DE UNA.
  //
  // En PRODUCCIÓN la tercera emisión no crea nada por DOS barreras distintas: la del `admin`, sin
  // leer, la salta la guardia previa (`existeNoLeidaPara`); la del `maestro`, ya leída, la rechaza
  // el índice único, y `NotificacionRepository.crear` ABSORBE ese `P2002` devolviendo `false`.
  // Ahí cada sentencia va en su propia transacción, así que el rechazo no arrastra nada.
  //
  // Dentro de una transacción —que es como escriben estos tests para no dejar filas en la base
  // COMPARTIDA— eso no se puede reproducir de una pieza: Postgres ABORTA la transacción entera con
  // la violación del índice, y la guardia del `admin` ya no llega a ejecutarse. Medido: el intento
  // de hacerlo de una vez muere con «transacción abortada, las órdenes serán ignoradas».
  //
  // Así que se miden las DOS barreras, cada una donde es observable. Lo que NO se hace es aflojar
  // la aserción hasta que pase: eso dejaría R9 sin evidencia.

  it("⭑ R9 (barrera 1): leer la del `maestro` NO desactiva la guardia de la del `admin`", async () => {
    // `destinatario_rol` está DENTRO de la clave de dedupe, así que los dos roles se deduplican de
    // forma INDEPENDIENTE: que uno lea la suya no puede suprimir la del otro — el fallo mudo que
    // design §9 nombra (la fila del admin se pierde y nadie lo nota porque el maestro sí la ve).
    const dia = "2091-04-10";
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx);
      await emitirGeocodificacionCaida(repo, { afectados: 3, diaCR: dia }, tx);

      const usuarios = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "usuario" LIMIT 1`);
      // ⚠️ FALLA RUIDOSAMENTE si no hay a quién atribuir la lectura. Un `if (!usuario) return;`
      // dejaría este test reportando `passed` sin haber comprobado nada.
      expect(usuarios.length, "no hay ningún usuario en la base: el caso no se puede medir").toBe(1);

      const maestra = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "notificacion"
          WHERE "evento" = $1::"notificacion_evento" AND "entidad_id" = $2
            AND "destinatario_rol" = 'maestro'::"rol_value"`,
        EVENTO_NUEVO,
        dia,
      );
      expect(maestra).toHaveLength(1);
      await tx.$executeRawUnsafe(
        `INSERT INTO "notificacion_lectura" ("id","notificacion_id","usuario_id","leida_at")
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        randomUUID(),
        maestra[0].id,
        usuarios[0].id,
      );

      return {
        // El `maestro` YA la leyó: su guardia previa deja de proteger, y a partir de aquí quien
        // impide el duplicado es el índice único (barrera 2, el caso de abajo).
        maestroSigueSinLeer: await repo.existeNoLeidaPara(
          EVENTO_NUEVO,
          dia,
          { tipo: "rol", rol: "maestro" },
          tx,
        ),
        // El `admin` NO: su aviso sigue vivo y sin leer, y la guardia lo protege.
        adminSigueSinLeer: await repo.existeNoLeidaPara(
          EVENTO_NUEVO,
          dia,
          { tipo: "rol", rol: "admin" },
          tx,
        ),
        filas: await avisosDelDia(tx, dia),
      };
    });

    expect(r.maestroSigueSinLeer).toBe(false);
    expect(r.adminSigueSinLeer).toBe(true);
    expect(r.filas.map((f) => f.rol)).toEqual(["admin", "maestro"]); // las dos siguen ahí
  });

  it("⭑ R9 (barrera 2): con la del `maestro` ya leída, el ÍNDICE ÚNICO rechaza la repetida", async () => {
    // Aquí se salta la guardia previa a propósito y se va directo al `INSERT`, que es lo que
    // `crear` hace cuando aquella no protege. Lo que rechaza la fila es `notificacion_dedupe_key`
    // —y su `P2002` es el que el repositorio absorbe devolviendo `false`, sin crear nada—.
    const dia = "2091-04-16";
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        await emitirGeocodificacionCaida(
          new NotificacionRepository(tx),
          { afectados: 3, diaCR: dia },
          tx,
        );
        const usuarios = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT "id" FROM "usuario" LIMIT 1`,
        );
        expect(usuarios.length, "no hay ningún usuario en la base").toBe(1);
        const maestra = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT "id" FROM "notificacion"
            WHERE "evento" = $1::"notificacion_evento" AND "entidad_id" = $2
              AND "destinatario_rol" = 'maestro'::"rol_value"`,
          EVENTO_NUEVO,
          dia,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion_lectura" ("id","notificacion_id","usuario_id","leida_at")
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
          randomUUID(),
          maestra[0].id,
          usuarios[0].id,
        );
        // La repetida del `maestro`, ya leída la primera.
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion"
             ("id","tipo","evento","descripcion","anexo","entidad_tipo","entidad_id","destinatario_rol")
           VALUES (gen_random_uuid()::text, 'alert'::"notificacion_tipo", $1::"notificacion_evento",
                   'aviso de prueba', NULL, $2::"notificacion_entidad_tipo", $3,
                   'maestro'::"rol_value")`,
          EVENTO_NUEVO,
          ENTIDAD_NUEVA,
          dia,
        );
      }),
    ).rejects.toThrow(/notificacion_dedupe_key/);
  });

  it("⭑ R10: dos jornadas CR distintas dejan CUATRO filas, aunque las de la primera sigan sin leer", async () => {
    // ESTE ES EL CASO QUE LA ELECCIÓN DE ENTIDAD EXISTE PARA SALVAR. El corte medido cruzó la
    // medianoche (8-sep 19:40 → 9-sep 15:35): con una entidad que no cambiara entre jornadas, el
    // aviso del 9-sep no habría existido NUNCA, en silencio absoluto.
    const dia1 = "2091-04-11";
    const dia2 = "2091-04-12";
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx);
      const primera = await emitirGeocodificacionCaida(repo, { afectados: 25, diaCR: dia1 }, tx);
      const segunda = await emitirGeocodificacionCaida(repo, { afectados: 23, diaCR: dia2 }, tx);
      return {
        primera,
        segunda,
        dia1: await avisosDelDia(tx, dia1),
        dia2: await avisosDelDia(tx, dia2),
      };
    });

    expect(r.primera).toBe(2);
    expect(r.segunda).toBe(2); // el aviso de la jornada siguiente es ESTRUCTURAL
    expect(r.dia1.map((f) => f.rol)).toEqual(["admin", "maestro"]);
    expect(r.dia2.map((f) => f.rol)).toEqual(["admin", "maestro"]);
  });

  it("⭑ CONTRAPRUEBA sobre el motor: la MISMA clave insertada dos veces a pelo la rechaza el índice", async () => {
    // Sin esto, R9 podría estar pasando sólo por la guardia previa de no-leídas y el índice único
    // no estaría demostrando nada. Aquí se salta la guardia y se va directo al `INSERT`: lo que
    // rechaza la segunda fila es `notificacion_dedupe_key`, con su `NULLS NOT DISTINCT`.
    const dia = "2091-04-13";
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        for (let i = 0; i < 2; i++) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "notificacion"
               ("id","tipo","evento","descripcion","anexo","entidad_tipo","entidad_id","destinatario_rol")
             VALUES (gen_random_uuid()::text, 'alert'::"notificacion_tipo", $1::"notificacion_evento",
                     'aviso de prueba', NULL, $2::"notificacion_entidad_tipo", $3,
                     'maestro'::"rol_value")`,
            EVENTO_NUEVO,
            ENTIDAD_NUEVA,
            dia,
          );
        }
      }),
    ).rejects.toThrow(/notificacion_dedupe_key/);
  });

  it("⭑ CONTROL: con DOS ROLES distintos, el mismo `INSERT` a pelo entra las dos veces", async () => {
    // El control positivo del caso anterior —si el `INSERT` fallara por otra cosa, aquel test
    // estaría verde midiendo su propio ruido— y, a la vez, la prueba de que `destinatario_rol`
    // está DENTRO de la clave: por eso los dos destinatarios conviven.
    const dia = "2091-04-14";
    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      for (const rol of ["maestro", "admin"]) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion"
             ("id","tipo","evento","descripcion","anexo","entidad_tipo","entidad_id","destinatario_rol")
           VALUES (gen_random_uuid()::text, 'alert'::"notificacion_tipo", $1::"notificacion_evento",
                   'aviso de prueba', NULL, $2::"notificacion_entidad_tipo", $3, $4::"rol_value")`,
          EVENTO_NUEVO,
          ENTIDAD_NUEVA,
          dia,
          rol,
        );
      }
      return (await avisosDelDia(tx, dia)).map((f) => f.rol);
    });

    expect(filas).toEqual(["admin", "maestro"]);
  });
});

describeSiHayBase("401/T5 — el DOWN ejercitado de verdad, con su precondición", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const sentenciasDelDown = () =>
    downDdl
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

  /**
   * Aparta, DENTRO de la transacción revertida, toda fila cuyo valor de enum NO figure en las
   * listas que este `down.sql` recrea. Es su precondición dicha en código.
   *
   * ⚠️ NO es sólo por los valores de esta ficha. La base local es COMPARTIDA entre worktrees y el
   * 2026-09-09 ya traía aplicados los dos valores de OTRA ficha en curso (la 403) que este down
   * —foto de `origin/dev`, donde esa ficha NO está mergeada— no lista. El rollback real se hará
   * contra una base donde ese orden ya esté resuelto (design §3.3); aquí lo que se mide es que el
   * DDL corre entero y que el índice de dedupe SOBREVIVE.
   */
  async function apartarFilasConValoresNoListados(tx: TxDeTest): Promise<void> {
    const eventos = valoresDelCreateType(downDdl, "notificacion_evento")!;
    const entidades = valoresDelCreateType(downDdl, "notificacion_entidad_tipo")!;
    await tx.$executeRawUnsafe(
      `DELETE FROM "notificacion"
        WHERE NOT ("evento"::text = ANY($1::text[])) OR NOT ("entidad_tipo"::text = ANY($2::text[]))`,
      eventos,
      entidades,
    );
  }

  it("⭑ el DOWN con una fila del evento nuevo ABORTA RUIDOSAMENTE (y no borra nada)", async () => {
    // ES LA PRECONDICIÓN DEL `down.sql`, EJERCITADA. Todo corre dentro de una transacción que
    // SIEMPRE se revierte: el DDL también es transaccional en Postgres, así que la base queda
    // exactamente como estaba.
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        await apartarFilasConValoresNoListados(tx);
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion"
             ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
           VALUES ($1, 'alert'::"notificacion_tipo", $2::"notificacion_evento",
                   'aviso sin leer', $3::"notificacion_entidad_tipo", '2091-04-15',
                   'maestro'::"rol_value")`,
          randomUUID(),
          EVENTO_NUEVO,
          ENTIDAD_NUEVA,
        );
        // FICHA 410: `push_envio_dia.evento` usa este mismo enum, y su migracion es POSTERIOR.
        // En el rollback REAL la tabla ya no existe cuando a este down le llega el turno; aqui
        // se ejecuta contra la base de HOY, asi que hay que ponerla en ese estado o el
        // `DROP TYPE ..._old` muere con 2BP01 por una dependencia que el rollback no tendria.
        await soltarDependientesPosterioresDelEnumDeEventos(tx);

        for (const sentencia of sentenciasDelDown()) await tx.$executeRawUnsafe(sentencia);
      }),
    ).rejects.toThrow();
  });

  it("⭑ CONTROL: sin filas de los valores nuevos, ese MISMO down corre entero y el índice SOBREVIVE", async () => {
    // Anti-vacuidad del caso anterior: sin este control, `rejects.toThrow()` pasaría aunque el
    // fallo viniera de cualquier otra cosa. Y de paso mide lo que importa — DESPUÉS de que el
    // `ALTER COLUMN ... TYPE` haya destruido y rehecho los índices de las dos columnas.
    const def = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await apartarFilasConValoresNoListados(tx);
      // FICHA 410: `push_envio_dia.evento` usa este mismo enum, y su migracion es POSTERIOR.
      // En el rollback REAL la tabla ya no existe cuando a este down le llega el turno; aqui
      // se ejecuta contra la base de HOY, asi que hay que ponerla en ese estado o el
      // `DROP TYPE ..._old` muere con 2BP01 por una dependencia que el rollback no tendria.
      await soltarDependientesPosterioresDelEnumDeEventos(tx);

      for (const sentencia of sentenciasDelDown()) await tx.$executeRawUnsafe(sentencia);
      const filas = await tx.$queryRawUnsafe<{ def: string }[]>(
        `SELECT indexdef AS def FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
      );
      return filas[0]?.def ?? "";
    });

    expect(def, "el down se llevó `notificacion_dedupe_key` por delante").not.toBe("");
    expect(def).toMatch(/CREATE UNIQUE INDEX/i);
    expect(def).toMatch(/NULLS NOT DISTINCT/i);
    expect(def).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
    expect(def).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);
  });

  it("⭑ y sobre la base TAL CUAL está, `notificacion_dedupe_key` sigue intacto tras el UP", async () => {
    const filas = await prisma.$queryRawUnsafe<{ def: string }[]>(
      `SELECT indexdef AS def FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
    );
    const def = filas[0]?.def ?? "";
    expect(def, "no existe `notificacion_dedupe_key`").not.toBe("");
    expect(def).toMatch(/NULLS NOT DISTINCT/i);
    expect(def).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
  });

  it("⭑ el índice PARCIAL de `jobs` existe en la base y es el que declara su migración", async () => {
    const filas = await prisma.$queryRawUnsafe<{ def: string }[]>(
      `SELECT indexdef AS def FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'jobs_geocodificacion_estado_updated_idx'`,
    );
    const def = filas[0]?.def ?? "";
    expect(def, "no existe `jobs_geocodificacion_estado_updated_idx`").not.toBe("");
    expect(def).toMatch(/\(estado, updated_at\)/);
    expect(def).toMatch(/WHERE \(tipo = 'geocodificacion'::job_tipo\)/);
  });
});
