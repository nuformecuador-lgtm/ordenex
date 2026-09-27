import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { emitirReprogramadasEsperanCierre } from "@/lib/notificaciones/emitir";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "../_postgres-real";

// FICHA 462 (T2.6, R11/R12) — LA DEDUPE DEL AVISO DE REPROGRAMADAS RETENIDAS, CONTRA POSTGRES.
//
// ⚠️ EL MISMO HALLAZGO QUE EL DE LAS REPRESADAS (409). `notificacion_dedupe_key` es UNIQUE sobre
// `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` y **`zona_id` NO ENTRA EN LA
// CLAVE**. Con `entidad_id = diaCR` a secas, todas las zonas compartirian
// ('reprogramadas_esperan_cierre', '<dia>', 'adminSatelite', NULL): la PRIMERA zona del recorrido
// se llevaria el aviso y **las demas quedarian mudas**, porque `crear` absorbe el `P2002`. Por eso
// `entidad_id = `${ambito}:${diaCR}``, con el literal `"central"` para la administracion central.
// MUTACION 7 del design: quitar el ambito del `entidad_id` => el caso ⭑ de abajo se pone ROJO.
//
// Y `destinatario_rol` SI esta dentro de la clave: por eso `maestro` y `admin` conviven en el ambito
// central y que uno lea el suyo no suprime el del otro.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const DIA_1 = "2092-09-25";
const DIA_2 = "2092-09-26";

async function crearZona(tx: TxDeTest, etiqueta: string): Promise<string> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "zona" ("id","nombre","sinpe_numero","sinpe_nombre")
       VALUES ($1, $2, '80000000', 'Titular de Prueba')`,
    id,
    `462-ret-${etiqueta}-${id.slice(0, 8)}`,
  );
  return id;
}

type AvisoFila = { entidad_id: string; rol: string | null; zona_id: string | null; tipo: string };

/** Orden DETERMINISTA en JS: un uuid de zona puede caer antes o despues de `central` en la base. */
function ordenar(filas: AvisoFila[]): AvisoFila[] {
  return [...filas].sort((a, b) => `${a.entidad_id}|${a.rol}`.localeCompare(`${b.entidad_id}|${b.rol}`));
}

async function avisosDe(tx: TxDeTest, entidades: string[]): Promise<AvisoFila[]> {
  const filas = await tx.$queryRawUnsafe<AvisoFila[]>(
    `SELECT "entidad_id", "destinatario_rol"::text AS rol, "zona_id", "tipo"::text AS tipo
       FROM "notificacion"
      WHERE "evento" = 'reprogramadas_esperan_cierre'::"notificacion_evento"
        AND "entidad_id" = ANY($1::text[])`,
    entidades,
  );
  return ordenar(filas);
}

describeSiHayBase("462/R11/R12 — un aviso por AMBITO, por ROL y por DIA", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ una corrida deja 2 filas centrales + 1 por zona; repetida el mismo dia, ninguna mas (R11/R12)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zonaA = await crearZona(tx, "a");
      const zonaB = await crearZona(tx, "b");
      const repo = new NotificacionRepository(tx);

      const central1 = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA_1 }, tx);
      const a1 = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "zona", zonaId: zonaA }, diaCR: DIA_1 }, tx);
      const b1 = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "zona", zonaId: zonaB }, diaCR: DIA_1 }, tx);
      // La corrida del cron puede repetirse el mismo dia (reintento de la plataforma).
      const central2 = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA_1 }, tx);
      const a2 = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "zona", zonaId: zonaA }, diaCR: DIA_1 }, tx);

      const entidades = [`central:${DIA_1}`, `${zonaA}:${DIA_1}`, `${zonaB}:${DIA_1}`];
      return { central1, a1, b1, central2, a2, filas: await avisosDe(tx, entidades), zonaA, zonaB };
    });

    expect(r.central1).toBe(2); // maestro + admin, deduplicados de forma INDEPENDIENTE
    expect(r.a1).toBe(1);
    expect(r.b1).toBe(1); // ⭑ LA SEGUNDA ZONA NO QUEDA MUDA (mutacion 7)
    expect(r.central2).toBe(0);
    expect(r.a2).toBe(0);
    expect(r.filas).toEqual(
      ordenar([
        { entidad_id: `${r.zonaA}:${DIA_1}`, rol: "adminSatelite", zona_id: r.zonaA, tipo: "warning" },
        { entidad_id: `${r.zonaB}:${DIA_1}`, rol: "adminSatelite", zona_id: r.zonaB, tipo: "warning" },
        { entidad_id: `central:${DIA_1}`, rol: "admin", zona_id: null, tipo: "warning" },
        { entidad_id: `central:${DIA_1}`, rol: "maestro", zona_id: null, tipo: "warning" },
      ]),
    );
  });

  it("dias CR distintos producen avisos DISTINTOS para el mismo ambito (R11, segunda mitad)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "c");
      const repo = new NotificacionRepository(tx);

      const dia1 = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "zona", zonaId: zona }, diaCR: DIA_1 }, tx);
      const dia2 = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "zona", zonaId: zona }, diaCR: DIA_2 }, tx);
      const c1 = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA_1 }, tx);
      const c2 = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA_2 }, tx);

      return { dia1, dia2, c1, c2, filas: await avisosDe(tx, [`${zona}:${DIA_1}`, `${zona}:${DIA_2}`, `central:${DIA_1}`, `central:${DIA_2}`]) };
    });

    expect(r.dia1).toBe(1);
    expect(r.dia2).toBe(1);
    expect(r.c1).toBe(2);
    expect(r.c2).toBe(2);
    expect(r.filas).toHaveLength(6);
  });

  it("⭑ la fila se puede leer de vuelta: el indice unico admite EXACTAMENTE lo emitido y nada mas", async () => {
    // El indice manda incluso si la guardia previa (`existeNoLeidaPara`) se saltara: insertar a
    // pelo la misma clave choca. Es la propiedad que hace ESTRUCTURAL la dedupe.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx);
      await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA_1 }, tx);

      await tx.$executeRawUnsafe(`SAVEPOINT sp_choque`);
      let choco = false;
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion" ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
           VALUES ($1, 'warning'::"notificacion_tipo", 'reprogramadas_esperan_cierre'::"notificacion_evento",
                   'duplicado a pelo', 'reprogramadas_esperan_cierre_dia'::"notificacion_entidad_tipo", $2, 'admin'::"rol_value")`,
          randomUUID(),
          `central:${DIA_1}`,
        );
      } catch (e) {
        choco = /notificacion_dedupe_key|23505/.test(String((e as Error).message));
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT sp_choque`);
      return { choco, filas: await avisosDe(tx, [`central:${DIA_1}`]) };
    });

    expect(r.choco).toBe(true);
    expect(r.filas).toHaveLength(2);
  });
});
