import { describe, it, expect } from "vitest";
import { diasNaturalesCRDesde } from "@/lib/utils/fecha-cr";
import { clasificar, cortesPorZona, variables } from "@/lib/whatsapp-envios/informes/transito/calculo";
import {
  PARAMETROS_POR_DEFECTO,
  type ParametrosTransito,
  type ZonaInforme,
} from "@/lib/whatsapp-envios/informes/transito/parametros";
import type { FilaTransito } from "@/lib/whatsapp-envios/informes/transito/tipos";

// Ficha 475 (T3.2) — R6, R7, R15, R16, R17, R20, R24-R26 sobre el calculo PURO.

const UN_DIA = 24 * 60 * 60 * 1000;
/** Lunes 5 de octubre de 2026, 05:00 hora de Costa Rica. */
const AHORA = new Date("2026-10-05T11:00:00.000Z");

const GAM: ZonaInforme = { id: "z-gam", nombre: "GAM", esCentral: true };
const SUR: ZonaInforme = { id: "z-sur", nombre: "FGAM Zona Sur", esCentral: false };
const COCO: ZonaInforme = { id: "z-coco", nombre: "FGAM El Coco", esCentral: false };
const LIMON: ZonaInforme = { id: "z-limon", nombre: "FGAM Limon Arriba", esCentral: false };
const ZONAS = [COCO, GAM, LIMON, SUR];

let n = 0;
function fila(over: Partial<FilaTransito> & { dias?: number; diasEnEstado?: number | null }): FilaTransito {
  n += 1;
  const { dias = 9, diasEnEstado = 0, ...resto } = over;
  return {
    ordenId: `o-${n}`,
    numRemision: `R-${n}`,
    numGuia: 1000 + n,
    estado: "en_reparto",
    zonaId: GAM.id,
    destinatario: "Cliente",
    canton: "San José",
    distrito: "Hatillo",
    montoCobrar: "1000.00",
    hitoAt: new Date(AHORA.getTime() - dias * UN_DIA),
    ultimaTransicionAt: diasEnEstado === null ? null : new Date(AHORA.getTime() - diasEnEstado * UN_DIA),
    ...resto,
  };
}

const P: ParametrosTransito = PARAMETROS_POR_DEFECTO;

describe("475/R17 — corte por zona ⇔ dias naturales CR >= umbral", () => {
  it("la frontera cae a las 00:00 CR (06:00 UTC), no a las 00:00 UTC", () => {
    const [corte] = cortesPorZona([GAM], P, AHORA);
    // GAM 10/2: umbral 8. Entra lo que entro el 27/09 CR o antes.
    expect(corte.corte.toISOString()).toBe("2026-09-28T06:00:00.000Z");
    const ultimoDentro = new Date("2026-09-28T05:59:00.000Z"); // 23:59 CR del 27
    const primeroFuera = new Date("2026-09-28T06:00:00.000Z"); // 00:00 CR del 28
    expect(diasNaturalesCRDesde(ultimoDentro, AHORA)).toBe(8);
    expect(ultimoDentro < corte.corte).toBe(true);
    expect(diasNaturalesCRDesde(primeroFuera, AHORA)).toBe(7);
    expect(primeroFuera < corte.corte).toBe(false);
  });

  it("equivalencia exhaustiva hora a hora en 30 dias y varios relojes de generacion", () => {
    for (const ahora of [AHORA, new Date("2026-10-06T05:59:59.999Z"), new Date("2026-10-06T06:00:00.000Z")]) {
      const [cg, cs] = cortesPorZona([GAM, SUR], P, ahora);
      for (let h = 0; h < 30 * 24; h++) {
        const hito = new Date(ahora.getTime() - h * 60 * 60 * 1000);
        const dias = diasNaturalesCRDesde(hito, ahora);
        expect(hito < cg.corte).toBe(dias >= 8);
        expect(hito < cs.corte).toBe(dias >= 15);
      }
    }
  });

  it("R6/R7: zona sin entrada usa la partida de su tipo; una entrada de zona inexistente se ignora", () => {
    const p: ParametrosTransito = {
      ...P,
      zonas: [
        { zonaId: SUR.id, plazoDias: 4, avisoDias: 1 },
        { zonaId: "no-existe", plazoDias: 1, avisoDias: 0 },
      ],
    };
    const cortes = cortesPorZona(ZONAS, p, AHORA);
    expect(cortes.map((c) => c.zonaId)).toEqual(ZONAS.map((z) => z.id));
    const porZona = new Map(cortes.map((c) => [c.zonaId, c.corte.toISOString()]));
    expect(porZona.get(SUR.id)).toBe("2026-10-03T06:00:00.000Z"); // umbral 3
    expect(porZona.get(GAM.id)).toBe("2026-09-28T06:00:00.000Z"); // 10/2
    expect(porZona.get(COCO.id)).toBe("2026-09-21T06:00:00.000Z"); // 20/5 -> 15
  });
});

