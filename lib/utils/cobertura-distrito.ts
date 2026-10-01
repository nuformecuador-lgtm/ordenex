// Ficha 465 (design §3.3) — LA regla de cobertura por distrito, escrita una sola vez.
//
// Se construye ENCIMA de las reglas que ya existen, no las copia:
//   - zona unica: `zonaUnicaDeDistrito` (colapso 1/0/>1 que usa la carga de ordenes);
//   - disponibilidad: llega ya calculada por el repositorio con `disponibleDesdeCadena`;
//   - precedencia de motivos: la de `resolveGeo` (provincia -> canton -> distrito -> zona). La
//     equivalencia la fija `tests/unit/utils/cobertura-vs-resolve-geo.test.ts` (R15): si
//     `resolveGeo` gana una regla nueva, ese test se pone rojo en vez de que el Excel mienta.
//
// Funcion PURA: sin Prisma, sin React, sin textos de UI.
import type { DistritoCoberturaRow } from "@/lib/interfaces/repositories/ICoberturaRepository";
import { zonaUnicaDeDistrito } from "@/lib/repositories/_shared/zona-colapso";
import type { CoberturaDistritoDTO, MotivoSinCobertura } from "@/lib/types/cobertura";

/** Orden alfabetico español sin distinguir mayusculas ni tildes (R6, R11). */
function compararTexto(a: string, b: string): number {
  return a.localeCompare(b, "es", { sensitivity: "base" });
}

/** La PRIMERA causa que aplique, en el orden de R9 / `resolveGeo`. `null` = con cobertura. */
function motivoDe(row: DistritoCoberturaRow): MotivoSinCobertura | null {
  if (!row.provincia.activo) return "provincia_retirada";
  if (!row.canton.activo) return "canton_retirado";
  if (!row.distrito.activo) return "distrito_retirado";
  if (row.zonas.length === 0) return "sin_zona";
  if (zonaUnicaDeDistrito(row.zonas) === null) return "varias_zonas";
  return null;
}

export function clasificarCobertura(
  row: DistritoCoberturaRow,
  zonasConTarifaGeneral: ReadonlySet<string>,
): CoberturaDistritoDTO {
  const zona = zonaUnicaDeDistrito(row.zonas);
  // R8: disponible Y zona unica. Se calcula a partir de las dos piezas compartidas, no del motivo,
  // para que una divergencia entre ambas la vea el test de equivalencia.
  const cobertura = row.disponible && zona !== null;
  const motivo = motivoDe(row);

  return {
    provincia: row.provincia.nombre,
    canton: row.canton.nombre,
    distrito: row.distrito.nombre,
    disponible: row.disponible,
    cobertura,
    motivo: cobertura ? null : motivo,
    zonas: row.zonas.map((z) => z.nombre).sort(compararTexto),
    zonaUnica:
      zona === null
        ? null
        : {
            nombre: zona.nombre,
            esCentral: zona.esCentral,
            tieneTarifaGeneral: zonasConTarifaGeneral.has(zona.id),
          },
    zonaEspecial: row.distrito.zonaEspecial,
  };
}

/** R6: provincia, despues canton, despues distrito. */
export function compararCobertura(a: CoberturaDistritoDTO, b: CoberturaDistritoDTO): number {
  return (
    compararTexto(a.provincia, b.provincia) ||
    compararTexto(a.canton, b.canton) ||
    compararTexto(a.distrito, b.distrito)
  );
}
