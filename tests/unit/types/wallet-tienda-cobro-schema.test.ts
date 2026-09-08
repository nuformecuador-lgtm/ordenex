import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  registrarCobroTiendaSchema,
  type RegistrarCobroTiendaInput,
} from "@/lib/types/wallet-tienda";
import { primerDiaMovimientoAdmisible } from "@/lib/types/wallet";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 381 / T A.2 — el BORDE del cobro manual a una tienda (R14/R15/R16/R18).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ LAS EXPECTATIVAS SON LITERALES, NO DERIVADAS DEL SCHEMA. Un test que preguntara al propio
// schema que considera valido estaria siempre verde (la leccion de «asercion contra su propia
// fuente», medida en este repo). Aqui los montos, los mensajes y los limites se escriben a mano:
// aflojar el regex del monto —p. ej. admitir tres decimales o un negativo— pone ESTE archivo rojo.
//
// La UNICA fecha que se calcula en vez de escribirse es «hoy» y el primer dia admisible, y no hay
// alternativa: son moviles por definicion. Lo que se afirma sobre ellas SI es literal (que hoy pasa,
// que mañana no, y que el dia anterior al primero admisible no).

const TIENDA = "0b1e6f1a-6d3a-4c6e-9c8f-3a1c9d2b7e55";

function base(over: Partial<Record<string, unknown>> = {}) {
  return { tiendaId: TIENDA, monto: "1500.00", descripcion: "Reposicion de etiquetas", ...over };
}

describe("381/A.2 — lo que el borde ACEPTA", () => {
  it("un cobro minimo valido pasa, y el monto sigue siendo el MISMO STRING (R18)", () => {
    const r = registrarCobroTiendaSchema.safeParse(base());
    expect(r.success).toBe(true);
    const datos = r.data as RegistrarCobroTiendaInput;
    // ⚠️ SIGUE SIENDO UN STRING: si alguien metiera un `z.coerce.number()` o un `transform` con
    // `Number()`, esta linea se pone roja. Es la mitad del borde de R18 que vive aqui; la otra
    // mitad —que lo que se persiste es exactamente esto— vive contra Postgres.
    expect(typeof datos.monto).toBe("string");
    expect(datos.monto).toBe("1500.00");
    expect(datos.fecha).toBeUndefined(); // R21: sin fecha, la clave no viaja
  });

  it("recorta los espacios de la descripcion pero conserva su texto (R15)", () => {
    const r = registrarCobroTiendaSchema.safeParse(base({ descripcion: "  Caja de cintas  " }));
    expect(r.success).toBe(true);
    expect((r.data as RegistrarCobroTiendaInput).descripcion).toBe("Caja de cintas");
  });

  it.each(["1", "0.01", "1500", "1500.5", "1500.50", "99999999.99"])(
    "acepta el monto %s",
    (monto) => {
      expect(registrarCobroTiendaSchema.safeParse(base({ monto })).success).toBe(true);
    },
  );

  it("acepta HOY como fecha del cobro (R16)", () => {
    const hoy = fechaCalendarioCR(new Date());
    expect(registrarCobroTiendaSchema.safeParse(base({ fecha: hoy })).success).toBe(true);
  });
});

describe("381/A.2 — lo que el borde RECHAZA (R14/R15/R16)", () => {
  /** Los mensajes bajo un campo concreto del resultado. */
  function erroresDe(entrada: unknown, campo: string): string[] {
    const r = registrarCobroTiendaSchema.safeParse(entrada);
    expect(r.success).toBe(false);
    if (r.success) return [];
    const porCampo = z.flattenError(r.error).fieldErrors as Record<string, string[] | undefined>;
    return porCampo[campo] ?? [];
  }

  it.each([
    ["vacio", ""],
    ["cero", "0"],
    ["cero con decimales", "0.00"],
    ["negativo", "-100.00"],
    ["tres decimales", "1500.005"],
    ["con separador de miles", "1,500.00"],
    ["con simbolo", "₡1500"],
    ["texto", "mil quinientos"],
    ["notacion cientifica", "1e3"],
    ["espacios en medio", "15 00"],
  ])("rechaza el monto %s (R14)", (_caso, monto) => {
    // ⚠️ SIN `toEqual` sobre el numero de mensajes: zod v4 corre los refines aunque el regex ya
    // haya fallado, asi que algunos casos emiten dos. Lo que se afirma es lo que importa: que NO
    // pasa, y que el fallo se atribuye al campo `monto`.
    expect(erroresDe(base({ monto }), "monto").length).toBeGreaterThan(0);
  });

  it.each([["vacia", ""], ["solo espacios", "   "], ["tabuladores", "\t\t"]])(
    "rechaza la descripcion %s (R15)",
    (_caso, descripcion) => {
      expect(erroresDe(base({ descripcion }), "descripcion")).toContain(
        "La descripcion es obligatoria.",
      );
    },
  );

  it("rechaza una fecha que no existe en el calendario (R16)", () => {
    expect(erroresDe(base({ fecha: "2026-02-31" }), "fecha")).toContain(
      "Esa fecha no existe en el calendario.",
    );
  });

  it("rechaza una fecha posterior a hoy, con el MISMO texto que los otros cuatro conceptos (R16)", () => {
    const manana = new Date(Date.now() + 36 * 60 * 60 * 1000);
    expect(erroresDe(base({ fecha: fechaCalendarioCR(manana) }), "fecha")).toContain(
      "La fecha no puede ser posterior a hoy.",
    );
  });

  it("rechaza una fecha anterior a la ventana admisible, nombrando el primer dia (R16)", () => {
    const primero = primerDiaMovimientoAdmisible();
    const anterior = new Date(`${primero}T12:00:00.000Z`);
    anterior.setUTCDate(anterior.getUTCDate() - 1);
    const fuera = anterior.toISOString().slice(0, 10);
    // El texto lo produce `problemaDeFechaMovimiento`, que es la MISMA fuente que ven los cuatro
    // conceptos de caja. Si esta ficha estrenara un quinto mensaje, esto se pondria rojo.
    expect(erroresDe(base({ fecha: fuera }), "fecha")).toContain(
      `No se admiten movimientos anteriores al ${primero}.`,
    );
  });

  it("rechaza un `tiendaId` que no es un uuid (R17, primera barrera)", () => {
    expect(erroresDe(base({ tiendaId: "tienda-1" }), "tiendaId").length).toBeGreaterThan(0);
    expect(erroresDe(base({ tiendaId: "" }), "tiendaId").length).toBeGreaterThan(0);
  });

  it("rechaza la peticion SIN tienda: no hay cobro sin destinataria (R7/R17)", () => {
    const r = registrarCobroTiendaSchema.safeParse({
      monto: "100.00",
      descripcion: "algo",
    });
    expect(r.success).toBe(false);
  });
});

describe("381/A.2 — `.strict()`: el cliente NO elige donde cae su propio cobro", () => {
  it.each(["tipo", "categoria", "registradoPor", "origenTipo", "origenId"])(
    "una clave `%s` colada muere en el borde",
    (clave) => {
      const r = registrarCobroTiendaSchema.safeParse(base({ [clave]: "loQueSea" }));
      // Es la barrera que impide que la peticion dicte la categoria del asiento: sin `.strict()`,
      // zod ignoraria la clave en silencio y quedaria a merced de que nadie la lea nunca.
      expect(r.success).toBe(false);
    },
  );
});
