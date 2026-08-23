import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 271 (T10.1 / T10.2 / T2.4 / T6.10) — EL CONTEO N/V, «EL MAS VIEJO», LA RE-SOLICITUD Y LA
 * JORNADA, EJECUTADOS CONTRA POSTGRES.
 *
 * POR QUE ESTE ARCHIVO EXISTE aunque ya haya tests unitarios de los mismos metodos. LOS TESTS DE
 * SERVICIO USAN DOBLES Y **NO VEN EL SQL**; los de repositorio comprueban que se emite el objeto
 * `where` que decimos, que es OTRA COSA distinta de que ese `where` seleccione las filas correctas.
 * Este repo ya midio **cuatro veces** que una mutacion de un `where` sobrevive en verde por arriba.
 *
 * Y aqui hay ademas **conversion de zona horaria**: la jornada de un cierre se deriva de la fecha
 * de Costa Rica de sus gestiones, y el defecto medido era justo de UN DIA. Eso no se prueba con
 * dobles.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte: si el test pasa, si falla o si el
 * proceso muere, no queda ni una fila en la base compartida.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), no pasa en verde: un `skip` se ve en la salida; un
 * `return` silencioso dentro del caso se leeria como `passed` sin haber comprobado nada, y este repo
 * ya se comio ese verde una vez. CON base pero SIN datos, falla RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` es UNIQUE en `orden`. */
const SUFIJO = `271-${Date.now().toString(36)}`;

/** Instantes CR de la jornada del 21 de agosto (CR es UTC-6 fijo). */
const CR_21_1656 = new Date("2026-08-21T22:56:00.000Z"); // 16:56 CR del 21
const CR_21_1710 = new Date("2026-08-21T23:10:00.000Z"); // 17:10 CR del 21
const CR_20_1400 = new Date("2026-08-20T20:00:00.000Z"); // 14:00 CR del 20
/** El instante en que el corte creo el cierre: 00:03 CR del 22. UN DIA POR DELANTE. */
const CR_22_0003 = new Date("2026-08-22T06:03:15.000Z");

describeSiHayBase("271 · la regla N/V contra Postgres real", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let usuarios: { id: string }[];

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    // Fallo RUIDOSO, no `return` silencioso: con base alcanzable y sin catalogo este archivo no
    // puede comprobar nada, y un `passed` en esas condiciones es peor que no tener el test.
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. " +
          "Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    fks = encontradas;
    usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 3 });
    if (usuarios.length < 3) {
      throw new Error(
        "hacen falta al menos TRES usuarios en la base para separar a los mensajeros del corpus.",
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Crea un `cierre_dia` del mensajero con el estado y el `solicitado_at` que se le pidan. */
  async function sembrarCierre(
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
    mensajeroId: string,
    estado: "solicitado" | "vencido" | "rechazado" | "aprobado",
    solicitadoAt?: Date,
    createdAt?: Date,
  ) {
    return tx.cierreDia.create({
      data: {
        mensajeroId,
        estado,
        destinoTipo: "bodega_central",
        destinoZonaId: fks.zonaId,
        ...(solicitadoAt ? { solicitadoAt } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      select: { id: true },
    });
  }

  // ===============================================================================================
  // T10.1 — EL CONTEO N/V, SEMBRADO. Un mensajero por fila de la tabla de verdad.
  // ===============================================================================================

  it("T10.1/R1-R8: las SIETE filas de la tabla de verdad, contadas por Postgres", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m] = usuarios;

      // Un solo mensajero por corrida (los usuarios reales son pocos): se siembra un CASO, se
      // mide, y la transaccion revertida limpia. Se recorren los siete en secuencia.
      const CASOS: {
        nombre: string;
        cierres: ("solicitado" | "vencido" | "rechazado" | "aprobado")[];
        n: number;
        v: number;
        bloqueado: boolean;
      }[] = [
        { nombre: "1 · sin cierres", cierres: [], n: 0, v: 0, bloqueado: false },
        { nombre: "2/3 · un solicitado", cierres: ["solicitado"], n: 1, v: 0, bloqueado: false },
        {
          nombre: "4 · dos solicitado",
          cierres: ["solicitado", "solicitado"],
          n: 2,
          v: 0,
          bloqueado: true,
        },
        { nombre: "5 · un vencido", cierres: ["vencido"], n: 1, v: 1, bloqueado: true },
        { nombre: "5-bis · un rechazado", cierres: ["rechazado"], n: 1, v: 1, bloqueado: true },
        {
          nombre: "6 · solicitado + vencido",
          cierres: ["solicitado", "vencido"],
          n: 2,
          v: 1,
          bloqueado: true,
        },
        {
          nombre: "7 · dos rechazado",
          cierres: ["rechazado", "rechazado"],
          n: 2,
          v: 2,
          bloqueado: true,
        },
        // Los DOS señuelos que la mutacion (a) de T10.1 mataria:
        {
          nombre: "señuelo · tres aprobado (terminal) NO cuentan",
          cierres: ["aprobado", "aprobado", "aprobado"],
          n: 0,
          v: 0,
          bloqueado: false,
        },
        {
          nombre: "señuelo · TRES abiertos (sin tope, S9)",
          cierres: ["solicitado", "solicitado", "rechazado"],
          n: 3,
          v: 1,
          bloqueado: true,
        },
      ];

      const repo = new OrdenRepository(tx as unknown as PrismaClient);

      for (const caso of CASOS) {
        const creados: string[] = [];
        for (const estado of caso.cierres) {
          creados.push((await sembrarCierre(tx, m.id, estado)).id);
        }

        const conteo = await repo.contarCierresAbiertosPorMensajero([m.id]);
        const leido = conteo.get(m.id) ?? { n: 0, v: 0 };
        expect(leido, `${caso.nombre}: N/V`).toEqual({ n: caso.n, v: caso.v });

        const bloqueados = await repo.findMensajerosBloqueadosPorCierres([m.id]);
        expect(bloqueados.has(m.id), `${caso.nombre}: veredicto`).toBe(caso.bloqueado);

        // Limpieza entre casos: la transaccion se revierte al final, pero cada caso tiene que
        // partir de cero o el segundo mediria la suma del primero.
        if (creados.length > 0) {
          await tx.cierreDia.deleteMany({ where: { id: { in: creados } } });
        }
      }
    });
  });

  it("T10.1/R34: el conteo separa a DOS mensajeros en la MISMA consulta", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m1, m2, m3] = usuarios;

      await sembrarCierre(tx, m1.id, "solicitado");
      await sembrarCierre(tx, m1.id, "solicitado"); // N=2, V=0 -> bloqueado
      await sembrarCierre(tx, m2.id, "solicitado"); // N=1, V=0 -> LIBRE
      await sembrarCierre(tx, m3.id, "aprobado"); // terminal -> libre

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      const bloqueados = await repo.findMensajerosBloqueadosPorCierres([m1.id, m2.id, m3.id]);

      // R34: el bloqueo es DEL MENSAJERO. Su companero con un solo `solicitado` sigue libre.
      expect(bloqueados.has(m1.id)).toBe(true);
      expect(bloqueados.has(m2.id)).toBe(false);
      expect(bloqueados.has(m3.id)).toBe(false);
    });
  });

  // ===============================================================================================
  // T10.2 — «EL MAS VIEJO», con `solicitado_at` NO correlacionado con el orden de insercion.
  // ===============================================================================================

  it("T10.2/R11: `findBloqueoDetalle` elige el MAS VIEJO por `solicitado_at`, no el primero insertado", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m] = usuarios;

      // Se insertan en orden INVERSO al de su `solicitado_at`: si el repositorio ordenara por
      // insercion (o por `created_at`), elegiria el equivocado y este caso lo diria.
      const nuevo = await sembrarCierre(tx, m.id, "solicitado", new Date("2026-08-22T18:00:00Z"));
      const viejo = await sembrarCierre(tx, m.id, "solicitado", new Date("2026-08-20T18:00:00Z"));
      const medio = await sembrarCierre(tx, m.id, "solicitado", new Date("2026-08-21T18:00:00Z"));

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      const d = await repo.findBloqueoDetalle(m.id);

      expect(d.bloqueado).toBe(true);
      expect(d.cierresAbiertos).toBe(3);
      expect(d.aResolverPrimero?.cierreId).toBe(viejo.id);
      expect(d.aResolverPrimero?.cierreId).not.toBe(nuevo.id);
      expect(d.aResolverPrimero?.cierreId).not.toBe(medio.id);
      // Todos `solicitado`: la pelota la tiene la administracion, no el mensajero.
      expect(d.aResolverPrimero?.resuelve).toBe("administracion");
    });
  });

  it("T10.2/R11: con `solicitado_at` IDENTICO el desempate por `id` es ESTABLE entre dos llamadas", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m] = usuarios;

      // El corte crea cierres en bucle dentro del mismo segundo: este es ese caso.
      const mismoInstante = new Date("2026-08-21T18:00:00.000Z");
      const a = await sembrarCierre(tx, m.id, "solicitado", mismoInstante);
      const b = await sembrarCierre(tx, m.id, "solicitado", mismoInstante);

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      const primera = await repo.findBloqueoDetalle(m.id);
      const segunda = await repo.findBloqueoDetalle(m.id);

      expect(primera.aResolverPrimero?.cierreId).toBe(segunda.aResolverPrimero?.cierreId);
      // Y es el de `id` menor, que es lo que hace la eleccion reproducible.
      const esperado = [a.id, b.id].sort()[0];
      expect(primera.aResolverPrimero?.cierreId).toBe(esperado);
    });
  });

  it("T10.2/R18: `findCierreResolicitableMasViejo` elige por EDAD, no por estado", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m] = usuarios;

      // ⚠️ EL CASO QUE EL CODIGO VIEJO RESOLVIA AL REVES: un `rechazado` VIEJO y un `vencido`
      // NUEVO. `solicitarCierre` miraba primero el `vencido`, asi que resolvia el nuevo primero y
      // contradecia «del mas viejo al mas nuevo».
      const rechazadoViejo = await sembrarCierre(
        tx,
        m.id,
        "rechazado",
        new Date("2026-08-20T18:00:00Z"),
      );
      await sembrarCierre(tx, m.id, "vencido", new Date("2026-08-22T18:00:00Z"));

      const repo = new CierreDiaRepository(
        tx as unknown as PrismaClient,
        new TarifaVigentePorTiendaRepository(tx as unknown as PrismaClient),
      );
      const elegido = await repo.findCierreResolicitableMasViejo(m.id);

      expect(elegido).toEqual({ id: rechazadoViejo.id, estado: "rechazado" });
    });
  });

  // ===============================================================================================
  // T2.4 — M2: LA RE-SOLICITUD CON DOS `rechazado`, LOS CUATRO PASOS DEL RECHAZO.
  // ===============================================================================================

  it("T2.4/R19 (M2): con DOS `rechazado`, la re-solicitud mueve UNO — el mas viejo — y reporta EXITO", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m] = usuarios;

      // LOS CUATRO PASOS DEL RECHAZO, que es la unica via alcanzable a dos re-solicitables:
      //   1. dia 1: trabaja y cierra            -> `solicitado`#1
      //   2. dia 2: trabaja y cierra            -> `solicitado`#2   (N=2: ya bloqueado, pero el
      //                                                              dia 2 YA estaba cerrado)
      //   3. el administrador rechaza #1        -> `rechazado`#1
      //   4. el administrador rechaza #2        -> `rechazado`#2    (N=2, V=2)
      const uno = await sembrarCierre(tx, m.id, "solicitado", new Date("2026-08-20T18:00:00Z"));
      const dos = await sembrarCierre(tx, m.id, "solicitado", new Date("2026-08-21T18:00:00Z"));
      await tx.cierreDia.update({ where: { id: uno.id }, data: { estado: "rechazado" } });
      await tx.cierreDia.update({ where: { id: dos.id }, data: { estado: "rechazado" } });

      const repo = new CierreDiaRepository(
        tx as unknown as PrismaClient,
        new TarifaVigentePorTiendaRepository(tx as unknown as PrismaClient),
      );

      // 5. el mensajero re-solicita.
      const elegido = await repo.findCierreResolicitableMasViejo(m.id);
      expect(elegido?.id).toBe(uno.id); // R18: el MAS VIEJO
      const ok = await repo.transicionarASolicitado(elegido!.id, elegido!.estado);

      // (c) EL RESULTADO ES EXITO, no `conflict`. Con el `updateMany` viejo —sin `id`— `count`
      //     valia 2 y el `=== 1` devolvia `false`: el mensajero leia «no se pudo» con sus DOS
      //     cierres ya movidos. Escribia y reportaba fallo.
      expect(ok).toBe(true);

      const despues = await tx.cierreDia.findMany({
        where: { id: { in: [uno.id, dos.id] } },
        select: { id: true, estado: true },
        orderBy: { id: "asc" },
      });
      const estadoPor = new Map(despues.map((c) => [c.id, c.estado]));
      // (a) transiciona UNO, el mas viejo.
      expect(estadoPor.get(uno.id)).toBe("solicitado");
      // (b) el otro SIGUE `rechazado`.
      expect(estadoPor.get(dos.id)).toBe("rechazado");

      // Y el mensajero SIGUE BLOQUEADO (R8): N=2 aunque V bajara a 1. Re-solicitar no basta.
      const orden = new OrdenRepository(tx as unknown as PrismaClient);
      expect((await orden.findMensajerosBloqueadosPorCierres([m.id])).has(m.id)).toBe(true);
    });
  });

  it("T2.4/R19: la guarda anti-TOCTOU se conserva — con el estado ya movido, `false` y SIN escribir", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m] = usuarios;

      const c = await sembrarCierre(tx, m.id, "solicitado");
      const repo = new CierreDiaRepository(
        tx as unknown as PrismaClient,
        new TarifaVigentePorTiendaRepository(tx as unknown as PrismaClient),
      );

      // Se pide transicionar creyendo que esta `vencido`, pero ya esta `solicitado` (carrera).
      const ok = await repo.transicionarASolicitado(c.id, "vencido");

      expect(ok).toBe(false);
      const fila = await tx.cierreDia.findUnique({
        where: { id: c.id },
        select: { estado: true },
      });
      expect(fila?.estado).toBe("solicitado"); // sin efectos
    });
  });

  it("T2.6/R20: la re-solicitud NO toca ni un total, ni `resuelto_*`, ni `solicitado_at`", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m, admin] = usuarios;

      const c = await tx.cierreDia.create({
        data: {
          mensajeroId: m.id,
          estado: "rechazado",
          destinoTipo: "bodega_central",
          destinoZonaId: fks.zonaId,
          totalEfectivo: "1500.50",
          totalGeneral: "1500.50",
          totalPagoMensajero: "250.00",
          totalIngresoBodegaRechazos: "75.25",
          resueltoPor: admin.id,
          resueltoAt: new Date("2026-08-22T15:00:00Z"),
          motivoRechazo: "faltan comprobantes",
          solicitadoAt: new Date("2026-08-21T18:00:00Z"),
        },
        select: { id: true },
      });
      const SELECT = {
        estado: true,
        totalEfectivo: true,
        totalGeneral: true,
        totalPagoMensajero: true,
        totalIngresoBodegaRechazos: true,
        resueltoPor: true,
        resueltoAt: true,
        motivoRechazo: true,
        solicitadoAt: true,
      } as const;
      const antes = await tx.cierreDia.findUnique({ where: { id: c.id }, select: SELECT });

      const repo = new CierreDiaRepository(
        tx as unknown as PrismaClient,
        new TarifaVigentePorTiendaRepository(tx as unknown as PrismaClient),
      );
      expect(await repo.transicionarASolicitado(c.id, "rechazado")).toBe(true);

      const despues = await tx.cierreDia.findUnique({ where: { id: c.id }, select: SELECT });

      // LO UNICO que cambio es `estado`. Todo lo demas, IDENTICO — incluido el `motivo_rechazo`,
      // que es el rastro de por que se rechazo y no se borra al reenviar.
      expect(despues?.estado).toBe("solicitado");
      expect(antes?.estado).toBe("rechazado");
      expect({ ...despues, estado: null }).toEqual({ ...antes, estado: null });
    });
  });

  // ===============================================================================================
  // T6.10 — LA JORNADA, SOBRE EL CASO REAL `79cb2c0f`. Aqui hay conversion de zona horaria.
  // ===============================================================================================

  it("T6.10/R57: 3 gestiones del 21 en un cierre nacido el 22 -> la jornada es el 21", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m] = usuarios;

      const cierre = await sembrarCierre(tx, m.id, "vencido", CR_22_0003, CR_22_0003);

      // Tres gestiones registradas por el mensajero el 21 en hora de Costa Rica, ya vinculadas.
      for (const [i, cuando] of [CR_21_1656, CR_21_1710, CR_21_1656].entries()) {
        const orden = await tx.orden.create({
          data: {
            numRemision: `R-${SUFIJO}-J${i}`,
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
        });
        await tx.gestionOrden.create({
          data: {
            ordenId: orden.id,
            mensajeroId: m.id,
            resultado: "entregada",
            cierreId: cierre.id,
            createdAt: cuando,
          },
          select: { id: true },
        });
      }

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      const d = await repo.findBloqueoDetalle(m.id);

      // ⚠️ EL NUMERO QUE ESTA FICHA VIENE A ARREGLAR. `created_at` del cierre en CR es el 22;
      // la jornada real —la de sus gestiones— es el 21. Si el derivador volviera a `created_at` a
      // secas, este caso diria 22 y moriria.
      expect(d.aResolverPrimero?.jornadaCR).toBe("2026-08-21");
      expect(d.aResolverPrimero?.jornadaCR).not.toBe("2026-08-22");
    });
  });

  it("T6.10/R58: un cierre SIN gestiones (money-neutral del corte) -> `created_at` CR menos un dia", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m] = usuarios;

      await sembrarCierre(tx, m.id, "vencido", CR_22_0003, CR_22_0003);

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      const d = await repo.findBloqueoDetalle(m.id);

      expect(d.aResolverPrimero?.jornadaCR).toBe("2026-08-21");
    });
  });

  it("T6.10/R60: gestiones en DOS dias de Costa Rica -> jornada `null` (el texto omite la fecha)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m] = usuarios;

      const cierre = await sembrarCierre(tx, m.id, "vencido", CR_22_0003, CR_22_0003);
      for (const [i, cuando] of [CR_20_1400, CR_21_1656].entries()) {
        const orden = await tx.orden.create({
          data: {
            numRemision: `R-${SUFIJO}-M${i}`,
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
        });
        await tx.gestionOrden.create({
          data: {
            ordenId: orden.id,
            mensajeroId: m.id,
            resultado: "entregada",
            cierreId: cierre.id,
            createdAt: cuando,
          },
          select: { id: true },
        });
      }

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      const d = await repo.findBloqueoDetalle(m.id);

      expect(d.aResolverPrimero?.jornadaCR).toBeNull();
    });
  });

  it("T6.10/R57: una gestion ANULADA no cuenta como jornada trabajada", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [m] = usuarios;

      const cierre = await sembrarCierre(tx, m.id, "vencido", CR_22_0003, CR_22_0003);
      // La UNICA gestion del cierre es del 20 y esta ANULADA. Si contara, la jornada seria el 20;
      // como no cuenta, el derivador cae por la rama B y devuelve el 21.
      const orden = await tx.orden.create({
        data: {
          numRemision: `R-${SUFIJO}-A0`,
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
      });
      await tx.gestionOrden.create({
        data: {
          ordenId: orden.id,
          mensajeroId: m.id,
          resultado: "entregada",
          cierreId: cierre.id,
          createdAt: CR_20_1400,
          anuladaAt: new Date("2026-08-20T21:00:00Z"),
        },
        select: { id: true },
      });

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      const d = await repo.findBloqueoDetalle(m.id);

      expect(d.aResolverPrimero?.jornadaCR).toBe("2026-08-21");
      expect(d.aResolverPrimero?.jornadaCR).not.toBe("2026-08-20");
    });
  });
});
