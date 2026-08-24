import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { emitirMensajeroBloqueado } from "@/lib/notificaciones/emitir";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 271 (T6.3, R44) — **LA SEGUNDA MITAD DE LA DEDUPE: OTRO CIERRE ES OTRO HECHO, Y AVISA.**
 *
 * QUE FALTABA. La primera mitad («el mismo hecho dos veces con el anterior sin leer -> UNA fila»)
 * la sostiene `emitirFilas` (146/R27) y esta probada. La segunda —«el hecho es OTRO -> aviso
 * NUEVO»— depende de una eleccion de diseño que nadie estaba comprobando de punta a punta: que la
 * ENTIDAD del aviso sea el CIERRE y no el MENSAJERO. Con el mensajero como entidad, los dos
 * bloqueos del mismo mensajero comparten `entidad_id`, la dedupe se come el segundo y el silencio
 * es ESTRUCTURAL: nada falla, nada se pone rojo, simplemente el aviso no llega. Es la misma leccion
 * que la 262 aprendio con `orden_dia_reparto_cambio`, y este repo la llama fallo mudo.
 *
 * POR QUE CONTRA POSTGRES Y NO CON UN DOBLE EN MEMORIA. La dedupe tiene DOS capas y solo una es
 * codigo: la guardia `existeNoLeidaPara` (un `where` que ademas cruza `notificacion_lectura`) y el
 * indice unico `notificacion_dedupe_key` con `NULLS NOT DISTINCT`. Un doble del repositorio no
 * ejecuta ninguna de las dos; contra Postgres, si el `entidad_id` colisionara, la fila la rechaza
 * el motor y `crear` devuelve `false` sin ruido — exactamente el escenario que hay que descartar.
 *
 * CONTRAPRUEBA APLICADA (2026-08-23): cambiando `entidadId: ctx.cierreId` por
 * `ctx.mensajeroUsuarioId` en `emitirMensajeroBloqueado` (`lib/notificaciones/emitir.ts`), este
 * archivo se pone ROJO — el segundo cierre no emite nada y al mensajero le queda UNA sola fila.
 *
 * NO SE AFIRMA NI UN TEXTO AQUI: los literales de los avisos se afirman escritos a mano en
 * `tests/unit/notificaciones/bloqueo-textos.test.ts`, y compararlos aqui contra la funcion que los
 * genera estaria siempre verde. Lo que se cuenta son FILAS y su `entidad_id`.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const AYER_18H = new Date("2026-08-21T18:00:00.000Z");
const HOY_18H = new Date("2026-08-22T18:00:00.000Z");

/** Los CUATRO destinatarios de un aviso de bloqueo: el mensajero + maestro + admin + adminSatelite. */
const FILAS_POR_AVISO = 4;

