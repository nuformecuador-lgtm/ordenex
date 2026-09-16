import { describe, expect, it } from "vitest";

import { CASOS_SINPE, SINPE_INVALIDOS, SINPE_VALIDOS } from "@/tests/fixtures/sinpe-casos";
import {
  MSG_SINPE_NOMBRE_VACIO,
  MSG_SINPE_NUMERO_INVALIDO,
  esSinpeNumeroValido,
  normalizarSinpeNumero,
  sinpeNombreSchema,
  sinpeNumeroONull,
  sinpeNumeroSchema,
} from "@/lib/utils/sinpe-cr";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T1 — R7, R8 y R9 contra el VALIDADOR de la aplicacion.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LA MISMA TABLA (`tests/fixtures/sinpe-casos.ts`) se corre contra el `CHECK` de Postgres en
// `tests/integration/db/zona-sinpe-migration.test.ts`. Los dos jueces tienen que dar el mismo
// veredicto: es la unica defensa contra que las dos fuentes del formato se separen.

describe("429/R7 — el formato: ocho digitos que empiezan por 6, 7 u 8", () => {
  it.each(CASOS_SINPE.map((c) => [c.entrada, c.normalizado, c.motivo] as const))(
    "%j -> %j (%s)",
    (entrada, esperado) => {
      expect(sinpeNumeroONull(entrada)).toBe(esperado);
    },
  );

  it("la tabla tiene casos de las dos clases (anti-vacuidad del `it.each`)", () => {
    // Sin esto, una tabla que se quedara sin invalidos dejaria los casos de arriba en verde
    // sin haber comprobado ni un rechazo.
    expect(SINPE_VALIDOS.length).toBeGreaterThan(3);
    expect(SINPE_INVALIDOS.length).toBeGreaterThan(3);
  });

  it("`esSinpeNumeroValido` NO normaliza: juzga lo que se le da", () => {
    // Es el predicado que se le aplica a lo que YA se va a guardar. Si normalizara por dentro,
    // un valor con separadores pasaria la validacion y se escribiria con ellos.
    expect(esSinpeNumeroValido("8888 1111")).toBe(false);
    expect(esSinpeNumeroValido("88881111")).toBe(true);
  });
});

describe("429/R9 — la normalizacion, y lo que NO normaliza", () => {
  it.each([
    ["8888 1111", "88881111"],
    ["8888-1111", "88881111"],
    ["8888.1111", "88881111"],
    ["(8888) 1111", "88881111"],
    ["+506 88881111", "88881111"],
    ["+50688881111", "88881111"],
    ["50688881111", "88881111"],
    ["0050688881111", "88881111"],
  ])("%j se guarda como %j, nunca con separadores", (entrada, esperado) => {
    expect(normalizarSinpeNumero(entrada)).toBe(esperado);
    expect(sinpeNumeroSchema.parse(entrada)).toBe(esperado);
  });

  it("⚠️ `50612345` NO pierde su prefijo aunque empiece por `506`", () => {
    // Ocho digitos: el `506` de delante NO es prefijo de pais, es parte del numero. Se rechaza
    // igual (la serie 5 no es movil), pero por el PRIMER DIGITO y con el dato intacto — no
    // convertido en `12345` y rechazado por longitud, que esconderia lo que la persona escribio.
    expect(normalizarSinpeNumero("50612345")).toBe("50612345");
    expect(sinpeNumeroONull("50612345")).toBeNull();
  });

  it("⚠️ `50688881111` SI pierde el prefijo: once digitos y ocho detras de `506`", () => {
    expect(normalizarSinpeNumero("50688881111")).toBe("88881111");
  });

  it("un numero invalido NO se guarda tal cual: el esquema lo rechaza con el formato esperado", () => {
    const r = sinpeNumeroSchema.safeParse("8123456a");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe(MSG_SINPE_NUMERO_INVALIDO);
  });
});

describe("429/R8 — el titular no puede estar vacio ni ser espacios", () => {
  it.each(["", "   ", "\t\n"])("%j se rechaza", (entrada) => {
    const r = sinpeNombreSchema.safeParse(entrada);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe(MSG_SINPE_NOMBRE_VACIO);
  });

  it("recorta los espacios de los bordes antes de guardar", () => {
    expect(sinpeNombreSchema.parse("  Titular de Prueba  ")).toBe("Titular de Prueba");
  });

  it("rechaza mas de 60 caracteres, que es el ancho de la columna", () => {
    expect(sinpeNombreSchema.safeParse("x".repeat(61)).success).toBe(false);
    expect(sinpeNombreSchema.safeParse("x".repeat(60)).success).toBe(true);
  });
});
