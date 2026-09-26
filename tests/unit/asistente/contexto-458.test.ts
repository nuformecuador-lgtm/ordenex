import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contextoPara } from "@/lib/asistente/contexto";
import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { partirFrontmatter } from "@/lib/ayuda/frontmatter";
import type { RolValue } from "@prisma/client";

const DIR_AYUDA = path.resolve(__dirname, "../../..", "docs", "ayuda");

/**
 * FICHA 458 — la ayuda y el asistente al dia, un bloque por hija (tasks.md, «Reglas que valen para
 * TODAS las hijas»). Molde: `contexto-457.test.ts`.
 *
 * Bloque B (458-B, revision m3): la hija deja VISIBLE en `/wallet` «Anular…» en la indemnizacion por
 * un incidente y en las dos lineas del cobro por rechazo a una tienda, y la analitica descuenta esa
 * anulacion (B2). Las frases son LITERALES a proposito: son el contrato de lo que el asistente tiene
 * que poder explicar a la oficina, y no llegan a la tienda, al mensajero ni a la bodega.
 */

const docs = await leerCatalogoAyuda();

function plano(texto: string): string {
  return texto.replace(/\s+/g, " ");
}

function cuerpoEnContexto(rol: RolValue, slug: string): string {
  const doc = contextoPara(docs, rol).find((d) => d.slug === slug);
  if (doc === undefined) throw new Error(`${rol} no recibe ${slug}`);
  return plano(doc.cuerpo);
}

const OFICINA: RolValue[] = ["maestro", "admin"];

describe("458-B — la oficina puede preguntar por la anulacion del cobro por rechazo y de la indemnizacion", () => {
  it.each(OFICINA)("%s: la caja dice que se anulan, como, y que la analitica lo descuenta", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("Tampoco un **cobro por rechazo a una tienda** ni una **indemnización por un incidente**.");
    expect(caja).toContain("se anula desde **cualquiera de las dos** y se anulan **las dos juntas**");
    expect(caja).toContain("**Flete por rechazo cobrado a la tienda anulado**");
    expect(caja).toContain("**IVA del flete por rechazo cobrado a la tienda anulado**");
    expect(caja).toContain(
      "En **Analítica**, «Ingreso por flete» e «Ingreso por IVA» descuentan la anulación: el **neto** vuelve a ser el de antes del cobro.",
    );
    expect(caja).toContain("Al anular una **indemnización**, aparece una **Corrección de caja (suma)** por el mismo monto");
  });

  it("la caja NO llega a la tienda, al mensajero ni a la bodega", () => {
    for (const rol of ["adminTienda", "mensajero", "adminSatelite"] as RolValue[]) {
      expect(contextoPara(docs, rol).map((d) => d.slug)).not.toContain("oficina/wallet-caja");
    }
  });

  it("oficina/wallet-caja: actualizado el 2026-09-26 y con las fuentes de la anulacion", () => {
    const doc = docs.find((d) => d.slug === "oficina/wallet-caja");
    expect(doc?.actualizado).toBe("2026-09-26");
    const crudo = readFileSync(path.join(DIR_AYUDA, "oficina/wallet-caja.md"), "utf8");
    const declaradas = partirFrontmatter(crudo).datos.fuentes ?? [];
    for (const fuente of [
      "lib/services/RechazoTiendaCobroService.ts",
      "lib/services/EgresoCajaAnulacionService.ts",
      "lib/actions/wallet-anulacion.ts",
      "app/(app)/wallet/_components/DocumentoCajaAcciones.tsx",
    ]) {
      expect(declaradas, `wallet-caja sin ${fuente}`).toContain(fuente);
    }
  });
});
