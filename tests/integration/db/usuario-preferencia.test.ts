import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { UsuarioPreferenciaRepository } from "@/lib/repositories/UsuarioPreferenciaRepository";
import { PushSuscripcionRepository } from "@/lib/repositories/PushSuscripcionRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  crearPrismaDeTestEnEsquema,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 422 (T1.4 — R2, R3, R7, y la unicidad estructural) — EL REPOSITORIO DE LA PREFERENCIA,
// CONTRA POSTGRES DE VERDAD.
//
// ---------------------------------------------------------------------------------------------
// POR QUE ESTO NO PUEDE SER UN TEST DE SERVICIO CON DOBLES
// ---------------------------------------------------------------------------------------------
// Todo lo que se afirma aqui vive EN EL MOTOR: que sin fila la respuesta sea `false` es el `where`
// por indice unico; que dos escrituras dejen UNA fila lo hace el `ON CONFLICT (usuario_id)`; que
// la exclusion sea ESTRUCTURAL lo hace el indice unico y no una comprobacion de codigo. Un doble no
// ve el SQL —medido cuatro veces en este repo—, asi que una mutacion del DDL o del `where` pasaria
// en verde por el camino de los servicios.
//
// Lo que escribe sobre las tablas REALES corre dentro de `enTransaccionRevertida`: si el test pasa,
// si falla o si el proceso muere a mitad, no queda ni una fila en la base compartida. La CARRERA,
// que necesita dos conexiones que commitean de verdad, va en un ESQUEMA DESECHABLE aparte.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Clona la identidad de un usuario existente para crear uno propio del test. */
async function crearUsuario(tx: TxDeTest, modeloUsuarioId: string): Promise<string> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "usuario"
       ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","updated_at")
     SELECT $1, '422 usuario de prueba', $2, '00000000', 'x', $3,
            u."tipo_identificacion_id", u."rol_id", CURRENT_TIMESTAMP
       FROM "usuario" u WHERE u."id" = $4`,
    id,
    `422-pref-${id}@test.local`,
    `422p-${id.slice(0, 12)}`,
    modeloUsuarioId,
  );
  return id;
}

async function filasDe(tx: TxDeTest, usuarioId: string) {
  return tx.$queryRawUnsafe<{ id: string; avisos_push: boolean; intacta: boolean }[]>(
    `SELECT "id", "avisos_push", ("updated_at" = "created_at") AS intacta
       FROM "usuario_preferencia" WHERE "usuario_id" = $1`,
    usuarioId,
  );
}

describeSiHayBase("422/R2 — sin fila, la preferencia es «no puesta», y LEER no crea nada", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ sin fila, `avisosPushDe` devuelve `false`", async () => {
    const fks = await fksDeOrden(prisma);
    // ⚠️ FALLA RUIDOSAMENTE si la base esta vacia: sin un usuario del que clonar la identidad el
    // caso no se puede medir, y un `return` temprano lo reportaria `passed` sin comprobar nada.
    expect(fks, "la tabla `orden` esta vacia: el caso no se puede medir").not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuario = await crearUsuario(tx, fks!.tiendaId);
      const repo = new UsuarioPreferenciaRepository(tx as unknown as PrismaClient);

      const quiere = await repo.avisosPushDe(usuario);
      // Y LEER NO ESCRIBE: el layout del portal llama a esto en cada carga.
      return { quiere, filas: await filasDe(tx, usuario) };
    });

    expect(r.quiere).toBe(false);
    expect(r.filas).toEqual([]);
  });

  it("⭑ control positivo: con la fila puesta devuelve `true`", async () => {
    // Sin esto, el caso de arriba pasaria en verde con un repositorio que devolviera `false`
    // siempre — que es justo el fallo mudo que rompe la reactivacion entera.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuario = await crearUsuario(tx, fks!.tiendaId);
      const repo = new UsuarioPreferenciaRepository(tx as unknown as PrismaClient);
      await repo.fijarAvisosPush(usuario, true);
      return repo.avisosPushDe(usuario);
    });

    expect(r).toBe(true);
  });

  it("⭑ y la preferencia de OTRA persona no se cuela: el `where` lleva su `usuario_id`", async () => {
    // El `WHERE` se prueba donde vive. Si el repositorio leyera «la primera fila que haya», esto
    // se pone rojo — y en produccion significaria aplicarle a alguien la decision de otro.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, fks!.tiendaId);
      const beto = await crearUsuario(tx, fks!.tiendaId);
      const repo = new UsuarioPreferenciaRepository(tx as unknown as PrismaClient);
      await repo.fijarAvisosPush(ana, true);
      return { deAna: await repo.avisosPushDe(ana), deBeto: await repo.avisosPushDe(beto) };
    });

    expect(r).toEqual({ deAna: true, deBeto: false });
  });
});

describeSiHayBase("422/R3+R7 — `fijarAvisosPush` es un UPSERT: una fila por persona", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ dos escrituras seguidas dejan UNA fila, con el ultimo valor", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuario = await crearUsuario(tx, fks!.tiendaId);
      const repo = new UsuarioPreferenciaRepository(tx as unknown as PrismaClient);

      await repo.fijarAvisosPush(usuario, true); // activo los avisos
      const trasActivar = await filasDe(tx, usuario);
      await repo.fijarAvisosPush(usuario, false); // y luego los apago (R7)
      const trasApagar = await filasDe(tx, usuario);

      return { trasActivar, trasApagar, valor: await repo.avisosPushDe(usuario) };
    });

    expect(r.trasActivar).toHaveLength(1);
    expect(r.trasActivar[0].avisos_push).toBe(true);
    // UNA fila, la MISMA: el upsert actualiza, no acumula historia.
    expect(r.trasApagar).toHaveLength(1);
    expect(r.trasApagar[0].id).toBe(r.trasActivar[0].id);
    expect(r.trasApagar[0].avisos_push).toBe(false);
    expect(r.valor).toBe(false);
  });

  it("⭑ actualizar toca `updated_at` y NO `created_at`", async () => {
    // De esto depende la comprobacion del backfill contra produccion (`updated_at = created_at`
    // demuestra que nada mas toco esas filas). Si el `update` reescribiera `created_at`, aquella
    // medicion seria verde siempre y no significaria nada.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuario = await crearUsuario(tx, fks!.tiendaId);
      const repo = new UsuarioPreferenciaRepository(tx as unknown as PrismaClient);
      await repo.fijarAvisosPush(usuario, true);
      const recienCreada = await filasDe(tx, usuario);
      // Un respiro para que los dos sellos no caigan en el mismo milisegundo.
      await new Promise((r) => setTimeout(r, 5));
      await repo.fijarAvisosPush(usuario, false);
      return { recienCreada, actualizada: await filasDe(tx, usuario) };
    });

    expect(r.recienCreada[0].intacta).toBe(true);
    expect(r.actualizada[0].intacta).toBe(false);
  });

  it("⭑ MUTACION M10, medida contra el MOTOR: la exclusion la da el INDICE UNICO", async () => {
    // Se reproduce a pelo lo que pasaria si `usuario_id` NO fuera unico: dos `INSERT` con el mismo
    // `usuario_id`. El indice REAL lo impide; aqui se mide que lo impide de verdad y no por una
    // rama de codigo. Con un indice normal en vez de unico, `violo` seria `false` y saldrian DOS
    // filas — y ademas el `ON CONFLICT (usuario_id)` del upsert dejaria de existir.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuario = await crearUsuario(tx, fks!.tiendaId);

      await tx.$executeRawUnsafe(
        `INSERT INTO "usuario_preferencia" ("id","usuario_id","avisos_push") VALUES ($1,$2,TRUE)`,
        randomUUID(),
        usuario,
      );

      // El segundo `INSERT` VIOLA el indice. Se aisla en un savepoint para poder seguir mirando la
      // base despues (sin el, Postgres aborta la transaccion entera con `25P02`).
      const punto = `sp_${randomUUID().replace(/-/g, "")}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
      let violo = false;
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO "usuario_preferencia" ("id","usuario_id","avisos_push") VALUES ($1,$2,FALSE)`,
          randomUUID(),
          usuario,
        );
      } catch {
        violo = true;
      }
      await tx.$executeRawUnsafe(
        violo ? `ROLLBACK TO SAVEPOINT ${punto}` : `RELEASE SAVEPOINT ${punto}`,
      );

      return { violo, filas: await filasDe(tx, usuario) };
    });

    expect(r.violo, "el indice unico sobre `usuario_id` NO esta").toBe(true);
    expect(r.filas).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LA CARRERA DE VERDAD — DOS CONEXIONES QUE COMMITEAN
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ POR QUE NO VALE UN `Promise.all` DENTRO DE LA TRANSACCION DEL TEST. Ahi las dos escrituras
// comparten CONEXION: se serializan solas y la segunda ve lo que la primera acaba de escribir. O
// sea que pasaria en verde tambien con un `findFirst` + `create`, que es exactamente la
// implementacion que este diseno descarta. Una carrera solo se mide con dos conexiones reales.
//
// COMO SE EVITA ENSUCIAR LA BASE COMPARTIDA: un ESQUEMA DESECHABLE con un clon ESTRUCTURAL de la
// tabla real (`CREATE TABLE ... LIKE ... INCLUDING ALL`, que copia el indice unico) al que se
// apuntan los dos clientes con `PrismaPgOptions.schema`. El `LIKE` NO copia la clave ajena, asi que
// no hace falta sembrar usuarios. Al terminar, `DROP SCHEMA ... CASCADE`. Tecnica de
// `push-cupo-carrera.test.ts`.

const ESQUEMA_CARRERA = `t422_carrera_${Date.now().toString(36)}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;

