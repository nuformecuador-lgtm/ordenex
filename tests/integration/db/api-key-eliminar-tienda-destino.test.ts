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
// FICHA 373 / C4 (R5) — LA TIENDA DESTINO NO SE TOCA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// EL RIESGO QUE MIDE, y no es teorico. Desde la feature 302 una key puede cargar a nombre de una
// TIENDA REAL (`tienda_destino_id`): sus ordenes pertenecen a la tienda, no a la cuenta dedicada.
// Son DOS cuentas distintas, y la que se borra es SOLO la dedicada. Si el `deleteMany` del webhook
// perdiera su `where`, o si alguien confundiera `usuarioId` con `ownerUsuarioId`, este borrado se
// llevaria por delante la suscripcion de una tienda EN PRODUCCION — y el integrador dejaria de
// recibir eventos sin que nada fallara.
//
// Es tambien la razon por la que la key de este test SI es borrable: sus ordenes son de la TIENDA,
// asi que la cuenta dedicada no tiene ninguna a su nombre. Ese es el escenario real de la 302.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `373-td-${Date.now().toString(36)}`;

describeSiHayBase("373/C4 — eliminar una key con tienda destino (Postgres real)", () => {
  let prisma: PrismaClient;
  let FKS: Awaited<ReturnType<typeof fksDeOrden>>;
  let MAESTRO: Actor;
  let ROL_ADMIN_TIENDA: string;
  let TIPO_CEDULA: string;

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
    const rol = await prisma.rol.findUnique({
      where: { value: "adminTienda" },
      select: { id: true },
    });
    const tipo = await prisma.tipoIdentificacion.findUnique({
      where: { value: "cedula" },
      select: { id: true },
    });
    if (maestro === null || rol === null || tipo === null) {
      throw new Error("faltan el maestro o los catalogos `rol.adminTienda` / `cedula`");
    }
    MAESTRO = { usuarioId: maestro.id, rol: "maestro" };
    ROL_ADMIN_TIENDA = rol.id;
    TIPO_CEDULA = tipo.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Una TIENDA de verdad (`adminTienda`, activa), que es lo que `generar` exige como destino. */
  async function sembrarTienda(tx: TxDeTest, marca: string): Promise<string> {
    const slug = `${SUFIJO}-${marca}-${randomUUID().slice(0, 8)}`;
    const fila = await tx.usuario.create({
      data: {
        nombre: `Tienda ${slug}`,
        email: `${slug}@tienda.invalid`,
        telefono: "88880000",
        passwordHash: "x",
        cedula: `TIENDA-${slug}`,
        tipoIdentificacionId: TIPO_CEDULA,
        rolId: ROL_ADMIN_TIENDA,
        estado: "activo",
        fulfillment: false,
        zonaId: null,
      },
      select: { id: true },
    });
    return fila.id;
  }

  it("⭑ R5: se borra la key y su cuenta dedicada; la TIENDA, sus ordenes y su webhook siguen", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaId = await sembrarTienda(tx, "destino");

      // La key apunta a la tienda: sus ordenes seran de ELLA (feature 302).
      const servicio = new ApiKeyService(new ApiKeyRepository(clienteConSavepoint(tx)));
      const generada = await servicio.generar(
        { identificador: `${SUFIJO}-key-${randomUUID().slice(0, 8)}`, tiendaDestinoId: tiendaId },
        MAESTRO,
      );
      if (generada.status !== "ok") throw new Error(`no se pudo sembrar la key: ${generada.status}`);
      const apiKey = generada.apiKey;

      // Dos ordenes A NOMBRE DE LA TIENDA (no de la cuenta dedicada).
      for (let i = 0; i < 2; i++) {
        await tx.orden.create({
          data: {
            numRemision: `R-${SUFIJO}-${randomUUID().slice(0, 8)}`,
            destinatario: "Dest",
            telefonoDest: "88880000",
            producto: "Prod",
            estatusId: FKS!.estatusId,
            tiendaId,
            zonaId: FKS!.zonaId,
            provinciaId: FKS!.provinciaId,
            cantonId: FKS!.cantonId,
          },
          select: { id: true },
        });
      }

      // Y el webhook de LA TIENDA, que es el que el despachador consulta.
      const webhookTienda = await tx.webhookSuscripcion.create({
        data: {
          ownerUsuarioId: tiendaId,
          url: "https://tienda.invalid/webhook",
          secret: "ciphertext-de-la-tienda",
        },
        select: { id: true },
      });

      await tx.apiKey.update({ where: { id: apiKey.id }, data: { estado: "inactiva" } });
      const salida = await new ApiKeyRepository(clienteConSavepoint(tx)).eliminar(
        apiKey.id,
        MAESTRO.usuarioId,
      );

      return {
        salida,
        ownerResuelto: apiKey.ownerUsuarioId,
        tiendaId,
        cuentaDedicada: apiKey.usuarioId,
        // Lo que TIENE que haber desaparecido:
        key: await tx.apiKey.count({ where: { id: apiKey.id } }),
        dedicada: await tx.usuario.count({ where: { id: apiKey.usuarioId } }),
        // Lo que TIENE que seguir:
        tienda: await tx.usuario.count({ where: { id: tiendaId } }),
        ordenesTienda: await tx.orden.count({ where: { tiendaId } }),
        webhookTienda: await tx.webhookSuscripcion.count({ where: { id: webhookTienda.id } }),
        webhookOwner: (
          await tx.webhookSuscripcion.findUniqueOrThrow({
            where: { id: webhookTienda.id },
            select: { ownerUsuarioId: true },
          })
        ).ownerUsuarioId,
      };
    });

    // La 302 en una linea: el dueno de las ordenes es la TIENDA, no la cuenta dedicada.
    expect(r.ownerResuelto).toBe(r.tiendaId);
    expect(r.ownerResuelto).not.toBe(r.cuentaDedicada);

    expect(r.salida.status).toBe("ok");
    expect(r.key).toBe(0);
    expect(r.dedicada).toBe(0);

    // ⭑ Y LO QUE NO SE TOCA. Si el `deleteMany` perdiera su `where`, `webhookTienda` seria 0.
    expect(r.tienda).toBe(1);
    expect(r.ordenesTienda).toBe(2);
    expect(r.webhookTienda, "el borrado se llevo la suscripcion de la TIENDA: R5 roto").toBe(1);
    expect(r.webhookOwner).toBe(r.tiendaId);
  });

  it("las ordenes de la TIENDA no bloquean el borrado de la key (son de ella, no de la cuenta)", async () => {
    // El otro lado del mismo hecho: con `tienda_destino_id`, la cuenta dedicada tiene CERO ordenes
    // propias. Es exactamente lo que se midio en produccion el 2026-09-04.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaId = await sembrarTienda(tx, "sin-propias");
      const servicio = new ApiKeyService(new ApiKeyRepository(clienteConSavepoint(tx)));
      const generada = await servicio.generar(
        { identificador: `${SUFIJO}-k2-${randomUUID().slice(0, 8)}`, tiendaDestinoId: tiendaId },
        MAESTRO,
      );
      if (generada.status !== "ok") throw new Error("no se pudo sembrar la key");

      await tx.orden.create({
        data: {
          numRemision: `R-${SUFIJO}-${randomUUID().slice(0, 8)}`,
          destinatario: "Dest",
          telefonoDest: "88880000",
          producto: "Prod",
          estatusId: FKS!.estatusId,
          tiendaId,
          zonaId: FKS!.zonaId,
          provinciaId: FKS!.provinciaId,
          cantonId: FKS!.cantonId,
        },
        select: { id: true },
      });

      const repo = new ApiKeyRepository(clienteConSavepoint(tx));
      const dependencias = await repo.dependenciasDeCuentasDedicadas([generada.apiKey.usuarioId]);
      return {
        dependencias: dependencias.get(generada.apiKey.usuarioId),
        ordenesDeLaTienda: await tx.orden.count({ where: { tiendaId } }),
      };
    });

    expect(r.ordenesDeLaTienda).toBe(1);
    expect(r.dependencias).toEqual({ ordenes: false, dinero: false, tarifas: false });
  });
});
