import { describe, it, expect } from "vitest";
import type { Mock } from "vitest";
import { CachedAnaliticaFinancieraService } from "@/lib/services/CachedAnaliticaFinancieraService";
import { armarServicio, consultaDe } from "../services/_dobles-analitica-financiera";
import type { DatosFinancieros } from "../services/_dobles-analitica-financiera";
import { cacheFalsa } from "./_cache-falsa";

// Feature 179 / T2.5 — R28 (D3) SOBRE EL COMPORTAMIENTO, no sobre la declaracion.
//
// El guardia hermano (`cache-financiera-politica.guardia.test.ts`) comprueba que alguien escribio
// `cacheable: false`. Eso NO prueba que el decorador lo respete. La asercion que impide el «ya
// que estamos, cacheemos tambien esta» es la de abajo: la base se consulta las DOS veces y el
// `ErrorLogger` recibe DOS emisiones.
//
// ⚠ POR QUE `conciliacion_cierres` NO SE CACHEA (D3, humano 2026-08-10). `deConciliacion` emite
// por el `ErrorLogger` cuando |diferencia| supera el umbral (R24 de la 127). Cacheada, ese aviso
// pasaria de sonar UNA VEZ POR CONSULTA a UNA VEZ POR TTL — y un aviso que suena menos es un
// aviso que alguien deja de ver. **El valor de esa metrica para el negocio es la alerta, no la
// cifra**: cachearla ahorra poco y apaga la senal.

/** Snapshot 700 frente a un ledger de 600: descuadre de 100, muy por encima del umbral (0.01). */
const DESCUADRADO: Partial<DatosFinancieros> = {
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
  ledger: [{ ledger: "wallet_tienda_movimiento", cierreId: "c1", tipo: "credito", suma: "600.00" }],
};

describe("R28 (D3) · `conciliacion_cierres` no se cachea NUNCA", () => {
  it("dos consultas identicas consultan la base las dos veces", async () => {
    const armado = armarServicio(DESCUADRADO);
    const servicio = new CachedAnaliticaFinancieraService(armado.servicio, cacheFalsa());
    const consulta = consultaDe("conciliacion_cierres");

    await servicio.consultar(consulta);
    const trasLaPrimera = armado.consultasHechas();
    expect(trasLaPrimera).toBeGreaterThan(0);

    await servicio.consultar(consulta);

    expect(armado.consultasHechas()).toBe(trasLaPrimera * 2);
  });

  it("el aviso de descuadre se emite en CADA consulta, no una vez por TTL", async () => {
    const armado = armarServicio(DESCUADRADO);
    const servicio = new CachedAnaliticaFinancieraService(armado.servicio, cacheFalsa());
    const consulta = consultaDe("conciliacion_cierres");

    await servicio.consultar(consulta);
    await servicio.consultar(consulta);
    await servicio.consultar(consulta);

    const emisiones = (armado.logger.logError as Mock).mock.calls;
    expect(
      emisiones.length,
      "el aviso de descuadre paso a sonar menos veces que consultas hay: eso es exactamente lo " +
        "que D3 impide. El valor de esta metrica es la ALERTA, no la cifra.",
    ).toBe(3);
    expect(String(emisiones[0][0])).toMatch(/descuadre de conciliacion_cierres/);
  });

  it("y el DTO servido es el mismo que sin decorador (delegar no altera nada)", async () => {
    const desnudo = armarServicio(DESCUADRADO);
    const decorado = armarServicio(DESCUADRADO);
    const servicio = new CachedAnaliticaFinancieraService(decorado.servicio, cacheFalsa());

    expect(await servicio.consultar(consultaDe("conciliacion_cierres"))).toEqual(
      await desnudo.servicio.consultar(consultaDe("conciliacion_cierres")),
    );
  });

  it("el fixture DISCRIMINA: si cuadrara, el contador de emisiones seria cero y el caso no diria nada", async () => {
    const cuadrado: Partial<DatosFinancieros> = {
      ...DESCUADRADO,
      ledger: [
        { ledger: "wallet_tienda_movimiento", cierreId: "c1", tipo: "credito", suma: "700.00" },
      ],
    };
    const armado = armarServicio(cuadrado);
    const servicio = new CachedAnaliticaFinancieraService(armado.servicio, cacheFalsa());

    await servicio.consultar(consultaDe("conciliacion_cierres"));

    expect((armado.logger.logError as Mock).mock.calls.length).toBe(0);
  });
});
