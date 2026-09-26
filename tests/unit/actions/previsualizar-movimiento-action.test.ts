import { describe, it, expect, vi } from "vitest";

import { previsualizarMovimientoAction } from "@/lib/actions/efecto-movimiento";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { PrevisualizarMovimientoService } from "@/lib/services/PrevisualizarMovimientoService";

// FICHA 458-B / TB.12 (R44, R82) — el borde de «Así queda» por rol, con el servicio REAL y lectores
// dobles que registran si se les llamo (el rol va ANTES de leer).

const TIENDA_ID = "00000000-0000-4000-8000-0000000000a1";
const MENSAJERO_ID = "00000000-0000-4000-8000-0000000000b1";

function montar() {
  const lecturas: string[] = [];
  const anotar = <T,>(nombre: string, valor: T) =>
    vi.fn(async () => {
      lecturas.push(nombre);
      return valor;
    });
  const servicio = new PrevisualizarMovimientoService(
    {
      agregarPorCategoriaYTipo: anotar("caja", [{ categoria: "ingreso_cod_recaudado" as const, tipo: "ingreso" as const, total: "1000.00" }]),
      primerDiaDeLaCaja: anotar("primerDia", "2026-09-01"),
    },
    { haySaldoInicialVigente: anotar("saldoInicial", false) },
    { agregarSaldoPorTienda: anotar("saldoTienda", { creditos: "1000.00", debitos: "0.00" }) },
    {
      obtenerCuentaTienda: vi.fn(async (id: string) => {
        lecturas.push("cuentaTienda");
        return id === TIENDA_ID ? ({ id, rol: "adminTienda", estado: "activo" } as never) : null;
      }),
    },
    {
      agregarCuentaPorPagar: anotar("cuentaMensajero", { devengado: "500.00", pagado: "0.00" }),
      obtenerNombreMensajero: vi.fn(async (id: string) => {
        lecturas.push("nombreMensajero");
        return id === MENSAJERO_ID ? "Mensajero" : null;
      }),
    },
  );
  return { servicio, lecturas };
}

const como = (actor: Actor | null, service: PrevisualizarMovimientoService) => ({ getActor: async () => actor, service });
const MAESTRO: Actor = { usuarioId: "m", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a", rol: "admin" };

describe("458-B/TB.12 — previsualizarMovimientoAction", () => {
  it("sin sesion: `unauthenticated`, sin leer nada", async () => {
    const t = montar();
    expect(await previsualizarMovimientoAction({ concepto: "sueldo", monto: "10" }, como(null, t.servicio))).toEqual({ status: "unauthenticated" });
    expect(t.lecturas).toEqual([]);
  });

  it("R82: tienda, mensajero y admin de satelite → `forbidden` ANTES de leer", async () => {
    for (const rol of ["adminTienda", "mensajero", "adminSatelite"] as const) {
      const t = montar();
      const r = await previsualizarMovimientoAction(
        { concepto: "cobro_a_tienda", cuentaId: TIENDA_ID, monto: "10" },
        como({ usuarioId: "x", rol }, t.servicio),
      );
      expect(r, rol).toEqual({ status: "forbidden" });
      expect(t.lecturas, rol).toEqual([]);
    }
  });

  it("maestro y admin: `ok` con el efecto calculado en el servidor", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const t = montar();
      const r = await previsualizarMovimientoAction({ concepto: "cobro_a_tienda", cuentaId: TIENDA_ID, monto: "10" }, como(actor, t.servicio));
      expect(r).toMatchObject({
        status: "ok",
        efecto: { lineas: { cuenta: { tipo: "tienda", antes: "1000.00", despues: "990.00" } }, saldoEnContra: false },
      });
    }
  });

  it("forma: `.strict()`, monto invalido, concepto desconocido → `validation_error`", async () => {
    const t = montar();
    const deps = como(MAESTRO, t.servicio);
    expect(await previsualizarMovimientoAction({ concepto: "sueldo", monto: "10", tipo: "egreso" }, deps)).toMatchObject({ status: "validation_error" });
    expect(await previsualizarMovimientoAction({ concepto: "sueldo", monto: "-1" }, deps)).toMatchObject({ status: "validation_error" });
    expect(await previsualizarMovimientoAction({ concepto: "regalo", monto: "1" }, deps)).toMatchObject({ status: "validation_error" });
    expect(t.lecturas).toEqual([]);
  });

  it("un concepto con cuenta sin `cuentaId` → `validation_error` bajo `cuentaId`; una cuenta inexistente → `no_encontrado`", async () => {
    const t = montar();
    const deps = como(MAESTRO, t.servicio);
    expect(await previsualizarMovimientoAction({ concepto: "pago_a_tienda", monto: "1" }, deps)).toEqual({
      status: "validation_error",
      fieldErrors: { cuentaId: ["Elija la cuenta."] },
    });
    expect(
      await previsualizarMovimientoAction({ concepto: "pago_a_tienda", cuentaId: MENSAJERO_ID, monto: "1" }, deps),
    ).toEqual({ status: "no_encontrado" });
    expect(
      await previsualizarMovimientoAction({ concepto: "pago_a_mensajero", cuentaId: TIENDA_ID, monto: "1" }, deps),
    ).toEqual({ status: "no_encontrado" });
  });
});
