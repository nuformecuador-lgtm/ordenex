import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import type { ITarifaVigenteRepository } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { emitirCierreDiaRechazado } from "@/lib/notificaciones/emitir";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 412 (T7.1, R7-R10) — **DOS RECHAZOS SON DOS AVISOS, Y EL MISMO RECHAZO ES UNO.**
 *
 * ES EL CORAZON DE LA FICHA, y por eso vive aqui y no en un unit. La dedupe tiene DOS capas y solo
 * una es codigo: la guardia previa `existeNoLeidaPara` (un `where` que ademas cruza
 * `notificacion_lectura`) y el INDICE UNICO `notificacion_dedupe_key`, que es PARCIAL
 * (`WHERE entidad_id IS NOT NULL`) y lleva `NULLS NOT DISTINCT`. Un doble del repositorio no
 * ejecuta ninguna de las dos; contra Postgres, si el `entidad_id` colisionara, la fila la rechaza
 * EL MOTOR y `crear` devuelve `null` sin ruido — exactamente el escenario que hay que descartar.
 *
 * ⚠️ EL FALLO QUE ESTE ARCHIVO EXISTE PARA IMPEDIR, y que HOY sigue vivo en el aviso de bloqueo:
 * con `entidad_id = <cierreId>` a secas, la clave ('cierre_dia_rechazado', cierre, NULL,
 * mensajero) admite UNA SOLA FILA PARA SIEMPRE —el indice no mira el estado de lectura—. Y como
 * `rechazado` es RE-SOLICITABLE y `transicionarASolicitado` REUTILIZA LA MISMA FILA de
 * `cierre_dia`, el ciclo NORMAL de esta pantalla —rechazo a las 09:00, correccion, rechazo a las
 * 09:40— dejaria el SEGUNDO rechazo MUDO: sin error, sin log y sin nada. Y el segundo es justo
 * cuando mas falta hace, porque significa que lo que corrigio no basto. Es el fallo que
 * documentaron la 262 y la 403.
 *
 * ⚠️ LA RE-SOLICITUD NO SE SIMULA: se ejecuta `CierreDiaRepository.transicionarASolicitado`, que es
 * el metodo REAL que mueve el cierre de vuelta a `solicitado`. Que reutilice la misma fila —y por
 * tanto que los dos rechazos compartan `cierre_dia.id`— es el hecho del que depende todo el
 * diseño, y aqui se comprueba en vez de suponerse.
 *
 * NO SE AFIRMA NI UN TEXTO AQUI: los literales de los avisos se afirman escritos a mano en
 * `tests/unit/notificaciones/cierre-rechazado-aviso.test.ts`, y compararlos aqui contra la funcion
 * que los genera estaria siempre verde. Lo que se cuentan son FILAS y su `entidad_id`.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde. CON base pero SIN datos, falla
 * RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Los dos rechazos del MISMO cierre, dentro del mismo dia: el ciclo normal de esta pantalla. */
const RECHAZO_0900 = "2026-08-22T15:00:00.000Z";
const RECHAZO_0940 = "2026-08-22T15:40:00.000Z";

