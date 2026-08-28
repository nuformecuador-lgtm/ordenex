import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cargaMasivaConfig } from "@/lib/config/carga-masiva";
import { filaCargaSchema } from "@/lib/types/carga-masiva";
import { cotizacionBodySchema, filaCotizacionSchema } from "@/lib/types/cotizacion";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 255 (T3) — el schema del borde de cotizacion.
 *
 * R7 el MISMO cuerpo que `/carga` sin recortar · R8 el tope de filas ·
 * R9/D5 `num_remision` opcional · R32/R33 `monto_cobrar` como STRING.
 */

/** Una fila tal como se la manda hoy el integrador a `POST /carga`, entera. */
const FILA_DE_CARGA: Record<string, string> = {
  num_remision: "REM-0001",
  destinatario: "Ana Solis",
  telefono: "88888888",
  producto: "Caja de zapatos",
  provincia: "San José",
  canton: "Escazú",
  distrito: "San Rafael",
  direccion: "Multiplaza, local 12",
  notas: "llamar antes",
  monto_cobrar: "25900",
};

/** La misma fila SIN una de sus claves, sin dejar una variable sin usar. */
function sinClave(fila: Record<string, string>, clave: string): Record<string, string> {
  const copia = { ...fila };
  delete copia[clave];
  return copia;
}

function filas(cuantas: number): Record<string, string>[] {
  return Array.from({ length: cuantas }, () => ({ ...FILA_DE_CARGA }));
}

describe("filaCotizacionSchema · acepta el cuerpo de la carga sin recortarlo (R7)", () => {
  it("una fila de `/carga` entera pasa, y las claves extra se ignoran en silencio", () => {
    const parsed = filaCotizacionSchema.safeParse(FILA_DE_CARGA);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.provincia).toBe("San José");
    expect(parsed.data.canton).toBe("Escazú");
    expect(parsed.data.distrito).toBe("San Rafael");
    expect(parsed.data.direccion).toBe("Multiplaza, local 12");
    // Lo que no pide la cotizacion no viaja: no-strict descarta, no rechaza.
    expect(Object.keys(parsed.data).sort()).toEqual([
      "canton",
      "direccion",
      "distrito",
      "monto_cobrar",
      "num_remision",
      "provincia",
    ]);
  });

  it("exige la terna geografica y nombra el campo que falta", () => {
    for (const campo of ["provincia", "canton", "distrito"]) {
      const fila = { ...FILA_DE_CARGA, [campo]: "" };
      const parsed = filaCotizacionSchema.safeParse(fila);
      expect(parsed.success, `${campo} vacio deberia fallar`).toBe(false);
    }
  });
});

describe("filaCotizacionSchema · `num_remision` es OPCIONAL (R9, decision D5)", () => {
  it("acepta una fila SIN `num_remision`", () => {
    const parsed = filaCotizacionSchema.safeParse(sinClave(FILA_DE_CARGA, "num_remision"));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.num_remision).toBeUndefined();
  });

  it("lo devuelve tal cual cuando viene, y trata el vacio como ausente", () => {
    expect(filaCotizacionSchema.parse(FILA_DE_CARGA).num_remision).toBe("REM-0001");
    expect(
      filaCotizacionSchema.parse({ ...FILA_DE_CARGA, num_remision: "  " }).num_remision,
    ).toBeUndefined();
  });
});

