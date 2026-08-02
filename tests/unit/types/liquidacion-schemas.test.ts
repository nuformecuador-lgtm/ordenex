import { describe, it, expect } from "vitest";
import {
  anularPagoSchema,
  esFechaPagoValida,
  LIQUIDACION_MONTO_MAX,
  LIQUIDACION_NOTA_MAX,
  LIQUIDACION_REFERENCIA_MAX,
  registrarPagoMensajeroSchema,
  registrarPagoTiendaSchema,
} from "@/lib/types/liquidacion";
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// Feature 172 / T A.3 — el BORDE de la liquidacion. Cubre R8 (catalogo de metodos), R10 (fecha
// no futura en hora de Costa Rica), R11 (monto), R12 (referencia obligatoria en pago
// electronico, [P6]), R13 (tope de la nota), R15 (comprobante SOLO texto: ningun adjunto,
// [P7]) y R72 (motivo de anulacion no vacio).
//
// Money-safe: en este archivo no hay ni un `Number(` ni un `parseFloat` sobre un monto. Los
// montos se escriben y se comparan como STRING, que es como viajan (R14).

const CIERRE = "11111111-1111-4111-8111-111111111111";
const TIENDA = "22222222-2222-4222-8222-222222222222";
const CLAVE = "33333333-3333-4333-8333-333333333333";
const PAGO = "44444444-4444-4444-8444-444444444444";

// "Hoy" fijo para los casos de fecha, con su ayer y su mañana en calendario de Costa Rica.
const AHORA = new Date("2026-08-02T18:00:00.000Z"); // 12:00 del 2 de agosto en CR
const HOY = "2026-08-02";
const AYER = "2026-08-01";
const MANANA = "2026-08-03";

function pagoTiendaValido(extra: Record<string, unknown> = {}) {
  return {
    claveIdempotencia: CLAVE,
    tiendaId: TIENDA,
    monto: "12500.75",
    metodo: "efectivo",
    fechaPago: AYER,
    ...extra,
  };
}

function pagoMensajeroValido(extra: Record<string, unknown> = {}) {
  return {
    claveIdempotencia: CLAVE,
    cierreId: CIERRE,
    monto: "12500.75",
    metodo: "efectivo",
    fechaPago: AYER,
    ...extra,
  };
}

/** Los campos que fallaron, para afirmar que el error llega POR CAMPO y no como un genérico. */
function camposConError(resultado: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  if (resultado.success || !resultado.error) return [];
  return resultado.error.issues.map((i) => i.path.join("."));
}

describe("R8 — el metodo de pago es el catalogo existente, no uno propio", () => {
  it.each(METODO_PAGO_SEED)("acepta el metodo %s", (metodo) => {
    // En SINPE/transferencia la referencia es obligatoria (R12): se acompana para aislar R8.
    const r = registrarPagoTiendaSchema.safeParse(
      pagoTiendaValido({ metodo, referencia: "1234567" }),
    );
    expect(r.success).toBe(true);
  });

  it.each([
    ["un metodo fuera del catalogo", "tarjeta"],
    ["el mismo valor con otra caja", "sinpe"],
    ["cadena vacia", ""],
  ])("rechaza %s con el error en el campo `metodo`", (_caso, metodo) => {
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ metodo }));
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("metodo");
  });
});

