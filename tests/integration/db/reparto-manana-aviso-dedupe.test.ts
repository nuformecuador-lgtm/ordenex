import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { emitirRepartoManana } from "@/lib/notificaciones/emitir";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 413 (T7.1, R7/R14/R22/R23/R24) — **DOS NOCHES SON DOS AVISOS, Y LA MISMA NOCHE ES UNO. Y
 * DOS MENSAJEROS SON DOS.**
 *
 * ES EL CORAZÓN DE LA FICHA, y por eso vive aquí y no en un unit. La dedupe tiene DOS capas y sólo
 * una es código: la guardia previa `existeNoLeidaPara` (un `where` que además cruza
 * `notificacion_lectura`) y el ÍNDICE ÚNICO `notificacion_dedupe_key`, que es PARCIAL
 * (`WHERE entidad_id IS NOT NULL`) y lleva `NULLS NOT DISTINCT`. Un doble del repositorio no
 * ejecuta ninguna de las dos; contra Postgres, si el `entidad_id` colisionara, la fila la rechaza
 * EL MOTOR y `crear` devuelve `null` sin ruido — exactamente el escenario que hay que descartar.
 *
 * ⚠️ LOS DOS FALLOS QUE ESTE ARCHIVO EXISTE PARA IMPEDIR, y los dos ya ocurrieron en este repo:
 *
 *   1. **Entidad sin el día** (lo que le pasó a la 262 con `orden` y a la 403 con la suscripción):
 *      la clave sería la misma TODAS LAS NOCHES y el aviso del día 2 no saldría JAMÁS, en silencio.
 *   2. **Aviso dirigido a un ROL en vez de a un usuario** (el silencio que destapó la 409): la
 *      clave no incluye el alcance, así que sólo el PRIMER mensajero de la corrida recibiría el
 *      suyo y todos los demás quedarían mudos, sin error y sin log.
 *
 * El caso de los dos mensajeros es lo que sostiene la decisión de §7 —que la entidad NO lleve
 * prefijo de mensajero—, y no el párrafo que la explica.
 *
 * NO SE AFIRMA NI UN TEXTO AQUÍ: los literales se afirman escritos a mano en
 * `tests/unit/notificaciones/reparto-manana-aviso.test.ts`, y compararlos aquí contra la función
 * que los genera estaría siempre verde. Lo que se cuentan son FILAS y su `entidad_id`.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde. CON base pero SIN datos, falla
 * RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Dos noches consecutivas: el aviso del 11 anuncia el 12, y el del 12 anuncia el 13. */
const DIA_12 = "2026-09-12";
const DIA_13 = "2026-09-13";

