// Ficha 465 — fabrica de filas de repositorio para los tests de la regla de cobertura.
// No es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.
import type { DistritoCoberturaRow } from "@/lib/interfaces/repositories/ICoberturaRepository";

export interface OpcionesFila {
  provincia?: string;
  canton?: string;
  distrito?: string;
  provinciaActiva?: boolean;
  cantonActivo?: boolean;
  distritoActivo?: boolean;
  zonaEspecial?: boolean | null;
  zonas?: { id: string; nombre: string; esCentral?: boolean }[];
}

/** `disponible` se compone como lo hace el repositorio: la conjuncion de los tres flags. */
export function fila(o: OpcionesFila = {}): DistritoCoberturaRow {
  const provinciaActiva = o.provinciaActiva ?? true;
  const cantonActivo = o.cantonActivo ?? true;
  const distritoActivo = o.distritoActivo ?? true;
  return {
    provincia: { nombre: o.provincia ?? "San José", activo: provinciaActiva },
    canton: { nombre: o.canton ?? "Escazú", activo: cantonActivo },
    distrito: {
      nombre: o.distrito ?? "San Rafael",
      activo: distritoActivo,
      zonaEspecial: o.zonaEspecial === undefined ? false : o.zonaEspecial,
    },
    disponible: provinciaActiva && cantonActivo && distritoActivo,
    zonas: (o.zonas ?? [{ id: "z-gam", nombre: "GAM", esCentral: true }]).map((z) => ({
      id: z.id,
      nombre: z.nombre,
      esCentral: z.esCentral ?? false,
    })),
  };
}
