import { describe, it, expect, afterEach, vi } from "vitest";
import {
  esFechaMovimientoValida,
  fechaMovimientoSchema,
  primerDiaMovimientoAdmisible,
  problemaDeFechaMovimiento,
} from "@/lib/types/wallet";
import { walletMovimientoConfig } from "@/lib/config/wallet-movimiento";

/**
 * Ficha 334 / T A.2 (R19/R20/R21) — la FECHA del movimiento manual en el BORDE.
 *
 * Lo que este archivo tiene que demostrar, y por que cada caso esta:
 *
 *  - **hoy vale, mañana no** (R20). El tope de arriba lo fijo el humano el 2026-08-29.
 *  - **un dia que NO existe no vale** (R21). `2026-02-31` cumple el regex de forma y V8 NO
 *    devuelve `Invalid Date` con el dia desbordado: RUEDA al 3 de marzo. Sin el round-trip de
 *    `esFechaCalendarioValida`, el usuario pediria un dia y el sistema guardaria otro.
 *  - **la ventana hacia atras** (decision del leader del 2026-08-29, pregunta abierta 1 del
 *    spec). Sin ella, R22 admitiria fechar en 2019 y reescribir un mes ya reportado.
 *  - **las 20:00 de Costa Rica.** Es el caso que separa `fechaCalendarioCR` de un
 *    `toISOString().slice(0, 10)`: a esa hora el reloj UTC ya marca el dia SIGUIENTE, asi que
 *    la version ingenua daria por buena una fecha que en Costa Rica todavia es futuro.
 */

