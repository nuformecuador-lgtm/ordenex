import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ChatConversacionRepository } from "@/lib/repositories/ChatConversacionRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * ⭑ FICHA 312 (G1) — QUE LE PASA AL WHATSAPP CUANDO SE CORRIGE EL NUMERO, contra Postgres real.
 *
 * ESTE ES EL PUNTO DELICADO DE LA FICHA, y se mide en la base porque el matcheo del entrante NO
 * es codigo de aplicacion: es un `WHERE` con la normalizacion del telefono hecha EN SQL
 * (`sqlNormalizarTelefonoCr` sobre `orden.telefono_dest`). Con dobles no se puede afirmar ni que
 * el numero nuevo casa ni que el viejo deja de casar.
 *
 * LO QUE ESTABLECE (design §5.2):
 *  · R20 — un entrante desde el numero CORREGIDO se resuelve a esta orden.
 *  · R21 — un entrante desde el numero ANTERIOR ya NO se resuelve a esta orden.
 *  · R19 — la fila de `chat_conversacion` del numero viejo sigue EXACTAMENTE donde estaba, con
 *          sus mensajes y su `telefono_e164` sin cambiar. NO se llama a `migrarTelefono` (D5):
 *          si el numero estaba mal escrito, ese hilo es una conversacion con OTRA persona, y
 *          coserlo al historial del cliente correcto no es continuidad, es contaminacion.
 *
 * ANTI-VACUIDAD: antes de corregir se comprueba que el numero VIEJO SI resolvia a esta orden. Sin
 * eso, «el viejo ya no resuelve» pasaria verde tambien si la consulta estuviera rota o si el
 * numero sembrado no fuera de nadie.
 *
 * ⚠️ Sin base, `describe.skip` visible. Todo dentro de una transaccion que siempre se revierte.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `312-chat-${Date.now().toString(36)}`;
const GUIA_BASE = 942_000_000 + (Date.now() % 40_000_000);

/**
 * Dos numeros locales de 8 digitos PROPIOS DE ESTA CORRIDA. Se derivan del reloj para que ninguna
 * otra orden de la base de desarrollo los tenga: si el numero fuera uno cualquiera, el
 * `LIMIT 1` de la resolucion podria devolver la orden de otro y el test mediria otra cosa.
 *
 * El E.164 se escribe A MANO (`506` + los 8 digitos) y no llamando al normalizador: comparar la
 * consulta contra la funcion que la alimenta seria una asercion contra su propia fuente.
 */
const OCHO = (Date.now() % 9_000_000) + 1_000_000; // 7 digitos, sin ceros a la izquierda
const TELEFONO_VIEJO = `8${OCHO}`;
const TELEFONO_NUEVO = `7${OCHO}`;
const E164_VIEJO = `506${TELEFONO_VIEJO}`;
const E164_NUEVO = `506${TELEFONO_NUEVO}`;

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

