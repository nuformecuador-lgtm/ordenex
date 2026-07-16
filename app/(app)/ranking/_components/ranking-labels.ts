// Feature 76 (T9) — etiquetas i18n-ready y helpers de formato del ranking DIARIO,
// separados de la lógica (docs/conventions: textos de UI fuera del componente).
// Money-safe (R12): los montos ya llegan como STRING desde el Server Component; los
// helpers solo anteponen el símbolo, NUNCA parseFloat/Number sobre montos.

/** Símbolo de "sin dato" reutilizable para celdas vacías. */
export const SIN_DATO = "—";

/** Antepone el símbolo de colón a un monto STRING (tal cual, sin parseo). `null` → "—" (R9). */
export function money(value: string | null): string {
  return value === null ? SIN_DATO : `₡${value}`;
}

/** Formatea el porcentaje ya redondeado (STRING) del servidor. `null` → "—" (R3). */
export function porcentaje(value: string | null): string {
  return value === null ? SIN_DATO : `${value}%`;
}

/** Conteo crudo auditable del día: entregadas / asignadas (R6). */
export function conteoCrudo(entregadasHoy: number, asignadasHoy: number): string {
  return `${entregadasHoy}/${asignadasHoy}`;
}

/** Etiquetas de las columnas de la tabla del ranking (R13). */
export const RANKING_COLUMNAS = {
  posicion: "Posición",
  mensajero: "Mensajero",
  porcentaje: "% del día",
  conteo: "Entregadas / asignadas",
} as const;

/** Etiquetas de la sección de premios del podio (R8/R14). */
export const PREMIOS_LABELS = {
  titulo: "Premios del podio",
  descripcion:
    "Tres posiciones del podio, cada una con un monto y una descripción opcionales.",
  posicion: "Posición",
  ocupante: "Mensajero",
  monto: "Monto del premio",
  descripcionPremio: "Descripción",
  acciones: "Acciones",
  sinOcupante: "Sin ocupante elegible hoy",
  sinMonto: "Sin premio asignado",
  sinDescripcion: "Sin descripción",
  guardar: "Guardar",
  guardando: "Guardando…",
  montoPlaceholder: "Ej. 5000",
  descripcionPlaceholder: "Ej. Bono por mejor desempeño",
} as const;

/** Mensajes de feedback de la edición de premios (R10/R11/R19). */
export const PREMIOS_FEEDBACK = {
  guardado: "Premio actualizado.",
  invalid: "Monto inválido: número no negativo con hasta 2 decimales.",
  forbidden: "No tenés permiso para editar los premios.",
  unauthenticated: "Tu sesión expiró. Iniciá sesión de nuevo.",
} as const;

/** Textos del estado vacío / encabezados de la tabla del ranking. */
export const RANKING_LABELS = {
  tablaAria: "Ranking diario de mensajeros",
  premiosAria: "Premios del podio",
  vacio: "Todavía no hay mensajeros para mostrar hoy.",
} as const;