/** Congela el reloj en `iso` para todo lo que corra despues dentro del caso. */
function conRelojEn(iso: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("fechaMovimientoSchema — el dia en curso y el futuro (R19/R20)", () => {
  it("acepta el dia calendario EN CURSO de Costa Rica", () => {
    conRelojEn("2026-08-29T15:00:00.000Z"); // 09:00 CR del 29
    expect(fechaMovimientoSchema.safeParse("2026-08-29").success).toBe(true);
    expect(esFechaMovimientoValida("2026-08-29")).toBe(true);
  });

  it("R20: rechaza MAÑANA, y el mensaje dice por que", () => {
    conRelojEn("2026-08-29T15:00:00.000Z");
    const r = fechaMovimientoSchema.safeParse("2026-08-30");
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(
      "La fecha no puede ser posterior a hoy.",
    );
  });

  it("R22: acepta una fecha PASADA dentro de la ventana", () => {
    conRelojEn("2026-08-29T15:00:00.000Z");
    expect(fechaMovimientoSchema.safeParse("2026-08-28").success).toBe(true);
    expect(problemaDeFechaMovimiento("2026-08-28")).toBeNull();
  });
});

describe("fechaMovimientoSchema — forma y calendario (R21)", () => {
  it("R21: rechaza un dia que NO existe (2026-02-31), que el regex de forma SI deja pasar", () => {
    conRelojEn("2026-08-29T15:00:00.000Z");
    // Control: la forma es correcta — o sea que lo que rechaza es el calendario, no el regex.
    expect(/^\d{4}-\d{2}-\d{2}$/.test("2026-02-31")).toBe(true);
    const r = fechaMovimientoSchema.safeParse("2026-02-31");
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain("Esa fecha no existe en el calendario.");
  });

  it("R21: rechaza un formato que no es YYYY-MM-DD, con UN solo mensaje", () => {
    conRelojEn("2026-08-29T15:00:00.000Z");
    const r = fechaMovimientoSchema.safeParse("29-08-2026");
    expect(r.success).toBe(false);
    // Un solo issue: el de la forma. Sin la salida temprana del `superRefine`, zod v4 emitiria
    // ademas «esa fecha no existe» y el dialogo pintaria dos avisos que dicen lo mismo.
    expect(r.error?.issues.map((i) => i.message)).toEqual([
      "La fecha debe tener el formato YYYY-MM-DD.",
    ]);
  });

  it("rechaza el vacio y un texto cualquiera", () => {
    conRelojEn("2026-08-29T15:00:00.000Z");
    expect(fechaMovimientoSchema.safeParse("").success).toBe(false);
    expect(fechaMovimientoSchema.safeParse("ayer").success).toBe(false);
  });
});

describe("la ventana hacia atras (decision del leader, pregunta abierta 1)", () => {
  it("CONTROL DE NO-VACUIDAD: la ventana es un numero positivo de dias", () => {
    // Sin esto, una config a 0 dejaria los dos casos de abajo afirmando sobre «hoy» y «hoy».
    expect(walletMovimientoConfig.DIAS_HACIA_ATRAS).toBeGreaterThan(0);
  });

  it("acepta el dia MAS ANTIGUO de la ventana: con 30 dias y hoy 2026-08-29, es el 2026-07-30", () => {
    conRelojEn("2026-08-29T15:00:00.000Z");
    // El literal ES el contrato, y va acompañado del numero del que sale: si alguien cambia el
    // default de la ventana, este caso se pone rojo y hay que decidirlo a proposito en vez de
    // que la cota se mueva sola.
    expect(walletMovimientoConfig.DIAS_HACIA_ATRAS).toBe(30);
    expect(primerDiaMovimientoAdmisible()).toBe("2026-07-30");
    expect(fechaMovimientoSchema.safeParse("2026-07-30").success).toBe(true);
  });

  it("rechaza el dia ANTERIOR a la ventana, y el mensaje nombra el primer dia admisible", () => {
    conRelojEn("2026-08-29T15:00:00.000Z");
    const r = fechaMovimientoSchema.safeParse("2026-07-29");
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual([
      "No se admiten movimientos anteriores al 2026-07-30.",
    ]);
  });

  it("rechaza una fecha de hace años — el caso que motivo la cota", () => {
    conRelojEn("2026-08-29T15:00:00.000Z");
    expect(esFechaMovimientoValida("2019-03-04")).toBe(false);
    expect(fechaMovimientoSchema.safeParse("2019-03-04").success).toBe(false);
  });
});

describe("las 20:00 de Costa Rica — el dia NO se adelanta (R19/R20)", () => {
  /**
   * 02:00Z del 30 son las 20:00 CR del 29. Este es EL caso: un
   * `new Date().toISOString().slice(0, 10)` diria «hoy es el 30» y dejaria pasar una fecha que
   * en Costa Rica todavia no ha llegado. Comprobado con la mutacion (ver `progress/impl_334.md`).
   */
  const VEINTE_HORAS_CR = "2026-08-30T02:00:00.000Z";

  it("a las 20:00 CR del 29, «hoy» sigue siendo el 29 y se acepta", () => {
    conRelojEn(VEINTE_HORAS_CR);
    expect(fechaMovimientoSchema.safeParse("2026-08-29").success).toBe(true);
  });

  it("a las 20:00 CR del 29, el 30 es MAÑANA y se rechaza (el UTC ya dice 30)", () => {
    conRelojEn(VEINTE_HORAS_CR);
    // Control: el reloj UTC efectivamente ya marca el dia siguiente.
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-08-30");
    const r = fechaMovimientoSchema.safeParse("2026-08-30");
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual([
      "La fecha no puede ser posterior a hoy.",
    ]);
  });

  it("y a las 23:59 CR del 29 (05:59Z del 30) tampoco se ha adelantado", () => {
    conRelojEn("2026-08-30T05:59:00.000Z");
    expect(esFechaMovimientoValida("2026-08-29")).toBe(true);
    expect(esFechaMovimientoValida("2026-08-30")).toBe(false);
  });

  it("y a las 00:00 CR del 30 (06:00Z) SI se ha adelantado", () => {
    conRelojEn("2026-08-30T06:00:00.000Z");
    expect(esFechaMovimientoValida("2026-08-30")).toBe(true);
  });
});
