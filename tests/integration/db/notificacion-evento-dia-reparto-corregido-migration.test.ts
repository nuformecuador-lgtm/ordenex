import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// FEATURE 262 (B22, D7) — la migracion que anade el aviso «te corrigieron el dia de reparto» a los
// DOS enums de la campana (`notificacion_evento` y `notificacion_entidad_tipo`).
//
// POR QUE ESTE ARCHIVO EXISTE, y es el molde literal del de la 253: en este repo anadir un valor a
// un enum de Postgres tiene trampa MEDIDA.
//
//  1. `ALTER TYPE ... DROP VALUE` NO EXISTE. El unico down posible es RECREAR el tipo con la lista
//     previa, y eso obliga a un `ALTER COLUMN ... TYPE` sobre `notificacion.evento` y
//     `notificacion.entidad_tipo`, que DESTRUYE Y REHACE los indices de esas columnas. Uno de
//     ellos, `notificacion_dedupe_key`, es UNICO, PARCIAL y con `NULLS NOT DISTINCT` — y ese
//     `NULLS NOT DISTINCT` es imprescindible: sin el, las dos columnas de destinatario (una es
//     SIEMPRE NULL por el CHECK XOR) nunca colisionarian y el indice no deduplicaria nada. Que
//     sobreviva a la reconstruccion NO SE SUPONE: se mide abajo, contra Postgres.
//  2. Hay que mirar si el `down.sql` de la migracion que CREO el enum recrea-con-lista o solo
//     dropea. Aqui SOLO dropea (la 146 se lleva tambien las tablas), asi que aquel archivo NO se
//     toca. Y el de la 253 SI recrea, pero con SU lista (los cuatro de la 146), que sigue siendo
//     cierta: tampoco se toca. Las dos cosas se AFIRMAN abajo, para que la comprobacion quede
//     hecha y no haya que repetirla a mano.
//  3. El nombre de la carpeta importa: el helper `carpetaQueTerminaEn` de la 253 hace un `find`
//     sobre nombres ORDENADOS, asi que una carpeta nueva que terminara en `_notificacion` o en
//     `_notificacion_evento_postulacion_recurso` haria que aquel test leyera OTRO archivo y
//     afirmara cosas verdaderas sobre el fichero equivocado. Se comprueba abajo.

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

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_dia_reparto_corregido");
const dirTabla = carpetaQueTerminaEn("_orden_dia_reparto_cambio");
const dir253 = carpetaQueTerminaEn("_notificacion_evento_postulacion_recurso");
const dir146 = carpetaQueTerminaEn("_notificacion");

