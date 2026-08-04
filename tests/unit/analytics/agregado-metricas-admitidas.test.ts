import { describe, it, expect, vi } from "vitest";
import { consultarAgregadoOperativo } from "@/lib/actions/analitica-operativa";
import { ERROR_UNIDAD_NO_AGREGABLE } from "@/lib/types/analitica-operativa";
import { AHORA, MAESTRO, consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 176 / T4.7 — R12.
//
// EL MODO AGREGADO EXISTE PARA LO QUE NO ES SUMABLE. Servir aqui una metrica de `conteo`
// —`ordenes_por_estado`, por ejemplo— sumaria un STOCK entre fechas: la columna
// `ordenes_estado_stock` es una foto al corte de cada dia y `analytics_daily` no tiene forma
// de decir que no se suma (`db/schema.prisma:1886`, R12 de la 126). El resultado no seria un
// error visible sino un numero grande y plausible.
//
// Por eso se rechaza con `validation_error` en el BORDE, antes del servicio, y el
// repositorio recibe CERO llamadas: se cuentan de verdad, con `rollupFalso().llamadasAgregar`.

function bordeCon(cubos = [cubo({ fecha: "2026-08-01", entregas: 3, devoluciones: 1 })]) {
  const rollup = rollupFalso(cubos);
  return {
    rollup,
    opciones: {
      service: servicioCon(rollup),
      logger: { logError: vi.fn() },
      now: () => AHORA,
      getActor: async () => MAESTRO,
    },
  };
}

describe("R12 · una metrica de conteo no se agrega", () => {
  it("una metrica de conteo se rechaza con validation_error y no se agrega", async () => {
    const { rollup, opciones } = bordeCon();
    const r = await consultarAgregadoOperativo(
      { metricaId: "ordenes_por_estado", raw: { rango: "dia" } },
      opciones,
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("no es validation_error");
    expect(r.fieldErrors.metricaId).toEqual([ERROR_UNIDAD_NO_AGREGABLE]);
    // Ni datos, ni cubos, ni un agregado con forma correcta.
    expect("datos" in r).toBe(false);
    // Y el repositorio no se toco: cero llamadas, contadas.
    expect(rollup.llamadasAgregar).toHaveLength(0);
  });

  it("las otras metricas de conteo tambien: `entregas` es un conteo, no una tasa", async () => {
    const { rollup, opciones } = bordeCon();
    const r = await consultarAgregadoOperativo(
      { metricaId: "entregas", raw: { rango: "dia" } },
      opciones,
    );
    expect(r.status).toBe("validation_error");
    expect(rollup.llamadasAgregar).toHaveLength(0);
  });

  it("y las de porcentaje y segundos SI se sirven: el rechazo no es un cierre total", async () => {
    for (const metricaId of [
      "tasa_entrega",
      "tasa_devolucion",
      "tasa_rechazo",
      "primer_intento_ok",
      "tiempo_ciclo",
    ]) {
      const { rollup, opciones } = bordeCon();
      const r = await consultarAgregadoOperativo({ metricaId, raw: { rango: "dia" } }, opciones);
      expect(r.status, `${metricaId} deberia servirse`).toBe("ok");
      expect(rollup.llamadasAgregar.length, `${metricaId}: consulto el rollup`).toBe(1);
    }
  });

  it("el servicio tampoco sirve un conteo si se le llama por otra puerta", async () => {
    // Cinturon y tirantes: el borde ya lo rechaza, pero el servicio no devuelve ceros
    // plausibles a quien lo llame directamente.
    const servicio = servicioCon(rollupFalso([]));
    await expect(
      servicio.consultarAgregado(consultaDe("ordenes_por_estado")),
    ).rejects.toThrow(ERROR_UNIDAD_NO_AGREGABLE);
  });
});
