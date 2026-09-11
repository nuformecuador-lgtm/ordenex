import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AvisoAgregadoRepository } from "@/lib/repositories/AvisoAgregadoRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 409 (T4.1) — LAS DOS CONSULTAS DE LA FICHA, CONTRA POSTGRES DE VERDAD.
//
// ⚠️ POR QUE AQUI Y NO CON UN DOBLE. Los dobles no ven el SQL: un doble demuestra que el doble hace
// lo que el doble hace. Y lo que esta ficha se juega en el `where` es exactamente lo que un doble
// taparia — que el predicado de represadas vigile `por_devolver` y NO `devolviendo_a_tienda`
// (R46), y que el ancla del «lleva N dias» sea la transicion `anclaje_devolucion` y NO el
// `created_at` ni el `updated_at` de la orden (R38). Es la leccion «probar el WHERE donde vive»,
// medida cuatro veces seguidas en este repo.
//
// ⚠️ TODO CORRE DENTRO DE UNA TRANSACCION QUE SIEMPRE SE REVIERTE. La base local es COMPARTIDA
// entre worktrees: si el test pasa, si falla o si el proceso muere a mitad, no queda una fila.
//
// ⚠️ Y NINGUN CASO PUEDE PASAR POR VACIO. Cada aserto positivo empieza comprobando que la siembra
// existe; sembrar cero filas tiene que hacer FALLAR el test, no pasarlo. Este repo ya midio lo que
// cuesta un `if (!fks) return;` que reporta `passed` sin comprobar nada.

const DIA_MS = 24 * 60 * 60 * 1000;
const AHORA = new Date("2091-06-15T12:00:00.000Z");
const ESTATUS_NOVEDAD = "devuelta";
const ESTATUS_REPRESADA = "por_devolver";
const ESTATUS_EN_TRANSITO = "devolviendo_a_tienda";

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

function hace(dias: number): Date {
  return new Date(AHORA.getTime() - dias * DIA_MS);
}

/** Crea una zona propia del test (nombre unico) para que ninguna otra fila de la base la ensucie. */
async function crearZona(tx: TxDeTest, etiqueta: string): Promise<string> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "zona" ("id","nombre") VALUES ($1, $2)`,
    id,
    `409-${etiqueta}-${id.slice(0, 8)}`,
  );
  return id;
}

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
    `409-${id}@test.local`,
    `409-${id.slice(0, 12)}`,
    modeloUsuarioId,
  );
  return id;
}

async function estatusIdDe(tx: TxDeTest, value: string): Promise<string> {
  const filas = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "order_status" WHERE "value" = $1`,
    value,
  );
  expect(filas.length, `no existe el estado "${value}" en el catalogo`).toBe(1);
  return filas[0].id;
}

interface SembrarOrden {
  tiendaId: string;
  zonaId: string;
  provinciaId: string;
  cantonId: string;
  estatusId: string;
  /** Instante que se escribe en `orden.created_at`. */
  creadaAt: Date;
  borrada?: boolean;
}

async function sembrarOrden(tx: TxDeTest, o: SembrarOrden): Promise<string> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "orden"
       ("id","num_remision","estatus_id","destinatario","telefono_dest","tienda_id","zona_id",
        "provincia_id","canton_id","producto","created_at","updated_at","deleted_at")
     VALUES ($1, $2, $3, 'destinatario 409', '00000000', $4, $5, $6, $7, 'producto 409',
             $8, $8, $9)`,
    id,
    `409-${id.slice(0, 18)}`,
    o.estatusId,
    o.tiendaId,
    o.zonaId,
    o.provinciaId,
    o.cantonId,
    o.creadaAt,
    o.borrada ? o.creadaAt : null,
  );
  return id;
}

/** Escribe una transicion de historial con destino `estatusDestinoId` en el instante dado. */
async function sembrarTransicion(
  tx: TxDeTest,
  ordenId: string,
  estatusDestinoId: string,
  origenTipo: string,
  cuando: Date,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO "orden_historial_estado"
       ("id","orden_id","estatus_destino_id","origen_tipo","created_at")
     VALUES ($1, $2, $3, $4::"orden_historial_origen_tipo", $5)`,
    randomUUID(),
    ordenId,
    estatusDestinoId,
    origenTipo,
    cuando,
  );
}