describeSiHayBase("413/R7-R24 · la dedupe del aviso de reparto, contra Postgres real", () => {
  let prisma: PrismaClient;
  let mensajeroA: string;
  let mensajeroB: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 20 });
    if (usuarios.length < 2) {
      throw new Error(
        "hay DATABASE_URL pero hacen falta al menos DOS usuarios en la base. " +
          "Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    // Los mensajeros del caso parten de CERO avisos de este evento: contar filas sobre alguien que
    // ya arrastra las suyas mediría otra cosa. Si no hay dos limpios, se falla RUIDOSAMENTE.
    const conAviso = await prisma.notificacion.findMany({
      where: {
        evento: "reparto_manana",
        destinatarioUsuarioId: { in: usuarios.map((u) => u.id) },
      },
      select: { destinatarioUsuarioId: true },
    });
    const sucios = new Set<string | null>(conAviso.map((n) => n.destinatarioUsuarioId));
    const limpios = usuarios.filter((u) => !sucios.has(u.id));
    if (limpios.length < 2) {
      throw new Error(
        "hacen falta DOS usuarios sin avisos previos de `reparto_manana` para poder contar filas.",
      );
    }
    mensajeroA = limpios[0].id;
    mensajeroB = limpios[1].id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // =============================================================================================
  // R7 — DOS MENSAJEROS LA MISMA NOCHE: DOS FILAS. LA DECISIÓN MÁS DELICADA DE LA FICHA.
  // =============================================================================================

  it("⭑⭑ R7: dos mensajeros con reparto la MISMA noche reciben CADA UNO el suyo", async () => {
    // ⚠️ ES EL CASO QUE SOSTIENE §7 — que la entidad sea SÓLO el día y no lleve prefijo de
    // mensajero—. La entidad de las dos filas es LA MISMA (`2026-09-12`); lo único que las separa
    // es `destinatario_usuario_id`, que **SÍ** es una columna de `notificacion_dedupe_key`.
    //
    // MUTACIÓN OBLIGATORIA (design §13.2): dirigir el aviso a un ROL en vez de a un usuario ⇒ las
    // dos filas colisionan en la clave, `crear` absorbe el `P2002`, aquí sale **1** y ESTO SE PONE
    // ROJO. Es exactamente el silencio que la 409 destapó.
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx as unknown as PrismaClient);

      const a = await emitirRepartoManana(repo, {
        mensajeroUsuarioId: mensajeroA,
        diaAnunciadoISO: DIA_12,
      });
      const b = await emitirRepartoManana(repo, {
        mensajeroUsuarioId: mensajeroB,
        diaAnunciadoISO: DIA_12,
      });

      const filas = await tx.notificacion.findMany({
        where: {
          evento: "reparto_manana",
          destinatarioUsuarioId: { in: [mensajeroA, mensajeroB] },
        },
        select: {
          destinatarioUsuarioId: true,
          destinatarioRol: true,
          entidadTipo: true,
          entidadId: true,
          tipo: true,
        },
      });
      return { creadas: { a, b }, filas };
    });

    expect(medido.creadas.a).toBe(1);
    expect(medido.creadas.b).toBe(1);

    // ⭑ Y CONTADO EN LA TABLA, que es donde vive la verdad: DOS filas, una por mensajero.
    expect(medido.filas).toHaveLength(2);
    expect(medido.filas.map((f) => f.destinatarioUsuarioId).sort()).toEqual(
      [mensajeroA, mensajeroB].sort(),
    );
    // La MISMA entidad las dos: el alcance no está ahí, está en la columna del destinatario.
    expect(medido.filas.map((f) => f.entidadId)).toEqual([DIA_12, DIA_12]);
    // Dirigidas a un USUARIO: el XOR de destinatario deja el rol en `null` (146/D1).
    expect(medido.filas.map((f) => f.destinatarioRol)).toEqual([null, null]);
    // La entidad y el tipo, escritos a mano y no derivados del emisor.
    expect(medido.filas.map((f) => f.entidadTipo)).toEqual([
      "reparto_manana_dia",
      "reparto_manana_dia",
    ]);
    expect(medido.filas.map((f) => f.tipo)).toEqual(["box", "box"]);
  });

  // =============================================================================================
  // R23 — DOS NOCHES CONSECUTIVAS: DOS FILAS
  // =============================================================================================

  it("⭑⭑ R23: dos noches consecutivas dejan DOS filas, con la primera SIN LEER", async () => {
    // ⚠️ LA MITAD QUE LA 262 Y LA 403 PAGARON. Con una entidad que no cambiara entre jornadas, la
    // clave ('reparto_manana', <fija>, NULL, <mensajero>) admitiría UNA sola fila PARA SIEMPRE —el
    // índice no mira el estado de lectura— y el aviso de la segunda noche no saldría NUNCA: sin
    // error, sin log y sin nada.
    //
    // MUTACIÓN OBLIGATORIA (design §13.3): quitar el día del `entidad_id` ⇒ aquí sale 1 ⇒ ROJO.
    //
    // La primera se deja SIN LEER a propósito: es lo que hace el caso duro. Con el estado de
    // lectura de por medio, la guardia previa no se ejercitaría.
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx as unknown as PrismaClient);

      const noche1 = await emitirRepartoManana(repo, {
        mensajeroUsuarioId: mensajeroA,
        diaAnunciadoISO: DIA_12,
      });
      const noche2 = await emitirRepartoManana(repo, {
        mensajeroUsuarioId: mensajeroA,
        diaAnunciadoISO: DIA_13,
      });

      const filas = await tx.notificacion.findMany({
        where: { evento: "reparto_manana", destinatarioUsuarioId: mensajeroA },
        select: { id: true, entidadId: true },
        orderBy: { entidadId: "asc" },
      });
      const lecturas = await tx.notificacionLectura.count({
        where: { notificacionId: { in: filas.map((f) => f.id) } },
      });
      return { creadas: { noche1, noche2 }, filas, lecturas };
    });

    expect(medido.creadas.noche1).toBe(1);
    expect(medido.creadas.noche2).toBe(1);
    expect(medido.lecturas, "el caso deja de ser duro si alguna se marcó leída").toBe(0);

    // ⭑ DOS filas, una por día anunciado.
    expect(medido.filas).toHaveLength(2);
    expect(medido.filas.map((f) => f.entidadId)).toEqual([DIA_12, DIA_13]);
  });

  // =============================================================================================
  // R22 / R14 — LA MISMA NOCHE, DOS CORRIDAS: UNA SOLA FILA, TAMBIÉN SI EL NÚMERO SUBE
  // =============================================================================================

  it("⭑ R22: dos corridas del MISMO anuncio dejan UNA fila", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx as unknown as PrismaClient);
      const ctx = { mensajeroUsuarioId: mensajeroA, diaAnunciadoISO: DIA_12 };

      const primera = await emitirRepartoManana(repo, ctx);
      const repetida = await emitirRepartoManana(repo, ctx);

      const filas = await tx.notificacion.count({
        where: { evento: "reparto_manana", destinatarioUsuarioId: mensajeroA },
      });
      return { primera, repetida, filas };
    });

    expect(medido.primera).toBe(1);
    expect(medido.repetida).toBe(0);
    expect(medido.filas).toBe(1);
  });

  it("⭑⭑ R14: subir el número entre las dos corridas SIGUE dejando UNA fila", async () => {
    // ⚠️ ES R14 DICHO EN LA TABLA, y la razón por la que el número NO se persiste (R15): el emisor
    // NI SIQUIERA RECIBE el número, así que no hay forma de que un cambio de cifra produzca una
    // segunda notificación. Aquí se simula la noche real —a las 19:00 tenía 5, a las 21:00 tiene
    // 8— y se cuenta lo que quedó en la tabla.
    //
    // La `descripcion` de la única fila tampoco puede haber cambiado: si alguien metiera el número
    // dentro, las dos emisiones producirían textos distintos y el segundo aserto lo delataría.
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new NotificacionRepository(tx as unknown as PrismaClient);
      const ctx = { mensajeroUsuarioId: mensajeroA, diaAnunciadoISO: DIA_12 };

      // 19:00 CR — el mensajero tenía 5 órdenes.
      await emitirRepartoManana(repo, ctx);
      // 21:00 CR — le asignaron 3 más. El contexto del emisor es IDÉNTICO: no lleva el número.
      await emitirRepartoManana(repo, ctx);

      return tx.notificacion.findMany({
        where: { evento: "reparto_manana", destinatarioUsuarioId: mensajeroA },
        select: { descripcion: true, entidadId: true },
      });
    });

    expect(medido).toHaveLength(1);
    // Y el texto persistido no lleva ninguna cifra de conteo: ni el 5 ni el 8.
    expect(medido[0].descripcion).not.toContain("5 ");
    expect(medido[0].descripcion).not.toContain("8 ");
    expect(medido[0].entidadId).toBe(DIA_12);
  });

  // =============================================================================================
  // R24 — Y QUE LO DECIDA EL ÍNDICE, NO UN `if`
  // =============================================================================================

  it("⭑⭑ R24: dos emisiones CONCURRENTES sobre CONEXIONES DISTINTAS dejan UNA fila, sin error", async () => {
    // ⚠️ POR QUÉ ESTE CASO NO CABE EN `enTransaccionRevertida`. La guardia previa
    // `existeNoLeidaPara` es un `SELECT`: con las dos emisiones en paralelo, las DOS pueden verlo
    // vacío y las DOS llegar al `INSERT`. Quien decide entonces es el ÍNDICE ÚNICO — y un `P2002`
    // dentro de una transacción la ABORTA entera en Postgres, así que no se puede medir desde
    // dentro de una. Se escribe de verdad, sobre dos clientes distintos, y se LIMPIA en el
    // `finally` pase lo que pase.
    //
    // ES R24 LITERAL: la unicidad es ESTRUCTURAL —una propiedad de la clave de los datos— y no el
    // resultado de una comprobación previa que una carrera o un reintento puedan burlar.
    const clienteA = crearPrismaDeTest();
    const clienteB = crearPrismaDeTest();
    try {
      const ctx = { mensajeroUsuarioId: mensajeroA, diaAnunciadoISO: DIA_12 };

      // Ninguna de las dos propaga: el `P2002` lo absorbe `crear` devolviendo `null`.
      const creadas = await Promise.all([
        emitirRepartoManana(new NotificacionRepository(clienteA), ctx),
        emitirRepartoManana(new NotificacionRepository(clienteB), ctx),
      ]);

      const filas = await prisma.notificacion.count({
        where: {
          evento: "reparto_manana",
          entidadId: DIA_12,
          destinatarioUsuarioId: mensajeroA,
        },
      });

      // Una escribió y la otra no; cuál de las dos, da igual.
      expect(creadas.filter((n) => n === 1)).toHaveLength(1);
      expect(creadas.filter((n) => n === 0)).toHaveLength(1);
      // ⭑ Y EN LA TABLA: UNA sola fila. Lo decidió el índice, no un `if`.
      expect(filas).toBe(1);
    } finally {
      await clienteA.$disconnect();
      await clienteB.$disconnect();
      // Limpieza EXPLÍCITA: ésta es la única parte del archivo que escribe fuera de una
      // transacción revertida, y la base local es COMPARTIDA entre worktrees. Una tabla que crece
      // rompe tests ajenos, y en este repo ya pasó.
      //
      // ⚠️⚠️ EL BARRIDO ES POR **EVENTO**, NO POR `entidad_id` NI SÓLO POR DESTINATARIO, Y ESTO SE
      // MIDIÓ EN ESTA MISMA FICHA EL 2026-09-11, NO SE RAZONÓ.
      //
      // La 412 ya había dejado escrito medio aviso: un barrido por `entidad_id` deja viva la fila
      // que escribe la mutación «quitar el día de la entidad». Aquí se cobró LA OTRA MITAD, con la
      // mutación **M2 (dirigir el aviso a un ROL)**: esa fila sale con `destinatario_rol =
      // 'mensajero'` y `destinatario_usuario_id = NULL`, así que un barrido acotado a
      // `destinatarioUsuarioId: mensajeroA` NO LA VE. Sobrevivió a la corrida de mutaciones y dejó
      // UNA fila `reparto_manana` en la base compartida — y eso puso ROJOS **15 casos de 5 suites
      // de migración ajenas** (`22P02`: sus `down.sql` recrean el enum con su lista histórica y no
      // pueden castear un valor posterior). Un rojo con mi nombre en un archivo que no toqué.
      //
      // LA REGLA: **un barrido que sólo limpia lo que el código SANO escribe es justo el que falla
      // cuando hace falta.** Se barre por `evento`, que es lo único que ninguna mutación cambia.
      // El `beforeAll` exige que los dos mensajeros partan de CERO avisos de este evento, y en
      // producción este evento SÓLO se emite a usuarios: una fila de rol es, por construcción,
      // basura de una mutación.
      const suyas = await prisma.notificacion.findMany({
        where: { evento: "reparto_manana" },
        select: { id: true },
      });
      await prisma.notificacionLectura.deleteMany({
        where: { notificacionId: { in: suyas.map((n) => n.id) } },
      });
      await prisma.notificacion.deleteMany({ where: { id: { in: suyas.map((n) => n.id) } } });
    }
  });

  // =============================================================================================
  // ANTI-VACUIDAD — que este archivo no pueda pasar «por vacío»
  // =============================================================================================

  it("⭑ AUTOCOMPROBACIÓN: sin emitir nada, contar da CERO — los casos de arriba miden de verdad", async () => {
    // Es la lección «test de integración verde sin datos»: un `if (!fks) return;` reporta `passed`
    // sin comprobar nada. Aquí se demuestra que el contador que usan los casos de arriba DISTINGUE
    // el estado sembrado del vacío: si devolviera siempre 2, este caso se pondría rojo.
    const vacio = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      return tx.notificacion.count({
        where: {
          evento: "reparto_manana",
          destinatarioUsuarioId: { in: [mensajeroA, mensajeroB] },
        },
      });
    });

    expect(vacio).toBe(0);
  });

  it("⭑ AUTOCOMPROBACIÓN: los dos usuarios del caso existen y son distintos", async () => {
    // Si `mensajeroA` no existiera, `crear` habría reventado por FK y los casos de arriba no
    // habrían llegado a contar nada — pero conviene decirlo en un aserto propio en vez de confiar
    // en que otro caso lo note.
    expect(await prisma.usuario.count({ where: { id: { in: [mensajeroA, mensajeroB] } } })).toBe(2);
    expect(mensajeroA).not.toBe(mensajeroB);
  });

  it("⭑ el índice `notificacion_dedupe_key` es el que se dice que es (si no, nada de esto mide)", async () => {
    // ANTI-VACUIDAD de los cuatro casos de arriba: toda la dedupe de esta ficha descansa en que la
    // clave incluya `destinatario_usuario_id` (R7) y `entidad_id` (R22/R23), y en que NO mire el
    // estado de lectura. Se comprueba contra el catálogo, no contra la migración.
    const filas = await prisma.$queryRawUnsafe<{ def: string }[]>(
      `SELECT indexdef AS def FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
    );
    const def = filas[0]?.def ?? "";

    expect(def, "no existe `notificacion_dedupe_key`").not.toBe("");
    expect(def).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);
    expect(def).toMatch(/NULLS NOT DISTINCT/i);
    expect(def).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
    // ⚠️ El índice NO mira la lectura: por eso la entidad tiene que llevar el DÍA dentro.
    expect(def).not.toMatch(/leida/);
  });
});