describe("475/R15 — vencido / por vencer", () => {
  it("10/10 por vencer, 11/10 y 12/10 vencidos, 8/10 y 9/10 en alerta", () => {
    const m = clasificar(
      [fila({ dias: 8 }), fila({ dias: 9 }), fila({ dias: 10 }), fila({ dias: 11 }), fila({ dias: 12 })],
      ZONAS,
      P,
      AHORA,
      0,
    );
    const porDias = new Map(m.central!.paquetes.map((p) => [p.dias, p.vencido]));
    expect([...porDias.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [8, false],
      [9, false],
      [10, false],
      [11, true],
      [12, true],
    ]);
    expect(m.totales).toMatchObject({ enAlerta: 5, vencidos: 2, porVencer: 3 });
  });
});

describe("475/R16 — parado", () => {
  it("estricto: dias en el estado > umbral", () => {
    const m = clasificar(
      [
        fila({ estado: "en_bodega_central", diasEnEstado: 2 }),
        fila({ estado: "en_bodega_central", diasEnEstado: 3 }),
      ],
      ZONAS,
      P,
      AHORA,
      0,
    );
    expect(m.central!.paquetes.map((p) => [p.diasEnEstado, p.parado]).sort()).toEqual([
      [2, false],
      [3, true],
    ]);
    expect(m.totales.parados).toBe(1);
  });

  it("umbral 0: un dia en el estado ya es parado; mismo dia, no", () => {
    const p: ParametrosTransito = {
      ...P,
      estados: P.estados.map((e) => (e.estado === "en_reparto" ? { ...e, paradoSiMasDeDias: 0 } : e)),
    };
    const m = clasificar([fila({ diasEnEstado: 0 }), fila({ diasEnEstado: 1 })], ZONAS, p, AHORA, 0);
    expect(m.totales.parados).toBe(1);
  });

  it("sin umbral o sin historial, nunca parado", () => {
    const m = clasificar(
      [fila({ estado: "en_reparto", diasEnEstado: 50 }), fila({ estado: "novedad", diasEnEstado: null })],
      ZONAS,
      P,
      AHORA,
      0,
    );
    expect(m.totales.parados).toBe(0);
    expect(m.parados).toEqual([]);
  });
});

