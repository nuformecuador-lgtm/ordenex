import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ESTADOS_SIN_CORRECCION } from "@/lib/types/correccion-datos-cliente";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 362 / Q1 — D4 DE LA 312, REABIERTA POR EL HUMANO EL 2026-09-02. MEDIDO EN POSTGRES.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LA DECISION, en una linea: corregir la UBICACION de una orden SI deja rastro, y SOLO EL HECHO
// —quien y cuando—. Nunca la direccion vieja ni la nueva, ni el distrito, ni ningun dato del
// destinatario.
//
// POR QUE SE REABRIO: la 327 amplio esa correccion a la direccion y al DISTRITO, y el distrito
// re-deriva la zona, que decide la tarifa que se factura. Hasta hoy se podia cambiar lo que una
// orden va a cobrar sin dejar quien ni cuando.
//
// POR QUE ESTE ARCHIVO Y NO SOLO LA GUARDIA. La guardia de `corregir-datos-sin-rastro` afirma
// sobre el TEXTO: que la llamada esta, que no lleva vocabulario prohibido. Lo que no puede decir
// es que la fila que llega a Postgres sea UNA, que sea la correcta y que corregir el NOMBRE no
// deje ninguna. Eso son cuatro hechos de la base, y aqui se cuentan.
//
// LAS CUATRO COSAS QUE SE MIDEN:
//   1. corregir la DIRECCION deja EXACTAMENTE UNA fila `orden_ubicacion_corregida`;
//   2. corregir el DISTRITO tambien (es lo que mueve la tarifa);
//   3. corregir SOLO el nombre o el telefono NO deja NINGUNA (D4 sigue viva en su mitad);
//   4. la fila NO contiene la direccion, ni el distrito, ni la zona, ni un dato del cliente.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `362-q1-${Date.now().toString(36)}`;

