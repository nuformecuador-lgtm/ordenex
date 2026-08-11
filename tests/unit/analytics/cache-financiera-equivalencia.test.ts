import { describe, it, expect } from "vitest";
import { listarMetricas } from "@/lib/analytics/metrics";
import { CachedAnaliticaFinancieraService } from "@/lib/services/CachedAnaliticaFinancieraService";
import { armarServicio, consultaDe } from "../services/_dobles-analitica-financiera";
import type { DatosFinancieros } from "../services/_dobles-analitica-financiera";
import { cacheFalsa } from "./_cache-falsa";

// Feature 179 / T2.2 — R1: LA CACHE NO PUEDE CAMBIAR EL DINERO SERVIDO.
//
// Las metricas se ENUMERAN DESDE EL CATALOGO (`listarMetricas({ dominio: "financiera" })`) y no
// se escriben a mano: probar dos «representativas» perderia justo las raras —`cod_recaudado`
// trae DOS vistas no sumables entre si y `conciliacion_cierres` tiene otra forma de resultado
// (union discriminada por `tipo`)—. Si manana el catalogo gana una financiera, este caso la
// cubre solo.
//
// LA COMPARACION ES PROFUNDA Y CAMPO A CAMPO. La mutacion que mata: que el decorador devolviera
// el `JSON.parse` sin conservar la forma —o que «normalizara» el DTO de paso— y se perdieran
// `esAcumulado`, `sumableCon` o `granularidad`. Con un `toBe` sobre un total, eso pasaria.
//
// ⚠ `conciliacion_cierres` ENTRA EN ESTE CASO aunque D3 la excluya de la cache: lo que R1 exige
// es que el DTO servido POR EL DECORADOR sea identico al del servicio desnudo, y para ella el
// camino es «delegar sin tocar la cache». Que ese camino no altere nada tambien hay que medirlo.

/**
 * Semilla con material para las diez: caja (las seis metricas de `wallet_movimiento`), recaudo
 * (dos vistas), saldos de tienda, cuenta de mensajeros y cierres. Un fixture vacio dejaria todas
 * las igualdades comparando DTOs de ceros, que es verde por vacio.
 */
const DATOS: Partial<DatosFinancieros> = {
  caja: [
    { categoria: "ingreso_flete", tipo: "ingreso", suma: "300.00" },
    { categoria: "ingreso_comision_cod", tipo: "ingreso", suma: "120.50" },
    { categoria: "ingreso_iva_flete", tipo: "ingreso", suma: "54.60" },
    { categoria: "ingreso_cod_recaudado", tipo: "ingreso", suma: "900.00" },
    { categoria: "egreso_gasto", tipo: "egreso", suma: "80.00" },
    { categoria: "egreso_pago_tienda", tipo: "egreso", suma: "700.00" },
    { categoria: "ingreso_ajuste", tipo: "ingreso", suma: "15.00" },
  ],
  cajaPorCubo: [
    { indiceCubo: 0, categoria: "ingreso_flete", tipo: "ingreso", suma: "300.00" },
    { indiceCubo: 0, categoria: "egreso_gasto", tipo: "egreso", suma: "80.00" },
  ],
  porMetodo: [
    { metodo: "efectivo", suma: "300.00" },
    { metodo: "simpe", suma: "100.00" },
  ],
  porTienda: [
    { tiendaId: "t-1", tipo: "credito", suma: "300.00" },
    { tiendaId: "t-1", tipo: "debito", suma: "40.00" },
  ],
  saldoTiendas: [
    { tiendaId: "t-1", tipo: "credito", suma: "300.00" },
    { tiendaId: "t-2", tipo: "debito", suma: "25.00" },
  ],
  cuentaMensajeros: [
    { tipo: "devengo", suma: "410.00" },
    { tipo: "pago", suma: "200.00" },
  ],
  cuentaMensajerosPorCubo: [{ indiceCubo: 0, tipo: "devengo", suma: "410.00" }],
  cuentaMensajerosAntes: [{ tipo: "devengo", suma: "60.00" }],
  porEstado: [
    {
      nivel: "cierre_dia",
      estado: "aprobado",
      cantidad: 2,
      totales: { efectivo: "500.00", simpe: "100.00", transferencia: "100.00", general: "700.00" },
      fechadoPor: "resuelto_at",
    },
  ],
  snapshots: [{ cierreId: "c1", totalGeneral: "700.00" }],
  ledger: [{ ledger: "wallet_tienda_movimiento", cierreId: "c1", tipo: "credito", suma: "700.00" }],
};

const METRICAS = listarMetricas({ dominio: "financiera" });

describe("R1 · las metricas financieras sirven desde cache exactamente el mismo DTO que sin cache", () => {
  it("el catalogo aporta las metricas: no hay lista escrita a mano", () => {
    // Si esto fuera cero, todos los casos de abajo pasarian sin comparar nada.
    expect(METRICAS.length).toBeGreaterThanOrEqual(10);
  });

  for (const metrica of METRICAS) {
    it(`«${metrica.id}»: el DTO desde cache es identico, campo a campo y tipo a tipo`, async () => {
      const consulta = consultaDe(metrica.id);

      // (a) SIN cache: el servicio desnudo, el mismo que corre con el kill-switch puesto.
      const desnudo = armarServicio(DATOS);
      const sinCache = await desnudo.servicio.consultar(consulta);

      // (b) CON cache: primera consulta (MISS, resultado crudo) y segunda (HIT, round-trip).
      const decorado = armarServicio(DATOS);
      const cache = cacheFalsa();
      const servicio = new CachedAnaliticaFinancieraService(decorado.servicio, cache);
      const enMiss = await servicio.consultar(consulta);
      const enHit = await servicio.consultar(consulta);

      expect(enMiss).toEqual(sinCache);
      expect(enHit).toEqual(sinCache);
    });
  }

  it("y el fixture produce DTOs con contenido: si no, las igualdades compararian ceros", async () => {
    const { servicio } = armarServicio(DATOS);
    const r = await servicio.consultar(consultaDe("egresos"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    expect(r.datos.vistas.length).toBeGreaterThan(0);
    expect(r.datos.vistas[0].total.bruto).not.toBe("0.00");
  });
});
