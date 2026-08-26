import type { PlantillaEstado } from "@prisma/client";

/**
 * Etiquetas legibles del estado de una plantilla de mensaje. Fuente ÚNICA compartida por
 * la insignia de la tabla (`plantillas-columns.tsx`) y por las columnas de export
 * (`plantillas-descarga-columnas.ts`).
 *
 * Feature 170 (T B.3): PROMOVIDA aquí sin cambiar ni un texto desde `plantillas-columns.tsx`,
 * donde era una constante privada. El módulo de columnas de export debe ser PURO (design §3)
 * y aquél importa `Badge` y `Button`. Que ambos lean de aquí es lo que hace cierto R8: la
 * etiqueta del `xlsx` no puede divergir de la de pantalla porque es la misma.
 */
export const ESTADO_PLANTILLA_LABEL: Record<PlantillaEstado, string> = {
  activo: "Activo",
  inactivo: "Inactivo",
  pending: "Pendiente",
  refused: "Rechazado",
  saved_not_aprobation: "Guardado sin aprobación",
};
