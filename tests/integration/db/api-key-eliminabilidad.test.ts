import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";

import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 373 / C1 (R8/R9/R10) — EL GUARD, CONTRA POSTGRES DE VERDAD.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ POR QUE ESTE ARCHIVO EXISTE Y NO BASTA UN TEST DE SERVICIO. El guard es un `WHERE` —cuatro
// `EXISTS` sobre `tienda_id`— y un doble NO VE EL `WHERE`. Esta MEDIDO cuatro veces en este repo
// que una mutacion del `WHERE` deja los tests de doble en verde. Aqui se siembran filas REALES y se
// pregunta al `$queryRaw` REAL.
//
// EL CASO QUE MAS IMPORTA, y el que un guard escrito «a ojo» falla: la ORDEN BORRADA. Las ordenes
// usan soft delete —la fila sigue existiendo y su FK a la tienda sigue apuntando—, asi que contar
// solo las vivas dejaria ELIMINABLE una key con 40 ordenes borradas y el `DELETE` reventaria al
// pulsar el boton.
//
// NADA QUEDA EN LA BASE: todo corre dentro de `enTransaccionRevertida`, que revierte pase lo que
// pase (incluso si el proceso muere). Y `serializarEscriturasReales` evita el deadlock con los
// otros archivos que escriben en `public."usuario"`.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `373-elig-${Date.now().toString(36)}`;

