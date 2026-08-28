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

// Feature 311 (R23) — `findMediaParaMensajero` contra Postgres REAL.
//
// POR QUE CONTRA POSTGRES Y NO CON UN DOBLE. Este metodo es la UNICA pieza del proxy de media
// escrita en SQL crudo (`$queryRaw`), y el bug que este archivo existe para cerrar era del
// MOTOR, no de la logica: el WHERE llevaba `m.id = $1::uuid`, pero `chat_mensaje.id` se declara
// `String @id @default(uuid())` SIN `@db.Uuid`, asi que la columna real es `text`. Postgres no
// tiene operador `text = uuid`, la consulta lanzaba `42883` y el route handler
// `/api/chat/media/<id>` —que no captura— respondia 500 para TODO adjunto del chat. Los tests
// unitarios de la ruta mockean el repositorio, asi que esa SQL no se ejecutaba NUNCA y el fallo
// llego a produccion. Aqui la SQL se ejecuta de verdad: si alguien reintroduce el cast, el
// primer caso revienta (la excepcion sube sin try/catch y tumba el `beforeAll`).
//
// COMO NO ENSUCIA NADA: todo ocurre dentro de `enTransaccionRevertida`, que SIEMPRE hace
// rollback. El test crea SUS PROPIAS filas a partir de los catalogos; si faltan, FALLA con el
// motivo escrito en vez de retornar temprano y contar como `passed` (verde en falso). Lo unico
// que lo salta es la ausencia de `DATABASE_URL`.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface Medicion {
  /** Mensaje con adjunto de una orden asignada al mensajero que pregunta. */
  propia: ChatMediaAutorizada | null;
  /** El MISMO mensaje, pedido por otro mensajero. */
  ajena: ChatMediaAutorizada | null;
  /** Mensaje con adjunto cuya orden esta borrada logicamente. */
  deOrdenBorrada: ChatMediaAutorizada | null;
  ordenId: string;
  mediaIdSembrado: string;
}

describeSiHayBase("311 / R23 — findMediaParaMensajero contra Postgres real", () => {
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

    const tienda = await crearUsuario(tx, "Tienda del test 311");
    const mensajero = await crearUsuario(tx, "Mensajero duenio 311");
    const otroMensajero = await crearUsuario(tx, "Mensajero ajeno 311");

    const ordenId = await crearOrden(tx, tienda, mensajero, null);
    const ordenBorradaId = await crearOrden(tx, tienda, mensajero, new Date());

    const mediaIdSembrado = `wamid.media.${randomUUID()}`;
    const mensajeId = await sembrarMensajeConAdjunto(tx, ordenId, mensajero, mediaIdSembrado);
    const mensajeDeOrdenBorradaId = await sembrarMensajeConAdjunto(
      tx,
      ordenBorradaId,
      mensajero,
      `wamid.media.${randomUUID()}`,
    );

    return {
      propia: await repo.findMediaParaMensajero(mensajeId, mensajero),
      ajena: await repo.findMediaParaMensajero(mensajeId, otroMensajero),
      deOrdenBorrada: await repo.findMediaParaMensajero(mensajeDeOrdenBorradaId, mensajero),
      ordenId,
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
        email: `t311-${sufijo}@example.test`,
        telefono: "00000000",
        passwordHash: "x",
        cedula: `t311${sufijo}`,
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
        numRemision: `t311-${sufijo}`,
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

  it("devuelve el adjunto del mensaje cuando la orden esta asignada a quien pregunta", () => {
    // ESTE es el caso que fallaba con `::uuid`: la consulta ni siquiera llegaba a decidir, se
    // caia con `42883` y el proxy respondia 500. Que este assert vea una fila prueba que la SQL
    // se ejecuto de verdad contra Postgres.
    expect(m.propia).not.toBeNull();
    expect(m.propia!.mediaId).toBe(m.mediaIdSembrado);
    expect(m.propia!.mediaMime).toBe("image/jpeg");
    expect(m.propia!.mediaNombre).toBe("foto-entrega.jpg");
    expect(m.propia!.ordenId).toBe(m.ordenId);
  });

  it("no devuelve nada si la orden es de OTRO mensajero (R23: la autorizacion es la puerta)", () => {
    // Mismo mensaje, mismo adjunto, otro solicitante: sin fila, y el route responde 403 sin
    // tocar la Graph API. La autorizacion va en el WHERE, no en un `if` posterior.
    expect(m.ajena).toBeNull();
  });

  it("no devuelve nada si la orden esta borrada logicamente", () => {
    // La orden es del mismo mensajero, pero `deleted_at IS NOT NULL`: una orden borrada no da
    // acceso a nada.
    expect(m.deOrdenBorrada).toBeNull();
  });
});
