import { describe, it, expect } from "vitest";

import {
  esFechaCorreccionValida,
  esFechaFutura,
  fechaCorreccionSchema,
  fechaFuturaSchema,
  motivoSchema,
} from "@/lib/types/gestion-orden";
import { fechaCalendarioCR, mananaCalendarioCR } from "@/lib/utils/fecha-cr";

// FICHA 371 — LA DESVIACION DELIBERADA: la correccion admite HOY; el registro sigue exigiendo
// MAÑANA.
//
// POR QUE ESTE ARCHIVO EXISTE. La trampa que habria hecho INUTIL la ficha entera es reusar
// `esFechaFutura` en el borde de la correccion: el caso REAL que la origina —corregir del 4 al 3
// estando a dia 3— habria fallado la validacion y no habria habido forma de arreglar la orden. Aqui
// se fija esa diferencia en las DOS direcciones, para que ni se pierda ni se contagie.

/**
 * 22:30 CR del 2 de septiembre = 04:30Z del 3. El dia UTC y el de Costa Rica NO coinciden a esta
 * hora, que es exactamente donde vive el off-by-one que `fecha-cr` existe para cerrar: derivar
 * «hoy» con los campos UTC de `new Date()` daria el 3 y esta suite lo vería.
 */
const NOW_2_CR = new Date("2026-09-03T04:30:00.000Z");
const HOY = "2026-09-02";
const AYER = "2026-09-01";
const MANANA = "2026-09-03";

describe("371 — `esFechaCorreccionValida`: hoy en adelante", () => {
  it("⭑ HOY vale, y es justo lo que `esFechaFutura` rechaza", () => {
    expect(esFechaCorreccionValida(HOY, NOW_2_CR)).toBe(true);
    // El control que da sentido al de arriba: sin esta linea, la primera pasaria igual aunque las
    // dos reglas fueran la misma.
    expect(esFechaFutura(HOY, NOW_2_CR)).toBe(false);
  });

  it("mañana vale en las dos (la correccion no estrecha nada del registro)", () => {
    expect(esFechaCorreccionValida(MANANA, NOW_2_CR)).toBe(true);
    expect(esFechaFutura(MANANA, NOW_2_CR)).toBe(true);
  });

  it("AYER no vale en ninguna", () => {
    expect(esFechaCorreccionValida(AYER, NOW_2_CR)).toBe(false);
    expect(esFechaFutura(AYER, NOW_2_CR)).toBe(false);
  });

  it("sin tope maximo: una fecha lejana vale", () => {
    expect(esFechaCorreccionValida("2027-12-31", NOW_2_CR)).toBe(true);
  });

  it.each(["2026-02-31", "2026-13-01", "2026-9-2", "02-09-2026", "hoy", ""])(
    "⭑ `%s` no es una fecha calendario valida y se rechaza",
    (valor) => {
      // `2026-02-31` es el caso que ni el regex ni `Invalid Date` cazan: en V8 el dia desbordado
      // RUEDA al 3 de marzo, y se guardaria un dia que nadie pidio.
      expect(esFechaCorreccionValida(valor, NOW_2_CR)).toBe(false);
    },
  );

  it("⭑ LA DIFERENCIA ES EXACTAMENTE UN DIA, y sale de `fecha-cr`, no de una constante", () => {
    // Si alguien reescribiera cualquiera de las dos reglas con su propio calendario, esta
    // igualdad dejaria de sostenerse.
    const hoyCR = fechaCalendarioCR(NOW_2_CR);
    const mananaCR = mananaCalendarioCR(NOW_2_CR);
    expect(hoyCR).toBe(HOY);
    expect(mananaCR).toBe(MANANA);
    expect(esFechaCorreccionValida(hoyCR, NOW_2_CR)).toBe(true);
    expect(esFechaFutura(hoyCR, NOW_2_CR)).toBe(false);
    expect(esFechaCorreccionValida(mananaCR, NOW_2_CR)).toBe(true);
    expect(esFechaFutura(mananaCR, NOW_2_CR)).toBe(true);
  });

  it("⭑ el limite se mueve con el reloj de Costa Rica, no con el UTC", () => {
    // 23:59 CR del 2 = 05:59Z del 3. Para UTC ya es dia 3; para CR sigue siendo el 2, asi que el
    // dia 2 TIENE que seguir valiendo.
    const casiMedianocheCR = new Date("2026-09-03T05:59:00.000Z");
    expect(esFechaCorreccionValida(HOY, casiMedianocheCR)).toBe(true);
    // Un minuto despues (00:00 CR del 3) el dia 2 ya es pasado.
    const medianocheCR = new Date("2026-09-03T06:00:00.000Z");
    expect(esFechaCorreccionValida(HOY, medianocheCR)).toBe(false);
  });
});

describe("371 — los dos schemas del borde", () => {
  it("⭑ `fechaCorreccionSchema` acepta hoy; `fechaFuturaSchema` lo rechaza", () => {
    const hoy = fechaCalendarioCR();
    expect(fechaCorreccionSchema.safeParse(hoy).success).toBe(true);
    expect(fechaFuturaSchema.safeParse(hoy).success).toBe(false);
  });

  it("`fechaCorreccionSchema` rechaza el dia de ayer con su mensaje", () => {
    const ayer = fechaCalendarioCR(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const r = fechaCorreccionSchema.safeParse(ayer);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("la fecha debe ser hoy o posterior");
  });

  it("⭑ el motivo de la correccion es EL MISMO schema que el de reprogramar", () => {
    // Decision del humano: «basicamente es la misma gestion que reprogramar». Que sea el mismo
    // objeto y no una copia es lo que impide que un dia uno pida 10 caracteres y el otro 1.
    expect(motivoSchema.safeParse("").success).toBe(false);
    expect(motivoSchema.safeParse("   ").success).toBe(false);
    expect(motivoSchema.safeParse("x").success).toBe(true);
    expect(motivoSchema.parse("  se cambio la ruta  ")).toBe("se cambio la ruta");
  });
});
