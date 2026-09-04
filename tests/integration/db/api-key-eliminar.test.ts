import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";
import { ApiKeyService } from "@/lib/services/ApiKeyService";
import { HistorialAccionRepository } from "@/lib/repositories/HistorialAccionRepository";
import type { Actor } from "@/lib/interfaces/services/IApiKeyService";

import {
  HAY_BASE_DE_DATOS,
  RegistroCaido,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 373 / C3 (R2/R3/R4/R6/R11/R22/R23/R24/R26) — EL BORRADO, CONTRA POSTGRES DE VERDAD.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTE ARCHIVO NO SE PUEDE SUSTITUIR POR TESTS CON DOBLES. Un doble puede afirmar que se
// llamo a tres `delete`; no puede demostrar que las tres filas DEJARON DE EXISTIR, ni que el
// identificador quedo libre para volver a usarse, ni que si el registro falla el borrado se
// deshace. Todo eso son hechos del motor.
//
// COMO SE ANIDAN LAS TRANSACCIONES: `enTransaccionRevertida` abre la del TEST (que siempre
// revierte, para no dejar ni una fila en la base compartida) y `clienteConSavepoint` traduce el
// `$transaction` del repositorio a un SAVEPOINT REAL. Un pass-through no serviria: sin savepoint,
// el caso de R4 pasaria en verde por accidente.
//
// LAS KEYS SE CREAN POR EL CAMINO REAL (`ApiKeyService.generar` -> `createConUsuario`), no a mano:
// asi el email y la cedula sinteticos son los de produccion, que es lo que R6 mide.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `373-del-${Date.now().toString(36)}`;

describeSiHayBase("373/C3 — eliminar una API key (Postgres real)", () => {
  let prisma: PrismaClient;
  let MAESTRO: Actor;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const maestro = await prisma.usuario.findFirst({
      where: { rol: { value: "maestro" } },
      select: { id: true },
    });
    // ⚠️ LANZA, no `return`: sin actor no se puede medir el congelado de R24, y un `return` aqui
    // reportaria `passed` sin haber comprobado nada.
    if (maestro === null) {
      throw new Error(
        "hay DATABASE_URL pero no hay ningun usuario con rol `maestro`: corre " +
          "`pnpm run db:seed:maestro` antes de esta suite.",
      );
    }
    MAESTRO = { usuarioId: maestro.id, rol: "maestro" };
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Genera una key por el camino REAL y devuelve lo que hace falta para medirla. */
  async function generarKey(tx: TxDeTest, marca: string) {
    const identificador = `${SUFIJO}-${marca}-${randomUUID().slice(0, 8)}`;
    const servicio = new ApiKeyService(new ApiKeyRepository(clienteConSavepoint(tx)));
    const r = await servicio.generar({ identificador, tiendaDestinoId: undefined }, MAESTRO);
    if (r.status !== "ok") throw new Error(`no se pudo sembrar la key: ${r.status}`);
    return { identificador, apiKey: r.apiKey, plainKey: r.plainKey };
  }

  /** Cuenta las filas que la ficha borra, para una key concreta. */
  async function censo(tx: TxDeTest, apiKeyId: string, usuarioId: string) {
    return {
      key: await tx.apiKey.count({ where: { id: apiKeyId } }),
      usuario: await tx.usuario.count({ where: { id: usuarioId } }),
      webhook: await tx.webhookSuscripcion.count({ where: { ownerUsuarioId: usuarioId } }),
    };
  }

  /** Una suscripcion de webhook colgada de esa cuenta. */
  async function sembrarWebhook(tx: TxDeTest, ownerUsuarioId: string): Promise<string> {
    const fila = await tx.webhookSuscripcion.create({
      data: {
        ownerUsuarioId,
        url: "https://ejemplo.invalid/webhook",
        secret: "ciphertext-de-mentira",
      },
      select: { id: true },
    });
    return fila.id;
  }

  function repo(tx: TxDeTest, romperRegistro = false) {
    return new ApiKeyRepository(clienteConSavepoint(tx, romperRegistro));
  }

  it("⭑ R2: una key `inactiva` se lleva su fila, su cuenta dedicada y su webhook", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const { apiKey } = await generarKey(tx, "r2");
      await sembrarWebhook(tx, apiKey.usuarioId);
      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });

      const antes = await censo(tx, apiKey.id, apiKey.usuarioId);
      const salida = await repo(tx).eliminar(apiKey.id, MAESTRO.usuarioId);
      const despues = await censo(tx, apiKey.id, apiKey.usuarioId);
      return { antes, salida, despues };
    });

    expect(r.antes).toEqual({ key: 1, usuario: 1, webhook: 1 });
    expect(r.salida.status).toBe("ok");
    // Las TRES desaparecieron. No «se llamo a delete»: no existen.
    expect(r.despues).toEqual({ key: 0, usuario: 0, webhook: 0 });
  });

  it("R2: una key SIN webhook se borra igual (el `deleteMany` de cero filas no es un error)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const { apiKey } = await generarKey(tx, "sin-webhook");
      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });

      const salida = await repo(tx).eliminar(apiKey.id, MAESTRO.usuarioId);
      return { salida, despues: await censo(tx, apiKey.id, apiKey.usuarioId) };
    });

    expect(r.salida.status).toBe("ok");
    expect(r.despues).toEqual({ key: 0, usuario: 0, webhook: 0 });
  });

  it("⭑⭑ R11: la MISMA key, `activa`, sale `bloqueada` y no se borra NADA", async () => {
    // El caso que R11 existe para impedir: una key recien creada, en uso, sin ningun dato. El
    // guard por datos la daria por borrable. Y despues, desactivada, si se borra.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const { apiKey } = await generarKey(tx, "r11");
      await sembrarWebhook(tx, apiKey.usuarioId);

      const bloqueada = await repo(tx).eliminar(apiKey.id, MAESTRO.usuarioId);
      const trasIntento = await censo(tx, apiKey.id, apiKey.usuarioId);
      const registroTrasIntento = await tx.historialAccion.count({
        where: { entidadId: apiKey.id, accion: "api_key_eliminada" },
      });

      // Y ahora el paso que la ficha EXIGE: desactivar, que es reversible y se ve.
      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });
      const trasDesactivar = await censo(tx, apiKey.id, apiKey.usuarioId);
      const ok = await repo(tx).eliminar(apiKey.id, MAESTRO.usuarioId);
      const alFinal = await censo(tx, apiKey.id, apiKey.usuarioId);

      return { bloqueada, trasIntento, registroTrasIntento, trasDesactivar, ok, alFinal };
    });

    expect(r.bloqueada).toEqual({
      status: "bloqueada",
      estado: "activa",
      dependencias: { ordenes: false, dinero: false, tarifas: false },
    });
    // R12: cero escrituras. Ni las filas ni el registro.
    expect(r.trasIntento).toEqual({ key: 1, usuario: 1, webhook: 1 });
    expect(r.registroTrasIntento).toBe(0);
    // R11: desactivar NO borro nada — es reversible.
    expect(r.trasDesactivar).toEqual({ key: 1, usuario: 1, webhook: 1 });
    // Y desde `inactiva` si se puede.
    expect(r.ok.status).toBe("ok");
    expect(r.alFinal).toEqual({ key: 0, usuario: 0, webhook: 0 });
  });

  it("⭑ R3: eliminar una key deja INTACTA a la otra, con su cuenta y su webhook", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const victima = await generarKey(tx, "victima");
      const testigo = await generarKey(tx, "testigo");
      await sembrarWebhook(tx, victima.apiKey.usuarioId);
      await sembrarWebhook(tx, testigo.apiKey.usuarioId);
      await tx.apiKey.update({ where: { id: victima.apiKey.id }, data: { estado: "inactiva" } });

      const salida = await repo(tx).eliminar(victima.apiKey.id, MAESTRO.usuarioId);
      return {
        salida,
        victima: await censo(tx, victima.apiKey.id, victima.apiKey.usuarioId),
        testigo: await censo(tx, testigo.apiKey.id, testigo.apiKey.usuarioId),
        identificadorTestigo: (
          await tx.apiKey.findUniqueOrThrow({
            where: { id: testigo.apiKey.id },
            select: { identificador: true, estado: true },
          })
        ).identificador,
      };
    });

    expect(r.salida.status).toBe("ok");
    expect(r.victima).toEqual({ key: 0, usuario: 0, webhook: 0 });
    // La otra key, su cuenta y su suscripcion siguen ahi, sin tocar.
    expect(r.testigo).toEqual({ key: 1, usuario: 1, webhook: 1 });
    expect(r.identificadorTestigo).toContain("testigo");
  });

  it("⭑ R6: tras eliminar, el identificador vuelve a estar LIBRE", async () => {
    // Es la prueba de por que se borra tambien la cuenta dedicada: sin ella, el email y la cedula
    // sinteticos seguirian ocupados y regenerar daria `conflict` sin que nada lo explicase.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const { identificador, apiKey } = await generarKey(tx, "reutilizable");
      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });

      // Antes de borrar: el mismo identificador da CONFLICT (esa es la situacion de partida).
      const servicio = new ApiKeyService(new ApiKeyRepository(clienteConSavepoint(tx)));
      const antes = await servicio.generar({ identificador, tiendaDestinoId: undefined }, MAESTRO);

      const salida = await repo(tx).eliminar(apiKey.id, MAESTRO.usuarioId);
      const despues = await servicio.generar({ identificador, tiendaDestinoId: undefined }, MAESTRO);
      return { antes, salida, despues };
    });

    expect(r.antes.status).toBe("conflict");
    expect(r.salida.status).toBe("ok");
    expect(r.despues.status, "el identificador quedo quemado: R6 roto").toBe("ok");
  });

  it("⭑ R22/R24: escribe EXACTAMENTE UNA fila, con el actor congelado y el estado previo", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const { identificador, apiKey } = await generarKey(tx, "registro");
      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });
      await repo(tx).eliminar(apiKey.id, MAESTRO.usuarioId);

      const filas = await tx.historialAccion.findMany({
        where: { entidadId: apiKey.id, accion: "api_key_eliminada" },
      });
      const maestro = await tx.usuario.findUniqueOrThrow({
        where: { id: MAESTRO.usuarioId },
        select: { nombre: true, primerApellido: true },
      });
      return { identificador, filas, maestro };
    });

    expect(r.filas).toHaveLength(1);
    const fila = r.filas[0];
    expect(fila.accion).toBe("api_key_eliminada");
    expect(fila.entidadTipo).toBe("api_key");
    // La etiqueta es el IDENTIFICADOR VISIBLE (R23).
    expect(fila.entidadEtiqueta).toContain(r.identificador);
    // R24: quien borro, congelado.
    expect(fila.actorUsuarioId).toBe(MAESTRO.usuarioId);
    expect(fila.actorNombre).toContain(r.maestro.nombre);
    expect(fila.actorRol).toBe("maestro");
    // R24: el estado que la key tenia justo antes. Siempre `inactiva`, porque no hay otra via.
    expect(fila.valorAnterior).toBe("inactiva");
    expect(fila.valorNuevo).toBeNull();
  });

  it("⭑ R23: la fila no contiene el secreto, ni el hash, ni el prefijo, en NINGUNA columna", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const { apiKey, plainKey } = await generarKey(tx, "sin-secreto");
      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });
      const emailSintetico = (
        await tx.usuario.findUniqueOrThrow({
          where: { id: apiKey.usuarioId },
          select: { email: true },
        })
      ).email;
      const keyHash = (
        await tx.$queryRaw<{ key_hash: string }[]>`
          SELECT "key_hash" FROM "api_key" WHERE "id" = ${apiKey.id}`
      )[0].key_hash;

      await repo(tx).eliminar(apiKey.id, MAESTRO.usuarioId);
      // TODAS las columnas de la fila, crudas: no un `select` que ya excluya lo sensible.
      const fila = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM "historial_accion"
         WHERE "entidad_id" = ${apiKey.id} AND "accion" = 'api_key_eliminada'`;
      return { fila, plainKey, keyHash, keyPrefix: apiKey.keyPrefix, emailSintetico };
    });

    expect(r.fila).toHaveLength(1);
    // Anti-vacuidad: los tres secretos existen de verdad y no son cadenas vacias.
    expect(r.plainKey.length).toBeGreaterThan(30);
    expect(r.keyHash.length).toBeGreaterThan(30);
    expect(r.keyPrefix.length).toBeGreaterThan(5);

    const serializada = JSON.stringify(r.fila[0]);
    expect(serializada).not.toContain(r.plainKey);
    expect(serializada).not.toContain(r.keyHash);
    expect(serializada).not.toContain(r.keyPrefix);
    expect(serializada).not.toContain(r.emailSintetico);
    expect(serializada).not.toContain("ordx_");
  });

  it("⭑ R26: la fila sigue LISTANDOSE en el registro de acciones cuando la key ya no existe", async () => {
    // El rastro sobrevive al borrado fisico por diseno: `entidad_id` es opaco y sin FK, y la
    // etiqueta va denormalizada. Se comprueba por el repositorio REAL del registro, que es lo que
    // pinta la pantalla, no por un `findMany` a mano.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const { identificador, apiKey } = await generarKey(tx, "sobrevive");
      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });
      await repo(tx).eliminar(apiKey.id, MAESTRO.usuarioId);

      const historial = new HistorialAccionRepository(clienteConSavepoint(tx));
      const pagina = await historial.list({
        filtro: {
          q: null,
          actorId: null,
          accion: ["api_key_eliminada"],
          entidadTipo: ["api_key"],
          desde: null,
          hasta: null,
        },
        orden: { sortBy: "created_at", sortDir: "desc" },
        page: 1,
        pageSize: 50,
      });
      return {
        identificador,
        existeLaKey: await tx.apiKey.count({ where: { id: apiKey.id } }),
        fila: pagina.items.find((i) => i.entidadEtiqueta.includes(identificador)),
      };
    });

    expect(r.existeLaKey).toBe(0); // la key ya no existe...
    expect(r.fila, "la fila del registro desaparecio con la key").toBeDefined(); // ...y su rastro si
    expect(r.fila?.accion).toBe("api_key_eliminada");
    expect(r.fila?.actorRol).toBe("maestro");
    expect(r.fila?.createdAt).toBeInstanceOf(Date);
  });

  it("⭑⭑ R4: si el REGISTRO falla, NO queda borrada ni una de las tres filas", async () => {
    // El test que mas importa de la ficha en su segunda direccion: no hay desaparicion sin rastro.
    // Se fuerza el fallo con un Proxy sobre `historialAccion.createMany`; el repositorio real corre
    // entero, con su `$transaction` real traducida a un savepoint.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const { apiKey } = await generarKey(tx, "r4");
      await sembrarWebhook(tx, apiKey.usuarioId);
      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });

      let lanzo: unknown = null;
      try {
        await repo(tx, true).eliminar(apiKey.id, MAESTRO.usuarioId);
      } catch (error) {
        lanzo = error;
      }
      return {
        lanzo,
        despues: await censo(tx, apiKey.id, apiKey.usuarioId),
        registro: await tx.historialAccion.count({
          where: { entidadId: apiKey.id, accion: "api_key_eliminada" },
        }),
      };
    });

    // El fallo se PROPAGA: no se lo traga nadie.
    expect(r.lanzo).toBeInstanceOf(RegistroCaido);
    // Y las tres filas siguen vivas: la transaccion revirtio los tres `delete`.
    expect(r.despues, "hubo borrado SIN registro: R4 roto").toEqual({
      key: 1,
      usuario: 1,
      webhook: 1,
    });
    expect(r.registro).toBe(0);
  });

  it("R21: un id que no existe -> `not_found`, sin efectos", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const antes = await tx.historialAccion.count({ where: { accion: "api_key_eliminada" } });
      const salida = await repo(tx).eliminar(randomUUID(), MAESTRO.usuarioId);
      const despues = await tx.historialAccion.count({ where: { accion: "api_key_eliminada" } });
      return { salida, antes, despues };
    });

    expect(r.salida).toEqual({ status: "not_found" });
    expect(r.despues).toBe(r.antes);
  });
});
