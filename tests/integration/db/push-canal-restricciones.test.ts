import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PushSuscripcionRepository } from "@/lib/repositories/PushSuscripcionRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 410 (T1.4) — LAS RESTRICCIONES DEL CANAL, MEDIDAS CONTRA POSTGRES.
//
// POR QUE ESTE ARCHIVO EXISTE Y POR QUE NO PUEDE SER UN TEST DE SERVICIO. Todo lo que se afirma
// aqui vive EN EL MOTOR: `endpoint` UNIQUE es un indice, el reemplazo de dueno lo hace un
// `ON CONFLICT`, la cascada la ejecuta una FK y la RLS es una propiedad del catalogo. Un doble no ve
// el SQL —medido cuatro veces en este repo—, asi que una mutacion del DDL pasaria en verde por el
// camino de los servicios.
//
// Cubre R16 (una fila por endpoint), R17 (el mismo dispositivo ACTUALIZA, no duplica), R18 (otra
// persona en el mismo telefono se lleva la suscripcion), R22 (borrar el usuario arrastra sus
// suscripciones y sus cupos), R6/R7 (el cupo diario rechaza el segundo INSERT) y R47 (RLS).
//
// Todo lo que escribe corre dentro de `enTransaccionRevertida`: si el test pasa, si falla o si el
// proceso muere a mitad, no queda ni una fila en la base compartida.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const ENDPOINT = (n: string) => `https://fcm.googleapis.com/fcm/send/410-${n}`;

