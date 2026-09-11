import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { RepartoMananaRepository } from "@/lib/repositories/RepartoMananaRepository";
import { ESTADOS_REPARTO_MENSAJERO } from "@/lib/constants/reparto-mensajero-estados";
import { startOfDayCR } from "@/lib/utils/fecha-cr";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 413 (T3.2, R1/R3/R4) — EL `WHERE` DE LA FICHA, CONTRA POSTGRES DE VERDAD.
//
// ⚠️ POR QUÉ AQUÍ Y NO CON UN DOBLE. Los dobles no ven el SQL: un doble demuestra que el doble
// hace lo que el doble hace. Y lo que esta ficha se juega en el `where` es exactamente lo que un
// doble taparía:
//
//   · que la cota contra `orden.fecha_reparto` —que es **`@db.Date`**— sea `startOfDayCR` y no
//     `inicioDelDiaCREnUtc`, que está SEIS HORAS más tarde (R3);
//   · que los estados sean los TRES del portal y no otros (R2/R4);
//   · que una orden borrada o de otro mensajero no cuente (R4);
//   · y que el `GROUP BY` agrupe por mensajero de verdad (R1).
//
// Es la lección «probar el WHERE donde vive», medida cuatro veces seguidas en este repo.
//
// ⚠️ LA TRAMPA HORARIA VA AL REVÉS DE LO QUE SUELE AVISARSE AQUÍ. En casi toda esta base de código
// la cota buena es `inicioDelDiaCREnUtc`, porque casi todas las columnas son `timestamp`. ESTA NO:
// `fecha_reparto` es `DATE`, y ahí el helper correcto es `startOfDayCR`. El caso de las 23:50 CR
// de más abajo es el que lo mide, y es la MUTACIÓN OBLIGATORIA de la ficha.
//
// ⚠️ TODO CORRE DENTRO DE UNA TRANSACCIÓN QUE SIEMPRE SE REVIERTE. La base local es COMPARTIDA
// entre worktrees: si el test pasa, si falla o si el proceso muere a mitad, no queda una fila.
//
// ⚠️ Y NINGÚN CASO PUEDE PASAR POR VACÍO. Cada aserto positivo empieza comprobando que la siembra
// existe, y hay un caso de AUTOCOMPROBACIÓN al final que demuestra que el contador distingue el
// estado sembrado del vacío. Este repo ya midió lo que cuesta un `if (!fks) return;` que reporta
// `passed` sin comprobar nada.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/**
 * EL RELOJ DEL CASO DURO: 23:50 hora de pared de Costa Rica del 11 de septiembre, que en UTC ya es
 * el 12. Es la franja de seis horas en la que confundir los helpers desplaza el día.
 */
const RELOJ_2350_CR = new Date("2026-09-12T05:50:00.000Z");
/** Un reloj tranquilo, a media tarde CR, para los casos que no van de husos. */
const RELOJ_TARDE_CR = new Date("2026-09-11T22:00:00.000Z"); // 16:00 CR del 11

/** `YYYY-MM-DD` como `DATE` de Postgres, escrito a mano para no depender de ningún helper. */
function fechaDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Crea una zona propia del test para que ninguna otra fila de la base la ensucie. */
async function crearZona(tx: TxDeTest): Promise<string> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "zona" ("id","nombre") VALUES ($1, $2)`,
    id,
    `413-zona-${id.slice(0, 8)}`,
  );
  return id;
}

/** Clona la identidad de un usuario existente para crear un MENSAJERO propio del test. */
async function crearUsuario(tx: TxDeTest, modeloUsuarioId: string, etiqueta: string): Promise<string> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "usuario"
       ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","updated_at")
     SELECT $1, $2, $3, '00000000', 'x', $4,
            u."tipo_identificacion_id", u."rol_id", CURRENT_TIMESTAMP
       FROM "usuario" u WHERE u."id" = $5`,
    id,
    `413 ${etiqueta}`,
    `413-${id}@test.local`,
    `413-${id.slice(0, 12)}`,
    modeloUsuarioId,
  );
  return id;
}