describe("R10 — la fecha real del pago no puede ser futura en hora de Costa Rica", () => {
  it("acepta hoy y acepta una fecha pasada", () => {
    expect(esFechaPagoValida(HOY, AHORA)).toBe(true);
    expect(esFechaPagoValida(AYER, AHORA)).toBe(true);
    expect(registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ fechaPago: AYER })).success).toBe(
      true,
    );
  });

  it("rechaza mañana, con el error en el campo `fechaPago`", () => {
    expect(esFechaPagoValida(MANANA, AHORA)).toBe(false);
    const r = registrarPagoTiendaSchema.safeParse(
      pagoTiendaValido({ fechaPago: fechaCalendarioCR(new Date(Date.now() + 86_400_000)) }),
    );
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("fechaPago");
  });

  it("usa el dia de COSTA RICA, no el de UTC: a las 20:00 CR sigue siendo el mismo dia", () => {
    // 2026-08-03T02:00Z son las 20:00 del 2 de agosto en CR. En UTC ya es dia 3, asi que un
    // borde que comparase contra `new Date().toISOString()` aceptaria el 3 como "hoy".
    const veinteHorasCR = new Date("2026-08-03T02:00:00.000Z");
    expect(esFechaPagoValida(HOY, veinteHorasCR)).toBe(true);
    expect(esFechaPagoValida(MANANA, veinteHorasCR)).toBe(false);
  });

  it.each([
    ["un dia inexistente", "2026-02-31"],
    ["un mes inexistente", "2026-13-01"],
    ["formato con barras", "02/08/2026"],
    ["fecha con hora", "2026-08-01T10:00:00.000Z"],
    ["cadena vacia", ""],
  ])("rechaza %s", (_caso, fechaPago) => {
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ fechaPago }));
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("fechaPago");
  });

  it("un dia desbordado NO da Invalid Date en V8: hace falta el round-trip para cazarlo", () => {
    // Deja constancia del motivo por el que `esFechaPagoValida` compara el ISO de vuelta. Si
    // algun dia V8 cambiara y devolviera Invalid Date, este test lo dira.
    expect(new Date("2026-02-31T00:00:00.000Z").toISOString().slice(0, 10)).toBe("2026-03-03");
    expect(esFechaPagoValida("2026-02-31", AHORA)).toBe(false);
  });
});

describe("R11 — el monto: STRING, mayor que cero, 2 decimales y dentro de la columna", () => {
  it("el tope sale de la precision de la columna DECIMAL(12,2): 10 digitos enteros", () => {
    expect(LIQUIDACION_MONTO_MAX).toBe("9999999999.99");
  });

  it("FRONTERA: el maximo EXACTO se acepta y un centimo mas se rechaza", () => {
    expect(
      registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ monto: LIQUIDACION_MONTO_MAX })).success,
    ).toBe(true);
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ monto: "10000000000.00" }));
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("monto");
  });

  it.each([
    ["cero", "0"],
    ["cero con decimales", "0.00"],
    ["negativo", "-100.00"],
    ["tres decimales", "10.005"],
    ["con coma decimal", "10,50"],
    ["con separador de miles", "1,000.00"],
    ["once digitos enteros", "12345678901.00"],
    ["vacio", ""],
    ["solo espacios", "   "],
    ["no numerico", "mil colones"],
    ["notacion cientifica", "1e3"],
    ["con simbolo de moneda", "₡100.00"],
  ])("rechaza el monto %s con el error en el campo `monto`", (_caso, monto) => {
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ monto }));
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("monto");
  });

  it("R14: un monto NUMBER se rechaza; no hay coercion a string en la frontera", () => {
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ monto: 12500.75 }));
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("monto");
  });

  it("R14: tras parsear, el monto sigue siendo el MISMO string (sin normalizar ni redondear)", () => {
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ monto: "0.01" }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.monto).toBe("0.01");
      expect(typeof r.data.monto).toBe("string");
    }
  });
});

describe("R12 [P6] — la referencia es obligatoria en SINPE y transferencia", () => {
  it.each(["SINPE", "transferencia"])("rechaza %s sin referencia, en el campo `referencia`", (metodo) => {
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ metodo }));
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("referencia");
  });

  it.each(["SINPE", "transferencia"])("rechaza %s con referencia en blanco", (metodo) => {
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ metodo, referencia: "   " }));
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("referencia");
  });

  it.each(["SINPE", "transferencia"])("acepta %s con referencia", (metodo) => {
    const r = registrarPagoTiendaSchema.safeParse(
      pagoTiendaValido({ metodo, referencia: "  1234567  " }),
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.referencia).toBe("1234567");
  });

  it("en efectivo la referencia es OPCIONAL: sin ella el pago es valido", () => {
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ metodo: "efectivo" }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.referencia).toBeUndefined();
  });
});

