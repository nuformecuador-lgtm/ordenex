import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { emitirDevolucionesRepresadas } from "@/lib/notificaciones/emitir";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 409 (T5.5, R51) — LA DEDUPE DEL AVISO DE REPRESADAS, CONTRA POSTGRES DE VERDAD.
//
// ⚠️ EL MISMO HALLAZGO QUE EL DE NOVEDADES, APLICADO A LAS ZONAS. `notificacion_dedupe_key` es
// UNIQUE sobre `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` y **`zona_id` NO
// ENTRA EN LA CLAVE**. Con `entidad_id = diaCR` a secas, todas las zonas compartirían
// ('devoluciones_represadas', '<día>', 'adminSatelite', NULL): la PRIMERA zona del recorrido se
// llevaría el aviso y **las demás quedarían mudas**, porque `crear` absorbe el `P2002` devolviendo
// `false`. Por eso `entidad_id = `${ámbito}:${díaCR}``, con el literal `"global"` para la
// administración central.
//
// Y `destinatario_rol` SÍ está dentro de la clave: por eso `maestro` y `admin` conviven en el
// ámbito global, y por eso que uno lea el suyo no suprime el del otro.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const DIA_1 = "2091-08-01";
const DIA_2 = "2091-08-02";

async function crearZona(tx: TxDeTest, etiqueta: string): Promise<string> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "zona" ("id","nombre") VALUES ($1, $2)`,
    id,
    `409-rep-${etiqueta}-${id.slice(0, 8)}`,
  );
  return id;
}

/** Las filas del aviso, con su entidad y su rol, para un conjunto de entidades del test. */
async function avisosDe(
  tx: TxDeTest,
  entidades: string[],
): Promise<{ entidad_id: string; rol: string | null; zona_id: string | null }[]> {
  return tx.$queryRawUnsafe<{ entidad_id: string; rol: string | null; zona_id: string | null }[]>(
    `SELECT "entidad_id", "destinatario_rol"::text AS rol, "zona_id"
       FROM "notificacion"
      WHERE "evento" = 'devoluciones_represadas'::"notificacion_evento"
        AND "entidad_id" = ANY($1::text[])
      ORDER BY "entidad_id", "destinatario_rol"::text`,
    entidades,
  );
}

/**
 * `crear` DENTRO de un SAVEPOINT. Igual que en el hermano de novedades: en producción cada
 * `INSERT` va en su propia transacción y el `P2002` lo absorbe `crear` devolviendo `false` —el
 * aviso se pierde EN SILENCIO—; dentro de la transacción del test, la violación abortaría el
 * bloque entero (`25P02`) y no se podría mirar cómo quedó la base.
 */
async function crearConSavepoint(
  tx: TxDeTest,
  repo: NotificacionRepository,
  input: Parameters<NotificacionRepository["crear"]>[0],
): Promise<boolean> {
  const punto = `sp_${randomUUID().replace(/-/g, "")}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
  const creada = await repo.crear(input, tx);
  await tx.$executeRawUnsafe(
    creada ? `RELEASE SAVEPOINT ${punto}` : `ROLLBACK TO SAVEPOINT ${punto}`,
  );
  return creada;
}

describeSiHayBase("409/R51 — un aviso por ÁMBITO, por ROL y por DÍA", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ una corrida deja 2 filas de administración + 1 por zona; repetida el mismo día, ninguna más", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zonaA = await crearZona(tx, "a");
      const zonaB = await crearZona(tx, "b");
      const repo = new NotificacionRepository(tx);
      const ctx = { diasMasAntigua: 8, diaCR: DIA_1 };

      const global1 = await emitirDevolucionesRepresadas(repo, { ...ctx, ambito: { tipo: "global" } }, tx);
      const a1 = await emitirDevolucionesRepresadas(
        repo,
        { ...ctx, ambito: { tipo: "zona", zonaId: zonaA }, diasMasAntigua: 4 },
        tx,
      );
      const b1 = await emitirDevolucionesRepresadas(
        repo,
        { ...ctx, ambito: { tipo: "zona", zonaId: zonaB }, diasMasAntigua: 6 },
        tx,
      );
      // La corrida del cron puede repetirse el mismo día (reintento de la plataforma).
      const global2 = await emitirDevolucionesRepresadas(repo, { ...ctx, ambito: { tipo: "global" } }, tx);
      const a2 = await emitirDevolucionesRepresadas(
        repo,
        { ...ctx, ambito: { tipo: "zona", zonaId: zonaA }, diasMasAntigua: 4 },
        tx,
      );

      const entidades = [`global:${DIA_1}`, `${zonaA}:${DIA_1}`, `${zonaB}:${DIA_1}`];
      return { global1, a1, b1, global2, a2, filas: await avisosDe(tx, entidades), zonaA, zonaB };
    });

    expect(r.global1).toBe(2); // maestro + admin, deduplicados de forma INDEPENDIENTE
    expect(r.a1).toBe(1);
    expect(r.b1).toBe(1); // ⚠️ AQUÍ MUERE LA MUTACIÓN: sin el ámbito en la entidad, esto es 0
    expect(r.global2).toBe(0); // R51: «y no más de una»
    expect(r.a2).toBe(0);

    expect(r.filas).toHaveLength(4);
    const porEntidad = new Map<string, string[]>();
    for (const fila of r.filas) {
      porEntidad.set(fila.entidad_id, [...(porEntidad.get(fila.entidad_id) ?? []), fila.rol ?? ""]);
    }
    expect(porEntidad.get(`global:${DIA_1}`)).toEqual(["admin", "maestro"]);
    expect(porEntidad.get(`${r.zonaA}:${DIA_1}`)).toEqual(["adminSatelite"]);
    expect(porEntidad.get(`${r.zonaB}:${DIA_1}`)).toEqual(["adminSatelite"]);
    // Y el ALCANCE de cada fila de zona es SU zona.
    const deZonaA = r.filas.find((f) => f.entidad_id === `${r.zonaA}:${DIA_1}`);
    expect(deZonaA?.zona_id).toBe(r.zonaA);
  });

  it("⭑ el día siguiente vuelve a avisar: el doble de filas", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "dia2");
      const repo = new NotificacionRepository(tx);

      for (const dia of [DIA_1, DIA_2]) {
        await emitirDevolucionesRepresadas(
          repo,
          { ambito: { tipo: "global" }, diasMasAntigua: 8, diaCR: dia },
          tx,
        );
        await emitirDevolucionesRepresadas(
          repo,
          { ambito: { tipo: "zona", zonaId: zona }, diasMasAntigua: 4, diaCR: dia },
          tx,
        );
      }

      const entidades = [
        `global:${DIA_1}`,
        `global:${DIA_2}`,
        `${zona}:${DIA_1}`,
        `${zona}:${DIA_2}`,
      ];
      return await avisosDe(tx, entidades);
    });

    // 2 (admin. central) + 1 (zona) por día = 6 filas.
    expect(r).toHaveLength(6);
    expect(r.filter((f) => f.entidad_id.endsWith(DIA_1))).toHaveLength(3);
    expect(r.filter((f) => f.entidad_id.endsWith(DIA_2))).toHaveLength(3);
  });

  it("⭑ el ámbito «global» y el de una zona NUNCA colisionan entre sí", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "cruce");
      const repo = new NotificacionRepository(tx);
      const global = await emitirDevolucionesRepresadas(
        repo,
        { ambito: { tipo: "global" }, diasMasAntigua: 8, diaCR: DIA_1 },
        tx,
      );
      const deZona = await emitirDevolucionesRepresadas(
        repo,
        { ambito: { tipo: "zona", zonaId: zona }, diasMasAntigua: 4, diaCR: DIA_1 },
        tx,
      );
      return { global, deZona };
    });

    expect(r.global).toBe(2);
    expect(r.deZona).toBe(1);
  });
});