const upSql = fs.readFileSync(path.join(dirNueva, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirNueva, "down.sql"), "utf8");
const down253 = fs.readFileSync(path.join(dir253, "down.sql"), "utf8");
const down146 = fs.readFileSync(path.join(dir146, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
const tiposNotificacion = fs.readFileSync(
  path.join(ROOT, "lib", "types", "notificacion.ts"),
  "utf8",
);

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);

/** Los CINCO valores de cada enum ANTES de esta migracion: los 4 de la 146 + el 1 de la 253. */
const EVENTOS_PREVIOS = [
  "orden_rechazada",
  "carga_masiva_terminada",
  "postulacion_mensajero_pendiente",
  "cierre_dia_por_aprobar",
  "postulacion_recurso_pendiente",
];
const ENTIDADES_PREVIAS = ["orden", "usuario", "cierre_dia", "carga", "postulacion_recurso"];

describe("262 / D7 — el UP solo ANADE, y nada mas", () => {
  it("trae sus dos archivos", () => {
    expect(fs.existsSync(path.join(dirNueva, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(dirNueva, "down.sql"))).toBe(true);
  });

  it("⭑ va DESPUES de la migracion que crea `orden_dia_reparto_cambio`, y eso no es estetico", () => {
    // La entidad `orden_dia_reparto_cambio` NOMBRA una tabla que la migracion anterior crea. Y
    // ademas Postgres prohibe USAR un valor de enum recien anadido en la misma transaccion que lo
    // anadio (55P04), asi que las dos cosas tienen que ir en migraciones separadas Y EN ESTE ORDEN.
    expect(path.basename(dirNueva) > path.basename(dirTabla)).toBe(true);
  });

  it("⭑ el nombre de la carpeta NO rompe el `carpetaQueTerminaEn` de la 253", () => {
    // La trampa medida (§15.4): aquel helper hace `find` sobre nombres ORDENADOS. Si esta carpeta
    // terminara en `_notificacion` o en `_notificacion_evento_postulacion_recurso`, aquel test
    // empezaria a leer ESTE archivo y afirmaria cosas verdaderas sobre el fichero equivocado.
    const nombre = path.basename(dirNueva);
    expect(nombre.endsWith("_notificacion")).toBe(false);
    expect(nombre.endsWith("_notificacion_evento_postulacion_recurso")).toBe(false);
    // Y el helper sigue resolviendo a las carpetas correctas.
    expect(path.basename(dir146).endsWith("_notificacion")).toBe(true);
    expect(path.basename(dir253)).not.toBe(nombre);
  });

  it("anade `dia_reparto_corregido` a `notificacion_evento` de forma idempotente", () => {
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS 'dia_reparto_corregido'/,
    );
  });

  it("⭑ anade TAMBIEN `orden_dia_reparto_cambio` a `notificacion_entidad_tipo`", () => {
    // Sin este segundo valor la fila no cabe: `entidad_tipo` es NOT NULL y ninguno de los cinco
    // valores vigentes describe una fila del rastro. Y reusar `orden` (A20) haria que la clave
    // unica `notificacion_dedupe_key` admitiera UN solo aviso por (evento, orden, mensajero) para
    // siempre: la SEGUNDA correccion no avisaria nunca, en silencio.
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'orden_dia_reparto_cambio'/,
    );
  });

  it("NO usa los valores nuevos en la misma transaccion (Postgres lo prohibe: 55P04)", () => {
    const sentencias = upDdl
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toHaveLength(2);
    for (const s of sentencias) expect(s).toMatch(/^ALTER TYPE /);
  });

  it("es ADITIVA: no toca ninguna tabla ni crea nada", () => {
    expect(upDdl).not.toMatch(/CREATE TABLE/);
    expect(upDdl).not.toMatch(/ALTER TABLE/);
    expect(upDdl).not.toMatch(/\bDROP\b/);
    expect(upDdl).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s/im);
  });
});

describe("262 / D7 — el DOWN recrea los dos enums con la lista PREVIA EXACTA (R53)", () => {
  it("⭑ `notificacion_evento` se recrea con los CINCO previos, `postulacion_recurso_pendiente` INCLUIDO", () => {
    // ⚠️ ESTE ES EL TEST QUE MATA M-ag. Con cuatro valores —los de la 146— el rollback de ESTA
    // migracion borraria ademas el valor de la 253, que no tiene nada que ver con esta ficha.
    const m = /CREATE TYPE "notificacion_evento" AS ENUM \(([\s\S]*?)\)/.exec(downDdl);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(EVENTOS_PREVIOS);
  });

  it("⭑ `notificacion_entidad_tipo` tambien, con `postulacion_recurso` incluido", () => {
    const m = /CREATE TYPE "notificacion_entidad_tipo" AS ENUM \(([\s\S]*?)\)/.exec(downDdl);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(ENTIDADES_PREVIAS);
  });

  it("cada recreacion lleva su RENAME, su ALTER COLUMN con USING y su DROP del `_old`", () => {
    for (const tipo of ["notificacion_evento", "notificacion_entidad_tipo"]) {
      expect(downDdl).toMatch(new RegExp(`ALTER TYPE "${tipo}" RENAME TO "${tipo}_old"`));
      expect(downDdl).toMatch(new RegExp(`DROP TYPE "${tipo}_old"`));
    }
    expect(downDdl).toMatch(
      /ALTER COLUMN "evento" TYPE "notificacion_evento"\s*\n?\s*USING \("evento"::text::"notificacion_evento"\)/,
    );
    expect(downDdl).toMatch(
      /ALTER COLUMN "entidad_tipo" TYPE "notificacion_entidad_tipo"\s*\n?\s*USING \("entidad_tipo"::text::"notificacion_entidad_tipo"\)/,
    );
  });

  it("⭑ R54: el down NO borra ni reescribe NINGUNA fila para «hacer sitio»", () => {
    // ⚠️ ESTE ES EL TEST QUE MATA M-ah. Si quedaran filas con el valor nuevo, el `USING` debe fallar
    // RUIDOSAMENTE y abortar el rollback. Esas filas son avisos que un mensajero puede no haber
    // leido todavia: borrarlos en silencio apagaria la unica senal de que a uno de sus paquetes le
    // cambiaron el dia. Primero se borran a mano y a sabiendas.
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/);
    expect(downDdl).not.toMatch(/TRUNCATE/i);
  });
});

