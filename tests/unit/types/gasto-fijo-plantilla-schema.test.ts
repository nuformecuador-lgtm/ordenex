import { describe, it, expect, afterEach, vi } from "vitest";
import {
  actualizarGastoFijoPlantillaSchema,
  crearGastoFijoPlantillaSchema,
} from "@/lib/types/gasto-fijo-plantilla";

// Feature 85 (R1/R4/R5/R6) — el BORDE zod de la plantilla de gasto fijo, que es donde vive el
// fallo que esta ficha cierra: hasta la 85, `actualizar` HEREDABA los defaults de `crear`, asi
// que una edicion de `{id, concepto, monto}` pasaba entera y reescribia el ciclo a `meses`/`1`
// moviendo el ancla al dia de la edicion, en silencio.
//
// ASIMETRIA DELIBERADA, y por eso lleva test propio (R4 vs R1): CREAR conserva los defaults
// —no pisa ningun valor previo— y ACTUALIZAR los EXIGE.
//
// Los valores esperados van como LITERALES, nunca comparados contra `fechaCalendarioCR()` ni
// contra los defaults del propio schema: una asercion contra su propia fuente esta verde por
// construccion y en este repo ya dejo pasar un fallo real.

const UUID = "11111111-1111-4111-8111-111111111111";

/** 12:00 CR del 15 de marzo de 2026 (== 18:00 UTC, UTC-6): lejos del borde del dia. */
const RELOJ_CONGELADO = new Date("2026-03-15T18:00:00.000Z");

const CICLO_VIGENTE = {
  periodicidadUnidad: "semanas",
  periodicidadCantidad: 2,
  fechaCobro: "2026-03-31",
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("crearGastoFijoPlantillaSchema — defaults del ciclo (R4)", () => {
  it("crear sin periodicidad aplica meses/1 y la fecha CR del dia (reloj congelado en 2026-03-15)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(RELOJ_CONGELADO);

    const data = crearGastoFijoPlantillaSchema.parse({
      concepto: "Alquiler",
      monto: "80000.00",
    });

    expect(data.periodicidadUnidad).toBe("meses");
    expect(data.periodicidadCantidad).toBe(1);
    expect(data.fechaCobro).toBe("2026-03-15");
    // Money-safe (R24): el monto cruza el borde como STRING, tal cual.
    expect(data.monto).toBe("80000.00");
  });

  it("crear con periodicidad explicita NO la pisa con los defaults", () => {
    const data = crearGastoFijoPlantillaSchema.parse({
      concepto: "Alquiler",
      monto: "80000.00",
      ...CICLO_VIGENTE,
    });

    expect(data.periodicidadUnidad).toBe("semanas");
    expect(data.periodicidadCantidad).toBe(2);
    expect(data.fechaCobro).toBe("2026-03-31");
  });
});

describe("actualizarGastoFijoPlantillaSchema — el ciclo es OBLIGATORIO (R1)", () => {
  it("actualizar sin periodicidad falla nombrando los tres campos, sin inventar ningun default", () => {
    // El reloj se congela A PROPOSITO: si `actualizar` volviera a heredar el default de
    // `fechaCobro`, este parseo pasaria devolviendo "2026-03-15" en vez de fallar.
    vi.useFakeTimers();
    vi.setSystemTime(RELOJ_CONGELADO);

    const r = actualizarGastoFijoPlantillaSchema.safeParse({
      id: UUID,
      concepto: "Alquiler",
      monto: "85000.00",
    });

    expect(r.success).toBe(false);
    if (r.success) throw new Error("el borde acepto una edicion sin ciclo");
    const fieldErrors = r.error.flatten().fieldErrors;
    expect(fieldErrors.periodicidadUnidad).toBeDefined();
    expect(fieldErrors.periodicidadCantidad).toBeDefined();
    expect(fieldErrors.fechaCobro).toBeDefined();
  });

  it("actualizar con el ciclo completo pasa y conserva los valores enviados", () => {
    const data = actualizarGastoFijoPlantillaSchema.parse({
      id: UUID,
      concepto: "Alquiler",
      monto: "999.00",
      ...CICLO_VIGENTE,
    });

    expect(data.periodicidadUnidad).toBe("semanas");
    expect(data.periodicidadCantidad).toBe(2);
    expect(data.fechaCobro).toBe("2026-03-31");
    expect(data.monto).toBe("999.00");
  });
});

describe("fechaCobro — dia que EXISTE en el calendario (R5)", () => {
  it("rechaza 2026-02-31 al crear y al actualizar aunque cumpla el formato", () => {
    const alCrear = crearGastoFijoPlantillaSchema.safeParse({
      concepto: "Alquiler",
      monto: "80000.00",
      periodicidadUnidad: "meses",
      periodicidadCantidad: 1,
      fechaCobro: "2026-02-31",
    });
    expect(alCrear.success).toBe(false);

    const alActualizar = actualizarGastoFijoPlantillaSchema.safeParse({
      id: UUID,
      concepto: "Alquiler",
      monto: "80000.00",
      periodicidadUnidad: "meses",
      periodicidadCantidad: 1,
      fechaCobro: "2026-02-31",
    });
    expect(alActualizar.success).toBe(false);
    if (alActualizar.success) throw new Error("el borde acepto un dia inexistente");
    expect(alActualizar.error.flatten().fieldErrors.fechaCobro).toBeDefined();
  });

  it("acepta el 29 de febrero de un ano BISIESTO (2028) y rechaza el de uno que no lo es", () => {
    expect(
      crearGastoFijoPlantillaSchema.safeParse({
        concepto: "Alquiler",
        monto: "80000.00",
        periodicidadUnidad: "meses",
        periodicidadCantidad: 1,
        fechaCobro: "2028-02-29",
      }).success,
    ).toBe(true);

    expect(
      crearGastoFijoPlantillaSchema.safeParse({
        concepto: "Alquiler",
        monto: "80000.00",
        periodicidadUnidad: "meses",
        periodicidadCantidad: 1,
        fechaCobro: "2026-02-29",
      }).success,
    ).toBe(false);
  });

  it("rechaza una fecha con formato distinto de YYYY-MM-DD", () => {
    expect(
      crearGastoFijoPlantillaSchema.safeParse({
        concepto: "Alquiler",
        monto: "80000.00",
        periodicidadUnidad: "meses",
        periodicidadCantidad: 1,
        fechaCobro: "31/03/2026",
      }).success,
    ).toBe(false);
  });
});

