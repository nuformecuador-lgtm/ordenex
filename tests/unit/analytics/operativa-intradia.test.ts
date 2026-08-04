import { describe, it, expect } from "vitest";
import { inicioDelDiaCREnUtc } from "@/lib/utils/fecha-cr";
import {
  AHORA,
  HOY_CR,
  consultaDe,
  cubo,
  rollupFalso,
  servicioCon,
  vivaFalso,
} from "./_fake-operativa";

// Feature 126 / T6.2 + T6.3 — R18 (T0-Q1 = B del 2026-08-02).
//
// HECHO VERIFICADO: el job de la 124 corre a las 00:30 CR y agrega EL DIA QUE CERRO. Por tanto
// `analytics_daily` NUNCA tiene filas del dia en curso, y el preset `dia` de la 135 resuelve
// al dia natural CR de `now`, es decir HOY. Servido solo del rollup, el preset por defecto del
// tablero operativo devolveria cero filas SIEMPRE.
//
// La decision Q1 = B es completar ese dia EN VIVO. Lo que R18 exige ademas es que el punto se
// DISTINGA: `parcial: true` y el instante de corte. Un punto del dia abierto indistinguible de
// uno cerrado es peor que no tenerlo, porque invita a comparar media jornada con jornadas
// completas.

const INTRADIA = {
  cubos: [cubo({ fecha: HOY_CR, entregas: 4 })],
  entregasVigentes: [],
};

describe("R18 · el dia en curso se completa en vivo y se marca", () => {
  it("el punto del dia en curso viene marcado como parcial y con su instante de corte", async () => {
    const serie = await servicioCon(rollupFalso([]), vivaFalso({ intradia: INTRADIA })).consultar(
      consultaDe("entregas"),
    );
    expect(serie.puntos).toHaveLength(1);
    expect(serie.puntos[0].fecha).toBe(HOY_CR);
    expect(serie.puntos[0].valor).toBe(4);
    expect(serie.puntos[0].parcial).toBe(true);
    expect(serie.puntos[0].corteAt).toBe(AHORA.toISOString());
  });

  it("y el marcador VIAJA en la respuesta serializada, no solo en el objeto", async () => {
    const serie = await servicioCon(rollupFalso([]), vivaFalso({ intradia: INTRADIA })).consultar(
      consultaDe("entregas"),
    );
    expect(JSON.stringify(serie)).toContain('"parcial":true');
    expect(JSON.stringify(serie)).toContain(AHORA.toISOString());
  });

  it("los dias CERRADOS del mismo rango NO se marcan: la diferencia esta en el dato", async () => {
    // Es el escenario real: en una misma serie conviven puntos cerrados y UN punto parcial.
    const rollup = rollupFalso([cubo({ fecha: "2026-08-02", entregas: 10 })]);
    const serie = await servicioCon(rollup, vivaFalso({ intradia: INTRADIA })).consultar(
      consultaDe("entregas", undefined, {
        rango: "personalizado",
        desde: "2026-08-02",
        hasta: "2026-08-03",
      }),
    );
    const cerrado = serie.puntos.find((p) => p.fecha === "2026-08-02");
    const abierto = serie.puntos.find((p) => p.fecha === HOY_CR);
    expect(cerrado?.parcial).toBeUndefined();
    expect(cerrado?.corteAt).toBeUndefined();
    expect(abierto?.parcial).toBe(true);
  });

  it("si el rango NO incluye hoy, el camino intradia ni se dispara", async () => {
    let llamado = false;
    const viva = vivaFalso({ intradia: INTRADIA });
    const espia = {
      ...viva,
      async cubosDelDiaEnCurso(...args: Parameters<typeof viva.cubosDelDiaEnCurso>) {
        llamado = true;
        return viva.cubosDelDiaEnCurso(...args);
      },
    };
    await servicioCon(rollupFalso([]), espia).consultar(
      consultaDe("entregas", undefined, {
        rango: "personalizado",
        desde: "2026-07-20",
        hasta: "2026-07-25",
      }),
    );
    expect(llamado, "se consulto el intradia para un rango que no incluye hoy").toBe(false);
  });

  it("la ventana del dia abierto es [medianoche CR de hoy, ahora), no un dia entero", async () => {
    let ventana: { desde: Date; hasta: Date } | undefined;
    const viva = vivaFalso({ intradia: INTRADIA });
    const espia = {
      ...viva,
      async cubosDelDiaEnCurso(
        consulta: Parameters<typeof viva.cubosDelDiaEnCurso>[0],
        v: Parameters<typeof viva.cubosDelDiaEnCurso>[1],
      ) {
        ventana = v;
        return viva.cubosDelDiaEnCurso(consulta, v);
      },
    };
    await servicioCon(rollupFalso([]), espia).consultar(consultaDe("entregas"));
    // La cota inferior sale de `lib/utils/fecha-cr` (D7): ni `startOfDayCR` —la trampa
    // 18:00-18:00 de `RankingService`— ni aritmetica horaria propia.
    expect(ventana?.desde.toISOString()).toBe(inicioDelDiaCREnUtc(HOY_CR).toISOString());
    // La cota superior es AHORA, no la medianoche siguiente: el dia no ha cerrado.
    expect(ventana?.hasta.toISOString()).toBe(AHORA.toISOString());
    expect(ventana!.hasta.getTime()).toBeLessThan(
      inicioDelDiaCREnUtc(HOY_CR).getTime() + 24 * 60 * 60 * 1000,
    );
  });
});
