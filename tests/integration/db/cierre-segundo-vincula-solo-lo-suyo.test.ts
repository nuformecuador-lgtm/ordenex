import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 271 (T2.2, R14) — EL SEGUNDO CIERRE SE LLEVA **SOLO LO QUE AUN NO ESTA EN NINGUN
 * CIERRE**, EJECUTADO CONTRA POSTGRES.
 *
 * LA GARANTIA QUE SOSTIENE ESTE ARCHIVO. La 271 deroga el invariante «un solo cierre abierto»
 * (R9): desde ella un mensajero puede tener DOS cierres vivos a la vez. Lo unico que impide que
 * el cierre de hoy se lleve por delante las gestiones de ayer —las que ya viajan en el cierre que
 * la administracion todavia no ha aprobado— es el `cierre_id IS NULL` del `updateMany` de
 * `CierreDiaRepository.crearCierre`. Es el reparto por AUSENCIA DE VINCULO, y es lo que sustituye
 * a la columna de fecha que el humano descarto: no hay «gestiones del dia», hay «gestiones que
 * nadie ha cerrado todavia».
 *
 * POR QUE ESTE TEST EXISTE AUNQUE EL `where` NO SE HAYA TOCADO. El repositorio no cambio, pero su
 * CONTEXTO si: hasta la 271 este `where` era redundante —con un solo cierre abierto no habia
 * gestiones ajenas que robar— y desde la 271 es la unica linea que separa dos cierres. Un
 * requisito que solo esta protegido por «nadie lo ha tocado» no esta protegido.
 *
 * POR QUE CONTRA POSTGRES Y NO CON DOBLES. Es un `where`. Un test de servicio con un doble de
 * repositorio afirma que se llamo a `crearCierre`, no que `crearCierre` seleccione las filas
 * correctas; este repo ya midio CUATRO veces que una mutacion de un `where` sobrevive en verde por
 * arriba.
 *
 * CONTRAPRUEBA APLICADA (2026-08-23): quitando `cierreId: null` del `where` de `crearCierre`
 * (`lib/repositories/CierreDiaRepository.ts`), este archivo se pone ROJO — el cierre B se lleva
 * las CUATRO gestiones del mensajero, incluidas las dos que ya viajaban en el cierre A.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde: un `return` silencioso dentro
 * del caso se leeria como `passed` sin haber comprobado nada, y este repo ya se comio ese verde.
 * CON base pero SIN catalogo, falla RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` es UNIQUE en `orden`. */
const SUFIJO = `271t22-${Date.now().toString(36)}`;

describeSiHayBase("271/T2.2 · R14 — el 2.º cierre vincula SOLO las gestiones sin cierre", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let usuarios: { id: string }[];

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. " +
          "Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    fks = encontradas;
    usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 2 });
    if (usuarios.length < 2) {
      throw new Error(
        "hacen falta al menos DOS usuarios en la base: uno es el mensajero que cierra y el otro " +
          "el señuelo que demuestra que el `where` filtra por mensajero.",
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R14: el cierre B se lleva EXACTAMENTE las 2 sueltas y NO toca ni una del cierre A", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [mensajero, otroMensajero] = usuarios;

      const sembrarOrden = async (clave: string) =>
        (
          await tx.orden.create({
            data: {
              numRemision: `R-${SUFIJO}-${clave}`,
              destinatario: "Dest",
              telefonoDest: "88880000",
              producto: "Prod",
              estatusId: fks.estatusId,
              tiendaId: fks.tiendaId,
              zonaId: fks.zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
            },
            select: { id: true },
          })
        ).id;

      const sembrarGestion = async (
        clave: string,
        quien: string,
        cierreId: string | null,
        anulada: boolean,
      ) =>
        (
          await tx.gestionOrden.create({
            data: {
              ordenId: await sembrarOrden(clave),
              mensajeroId: quien,
              resultado: "entregada",
              cierreId,
              ...(anulada ? { anuladaAt: new Date("2026-08-22T18:00:00Z") } : {}),
            },
            select: { id: true },
          })
        ).id;

      // EL CIERRE A: el de AYER, ya enviado a aprobacion y todavia sin resolver. Sus dos gestiones
      // ya llevan `cierre_id` = A.
      const cierreA = await tx.cierreDia.create({
        data: {
          mensajeroId: mensajero.id,
          estado: "solicitado",
          destinoTipo: "bodega_central",
          destinoZonaId: fks.zonaId,
        },
        select: { id: true },
      });
      const aUno = await sembrarGestion("a1", mensajero.id, cierreA.id, false);
      const aDos = await sembrarGestion("a2", mensajero.id, cierreA.id, false);

      // LO DE HOY: dos gestiones SUELTAS. Son las unicas que el cierre B debe llevarse.
      const bUno = await sembrarGestion("b1", mensajero.id, null, false);
      const bDos = await sembrarGestion("b2", mensajero.id, null, false);

      // SEÑUELO 1 — suelta pero ANULADA (`anulada_at IS NOT NULL`). El mensajero la deshizo: no es
      // trabajo que cobrar, y vincularla la metería en el feed de wallet al aprobar (67/R16).
      const anulada = await sembrarGestion("anul", mensajero.id, null, true);

      // SEÑUELO 2 — suelta y de OTRO mensajero. Si el `where` perdiera `mensajeroId`, el cierre de
      // uno se llevaria el trabajo del otro.
      const ajena = await sembrarGestion("ajena", otroMensajero.id, null, false);

      const repo = new CierreDiaRepository(
        tx as unknown as PrismaClient,
        new TarifaVigenteRepository(tx as unknown as PrismaClient),
      );

      // El pago snapshot se pasa para las DOS sueltas y ADEMAS para una de las de A: la guardia
      // `cierreId: cierre.id` del `updateMany` de pagos es la segunda mitad de «NO DEBE tocar
      // ninguna gestion ya vinculada a otro cierre».
      const cierreB = await repo.crearCierre({
        mensajeroId: mensajero.id,
        destinoTipo: "bodega_central",
        destinoZonaId: fks.zonaId,
        totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
        pagoByGestionId: { [bUno]: "1500.00", [bDos]: "1500.00", [aUno]: "9999.00" },
        totalPagoMensajero: "3000.00",
        ingresoByGestionId: {},
        totalIngresoBodegaRechazos: "0.00",
      });

      const filas = await tx.gestionOrden.findMany({
        where: { id: { in: [aUno, aDos, bUno, bDos, anulada, ajena] } },
        select: { id: true, cierreId: true, pagoMensajero: true },
      });
      const por = new Map(filas.map((f) => [f.id, f]));
      const enB = await tx.gestionOrden.findMany({
        where: { cierreId: cierreB ?? "sin-cierre" },
        select: { id: true },
      });

      return {
        cierreA: cierreA.id,
        cierreB,
        ids: { aUno, aDos, bUno, bDos, anulada, ajena },
        // `pagoMensajero` es Decimal|null: se saca a string aqui para que la asercion sea literal.
        estado: Object.fromEntries(
          [...por].map(([id, f]) => [
            id,
            { cierreId: f.cierreId, pago: f.pagoMensajero === null ? null : f.pagoMensajero.toFixed(2) },
          ]),
        ) as Record<string, { cierreId: string | null; pago: string | null }>,
        vinculadasAB: enB.map((g) => g.id).sort(),
      };
    });

    const { cierreA, cierreB, ids, estado, vinculadasAB } = medido;

    // El segundo cierre EXISTE y es OTRO (R13: no responde conflicto por duplicado).
    expect(cierreB).not.toBeNull();
    expect(cierreB).not.toBe(cierreA);

    // ⭑ EL CONJUNTO EXACTO: las dos sueltas, ni una mas. Ni la anulada, ni la ajena, ni las de A.
    expect(vinculadasAB).toEqual([ids.bUno, ids.bDos].sort());

    // Y visto fila por fila, que es donde se ve QUE se rompio si esto cae:
    expect(estado[ids.bUno].cierreId).toBe(cierreB);
    expect(estado[ids.bDos].cierreId).toBe(cierreB);

    // ⭑ LA MITAD QUE EL `cierre_id IS NULL` PROTEGE: las de AYER siguen en el cierre A. Si esto
    // cae, el mensajero que solicita hoy vacia el cierre que la administracion aun no aprobo.
    expect(estado[ids.aUno].cierreId).toBe(cierreA);
    expect(estado[ids.aDos].cierreId).toBe(cierreA);

    // Los dos señuelos siguen SUELTOS.
    expect(estado[ids.anulada].cierreId).toBeNull();
    expect(estado[ids.ajena].cierreId).toBeNull();

    // «NO DEBE TOCAR» tambien vale para el dinero: la gestion de A no recibe el pago snapshot del
    // cierre B, aunque su id viajaba en `pagoByGestionId`.
    expect(estado[ids.aUno].pago).toBeNull();
    expect(estado[ids.bUno].pago).toBe("1500.00");
    expect(estado[ids.bDos].pago).toBe("1500.00");
  });
});
