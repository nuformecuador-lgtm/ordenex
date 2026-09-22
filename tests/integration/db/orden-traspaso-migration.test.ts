import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 427 (T3, design §4.1/§4.2) — LA FORMA DE `orden_traspaso_mensajero`, CONTRA POSTGRES.
//
// Una regex sobre el `migration.sql` demuestra que el TEXTO dice lo que dice. Lo que no puede
// demostrar es que Postgres HAGA lo que el texto promete: que el CHECK rechace, que las FK sean
// RESTRICT de verdad, que la RLS quede encendida y que los cinco indices existan con su nombre. Eso
// son hechos del motor.
//
// ⚠️ PROHIBIDO `if (!fks) return;`. Sin datos para sembrar, este archivo REVIENTA con un mensaje
// que lo dice: un `return` temprano reporta `passed` sin comprobar nada, y este repo ya lo pago.
//
// TODO corre dentro de una transaccion que SIEMPRE se revierte.

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

const dirTabla = carpetaQueTerminaEn("_orden_traspaso_mensajero");
const upSql = fs.readFileSync(path.join(dirTabla, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirTabla, "down.sql"), "utf8");

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);

const INDICES = [
  "orden_traspaso_mensajero_orden_id_created_at_idx",
  "orden_traspaso_mensajero_mensajero_anterior_id_created_at_idx",
  "orden_traspaso_mensajero_mensajero_nuevo_id_created_at_idx",
  "orden_traspaso_mensajero_actor_usuario_id_idx",
  "orden_traspaso_mensajero_lote_id_idx",
];

