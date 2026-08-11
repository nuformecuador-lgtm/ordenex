import { describe, it, expect } from "vitest";
import { listarMetricas } from "@/lib/analytics/metrics";
import { armarServicio, consultaDe } from "../services/_dobles-analitica-financiera";
import type { DatosFinancieros } from "../services/_dobles-analitica-financiera";

// Feature 179 / T2.3 — R3, la mitad de EJECUCION (la estatica esta en
// `cache-financiera-json.guardia.test.ts`).
//
// ⚠ POR QUE ESTO OCUPA EL SITIO DEL CODEC DE LA 128, Y POR QUE ES MAS NECESARIO QUE EL.
// La 128 necesitaba un codec porque `CuboRollup.segCicloAcum` es `bigint` y `JSON.stringify`
// **LANZA** sobre un `BigInt`: guardar el cubo sin codificar rompia la CONSULTA entera, o sea que
// el fallo era ruidoso e inmediato. Aqui pasa lo contrario y es PEOR: **nada lanza**. Si manana
// alguien anade `corteAt: Date` al DTO, el viaje por JSON lo devuelve como `string`, la vista
// sigue pintando y nadie se entera hasta que alguien compare dos pantallas.
//
// Por eso no basta con `toEqual`: se recorre el DTO entero y se exige que TODA hoja sea de un
// tipo que sobreviva al viaje (`string`, `number`, `boolean`, `null`). Un `Date` en cualquier
// nivel se ve aqui, aunque su valor «parezca» el mismo.
//
// LAS DIEZ, tambien la no cacheable: si manana `conciliacion_cierres` se declarara cacheable, la
// prueba ya existe.

const DATOS: Partial<DatosFinancieros> = {
  caja: [
    { categoria: "ingreso_flete", tipo: "ingreso", suma: "300.00" },
    { categoria: "ingreso_comision_cod", tipo: "ingreso", suma: "120.50" },
    { categoria: "ingreso_iva_flete", tipo: "ingreso", suma: "54.60" },
    { categoria: "ingreso_cod_recaudado", tipo: "ingreso", suma: "900.00" },
    { categoria: "egreso_gasto", tipo: "egreso", suma: "80.00" },
  ],
  cajaPorCubo: [{ indiceCubo: 0, categoria: "ingreso_flete", tipo: "ingreso", suma: "300.00" }],
  porMetodo: [{ metodo: "efectivo", suma: "300.00" }],
  porTienda: [{ tiendaId: "t-1", tipo: "credito", suma: "300.00" }],
  saldoTiendas: [{ tiendaId: "t-1", tipo: "credito", suma: "300.00" }],
  cuentaMensajeros: [{ tipo: "devengo", suma: "410.00" }],
  cuentaMensajerosPorCubo: [{ indiceCubo: 0, tipo: "devengo", suma: "410.00" }],
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

/** Toda hoja del DTO, con su ruta, para poder decir CUAL campo no sobrevive. */
function hojas(valor: unknown, ruta = "$"): { ruta: string; tipo: string }[] {
  if (valor === null) return [{ ruta, tipo: "null" }];
  if (Array.isArray(valor)) return valor.flatMap((v, i) => hojas(v, `${ruta}[${i}]`));
  if (valor instanceof Date) return [{ ruta, tipo: "Date" }];
  if (valor instanceof Map) return [{ ruta, tipo: "Map" }];
  if (valor instanceof Set) return [{ ruta, tipo: "Set" }];
  if (typeof valor === "object") {
    return Object.entries(valor as Record<string, unknown>).flatMap(([k, v]) =>
      hojas(v, `${ruta}.${k}`),
    );
  }
  return [{ ruta, tipo: typeof valor }];
}

const TIPOS_QUE_SOBREVIVEN = new Set(["string", "number", "boolean", "null"]);

const METRICAS = listarMetricas({ dominio: "financiera" });

describe("R3 · el DTO de cada metrica financiera es identico tras el viaje por JSON", () => {
  it("el catalogo aporta las metricas: no hay lista escrita a mano", () => {
    expect(METRICAS.length).toBeGreaterThanOrEqual(10);
  });

  for (const metrica of METRICAS) {
    it(`«${metrica.id}»: sobrevive al round-trip sin cambiar ningun tipo`, async () => {
      const { servicio } = armarServicio(DATOS);
      const r = await servicio.consultar(consultaDe(metrica.id));
      if (r.status !== "ok") throw new Error(`«${metrica.id}» no devolvio ok`);

      const original = r.datos;
      const ida = JSON.stringify(original);
      const vuelta: unknown = JSON.parse(ida);

      // Igualdad ESTRICTA: distingue `undefined` de ausente y una instancia de un objeto plano.
      expect(vuelta).toStrictEqual(original);
      // Y la ida es estable: serializar lo que volvio da el mismo texto.
      expect(JSON.stringify(vuelta)).toBe(ida);

      // La parte que un `toEqual` no da: NINGUNA hoja es de un tipo que degrade en silencio.
      const sospechosas = hojas(original).filter((h) => !TIPOS_QUE_SOBREVIVEN.has(h.tipo));
      expect(
        sospechosas,
        `«${metrica.id}» publica campos que NO sobreviven a JSON. Aqui nada LANZA: un \`Date\` ` +
          "vuelve como `string` y la pantalla sigue pintando. Campos: " +
          sospechosas.map((h) => `${h.ruta}:${h.tipo}`).join(", "),
      ).toEqual([]);
    });
  }

  it("el detector DISCRIMINA: un `Date` metido en un DTO se ve", () => {
    // Sin esto, el caso de arriba seria verde aunque `hojas` devolviera siempre `[]`.
    const conFecha = { rango: { corteAt: new Date("2026-08-02T00:00:00.000Z") } };
    expect(hojas(conFecha).map((h) => h.tipo)).toEqual(["Date"]);
    expect(hojas({ n: BigInt(1) }).map((h) => h.tipo)).toEqual(["bigint"]);
  });
});
