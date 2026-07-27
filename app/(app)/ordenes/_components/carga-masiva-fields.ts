// Campos de la plantilla de carga masiva de órdenes (compartidos por el paso de
// subida y el generador de plantilla). Se aíslan aquí para evitar dependencias
// circulares entre el botón orquestador y el componente de subida.
import type { TemplateField, UploadFileType } from "@/components/shared/BulkUpload";

// Feature 142 — Plantilla v2: las 4 columnas geográficas separadas (provincia,
// canton, distrito, direccion) se sustituyen por la columna única
// `direccion_destinatario` con el formato
// `País / Provincia / Cantón (Distrito) / Dirección literal` (R1, R5).
// El orden de esta lista ES el orden de las columnas de la plantilla (R1) y las
// claves son las cabeceras verbatim que el backend valida (R2): no añadir
// `label` ni sufijos, o se rompe el round-trip descargar → subir.
export const ORDENES_BULK_FIELDS: TemplateField[] = [
  { key: "destinatario", example: "Juan Pérez" },
  { key: "telefono", example: "88887777" },
  {
    key: "direccion_destinatario",
    // R4: la terna del ejemplo debe existir en el catálogo del seed y su distrito
    // tener zona; lo blinda `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts`.
    // El ejemplo propuesto en design.md (`Jimenez (Juan Vinas)`) EXISTE en el
    // catálogo pero NO recibe zona en el cruce del seed, así que se sustituyó por
    // `Cartago (Occidental)` (zona GAM), según `design.md > Preguntas abiertas #4`.
    example: "Costa Rica / Cartago / Cartago (Occidental) / Frente gasolinera JSM, 200m sur",
  },
  { key: "monto_cobrar", example: "25.90" },
  { key: "producto", example: "Camiseta talla M" },
  { key: "num_remision", example: "REM-0001" },
  { key: "peso", example: "1.5" },
  { key: "notas", example: "Entregar en la tarde" },
];

export const ORDENES_BULK_TEMPLATE_NAME = "plantilla-ordenes-carga-masiva.xlsx";

export const ORDENES_BULK_ACCEPT: UploadFileType[] = ["csv", "xlsx"];
