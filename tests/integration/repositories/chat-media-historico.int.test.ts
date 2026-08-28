import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "../db/_postgres-real";
import { ChatMensajeRepository } from "@/lib/repositories/ChatMensajeRepository";
import type { ChatMediaAutorizada } from "@/lib/interfaces/repositories/IChatMensajeRepository";

// Feature 321 / T4.1 (R29, R12) — `findMediaParaLectorHistorico` contra Postgres REAL.
//
// POR QUE CONTRA POSTGRES Y NO CON UN DOBLE, igual que su gemelo `chat-media-autorizada`: este
// metodo es SQL crudo (`$queryRaw`), y el fallo que ese archivo documenta era del MOTOR, no de
// la logica —`m.id = $1::uuid` sobre una columna `text` lanza `42883` y el proxy devuelve 500
// para TODO adjunto—. Un doble jamas ejecutaria esta SQL. Aqui se ejecuta de verdad: si alguien
// copia el cast al metodo nuevo, el primer caso revienta.
//
// QUE FIJA ESTE ARCHIVO, en una frase: la via del histórico ve el adjunto de una orden que NO
// es suya (R29) pero NO ve el de una orden borrada (R12); el ensanche quita EXACTAMENTE una
// condicion del WHERE, no dos.
//
// COMO NO ENSUCIA NADA: todo ocurre dentro de `enTransaccionRevertida`, que SIEMPRE hace
// rollback. El test crea SUS PROPIAS filas; si faltan los catalogos, FALLA con el motivo
// escrito en vez de retornar temprano y contar como `passed` (verde en falso). Lo unico que lo
// salta es la ausencia de `DATABASE_URL`.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface Medicion {
  /** Adjunto de una orden asignada a OTRO mensajero, leido por la via del histórico (R29). */
  deOrdenAjena: ChatMediaAutorizada | null;
  /** EL MISMO mensaje pedido por la via del mensajero por un tercero: sigue sin dar fila (R26). */
  elMismoPorLaViaDelMensajero: ChatMediaAutorizada | null;
  /** Adjunto de una orden borrada logicamente, por la via del histórico (R12). */
  deOrdenBorrada: ChatMediaAutorizada | null;
  /** Un uuid que no existe en la tabla. */
  deMensajeInexistente: ChatMediaAutorizada | null;
  ordenAjenaId: string;
  mediaIdSembrado: string;
}