describe("262 / D7 — los `down.sql` ANTERIORES no se tocan, y esta es la comprobacion", () => {
  it("⭑ el de la 146 SOLO dropea los enums; no los recrea con lista", () => {
    // Es la pregunta que este repo obliga a hacerse al anadir un valor a un enum. Respuesta medida:
    // solo dropea, porque alli se van tambien las tablas que los usan. Si algun dia alguien lo
    // convirtiera en un recrea-con-lista, este test se pone rojo y avisa de que hay que revisar
    // TAMBIEN aquel archivo.
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_evento"/);
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_entidad_tipo"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_evento"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_entidad_tipo"/);
    // Y NO menciona ninguno de los valores posteriores: es una foto historica.
    expect(down146).not.toContain("postulacion_recurso");
    expect(down146).not.toContain("dia_reparto_corregido");
    expect(down146).not.toContain("orden_dia_reparto_cambio");
  });

  it("⭑ el de la 253 SI recrea, pero con SUS CUATRO valores — y sigue siendo cierto", () => {
    // Su lista es «el enum ANTES de la 253», y eso no cambia porque nosotros anadamos uno detras.
    // Renumerar o editar una migracion ya aplicada es la leccion de «migracion editada en sitio =
    // drift»: lo anadido despues no llega nunca a esa base.
    const m = /CREATE TYPE "notificacion_evento" AS ENUM \(([\s\S]*?)\)/.exec(down253);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual([
      "orden_rechazada",
      "carga_masiva_terminada",
      "postulacion_mensajero_pendiente",
      "cierre_dia_por_aprobar",
    ]);
    // Y NO menciona nada de la 262.
    expect(down253).not.toContain("dia_reparto_corregido");
    expect(down253).not.toContain("orden_dia_reparto_cambio");
  });
});