async function estatusIdDe(tx: TxDeTest, value: string): Promise<string> {
  const filas = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "order_status" WHERE "value" = $1`,
    value,
  );
  expect(filas.length, `no existe el estado "${value}" en el catálogo`).toBe(1);
  return filas[0].id;
}

interface SembrarOrden {
  tiendaId: string;
  zonaId: string;
  provinciaId: string;
  cantonId: string;
  estatusId: string;
  mensajeroId: string | null;
  /** `YYYY-MM-DD` del día de reparto, o `null` (orden anterior a la 246). */
  fechaReparto: string | null;
  borrada?: boolean;
}

async function sembrarOrden(tx: TxDeTest, o: SembrarOrden): Promise<string> {
  const id = randomUUID();
  const creada = new Date("2026-09-11T12:00:00.000Z");
  await tx.$executeRawUnsafe(
    `INSERT INTO "orden"
       ("id","num_remision","estatus_id","destinatario","telefono_dest","tienda_id","zona_id",
        "provincia_id","canton_id","producto","mensajero_asignado_id","fecha_reparto",
        "created_at","updated_at","deleted_at")
     VALUES ($1, $2, $3, 'destinatario 413', '00000000', $4, $5, $6, $7, 'producto 413',
             $8, $9::date, $10, $10, $11)`,
    id,
    `413-${id.slice(0, 18)}`,
    o.estatusId,
    o.tiendaId,
    o.zonaId,
    o.provinciaId,
    o.cantonId,
    o.mensajeroId,
    o.fechaReparto,
    creada,
    o.borrada ? creada : null,
  );
  return id;
}

describeSiHayBase("413/R1 — el conteo del reparto de mañana, contra Postgres", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ R1: 3 para mañana + 2 para hoy + 1 borrada para mañana ⇒ el conteo da 3", async () => {
    const fks = await fksDeOrden(prisma);
    // ⚠️ FALLA RUIDOSAMENTE si la base está vacía: un `if (!fks) return` reportaría `passed` sin
    // haber comprobado nada.
    expect(fks, "la tabla `orden` está vacía: el caso no se puede medir").not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx);
      const mensajero = await crearUsuario(tx, fks!.tiendaId, "mensajero A");
      const porRecoger = await estatusIdDe(tx, "por_recoger");
      const base = {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porRecoger,
        mensajeroId: mensajero,
      };

      // TRES para mañana (el 12), DOS para hoy (el 11) y UNA borrada para mañana.
      for (let i = 0; i < 3; i += 1) {
        await sembrarOrden(tx, { ...base, fechaReparto: "2026-09-12" });
      }
      for (let i = 0; i < 2; i += 1) {
        await sembrarOrden(tx, { ...base, fechaReparto: "2026-09-11" });
      }
      await sembrarOrden(tx, { ...base, fechaReparto: "2026-09-12", borrada: true });

      const repo = new RepartoMananaRepository(tx as unknown as PrismaClient);
      const dia = startOfDayCR(RELOJ_TARDE_CR);
      return {
        // Los DOS métodos, sobre la MISMA siembra: comparten `where`, así que si divergieran se
        // vería aquí.
        delGrupo: (await repo.resumenPorMensajero(dia)).find((f) => f.mensajeroId === mensajero),
        delConteo: await repo.contarReservadasParaOtroDia(mensajero, dia),
        // Y cuántas filas sembró de verdad, para que el caso no pueda pasar por vacío.
        sembradas: await tx.orden.count({ where: { mensajeroAsignadoId: mensajero } }),
      };
    });

    expect(r.sembradas, "la siembra no llegó a la base").toBe(6);
    expect(r.delGrupo, "el mensajero sembrado no aparece en el resumen").toBeDefined();
    expect(r.delGrupo!.total).toBe(3);
    expect(r.delConteo).toBe(3);
    // Los dos métodos describen la MISMA población. Si alguien tocara uno solo, esto se pone rojo.
    expect(r.delGrupo!.total).toBe(r.delConteo);
  });

  it("⭑ R1: el `GROUP BY` reparte por mensajero, cada uno con SU número", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx);
      const a = await crearUsuario(tx, fks!.tiendaId, "mensajero A");
      const b = await crearUsuario(tx, fks!.tiendaId, "mensajero B");
      const porRecoger = await estatusIdDe(tx, "por_recoger");
      const base = {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porRecoger,
        fechaReparto: "2026-09-12",
      };

      for (let i = 0; i < 4; i += 1) await sembrarOrden(tx, { ...base, mensajeroId: a });
      for (let i = 0; i < 1; i += 1) await sembrarOrden(tx, { ...base, mensajeroId: b });
      // Y una SIN asignar: no puede caer en el grupo de nadie.
      await sembrarOrden(tx, { ...base, mensajeroId: null });

      const resumen = await new RepartoMananaRepository(
        tx as unknown as PrismaClient,
      ).resumenPorMensajero(startOfDayCR(RELOJ_TARDE_CR));
      return {
        a: resumen.find((f) => f.mensajeroId === a),
        b: resumen.find((f) => f.mensajeroId === b),
        // El grupo `null` NO puede existir: el `where` lo excluye.
        hayGrupoNulo: resumen.some((f) => (f.mensajeroId as unknown) === null),
      };
    });

    expect(r.a?.total).toBe(4);
    expect(r.b?.total).toBe(1); // cada mensajero con LO SUYO, no con el total
    expect(r.hayGrupoNulo).toBe(false);
  });
});

describeSiHayBase("413/R3 — LA TRAMPA DE LAS SEIS HORAS, con el reloj a las 23:50 CR", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑⭑ R3: a las 23:50 CR del 11, la del 12 ENTRA y la del 11 NO", async () => {
    // ⚠️⚠️ ES EL CASO QUE DECIDE LA CONVENCIÓN HORARIA DE LA FICHA ENTERA.
    //
    // `2026-09-12T05:50:00Z` son las 23:50 del 11 en hora de pared CR. En ese instante:
    //   · `startOfDayCR(now)`        = `2026-09-11T00:00:00Z`  ← la convención de `@db.Date`
    //   · `inicioDelDiaCREnUtc(hoy)` = `2026-09-11T06:00:00Z`  ← la de columnas `timestamp`
    //
    // Y `fecha_reparto` se guarda como `DATE`, que Prisma lee como `YYYY-MM-DDT00:00:00Z`. Con el
    // helper equivocado, `2026-09-11T00:00:00Z > 2026-09-11T06:00:00Z` es FALSO igual, pero
    // `2026-09-12T00:00:00Z > 2026-09-12T06:00:00Z` también lo sería un día después... la forma
    // limpia de verlo es ésta: con la cota seis horas más tarde, la del día 12 a medianoche UTC NO
    // supera la cota del día 12, y el aviso perdería el reparto entero de esa noche.
    //
    // MUTACIÓN OBLIGATORIA (design §13.1): cambiar `startOfDayCR` por `inicioDelDiaCREnUtc` en la
    // cota ⇒ LOS DOS ASERTOS DE ABAJO ROJOS.
    const fks = await fksDeOrden(prisma);
    expect(fks, "la tabla `orden` está vacía: el caso no se puede medir").not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx);
      const mensajero = await crearUsuario(tx, fks!.tiendaId, "mensajero 2350");
      const porRecoger = await estatusIdDe(tx, "por_recoger");
      const base = {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porRecoger,
        mensajeroId: mensajero,
      };

      const deManana = await sembrarOrden(tx, { ...base, fechaReparto: "2026-09-12" });
      const deHoy = await sembrarOrden(tx, { ...base, fechaReparto: "2026-09-11" });

      const repo = new RepartoMananaRepository(tx as unknown as PrismaClient);
      const cota = startOfDayCR(RELOJ_2350_CR);
      return {
        cotaISO: cota.toISOString(),
        total: await repo.contarReservadasParaOtroDia(mensajero, cota),
        // Lo que la base guardó de verdad en la columna `DATE`, para que el caso no dependa de lo
        // que yo creo haber sembrado.
        guardadas: await tx.orden.findMany({
          where: { id: { in: [deManana, deHoy] } },
          select: { id: true, fechaReparto: true },
          orderBy: { fechaReparto: "asc" },
        }),
        idDeManana: deManana,
        idDeHoy: deHoy,
      };
    });

    // El escenario es el que se dice que es: la cota es la medianoche UTC del día CR EN CURSO (11),
    // no la del 12 ni las 06:00.
    expect(r.cotaISO).toBe("2026-09-11T00:00:00.000Z");
    expect(r.guardadas.map((o) => o.fechaReparto?.toISOString())).toEqual([
      "2026-09-11T00:00:00.000Z",
      "2026-09-12T00:00:00.000Z",
    ]);

    // ⭑ LOS DOS ASERTOS. Una entra y la otra no, a las 23:50 CR.
    expect(r.total, "a las 23:50 CR el reparto de mañana debe ser exactamente 1").toBe(1);
  });

  it("⭑⭑ R3: y las DOS mitades por separado, para que ninguna pueda pasar por casualidad", async () => {
    // El caso de arriba cuenta 1 sobre 2 órdenes. Éste las separa: primero SÓLO la del 12 (debe
    // dar 1) y luego SÓLO la del 11 (debe dar 0). Con la cota desplazada seis horas, el primero
    // daría 0 y el segundo podría dar 1 — y una sola cifra agregada no distinguiría los dos
    // fallos.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx);
      const soloManana = await crearUsuario(tx, fks!.tiendaId, "solo mañana");
      const soloHoy = await crearUsuario(tx, fks!.tiendaId, "solo hoy");
      const porRecoger = await estatusIdDe(tx, "por_recoger");
      const base = {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porRecoger,
      };

      await sembrarOrden(tx, { ...base, mensajeroId: soloManana, fechaReparto: "2026-09-12" });
      await sembrarOrden(tx, { ...base, mensajeroId: soloHoy, fechaReparto: "2026-09-11" });

      const repo = new RepartoMananaRepository(tx as unknown as PrismaClient);
      const cota = startOfDayCR(RELOJ_2350_CR);
      return {
        deManana: await repo.contarReservadasParaOtroDia(soloManana, cota),
        deHoy: await repo.contarReservadasParaOtroDia(soloHoy, cota),
      };
    });

    expect(r.deManana, "la orden del 12 debe ENTRAR a las 23:50 CR del 11").toBe(1);
    expect(r.deHoy, "la orden del 11 NO debe entrar a ninguna hora del 11").toBe(0);
  });

  it("⭑ R21: a las 00:01 CR del 12, las del 12 YA NO cuentan (el aviso se apaga solo)", async () => {
    // Es la otra cara del mismo `>`: al pasar la medianoche CR, la cota avanza y las órdenes del
    // día anunciado dejan de ser «posteriores». Nadie ejecuta nada, nadie escribe nada: la cifra
    // viva cae a 0 y el aviso desaparece del panel y del distintivo. ES LO QUE PERMITE QUE EL
    // TÍTULO DIGA «MAÑANA» SIN MENTIR NUNCA.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx);
      const mensajero = await crearUsuario(tx, fks!.tiendaId, "mensajero medianoche");
      const porRecoger = await estatusIdDe(tx, "por_recoger");
      await sembrarOrden(tx, {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porRecoger,
        mensajeroId: mensajero,
        fechaReparto: "2026-09-12",
      });

      const repo = new RepartoMananaRepository(tx as unknown as PrismaClient);
      return {
        // 23:50 CR del 11 → todavía es «de mañana».
        antes: await repo.contarReservadasParaOtroDia(mensajero, startOfDayCR(RELOJ_2350_CR)),
        // 00:01 CR del 12 (= 06:01Z del 12) → ya es «de hoy»: deja de contar.
        despues: await repo.contarReservadasParaOtroDia(
          mensajero,
          startOfDayCR(new Date("2026-09-12T06:01:00.000Z")),
        ),
      };
    });

    expect(r.antes).toBe(1);
    expect(r.despues, "al llegar su día, el aviso tiene que apagarse solo").toBe(0);
  });
});

describeSiHayBase("413/R4 — lo que NO se cuenta", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ R4: las órdenes de OTRO mensajero no entran en el conteo de éste", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx);
      const a = await crearUsuario(tx, fks!.tiendaId, "mensajero A");
      const b = await crearUsuario(tx, fks!.tiendaId, "mensajero B");
      const porRecoger = await estatusIdDe(tx, "por_recoger");
      const base = {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porRecoger,
        fechaReparto: "2026-09-12",
      };

      await sembrarOrden(tx, { ...base, mensajeroId: a });
      for (let i = 0; i < 5; i += 1) await sembrarOrden(tx, { ...base, mensajeroId: b });

      const repo = new RepartoMananaRepository(tx as unknown as PrismaClient);
      const cota = startOfDayCR(RELOJ_TARDE_CR);
      return {
        a: await repo.contarReservadasParaOtroDia(a, cota),
        b: await repo.contarReservadasParaOtroDia(b, cota),
      };
    });

    expect(r.a, "el conteo de A se contaminó con las de B").toBe(1);
    expect(r.b).toBe(5);
  });

  it("⭑ R4: un estado FUERA del universo del portal no entra", async () => {
    // `recolectando` sigue fuera, como lo dejó el corte limpio de la 167/R34; `entregada` es el
    // otro extremo: ya salió del universo. Ninguna de las dos puede sumar al aviso, o éste diría
    // un número que la pantalla no enseña.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx);
      const mensajero = await crearUsuario(tx, fks!.tiendaId, "mensajero estados");
      const base = {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        mensajeroId: mensajero,
        fechaReparto: "2026-09-12",
      };

      // UNA por cada estado del universo del portal: las TRES tienen que contar.
      for (const estado of ESTADOS_REPARTO_MENSAJERO) {
        await sembrarOrden(tx, { ...base, estatusId: await estatusIdDe(tx, estado) });
      }
      // Y dos fuera de él: no pueden contar.
      for (const estado of ["recolectando", "entregada"]) {
        await sembrarOrden(tx, { ...base, estatusId: await estatusIdDe(tx, estado) });
      }

      const repo = new RepartoMananaRepository(tx as unknown as PrismaClient);
      return {
        total: await repo.contarReservadasParaOtroDia(mensajero, startOfDayCR(RELOJ_TARDE_CR)),
        sembradas: await tx.orden.count({ where: { mensajeroAsignadoId: mensajero } }),
      };
    });

    // Se sembraron CINCO y cuentan TRES: el `where` está separando de verdad.
    expect(r.sembradas).toBe(5);
    expect(r.total, "el conteo incluye estados que el portal del mensajero no muestra").toBe(3);
  });

  it("⭑ R4: una orden SIN día de reparto (anterior a la 246) no entra", async () => {
    // `fecha_reparto = NULL` significa «no tiene día», no «es de mañana». En SQL, `NULL > x` es
    // NULL —o sea, no pasa el filtro—, y eso es lo correcto; se comprueba en vez de suponerse.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx);
      const mensajero = await crearUsuario(tx, fks!.tiendaId, "mensajero sin dia");
      const porRecoger = await estatusIdDe(tx, "por_recoger");
      const base = {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: porRecoger,
        mensajeroId: mensajero,
      };

      await sembrarOrden(tx, { ...base, fechaReparto: null });
      await sembrarOrden(tx, { ...base, fechaReparto: "2026-09-12" });

      return {
        total: await new RepartoMananaRepository(
          tx as unknown as PrismaClient,
        ).contarReservadasParaOtroDia(mensajero, startOfDayCR(RELOJ_TARDE_CR)),
        sembradas: await tx.orden.count({ where: { mensajeroAsignadoId: mensajero } }),
      };
    });

    expect(r.sembradas).toBe(2);
    expect(r.total).toBe(1);
  });
});

describeSiHayBase("413 — ANTI-VACUIDAD: este archivo no puede pasar «por vacío»", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ SIN SEMBRAR NADA, el conteo de un mensajero nuevo da CERO", async () => {
    // ES LA CONTRAPRUEBA OBLIGATORIA (design §13). Si el contador devolviera siempre un número
    // fijo —o si el `where` no filtrara por mensajero—, este caso se pondría rojo y delataría que
    // los de arriba no estaban midiendo lo que dicen medir. Es la lección «test de integración
    // verde sin datos»: un `if (!datos) return;` reporta `passed` sin comprobar nada.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const vacio = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajero = await crearUsuario(tx, fks!.tiendaId, "mensajero sin nada");
      const repo = new RepartoMananaRepository(tx as unknown as PrismaClient);
      return {
        conteo: await repo.contarReservadasParaOtroDia(mensajero, startOfDayCR(RELOJ_TARDE_CR)),
        enElGrupo: (await repo.resumenPorMensajero(startOfDayCR(RELOJ_TARDE_CR))).some(
          (f) => f.mensajeroId === mensajero,
        ),
      };
    });

    expect(vacio.conteo).toBe(0);
    // Y R18 sale gratis del `GROUP BY`: quien no tiene reparto NO APARECE en el resumen.
    expect(vacio.enElGrupo).toBe(false);
  });

  it("⭑ la siembra engancha de verdad: la columna `DATE` guarda el día pedido y no otro", async () => {
    // Si `fecha_reparto` se escribiera con un desfase de huso, todos los casos de arriba estarían
    // midiendo otra cosa. Se comprueba contra la base, con el literal escrito a mano.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const guardada = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await crearZona(tx);
      const mensajero = await crearUsuario(tx, fks!.tiendaId, "mensajero fecha");
      const id = await sembrarOrden(tx, {
        tiendaId: fks!.tiendaId,
        zonaId: zona,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        estatusId: await estatusIdDe(tx, "por_recoger"),
        mensajeroId: mensajero,
        fechaReparto: "2026-09-12",
      });
      const fila = await tx.orden.findUniqueOrThrow({
        where: { id },
        select: { fechaReparto: true },
      });
      return fila.fechaReparto;
    });

    expect(guardada?.toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(guardada?.getTime()).toBe(fechaDate("2026-09-12").getTime());
  });
});