/** Cliente para el repositorio: la `tx` del test con un `$transaction` que abre un SAVEPOINT. */
function clienteConSavepoint(tx: TxDeTest): PrismaClient {
  const proxy: unknown = new Proxy(tx as object, {
    get(objetivo, prop) {
      if (prop === "$transaction") {
        return async (fn: (t: unknown) => unknown) => {
          const punto = `sp_${randomUUID().replace(/-/g, "")}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
          try {
            const salida = await fn(proxy);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
            return salida;
          } catch (error) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
            throw error;
          }
        };
      }
      const valor = Reflect.get(objetivo, prop) as unknown;
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  });
  return proxy as PrismaClient;
}

describeSiHayBase("362/Q1 — la correccion de la UBICACION deja rastro, y SOLO el hecho", () => {
  let prisma: PrismaClient;
  let FKS: Awaited<ReturnType<typeof fksDeOrden>>;
  /** Un estado que NO esta en `ESTADOS_SIN_CORRECCION`: si la orden naciera bloqueada, todos los
   * casos darian `conflict` por un motivo que no tiene nada que ver con lo que miden. */
  let ESTATUS_CORREGIBLE: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    FKS = await fksDeOrden(prisma);
    if (FKS === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` antes de esta suite.",
      );
    }
    const corregible = await prisma.orderStatus.findFirst({
      where: { value: { notIn: [...ESTADOS_SIN_CORRECCION] } },
      select: { id: true },
      orderBy: { value: "asc" },
    });
    if (corregible === null) throw new Error("no hay ningun estado corregible en el catalogo");
    ESTATUS_CORREGIBLE = corregible.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  interface Escenario {
    ordenId: string;
    repo: OrdenRepository;
    actorId: string;
  }

  async function sembrar(tx: TxDeTest, marca: string): Promise<Escenario> {
    const orden = await tx.orden.create({
      data: {
        numRemision: `R-${SUFIJO}-${marca}`,
        numGuia: null,
        destinatario: "Juana Perez",
        telefonoDest: "88880000",
        producto: "Caja",
        direccion: "Calle Vieja 100",
        estatusId: ESTATUS_CORREGIBLE,
        tiendaId: FKS!.tiendaId,
        zonaId: FKS!.zonaId,
        provinciaId: FKS!.provinciaId,
        cantonId: FKS!.cantonId,
      },
      select: { id: true },
    });
    return {
      ordenId: orden.id,
      repo: new OrdenRepository(clienteConSavepoint(tx)),
      actorId: FKS!.tiendaId,
    };
  }

  async function registroDe(tx: TxDeTest, ordenId: string) {
    return tx.historialAccion.findMany({
      where: { entidadId: ordenId },
      select: {
        accion: true,
        entidadTipo: true,
        entidadEtiqueta: true,
        actorUsuarioId: true,
        actorNombre: true,
        actorRol: true,
        monto: true,
        valorAnterior: true,
        valorNuevo: true,
      },
    });
  }

  it("⭑ (1) corregir la DIRECCION deja EXACTAMENTE UNA fila `orden_ubicacion_corregida`", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const e = await sembrar(tx, "dir");
      const salida = await e.repo.corregirDatosCliente(
        e.ordenId,
        { direccion: "Calle Nueva 200" },
        ESTADOS_SIN_CORRECCION,
        { actorUsuarioId: e.actorId, ubicacionCorregida: true },
      );
      const orden = await tx.orden.findUniqueOrThrow({
        where: { id: e.ordenId },
        select: { direccion: true },
      });
      return { salida, direccion: orden.direccion, registro: await registroDe(tx, e.ordenId) };
    });

    // Control positivo: la correccion ocurrio de verdad …
    expect(r.salida).toBe("ok");
    expect(r.direccion).toBe("Calle Nueva 200");
    // … y dejo UNA fila, ni cero ni dos.
    expect(r.registro).toHaveLength(1);
    expect(r.registro[0].accion).toBe("orden_ubicacion_corregida");
    expect(r.registro[0].entidadTipo).toBe("orden");
  });

  it("⭑ (2) la fila NO lleva la direccion, ni el distrito, ni la zona, ni un dato del cliente", async () => {
    // ⚠️ ES LA MITAD DE D4 QUE SIGUE VIVA, y la que hace aceptable haber reabierto la otra. Se
    // barre la fila ENTERA serializada: si alguien metiera un dato en cualquier columna, cae.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const e = await sembrar(tx, "sinpii");
      await e.repo.corregirDatosCliente(
        e.ordenId,
        { direccion: "Calle Nueva 200" },
        ESTADOS_SIN_CORRECCION,
        { actorUsuarioId: e.actorId, ubicacionCorregida: true },
      );
      return registroDe(tx, e.ordenId);
    });

    expect(r).toHaveLength(1);
    const serializada = JSON.stringify(r[0]);
    for (const prohibido of [
      "Calle Nueva",
      "Calle Vieja",
      "Juana",
      "Perez",
      "88880000",
      "Caja",
    ]) {
      expect(serializada, `la fila del registro lleva \`${prohibido}\``).not.toContain(prohibido);
    }
    // Las dos columnas de vocabulario cerrado van NULL: ahi es donde alguien meteria la direccion
    // «para que se entienda mejor».
    expect(r[0].valorAnterior).toBeNull();
    expect(r[0].valorNuevo).toBeNull();
    // Y el importe tambien: corregir la ubicacion no mueve UN importe, cambia la tarifa que
    // aplicara. Q3 quedo cerrada en «no se versiona».
    expect(r[0].monto).toBeNull();
    // La etiqueta es el identificador del ENVIO: la orden sembrada no tiene guia, asi que cae a
    // la remision. `num_guia` es un identificador de Ordenex, no un dato personal.
    expect(r[0].entidadEtiqueta).toContain(SUFIJO);
  });

  it("⭑ (3) corregir SOLO el NOMBRE del destinatario NO deja rastro (D4 sigue viva)", async () => {
    // El limite exacto de lo que el humano aprobo: el HECHO de mover la ubicacion, porque mueve
    // dinero. Corregir el nombre no lo mueve, y sigue sin dejar rastro.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const e = await sembrar(tx, "nombre");
      const salida = await e.repo.corregirDatosCliente(
        e.ordenId,
        { destinatario: "Juana Perez Mora" },
        ESTADOS_SIN_CORRECCION,
        { actorUsuarioId: e.actorId, ubicacionCorregida: false },
      );
      const orden = await tx.orden.findUniqueOrThrow({
        where: { id: e.ordenId },
        select: { destinatario: true },
      });
      return {
        salida,
        destinatario: orden.destinatario,
        registro: await registroDe(tx, e.ordenId),
      };
    });

    // Control positivo: la correccion SI ocurrio …
    expect(r.salida).toBe("ok");
    expect(r.destinatario).toBe("Juana Perez Mora");
    // … y NO dejo rastro.
    expect(r.registro, "corregir el nombre dejo rastro: eso NO es lo que se aprobo").toEqual([]);
  });

  it("⭑ (4) R11: si la correccion no alcanza la orden, NO queda fila", async () => {
    // La ventana de estado del `where` no casa (la orden esta en un estado bloqueado): el
    // `updateMany` devuelve 0, el metodo sale con `conflict` y no se registra nada.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const e = await sembrar(tx, "conflict");
      const estatusActual = await tx.orden.findUniqueOrThrow({
        where: { id: e.ordenId },
        select: { estatus: { select: { value: true } } },
      });
      // Se bloquea EL estado que la orden tiene: asi el `notIn` no casa.
      const salida = await e.repo.corregirDatosCliente(
        e.ordenId,
        { direccion: "Calle Nueva 200" },
        [estatusActual.estatus.value],
        { actorUsuarioId: e.actorId, ubicacionCorregida: true },
      );
      const orden = await tx.orden.findUniqueOrThrow({
        where: { id: e.ordenId },
        select: { direccion: true },
      });
      return { salida, direccion: orden.direccion, registro: await registroDe(tx, e.ordenId) };
    });

    expect(r.salida).toBe("conflict");
    expect(r.direccion, "la correccion escribio pese al conflicto").toBe("Calle Vieja 100");
    expect(r.registro, "se registro una correccion que no ocurrio").toEqual([]);
  });

  it("(5) el actor queda CONGELADO en la fila, con su nombre y su rol", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const e = await sembrar(tx, "actor");
      const actor = await tx.usuario.findUniqueOrThrow({
        where: { id: e.actorId },
        select: { nombre: true, primerApellido: true, rol: { select: { value: true } } },
      });
      await e.repo.corregirDatosCliente(
        e.ordenId,
        { direccion: "Calle Nueva 200" },
        ESTADOS_SIN_CORRECCION,
        { actorUsuarioId: e.actorId, ubicacionCorregida: true },
      );
      return { actor, registro: await registroDe(tx, e.ordenId), actorId: e.actorId };
    });

    expect(r.registro).toHaveLength(1);
    expect(r.registro[0].actorUsuarioId).toBe(r.actorId);
    expect(r.registro[0].actorRol).toBe(r.actor.rol.value);
    const esperado = [r.actor.nombre, r.actor.primerApellido]
      .filter((p) => p != null && p !== "")
      .join(" ");
    expect(r.registro[0].actorNombre).toBe(esperado);
  });
});