describe("R13 — la nota es libre, opcional y acotada", () => {
  it("acepta la ausencia de nota y una nota normal", () => {
    expect(registrarPagoTiendaSchema.safeParse(pagoTiendaValido()).success).toBe(true);
    const r = registrarPagoTiendaSchema.safeParse(
      pagoTiendaValido({ nota: "Entregado en bodega central." }),
    );
    expect(r.success).toBe(true);
  });

  it("FRONTERA: el tope EXACTO se acepta y un caracter mas se rechaza, en el campo `nota`", () => {
    const alTope = "n".repeat(LIQUIDACION_NOTA_MAX);
    expect(registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ nota: alTope })).success).toBe(
      true,
    );
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ nota: `${alTope}n` }));
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("nota");
  });
});

describe("R12 — la referencia tambien esta acotada (desviacion declarada del diseño)", () => {
  // `design.md §3.2` fija tope para la `nota` y calla sobre la `referencia`. Lo cierra el
  // leader (2026-08-02): es texto libre de usuario contra una columna `text` en un libro de
  // dinero. El numero sale de la convencion del repo para un identificador corto tecleado por
  // una persona (`lib/types/api-key.ts:17`, 60 caracteres), no de un ojo a bulto.
  it("FRONTERA: el tope EXACTO se acepta y un caracter mas se rechaza, en el campo `referencia`", () => {
    const alTope = "9".repeat(LIQUIDACION_REFERENCIA_MAX);
    expect(
      registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ metodo: "SINPE", referencia: alTope }))
        .success,
    ).toBe(true);

    const r = registrarPagoTiendaSchema.safeParse(
      pagoTiendaValido({ metodo: "SINPE", referencia: `${alTope}9` }),
    );
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("referencia");
  });

  it("el tope se mide DESPUES de recortar los espacios (el `.trim()` corre antes)", () => {
    // Con el orden al reves, una referencia legitima rodeada de espacios se rechazaria.
    const conEspacios = `  ${"9".repeat(LIQUIDACION_REFERENCIA_MAX)}  `;
    const r = registrarPagoTiendaSchema.safeParse(
      pagoTiendaValido({ metodo: "SINPE", referencia: conEspacios }),
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.referencia).toHaveLength(LIQUIDACION_REFERENCIA_MAX);
  });

  it("una referencia real (SINPE, transferencia) cabe de sobra", () => {
    for (const referencia of ["1234567", "SINPE-2026-07-30-0001", "TRF 998877665544"]) {
      const r = registrarPagoTiendaSchema.safeParse(
        pagoTiendaValido({ metodo: "transferencia", referencia }),
      );
      expect(r.success, `rechazo la referencia "${referencia}"`).toBe(true);
    }
  });

  it("el tope aplica igual al pago al MENSAJERO (es el mismo bloque de campos)", () => {
    const r = registrarPagoMensajeroSchema.safeParse(
      pagoMensajeroValido({ metodo: "SINPE", referencia: "9".repeat(LIQUIDACION_REFERENCIA_MAX + 1) }),
    );
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("referencia");
  });

  it("el tope de la referencia y el de la nota son numeros DISTINTOS y no se confunden", () => {
    // Un identificador corto y un texto libre no comparten limite. Si alguien igualara los dos
    // valores, esta asercion lo dice en voz alta.
    expect(LIQUIDACION_REFERENCIA_MAX).toBeLessThan(LIQUIDACION_NOTA_MAX);
    const entreLosDos = "x".repeat(LIQUIDACION_REFERENCIA_MAX + 1);
    // Cabe como nota…
    expect(
      registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ nota: entreLosDos })).success,
    ).toBe(true);
    // …y no como referencia.
    expect(
      registrarPagoTiendaSchema.safeParse(
        pagoTiendaValido({ metodo: "SINPE", referencia: entreLosDos }),
      ).success,
    ).toBe(false);
  });
});

