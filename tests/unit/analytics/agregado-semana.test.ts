import { describe, it, expect } from "vitest";
import { resolverRango } from "@/lib/analytics/ranges";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 176 / T6.1 — R19 y D6.
//
// EL REPO NO PUEDE TENER DOS DEFINICIONES DE «LUNES». Ya hay una en
// `app/(app)/analitica/_components/operativo/agregacion.ts` (`lunesDeLaSemana`, de la 131) y
// esta feature anade la del servicio, porque `lib/` no puede importar de `app/` ni mudar el
// subarbol de otra feature. Es deuda DECLARADA (`design.md §6.1`) con dueno y con fecha de
// vencimiento —la ficha frontend de D5 borra la copia del cliente—, y mientras dure lo unico
// que la contiene es este test: un calculo duplicado en dos capas se desincroniza solo, y
// nada avisa.
//
// El oraculo NO es una constante escrita a mano: es el preset `semana` de
// `lib/analytics/ranges.ts`, cuyo `desdeFecha` ES, por definicion, el lunes de la semana CR
// de `now`. Si alguien cambia la convencion alli, este test cae aqui.

/** El lunes segun `ranges.ts`, leido por el mismo camino que usa el filtro de la 135. */
function lunesSegunElPreset(fechaCR: string): string {
  // Mediodia CR (18:00Z) de esa fecha: cualquier instante del dia sirve, y este esta lejos
  // de las dos fronteras.
  return resolverRango({ preset: "semana" }, new Date(`${fechaCR}T18:00:00.000Z`)).desdeFecha;
}

/** Un caso: la fecha de un cubo y el lunes que le corresponde. */
const CASOS: readonly { fecha: string; nota: string }[] = [
  { fecha: "2026-08-02", nota: "un DOMINGO: el error clasico es anclarlo en el dia siguiente" },
  { fecha: "2026-08-03", nota: "un LUNES: se ancla en si mismo, sin retroceder una semana" },
  { fecha: "2026-08-01", nota: "un SABADO, a mitad de semana" },
  { fecha: "2026-01-01", nota: "un CAMBIO DE ANO: el lunes cae en el ano anterior" },
];

async function lunesSegunElServicio(fecha: string): Promise<string> {
  const agregado = await servicioCon(
    rollupFalso([cubo({ fecha, entregas: 1, devoluciones: 1 })]),
  ).consultarAgregado(
    // El rango se abre lo suficiente para que el cubeteo semanal tenga margen por los dos
    // lados y el recorte no enmascare el ancla.
    consultaDe("tasa_entrega", undefined, {
      rango: "personalizado",
      desde: "2025-12-25",
      hasta: "2026-08-09",
    }),
    { grano: "semana" },
  );
  expect(agregado.cubos).toHaveLength(1);
  return agregado.cubos[0].fecha;
}

describe("R19 · el grano `semana` usa el mismo lunes que `ranges.ts`", () => {
  it("el grano semana ancla en el mismo lunes que el preset `semana` de `ranges.ts`", async () => {
    for (const { fecha, nota } of CASOS) {
      const esperado = lunesSegunElPreset(fecha);
      expect(await lunesSegunElServicio(fecha), `${fecha} (${nota})`).toBe(esperado);
    }
  });

  it("y los lunes esperados son los de verdad, no lo que diga el codigo bajo prueba", async () => {
    // Contrapeso del caso anterior: si `ranges.ts` y el servicio se equivocaran IGUAL, el
    // test de arriba seguiria verde. Estas cuatro fechas estan calculadas a mano.
    expect(lunesSegunElPreset("2026-08-02")).toBe("2026-07-27");
    expect(lunesSegunElPreset("2026-08-03")).toBe("2026-08-03");
    expect(lunesSegunElPreset("2026-08-01")).toBe("2026-07-27");
    expect(lunesSegunElPreset("2026-01-01")).toBe("2025-12-29");
  });

  it("un rango de varias semanas produce un cubo por semana, anclado en su lunes", async () => {
    const cubos = [
      cubo({ fecha: "2026-07-27", entregas: 1, devoluciones: 1 }),
      cubo({ fecha: "2026-08-02", entregas: 3, devoluciones: 1 }),
      cubo({ fecha: "2026-08-03", entregas: 5, devoluciones: 5 }),
    ];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tasa_entrega", undefined, {
        rango: "personalizado",
        desde: "2026-07-27",
        hasta: "2026-08-03",
      }),
      { grano: "semana" },
    );

    const porSemana = new Map(agregado.cubos.map((c) => [c.fecha, c]));
    expect([...porSemana.keys()].sort()).toEqual(["2026-07-27", "2026-08-03"]);
    // La semana completa suma sus dos dias ANTES de dividir: 4 sobre 6.
    expect(porSemana.get("2026-07-27")?.numerador).toBe(4);
    expect(porSemana.get("2026-07-27")?.denominador).toBe(6);
    // Y los extremos del cubo se RECORTAN al rango: una semana a medias no puede anunciar
    // dias que la consulta no pidio.
    expect(porSemana.get("2026-07-27")?.desdeFecha).toBe("2026-07-27");
    expect(porSemana.get("2026-07-27")?.hastaFecha).toBe("2026-08-02");
    expect(porSemana.get("2026-08-03")?.desdeFecha).toBe("2026-08-03");
    expect(porSemana.get("2026-08-03")?.hastaFecha).toBe("2026-08-03");
  });

  it("el grano `periodo` produce UN cubo con los extremos del rango", async () => {
    const cubos = [
      cubo({ fecha: "2026-07-27", entregas: 1, devoluciones: 1 }),
      cubo({ fecha: "2026-08-03", entregas: 5, devoluciones: 5 }),
    ];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tasa_entrega", undefined, {
        rango: "personalizado",
        desde: "2026-07-27",
        hasta: "2026-08-03",
      }),
    );
    expect(agregado.grano).toBe("periodo");
    expect(agregado.cubos).toHaveLength(1);
    expect(agregado.cubos[0].fecha).toBe("2026-07-27");
    expect(agregado.cubos[0].desdeFecha).toBe("2026-07-27");
    expect(agregado.cubos[0].hastaFecha).toBe("2026-08-03");
  });
});