describe("filaCotizacionSchema · `monto_cobrar` se conserva como STRING (R32, R33)", () => {
  it("un entero pasa TAL CUAL, y sigue siendo un string", () => {
    // El TRANSPORTE no cambia con la ficha 305: sigue sin convertirse a numero en el borde,
    // porque es la base de la comision COD y viaja hasta un `Prisma.Decimal`.
    for (const valor of ["0", "25900", "99999999999"]) {
      const parsed = filaCotizacionSchema.parse({ ...FILA_DE_CARGA, monto_cobrar: valor });
      expect(parsed.monto_cobrar).toBe(valor);
      expect(typeof parsed.monto_cobrar).toBe("string");
    }
  });

  it("FICHA 305 · un monto con centimos sale REDONDEADO al colon, como en la carga", () => {
    // ESTE ASERTO ES EL CONTRATO NUEVO, y sustituye a propósito al «pasa tal cual» que estaba
    // aqui hasta la 305. Hasta esa fecha la cotizacion calculaba el precio sobre el monto EXACTO
    // mientras la carga persistia el REDONDEADO (feature 299): quien cotizaba `11898.81` recibia
    // la comision de `11898.81` y despues se le cobraba la de `11899`. Dos cifras que no cuadran
    // en un endpoint que publica un PRECIO.
    const casos: readonly [string, string][] = [
      ["11898.81", "11899"], // el caso real de la captura del 2026-08-27
      ["25900.50", "25901"], // el medio SUBE (half away from zero sobre un monto no negativo)
      ["25900.49", "25900"],
      ["0.5", "1"],
      ["0.49", "0"],
      ["99999999999.51", "100000000000"],
    ];
    for (const [entra, sale] of casos) {
      const parsed = filaCotizacionSchema.parse({ ...FILA_DE_CARGA, monto_cobrar: entra });
      expect(parsed.monto_cobrar, `${entra} deberia cotizar sobre ${sale}`).toBe(sale);
      expect(typeof parsed.monto_cobrar).toBe("string");
    }
  });

  it("FICHA 305 · el numero que sale es EL MISMO que persiste la carga", () => {
    // La comprobacion que da sentido a la de arriba: no basta con que la cotizacion redondee,
    // tiene que redondear a LO MISMO que se va a cobrar. Se contrasta contra `filaCargaSchema`,
    // que es la puerta que decide el valor persistido — no contra una constante escrita a mano
    // ni contra la funcion que la propia cotizacion usa (eso estaria verde por construccion).
    for (const monto of ["11898.81", "25900.50", "25900.49", "0.5", "0.49", "0", "7"]) {
      const cotizado = filaCotizacionSchema.parse({
        ...FILA_DE_CARGA,
        monto_cobrar: monto,
      }).monto_cobrar;
      const cargado = filaCargaSchema.parse({
        ...FILA_DE_CARGA,
        canton_distrito: "Escazú (San Rafael)",
        monto_cobrar: monto,
      }).monto_cobrar;
      expect(String(cotizado), `la cotizacion y la carga discrepan en ${monto}`).toBe(
        String(cargado),
      );
    }
  });

  it("R32 · vacio o ausente -> null (la base de la comision sera cero)", () => {
    expect(filaCotizacionSchema.parse({ ...FILA_DE_CARGA, monto_cobrar: "" }).monto_cobrar).toBe(
      null,
    );
    expect(filaCotizacionSchema.parse(sinClave(FILA_DE_CARGA, "monto_cobrar")).monto_cobrar).toBe(
      null,
    );
  });

  it("rechaza lo que no es un decimal no negativo", () => {
    for (const valor of ["-1", "abc", "1,5", "1.2.3", "1e3", "1.2e3", "+1"]) {
      expect(
        filaCotizacionSchema.safeParse({ ...FILA_DE_CARGA, monto_cobrar: valor }).success,
        `"${valor}" no deberia pasar`,
      ).toBe(false);
    }
  });

  it("ESTRUCTURAL · el modulo no convierte el importe a numero en ningun punto", () => {
    // Sobre el CODIGO, no sobre la prosa: el docstring nombra `Number(` a
    // proposito para decir que aqui no se usa.
    const fuente = quitarComentarios(
      readFileSync(path.resolve(__dirname, "../../../lib/types/cotizacion.ts"), "utf8"),
    );
    for (const prohibido of ["Number(", "parseFloat(", "parseInt("]) {
      expect(fuente, `lib/types/cotizacion.ts usa ${prohibido} sobre dinero`).not.toContain(
        prohibido,
      );
    }
  });
});

describe("cotizacionBodySchema · el tope de filas (R8)", () => {
  it("acepta el cuerpo de `/carga` sin recortar, con sus columnas extra", () => {
    const parsed = cotizacionBodySchema.safeParse({
      ordenes: filas(2),
      name: "lote de prueba",
      download_type: "individual",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.ordenes).toHaveLength(2);
    expect(parsed.data.ordenes[0].destinatario).toBe("Ana Solis");
  });

  it("rechaza un lote vacio", () => {
    expect(cotizacionBodySchema.safeParse({ ordenes: [] }).success).toBe(false);
  });

  it("rechaza un lote por encima de `cargaMasivaConfig.MAX_CHUNK_ROWS`", () => {
    const tope = cargaMasivaConfig.MAX_CHUNK_ROWS;
    expect(cotizacionBodySchema.safeParse({ ordenes: filas(tope) }).success).toBe(true);
    expect(cotizacionBodySchema.safeParse({ ordenes: filas(tope + 1) }).success).toBe(false);
  });

  it("rechaza un cuerpo sin `ordenes`", () => {
    expect(cotizacionBodySchema.safeParse({}).success).toBe(false);
  });
});