describe("R15 [P7] — el comprobante es SOLO texto: ningun adjunto entra", () => {
  it.each([
    ["comprobante", { comprobante: "data:image/png;base64,AAAA" }],
    ["archivo", { archivo: "recibo.pdf" }],
    ["adjunto", { adjunto: { nombre: "recibo.pdf", contenido: "AAAA" } }],
    ["evidencias", { evidencias: ["data:image/png;base64,AAAA"] }],
    ["comprobanteUrl", { comprobanteUrl: "https://ejemplo.test/recibo.pdf" }],
  ])("rechaza la clave desconocida `%s`", (_caso, extra) => {
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido(extra));
    expect(r.success).toBe(false);
  });

  it("`.strict()` tambien protege el pago al mensajero y la anulacion", () => {
    expect(
      registrarPagoMensajeroSchema.safeParse(pagoMensajeroValido({ comprobante: "x" })).success,
    ).toBe(false);
    expect(
      anularPagoSchema.safeParse({ pagoId: PAGO, motivo: "Monto equivocado", comprobante: "x" })
        .success,
    ).toBe(false);
  });
});

describe("R21/R29 — cada pago va contra lo suyo, y el borde no los deja mezclar", () => {
  it("el pago al mensajero exige el cierre; sin el, se rechaza en el campo `cierreId`", () => {
    const { cierreId: _sinCierre, ...sinCierre } = pagoMensajeroValido();
    void _sinCierre;
    const r = registrarPagoMensajeroSchema.safeParse(sinCierre);
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("cierreId");
  });

  it("el pago a la tienda NO admite cierre: colarlo es `validation_error`", () => {
    const r = registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ cierreId: CIERRE }));
    expect(r.success).toBe(false);
  });

  it("un cierreId o un tiendaId que no son uuid se rechazan en su campo", () => {
    expect(camposConError(registrarPagoMensajeroSchema.safeParse(pagoMensajeroValido({ cierreId: "c1" })))).toContain(
      "cierreId",
    );
    expect(camposConError(registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ tiendaId: "t1" })))).toContain(
      "tiendaId",
    );
  });

  it("la clave de idempotencia es un uuid: sin ella o mal formada, se rechaza", () => {
    const { claveIdempotencia: _sinClave, ...sinClave } = pagoTiendaValido();
    void _sinClave;
    expect(camposConError(registrarPagoTiendaSchema.safeParse(sinClave))).toContain(
      "claveIdempotencia",
    );
    expect(
      camposConError(registrarPagoTiendaSchema.safeParse(pagoTiendaValido({ claveIdempotencia: "k1" }))),
    ).toContain("claveIdempotencia");
  });
});

describe("R72 — anular exige un motivo no vacio, y NO admite monto", () => {
  it("acepta un motivo con texto y lo recorta", () => {
    const r = anularPagoSchema.safeParse({ pagoId: PAGO, motivo: "  Monto equivocado  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.motivo).toBe("Monto equivocado");
  });

  it.each([
    ["ausente", undefined],
    ["vacio", ""],
    ["solo espacios", "   "],
    ["solo saltos de linea", "\n\n"],
  ])("rechaza el motivo %s con el error en el campo `motivo`", (_caso, motivo) => {
    const r = anularPagoSchema.safeParse({ pagoId: PAGO, motivo });
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain("motivo");
  });

  it("R70: un monto colado en la peticion de anulacion NO pasa el borde", () => {
    const r = anularPagoSchema.safeParse({ pagoId: PAGO, motivo: "Monto equivocado", monto: "1.00" });
    expect(r.success).toBe(false);
  });

  it("el pagoId debe ser uuid", () => {
    expect(camposConError(anularPagoSchema.safeParse({ pagoId: "p1", motivo: "x" }))).toContain(
      "pagoId",
    );
  });
});
