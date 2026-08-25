// Campos de la plantilla de carga masiva de órdenes (compartidos por el paso de
// subida y el generador de plantilla). Se aíslan aquí para evitar dependencias
// circulares entre el botón orquestador y el componente de subida.
import type { TemplateField, UploadFileType } from "@/components/shared/BulkUpload";

// Feature 276 — Plantilla v3: la columna unica `direccion_destinatario` de la v2
// (`Pais / Provincia / Canton (Distrito) / Direccion`) se sustituye por TRES columnas
// separadas: `provincia`, `canton_distrito` (formato `nombreCanton (Distrito)`) y
// `direccion`. El pais desaparece: la v2 ya lo descartaba sin validarlo ni persistirlo,
// asi que no se pierde ningun dato (R1, R5, R6).
// El orden de esta lista ES el orden de las columnas de la plantilla (R1) y las
// claves son las cabeceras verbatim que el backend valida (R2): no añadir
// `label` ni sufijos, o se rompe el round-trip descargar → subir.
export const ORDENES_BULK_FIELDS: TemplateField[] = [
  { key: "destinatario", example: "Juan Pérez" },
  { key: "telefono", example: "88887777" },
  // R4: la terna del ejemplo debe existir en el catálogo del seed y su distrito
  // tener zona; lo blinda `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts`.
  // Se conserva la de la v2 (`Cartago` + `Cartago (Occidental)`, zona GAM), que ya
  // estaba verificada contra el cruce del seed.
  { key: "provincia", example: "Cartago" },
  { key: "canton_distrito", example: "Cartago (Occidental)" },
  { key: "direccion", example: "Frente gasolinera JSM, 200m sur" },
  { key: "monto_cobrar", example: "25.90" },
  { key: "producto", example: "Camiseta talla M" },
  { key: "num_remision", example: "REM-0001" },
  { key: "peso", example: "1.5" },
  { key: "notas", example: "Entregar en la tarde" },
];

export const ORDENES_BULK_TEMPLATE_NAME = "plantilla-ordenes-carga-masiva.xlsx";

export const ORDENES_BULK_ACCEPT: UploadFileType[] = ["csv", "xlsx"];
