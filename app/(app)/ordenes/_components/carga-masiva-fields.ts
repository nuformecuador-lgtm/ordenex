// Campos de la plantilla de carga masiva de órdenes (compartidos por el paso de
// subida y el generador de plantilla). Se aíslan aquí para evitar dependencias
// circulares entre el botón orquestador y el componente de subida.
import type { TemplateField, UploadFileType } from "@/components/shared/BulkUpload";

export const ORDENES_BULK_FIELDS: TemplateField[] = [
  { key: "num_remision", example: "REM-0001" },
  { key: "destinatario", example: "Juan Pérez" },
  { key: "telefono", example: "88887777" },
  { key: "provincia", example: "San José" },
  { key: "canton", example: "San José" },
  { key: "distrito", example: "Carmen" },
  { key: "direccion", example: "Av. Central, 200m norte del parque" },
  { key: "producto", example: "Camiseta talla M" },
  { key: "peso", example: "1.5" },
  { key: "monto_cobrar", example: "25.90" },
  { key: "notas", example: "Entregar en la tarde" },
];

export const ORDENES_BULK_TEMPLATE_NAME = "plantilla-ordenes-carga-masiva.xlsx";

export const ORDENES_BULK_ACCEPT: UploadFileType[] = ["csv", "xlsx"];
