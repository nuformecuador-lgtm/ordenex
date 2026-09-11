import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { emitirNovedadesSinGestionar } from "@/lib/notificaciones/emitir";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 409 (T5.5, R41/R42) — LA DEDUPE DEL AVISO DE NOVEDADES, CONTRA POSTGRES DE VERDAD.
//
// ⚠️ POR QUE ESTE ARCHIVO ES EL CORAZON DE LA FICHA. `notificacion_dedupe_key` es UNIQUE sobre
// `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` con `NULLS NOT DISTINCT` y
// **EL ALCANCE (`tienda_id`) NO ENTRA EN LA CLAVE** — está escrito en
// `NotificacionRepository.columnasDestinatario`—, y `crear` ABSORBE el `P2002` devolviendo
// `false`.
//
// Con `entidad_id = diaCR` a secas, la clave sería ('novedades_sin_gestionar', '<día>',
// 'adminTienda', NULL) **PARA TODAS LAS TIENDAS**: la PRIMERA tienda de la corrida se llevaría su
// aviso y **TODAS LAS DEMÁS quedarían silenciadas, sin error, sin log y sin nada**. Es el fallo
// que documentaron la 262 (entidad = orden en vez de cambio) y la 403 (entidad = suscripción en
// vez de racha), y este repo YA LO COMETIÓ DOS VECES.
//
// Un doble no lo ve: hay dobles en este árbol que meten el alcance en su clave y por tanto son MÁS
// PERMISIVOS que la base. Aquí manda el índice real.
//
// ⚠️ TODO CORRE DENTRO DE UNA TRANSACCIÓN QUE SIEMPRE SE REVIERTE: la base local es COMPARTIDA.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const DIA_1 = "2091-07-01";
const DIA_2 = "2091-07-02";

/** Clona la identidad de un usuario existente para crear una TIENDA propia del test. */
async function crearTienda(tx: TxDeTest, modeloUsuarioId: string): Promise<string> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "usuario"
       ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","updated_at")
     SELECT $1, '409 tienda de prueba', $2, '00000000', 'x', $3,
            u."tipo_identificacion_id", u."rol_id", CURRENT_TIMESTAMP
       FROM "usuario" u WHERE u."id" = $4`,
    id,
    `409-dedupe-${id}@test.local`,
    `409d-${id.slice(0, 12)}`,
    modeloUsuarioId,
  );
  return id;
}

/** Las filas del aviso de esta ficha para una tienda, con su entidad. */
async function avisosDe(tx: TxDeTest, tiendaId: string): Promise<{ entidad_id: string }[]> {
  return tx.$queryRawUnsafe<{ entidad_id: string }[]>(
    `SELECT "entidad_id"
       FROM "notificacion"
      WHERE "evento" = 'novedades_sin_gestionar'::"notificacion_evento" AND "tienda_id" = $1
      ORDER BY "entidad_id"`,
    tiendaId,
  );
}

const CTX_BASE = { diasMasAntigua: 3, plazo: "cinco_dias" as const };

/**
 * `crear` DENTRO de un SAVEPOINT, para poder observar lo que pasa en PRODUCCIÓN.
 *
 * ⚠️ POR QUÉ HACE FALTA, y no es un adorno: en producción cada `INSERT` va en su propia
 * transacción, así que la violación del índice la absorbe `NotificacionRepository.crear`
 * devolviendo `false` y **la corrida sigue** — el aviso se pierde EN SILENCIO, que es justo el
 * fallo que estos casos existen para nombrar. Dentro de la transacción revertida de un test,
 * Postgres ABORTA la transacción entera con la violación y toda consulta posterior muere con
 * `25P02`, así que sin el savepoint el test no puede mirar cómo quedó la base.
 *
 * Con `ROLLBACK TO SAVEPOINT` la transacción se recupera exactamente hasta antes del `INSERT`
 * rechazado: es la reproducción fiel de «esa fila no existe y nadie se enteró».
 */
async function crearConSavepoint(
  tx: TxDeTest,
  repo: NotificacionRepository,
  input: Parameters<NotificacionRepository["crear"]>[0],
  // FICHA 410 (design 6.1): `crear` devuelve el id creado, o `null` si la dedupe lo absorbio.
  // Este ayudante sigue contestando SI/NO porque lo unico que le importa es si la fila entro.
): Promise<boolean> {
  const punto = `sp_${randomUUID().replace(/-/g, "")}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
  const creada = (await repo.crear(input, tx)) !== null;
  await tx.$executeRawUnsafe(
    creada ? `RELEASE SAVEPOINT ${punto}` : `ROLLBACK TO SAVEPOINT ${punto}`,
  );
  return creada;
}