describeSiHayBase("422 — dos pestanas activando a la vez dejan UNA sola fila", () => {
  let admin: PrismaClient;
  let pestanaA: PrismaClient;
  let pestanaB: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${ESQUEMA_CARRERA}"`);
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${ESQUEMA_CARRERA}"."usuario_preferencia"
         (LIKE "public"."usuario_preferencia" INCLUDING ALL)`,
    );
    pestanaA = crearPrismaDeTestEnEsquema(ESQUEMA_CARRERA);
    pestanaB = crearPrismaDeTestEnEsquema(ESQUEMA_CARRERA);
  });

  afterAll(async () => {
    await Promise.all([pestanaA?.$disconnect(), pestanaB?.$disconnect()]);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ESQUEMA_CARRERA}" CASCADE`);
    await admin.$disconnect();
  });

  it("⭑ el clon llevo consigo el INDICE UNICO (autocomprobacion de la carrera)", async () => {
    // Sin el indice, la carrera de abajo dejaria dos filas y el caso seria rojo por la razon
    // correcta; pero si el `LIKE` no hubiera copiado NADA, tambien seria rojo y no sabriamos cual
    // de las dos cosas falla. Esto lo separa.
    const indices = await admin.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'usuario_preferencia'`,
      ESQUEMA_CARRERA,
    );
    expect(indices.some((i) => i.indexdef.includes("UNIQUE") && /\(usuario_id\)/.test(i.indexdef))).toBe(
      true,
    );
  });

  it("⭑ dos escrituras CONCURRENTES dejan una fila y ningun error propagado", async () => {
    const usuario = `carrera-${randomUUID()}`;
    const repoA = new UsuarioPreferenciaRepository(pestanaA);
    const repoB = new UsuarioPreferenciaRepository(pestanaB);

    // Dos conexiones distintas, a la vez, sobre la MISMA persona. Es lo que pasa cuando alguien
    // tiene dos pestanas abiertas y las dos reactivan al entrar.
    await expect(
      Promise.all([repoA.fijarAvisosPush(usuario, true), repoB.fijarAvisosPush(usuario, true)]),
    ).resolves.toBeDefined();

    const filas = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${ESQUEMA_CARRERA}"."usuario_preferencia" WHERE "usuario_id" = $1`,
      usuario,
    );
    expect(Number(filas[0].n)).toBe(1);
    expect(await repoA.avisosPushDe(usuario)).toBe(true);
  });

  it("⭑ y una carrera entre ACTIVAR y APAGAR tampoco duplica: gana el ultimo, pero hay UNA fila", async () => {
    const usuario = `carrera2-${randomUUID()}`;
    const repoA = new UsuarioPreferenciaRepository(pestanaA);
    const repoB = new UsuarioPreferenciaRepository(pestanaB);

    await Promise.all([repoA.fijarAvisosPush(usuario, true), repoB.fijarAvisosPush(usuario, false)]);

    const filas = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${ESQUEMA_CARRERA}"."usuario_preferencia" WHERE "usuario_id" = $1`,
      usuario,
    );
    // No se inventa ningun bloqueo: gana quien escriba despues. Lo que NO puede pasar es que haya
    // dos filas y la lectura dependa de cual salga primero.
    expect(Number(filas[0].n)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R22 (T6.1) — DOS PESTANAS REACTIVANDO EL MISMO DISPOSITIVO A LA VEZ
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Es la carrera de la REACTIVACION, no la de la preferencia: dos pestanas del portal abiertas, las
// dos cargan, las dos reactivan. El navegador devuelve LA MISMA suscripcion para el mismo registro
// y la misma clave, asi que las dos llegan al servidor con el MISMO `endpoint`.
//
// ⚠️ R22 EXIGE QUE LA EXCLUSION SEA ESTRUCTURAL, no una comprobacion previa. La diferencia no es de
// estilo: un `findFirst` + `create` deja abierta la rendija entre la lectura y la escritura, y por
// ahi caben dos INSERT. Ese fallo NO ROMPE NINGUN test de servicio —deja dos filas y la lectura
// empieza a depender de cual salga primero—, y en produccion significa DOS avisos por cada uno.
// Por eso se mide contra el motor, con dos conexiones que commitean de verdad.

const ESQUEMA_ENDPOINT = `t422_endpoint_${Date.now().toString(36)}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;

describeSiHayBase("422/R22 — dos pestanas registrando el MISMO endpoint dejan UNA sola fila", () => {
  let admin: PrismaClient;
  let pestanaA: PrismaClient;
  let pestanaB: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${ESQUEMA_ENDPOINT}"`);
    // El clon REAL: `INCLUDING ALL` se trae el indice unico de `endpoint`. El `LIKE` no copia la
    // clave ajena, asi que no hace falta sembrar usuarios.
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${ESQUEMA_ENDPOINT}"."push_suscripcion"
         (LIKE "public"."push_suscripcion" INCLUDING ALL)`,
    );
    // Y un clon GEMELO SIN INDICES (`INCLUDING DEFAULTS` copia los valores por defecto y NADA mas):
    // es el mundo contrafactico contra el que se mide que la exclusion la da el indice.
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${ESQUEMA_ENDPOINT}"."push_suscripcion_sin_unico"
         (LIKE "public"."push_suscripcion" INCLUDING DEFAULTS)`,
    );
    pestanaA = crearPrismaDeTestEnEsquema(ESQUEMA_ENDPOINT);
    pestanaB = crearPrismaDeTestEnEsquema(ESQUEMA_ENDPOINT);
  });

  afterAll(async () => {
    await Promise.all([pestanaA?.$disconnect(), pestanaB?.$disconnect()]);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ESQUEMA_ENDPOINT}" CASCADE`);
    await admin.$disconnect();
  });

  it("⭑ autocomprobacion: el clon real lleva el UNIQUE de `endpoint` y el gemelo NO", async () => {
    // Sin esto, la carrera de abajo podria estar verde por una razon equivocada —un `LIKE` que no
    // copio nada, o un gemelo que si copio el indice— y el contraste no significaria nada.
    const indicesDe = (tabla: string) =>
      admin.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
        ESQUEMA_ENDPOINT,
        tabla,
      );
    const unicoDeEndpoint = (filas: { indexdef: string }[]) =>
      filas.some((i) => i.indexdef.includes("UNIQUE") && /\(endpoint\)/.test(i.indexdef));

    expect(unicoDeEndpoint(await indicesDe("push_suscripcion"))).toBe(true);
    expect(unicoDeEndpoint(await indicesDe("push_suscripcion_sin_unico"))).toBe(false);
  });

  it("⭑ las dos reactivaciones concurrentes dejan UNA fila para ese dispositivo", async () => {
    const usuario = `pestanas-${randomUUID()}`;
    const endpoint = `https://fcm.googleapis.com/fcm/send/422-dos-pestanas-${randomUUID()}`;
    const canalA = new PushSuscripcionRepository(pestanaA);
    const canalB = new PushSuscripcionRepository(pestanaB);

    await expect(
      Promise.all([
        canalA.registrar(usuario, { endpoint, p256dh: "K", auth: "A", etiqueta: "Chrome en Android" }),
        canalB.registrar(usuario, { endpoint, p256dh: "K", auth: "A", etiqueta: "Chrome en Android" }),
      ]),
    ).resolves.toBeDefined();

    const filas = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${ESQUEMA_ENDPOINT}"."push_suscripcion" WHERE "endpoint" = $1`,
      endpoint,
    );
    expect(Number(filas[0].n)).toBe(1);
  });

  it("⭑ y la exclusion es ESTRUCTURAL: sin el UNIQUE, las mismas dos escrituras dejan DOS filas", async () => {
    // El contrafactico, a pelo y contra el motor. En la tabla REAL el segundo INSERT viola; en la
    // gemela sin indice pasa y quedan dos filas vivas para el mismo dispositivo — o sea, dos avisos
    // por cada uno. Esto es lo que convierte «una fila» en una propiedad del ESQUEMA y no una
    // casualidad del orden en que llegaron las dos pestanas.
    const usuario = `estructural-${randomUUID()}`;
    const endpoint = `https://fcm.googleapis.com/fcm/send/422-estructural-${randomUUID()}`;
    const insertar = (tabla: string) =>
      admin.$executeRawUnsafe(
        `INSERT INTO "${ESQUEMA_ENDPOINT}"."${tabla}"
           ("id","usuario_id","endpoint","p256dh","auth","updated_at")
         VALUES ($1,$2,$3,'K','A',CURRENT_TIMESTAMP)`,
        randomUUID(),
        usuario,
        endpoint,
      );

    await insertar("push_suscripcion");
    let violo = false;
    try {
      await insertar("push_suscripcion");
    } catch {
      violo = true;
    }

    await insertar("push_suscripcion_sin_unico");
    await insertar("push_suscripcion_sin_unico");

    const contar = async (tabla: string) => {
      const filas = await admin.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::bigint AS n FROM "${ESQUEMA_ENDPOINT}"."${tabla}" WHERE "endpoint" = $1`,
        endpoint,
      );
      return Number(filas[0].n);
    };

    expect(violo, "el indice unico sobre `endpoint` NO esta haciendo su trabajo").toBe(true);
    expect(await contar("push_suscripcion")).toBe(1);
    // Y el mundo sin indice: DOS filas, sin que nada se queje.
    expect(await contar("push_suscripcion_sin_unico")).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 410/R19 — LO QUE LA 422 NO PUEDE EROSIONAR
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describeSiHayBase("410/R19 intacto — la preferencia NO toca las suscripciones de los demas dispositivos", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ dar de baja UN dispositivo deja vivo el otro de la misma persona", async () => {
    // ⚠️ ES LA PROPIEDAD MEDIDA EN PRODUCCION: la suscripcion de «Firefox en Windows», donde no se
    // cerro sesion, sigue viva. La 422 no puede erosionarla. Si alguien resolviera la pregunta
    // abierta P1 en el otro sentido —apagar en un dispositivo retira las suscripciones de todos—,
    // este caso se pone rojo, y aqui vive el `WHERE` que lo decide.
    const fks = await fksDeOrden(prisma);
    expect(fks, "la tabla `orden` esta vacia: el caso no se puede medir").not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuario = await crearUsuario(tx, fks!.tiendaId);
      const canal = new PushSuscripcionRepository(tx as unknown as PrismaClient);
      const preferencias = new UsuarioPreferenciaRepository(tx as unknown as PrismaClient);
      const telefono = `https://fcm.googleapis.com/fcm/send/422-telefono-${randomUUID()}`;
      const computadora = `https://fcm.googleapis.com/fcm/send/422-firefox-${randomUUID()}`;

      await canal.registrar(usuario, { endpoint: telefono, p256dh: "K1", auth: "A1", etiqueta: "Chrome en Android" });
      await canal.registrar(usuario, { endpoint: computadora, p256dh: "K2", auth: "A2", etiqueta: "Firefox en Windows" });
      await preferencias.fijarAvisosPush(usuario, true);
      const antes = await canal.listarPorUsuarios([usuario]);

      // Lo que hace apagar el interruptor EN EL TELEFONO: baja de ESE dispositivo...
      await canal.eliminarDeUsuario(usuario, telefono);
      // ...y borrado de la preferencia de la PERSONA (R7).
      await preferencias.fijarAvisosPush(usuario, false);

      return {
        antes: antes.map((s) => s.endpoint).sort(),
        despues: (await canal.listarPorUsuarios([usuario])).map((s) => s.endpoint),
        preferencia: await preferencias.avisosPushDe(usuario),
      };
    });

    // CONTROL POSITIVO: habia DOS. Sin esto, un registro que fallara en silencio dejaria el caso
    // verde comparando dos listas vacias.
    expect(r.antes).toHaveLength(2);
    // Y queda LA DE LA COMPUTADORA. Borrar la preferencia NO retira suscripciones.
    expect(r.despues).toHaveLength(1);
    expect(r.despues[0]).toContain("422-firefox-");
    expect(r.preferencia).toBe(false);
  });

  it("⭑ y borrar la preferencia SOLA no retira ninguna suscripcion", async () => {
    // La otra mitad: `olvidarPreferenciaDeAvisos` escribe en `usuario_preferencia` y en ningun
    // sitio mas. Si algun dia alguien le anadiera un barrido de dispositivos, aqui se ve.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuario = await crearUsuario(tx, fks!.tiendaId);
      const canal = new PushSuscripcionRepository(tx as unknown as PrismaClient);
      const preferencias = new UsuarioPreferenciaRepository(tx as unknown as PrismaClient);
      const endpoint = `https://fcm.googleapis.com/fcm/send/422-solo-${randomUUID()}`;

      await canal.registrar(usuario, { endpoint, p256dh: "K", auth: "A" });
      const antes = await canal.listarPorUsuarios([usuario]);
      await preferencias.fijarAvisosPush(usuario, false);

      return { antes: antes.length, despues: (await canal.listarPorUsuarios([usuario])).length };
    });

    expect(r.antes).toBe(1);
    expect(r.despues).toBe(1);
  });
});
