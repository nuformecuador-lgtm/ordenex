import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { notificarGeocodificacionCaidaReal } from "@/lib/notificaciones/notificadores";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, serializarEscriturasReales } from "./_postgres-real";
import { crearEnvio, crearPlantilla } from "./_whatsapp-envios-474";

// Ficha 474 (T8.4, R26) — EL PUENTE, MEDIDO POR EL BINDING REAL DE PRODUCCION.
//
// Se emite por `notificarGeocodificacionCaidaReal` —el mismo que llama el job de geocodificacion—,
// que resuelve su repositorio por `repoReal()` y escribe con `getPrismaClient()`: NO hay forma de
// meterlo en una transaccion revertida. Por eso este archivo COMMITEA y BORRA lo suyo en `afterAll`
// (notificaciones, jobs, cupo de push, envio y plantilla), con entidades de dias de 2099 unicas por
// corrida.
//
// Lo que demuestra, y por que no basta el test con dobles: si alguien quita `conEnviosWhatsapp` de
// `repoReal()` (o el `activo` del WHERE del puente), los dobles siguen verdes. Aqui se cuentan filas
// de `jobs`:
//   - envio ENCENDIDO por `geocodificacion_caida` -> exactamente UN job `whatsapp_envio_evento`
//     (las dos filas hermanas `maestro`/`admin` comparten entidad -> misma dedupe_key);
//   - re-emitir la misma jornada -> sigue habiendo uno;
//   - envio APAGADO -> cero.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = randomUUID().slice(0, 8);
const DIA_ENCENDIDO = `2099-01-${String(10 + (parseInt(SUFIJO.slice(0, 2), 16) % 18)).padStart(2, "0")}-${SUFIJO}`;
const DIA_APAGADO = `2099-02-01-${SUFIJO}`;

describeSiHayBase("474/R26 — el puente por el binding real", () => {
  let prisma: PrismaClient;
  let envioId = "";
  let plantillaId = "";

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    await prisma.$transaction(async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await crearPlantilla(tx, { informeClave: "aviso_interno" });
      plantillaId = p.id;
      envioId = await crearEnvio(tx, {
        plantillaId: p.id,
        nombre: `474 puente ${SUFIJO}`,
        disparo: "evento",
        eventoClave: "geocodificacion_caida",
        activo: true,
        roles: ["maestro"],
      });
    });
  });

  afterAll(async () => {
    const dias = [DIA_ENCENDIDO, DIA_APAGADO];
    const notis = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "notificacion" WHERE "evento" = 'geocodificacion_caida' AND "entidad_id" = ANY($1::text[])`,
      dias,
    );
    const ids = notis.map((n) => n.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "jobs" WHERE "dedupe_key" = ANY($1::text[])`, [
      ...dias.map((d) => `wa_envio_evento:geocodificacion_caida:${d}`),
      ...ids.map((i) => `push:${i}`),
    ]);
    await prisma.$executeRawUnsafe(`DELETE FROM "push_envio_dia" WHERE "notificacion_id" = ANY($1::text[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM "notificacion_lectura" WHERE "notificacion_id" = ANY($1::text[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM "notificacion" WHERE "id" = ANY($1::text[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM "whatsapp_envio_destinatario" WHERE "envio_id" = $1`, envioId);
    await prisma.$executeRawUnsafe(`DELETE FROM "whatsapp_envio" WHERE "id" = $1`, envioId);
    await prisma.$executeRawUnsafe(`DELETE FROM "plantilla_mensaje" WHERE "id" = $1`, plantillaId);
    await prisma.$disconnect();
  });

  async function jobsDe(dia: string): Promise<number> {
    const f = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "jobs" WHERE "tipo" = 'whatsapp_envio_evento' AND "dedupe_key" = $1`,
      `wa_envio_evento:geocodificacion_caida:${dia}`,
    );
    return f[0].n;
  }

  async function notificacionesDe(dia: string): Promise<number> {
    const f = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "notificacion" WHERE "evento" = 'geocodificacion_caida' AND "entidad_id" = $1`,
      dia,
    );
    return f[0].n;
  }

  it("⭑ envio ENCENDIDO: las dos filas del aviso dejan exactamente UN job; re-emitir no anade", async () => {
    await notificarGeocodificacionCaidaReal({ afectados: 2, diaCR: DIA_ENCENDIDO });
    // Autocomprobacion: el aviso SI se creo (dos filas: maestro y admin). Sin esto, un aviso que no
    // llegara a crearse daria «cero jobs» por la razon equivocada.
    expect(await notificacionesDe(DIA_ENCENDIDO)).toBe(2);
    expect(await jobsDe(DIA_ENCENDIDO)).toBe(1);

    await notificarGeocodificacionCaidaReal({ afectados: 3, diaCR: DIA_ENCENDIDO });
    expect(await jobsDe(DIA_ENCENDIDO)).toBe(1);

    const payload = await prisma.$queryRawUnsafe<{ payload: Record<string, unknown> }[]>(
      `SELECT "payload" FROM "jobs" WHERE "dedupe_key" = $1`,
      `wa_envio_evento:geocodificacion_caida:${DIA_ENCENDIDO}`,
    );
    // R51: el payload lleva la foto del aviso y NADA de anexo.
    expect(Object.keys(payload[0].payload).sort()).toEqual(["datos", "evento", "notificacionId", "referencia"]);
    expect(Object.keys(payload[0].payload.datos as object).sort()).toEqual(["creadoAt", "rolFila", "texto"]);
  });

  it("⭑ envio APAGADO: el aviso se crea y NO hay job", async () => {
    await prisma.$executeRawUnsafe(`UPDATE "whatsapp_envio" SET "activo" = false WHERE "id" = $1`, envioId);
    await notificarGeocodificacionCaidaReal({ afectados: 1, diaCR: DIA_APAGADO });
    expect(await notificacionesDe(DIA_APAGADO)).toBe(2);
    expect(await jobsDe(DIA_APAGADO)).toBe(0);
  });
});