describe("427/T2 — el UP y el DOWN, leidos del archivo", () => {
  it("el UP crea la tabla, el CHECK, los CINCO indices y enciende la RLS", () => {
    expect(upDdl).toMatch(/CREATE TABLE "orden_traspaso_mensajero"/);
    expect(upDdl).toMatch(/orden_traspaso_mensajero_distinto_check/);
    for (const idx of INDICES) expect(upDdl, idx).toContain(idx);
    expect(upDdl).toMatch(/ALTER TABLE "orden_traspaso_mensajero" ENABLE ROW LEVEL SECURITY/);
  });

  it("el UP NO crea ningun tipo, y por eso el DOWN no recrea ninguna lista de enum", () => {
    // La pregunta obligatoria de este repo («¿los downs previos de ese enum recrean-con-lista o
    // solo dropean?») solo aplica cuando se ANADE un valor a un enum. Esta migracion no anade
    // ninguno: `rol_value` es PREEXISTENTE y esta tabla solo lo USA.
    expect(upDdl).not.toMatch(/CREATE TYPE/);
    expect(upDdl).not.toMatch(/ALTER TYPE/);
    expect(downDdl).not.toMatch(/CREATE TYPE/);
    expect(downDdl).not.toMatch(/DROP TYPE/);
  });

  it("el UP es ADITIVO: no altera `orden`, `usuario` ni `chat_conversacion`", () => {
    for (const tabla of ["orden", "usuario", "chat_conversacion", "gestion_orden"]) {
      expect(upDdl, tabla).not.toMatch(
        new RegExp(`ALTER TABLE "${tabla}"(?!_traspaso)\\s`, "i"),
      );
    }
    expect(upDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(upDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(upDdl).not.toMatch(/^\s*INSERT\s/im);
  });

  it("el DOWN es exactamente el `DROP TABLE` de lo que el UP creo", () => {
    expect(downDdl).toMatch(/DROP TABLE IF EXISTS "orden_traspaso_mensajero";/);
    // Y NO toca ninguna otra tabla: revertir NO devuelve las ordenes a su mensajero anterior.
    expect(downDdl).not.toMatch(/ALTER TABLE "orden"/);
    expect(downDdl).not.toMatch(/UPDATE "orden"/);
  });

  it("su timestamp es POSTERIOR al de la ultima migracion anterior del arbol", () => {
    const anteriores = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => !n.endsWith("_orden_traspaso_mensajero"))
      .sort();
    // Solo pueden ir DETRAS las que se DECLARAN aqui, cada una con su ficha y su motivo: la de los
    // enums de esta misma ficha y las de fichas que llegaron despues. Mismo patron que los censos
    // de enum con su lista de POSTERIORES: la lista crece con cada ficha posterior y la igualdad
    // EXACTA se queda. Una migracion que aparezca detras de esta sin declararse —por ejemplo, con
    // un timestamp anterior a otra ya aplicada— sigue poniendo este caso rojo.
    const posteriores = anteriores.filter((n) => n > path.basename(dirTabla));
    expect(posteriores).toEqual([
      "20260917120100_notificacion_evento_traspaso", // ficha 427: los enums de sus dos avisos
      // Ficha 425 (2026-09-14): la tabla del vinculo de revision `cierre_rechazo_tienda`. Nace
      // despues de toda migracion aplicada y no toca `orden_traspaso_mensajero`.
      "20260917120200_cierre_rechazo_tienda",
      // Ficha 453 (2026-09-21): `vista_filtro`, las combinaciones de filtros guardadas con nombre.
      // ADITIVA PURA: crea una tabla nueva, su unico `(usuario_id, superficie, nombre)` y su FK a
      // `usuario`; no toca `orden_traspaso_mensajero` ni ningun otro objeto preexistente, no lleva
      // backfill y no crea ningun enum.
      "20260921120000_vista_filtro",
    ]);
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("427/T3 — la tabla, tal y como Postgres la tiene", () => {
  let prisma: PrismaClient;
  let ROL_MENSAJERO: string;
  let ROL_MAESTRO: string;
  let TIPO_IDENT: string;
  let FKS: { estatusId: string; tiendaId: string; zonaId: string; provinciaId: string; cantonId: string };

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar la fila " +
          "con la que se miden el CHECK y los RESTRICT. Corre `pnpm run db:seed`.",
      );
    }
    FKS = fks;
    const roles = await prisma.rol.findMany({
      where: { value: { in: ["mensajero", "maestro"] } },
      select: { id: true, value: true },
    });
    ROL_MENSAJERO = roles.find((r) => r.value === "mensajero")?.id ?? "";
    ROL_MAESTRO = roles.find((r) => r.value === "maestro")?.id ?? "";
    if (!ROL_MENSAJERO || !ROL_MAESTRO) {
      throw new Error("faltan los roles `mensajero`/`maestro` en el catalogo: corre el seed.");
    }
    const tipo = await prisma.tipoIdentificacion.findFirst({ select: { id: true } });
    if (!tipo) throw new Error("no hay `tipo_identificacion` en la base: corre el seed.");
    TIPO_IDENT = tipo.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function sembrarUsuario(tx: TxDeTest, rolId: string, etiqueta: string): Promise<string> {
    const sufijo = `${etiqueta}-${randomUUID().slice(0, 8)}`;
    const u = await tx.usuario.create({
      data: {
        nombre: `Corpus427T3 ${etiqueta}`,
        email: `corpus427t3.${sufijo}@example.test`,
        telefono: "88880000",
        passwordHash: "x",
        cedula: `T3-427-${sufijo}`,
        tipoIdentificacionId: TIPO_IDENT,
        rolId,
      },
      select: { id: true },
    });
    return u.id;
  }

  async function sembrarOrden(tx: TxDeTest): Promise<string> {
    const o = await tx.orden.create({
      data: {
        numGuia: 950_000_000 + Math.floor(Math.random() * 40_000_000),
        numRemision: `T3-427-${randomUUID().slice(0, 12)}`,
        destinatario: "Corpus 427 T3",
        telefonoDest: "88880000",
        producto: "caja",
        estatusId: FKS.estatusId,
        tiendaId: FKS.tiendaId,
        zonaId: FKS.zonaId,
        provinciaId: FKS.provinciaId,
        cantonId: FKS.cantonId,
      },
      select: { id: true },
    });
    return o.id;
  }

  it("⭑ (a) las columnas son las del diseno, con sus NOT NULL", async () => {
    const columnas = await prisma.$queryRawUnsafe<
      { column_name: string; is_nullable: string; udt_name: string }[]
    >(
      `SELECT column_name, is_nullable, udt_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orden_traspaso_mensajero'
        ORDER BY column_name`,
    );

    // AUTOCOMPROBACION: si la tabla no existiera, la lista saldria vacia y todo lo de abajo pasaria.
    expect(columnas.length).toBeGreaterThan(0);

    const porNombre = Object.fromEntries(columnas.map((c) => [c.column_name, c]));
    expect(Object.keys(porNombre).sort()).toEqual([
      "actor_rol",
      "actor_usuario_id",
      "created_at",
      "id",
      "lote_id",
      "mensajero_anterior_id",
      "mensajero_nuevo_id",
      "motivo",
      "orden_id",
    ]);
    // TODAS NOT NULL: no hay estado irrepresentable que admitir.
    for (const c of columnas) expect(c.is_nullable, c.column_name).toBe("NO");
    // El rol del actor es el ENUM NATIVO, no texto libre: `actor_rol` congela un valor del catalogo.
    expect(porNombre.actor_rol.udt_name).toBe("rol_value");
  });

  it("⭑ (f) R30: la tabla NO tiene `updated_at` ni `deleted_at` — es append-only", async () => {
    const columnas = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orden_traspaso_mensajero'`,
    );
    expect(columnas.length).toBeGreaterThan(0);
    const nombres = columnas.map((c) => c.column_name);
    expect(nombres).not.toContain("updated_at");
    expect(nombres).not.toContain("deleted_at");
    // CONTROL: la columna que SI tiene que estar, para que lo de arriba no sea verde por vacio.
    expect(nombres).toContain("created_at");
  });

  it("⭑ (d) `relrowsecurity` es TRUE: la RLS quedo encendida", async () => {
    const filas = await prisma.$queryRawUnsafe<{ rls: boolean }[]>(
      `SELECT c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'orden_traspaso_mensajero'`,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].rls).toBe(true);
  });

  it("⭑ (e) los CINCO indices existen, por nombre", async () => {
    const filas = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'orden_traspaso_mensajero'
        ORDER BY indexname`,
    );
    const nombres = filas.map((f) => f.indexname);
    expect(nombres.length).toBeGreaterThan(0);
    for (const idx of INDICES) expect(nombres, idx).toContain(idx);
    // Y la PK.
    expect(nombres).toContain("orden_traspaso_mensajero_pkey");
  });

  it("⭑⭑ (b) R7: el CHECK RECHAZA origen == destino, y falla por ESE motivo", async () => {
    const error = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ordenId = await sembrarOrden(tx);
      const mensajero = await sembrarUsuario(tx, ROL_MENSAJERO, "mismo");
      const actor = await sembrarUsuario(tx, ROL_MAESTRO, "actor");
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO "orden_traspaso_mensajero"
             ("id","orden_id","mensajero_anterior_id","mensajero_nuevo_id","actor_usuario_id",
              "actor_rol","motivo","lote_id")
           VALUES ($1,$2,$3,$3,$4,'maestro'::"rol_value",$5,$6)`,
          randomUUID(),
          ordenId,
          mensajero,
          actor,
          "un traspaso a la misma persona no es un traspaso",
          randomUUID(),
        );
        return null;
      } catch (e) {
        return e as Error;
      }
    });

    expect(error).not.toBeNull();
    // Falla por EL CHECK, no por cualquier otra cosa: el nombre de la constraint esta en el mensaje.
    expect(String(error)).toContain("orden_traspaso_mensajero_distinto_check");
  });

  it("CONTROL de (b): con DOS mensajeros distintos la MISMA insercion pasa", async () => {
    // Anti-vacuidad obligatoria: sin esto, el `toContain` de arriba pasaria aunque la insercion
    // fallara por una FK mal sembrada o por una columna que falta.
    const ok = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ordenId = await sembrarOrden(tx);
      const anterior = await sembrarUsuario(tx, ROL_MENSAJERO, "ant");
      const nuevo = await sembrarUsuario(tx, ROL_MENSAJERO, "nue");
      const actor = await sembrarUsuario(tx, ROL_MAESTRO, "act");
      await tx.$executeRawUnsafe(
        `INSERT INTO "orden_traspaso_mensajero"
           ("id","orden_id","mensajero_anterior_id","mensajero_nuevo_id","actor_usuario_id",
            "actor_rol","motivo","lote_id")
         VALUES ($1,$2,$3,$4,$5,'maestro'::"rol_value",$6,$7)`,
        randomUUID(),
        ordenId,
        anterior,
        nuevo,
        actor,
        "el traspaso valido, con su motivo de mas de diez caracteres",
        randomUUID(),
      );
      return tx.ordenTraspasoMensajero.count({ where: { ordenId } });
    });
    expect(ok).toBe(1);
  });

  it("⭑⭑ (c) las CUATRO FK son RESTRICT: borrar cualquiera de los tres usuarios FALLA", async () => {
    // Quien llevaba un paquete es EVIDENCIA y no se pierde al dar de baja a un usuario. Se prueban
    // los TRES extremos de usuario, uno por uno: una sola FK mal puesta a `SetNull` o `Cascade`
    // borraria la historia en silencio.
    for (const cual of ["anterior", "nuevo", "actor"] as const) {
      const error = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const ordenId = await sembrarOrden(tx);
        const anterior = await sembrarUsuario(tx, ROL_MENSAJERO, "ant");
        const nuevo = await sembrarUsuario(tx, ROL_MENSAJERO, "nue");
        const actor = await sembrarUsuario(tx, ROL_MAESTRO, "act");
        await tx.$executeRawUnsafe(
          `INSERT INTO "orden_traspaso_mensajero"
             ("id","orden_id","mensajero_anterior_id","mensajero_nuevo_id","actor_usuario_id",
              "actor_rol","motivo","lote_id")
           VALUES ($1,$2,$3,$4,$5,'maestro'::"rol_value",$6,$7)`,
          randomUUID(),
          ordenId,
          anterior,
          nuevo,
          actor,
          "el traspaso cuyo rastro no se puede perder al dar de baja",
          randomUUID(),
        );
        const victima = cual === "anterior" ? anterior : cual === "nuevo" ? nuevo : actor;
        try {
          await tx.$executeRawUnsafe(`DELETE FROM "usuario" WHERE "id" = $1`, victima);
          return null;
        } catch (e) {
          return e as Error;
        }
      });

      expect(error, `borrar el usuario \`${cual}\` deberia fallar`).not.toBeNull();
      // Y por SU FK, no por otra: el nombre de la constraint esta en el mensaje.
      const fk =
        cual === "actor"
          ? "orden_traspaso_mensajero_actor_usuario_id_fkey"
          : `orden_traspaso_mensajero_mensajero_${cual}_id_fkey`;
      expect(String(error), `se esperaba ${fk}`).toContain(fk);
    }
  });

  it("⭑ (c) la cuarta FK: borrar la ORDEN con rastro tambien FALLA (RESTRICT)", async () => {
    const error = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ordenId = await sembrarOrden(tx);
      const anterior = await sembrarUsuario(tx, ROL_MENSAJERO, "ant");
      const nuevo = await sembrarUsuario(tx, ROL_MENSAJERO, "nue");
      const actor = await sembrarUsuario(tx, ROL_MAESTRO, "act");
      await tx.$executeRawUnsafe(
        `INSERT INTO "orden_traspaso_mensajero"
           ("id","orden_id","mensajero_anterior_id","mensajero_nuevo_id","actor_usuario_id",
            "actor_rol","motivo","lote_id")
         VALUES ($1,$2,$3,$4,$5,'maestro'::"rol_value",$6,$7)`,
        randomUUID(),
        ordenId,
        anterior,
        nuevo,
        actor,
        "el rastro que impide el borrado fisico de la orden",
        randomUUID(),
      );
      try {
        await tx.$executeRawUnsafe(`DELETE FROM "orden" WHERE "id" = $1`, ordenId);
        return null;
      } catch (e) {
        return e as Error;
      }
    });

    expect(error).not.toBeNull();
    expect(String(error)).toContain("orden_traspaso_mensajero_orden_id_fkey");
  });

  it("CONTROL de (c): un usuario SIN rastro SI se puede borrar", async () => {
    // Anti-vacuidad: sin esto, los `not.toBeNull()` de arriba pasarian aunque `DELETE FROM usuario`
    // fallara siempre por cualquier otra dependencia.
    const error = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const suelto = await sembrarUsuario(tx, ROL_MENSAJERO, "suelto");
      try {
        await tx.$executeRawUnsafe(`DELETE FROM "usuario" WHERE "id" = $1`, suelto);
        return null;
      } catch (e) {
        return e as Error;
      }
    });
    expect(error).toBeNull();
  });

  it("⭑ el motivo admite 300 caracteres (el tope del borde) sin truncarse", async () => {
    const largo = "m".repeat(300);
    const guardado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ordenId = await sembrarOrden(tx);
      const anterior = await sembrarUsuario(tx, ROL_MENSAJERO, "ant");
      const nuevo = await sembrarUsuario(tx, ROL_MENSAJERO, "nue");
      const actor = await sembrarUsuario(tx, ROL_MAESTRO, "act");
      const fila = await tx.ordenTraspasoMensajero.create({
        data: {
          ordenId,
          mensajeroAnteriorId: anterior,
          mensajeroNuevoId: nuevo,
          actorUsuarioId: actor,
          actorRol: "maestro",
          motivo: largo,
          loteId: randomUUID(),
        },
        select: { motivo: true },
      });
      return fila.motivo;
    });
    expect(guardado).toHaveLength(300);
  });
});
