import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459 } from "./_fixtures/caja-459";
import { CRONOLOGICO, leerEstadoCuenta, montarEstadoCuenta, sembrarEscenario458 } from "./_fixtures/wallet-458";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-D (revision m2) — 172 R53 sobre el ESTADO DE CUENTA, contra Postgres y con un pago REAL.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// 172 R53: «CUANDO hay un pago a una tienda vigente, el importe "pagado a la tienda" de la cabecera de
// su desglose DEBE reflejarlo, y el saldo DEBE bajar en ese mismo monto». El desglose se retiro: hoy la
// cabecera es el resumen de tres cifras de `/mi-wallet` («Ya pagado») y el saldo es la tarjeta del
// estado de cuenta (la misma en la oficina y en la tienda). El pago lo escribe `LiquidacionService`.
//
// Tienda C del escenario de la 458: saldo 5 200,00 y «Ya pagado» 4 000,00 (ver
// `mi-wallet-resumen-458d.test.ts`). Pago de 1 234,56 → saldo 3 965,44 y «Ya pagado» 5 234,56. Al
// anularlo deja de estar vigente: el saldo vuelve a 5 200,00 y «Ya pagado» sigue en 5 234,56 (N1: el
// resumen es bruto). Los importes son LITERALES: el contrato, no una resta hecha aqui.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface Medida {
  antes: { tienda: EstadoCuentaDTO; oficina: EstadoCuentaDTO };
  conPago: { tienda: EstadoCuentaDTO; oficina: EstadoCuentaDTO };
  anulado: { tienda: EstadoCuentaDTO; oficina: EstadoCuentaDTO };
  movimientoDelPago: string;
}

describeSiHayBase("458-D m2 — 172 R53: el pago vigente a una tienda sube «Ya pagado» y baja el saldo en el mismo monto (Postgres)", () => {
  let prisma: PrismaClient;
  let medida: Medida | undefined;
  let fallo: unknown;

  function m(): Medida {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la medida no llego a tomarse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      medida = await enTransaccionRevertida459(prisma, async (tx) => {
        const s = montarServicios459(tx);
        const esc = await sembrarEscenario458(tx, cat);
        const ec = montarEstadoCuenta(s);
        const tienda: Actor = { usuarioId: esc.tiendaC, rol: "adminTienda" };
        const leer = async () => {
          const r = await ec.leerMiTienda({ page: 1, pageSize: 50, ...CRONOLOGICO }, tienda);
          if (r.status !== "ok") throw new Error(`mi estado de cuenta: ${JSON.stringify(r)}`);
          return {
            tienda: r.estado,
            oficina: await leerEstadoCuenta(ec, esc.maestro, { cuenta: { tipo: "tienda", id: esc.tiendaC } }),
          };
        };

        const antes = await leer();
        const clave = randomUUID();
        const pago = await s.liquidacion.registrarPagoTienda(
          { claveIdempotencia: clave, tiendaId: esc.tiendaC, monto: "1234.56", metodo: "efectivo", fechaPago: "2026-09-20" },
          esc.maestro,
        );
        if (pago.status !== "ok") throw new Error(`pago a la tienda: ${JSON.stringify(pago)}`);
        const doc = await tx.liquidacionPago.findUniqueOrThrow({ where: { claveIdempotencia: clave }, select: { id: true } });
        const movimientoDelPago = (
          await tx.walletTiendaMovimiento.findFirstOrThrow({
            where: { origenTipo: "pago_tienda", origenId: doc.id, categoria: "pago_tienda" },
            select: { id: true },
          })
        ).id;
        const conPago = await leer();
        const anulacion = await s.liquidacion.anularPago({ pagoId: doc.id, motivo: "Pago de prueba R53" }, esc.maestro);
        if (anulacion.status !== "ok") throw new Error(`anular: ${JSON.stringify(anulacion)}`);
        const anulado = await leer();
        return { antes, conPago, anulado, movimientoDelPago };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const idDe = (f: FilaEstadoCuentaDTO) => (f.ref !== null && "movimientoId" in f.ref ? f.ref.movimientoId : "");

  it("punto de partida: saldo 5 200,00 y «Ya pagado» 4 000,00, iguales en la oficina y en la tienda", () => {
    const { antes } = m();
    expect(antes.tienda.saldoActual).toBe("5200.00");
    expect(antes.oficina.saldoActual).toBe("5200.00");
    expect(antes.tienda.resumen?.pagado).toBe("4000.00");
  });

  it("172 R53: con el pago vigente, «Ya pagado» lo refleja (5 234,56) y el saldo baja en ese mismo monto (3 965,44)", () => {
    const { conPago } = m();
    expect(conPago.tienda.resumen?.pagado).toBe("5234.56");
    expect(conPago.tienda.resumen?.saldo).toBe("3965.44");
    expect(conPago.tienda.saldoActual).toBe("3965.44");
    expect(conPago.oficina.saldoActual).toBe("3965.44");
  });

  it("172 R53: el pago es UNA fila de cargo por su monto, en «Pagos», y su corrido es el saldo nuevo", () => {
    const { conPago, movimientoDelPago } = m();
    const fila = conPago.oficina.filas.find((f) => idDe(f) === movimientoDelPago);
    expect(fila?.cargo).toBe("1234.56");
    expect(fila?.abono).toBeNull();
    expect(fila?.chip).toBe("pagos");
    expect(fila?.anulacion).toBeNull();
    // El corrido de la última fila (el extracto) también bajó: es el saldo nuevo, en las dos vistas.
    expect(conPago.oficina.filas[conPago.oficina.filas.length - 1].saldoCorrido).toBe("3965.44");
    expect(conPago.tienda.filas[conPago.tienda.filas.length - 1].saldoCorrido).toBe("3965.44");
  });

  it("172 R53 (vigente): anulado, el saldo vuelve a 5 200,00; «Ya pagado» sigue en 5 234,56 (N1, bruto)", () => {
    const { anulado, movimientoDelPago } = m();
    expect(anulado.tienda.saldoActual).toBe("5200.00");
    expect(anulado.oficina.saldoActual).toBe("5200.00");
    expect(anulado.tienda.resumen?.pagado).toBe("5234.56");
    expect(anulado.oficina.filas.find((f) => idDe(f) === movimientoDelPago)?.anulacion?.motivo).toBe("Pago de prueba R53");
  });
});