describeSiHayBase("321 / R29-R12 — findMediaParaLectorHistorico contra Postgres real", () => {
  let prisma: PrismaClient;
  let m: Medicion;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    m = await enTransaccionRevertida(prisma, medir);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function medir(tx: Tx): Promise<Medicion> {
    // PRIMERA sentencia: este test escribe usuarios y ordenes REALES en `public`, igual que
    // otros archivos que corren en paralelo. Sin serializar, las transacciones toman los mismos
    // locks de FK en distinto orden y Postgres mata a una con `40P01`.
    await serializarEscriturasReales(tx);

    const repo = new ChatMensajeRepository(tx as unknown as PrismaClient);

    const tienda = await crearUsuario(tx, "Tienda del test 321");
    const mensajeroDuenio = await crearUsuario(tx, "Mensajero duenio 321");
    const otroMensajero = await crearUsuario(tx, "Mensajero ajeno 321");

    // La orden es del PRIMER mensajero. El lector del histórico no es ninguno de los dos.
    const ordenAjenaId = await crearOrden(tx, tienda, mensajeroDuenio, null);
    const ordenBorradaId = await crearOrden(tx, tienda, mensajeroDuenio, new Date());

    const mediaIdSembrado = `wamid.media.${randomUUID()}`;
    const mensajeId = await sembrarMensajeConAdjunto(
      tx,
      ordenAjenaId,
      mensajeroDuenio,
      mediaIdSembrado,
    );
    const mensajeDeOrdenBorradaId = await sembrarMensajeConAdjunto(
      tx,
      ordenBorradaId,
      mensajeroDuenio,
      `wamid.media.${randomUUID()}`,
    );

    return {
      deOrdenAjena: await repo.findMediaParaLectorHistorico(mensajeId),
      elMismoPorLaViaDelMensajero: await repo.findMediaParaMensajero(mensajeId, otroMensajero),
      deOrdenBorrada: await repo.findMediaParaLectorHistorico(mensajeDeOrdenBorradaId),
      deMensajeInexistente: await repo.findMediaParaLectorHistorico(randomUUID()),
      ordenAjenaId,
      mediaIdSembrado,
    };
  }

  /** Un hilo y un mensaje ENTRANTE de tipo imagen con sus metadatos de media. */
  async function sembrarMensajeConAdjunto(
    tx: Tx,
    ordenId: string,
    mensajeroId: string,
    mediaId: string,
  ): Promise<string> {
    const conversacion = await tx.chatConversacion.create({
      data: {
        telefonoE164: `5930000${randomUUID().slice(0, 5)}`,
        ordenId,
        mensajeroId,
      },
      select: { id: true },
    });
    const { id } = await tx.chatMensaje.create({
      data: {
        conversacionId: conversacion.id,
        direccion: "entrante",
        tipo: "imagen",
        mediaId,
        mediaMime: "image/jpeg",
        mediaNombre: "foto-entrega.jpg",
        ocurridoAt: new Date("2026-08-27T12:00:00.000Z"),
      },
      select: { id: true },
    });
    return id;
  }

  /** Un usuario NUEVO del test. Si faltan los catalogos, FALLA (no se abstiene). */
  async function crearUsuario(tx: Tx, nombre: string): Promise<string> {
    const rol = await tx.rol.findFirst({ select: { id: true } });
    const tipo = await tx.tipoIdentificacion.findFirst({ select: { id: true } });
    if (!rol || !tipo) {
      throw new Error(
        "La base de pruebas no tiene catalogos `rol`/`tipo_identificacion` sembrados: sin ellos " +
          "no se pueden crear los usuarios propios del test. Corre `pnpm db:seed`. Este test NO " +
          "se salta en ese caso a proposito.",
      );
    }
    const sufijo = randomUUID().slice(0, 8);
    const { id } = await tx.usuario.create({
      data: {
        nombre: `${nombre} ${sufijo}`,
        email: `t321-${sufijo}@example.test`,
        telefono: "00000000",
        passwordHash: "x",
        cedula: `t321${sufijo}`,
        tipoIdentificacionId: tipo.id,
        rolId: rol.id,
      },
      select: { id: true },
    });
    return id;
  }

  /** Una orden NUEVA del test, con las FK obligatorias tomadas de los catalogos. */
  async function crearOrden(
    tx: Tx,
    tiendaId: string,
    mensajeroId: string,
    deletedAt: Date | null,
  ): Promise<string> {
    const canton = await tx.canton.findFirst({ select: { id: true, provinciaId: true } });
    const zona = await tx.zona.findFirst({ select: { id: true } });
    const estatus = await tx.orderStatus.findFirst({ select: { id: true } });
    if (!canton || !zona || !estatus) {
      throw new Error(
        "La base de pruebas no tiene catalogos de geografia/estatus sembrados: sin ellos no se " +
          "puede crear la orden propia del test (y sin orden no hay hilo ni adjunto que medir). " +
          "Corre `pnpm db:seed`. Este test NO se salta en ese caso a proposito.",
      );
    }
    const sufijo = randomUUID().slice(0, 12);
    const { id } = await tx.orden.create({
      data: {
        numRemision: `t321-${sufijo}`,
        estatusId: estatus.id,
        destinatario: "Destinatario de prueba",
        telefonoDest: "00000000",
        tiendaId,
        zonaId: zona.id,
        provinciaId: canton.provinciaId,
        cantonId: canton.id,
        producto: "Producto",
        mensajeroAsignadoId: mensajeroId,
        deletedAt,
      },
      select: { id: true },
    });
    return id;
  }

  // ==========================================================================================

  it("R29: devuelve el adjunto de un mensaje de una orden asignada a OTRO mensajero", () => {
    // Este es el ensanche: la via del histórico NO lleva `o.mensajero_asignado_id = $x` en el
    // WHERE, asi que la fila sale aunque quien pregunta no sea el mensajero de la orden. Que el
    // assert vea datos reales prueba ademas que la SQL se ejecuto (sin `42883`).
    expect(m.deOrdenAjena).not.toBeNull();
    expect(m.deOrdenAjena!.mediaId).toBe(m.mediaIdSembrado);
    expect(m.deOrdenAjena!.mediaMime).toBe("image/jpeg");
    expect(m.deOrdenAjena!.mediaNombre).toBe("foto-entrega.jpg");
    expect(m.deOrdenAjena!.ordenId).toBe(m.ordenAjenaId);
  });

  it("R26: el MISMO mensaje sigue sin salir por la via del mensajero para un tercero", () => {
    // El ensanche es un metodo NUEVO, no un interruptor sobre el viejo: la puerta del mensajero
    // se queda exactamente igual de cerrada para quien no es el asignado.
    expect(m.elMismoPorLaViaDelMensajero).toBeNull();
  });

  it("R12: no devuelve nada si la orden esta borrada logicamente", () => {
    // Se quito UNA condicion del WHERE (la del mensajero), no dos: `o.deleted_at IS NULL` sigue
    // ahi. Una orden borrada no da acceso a nada, tampoco al lector del histórico.
    expect(m.deOrdenBorrada).toBeNull();
  });

  it("devuelve null si el mensaje no existe", () => {
    expect(m.deMensajeInexistente).toBeNull();
  });
});