describeSiHayBase("409/R41 — un aviso por tienda y por DÍA calendario de Costa Rica", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ dos corridas el MISMO día dejan UNA fila; el día siguiente, DOS", async () => {
    const fks = await fksDeOrden(prisma);
    // ⚠️ FALLA RUIDOSAMENTE si la base está vacía: sin un usuario del que clonar la identidad, el
    // caso no se puede medir y un `return` temprano lo reportaría `passed` sin comprobar nada.
    expect(fks, "la tabla `orden` está vacía: el caso no se puede medir").not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tienda = await crearTienda(tx, fks!.tiendaId);
      const repo = new NotificacionRepository(tx);

      const primera = await emitirNovedadesSinGestionar(
        repo,
        { ...CTX_BASE, tiendaId: tienda, diaCR: DIA_1 },
        tx,
      );
      // La corrida del cron puede repetirse el mismo día (reintento de la plataforma).
      const repetida = await emitirNovedadesSinGestionar(
        repo,
        { ...CTX_BASE, tiendaId: tienda, diaCR: DIA_1 },
        tx,
      );
      const trasElDia1 = await avisosDe(tx, tienda);
      const siguiente = await emitirNovedadesSinGestionar(
        repo,
        { ...CTX_BASE, tiendaId: tienda, diaCR: DIA_2 },
        tx,
      );
      return { primera, repetida, siguiente, trasElDia1, final: await avisosDe(tx, tienda) };
    });

    expect(r.primera).toBe(1);
    expect(r.repetida).toBe(0); // R41: «y no más de una»
    expect(r.trasElDia1.map((f) => f.entidad_id)).toHaveLength(1);
    expect(r.siguiente).toBe(1); // el recordatorio diario es ESTRUCTURAL
    expect(r.final).toHaveLength(2);
  });

  it("⭑ MUTACIÓN R41: con el ID DE LA ORDEN como entidad, el aviso del día 2 NO EXISTIRÍA", async () => {
    // Se reproduce la mutación a pelo contra el motor: la misma entidad para los dos días. La
    // segunda fila choca con `notificacion_dedupe_key` — y como `crear` absorbe el `P2002`, en
    // producción eso sería SILENCIO TOTAL: el aviso del día 2 no saldría nunca.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tienda = await crearTienda(tx, fks!.tiendaId);
      const repo = new NotificacionRepository(tx);
      const entidadFija = `orden-${randomUUID()}`; // la entidad que NO cambia entre días

      const dia1 = await crearConSavepoint(tx, repo, {
        tipo: "alert",
        evento: "novedades_sin_gestionar",
        descripcion: "aviso del día 1",
        anexo: null,
        entidadTipo: "novedades_sin_gestionar_dia",
        entidadId: entidadFija,
        destinatario: { tipo: "rol", rol: "adminTienda", tiendaId: tienda },
      });
      // Marcar la primera como LEÍDA para que la guardia previa de `emitirFilas` no intervenga y
      // quede al descubierto lo que hace el ÍNDICE.
      const usuarios = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "usuario" LIMIT 1`,
      );
      expect(usuarios.length, "no hay ningún usuario en la base").toBe(1);
      const creada = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "notificacion" WHERE "entidad_id" = $1`,
        entidadFija,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "notificacion_lectura" ("id","notificacion_id","usuario_id","leida_at")
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        randomUUID(),
        creada[0].id,
        usuarios[0].id,
      );

      const dia2 = await crearConSavepoint(tx, repo, {
        tipo: "alert",
        evento: "novedades_sin_gestionar",
        descripcion: "aviso del día 2",
        anexo: null,
        entidadTipo: "novedades_sin_gestionar_dia",
        entidadId: entidadFija, // ⚠️ LA MUTACIÓN: la misma entidad al día siguiente
        destinatario: { tipo: "rol", rol: "adminTienda", tiendaId: tienda },
      });
      return { dia1, dia2, filas: await avisosDe(tx, tienda) };
    });

    expect(r.dia1).toBe(true);
    expect(r.dia2).toBe(false); // el `P2002` absorbido: SIN error, SIN log y SIN aviso
    expect(r.filas).toHaveLength(1);
  });
});

