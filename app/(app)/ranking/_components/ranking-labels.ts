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

/** Iniciales para el avatar del podio: máx. 2 letras a partir del nombre. */
export function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "?";
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
}

/** Ancho (0-100) de la barra de efectividad. SOLO presentacional: el porcentaje
 * mostrado sigue siendo el STRING del servidor (R12), esto no lo reemplaza. */
export function anchoBarra(pct: string | null): number {
  if (pct === null) return 0;
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

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

/** Etiquetas del podio visual (rediseño de la sección de ranking). */
export const PODIO_LABELS = {
  titulo: "Ranking de mensajeros",
  descripcion: "Efectividad · entregadas / asignadas · hoy",
  conteoSufijo: "entregas",
  sinOcupante: "Sin ocupante",
  lugar: (posicion: number) => `${posicion}º lugar`,
  contador: (total: number) =>
    total === 1 ? "1 mensajero" : `${total} mensajeros`,
  listaAria: "Resto del ranking diario",
  podioAria: "Podio del ranking diario",
  vos: "Tú",
  fueraDelTop: (limite: number) => `Tu posición, fuera del top ${limite}`,
} as const;

/** Textos del estado vacío / encabezados de la tabla del ranking. */
export const RANKING_LABELS = {
  tablaAria: "Ranking diario de mensajeros",
  premiosAria: "Premios del podio",
  vacio: "Todavía no hay mensajeros para mostrar hoy.",
} as const;