/** Clona la identidad de un usuario existente para crear uno propio del test. */
async function crearUsuario(tx: TxDeTest, modeloUsuarioId: string): Promise<string> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "usuario"
       ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","updated_at")
     SELECT $1, '410 usuario de prueba', $2, '00000000', 'x', $3,
            u."tipo_identificacion_id", u."rol_id", CURRENT_TIMESTAMP
       FROM "usuario" u WHERE u."id" = $4`,
    id,
    `410-canal-${id}@test.local`,
    `410c-${id.slice(0, 12)}`,
    modeloUsuarioId,
  );
  return id;
}

interface FilaSuscripcion {
  id: string;
  usuario_id: string;
  endpoint: string;
  p256dh: string;
}

async function suscripcionesDe(tx: TxDeTest, endpoint: string): Promise<FilaSuscripcion[]> {
  return tx.$queryRawUnsafe<FilaSuscripcion[]>(
    `SELECT "id","usuario_id","endpoint","p256dh" FROM "push_suscripcion" WHERE "endpoint" = $1`,
    endpoint,
  );
}

describeSiHayBase("410/R16-R18 — la identidad de una suscripcion es su `endpoint`", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ R17: el MISMO dispositivo dos veces deja UNA fila, con las claves renovadas", async () => {
    const fks = await fksDeOrden(prisma);
    // ⚠️ FALLA RUIDOSAMENTE si la base esta vacia: sin un usuario del que clonar la identidad el
    // caso no se puede medir, y un `return` temprano lo reportaria `passed` sin comprobar nada.
    expect(fks, "la tabla `orden` esta vacia: el caso no se puede medir").not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuario = await crearUsuario(tx, fks!.tiendaId);
      const repo = new PushSuscripcionRepository(tx as unknown as PrismaClient);
      const endpoint = ENDPOINT(randomUUID());

      await repo.registrar(usuario, { endpoint, p256dh: "CLAVE-1", auth: "AUTH-1" });
      // La renovacion del navegador: mismo endpoint, claves nuevas.
      await repo.registrar(usuario, { endpoint, p256dh: "CLAVE-2", auth: "AUTH-2" });

      return { filas: await suscripcionesDe(tx, endpoint) };
    });

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].p256dh).toBe("CLAVE-2");
  });

  it("⭑ R18: otra persona inicia sesion en el mismo telefono y la suscripcion CAMBIA de dueno", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, fks!.tiendaId);
      const beto = await crearUsuario(tx, fks!.tiendaId);
      const repo = new PushSuscripcionRepository(tx as unknown as PrismaClient);
      const endpoint = ENDPOINT(randomUUID());

      await repo.registrar(ana, { endpoint, p256dh: "K", auth: "A" });
      await repo.registrar(beto, { endpoint, p256dh: "K", auth: "A" });

      return {
        filas: await suscripcionesDe(tx, endpoint),
        deAna: await repo.listarPorUsuarios([ana]),
        deBeto: await repo.listarPorUsuarios([beto]),
        ana,
        beto,
      };
    });

    // UNA sola fila, y es de Beto. Ana deja de recibir ahi SIN una linea de codigo que «detecte el
    // cambio de dueno»: lo hace el `ON CONFLICT (endpoint)`.
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].usuario_id).toBe(r.beto);
    expect(r.deAna).toHaveLength(0);
    expect(r.deBeto).toHaveLength(1);
  });

  it("⭑ MUTACION R18: con la unicidad en (usuario, endpoint) habria DOS filas vivas", async () => {
    // Se reproduce a pelo contra el motor lo que pasaria si `endpoint` NO fuera unico: dos
    // `INSERT` con el mismo endpoint y distinto usuario. El indice REAL lo impide; aqui se mide
    // que lo impide de verdad y no por una rama de codigo.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, fks!.tiendaId);
      const beto = await crearUsuario(tx, fks!.tiendaId);
      const endpoint = ENDPOINT(randomUUID());

      await tx.$executeRawUnsafe(
        `INSERT INTO "push_suscripcion" ("id","usuario_id","endpoint","p256dh","auth","updated_at")
         VALUES ($1,$2,$3,'K','A',CURRENT_TIMESTAMP)`,
        randomUUID(),
        ana,
        endpoint,
      );

      // El segundo `INSERT` a pelo VIOLA el indice. Se aisla en un savepoint para poder seguir
      // mirando la base despues (sin el, Postgres aborta la transaccion entera con `25P02`).
      const punto = `sp_${randomUUID().replace(/-/g, "")}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
      let violo = false;
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO "push_suscripcion" ("id","usuario_id","endpoint","p256dh","auth","updated_at")
           VALUES ($1,$2,$3,'K','A',CURRENT_TIMESTAMP)`,
          randomUUID(),
          beto,
          endpoint,
        );
      } catch {
        violo = true;
      }
      await tx.$executeRawUnsafe(
        violo ? `ROLLBACK TO SAVEPOINT ${punto}` : `RELEASE SAVEPOINT ${punto}`,
      );

      return { violo, filas: await suscripcionesDe(tx, endpoint) };
    });

    expect(r.violo, "el indice unico sobre `endpoint` NO esta").toBe(true);
    expect(r.filas).toHaveLength(1);
  });
});

describeSiHayBase("410/R22 — borrar el usuario se lleva sus suscripciones Y sus cupos", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ CASCADE en las dos tablas, ejercitado contra el motor", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuario = await crearUsuario(tx, fks!.tiendaId);
      const repo = new PushSuscripcionRepository(tx as unknown as PrismaClient);
      const endpoint = ENDPOINT(randomUUID());

      await repo.registrar(usuario, { endpoint, p256dh: "K", auth: "A" });
      await repo.tomarCupoDelDia({
        usuarioId: usuario,
        evento: "cierre_dia_vencido",
        diaCr: "2091-07-01",
        notificacionId: randomUUID(),
      });

      const antes = {
        sus: (await suscripcionesDe(tx, endpoint)).length,
        cupos: await contarCupos(tx, usuario),
      };

      await tx.$executeRawUnsafe(`DELETE FROM "usuario" WHERE "id" = $1`, usuario);

      return {
        antes,
        despues: {
          sus: (await suscripcionesDe(tx, endpoint)).length,
          cupos: await contarCupos(tx, usuario),
        },
      };
    });

    // CONTROL POSITIVO: sin esto, un `DELETE` que fallara en silencio dejaria el caso verde
    // comparando dos ceros.
    expect(r.antes).toEqual({ sus: 1, cupos: 1 });
    expect(r.despues).toEqual({ sus: 0, cupos: 0 });
  });
});

async function contarCupos(tx: TxDeTest, usuarioId: string): Promise<number> {
  const filas = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM "push_envio_dia" WHERE "usuario_id" = $1`,
    usuarioId,
  );
  return Number(filas[0].n);
}

