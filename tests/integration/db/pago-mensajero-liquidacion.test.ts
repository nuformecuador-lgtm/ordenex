import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED,
  type PagoMensajeroMovimientoCategoria,
} from "@/lib/types/wallet-mensajero";
import { WALLET_ORIGEN_TIPO_SEED, type WalletOrigenTipo } from "@/lib/types/wallet";
import type { CrearPagoMensajeroInput } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";

// Feature 44/T17 (RESERVADO — F1.4-Qf = follow-up) — la LIQUIDACION manual (saldar lo pendiente)
// NO se implementa en la 44. Este test de ESQUEMA confirma que la categoria `liquidacion` y el
// origen `pago_mensajero` quedan RESERVADOS y USABLES sin migracion adicional, de modo que el
// follow-up (registrar un pago/liquidacion que reduce la cuenta por pagar) no requiera cambio de
// esquema. No aplica la migracion (patron estatico del repo); solo lee schema.prisma + los enums
// generados (SEED). El acto de liquidar NO existe aun (verificado como ausente).

const ROOT = path.join(__dirname, "..", "..", "..");
const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

describe("R23 — liquidacion RESERVADA (enum del libro por mensajero)", () => {
  it("el enum PagoMensajeroMovimientoCategoria incluye 'liquidacion' (usable sin migracion)", () => {
    expect(PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED).toContain("liquidacion");
    // usable a nivel de tipo: una liquidacion es un movimiento tipo=pago, categoria=liquidacion.
    const cat: PagoMensajeroMovimientoCategoria = "liquidacion";
    expect(cat).toBe("liquidacion");
    // el schema Prisma declara el valor en el enum nativo.
    expect(schema).toMatch(/enum PagoMensajeroMovimientoCategoria \{[\s\S]*liquidacion[\s\S]*\}/);
  });
});

describe("R23 — origen_tipo=pago_mensajero RESERVADO (enum de la 42, reutilizado)", () => {
  it("WalletOrigenTipo incluye 'pago_mensajero' (origen de la futura liquidacion, sin migracion)", () => {
    expect(WALLET_ORIGEN_TIPO_SEED).toContain("pago_mensajero");
    const origen: WalletOrigenTipo = "pago_mensajero";
    expect(origen).toBe("pago_mensajero");
    expect(schema).toMatch(/enum WalletOrigenTipo \{[\s\S]*pago_mensajero[\s\S]*\}/);
  });

  it("una liquidacion futura se tipa sin cambio de esquema: pago/liquidacion con origen pago_mensajero", () => {
    // Prueba de USABILIDAD a nivel de tipo (no persiste): el input del repo admite la fila de una
    // liquidacion manual (origen_id = id de la operacion de pago). El follow-up solo agrega la
    // accion; el modelo ya lo soporta.
    const liquidacion: CrearPagoMensajeroInput = {
      mensajeroId: "m1",
      tipo: "pago",
      categoria: "liquidacion",
      monto: "700.00",
      origenTipo: "pago_mensajero",
      origenId: "op-liquidacion-1",
      descripcion: "liquidacion cuenta por pagar",
      registradoPor: "adm-maestro",
    };
    expect(liquidacion.categoria).toBe("liquidacion");
    expect(liquidacion.origenTipo).toBe("pago_mensajero");
  });
});

describe("R23 — el acto de liquidar NO se implementa en la 44 (solo reservado)", () => {
  it("el service de lectura del pago por mensajero NO expone ninguna accion de liquidacion", async () => {
    const svc = await import("@/lib/services/WalletMensajeroService");
    const proto = svc.WalletMensajeroService.prototype as unknown as Record<string, unknown>;
    // Solo lecturas: sin registrarLiquidacion / liquidar / saldarCuentaPorPagar.
    expect(proto.registrarLiquidacion).toBeUndefined();
    expect(proto.liquidar).toBeUndefined();
    expect(proto.saldarCuentaPorPagar).toBeUndefined();
  });

  it("las Server Actions del pago por mensajero NO exponen registrarLiquidacionMensajeroAction", async () => {
    const actions = (await import("@/lib/actions/wallet-mensajero")) as Record<string, unknown>;
    expect(actions.registrarLiquidacionMensajeroAction).toBeUndefined();

    // CONTROL POSITIVO, y por eso son DOS y no una: una aserción NEGATIVA sobre un módulo pasa
    // sola si el módulo se queda vacío, si cambia de ruta o si el import falla en silencio. Los
    // testigos dicen que este módulo SÍ existe y SÍ exporta lecturas, así que el `toBeUndefined`
    // de arriba significa algo.
    //
    // Ficha 336 (2026-08-30): los testigos eran `verMiCuentaPorPagarAction` y
    // `listarMisPagosAction`, retiradas con `/mis-pagos`. Se re-anclan a dos acciones VIVAS de
    // administración, cuya superficie es `/wallet/mensajeros`. Bajar de dos deja el control a un
    // solo borrado de volverse vacuo.
    expect(typeof actions.listarCuentasPorPagarAction).toBe("function");
    expect(typeof actions.listarPagosDeMensajeroAction).toBe("function");

    // Y las tres lecturas de la vista PROPIA del mensajero ya no están: la ficha 336 las retiró
    // en vez de anotarlas `@sin-superficie`.
    expect(actions.verMiCuentaPorPagarAction).toBeUndefined();
    expect(actions.listarMisPagosAction).toBeUndefined();
    expect(actions.listarMisPagosCompletoAction).toBeUndefined();
  });
});
