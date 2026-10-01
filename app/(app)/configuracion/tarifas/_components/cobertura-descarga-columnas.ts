/**
 * Ficha 465 (design §3.6, T7) — columnas de EXPORT del Excel de cobertura por distrito.
 *
 * Módulo PURO: sin React ni DOM. Es el ÚNICO sitio con los textos del archivo (R7-R14): el DTO
 * (`CoberturaDistritoDTO`) llega sin textos de UI y aquí se traduce a valores crudos de celda.
 * `null` = celda vacía (R10, R12, R14).
 */
import type { CoberturaDistritoDTO, MotivoSinCobertura } from "@/lib/types/cobertura";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";

/** R16 — ámbito de la preferencia de columnas (selector + orden recordados en el navegador). */
export const AMBITO_DESCARGA_COBERTURA = "tarifas-cobertura";

/** R5 — columnas del archivo, en su orden por defecto. */
export const COLUMNAS_DESCARGA_COBERTURA: DescargaColumna[] = [
  { clave: "provincia", encabezado: "Provincia" },
  { clave: "canton", encabezado: "Cantón" },
  { clave: "distrito", encabezado: "Distrito" },
  { clave: "activo", encabezado: "Activo" },
  { clave: "cobertura", encabezado: "Cobertura" },
  { clave: "motivo", encabezado: "Motivo sin cobertura" },
  { clave: "zona", encabezado: "Zona" },
  { clave: "gam", encabezado: "GAM" },
  { clave: "zona_especial", encabezado: "Zona especial" },
  { clave: "tarifa_general", encabezado: "Tarifa general de la zona" },
];

const SI = "Sí";
const NO = "No";

/** R9 — texto de cada causa de «sin cobertura». */
export const MOTIVO_SIN_COBERTURA_LABEL: Record<MotivoSinCobertura, string> = {
  provincia_retirada: "Provincia retirada del catálogo",
  canton_retirado: "Cantón retirado del catálogo",
  distrito_retirado: "Distrito retirado del catálogo",
  sin_zona: "Sin zona asignada",
  varias_zonas: "Asignado a varias zonas",
};

function siNo(valor: boolean): string {
  return valor ? SI : NO;
}

/** R11 — nombre de la zona única, «Sin zona» o «Varias zonas: A, B». */
function textoZona(zonas: readonly string[]): string {
  if (zonas.length === 0) return "Sin zona";
  if (zonas.length === 1) return zonas[0]!;
  return `Varias zonas: ${zonas.join(", ")}`;
}

/** R13 — tri-valuada: «Sí», «No» o «Sin definir». */
function textoZonaEspecial(valor: boolean | null): string {
  if (valor === null) return "Sin definir";
  return siNo(valor);
}

/** Proyecta un distrito a una fila del archivo con los textos de R7-R14. */
export function filaCobertura(dto: CoberturaDistritoDTO): DescargaFila {
  return {
    provincia: dto.provincia,
    canton: dto.canton,
    distrito: dto.distrito,
    activo: siNo(dto.disponible),
    cobertura: siNo(dto.cobertura),
    motivo: dto.motivo === null ? null : MOTIVO_SIN_COBERTURA_LABEL[dto.motivo],
    zona: textoZona(dto.zonas),
    gam: dto.zonaUnica === null ? null : siNo(dto.zonaUnica.esCentral),
    zona_especial: textoZonaEspecial(dto.zonaEspecial),
    tarifa_general:
      dto.zonaUnica === null ? null : siNo(dto.zonaUnica.tieneTarifaGeneral),
  };
}