function repoDe(tx: TxDeTest): AvisoAgregadoRepository {
  return new AvisoAgregadoRepository(
    tx as unknown as PrismaClient,
    new OrdenRepository(tx as unknown as PrismaClient),
  );
}

describeSiHayBase("409/T4.1 — el resumen de NOVEDADES por tienda", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ (a) el conteo COINCIDE con el del listado de `/novedades` de esa tienda", async () => {
    const fks = await fksDeOrden(prisma);
    // ⚠️ FALLA RUIDOSAMENTE si la base esta vacia: un `if (!fks) return` reportaria `passed` sin
    // haber comprobado nada.
    expect(fks, "la tabla `orden` esta vacia: el caso no se puede medir").not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "nov");
      const tienda = await crearTienda(tx, fks!.tiendaId);
      const devuelta = await estatusIdDe(tx, ESTATUS_NOVEDAD);
      const base = {
        tiendaId: tienda,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: devuelta,
      };
      for (const dias of [2, 5, 9]) {
        const orden = await sembrarOrden(tx, { ...base, creadaAt: hace(dias + 1) });
        await sembrarTransicion(tx, orden, devuelta, "anclaje_devolucion", hace(dias));
      }
      const repo = repoDe(tx);
      const resumen = await repo.resumenNovedadesPorTienda();
      return {
        entrada: resumen.find((x) => x.tiendaId === tienda),
        // EL MISMO metodo que alimenta la pantalla, no una copia del `where`.
        delListado: await repo.contarNovedadesDeTienda(tienda),
      };
    });

    expect(r.entrada, "la tienda sembrada no aparece en el resumen").toBeDefined();
    expect(r.entrada!.total).toBe(3);
    expect(r.delListado).toBe(3);
    expect(r.entrada!.total).toBe(r.delListado);
  });

  it("⭑ (b) una orden de OTRA tienda no entra en el resumen de esta", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "nov-b");
      const tiendaA = await crearTienda(tx, fks!.tiendaId);
      const tiendaB = await crearTienda(tx, fks!.tiendaId);
      const devuelta = await estatusIdDe(tx, ESTATUS_NOVEDAD);
      const base = {
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: devuelta,
        creadaAt: hace(4),
      };
      const oA = await sembrarOrden(tx, { ...base, tiendaId: tiendaA });
      await sembrarTransicion(tx, oA, devuelta, "anclaje_devolucion", hace(3));
      const oB1 = await sembrarOrden(tx, { ...base, tiendaId: tiendaB });
      const oB2 = await sembrarOrden(tx, { ...base, tiendaId: tiendaB });
      await sembrarTransicion(tx, oB1, devuelta, "anclaje_devolucion", hace(3));
      await sembrarTransicion(tx, oB2, devuelta, "anclaje_devolucion", hace(3));

      const resumen = await repoDe(tx).resumenNovedadesPorTienda();
      return {
        a: resumen.find((x) => x.tiendaId === tiendaA),
        b: resumen.find((x) => x.tiendaId === tiendaB),
      };
    });

    expect(r.a?.total).toBe(1);
    expect(r.b?.total).toBe(2); // cada tienda con LO SUYO
  });

  it("⭑ (c) una orden BORRADA no entra", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "nov-c");
      const tienda = await crearTienda(tx, fks!.tiendaId);
      const devuelta = await estatusIdDe(tx, ESTATUS_NOVEDAD);
      const base = {
        tiendaId: tienda,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: devuelta,
        creadaAt: hace(4),
      };
      const viva = await sembrarOrden(tx, base);
      const borrada = await sembrarOrden(tx, { ...base, borrada: true });
      await sembrarTransicion(tx, viva, devuelta, "anclaje_devolucion", hace(3));
      await sembrarTransicion(tx, borrada, devuelta, "anclaje_devolucion", hace(9));

      const repo = repoDe(tx);
      const resumen = await repo.resumenNovedadesPorTienda();
      return {
        entrada: resumen.find((x) => x.tiendaId === tienda),
        delListado: await repo.contarNovedadesDeTienda(tienda),
      };
    });

    expect(r.entrada, "la siembra no llego: el caso no mide nada").toBeDefined();
    expect(r.entrada!.total).toBe(1);
    expect(r.delListado).toBe(1);
    // Y la borrada tampoco arrastra su antiguedad de 9 dias al `masAntiguaAt`.
    expect(r.entrada!.masAntiguaAt.toISOString()).toBe(hace(3).toISOString());
  });

  it("⭑ (d) R38: `masAntiguaAt` es el `anclaje_devolucion`, NO el `created_at` de la orden", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "nov-d");
      const tienda = await crearTienda(tx, fks!.tiendaId);
      const devuelta = await estatusIdDe(tx, ESTATUS_NOVEDAD);
      // La orden NACIO hace 40 dias y se ANCLO hace 3: son numeros muy distintos a proposito.
      const orden = await sembrarOrden(tx, {
        tiendaId: tienda,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: devuelta,
        creadaAt: hace(40),
      });
      await sembrarTransicion(tx, orden, devuelta, "anclaje_devolucion", hace(3));
      // Y ademas se TOCA la fila (lo que mueve `updated_at`), que es la otra fecha que NO sirve.
      await tx.$executeRawUnsafe(
        `UPDATE "orden" SET "notas" = 'tocada', "updated_at" = $2 WHERE "id" = $1`,
        orden,
        AHORA,
      );
      const resumen = await repoDe(tx).resumenNovedadesPorTienda();
      return resumen.find((x) => x.tiendaId === tienda);
    });

    expect(r, "la siembra no llego").toBeDefined();
    expect(r!.masAntiguaAt.toISOString()).toBe(hace(3).toISOString());
    expect(r!.masAntiguaAt.toISOString()).not.toBe(hace(40).toISOString()); // NO el created_at
    expect(r!.masAntiguaAt.toISOString()).not.toBe(AHORA.toISOString()); // NO el updated_at
  });

  it("⭑ (d bis) gana el anclaje MAS RECIENTE si la orden dio la vuelta y volvio", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "nov-dbis");
      const tienda = await crearTienda(tx, fks!.tiendaId);
      const devuelta = await estatusIdDe(tx, ESTATUS_NOVEDAD);
      const orden = await sembrarOrden(tx, {
        tiendaId: tienda,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: devuelta,
        creadaAt: hace(40),
      });
      await sembrarTransicion(tx, orden, devuelta, "anclaje_devolucion", hace(20));
      await sembrarTransicion(tx, orden, devuelta, "anclaje_devolucion", hace(2));
      const resumen = await repoDe(tx).resumenNovedadesPorTienda();
      return resumen.find((x) => x.tiendaId === tienda);
    });

    expect(r!.masAntiguaAt.toISOString()).toBe(hace(2).toISOString());
  });

  it("la CAUSA de cada orden viaja en el resumen (insumo de la homogeneidad de plazos)", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "nov-causa");
      const tienda = await crearTienda(tx, fks!.tiendaId);
      const devuelta = await estatusIdDe(tx, ESTATUS_NOVEDAD);
      const orden = await sembrarOrden(tx, {
        tiendaId: tienda,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: devuelta,
        creadaAt: hace(5),
      });
      await sembrarTransicion(tx, orden, devuelta, "anclaje_devolucion", hace(4));
      // La gestion `devuelta` VIGENTE (no anulada) es de donde sale la causa.
      await tx.$executeRawUnsafe(
        `INSERT INTO "gestion_orden" ("id","orden_id","mensajero_id","resultado","causa_devolucion","created_at")
         VALUES ($1, $2, $3, 'devuelta'::"gestion_resultado", 'wrong_address'::"gestion_causa_devolucion", $4)`,
        randomUUID(),
        orden,
        fks!.tiendaId, // cualquier usuario sirve de actor para el FK
        hace(4),
      );
      const resumen = await repoDe(tx).resumenNovedadesPorTienda();
      return resumen.find((x) => x.tiendaId === tienda);
    });

    expect(r!.ordenes).toHaveLength(1);
    expect(r!.ordenes[0].causa).toBe("wrong_address");
  });
});

