import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  excesoIndemnizacion,
  msgTopeNegocio,
  MSG_TOPE_TECNICO,
} from "@/lib/utils/tope-indemnizacion";
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";

// Fix «tope de negocio de la indemnizacion» (2026-08-04) — LA REGLA, aislada de los dos
// emisores. Aqui se fijan las decisiones que el codigo declara: el limite INCLUSIVO, el caso
// NULL, el caso `0.00` y que el tope TECNICO no desaparece.

/** El mayor valor que cabe en un DECIMAL(12,2) — el tope TECNICO, tal cual lo declara la 158. */
const MAX_TECNICO = INDEMNIZACION_MONTO_MAX; // "9999999999.99"

/** Un centimo mas que `v`, en STRING (money-safe: Decimal, nunca `number + 0.01`). */
function masUnCentimo(v: string): string {
  return new Prisma.Decimal(v).plus("0.01").toFixed(2);
}

describe("el limite contra el valor de la orden es INCLUSIVO", () => {
  it("monto IGUAL al valor de la orden -> se ACEPTA (perdida total del paquete)", () => {
    expect(excesoIndemnizacion("42000.00", "42000.00")).toBeNull();
  });

  it("monto UN CENTIMO por encima del valor de la orden -> se RECHAZA", () => {
    const r = excesoIndemnizacion(masUnCentimo("42000.00"), "42000.00");
    expect(r).toBe(msgTopeNegocio("42000.00"));
  });

  it("monto por DEBAJO del valor de la orden -> se acepta", () => {
    expect(excesoIndemnizacion("100.00", "42000.00")).toBeNull();
  });

  it("la frontera se mide con Decimal, no con float (0.1 + 0.2 no rompe el limite)", () => {
    // 0.30 == 0.30 exacto: con `parseFloat` esto seria 0.30000000000000004 > 0.3 y rechazaria
    // un monto legitimo. Es el motivo de que el dinero viaje STRING en todo el repo.
    expect(excesoIndemnizacion("0.30", "0.30")).toBeNull();
  });
});

describe("DECISION 1 — la orden SIN `monto_cobrar` (NULL) cae al tope TECNICO", () => {
  it("NULL no significa «sin limite»: por encima del maximo de la columna se RECHAZA", () => {
    expect(excesoIndemnizacion(masUnCentimo(MAX_TECNICO), null)).toBe(MSG_TOPE_TECNICO);
  });

  it("NULL no significa «bloqueado»: un monto normal se ACEPTA", () => {
    expect(excesoIndemnizacion("42000.00", null)).toBeNull();
  });

  it("NULL admite EXACTAMENTE el maximo tecnico (limite inclusivo tambien aqui)", () => {
    // Es el monto que se colo en produccion el 2026-08-04. Con la orden sin valor declarado
    // sigue cabiendo: es el coste DECLARADO de la decision 1, no un descuido.
    expect(excesoIndemnizacion(MAX_TECNICO, null)).toBeNull();
  });
});

describe("DECISION 2 — `monto_cobrar = 0` se trata como el NULL (no acota)", () => {
  it.each(["0", "0.00", "0.0"])("un valor de orden `%s` no bloquea la indemnizacion", (cero) => {
    // Si el cero se tomara como tope literal, NINGUNA indemnizacion (> 0 por definicion) seria
    // posible sobre esas ordenes: el bloqueo total que el leader ya descarto para el NULL.
    expect(excesoIndemnizacion("5000.00", cero)).toBeNull();
  });

  it("pero el tope TECNICO sigue en pie con valor 0", () => {
    expect(excesoIndemnizacion(masUnCentimo(MAX_TECNICO), "0.00")).toBe(MSG_TOPE_TECNICO);
  });
});

describe("el tope TECNICO no se quita: es la ultima barrera contra el overflow", () => {
  it("EXACTAMENTE el maximo de la columna se acepta; un centimo mas, no", () => {
    expect(excesoIndemnizacion(MAX_TECNICO, null)).toBeNull();
    expect(excesoIndemnizacion(masUnCentimo(MAX_TECNICO), null)).toBe(MSG_TOPE_TECNICO);
  });

  it("con orden valorada, un monto sobre el maximo tecnico tambien cae (nunca se escribe)", () => {
    // Los dos topes se superan a la vez: da igual cual nombre el mensaje, lo que NO puede pasar
    // es que devuelva `null` y el monto llegue a la transaccion.
    expect(excesoIndemnizacion(masUnCentimo(MAX_TECNICO), "42000.00")).not.toBeNull();
  });
});

describe("el mensaje DICE cual de los dos topes se supero", () => {
  it("el de negocio nombra el valor de la orden; el tecnico, el limite de la columna", () => {
    const negocio = excesoIndemnizacion("42000.01", "42000.00");
    const tecnico = excesoIndemnizacion(masUnCentimo(MAX_TECNICO), null);

    expect(negocio).toContain("42000.00");
    expect(negocio).toMatch(/valor de la orden/i);
    expect(tecnico).toContain(MAX_TECNICO);
    expect(tecnico).not.toMatch(/valor de la orden/i);
    expect(negocio).not.toBe(tecnico); // dos mensajes distintos, o no se distinguen los topes
  });

  it("el tope de negocio se normaliza a 2 decimales en el mensaje", () => {
    // El valor llega del repo ya con `toFixed(2)`, pero el mensaje no puede depender de eso.
    expect(excesoIndemnizacion("11.00", "10.5")).toBe(msgTopeNegocio("10.50"));
  });
});

describe("un monto NO NUMERICO no es un problema de tope", () => {
  it.each(["", "   ", "abc", "1,50"])("`%s` -> null (lo rechazan el regex y el `> 0`)", (v) => {
    // Devolver aqui un mensaje de tope seria enganoso («no puede superar 9999999999.99» ante
    // «mil colones»). Mismo criterio que el `catch` del refine de `indemnizacionSchema`.
    expect(excesoIndemnizacion(v, "42000.00")).toBeNull();
  });

  it("un `monto_cobrar` ilegible cae al tope tecnico, no bloquea", () => {
    expect(excesoIndemnizacion("5000.00", "no-es-un-numero")).toBeNull();
    expect(excesoIndemnizacion(masUnCentimo(MAX_TECNICO), "no-es-un-numero")).toBe(
      MSG_TOPE_TECNICO,
    );
  });

  it("el monto se compara ya recortado (espacios alrededor no cambian el veredicto)", () => {
    expect(excesoIndemnizacion("  42000.01  ", "42000.00")).toBe(msgTopeNegocio("42000.00"));
  });
});

describe("el tope tecnico sigue derivandose de la columna, no de un numero a ojo", () => {
  it("INDEMNIZACION_MONTO_MAX es el maximo de un DECIMAL(12,2)", () => {
    // Si un dia la columna cambia de precision, este test y el de la 158 caen a la vez y
    // obligan a recalcular, en vez de dejar el tope tecnico mintiendo en silencio.
    expect(MAX_TECNICO).toBe("9999999999.99");
    expect(new Prisma.Decimal(MAX_TECNICO).toFixed(2)).toBe(MAX_TECNICO);
  });
});