describeSiHayBase("373/C1 — dependenciasDeCuentasDedicadas contra Postgres", () => {
  let prisma: PrismaClient;
  let FKS: Awaited<ReturnType<typeof fksDeOrden>>;
  let ROL_API_KEY: string;
  let TIPO_CEDULA: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    FKS = await fksDeOrden(prisma);
    // ⚠️ LANZA, no `return`. Un `if (!fks) return;` reporta `passed` sin comprobar NADA, y este
    // repo ya se comio esa mentira una vez.
    if (FKS === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y `pnpm exec tsx scripts/seed-zonas.ts`) antes de esta suite.",
      );
    }
    const rol = await prisma.rol.findUnique({ where: { value: "apiKey" }, select: { id: true } });
    const tipo = await prisma.tipoIdentificacion.findUnique({
      where: { value: "cedula" },
      select: { id: true },
    });
    if (rol === null || tipo === null) {
      throw new Error("faltan los catalogos `rol.apiKey` / `tipo_identificacion.cedula`");
    }
    ROL_API_KEY = rol.id;
    TIPO_CEDULA = tipo.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Una cuenta dedicada nueva (rol `apiKey`), como la que crea `createConUsuario`. */
  async function sembrarCuenta(tx: TxDeTest, marca: string): Promise<string> {
    const slug = `${SUFIJO}-${marca}-${randomUUID().slice(0, 8)}`;
    const fila = await tx.usuario.create({
      data: {
        nombre: slug,
        email: `apikey+${slug}@apikey.invalid`,
        telefono: "",
        passwordHash: "x",
        cedula: `APIKEY-${slug}`,
        tipoIdentificacionId: TIPO_CEDULA,
        rolId: ROL_API_KEY,
        estado: "activo",
        fulfillment: false,
        zonaId: null,
      },
      select: { id: true },
    });
    return fila.id;
  }

  /** Una orden a nombre de `tiendaId`. `borrada` la deja con `deleted_at` NO nulo (soft delete). */
  async function sembrarOrden(tx: TxDeTest, tiendaId: string, borrada: boolean): Promise<void> {
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
        deletedAt: borrada ? new Date() : null,
      },
      select: { id: true },
    });
  }

  /** El guard, tal y como lo llama el servicio. */
  async function dependencias(tx: TxDeTest, ids: string[]) {
    const repo = new ApiKeyRepository(clienteConTransaccionAnidada(tx));
    return repo.dependenciasDeCuentasDedicadas(ids);
  }

  it("⭑ una cuenta LIMPIA sale con los tres booleanos en false", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cuenta = await sembrarCuenta(tx, "limpia");
      return { cuenta, mapa: await dependencias(tx, [cuenta]) };
    });

    expect(r.mapa.get(r.cuenta)).toEqual({ ordenes: false, dinero: false, tarifas: false });
  });

  it("⭑ R8: con UNA orden viva -> `ordenes: true`", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cuenta = await sembrarCuenta(tx, "orden-viva");
      await sembrarOrden(tx, cuenta, false);
      return { cuenta, mapa: await dependencias(tx, [cuenta]) };
    });

    expect(r.mapa.get(r.cuenta)).toEqual({ ordenes: true, dinero: false, tarifas: false });
  });

  it("⭑⭑ R8: con SOLO una orden BORRADA -> `ordenes: true` (el soft delete no la esconde)", async () => {
    // EL CASO DE LA FICHA. Un `WHERE deleted_at IS NULL` de mas aqui daria `false`, la key saldria
    // eliminable y el `DELETE` reventaria contra la FK `Restrict` de `orden.tienda_id` al pulsar
    // el boton. Este test es el que impide ese «boton que falla al pulsarlo».
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cuenta = await sembrarCuenta(tx, "orden-borrada");
      await sembrarOrden(tx, cuenta, true);
      // Se comprueba que la fila esta REALMENTE borrada; si no, este caso seria el anterior.
      const viva = await tx.orden.count({ where: { tiendaId: cuenta, deletedAt: null } });
      const total = await tx.orden.count({ where: { tiendaId: cuenta } });
      return { cuenta, viva, total, mapa: await dependencias(tx, [cuenta]) };
    });

    expect(r.viva).toBe(0);
    expect(r.total).toBe(1);
    expect(r.mapa.get(r.cuenta)?.ordenes).toBe(true);
  });

  it("⭑ R9: con un movimiento del libro de tienda -> `dinero: true`", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cuenta = await sembrarCuenta(tx, "wallet");
      await tx.walletTiendaMovimiento.create({
        data: {
          tiendaId: cuenta,
          tipo: "credito",
          categoria: "cod_recaudado",
          monto: "1000.00",
          origenTipo: "manual",
          descripcion: `siembra ${SUFIJO}`,
        },
        select: { id: true },
      });
      return { cuenta, mapa: await dependencias(tx, [cuenta]) };
    });

    expect(r.mapa.get(r.cuenta)).toEqual({ ordenes: false, dinero: true, tarifas: false });
  });

  it("⭑ R9: con un pago de liquidacion -> `dinero: true`", async () => {
    // Las DOS tablas de dinero cuentan, y por separado: si el `OR` se cayera, este caso lo dice.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cuenta = await sembrarCuenta(tx, "pago");
      await tx.liquidacionPago.create({
        data: {
          claveIdempotencia: randomUUID(),
          tiendaId: cuenta,
          monto: "500.00",
          metodo: "efectivo",
          fechaPago: new Date("2026-09-04T00:00:00.000Z"),
          registradoPor: FKS!.tiendaId, // un actor cualquiera que ya existe
        },
        select: { id: true },
      });
      return { cuenta, mapa: await dependencias(tx, [cuenta]) };
    });

    expect(r.mapa.get(r.cuenta)).toEqual({ ordenes: false, dinero: true, tarifas: false });
  });

  it("⭑ R10: con una tarifa configurada -> `tarifas: true`", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cuenta = await sembrarCuenta(tx, "tarifa");
      await tx.tarifa.create({
        data: {
          valorFlete: "1.00",
          valorFleteDevuelto: "1.00",
          valorFleteGam: "1.00",
          valorFleteDevueltoGam: "1.00",
          comisionCod: "1.00",
          ivaFlete: "0.00",
          ivaComisionCod: "0.00",
          tiendaId: cuenta,
          zonaId: FKS!.zonaId,
        },
        select: { id: true },
      });
      return { cuenta, mapa: await dependencias(tx, [cuenta]) };
    });

    expect(r.mapa.get(r.cuenta)).toEqual({ ordenes: false, dinero: false, tarifas: true });
  });

  it("⭑ cada cuenta recibe LO SUYO: cuatro cuentas distintas en UNA sola consulta", async () => {
    // Es la mutacion mas facil de colar: un `EXISTS` que ignore `u.id` y responda lo mismo para
    // todas. Con cuatro cuentas y cuatro respuestas distintas, no hay forma de que pase por azar.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const limpia = await sembrarCuenta(tx, "mix-limpia");
      const conOrden = await sembrarCuenta(tx, "mix-orden");
      const conDinero = await sembrarCuenta(tx, "mix-dinero");
      const conTarifa = await sembrarCuenta(tx, "mix-tarifa");

      await sembrarOrden(tx, conOrden, false);
      await tx.walletTiendaMovimiento.create({
        data: {
          tiendaId: conDinero,
          tipo: "debito",
          categoria: "flete",
          monto: "10.00",
          origenTipo: "manual",
        },
        select: { id: true },
      });
      await tx.tarifa.create({
        data: {
          valorFlete: "2.00",
          valorFleteDevuelto: "2.00",
          valorFleteGam: "2.00",
          valorFleteDevueltoGam: "2.00",
          comisionCod: "1.00",
          ivaFlete: "0.00",
          ivaComisionCod: "0.00",
          tiendaId: conTarifa,
          zonaId: FKS!.zonaId,
        },
        select: { id: true },
      });

      const mapa = await dependencias(tx, [limpia, conOrden, conDinero, conTarifa]);
      return { limpia, conOrden, conDinero, conTarifa, mapa };
    });

    expect(r.mapa.size).toBe(4);
    expect(r.mapa.get(r.limpia)).toEqual({ ordenes: false, dinero: false, tarifas: false });
    expect(r.mapa.get(r.conOrden)).toEqual({ ordenes: true, dinero: false, tarifas: false });
    expect(r.mapa.get(r.conDinero)).toEqual({ ordenes: false, dinero: true, tarifas: false });
    expect(r.mapa.get(r.conTarifa)).toEqual({ ordenes: false, dinero: false, tarifas: true });
  });

  it("un id que no existe entra igual en la respuesta, con todo en false", async () => {
    // `unnest` da una fila POR ID pedido, no por cuenta encontrada. Que sea asi importa: el
    // servicio distingue «no tiene datos» de «no la encontre» y las dos llevan al mismo sitio.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const inexistente = randomUUID();
      return { inexistente, mapa: await dependencias(tx, [inexistente]) };
    });

    expect(r.mapa.get(r.inexistente)).toEqual({ ordenes: false, dinero: false, tarifas: false });
  });

  it("las ordenes de OTRA tienda no cuentan como suyas", async () => {
    // La mutacion que caza: un `EXISTS` sin `WHERE`, que daria `true` a cualquiera mientras exista
    // una sola orden en toda la base (y las hay).
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ajena = await sembrarCuenta(tx, "ajena");
      const propia = await sembrarCuenta(tx, "propia");
      await sembrarOrden(tx, propia, false);
      return { ajena, propia, mapa: await dependencias(tx, [ajena, propia]) };
    });

    expect(r.mapa.get(r.ajena)?.ordenes).toBe(false);
    expect(r.mapa.get(r.propia)?.ordenes).toBe(true);
  });
});
