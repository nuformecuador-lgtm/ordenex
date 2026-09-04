import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";
import { ApiKeyService } from "@/lib/services/ApiKeyService";
import type { Actor } from "@/lib/interfaces/services/IApiKeyService";

import {
  HAY_BASE_DE_DATOS,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 373 / C5 (R16) — LA RED DE ABAJO: UNA FK QUE EL GUARD **NO** MIRA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE SE MIDE, Y POR QUE ES EL TEST MAS IMPORTANTE DEL DISENO. El guard comprueba CUATRO cosas
// (ordenes, libro de tienda, pagos de liquidacion, tarifas) y deja fuera otras diez FK hacia
// `usuario` con el argumento de que «solo pueden existir si existio una orden». Eso es un
// RAZONAMIENTO, no una medicion — y en este repo hay escrito que «una imposibilidad razonada no es
// medida»: un invariante que se sostenia leyendo el codigo lo desmintio Postgres.
//
// Asi que la ficha no se apoya en el razonamiento: se apoya en la RED. Si algo que el guard no mira
// apunta a la cuenta dedicada, la FK `Restrict` de Postgres para el `DELETE`, la transaccion
// revierte ENTERA y el sistema responde `bloqueada` con motivo `otros_datos`. Nunca un borrado
// parcial, nunca un 500.
//
// LA TABLA ELEGIDA: `orden_habilitacion_api.actor_usuario_id` (`Restrict`). Se eligio porque es
// literalmente una fila que ESCRIBE una API key al operar (`OrdenHabilitacionApiRepository`), y
// porque NO esta entre las cuatro del guard — su presencia implica una orden habilitada, y esa
// orden ya bloquearia por la comprobacion #1. Aqui se fuerza el escenario que el razonamiento dice
// que no puede pasar: la fila SIN la orden de la cuenta. Es exactamente la sorpresa contra la que
// la red existe.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `373-fk-${Date.now().toString(36)}`;

describeSiHayBase("373/C5 — una FK inesperada bloquea sin romper nada (Postgres real)", () => {
  let prisma: PrismaClient;
  let FKS: Awaited<ReturnType<typeof fksDeOrden>>;
  let MAESTRO: Actor;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    FKS = await fksDeOrden(prisma);
    if (FKS === null) {
      throw new Error("hay DATABASE_URL pero `orden` esta vacia: corre `pnpm run db:seed` antes.");
    }
    const maestro = await prisma.usuario.findFirst({
      where: { rol: { value: "maestro" } },
      select: { id: true },
    });
    if (maestro === null) throw new Error("no hay usuario con rol `maestro` en esta base");
    MAESTRO = { usuarioId: maestro.id, rol: "maestro" };
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function generarKey(tx: TxDeTest, marca: string) {
    const identificador = `${SUFIJO}-${marca}-${randomUUID().slice(0, 8)}`;
    const servicio = new ApiKeyService(new ApiKeyRepository(clienteConSavepoint(tx)));
    const r = await servicio.generar({ identificador, tiendaDestinoId: undefined }, MAESTRO);
    if (r.status !== "ok") throw new Error(`no se pudo sembrar la key: ${r.status}`);
    return r.apiKey;
  }

  it("⭑ R16: `bloqueada` con `otros_datos`, y NI UNA fila borrada", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const apiKey = await generarKey(tx, "fk");
      await tx.webhookSuscripcion.create({
        data: {
          ownerUsuarioId: apiKey.usuarioId,
          url: "https://ejemplo.invalid/webhook",
          secret: "ciphertext-de-mentira",
        },
        select: { id: true },
      });
      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });

      // La orden es de OTRA tienda: la cuenta dedicada sigue sin ordenes propias, asi que el guard
      // por datos la da por LIMPIA. Es lo que hace de este el caso «inesperado».
      const orden = await tx.orden.create({
        data: {
          numRemision: `R-${SUFIJO}-${randomUUID().slice(0, 8)}`,
          destinatario: "Dest",
          telefonoDest: "88880000",
          producto: "Prod",
          estatusId: FKS!.estatusId,
          tiendaId: FKS!.tiendaId,
          zonaId: FKS!.zonaId,
          provinciaId: FKS!.provinciaId,
          cantonId: FKS!.cantonId,
        },
        select: { id: true },
      });

      // LA FILA QUE EL GUARD NO MIRA, apuntando a la cuenta dedicada.
      await tx.ordenHabilitacionApi.create({
        data: {
          ordenId: orden.id,
          actorUsuarioId: apiKey.usuarioId,
          nota: "habilitacion sembrada por el test de la red de FK",
          cambioDeEstado: false,
          estadoResultante: "en_reparto",
        },
        select: { id: true },
      });

      const repo = new ApiKeyRepository(clienteConSavepoint(tx));
      // El guard, medido aparte: dice que esta LIMPIA. Sin esto, el test no probaria que la red
      // actua donde el guard no llega.
      const guard = (await repo.dependenciasDeCuentasDedicadas([apiKey.usuarioId])).get(
        apiKey.usuarioId,
      );
      const salida = await repo.eliminar(apiKey.id, MAESTRO.usuarioId);

      return {
        guard,
        salida,
        key: await tx.apiKey.count({ where: { id: apiKey.id } }),
        usuario: await tx.usuario.count({ where: { id: apiKey.usuarioId } }),
        webhook: await tx.webhookSuscripcion.count({ where: { ownerUsuarioId: apiKey.usuarioId } }),
        habilitacion: await tx.ordenHabilitacionApi.count({
          where: { actorUsuarioId: apiKey.usuarioId },
        }),
        registro: await tx.historialAccion.count({
          where: { entidadId: apiKey.id, accion: "api_key_eliminada" },
        }),
      };
    });

    // El guard NO vio nada: la cuenta esta limpia para las cuatro comprobaciones.
    expect(r.guard).toEqual({ ordenes: false, dinero: false, tarifas: false });
    // Y aun asi el borrado NO ocurre: lo paro Postgres, y llega como `bloqueada` sin diagnostico.
    expect(r.salida).toEqual({ status: "bloqueada", estado: null, dependencias: null });

    // ⭑ SIN BORRADO PARCIAL. El `deleteMany` del webhook y el `delete` de la key van ANTES del
    // `delete` del usuario, que es el que revienta: si la transaccion no revirtiera entera,
    // `webhook` y `key` serian 0 y la key habria desaparecido a medias.
    expect(r.key, "la key se borro pese a la FK: borrado PARCIAL").toBe(1);
    expect(r.webhook, "el webhook se borro pese a la FK: borrado PARCIAL").toBe(1);
    expect(r.usuario).toBe(1);
    expect(r.habilitacion).toBe(1);
    // Y ninguna fila de auditoria de un borrado que no ocurrio.
    expect(r.registro).toBe(0);
  });

  it("⭑ el servicio traduce esa respuesta a `otros_datos`, el unico motivo que la produce", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const apiKey = await generarKey(tx, "svc");
      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });
      const orden = await tx.orden.create({
        data: {
          numRemision: `R-${SUFIJO}-${randomUUID().slice(0, 8)}`,
          destinatario: "Dest",
          telefonoDest: "88880000",
          producto: "Prod",
          estatusId: FKS!.estatusId,
          tiendaId: FKS!.tiendaId,
          zonaId: FKS!.zonaId,
          provinciaId: FKS!.provinciaId,
          cantonId: FKS!.cantonId,
        },
        select: { id: true },
      });
      await tx.ordenHabilitacionApi.create({
        data: {
          ordenId: orden.id,
          actorUsuarioId: apiKey.usuarioId,
          nota: "habilitacion sembrada por el test de la red de FK",
          cambioDeEstado: false,
          estadoResultante: "en_reparto",
        },
        select: { id: true },
      });

      const servicio = new ApiKeyService(new ApiKeyRepository(clienteConSavepoint(tx)));
      return {
        salida: await servicio.eliminar({ id: apiKey.id }, MAESTRO),
        key: await tx.apiKey.count({ where: { id: apiKey.id } }),
      };
    });

    expect(r.salida).toEqual({ status: "bloqueada", motivo: "otros_datos" });
    expect(r.key).toBe(1);
  });

  it("la transaccion abortada no deja la sesion rota: se puede seguir trabajando despues", async () => {
    // Un P2003 dentro de una transaccion la ABORTA en Postgres: si el repositorio no la hubiera
    // acotado a su propio savepoint, todo lo que viniera despues fallaria con «current transaction
    // is aborted». Este caso comprueba que el fallo esta CONTENIDO.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const bloqueada = await generarKey(tx, "contenida");
      await tx.apiKey.update({ where: { id: bloqueada.id }, data: { estado: "inactiva" } });
      const orden = await tx.orden.create({
        data: {
          numRemision: `R-${SUFIJO}-${randomUUID().slice(0, 8)}`,
          destinatario: "Dest",
          telefonoDest: "88880000",
          producto: "Prod",
          estatusId: FKS!.estatusId,
          tiendaId: FKS!.tiendaId,
          zonaId: FKS!.zonaId,
          provinciaId: FKS!.provinciaId,
          cantonId: FKS!.cantonId,
        },
        select: { id: true },
      });
      await tx.ordenHabilitacionApi.create({
        data: {
          ordenId: orden.id,
          actorUsuarioId: bloqueada.usuarioId,
          nota: "habilitacion sembrada por el test de la red de FK",
          cambioDeEstado: false,
          estadoResultante: "en_reparto",
        },
        select: { id: true },
      });

      const repo = new ApiKeyRepository(clienteConSavepoint(tx));
      const primera = await repo.eliminar(bloqueada.id, MAESTRO.usuarioId);

      // Y AHORA, despues del fallo, una key limpia: tiene que poder borrarse igual.
      const limpia = await generarKey(tx, "despues");
      await tx.apiKey.update({ where: { id: limpia.id }, data: { estado: "inactiva" } });
      const segunda = await repo.eliminar(limpia.id, MAESTRO.usuarioId);

      return {
        primera,
        segunda,
        sigueLaBloqueada: await tx.apiKey.count({ where: { id: bloqueada.id } }),
        seFueLaLimpia: await tx.apiKey.count({ where: { id: limpia.id } }),
      };
    });

    expect(r.primera.status).toBe("bloqueada");
    expect(r.segunda.status).toBe("ok");
    expect(r.sigueLaBloqueada).toBe(1);
    expect(r.seFueLaLimpia).toBe(0);
  });
});