describeSiHayBase("410/R6 — el cupo del dia rechaza el SEGUNDO insert del mismo trio", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ el primero gana, el segundo devuelve `false` y no crea fila", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuario = await crearUsuario(tx, fks!.tiendaId);
      const repo = new PushSuscripcionRepository(tx as unknown as PrismaClient);
      const base = { usuarioId: usuario, evento: "cierre_dia_vencido" as const, diaCr: "2091-07-01" };

      // Cada toma va en su savepoint: la segunda VIOLA el indice y sin aislarla Postgres abortaria
      // la transaccion entera (`25P02`) y el test no podria mirar como quedo la base. En
      // produccion cada `INSERT` va en su propia transaccion, asi que `false` es lo que se ve.
      const primero = await tomarConSavepoint(tx, repo, { ...base, notificacionId: "n-1" });
      const segundo = await tomarConSavepoint(tx, repo, { ...base, notificacionId: "n-2" });
      // Otro DIA: el recordatorio diario es estructural.
      const otroDia = await tomarConSavepoint(tx, repo, {
        ...base,
        diaCr: "2091-07-02",
        notificacionId: "n-3",
      });
      // Otro EVENTO el mismo dia: cada tipo tiene su cupo.
      const otroEvento = await tomarConSavepoint(tx, repo, {
        ...base,
        evento: "dia_reparto_corregido",
        notificacionId: "n-4",
      });

      return {
        primero,
        segundo,
        otroDia,
        otroEvento,
        cupos: await contarCupos(tx, usuario),
        // Y el cupo recuerda QUE aviso lo gasto: es lo que el envio relee para saber a quien toca.
        deN1: await repo.usuariosConCupoDe("n-1"),
        deN2: await repo.usuariosConCupoDe("n-2"),
        usuario,
      };
    });

    expect(r.primero).toBe(true);
    expect(r.segundo).toBe(false); // ⚠️ AQUI MUERE LA MUTACION «quitar la toma de cupo»
    expect(r.otroDia).toBe(true);
    expect(r.otroEvento).toBe(true);
    expect(r.cupos).toBe(3);
    expect(r.deN1).toEqual([r.usuario]);
    expect(r.deN2).toEqual([]); // el segundo aviso no gano el cupo: no suena
  });
});

async function tomarConSavepoint(
  tx: TxDeTest,
  repo: PushSuscripcionRepository,
  toma: Parameters<PushSuscripcionRepository["tomarCupoDelDia"]>[0],
): Promise<boolean> {
  const punto = `sp_${randomUUID().replace(/-/g, "")}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
  const gano = await repo.tomarCupoDelDia(toma);
  await tx.$executeRawUnsafe(gano ? `RELEASE SAVEPOINT ${punto}` : `ROLLBACK TO SAVEPOINT ${punto}`);
  return gano;
}

describeSiHayBase("410/R47 — las dos tablas tienen RLS habilitada", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ `relrowsecurity` es true en `push_suscripcion` y en `push_envio_dia`", async () => {
    // La RLS es una propiedad del CATALOGO de Postgres: ninguna regex sobre el `.sql` demuestra
    // que este aplicada, y ningun doble la ve. Patron `jobs` / `notificacion` / `gasto_fijo_cobro`:
    // habilitada SIN policies, porque este repo no usa Supabase Auth (sesion propia, sin
    // `auth.uid()`) y la autorizacion de negocio vive en la Server Action. Lo que garantiza es lo
    // que R47 pide: a estas filas —credenciales de entrega— no se llega salvo por el servidor.
    const filas = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('push_suscripcion','push_envio_dia')
        ORDER BY c.relname`,
    );
    // AUTOCOMPROBACION: si las tablas no existieran, la lista saldria vacia y el `every` de abajo
    // seria verde por vacio.
    expect(filas.map((f) => f.relname)).toEqual(["push_envio_dia", "push_suscripcion"]);
    for (const fila of filas) {
      expect(fila.relrowsecurity, `${fila.relname} sin RLS`).toBe(true);
    }
  });

  it("y no tienen policies, igual que sus hermanas de solo servicio", async () => {
    const filas = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('push_suscripcion','push_envio_dia')`,
    );
    expect(Number(filas[0].n)).toBe(0);
  });
});
