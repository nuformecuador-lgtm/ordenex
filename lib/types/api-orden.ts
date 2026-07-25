// Feature 106 — DTOs PUBLICOS del canal integrador (API por key). Son la superficie que el
// integrador ve; NUNCA incluyen internals ni PII de terceros:
//   - sin `id` UUID interno ni `tiendaId` (el owner ya es quien pregunta),
//   - sin `evidencia_storage_path` crudo ni el nombre del bucket (solo URL firmada, R16),
//   - sin datos del mensajero que gestiono la orden (R16).
// El identificador publico es `numGuia` (decision (d) del gate F1.4).

/** Un item del LISTADO paginado (GET coleccion). Campos publicos de la orden (R6). */
export interface ApiOrdenListItemDTO {
  numGuia: number | null;
  numRemision: string;
  estado: string; // orden.estatus.value
  destinatario: string;
  telefonoDest: string;
  producto: string;
  direccion: string | null;
  montoCobrar: number | null; // Decimal -> number
  createdAt: Date;
}

/** Info de paginacion offset/limit del listado (R10), con `total` para recorrer paginas. */
export interface ApiOrdenPagination {
  limit: number;
  offset: number;
  total: number;
}

/** Respuesta del listado: items + paginacion (R10). */
export interface ApiOrdenListadoDTO {
  items: ApiOrdenListItemDTO[];
  pagination: ApiOrdenPagination;
}

/** UNA evidencia de entrega/rechazo, ya resuelta a URL firmada de corta duracion (R15/R17). */
export interface ApiOrdenEvidenciaDTO {
  resultado: "entregada" | "rechazada";
  contentType: string | null;
  url: string; // URL firmada (5 min); NUNCA el storage_path crudo ni el bucket (R16)
  expiraEnSegundos: number;
}

/** Detalle de UNA orden propia con sus evidencias firmadas (R12/R15/R18). */
export interface ApiOrdenDetalleDTO extends ApiOrdenListItemDTO {
  evidencias: ApiOrdenEvidenciaDTO[]; // [] cuando no hay (R18)
}

/** Resultado de la CANCELACION (PUT), con el estado anterior y el destino (R19). */
export interface ApiOrdenCancelacionDTO {
  numGuia: number;
  estadoAnterior: string;
  estado: string; // "devolviendo_a_tienda"
}