describeSiHayBase("409/R51 — MUTACIÓN: quitar el ámbito de la entidad pisa las zonas entre sí", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ con `entidad_id = <día>` a secas, la SEGUNDA zona queda muda", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zonaA = await crearZona(tx, "mut-a");
      const zonaB = await crearZona(tx, "mut-b");
      const repo = new NotificacionRepository(tx);

      const fila = (zonaId: string) => ({
        tipo: "warning" as const,
        evento: "devoluciones_represadas" as const,
        descripcion: "aviso agregado",
        anexo: null,
        entidadTipo: "devoluciones_represadas_dia" as const,
        entidadId: DIA_1, // ⚠️ LA MUTACIÓN: el día A SECAS, sin el ámbito
        destinatario: { tipo: "rol" as const, rol: "adminSatelite" as const, zonaId },
      });

      const a = await crearConSavepoint(tx, repo, fila(zonaA));
      const b = await crearConSavepoint(tx, repo, fila(zonaB));
      return { a, b, filas: await avisosDe(tx, [DIA_1]) };
    });

    expect(r.a).toBe(true);
    expect(r.b).toBe(false); // la segunda bodega no se entera de sus propias devoluciones
    expect(r.filas).toHaveLength(1);
  });

  it("⭑ CONTROL sobre el motor: con el ámbito dentro, las dos zonas conviven", async () => {
    // El control positivo del caso anterior: sin él, aquel test estaría verde aunque el `INSERT`
    // fallara por cualquier otra cosa.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zonaA = await crearZona(tx, "ctl-a");
      const zonaB = await crearZona(tx, "ctl-b");
      const repo = new NotificacionRepository(tx);

      const fila = (zonaId: string) => ({
        tipo: "warning" as const,
        evento: "devoluciones_represadas" as const,
        descripcion: "aviso agregado",
        anexo: null,
        entidadTipo: "devoluciones_represadas_dia" as const,
        entidadId: `${zonaId}:${DIA_1}`, // la forma REAL
        destinatario: { tipo: "rol" as const, rol: "adminSatelite" as const, zonaId },
      });

      return {
        a: await crearConSavepoint(tx, repo, fila(zonaA)),
        b: await crearConSavepoint(tx, repo, fila(zonaB)),
        filas: await avisosDe(tx, [`${zonaA}:${DIA_1}`, `${zonaB}:${DIA_1}`]),
      };
    });

    expect(r.a).toBe(true);
    expect(r.b).toBe(true);
    expect(r.filas).toHaveLength(2);
  });

  it("⭑ y el rol SÍ está en la clave: `maestro` y `admin` conviven con la MISMA entidad", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx);
      const fila = (rol: "maestro" | "admin") => ({
        tipo: "warning" as const,
        evento: "devoluciones_represadas" as const,
        descripcion: "aviso agregado",
        anexo: null,
        entidadTipo: "devoluciones_represadas_dia" as const,
        entidadId: `global:${DIA_2}`,
        destinatario: { tipo: "rol" as const, rol },
      });

      return {
        maestro: await crearConSavepoint(tx, repo, fila("maestro")),
        admin: await crearConSavepoint(tx, repo, fila("admin")),
        filas: await avisosDe(tx, [`global:${DIA_2}`]),
      };
    });

    expect(r.maestro).toBe(true);
    expect(r.admin).toBe(true);
    expect(r.filas.map((f) => f.rol)).toEqual(["admin", "maestro"]);
  });
});