describe("475/R24-R26 — orden de zonas, filas y bloque ATENCION", () => {
  const filas = [
    fila({ zonaId: SUR.id, dias: 16, numGuia: 30 }),
    fila({ zonaId: LIMON.id, dias: 23, numGuia: 20 }),
    fila({ zonaId: LIMON.id, dias: 16, numGuia: 21 }),
    fila({ zonaId: SUR.id, dias: 24, numGuia: 31 }),
    fila({ zonaId: GAM.id, dias: 9, numGuia: 12 }),
    fila({ zonaId: GAM.id, dias: 9, numGuia: 11 }),
    fila({ zonaId: GAM.id, dias: 12, numGuia: null }),
    fila({ zonaId: GAM.id, dias: 9, numGuia: null, numRemision: "A-1" }),
    fila({ estado: "novedad", zonaId: GAM.id, dias: 8, diasEnEstado: 2, numGuia: 50 }),
    fila({ estado: "en_bodega_satelite", zonaId: SUR.id, dias: 20, diasEnEstado: 9, numGuia: 60 }),
    fila({ estado: "en_bodega_satelite", zonaId: SUR.id, dias: 19, diasEnEstado: 3, numGuia: 61 }),
  ];
  const m = clasificar(filas, ZONAS, P, AHORA, 0);

  it("central primero; fuera por nº de paquetes desc, luego mayor nº de dias desc, luego nombre", () => {
    expect(m.central!.zona.id).toBe(GAM.id);
    expect(m.fuera.map((z) => z.zona.id)).toEqual([SUR.id, LIMON.id]);
    // Empate en paquetes y dias -> nombre.
    const empate = clasificar(
      [fila({ zonaId: SUR.id, dias: 16 }), fila({ zonaId: COCO.id, dias: 16 })],
      ZONAS,
      P,
      AHORA,
      0,
    );
    expect(empate.fuera.map((z) => z.zona.nombre)).toEqual(["FGAM El Coco", "FGAM Zona Sur"]);
    // Empate en paquetes, distinto maximo de dias.
    const porDias = clasificar(
      [fila({ zonaId: COCO.id, dias: 16 }), fila({ zonaId: SUR.id, dias: 17 })],
      ZONAS,
      P,
      AHORA,
      0,
    );
    expect(porDias.fuera.map((z) => z.zona.id)).toEqual([SUR.id, COCO.id]);
  });

  it("filas por dias desc y, a igualdad, guia asc (sin guia al final)", () => {
    expect(m.central!.paquetes.map((p) => [p.dias, p.numGuia])).toEqual([
      [12, null],
      [9, 11],
      [9, 12],
      [9, null],
      [8, 50],
    ]);
  });

  it("zonas sin alertas por nombre (R28)", () => {
    expect(m.sinAlertas.map((z) => z.nombre)).toEqual(["FGAM El Coco"]);
  });

  it("ATENCION en el orden del flujo, cada grupo con su umbral y por dias en el estado desc", () => {
    expect(m.parados.map((g) => [g.estado, g.umbral, g.paquetes.map((p) => p.numGuia)])).toEqual([
      ["en_bodega_satelite", 2, [60, 61]],
      ["novedad", 1, [50]],
    ]);
  });

  it("R20: GAM / fuera por esCentral", () => {
    expect(m.totales.enAlertaGam).toBe(5);
    expect(m.totales.enAlertaFueraGam).toBe(6);
  });

  it("una fila de una zona que no se leyo es un error, no se pierde en silencio", () => {
    expect(() => clasificar([fila({ zonaId: "fantasma" })], ZONAS, P, AHORA, 0)).toThrow(/zona desconocida/);
  });
});

describe("475/R20 — variables", () => {
  it("valores exactos, por_cobrar sin number (montos null y enteros grandes)", () => {
    const m = clasificar(
      [
        fila({ montoCobrar: "99999999999.00", dias: 12 }),
        fila({ montoCobrar: "99999999999.00", zonaId: SUR.id, dias: 16, estado: "novedad", diasEnEstado: 5 }),
        fila({ montoCobrar: null }),
        fila({ montoCobrar: "0.00" }),
        fila({ montoCobrar: "18500.00" }),
      ],
      ZONAS,
      P,
      AHORA,
      3,
    );
    expect(m.totales.porCobrar).toBe("200000018498.00");
    expect(variables(m)).toEqual({
      total_en_alerta: "5",
      vencidos: "1",
      por_vencer: "4",
      parados: "1",
      por_cobrar: "₡200.000.018.498",
      en_alerta_gam: "4",
      en_alerta_fuera_gam: "1",
      fecha: "05/10/2026",
    });
    expect(m.sinHito).toBe(3);
  });

  it("sin paquetes: todo a 0 y por_cobrar ₡0", () => {
    const v = variables(clasificar([], ZONAS, P, AHORA, 0));
    expect(v).toMatchObject({ total_en_alerta: "0", vencidos: "0", por_vencer: "0", parados: "0", por_cobrar: "₡0" });
  });

  it("fecha DD/MM/YYYY de Costa Rica: a las 23:30 CR sigue siendo el mismo dia", () => {
    const tarde = new Date("2026-10-06T05:30:00.000Z"); // 23:30 CR del 5
    expect(variables(clasificar([], ZONAS, P, tarde, 0)).fecha).toBe("05/10/2026");
  });
});