describeSiHayBase("⭑ 312/G1 — corregir el telefono y el hilo de WhatsApp", () => {
  let prisma: PrismaClient;
  let ESTATUS_EN_REPARTO: string;
  let FKS: {
    estatusId: string;
    tiendaId: string;
    zonaId: string;
    provinciaId: string;
    cantonId: string;
  };

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    FKS = fks;

    const estado = await prisma.orderStatus.findFirst({
      where: { value: "en_reparto" },
      select: { id: true },
    });
    if (estado === null) {
      throw new Error("el catalogo `order_status` no tiene `en_reparto`. Corre el seed.");
    }
    ESTATUS_EN_REPARTO = estado.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * Siembra una orden VIVA con mensajero asignado y telefono `TELEFONO_VIEJO`, mas un hilo de chat
   * con `E164_VIEJO` y DOS mensajes. El mensajero es el mismo usuario que la tienda dueña: la FK
   * apunta a `usuario` y esta prueba no mide nada del rol.
   */
  async function conOrdenYHilo<T>(
    fn: (ctx: {
      tx: PrismaClient;
      ordenId: string;
      conversacionId: string;
      chat: ChatConversacionRepository;
      repo: OrdenRepository;
      tarifas: TarifaVigenteRepository;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const orden = await tx.orden.create({
        data: {
          numGuia: GUIA_BASE + Math.floor(Math.random() * 1_000_000),
          numRemision: `R-${SUFIJO}-${Math.random().toString(36).slice(2, 10)}`,
          destinatario: "Ana Peres",
          telefonoDest: TELEFONO_VIEJO,
          producto: "caja de zapatos",
          estatusId: ESTATUS_EN_REPARTO,
          tiendaId: FKS.tiendaId,
          zonaId: FKS.zonaId,
          provinciaId: FKS.provinciaId,
          cantonId: FKS.cantonId,
          mensajeroAsignadoId: FKS.tiendaId,
          asignadoAt: new Date("2026-08-20T15:00:00.000Z"),
        },
        select: { id: true },
      });
      const conversacion = await tx.chatConversacion.create({
        data: {
          ordenId: orden.id,
          telefonoE164: E164_VIEJO,
          mensajeroId: FKS.tiendaId,
          ultimoEntranteAt: new Date("2026-08-20T16:00:00.000Z"),
          mensajes: {
            create: [
              {
                direccion: "entrante",
                tipo: "texto",
                cuerpo: "hola",
                ocurridoAt: new Date("2026-08-20T16:00:00.000Z"),
              },
              {
                direccion: "saliente",
                tipo: "texto",
                cuerpo: "buenas",
                ocurridoAt: new Date("2026-08-20T16:05:00.000Z"),
              },
            ],
          },
        },
        select: { id: true },
      });
      // Ficha 327: `corregirDatosCliente` abre su propia transaccion (outbox del job de
      // geocodificacion), y `Prisma.TransactionClient` no expone `$transaction`. El envoltorio la
      // resuelve como pass-through SOBRE LA MISMA tx: el SQL que se mide sigue siendo el real.
      const cliente = clienteConTransaccionAnidada(tx);
      return fn({
        tx: cliente,
        ordenId: orden.id,
        conversacionId: conversacion.id,
        chat: new ChatConversacionRepository(cliente),
        repo: new OrdenRepository(cliente),
        // Ficha 327: el servicio pide el resolver de tarifas para el aviso del importe. Esta
        // suite corrige el TELEFONO, asi que no llega a usarlo; se pasa el real igualmente para
        // no montar un doble que no aporta nada.
        tarifas: new TarifaVigenteRepository(cliente),
      });
    });
  }

  it("⭑ R20/R21: el numero NUEVO resuelve a la orden y el ANTERIOR ya no", async () => {
    const r = await conOrdenYHilo(async (ctx) => {
      // ANTI-VACUIDAD: antes de corregir, el numero viejo SI es el de esta orden.
      const antes = await ctx.chat.resolverOrdenActivaPorNumero(E164_VIEJO);

      const service = new CorregirDatosClienteService(ctx.repo, ctx.tarifas);
      const resultado = await service.corregir(
        { ordenId: ctx.ordenId, telefonoDest: TELEFONO_NUEVO },
        MAESTRO,
      );

      const [porElNuevo, porElViejo] = await Promise.all([
        ctx.chat.resolverOrdenActivaPorNumero(E164_NUEVO),
        ctx.chat.resolverOrdenActivaPorNumero(E164_VIEJO),
      ]);
      return { antes, resultado, porElNuevo, porElViejo, ordenId: ctx.ordenId };
    });

    expect(r.antes?.ordenId, "el numero sembrado no resolvia a la orden: el test medía otra cosa").toBe(
      r.ordenId,
    );
    expect(r.resultado).toEqual({ status: "ok", cambios: ["telefonoDest"] });

    // R20 — el entrante desde el numero corregido llega a ESTA orden.
    expect(r.porElNuevo?.ordenId).toBe(r.ordenId);
    // Y el hilo se keyeara con el numero nuevo normalizado (lo que hara `upsertParaOrden`).
    expect(r.porElNuevo?.telefonoE164).toBe(E164_NUEVO);

    // R21 — el entrante desde el numero anterior ya NO llega a esta orden. Se afirma «no es
    // ESTA», no «es null»: la base de desarrollo puede tener cualquier otra orden con ese numero,
    // y lo que la ficha promete es que la conversacion vieja deja de apuntar aqui.
    expect(r.porElViejo?.ordenId).not.toBe(r.ordenId);
  });

  it("⭑ R19: la fila de `chat_conversacion` del numero viejo sigue INTACTA, con sus 2 mensajes", async () => {
    const r = await conOrdenYHilo(async (ctx) => {
      const service = new CorregirDatosClienteService(ctx.repo, ctx.tarifas);
      const resultado = await service.corregir(
        { ordenId: ctx.ordenId, telefonoDest: TELEFONO_NUEVO },
        MAESTRO,
      );

      const hilos = await ctx.tx.chatConversacion.findMany({
        where: { ordenId: ctx.ordenId },
        select: { id: true, telefonoE164: true, ultimoEntranteAt: true },
      });
      const mensajes = await ctx.tx.chatMensaje.count({
        where: { conversacionId: ctx.conversacionId },
      });
      return { resultado, hilos, mensajes, conversacionId: ctx.conversacionId };
    });

    expect(r.resultado).toEqual({ status: "ok", cambios: ["telefonoDest"] });
    // NO se migro, NO se fusiono y NO se borro: sigue habiendo UN hilo, el de siempre.
    expect(r.hilos).toHaveLength(1);
    expect(r.hilos[0].id).toBe(r.conversacionId);
    expect(r.hilos[0].telefonoE164).toBe(E164_VIEJO);
    expect(r.hilos[0].ultimoEntranteAt?.toISOString()).toBe("2026-08-20T16:00:00.000Z");
    expect(r.mensajes).toBe(2);
  });
});