describeSiHayBase("409/T4.1 — el predicado de REPRESADAS (R45/R46)", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ (e) R45: con umbral 3, la de 2 dias NO entra y la de 4 dias SI", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks, "la tabla `orden` esta vacia: el caso no se puede medir").not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "rep-e");
      const porDevolver = await estatusIdDe(tx, ESTATUS_REPRESADA);
      const base = {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porDevolver,
        creadaAt: hace(30),
      };
      const joven = await sembrarOrden(tx, base);
      const vieja = await sembrarOrden(tx, base);
      await sembrarTransicion(tx, joven, porDevolver, "ajuste_estado", hace(2));
      await sembrarTransicion(tx, vieja, porDevolver, "ajuste_estado", hace(4));

      const cota = hace(3); // el umbral, aplicado
      const repo = repoDe(tx);
      return {
        porZona: (await repo.resumenRepresadasPorZona(cota)).find((z) => z.zonaId === zona),
        contadas: await repo.contarRepresadas(cota, zona),
        sinUmbral: await repo.contarRepresadas(AHORA, zona), // control: con la cota en `ahora` entran las dos
      };
    });

    expect(r.porZona, "la zona sembrada no aparece: el caso no mide nada").toBeDefined();
    expect(r.porZona!.total).toBe(1); // solo la de 4 dias
    expect(r.porZona!.masAntiguaAt.toISOString()).toBe(hace(4).toISOString());
    expect(r.contadas).toBe(1);
    // CONTROL POSITIVO: sin el umbral entran las DOS. Si la siembra no hubiera llegado, esto
    // seria 0 y el caso de arriba estaria pasando por vacio.
    expect(r.sinUmbral).toBe(2);
  });

  it("⭑ (f) R46: una orden en `devolviendo_a_tienda` con NUEVE dias NO entra", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "rep-f");
      const porDevolver = await estatusIdDe(tx, ESTATUS_REPRESADA);
      const enTransito = await estatusIdDe(tx, ESTATUS_EN_TRANSITO);
      const base = {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        creadaAt: hace(30),
      };
      // ⚠️ LA QUE NO DEBE ENTRAR, y con la antiguedad mas alta del par a proposito: si el
      // predicado incluyera `devolviendo_a_tienda`, el total y el `masAntiguaAt` cambiarian los
      // dos. Medido en produccion el 2026-09-10: ese estado tiene 247 ordenes y NINGUNA pasa de
      // dia y medio — fluye, y vigilarlo seria ruido puro sobre el cubo mas grande.
      const enRuta = await sembrarOrden(tx, { ...base, estatusId: enTransito });
      await sembrarTransicion(tx, enRuta, enTransito, "ajuste_estado", hace(9));
      const represada = await sembrarOrden(tx, { ...base, estatusId: porDevolver });
      await sembrarTransicion(tx, represada, porDevolver, "ajuste_estado", hace(4));

      const cota = hace(3);
      const repo = repoDe(tx);
      return {
        porZona: (await repo.resumenRepresadasPorZona(cota)).find((z) => z.zonaId === zona),
        contadas: await repo.contarRepresadas(cota, zona),
      };
    });

    expect(r.porZona, "la siembra no llego: el caso no mide nada").toBeDefined();
    expect(r.porZona!.total).toBe(1); // SOLO la `por_devolver`
    expect(r.porZona!.masAntiguaAt.toISOString()).toBe(hace(4).toISOString()); // NO la de 9 dias
    expect(r.contadas).toBe(1);
  });

  it("una orden BORRADA no entra, aunque lleve represada un mes", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "rep-borrada");
      const porDevolver = await estatusIdDe(tx, ESTATUS_REPRESADA);
      const base = {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porDevolver,
        creadaAt: hace(30),
      };
      const viva = await sembrarOrden(tx, base);
      const borrada = await sembrarOrden(tx, { ...base, borrada: true });
      await sembrarTransicion(tx, viva, porDevolver, "ajuste_estado", hace(4));
      await sembrarTransicion(tx, borrada, porDevolver, "ajuste_estado", hace(30));

      const repo = repoDe(tx);
      return {
        porZona: (await repo.resumenRepresadasPorZona(hace(3))).find((z) => z.zonaId === zona),
      };
    });

    expect(r.porZona!.total).toBe(1);
    expect(r.porZona!.masAntiguaAt.toISOString()).toBe(hace(4).toISOString());
  });

  it("⭑ el ancla es la ULTIMA transicion a `por_devolver`, no la primera", async () => {
    // Una orden que salio de `por_devolver` y volvio a entrar HOY no es una represada de hace
    // semanas. Con un `where` sobre la relacion —«existe ALGUNA transicion antigua»— entraria; con
    // la ULTIMA, no. Es la diferencia entre avisar de un atasco real y avisar de uno resuelto.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx, "rep-ultima");
      const porDevolver = await estatusIdDe(tx, ESTATUS_REPRESADA);
      const orden = await sembrarOrden(tx, {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porDevolver,
        creadaAt: hace(60),
      });
      await sembrarTransicion(tx, orden, porDevolver, "ajuste_estado", hace(30));
      await sembrarTransicion(tx, orden, porDevolver, "ajuste_estado", hace(1));

      const repo = repoDe(tx);
      return {
        conUmbral: await repo.contarRepresadas(hace(3), zona),
        sinUmbral: await repo.contarRepresadas(AHORA, zona), // control: la orden EXISTE
      };
    });

    expect(r.sinUmbral).toBe(1); // la siembra llego
    expect(r.conUmbral).toBe(0); // pero volvio a entrar ayer: no esta represada
  });

  it("⭑ R48/R49: el resumen global CUBRE lo de todas las zonas, y cada zona lleva LO SUYO", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zonaA = await crearZona(tx, "rep-a");
      const zonaB = await crearZona(tx, "rep-b");
      const porDevolver = await estatusIdDe(tx, ESTATUS_REPRESADA);
      const base = {
        tiendaId: fks!.tiendaId,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porDevolver,
        creadaAt: hace(30),
      };
      for (let i = 0; i < 4; i++) {
        const o = await sembrarOrden(tx, { ...base, zonaId: zonaA });
        await sembrarTransicion(tx, o, porDevolver, "ajuste_estado", hace(8));
      }
      for (let i = 0; i < 3; i++) {
        const o = await sembrarOrden(tx, { ...base, zonaId: zonaB });
        await sembrarTransicion(tx, o, porDevolver, "ajuste_estado", hace(5));
      }

      const cota = hace(3);
      const repo = repoDe(tx);
      const porZona = await repo.resumenRepresadasPorZona(cota);
      return {
        a: porZona.find((z) => z.zonaId === zonaA),
        b: porZona.find((z) => z.zonaId === zonaB),
        globalTotal: (await repo.resumenRepresadasGlobal(cota)).total,
        contadasA: await repo.contarRepresadas(cota, zonaA),
        contadasGlobal: await repo.contarRepresadas(cota, null),
      };
    });

    expect(r.a?.total).toBe(4);
    expect(r.a?.masAntiguaAt.toISOString()).toBe(hace(8).toISOString());
    expect(r.b?.total).toBe(3);
    expect(r.b?.masAntiguaAt.toISOString()).toBe(hace(5).toISOString()); // SU antiguedad, no la de A
    expect(r.contadasA).toBe(4);
    // El global cubre AL MENOS las siete sembradas (la base local puede traer mas de otras zonas).
    expect(r.globalTotal).toBeGreaterThanOrEqual(7);
    expect(r.contadasGlobal).toBe(r.globalTotal);
  });
});