describe("periodicidad — cantidad y unidad (R6)", () => {
  it("rechaza cantidad 0, cantidad decimal y unidad desconocida", () => {
    const base = {
      id: UUID,
      concepto: "Alquiler",
      monto: "80000.00",
      periodicidadUnidad: "semanas",
      periodicidadCantidad: 2,
      fechaCobro: "2026-03-31",
    };

    const cantidadCero = actualizarGastoFijoPlantillaSchema.safeParse({
      ...base,
      periodicidadCantidad: 0,
    });
    expect(cantidadCero.success).toBe(false);
    if (cantidadCero.success) throw new Error("el borde acepto cantidad 0");
    expect(cantidadCero.error.flatten().fieldErrors.periodicidadCantidad).toBeDefined();

    expect(
      actualizarGastoFijoPlantillaSchema.safeParse({ ...base, periodicidadCantidad: 1.5 }).success,
    ).toBe(false);

    const unidadDesconocida = actualizarGastoFijoPlantillaSchema.safeParse({
      ...base,
      periodicidadUnidad: "anual",
    });
    expect(unidadDesconocida.success).toBe(false);
    if (unidadDesconocida.success) throw new Error("el borde acepto una unidad desconocida");
    expect(unidadDesconocida.error.flatten().fieldErrors.periodicidadUnidad).toBeDefined();
  });

  it("la misma regla de cantidad rige al CREAR (crear no relaja lo que actualizar exige)", () => {
    expect(
      crearGastoFijoPlantillaSchema.safeParse({
        concepto: "Alquiler",
        monto: "80000.00",
        periodicidadUnidad: "dias",
        periodicidadCantidad: 0,
        fechaCobro: "2026-03-31",
      }).success,
    ).toBe(false);
  });
});

// ── FICHA 333 (B2, R2) — el INTERRUPTOR en el borde ───────────────────────────────────────────
//
// R2 dice, literal: «CUANDO se cree una plantilla sin indicar el interruptor, el sistema DEBE
// dejarla en REQUIERE APROBACION». Aqui es donde eso se decide, porque el default lo pone el
// schema —el repositorio, si no le llega el campo, cae en el `DEFAULT true` de la columna, que
// dice lo mismo—.
//
// Los valores van como LITERALES (`true` / `false`), nunca contra el propio `.default()` del
// schema: una asercion contra su propia fuente esta verde por construccion.
describe("gasto-fijo-plantilla — el interruptor de aprobacion en el borde (ficha 333, R2)", () => {
  it("R2: crear SIN el interruptor deja la plantilla en «requiere aprobacion»", () => {
    const data = crearGastoFijoPlantillaSchema.parse({
      concepto: "Alquiler",
      monto: "80000.00",
      ...CICLO_VIGENTE,
    });

    expect(data.requiereAprobacion).toBe(true);
  });

  it("R1: crear CON «cobra sola» (false) NO lo pisa con el default", () => {
    // Anti-vacuidad del caso anterior: si el schema forzara `true` en vez de aplicarlo como
    // default, el primer test pasaria igual y este moriria.
    const data = crearGastoFijoPlantillaSchema.parse({
      concepto: "Alquiler",
      monto: "80000.00",
      ...CICLO_VIGENTE,
      requiereAprobacion: false,
    });

    expect(data.requiereAprobacion).toBe(false);
  });

  it("R1: el interruptor tiene EXACTAMENTE dos valores; nada que no sea booleano cruza el borde", () => {
    const conTexto = crearGastoFijoPlantillaSchema.safeParse({
      concepto: "Alquiler",
      monto: "80000.00",
      ...CICLO_VIGENTE,
      requiereAprobacion: "si",
    });
    expect(conTexto.success).toBe(false);
    if (conTexto.success) throw new Error("el borde acepto un interruptor que no es booleano");
    expect(conTexto.error.flatten().fieldErrors.requiereAprobacion).toBeDefined();
  });

  it("R2: actualizar hereda el MISMO default (una edicion sin el campo no deja la fila sin valor)", () => {
    const data = actualizarGastoFijoPlantillaSchema.parse({
      id: UUID,
      concepto: "Alquiler",
      monto: "80000.00",
      ...CICLO_VIGENTE,
    });

    // Es el default de `crear`, heredado por el `.extend()`. Queda AFIRMADO, no supuesto: la
    // tanda G tiene que enviar el campo desde el dialogo (R4) para que una edicion no reescriba
    // el interruptor sin querer -- la misma familia de fallo que cerro la 85 con la periodicidad.
    expect(data.requiereAprobacion).toBe(true);
  });

  it("R1: actualizar con «cobra sola» explicito lo respeta", () => {
    const data = actualizarGastoFijoPlantillaSchema.parse({
      id: UUID,
      concepto: "Alquiler",
      monto: "80000.00",
      ...CICLO_VIGENTE,
      requiereAprobacion: false,
    });

    expect(data.requiereAprobacion).toBe(false);
  });
});