describeSiHayBase("409/R42 — CADA tienda recibe SU aviso el mismo día", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ dos tiendas con novedades el mismo día -> DOS filas, una para cada una", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks, "la tabla `orden` está vacía: el caso no se puede medir").not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaA = await crearTienda(tx, fks!.tiendaId);
      const tiendaB = await crearTienda(tx, fks!.tiendaId);
      const repo = new NotificacionRepository(tx);

      const a = await emitirNovedadesSinGestionar(
        repo,
        { ...CTX_BASE, tiendaId: tiendaA, diaCR: DIA_1 },
        tx,
      );
      const b = await emitirNovedadesSinGestionar(
        repo,
        { ...CTX_BASE, tiendaId: tiendaB, diaCR: DIA_1 },
        tx,
      );
      return {
        a,
        b,
        filasA: await avisosDe(tx, tiendaA),
        filasB: await avisosDe(tx, tiendaB),
        entidadA: `${tiendaA}:${DIA_1}`,
        entidadB: `${tiendaB}:${DIA_1}`,
      };
    });

    expect(r.a).toBe(1);
    expect(r.b).toBe(1); // ⚠️ AQUÍ MUERE LA MUTACIÓN: sin el `tiendaId` en la entidad, esto es 0
    expect(r.filasA.map((f) => f.entidad_id)).toEqual([r.entidadA]);
    expect(r.filasB.map((f) => f.entidad_id)).toEqual([r.entidadB]);
  });

  it("⭑ MUTACIÓN R42: quitar el `tiendaId` de la entidad silencia a la SEGUNDA tienda", async () => {
    // La mutación, reproducida a pelo contra el índice REAL. Las dos filas comparten
    // ('novedades_sin_gestionar', '<día>', 'adminTienda', NULL) porque `tienda_id` NO está en la
    // clave: la segunda se descarta y NADIE se entera.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaA = await crearTienda(tx, fks!.tiendaId);
      const tiendaB = await crearTienda(tx, fks!.tiendaId);
      const repo = new NotificacionRepository(tx);

      const fila = (tiendaId: string) => ({
        tipo: "alert" as const,
        evento: "novedades_sin_gestionar" as const,
        descripcion: "aviso agregado",
        anexo: null,
        entidadTipo: "novedades_sin_gestionar_dia" as const,
        entidadId: DIA_1, // ⚠️ LA MUTACIÓN: el día A SECAS, sin la tienda
        destinatario: { tipo: "rol" as const, rol: "adminTienda" as const, tiendaId },
      });

      const a = await crearConSavepoint(tx, repo, fila(tiendaA));
      const b = await crearConSavepoint(tx, repo, fila(tiendaB));
      return { a, b, filasB: await avisosDe(tx, tiendaB) };
    });

    expect(r.a).toBe(true);
    expect(r.b).toBe(false); // la segunda tienda queda MUDA
    expect(r.filasB).toHaveLength(0);
  });

  it("⭑ CONTROL sobre el motor: con el `tiendaId` dentro, las dos filas conviven", async () => {
    // El control positivo del caso anterior: si el `INSERT` fallara por cualquier otra cosa, aquel
    // test estaría verde midiendo su propio ruido.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaA = await crearTienda(tx, fks!.tiendaId);
      const tiendaB = await crearTienda(tx, fks!.tiendaId);
      const repo = new NotificacionRepository(tx);

      const fila = (tiendaId: string) => ({
        tipo: "alert" as const,
        evento: "novedades_sin_gestionar" as const,
        descripcion: "aviso agregado",
        anexo: null,
        entidadTipo: "novedades_sin_gestionar_dia" as const,
        entidadId: `${tiendaId}:${DIA_1}`, // la forma REAL
        destinatario: { tipo: "rol" as const, rol: "adminTienda" as const, tiendaId },
      });

      return {
        a: await crearConSavepoint(tx, repo, fila(tiendaA)),
        b: await crearConSavepoint(tx, repo, fila(tiendaB)),
        filasB: await avisosDe(tx, tiendaB),
      };
    });

    expect(r.a).toBe(true);
    expect(r.b).toBe(true);
    expect(r.filasB).toHaveLength(1);
  });
});