// ⚠️ AMPLIADO EL 2026-08-23 POR LA 271 Y EL 2026-08-29 POR LA FICHA 333, Y SOLO EN LOS CUATRO
// CASOS QUE MIRAN EL ESTADO DE HOY: los dos de `schema.prisma` de aqui abajo y los dos de la base
// aplicada del bloque final. Esos cuatro son inventarios CERRADOS del presente, asi que crecen con
// cada valor que se anada detras — y siguen siendo LITERALES a proposito: derivarlos de la propia
// fuente que vigilan (el schema, el enum de Postgres) los dejaria verdes por construccion y no
// fijarian nada.
//
// ⛔ TODO LO DEMAS DE ESTE ARCHIVO NO SE TOCA: el UP de la 262, su DOWN con los CINCO previos y las
// afirmaciones sobre los `down.sql` de la 146 y de la 253 son FOTOS HISTORICAS y siguen siendo
// ciertas palabra por palabra.
describe("262 / D7 — el enum Prisma y el tipo de TypeScript no quedan a la deriva (R52)", () => {
  it("`NotificacionEvento` del schema gana el valor y sigue siendo un inventario CERRADO", () => {
    const bloque = /enum NotificacionEvento \{([\s\S]*?)\n\}/.exec(schemaPrisma)![1];
    const valores = bloque
      .split("\n")
      .map((l) => l.trim().split(/\s+\/\//)[0].trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"));
    // LITERAL a proposito: el contrato de 146/D1 no es «hay N eventos», es «los eventos son ESTOS y
    // cada uno tiene un productor identificado». Derivarlo del propio schema dejaria el test siempre
    // verde y no diria nada (M-ai).
    expect(valores).toEqual([
      ...EVENTOS_PREVIOS,
      "dia_reparto_corregido",
      // FEATURE 271 (§9.2, Q4 resuelta el 2026-08-23) - los DOS avisos del bloqueo por cierres.
      "cierre_dia_vencido",
      "mensajero_bloqueado_por_cierres",
      // FICHA 333 (design 4.1/4.2, R29/R30/R36, 2026-08-29) - «quedan cobros de gasto fijo
      // esperando decision»: lo emite la corrida del cron al terminar y se repite cada dia CR
      // mientras quede alguno. Migracion `20260829130000_notificacion_evento_gasto_fijo_cobro`.
      "gasto_fijo_cobro_pendiente",
      // FICHA 403 (design §1.2/§5, R9, 2026-09-09) - «un webhook lleva fallando y sus reintentos se
      // espaciaron»: lo emite el DRENADOR de la cola en cada entrega fallida mientras la
      // suscripcion este pausada, y sale UN solo aviso por RACHA. Migracion
      // `20260909130000_notificacion_evento_webhook_suscripcion`.
      "webhook_suscripcion_pausada",
      // FICHA 401 (design 3.3, 2026-09-09) - «el servicio de mapas esta rechazando nuestras
      // peticiones por un problema de configuracion de la cuenta». Lo emite `GeocodeSaludService`
      // desde la rama de configuracion del job de geocodificacion, y va al `maestro` Y al `admin`.
      // Migracion `20260910120000_notificacion_evento_geocodificacion_caida`.
      "geocodificacion_caida",
      // FICHA 409 (design §4.2): los DOS avisos AGREGADOS del panel accionable. Migracion
      // `20260911120000_notificacion_evento_avisos_agregados`, POSTERIOR a la de la 401.
      "novedades_sin_gestionar",
      "devoluciones_represadas",
      // FICHA 412 (design §2): «tu cierre del dia fue RECHAZADO», al mensajero dueno y a
      // nadie mas. Lo emite el RECHAZO (`CierresAdminService`), SIEMPRE que la escritura
      // confirme. Migracion `20260913120000_notificacion_evento_cierre_rechazado`, POSTERIOR
      // a la de la 409 y tambien a las DOS de la 410 (de ahi que su `down.sql` sea el primero
      // que tiene que retipar `push_envio_dia.evento`).
      "cierre_dia_rechazado",
      // FICHA 413 (design §7): «tenés N órdenes para mañana», al MENSAJERO asignado y a nadie
      // más. Lo emite el cron `aviso-reparto-manana` a las 19:00 CR (= `0 1 * * *` UTC), una vez
      // por DÍA ANUNCIADO. Migracion `20260914120000_notificacion_evento_reparto_manana`,
      // POSTERIOR a la de la 412 y tambien a las DOS de la 410.
      "reparto_manana",
    ]);
  });

  it("`NotificacionEntidadTipo` del schema, igual", () => {
    const bloque = /enum NotificacionEntidadTipo \{([\s\S]*?)\n\}/.exec(schemaPrisma)![1];
    const valores = bloque
      .split("\n")
      .map((l) => l.trim().split(/\s+\/\//)[0].trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"));
    expect(valores).toEqual([
      ...ENTIDADES_PREVIAS,
      "orden_dia_reparto_cambio",
      // FICHA 333 (design 4.2, 2026-08-29) - el PRIMER `entidad_tipo` que NO apunta a una fila de
      // tabla: la entidad es EL DIA CR de la corrida (`entidad_id = 'YYYY-MM-DD'`). Con el COBRO
      // como entidad, `notificacion_dedupe_key` admitiria UNA sola fila por (evento, cobro,
      // maestro) PARA SIEMPRE y el recordatorio del dia 2 no saldria nunca — exactamente el fallo
      // que esta misma ficha 262 documento con `orden` como entidad (§15.2, A20).
      "gasto_fijo_cobro_dia",
      // FICHA 403 (design §1.2, 2026-09-09) - el SEGUNDO `entidad_tipo` que no apunta a una fila de
      // tabla: la entidad es LA RACHA DE FALLOS (`entidad_id = '<owner>:<sinExitoDesde ISO>'`), no
      // la suscripcion. Con la suscripcion como entidad, la dedupe admitiria UNA sola fila por
      // (evento, owner, maestro) PARA SIEMPRE y la SEGUNDA racha no avisaria nunca - el MISMO
      // fallo que esta ficha 262 documento con `orden`.
      "webhook_suscripcion_pausa",
      // FICHA 401 (design 3.3, 2026-09-09) - SEGUNDO `entidad_tipo` que no apunta a una fila, por
      // el mismo motivo: la entidad del aviso es LA JORNADA CR. El corte medido del 2026-09-08
      // cruzo la medianoche, y sin valor propio el aviso del dia 2 no habria existido nunca.
      "geocodificacion_caida_dia",
      // FICHA 409 (design §4.2): las entidades de los dos avisos AGREGADOS. Llevan EL ALCANCE
      // DENTRO (`${tiendaId}:${diaCR}` y `${ambito}:${diaCR}`) porque `notificacion_dedupe_key`
      // no incluye `tienda_id` ni `zona_id`: sin el, la primera tienda de la corrida se llevaria
      // el aviso y todas las demas quedarian mudas.
      "novedades_sin_gestionar_dia",
      "devoluciones_represadas_dia",
      // FICHA 412 (design §3): la entidad es EL RECHAZO —`<cierreId>:<resuelto_at ISO>`—, no
      // el cierre. Con el cierre, el SEGUNDO rechazo del mismo cierre no avisaria nunca: la
      // clave no mira el estado de lectura y la re-solicitud REUTILIZA la misma fila.
      "cierre_dia_rechazo",
      // FICHA 413 (design §7): la entidad de ese aviso es EL DIA ANUNCIADO (`'YYYY-MM-DD'`), no
      // ninguna orden: con una entidad fija, el aviso de la segunda noche no saldria NUNCA.
      "reparto_manana_dia",
    ]);
  });

  it("`lib/types/notificacion.ts` refleja los dos, sin drift con Prisma", () => {
    expect(tiposNotificacion).toContain('"dia_reparto_corregido"');
    expect(tiposNotificacion).toContain('"orden_dia_reparto_cambio"');
  });
});

// ===========================================================================================
// CONTRA POSTGRES DE VERDAD — lo que ninguna regex puede afirmar
// ===========================================================================================

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("262 / D7 — la base aplicada, y el DOWN ejercitado de verdad", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function valoresDe(tipo: string): Promise<string[]> {
    const filas = await prisma.$queryRawUnsafe<{ valores: string | null }[]>(
      `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = $1`,
      tipo,
    );
    return (filas[0]?.valores ?? "").split(",").filter((v) => v.length > 0);
  }

  // El titulo ya no lleva la cuenta: decia «los NUEVE» cuando ya eran diez. Este caso lee la BASE
  // APLICADA -el estado de HOY-, asi que crece con cada valor que se anada detras; el resto del
  // archivo son FOTOS HISTORICAS y no se tocan.
  it("la base tiene el evento de esta ficha y los posteriores AL FINAL", async () => {
    // El orden (`enumsortorder`) es lo que demuestra que el valor se ANADIO y no que el tipo se
    // recreo por detras.
    expect(await valoresDe("notificacion_evento")).toEqual([
      ...EVENTOS_PREVIOS,
      "dia_reparto_corregido",
      // FEATURE 271 (§9.2, Q4 resuelta el 2026-08-23) - los DOS avisos del bloqueo por cierres.
      "cierre_dia_vencido",
      "mensajero_bloqueado_por_cierres",
      // FICHA 333 (design 4.1/4.2, R29/R30/R36, 2026-08-29) - «quedan cobros de gasto fijo
      // esperando decision». Migracion `20260829130000_notificacion_evento_gasto_fijo_cobro`.
      "gasto_fijo_cobro_pendiente",
      // FICHA 403 (design §1.2/§5, R9, 2026-09-09) - «un webhook lleva fallando y sus reintentos se
      // espaciaron»: lo emite el DRENADOR de la cola en cada entrega fallida mientras la
      // suscripcion este pausada, y sale UN solo aviso por RACHA. Migracion
      // `20260909130000_notificacion_evento_webhook_suscripcion`.
      "webhook_suscripcion_pausada",
      // FICHA 401 (design 3.3, 2026-09-09) - «el servicio de mapas esta rechazando nuestras
      // peticiones». Migracion `20260910120000_notificacion_evento_geocodificacion_caida`.
      "geocodificacion_caida",
      // FICHA 409 (design §4.2): los DOS avisos AGREGADOS del panel accionable. Migracion
      // `20260911120000_notificacion_evento_avisos_agregados`, POSTERIOR a la de la 401.
      "novedades_sin_gestionar",
      "devoluciones_represadas",
      // FICHA 412 (design §2): «tu cierre del dia fue RECHAZADO», al mensajero dueno y a
      // nadie mas. Lo emite el RECHAZO (`CierresAdminService`), SIEMPRE que la escritura
      // confirme. Migracion `20260913120000_notificacion_evento_cierre_rechazado`, POSTERIOR
      // a la de la 409 y tambien a las DOS de la 410 (de ahi que su `down.sql` sea el primero
      // que tiene que retipar `push_envio_dia.evento`).
      "cierre_dia_rechazado",
      // FICHA 413 (design §7): «tenés N órdenes para mañana», al MENSAJERO asignado y a nadie
      // más. Lo emite el cron `aviso-reparto-manana` a las 19:00 CR (= `0 1 * * *` UTC), una vez
      // por DÍA ANUNCIADO. Migracion `20260914120000_notificacion_evento_reparto_manana`,
      // POSTERIOR a la de la 412 y tambien a las DOS de la 410.
      "reparto_manana",
    ]);
  });

  it("y los tipos de entidad, con los posteriores al final", async () => {
    expect(await valoresDe("notificacion_entidad_tipo")).toEqual([
      ...ENTIDADES_PREVIAS,
      "orden_dia_reparto_cambio",
      // FICHA 333 (design 4.2, 2026-08-29) - la entidad del aviso es EL DIA CR de la corrida, no
      // el cobro; sin valor propio la dedupe de la 146 apagaria el recordatorio diario (R30).
      "gasto_fijo_cobro_dia",
      // FICHA 403 (design §1.2, 2026-09-09) - el SEGUNDO `entidad_tipo` que no apunta a una fila de
      // tabla: la entidad es LA RACHA DE FALLOS (`entidad_id = '<owner>:<sinExitoDesde ISO>'`), no
      // la suscripcion. Con la suscripcion como entidad, la dedupe admitiria UNA sola fila por
      // (evento, owner, maestro) PARA SIEMPRE y la SEGUNDA racha no avisaria nunca - el MISMO
      // fallo que esta ficha 262 documento con `orden`.
      "webhook_suscripcion_pausa",
      // FICHA 401 (design 3.3, 2026-09-09) - la entidad del aviso es LA JORNADA CR.
      "geocodificacion_caida_dia",
      // FICHA 409 (design §4.2): las entidades de los dos avisos AGREGADOS. Llevan EL ALCANCE
      // DENTRO (`${tiendaId}:${diaCR}` y `${ambito}:${diaCR}`) porque `notificacion_dedupe_key`
      // no incluye `tienda_id` ni `zona_id`: sin el, la primera tienda de la corrida se llevaria
      // el aviso y todas las demas quedarian mudas.
      "novedades_sin_gestionar_dia",
      "devoluciones_represadas_dia",
      // FICHA 412 (design §3): la entidad es EL RECHAZO —`<cierreId>:<resuelto_at ISO>`—, no
      // el cierre. Con el cierre, el SEGUNDO rechazo del mismo cierre no avisaria nunca: la
      // clave no mira el estado de lectura y la re-solicitud REUTILIZA la misma fila.
      "cierre_dia_rechazo",
      // FICHA 413 (design §7): la entidad de ese aviso es EL DIA ANUNCIADO (`'YYYY-MM-DD'`), no
      // ninguna orden: con una entidad fija, el aviso de la segunda noche no saldria NUNCA.
      "reparto_manana_dia",
    ]);
  });

  it("⭑ una notificacion con el evento y la entidad nuevos se puede ESCRIBIR de verdad", async () => {
    // Es lo que ningun test estatico puede demostrar: que el valor no solo esta en el cliente
    // generado, sino que la BASE lo acepta en la columna. Se escribe y se borra en el acto; la fila
    // lleva `entidad_id` NULL, asi que no entra en el indice unico de dedupe (que es parcial).
    const id = randomUUID();
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "notificacion"
           ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_usuario_id")
         VALUES ($1, 'box'::"notificacion_tipo",
                 'dia_reparto_corregido'::"notificacion_evento",
                 'prueba 262', 'orden_dia_reparto_cambio'::"notificacion_entidad_tipo",
                 NULL, NULL)`,
        id,
      );
      // Ojo: el CHECK XOR exige rol O usuario. Con los dos NULL la insercion de arriba falla, asi
      // que si llegamos aqui es que el CHECK no existe — y eso tambien hay que saberlo.
      const filas = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "notificacion" WHERE id = $1`,
        id,
      );
      expect(Number(filas[0].n)).toBe(1);
    } catch (error) {
      // El CHECK XOR rechaza la fila SIN destinatario: se reintenta con uno, que es la forma real.
      expect((error as Error).message).toContain("notificacion_destinatario_xor");
      await prisma.$executeRawUnsafe(
        `INSERT INTO "notificacion"
           ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
         VALUES ($1, 'box'::"notificacion_tipo",
                 'dia_reparto_corregido'::"notificacion_evento",
                 'prueba 262', 'orden_dia_reparto_cambio'::"notificacion_entidad_tipo",
                 NULL, 'mensajero'::"rol_value")`,
        id,
      );
      const filas = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "notificacion" WHERE id = $1`,
        id,
      );
      expect(Number(filas[0].n)).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(`DELETE FROM "notificacion" WHERE id = $1`, id);
    }
  }, 60_000);

  it("⭑⭑ el `notificacion_dedupe_key` conserva `NULLS NOT DISTINCT` y su `WHERE` parcial", async () => {
    // ESTA es la razon de que este bloque exista. El `down.sql` de esta migracion hace
    // `ALTER COLUMN "evento" TYPE ...`, que DESTRUYE Y REHACE todos los indices que tocan esa
    // columna. Si Postgres no reconstruyera el `NULLS NOT DISTINCT`, la dedupe de la 146 dejaria de
    // deduplicar EN SILENCIO —las dos columnas de destinatario nunca colisionarian— y ningun test
    // de la 146 se enteraria, porque la 146 no vuelve a mirar su propio indice.
    //
    // El ciclo up -> down -> up de ESTA migracion se ejercito en local el 2026-08-22 y esta
    // asercion corre sobre el resultado.
    const filas = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
    );
    expect(
      filas,
      "falta `notificacion_dedupe_key`: el down se llevo el indice de la 146",
    ).toHaveLength(1);
    expect(filas[0].indexdef).toContain("NULLS NOT DISTINCT");
    expect(filas[0].indexdef).toContain("WHERE (entidad_id IS NOT NULL)");
    expect(filas[0].indexdef).toContain("UNIQUE");
  });

  it("`notificacion_entidad_idx` y los demas indices siguen ahi", async () => {
    const filas = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'notificacion' ORDER BY indexname`,
    );
    expect(filas.map((f) => f.indexname)).toEqual([
      "notificacion_dedupe_key",
      "notificacion_entidad_idx",
      "notificacion_pkey",
      "notificacion_rol_created_at_idx",
      "notificacion_tienda_id_created_at_idx",
      "notificacion_usuario_created_at_idx",
      "notificacion_zona_id_created_at_idx",
    ]);
  });

  it("y el CHECK XOR de destinatario sigue en pie tras el ALTER COLUMN", async () => {
    const filas = await prisma.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT con.conname FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
        WHERE c.relname = 'notificacion' AND con.contype = 'c'`,
    );
    expect(filas.map((f) => f.conname)).toContain("notificacion_destinatario_xor");
  });
});