describeSiHayBase("271/T6.3 · R44 — otro cierre es otro hecho: DOS avisos, no uno", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let mensajeroId: string;

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
    const usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 10 });
    if (usuarios.length < 1) throw new Error("hacen falta usuarios en la base.");
    // El mensajero del caso parte de CERO avisos de este evento y CERO cierres abiertos: contar
    // filas sobre alguien que ya arrastra las suyas mediria otra cosa. Si no hay ninguno limpio,
    // se falla RUIDOSAMENTE (nunca un `return` silencioso que reporte `passed`).
    const conAviso = await prisma.notificacion.findMany({
      where: {
        evento: "mensajero_bloqueado_por_cierres",
        destinatarioUsuarioId: { in: usuarios.map((u) => u.id) },
      },
      select: { destinatarioUsuarioId: true },
    });
    const conCierre = await prisma.cierreDia.groupBy({
      by: ["mensajeroId"],
      where: {
        mensajeroId: { in: usuarios.map((u) => u.id) },
        estado: { in: ["solicitado", "vencido", "rechazado"] },
      },
      _count: { _all: true },
    });
    const sucios = new Set<string | null>([
      ...conAviso.map((n) => n.destinatarioUsuarioId),
      ...conCierre.map((c) => c.mensajeroId),
    ]);
    const limpio = usuarios.find((u) => !sucios.has(u.id));
    if (limpio === undefined) {
      throw new Error(
        "todos los usuarios de la base arrastran avisos de bloqueo o cierres abiertos: este caso " +
          "necesita uno limpio para poder contar filas.",
      );
    }
    mensajeroId = limpio.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R44: el MISMO cierre dos veces deja UNA fila; OTRO cierre del mismo mensajero deja DOS", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const sembrarCierre = async (solicitadoAt: Date) =>
        tx.cierreDia.create({
          data: {
            mensajeroId,
            estado: "solicitado",
            destinoTipo: "bodega_central",
            destinoZonaId: fks.zonaId,
            solicitadoAt,
            createdAt: solicitadoAt,
          },
          select: { id: true },
        });

      // Los DOS hechos de bloqueo: el cierre de ayer y el de hoy. Mismo mensajero, misma causa,
      // CIERRES DISTINTOS.
      const cierreA = await sembrarCierre(AYER_18H);
      const cierreB = await sembrarCierre(HOY_18H);

      const notifRepo = new NotificacionRepository(tx as unknown as PrismaClient);
      // El detalle NO es un fixture: sale del repositorio REAL leyendo los cierres sembrados, que
      // es lo que hace el productor en produccion.
      const bloqueo = await new OrdenRepository(
        tx as unknown as PrismaClient,
      ).findBloqueoDetalle(mensajeroId);

      const emitirPara = (cierreId: string) =>
        emitirMensajeroBloqueado(notifRepo, {
          cierreId,
          zonaId: fks.zonaId,
          mensajeroUsuarioId: mensajeroId,
          bloqueo,
        });

      // 1.ª emision por el cierre A.
      const primera = await emitirPara(cierreA.id);
      // 2.ª emision por el MISMO cierre A, con la anterior SIN LEER -> la dedupe la come entera.
      const repetida = await emitirPara(cierreA.id);
      // 3.ª emision por el cierre B: OTRO hecho, con las de A todavia sin leer -> DEBE emitir.
      const otroCierre = await emitirPara(cierreB.id);

      const alMensajero = await tx.notificacion.findMany({
        where: {
          evento: "mensajero_bloqueado_por_cierres",
          destinatarioUsuarioId: mensajeroId,
        },
        select: { entidadTipo: true, entidadId: true, destinatarioRol: true },
      });
      const aLaBodega = await tx.notificacion.findMany({
        where: {
          evento: "mensajero_bloqueado_por_cierres",
          entidadId: { in: [cierreA.id, cierreB.id] },
          destinatarioUsuarioId: null,
        },
        select: { entidadId: true, destinatarioRol: true },
      });

      return {
        cierreA: cierreA.id,
        cierreB: cierreB.id,
        bloqueado: bloqueo.bloqueado,
        creadas: { primera, repetida, otroCierre },
        alMensajero,
        rolesBodega: aLaBodega.map((n) => n.destinatarioRol).sort(),
      };
    });

    const { cierreA, cierreB, bloqueado, creadas, alMensajero, rolesBodega } = medido;

    // El escenario es el que se dice que es: dos cierres abiertos = mensajero BLOQUEADO.
    expect(bloqueado).toBe(true);

    // Las CUATRO filas del primer aviso: el mensajero + los tres destinatarios de bodega.
    expect(creadas.primera).toBe(FILAS_POR_AVISO);
    // MISMO hecho, anterior sin leer -> CERO filas nuevas (la mitad ya probada de R44).
    expect(creadas.repetida).toBe(0);
    // ⭑ LA MITAD QUE FALTABA: otro cierre -> otras CUATRO filas, con las de A aun sin leer.
    expect(creadas.otroCierre).toBe(FILAS_POR_AVISO);

    // ⭑ Y CONTADO EN LA TABLA, que es donde vive la verdad: DOS filas para el mensajero, una por
    // cierre. Con el mensajero como entidad esto valdria 1.
    expect(alMensajero).toHaveLength(2);
    expect(alMensajero.map((n) => n.entidadId).sort()).toEqual([cierreA, cierreB].sort());
    // La entidad es el CIERRE, escrito a mano y no derivado de la constante del emisor.
    expect(alMensajero.map((n) => n.entidadTipo)).toEqual(["cierre_dia", "cierre_dia"]);
    // Dirigida a un USUARIO: el XOR de destinatario deja el rol en null (146/D1).
    expect(alMensajero.map((n) => n.destinatarioRol)).toEqual([null, null]);

    // Y la bodega recibe SUS dos juegos, uno por cierre: maestro, admin y el adminSatelite de la
    // zona destino. Seis filas en total, tres por cierre.
    expect(rolesBodega).toEqual([
      "admin",
      "admin",
      "adminSatelite",
      "adminSatelite",
      "maestro",
      "maestro",
    ]);
  });
});