describeSiHayBase("412/R7-R10 · la dedupe del aviso de rechazo, contra Postgres real", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let mensajeroA: string;
  let mensajeroB: string;

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
    if (usuarios.length < 2) {
      throw new Error("hacen falta al menos DOS usuarios en la base para el caso de R10.");
    }
    // Los mensajeros del caso parten de CERO avisos de este evento: contar filas sobre alguien que
    // ya arrastra las suyas mediria otra cosa. Si no hay dos limpios, se falla RUIDOSAMENTE.
    const conAviso = await prisma.notificacion.findMany({
      where: {
        evento: "cierre_dia_rechazado",
        destinatarioUsuarioId: { in: usuarios.map((u) => u.id) },
      },
      select: { destinatarioUsuarioId: true },
    });
    const sucios = new Set<string | null>(conAviso.map((n) => n.destinatarioUsuarioId));
    const limpios = usuarios.filter((u) => !sucios.has(u.id));
    if (limpios.length < 2) {
      throw new Error(
        "hacen falta DOS usuarios sin avisos previos de `cierre_dia_rechazado` para poder contar filas.",
      );
    }
    mensajeroA = limpios[0].id;
    mensajeroB = limpios[1].id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

  /** Un `cierre_dia` `solicitado` del mensajero, listo para que se lo rechacen. */
  async function sembrarCierre(tx: Tx, mensajeroId: string) {
    return tx.cierreDia.create({
      data: {
        mensajeroId,
        estado: "solicitado",
        destinoTipo: "bodega_central",
        destinoZonaId: fks.zonaId,
      },
      select: { id: true },
    });
  }

  /** Aplica el rechazo DE VERDAD sobre la fila y devuelve su `resuelto_at` persistido, en ISO. */
  async function rechazar(tx: Tx, cierreId: string, cuando: Date): Promise<string> {
    const { count } = await tx.cierreDia.updateMany({
      where: { id: cierreId, estado: { in: ["solicitado", "vencido"] } },
      data: { estado: "rechazado", resueltoAt: cuando, motivoRechazo: "Faltan evidencias." },
    });
    if (count !== 1) throw new Error(`el rechazo no se aplico sobre ${cierreId}`);
    const fila = await tx.cierreDia.findUniqueOrThrow({
      where: { id: cierreId },
      select: { resueltoAt: true },
    });
    if (fila.resueltoAt === null) throw new Error("resuelto_at nulo tras rechazar");
    return fila.resueltoAt.toISOString();
  }

  // =============================================================================================
  // R7 — LA MITAD QUE FALTABA: EL SEGUNDO RECHAZO DEL MISMO CIERRE **SI** AVISA
  // =============================================================================================

  it("⭑ R7: rechazo -> re-solicitud -> rechazo deja DOS filas, con el primero SIN LEER", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const notifRepo = new NotificacionRepository(tx as unknown as PrismaClient);
      // El resolver de tarifa es obligatorio en el constructor, pero `transicionarASolicitado` NO
      // lo toca: es MONEY-SAFE por construccion (su `data` cambia UNICAMENTE `estado`). Se pasa un
      // doble que LANZA, para que este test se ponga rojo si alguna vez alguien lo invocara desde
      // ahi — un doble mudo que devolviera `[]` dejaria ese cambio pasar en silencio.
      const cierreRepo = new CierreDiaRepository(tx as unknown as PrismaClient, {
        resolveTarifas: () => {
          throw new Error("`transicionarASolicitado` NO debe resolver tarifas: no es una resolucion");
        },
      } as unknown as ITarifaVigenteRepository);
      const cierre = await sembrarCierre(tx, mensajeroA);

      // 1.er RECHAZO — 09:00 CR.
      const primerInstante = await rechazar(tx, cierre.id, new Date(RECHAZO_0900));
      const primera = await emitirCierreDiaRechazado(notifRepo, {
        cierreId: cierre.id,
        resueltoAtISO: primerInstante,
        mensajeroUsuarioId: mensajeroA,
        jornadaCR: "2026-08-21",
        quedaBloqueado: true,
      });

      // RE-SOLICITUD con el METODO REAL. Devuelve `true` y REUTILIZA LA MISMA FILA: es el hecho
      // del que depende todo el diseño de la entidad, y por eso se ejecuta en vez de simularse.
      const reenviado = await cierreRepo.transicionarASolicitado(cierre.id, "rechazado");
      const trasReenviar = await tx.cierreDia.findUniqueOrThrow({
        where: { id: cierre.id },
        select: { id: true, estado: true },
      });

      // 2.º RECHAZO — 09:40 CR, EL MISMO DIA y EL MISMO CIERRE.
      const segundoInstante = await rechazar(tx, cierre.id, new Date(RECHAZO_0940));
      const segunda = await emitirCierreDiaRechazado(notifRepo, {
        cierreId: cierre.id,
        resueltoAtISO: segundoInstante,
        mensajeroUsuarioId: mensajeroA,
        jornadaCR: "2026-08-21",
        quedaBloqueado: true,
      });

      const filas = await tx.notificacion.findMany({
        where: { evento: "cierre_dia_rechazado", destinatarioUsuarioId: mensajeroA },
        select: { id: true, entidadTipo: true, entidadId: true, destinatarioRol: true },
        orderBy: { entidadId: "asc" },
      });
      // Ninguna se marco como leida: es la mitad que hace el caso duro. Con el estado de lectura
      // de por medio, la dedupe no se ejercitaria.
      const lecturas = await tx.notificacionLectura.count({
        where: { notificacionId: { in: filas.map((f) => f.id) } },
      });

      return {
        cierreId: cierre.id,
        reenviado,
        mismaFila: trasReenviar.id === cierre.id,
        estadoTrasReenviar: trasReenviar.estado,
        creadas: { primera, segunda },
        filas,
        lecturas,
        instantes: [primerInstante, segundoInstante],
      };
    });

    // El escenario es el que se dice que es: la re-solicitud funciono y REUSO la fila.
    expect(medido.reenviado).toBe(true);
    expect(medido.mismaFila).toBe(true);
    expect(medido.estadoTrasReenviar).toBe("solicitado");
    // Y los dos rechazos son instantes DISTINTOS del MISMO dia.
    expect(medido.instantes[0]).not.toBe(medido.instantes[1]);
    expect(medido.instantes[0].slice(0, 10)).toBe(medido.instantes[1].slice(0, 10));

    // ⭑ LA MITAD QUE FALTABA: el segundo rechazo emite, con el primero todavia sin leer.
    expect(medido.creadas.primera).toBe(1);
    expect(medido.creadas.segunda).toBe(1);
    expect(medido.lecturas).toBe(0);

    // ⭑ Y CONTADO EN LA TABLA, que es donde vive la verdad: DOS filas, una por rechazo.
    // MUTACION OBLIGATORIA (design §12.1): `entidadId = ctx.cierreId` ⇒ aqui sale 1 ⇒ ROJO.
    expect(medido.filas).toHaveLength(2);
    expect(medido.filas.map((f) => f.entidadId)).toEqual(
      [
        `${medido.cierreId}:${medido.instantes[0]}`,
        `${medido.cierreId}:${medido.instantes[1]}`,
      ].sort(),
    );
    // La entidad es el RECHAZO, escrita a mano y no derivada de la constante del emisor.
    expect(medido.filas.map((f) => f.entidadTipo)).toEqual([
      "cierre_dia_rechazo",
      "cierre_dia_rechazo",
    ]);
    // Dirigidas a un USUARIO: el XOR de destinatario deja el rol en null (146/D1).
    expect(medido.filas.map((f) => f.destinatarioRol)).toEqual([null, null]);
  });

  // =============================================================================================
  // R8 — EL MISMO RECHAZO, DOS VECES: UNA SOLA FILA
  // =============================================================================================

  it("⭑ R8: dos emisiones del MISMO rechazo (mismo `resuelto_at`) dejan UNA fila", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const notifRepo = new NotificacionRepository(tx as unknown as PrismaClient);
      const cierre = await sembrarCierre(tx, mensajeroA);
      const instante = await rechazar(tx, cierre.id, new Date(RECHAZO_0900));

      const ctx = {
        cierreId: cierre.id,
        resueltoAtISO: instante,
        mensajeroUsuarioId: mensajeroA,
        jornadaCR: "2026-08-21",
        quedaBloqueado: false,
      };
      const primera = await emitirCierreDiaRechazado(notifRepo, ctx);
      const repetida = await emitirCierreDiaRechazado(notifRepo, ctx);

      const filas = await tx.notificacion.count({
        where: { evento: "cierre_dia_rechazado", destinatarioUsuarioId: mensajeroA },
      });
      return { primera, repetida, filas };
    });

    expect(medido.primera).toBe(1);
    expect(medido.repetida).toBe(0);
    expect(medido.filas).toBe(1);
  });

  // =============================================================================================
  // R9 — Y QUE LO DECIDA EL INDICE, NO UN `if`
  // =============================================================================================

  it("⭑ R9: dos emisiones CONCURRENTES sobre CONEXIONES DISTINTAS dejan UNA fila, sin error", async () => {
    // ⚠️ POR QUE ESTE CASO NO CABE EN `enTransaccionRevertida`. La guardia previa
    // `existeNoLeidaPara` es un `SELECT`: con las dos emisiones en paralelo, las DOS pueden verlo
    // vacio y las DOS llegar al `INSERT`. Quien decide entonces es el INDICE UNICO — y un
    // `P2002` dentro de una transaccion la ABORTA entera en Postgres, asi que no se puede medir
    // desde dentro de una. Se escribe de verdad, sobre dos clientes distintos, y se LIMPIA en el
    // `finally` pase lo que pase.
    const clienteA = crearPrismaDeTest();
    const clienteB = crearPrismaDeTest();
    let cierreId: string | null = null;
    try {
      const cierre = await prisma.cierreDia.create({
        data: {
          mensajeroId: mensajeroA,
          estado: "rechazado",
          destinoTipo: "bodega_central",
          destinoZonaId: fks.zonaId,
          resueltoAt: new Date(RECHAZO_0900),
          motivoRechazo: "Faltan evidencias.",
        },
        select: { id: true, resueltoAt: true },
      });
      cierreId = cierre.id;
      const instante = cierre.resueltoAt!.toISOString();
      const ctx = {
        cierreId: cierre.id,
        resueltoAtISO: instante,
        mensajeroUsuarioId: mensajeroA,
        jornadaCR: "2026-08-21",
        quedaBloqueado: true,
      };

      // Ninguna de las dos propaga: el `P2002` lo absorbe `crear` devolviendo `null`.
      const creadas = await Promise.all([
        emitirCierreDiaRechazado(new NotificacionRepository(clienteA), ctx),
        emitirCierreDiaRechazado(new NotificacionRepository(clienteB), ctx),
      ]);

      const filas = await prisma.notificacion.count({
        where: { evento: "cierre_dia_rechazado", entidadId: `${cierre.id}:${instante}` },
      });

      // Una escribio y la otra no; cual de las dos, da igual.
      expect(creadas.filter((n) => n === 1)).toHaveLength(1);
      expect(creadas.filter((n) => n === 0)).toHaveLength(1);
      // ⭑ Y EN LA TABLA: UNA sola fila. Lo decidio el indice, no un `if`.
      expect(filas).toBe(1);
    } finally {
      await clienteA.$disconnect();
      await clienteB.$disconnect();
      if (cierreId !== null) {
        // Limpieza EXPLICITA: esta es la unica parte del archivo que escribe fuera de una
        // transaccion revertida, y la base local es COMPARTIDA entre worktrees. Una tabla que
        // crece rompe tests ajenos, y en este repo ya paso.
        //
        // ⚠️ EL BARRIDO ES POR (evento, destinatario), NO POR `entidad_id`. Medido el 2026-09-11
        // al aplicar la mutacion «entidad = cierreId»: con un `startsWith: '<cierre>:'` la fila
        // mutada —cuyo `entidad_id` ya no lleva el `:`— SOBREVIVIA al barrido y ensuciaba la base
        // compartida para la corrida siguiente. Un barrido que solo limpia lo que el codigo SANO
        // escribe es justo el que falla cuando hace falta. El `beforeAll` exige que este
        // mensajero parta de CERO avisos de este evento, asi que borrar los suyos no toca nada
        // ajeno.
        const suyas = await prisma.notificacion.findMany({
          where: { evento: "cierre_dia_rechazado", destinatarioUsuarioId: mensajeroA },
          select: { id: true },
        });
        await prisma.notificacionLectura.deleteMany({
          where: { notificacionId: { in: suyas.map((n) => n.id) } },
        });
        await prisma.notificacion.deleteMany({ where: { id: { in: suyas.map((n) => n.id) } } });
        await prisma.cierreDia.delete({ where: { id: cierreId } });
      }
    }
  });

  // =============================================================================================
  // R10 — DOS MENSAJEROS, DOS AVISOS
  // =============================================================================================

  it("⭑ R10: dos mensajeros rechazados el mismo dia reciben CADA UNO el suyo", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const notifRepo = new NotificacionRepository(tx as unknown as PrismaClient);

      const cierreA = await sembrarCierre(tx, mensajeroA);
      const cierreB = await sembrarCierre(tx, mensajeroB);
      const instanteA = await rechazar(tx, cierreA.id, new Date(RECHAZO_0900));
      const instanteB = await rechazar(tx, cierreB.id, new Date(RECHAZO_0900));

      await emitirCierreDiaRechazado(notifRepo, {
        cierreId: cierreA.id,
        resueltoAtISO: instanteA,
        mensajeroUsuarioId: mensajeroA,
        jornadaCR: "2026-08-21",
        quedaBloqueado: true,
      });
      await emitirCierreDiaRechazado(notifRepo, {
        cierreId: cierreB.id,
        resueltoAtISO: instanteB,
        mensajeroUsuarioId: mensajeroB,
        jornadaCR: "2026-08-21",
        quedaBloqueado: false,
      });

      const filas = await tx.notificacion.findMany({
        where: {
          evento: "cierre_dia_rechazado",
          destinatarioUsuarioId: { in: [mensajeroA, mensajeroB] },
        },
        select: { destinatarioUsuarioId: true, entidadId: true },
      });
      return { filas, cierreA: cierreA.id, cierreB: cierreB.id };
    });

    expect(medido.filas).toHaveLength(2);
    expect(medido.filas.map((f) => f.destinatarioUsuarioId).sort()).toEqual(
      [mensajeroA, mensajeroB].sort(),
    );
    // Cada uno cuelga de SU cierre: la entidad lleva el id del cierre delante.
    const porUsuario = new Map(medido.filas.map((f) => [f.destinatarioUsuarioId, f.entidadId]));
    expect(porUsuario.get(mensajeroA)?.startsWith(`${medido.cierreA}:`)).toBe(true);
    expect(porUsuario.get(mensajeroB)?.startsWith(`${medido.cierreB}:`)).toBe(true);
  });

  // =============================================================================================
  // ANTI-VACUIDAD (T7.2) — que este archivo no pueda pasar «por vacio»
  // =============================================================================================

  it("⭑ AUTOCOMPROBACION: sin sembrar nada, contar da CERO — los casos de arriba miden de verdad", async () => {
    // Es la leccion «test de integracion verde sin datos»: un `if (!fks) return;` reporta `passed`
    // sin comprobar nada. Aqui se demuestra que el contador que usan los casos de arriba DISTINGUE
    // el estado sembrado del vacio: si devolviera siempre 2, este caso se pondria rojo.
    const vacio = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      return tx.notificacion.count({
        where: { evento: "cierre_dia_rechazado", destinatarioUsuarioId: mensajeroA },
      });
    });

    expect(vacio).toBe(0);
  });

  it("⭑ AUTOCOMPROBACION: el mensajero del caso existe y la siembra engancha de verdad", async () => {
    // Si `mensajeroA` no existiera, `cierreDia.create` habria reventado por FK y los casos de
    // arriba no habrian llegado a contar nada — pero conviene decirlo en un aserto propio en vez
    // de confiar en que otro caso lo note.
    const existe = await prisma.usuario.count({ where: { id: mensajeroA } });
    expect(existe).toBe(1);
    expect(mensajeroA).not.toBe(mensajeroB);
  });
});
