// Ficha 475 (design §8.2) — textos y mensajes PUROS del panel del informe de tránsito. Sin React ni
// acciones: los lee `ParamsTransito` y los tests los afirman sin montar nada.
//
// Lenguaje llano (memoria «no SLA en frontend»): «plazo», «aviso», «vencer», nunca la sigla.
import type { Hito } from "@/lib/whatsapp-envios/informes/transito/parametros";
import { PARADO_MAX, PARADO_MIN, PLAZO_MAX, PLAZO_MIN } from "@/lib/whatsapp-envios/informes/transito/parametros";

export const TEXTOS_TRANSITO = {
  intro:
    "Entran los paquetes que aún no tienen cierre logístico y ya están por vencer su plazo o lo pasaron.",
  plegar: "Plegar",
  desplegar: "Desplegar",
  plazoPorZona: "Plazo por zona",
  colZona: "Zona",
  colPlazo: "Plazo máximo",
  colAviso: "Avisar antes",
  colAlerta: "Entra en alerta",
  ayudaZonas:
    "Días naturales. Una zona nueva aparece aquí con los valores de partida de su tipo (10 y 2 días en la GAM, 20 y 5 fuera de ella) hasta que la cambies.",
  cargandoZonas: "Cargando las zonas…",
  sinZonas: "No hay zonas creadas todavía.",
  hitoTitulo: "Desde cuándo se cuentan los días",
  ayudaHito: "Si un paquete todavía no ha pasado por ese momento, no entra en el informe.",
  estadosTitulo: "Estados que entran, y cuándo uno está «parado»",
  ayudaEstados:
    "Parado = lleva más de esos días sin cambiar de estado. Sale arriba del PDF, en el bloque de atención. Vacío = no se marca como parado.",
  colEstado: "Estado",
  colParado: "Parado si lleva más de",
  noEntra: "no entra",
  cierreLogistico:
    "Los estados con cierre logístico (por ejemplo Entregado o Devuelta a tienda) no se listan: nunca entran.",
  volverPartida: "Volver a los valores de partida",
  calculando: "Calculando cuántos paquetes entrarían hoy…",
  conErrores: "Corrige los campos marcados para ver cuántos paquetes entrarían hoy.",
  errorVistaPrevia: "No se pudo calcular cuántos paquetes entrarían hoy. Inténtalo de nuevo en un momento.",
  errorZonas: "No se pudieron cargar las zonas. Inténtalo de nuevo en un momento.",
  reintentar: "Reintentar",
  sinPermiso: "Solo un maestro puede ver cuántos paquetes entrarían hoy.",
  sesionExpirada: "Tu sesión expiró. Vuelve a iniciar sesión.",
} as const;

/** Las tres opciones del hito, en el orden de la maqueta. */
export const OPCIONES_HITO: readonly { value: Hito; label: string }[] = [
  { value: "entrada_bodega_central", label: "Desde que entra a bodega central" },
  { value: "creacion", label: "Desde que se crea la orden" },
  { value: "generacion_guia", label: "Desde que se genera la guía" },
];

export function dias(n: number): string {
  return n === 1 ? "día" : "días";
}

export function textoEntraEnAlerta(dia: number | null): string {
  return dia === null ? "—" : `el día ${dia}`;
}

export function paquetes(n: number): string {
  return `${n} ${n === 1 ? "paquete" : "paquetes"}`;
}

export function textoParados(n: number): string {
  return `(${n} ${n === 1 ? "parado" : "parados"})`;
}

export function textoSinHito(n: number): string {
  return n === 1
    ? "1 paquete en esos estados aún no ha pasado por ese momento: no entra."
    : `${n} paquetes en esos estados aún no han pasado por ese momento: no entran.`;
}

/**
 * Mensaje PROPIO por campo, en español claro, para el error que el esquema reporta en esa ruta. El
 * esquema habla en claves (`avisoDias: …`); aquí se dice qué poner. Si la ruta no es de las que el
 * panel conoce, se usa el mensaje del servidor sin su prefijo de clave.
 *
 * @param ruta la clave del error sin `parametros.` (`zonas.3.avisoDias`, `estados`, `hito`…).
 * @param contexto el plazo de la fila, para decir hasta dónde llega el aviso.
 */
export function mensajeDeCampo(ruta: string, original: readonly string[], contexto: { plazo?: unknown } = {}): string[] {
  const ultimo = ruta.split(".").at(-1);
  if (ultimo === "plazoDias") return [`Pon un número entero de días entre ${PLAZO_MIN} y ${PLAZO_MAX}.`];
  if (ultimo === "avisoDias") {
    const plazo = contexto.plazo;
    if (typeof plazo === "number" && Number.isInteger(plazo) && plazo >= PLAZO_MIN && plazo <= PLAZO_MAX) {
      return [`Pon un número entero de días entre 0 y ${plazo - 1}: el aviso tiene que ser menor que el plazo.`];
    }
    return ["Pon un número entero de días, menor que el plazo."];
  }
  if (ultimo === "paradoSiMasDeDias") {
    return [`Pon un número entero de días entre ${PARADO_MIN} y ${PARADO_MAX}, o déjalo vacío.`];
  }
  if (ruta === "estados") return ["Marca al menos un estado."];
  if (ruta === "hito") return ["Elige desde cuándo se cuentan los días."];
  return original.map((m) => m.replace(/^[A-Za-z]+:\s*/, "").replace(/^./, (c) => c.toUpperCase()));
}
