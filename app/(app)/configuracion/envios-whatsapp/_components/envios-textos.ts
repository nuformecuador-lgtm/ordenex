// Ficha 474 (T10.3) — textos y formatos PUROS de «Envíos automáticos». Sin React ni acciones: los
// leen la lista, el formulario y el historial, y los tests los pueden afirmar sin montar nada.
//
// Lenguaje llano a propósito (memoria «no SLA en frontend»): «plazo», «vencido», nunca siglas. Los
// estados de base (`vacia`, `rechazo_permanente`…) no se enseñan nunca tal cual.
import type {
  RolValue,
  WhatsappEjecucionEstado,
  WhatsappEntregaEstado,
  WhatsappEnvioOrigen,
} from "@prisma/client";

import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { separadorDia } from "@/lib/utils/separador-dia-cr";

export type TonoBadge = "success" | "info" | "warning" | "danger" | "secondary";

/** Roles destinatarios en el orden de la maqueta (R16). `apiKey` no es una persona. */
export const ROLES_EN_PANTALLA: readonly { rol: RolValue; etiqueta: string }[] = [
  { rol: "maestro", etiqueta: "Maestro" },
  { rol: "admin", etiqueta: "Admin" },
  { rol: "adminSatelite", etiqueta: "Admin de satélite" },
  { rol: "adminTienda", etiqueta: "Admin de tienda" },
  { rol: "mensajero", etiqueta: "Mensajero" },
];

export function etiquetaRol(rol: RolValue): string {
  return ROLES_EN_PANTALLA.find((r) => r.rol === rol)?.etiqueta ?? rol;
}

/** Días ISO 1 = lunes … 7 = domingo, como `GuardarEnvioInput.diasSemana`. */
export const DIAS_SEMANA: readonly { dia: number; corto: string; inicial: string; largo: string }[] = [
  { dia: 1, corto: "Lun", inicial: "L", largo: "Lunes" },
  { dia: 2, corto: "Mar", inicial: "M", largo: "Martes" },
  { dia: 3, corto: "Mié", inicial: "X", largo: "Miércoles" },
  { dia: 4, corto: "Jue", inicial: "J", largo: "Jueves" },
  { dia: 5, corto: "Vie", inicial: "V", largo: "Viernes" },
  { dia: 6, corto: "Sáb", inicial: "S", largo: "Sábado" },
  { dia: 7, corto: "Dom", inicial: "D", largo: "Domingo" },
];

/**
 * «Lun–Sáb», «Lun, Mié, Vie», «Todos los días». Un tramo seguido de 3 o más días se resume con
 * guion, como la maqueta; si no, se enumeran.
 */
export function resumenDias(dias: readonly number[]): string {
  const orden = [...new Set(dias)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (orden.length === 0) return "Sin días";
  if (orden.length === 7) return "Todos los días";
  const corto = (d: number) => DIAS_SEMANA[d - 1].corto;
  const tramos: number[][] = [];
  for (const d of orden) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo[ultimo.length - 1] === d - 1) ultimo.push(d);
    else tramos.push([d]);
  }
  return tramos
    .map((t) => (t.length >= 3 ? `${corto(t[0])}–${corto(t[t.length - 1])}` : t.map(corto).join(", ")))
    .join(", ");
}

/** «Cuándo» de un envío: «Lun–Sáb 05:00» o el nombre del evento (R49). */
export function resumenCuando(e: {
  disparo: "hora_fija" | "evento";
  diasSemana: readonly number[];
  hora: string | null;
  eventoNombre: string | null;
}): string {
  if (e.disparo === "evento") return e.eventoNombre ?? "Cuando pase algo";
  return `${resumenDias(e.diasSemana)} ${e.hora ?? ""}`.trim();
}

const HORA_CR = new Intl.DateTimeFormat("es-CR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Costa_Rica",
});

/** `05:00` en hora de Costa Rica. */
export function horaCR(instante: Date | string): string {
  return HORA_CR.format(new Date(instante));
}

function mayusculaInicial(texto: string): string {
  return texto.length === 0 ? texto : texto[0].toUpperCase() + texto.slice(1);
}

/** «Hoy 05:00», «Ayer 16:12», «Lunes 5 de octubre 07:00» (hora CR). */
export function instanteCorto(instante: Date | string, ahora: Date): string {
  const d = new Date(instante);
  return `${mayusculaInicial(separadorDia(d.toISOString(), ahora))} ${horaCR(d)}`;
}

/** Encabezado de día del historial: «Hoy», «Ayer», «Lunes 5 de octubre». */
export function encabezadoDia(instante: Date | string, ahora: Date): string {
  return mayusculaInicial(separadorDia(new Date(instante).toISOString(), ahora));
}

/** Clave del día CR de un instante (agrupa el historial por día de Costa Rica, no UTC). */
export function claveDia(instante: Date | string): string {
  return fechaCalendarioCR(new Date(instante));
}

export const ESTADO_EJECUCION: Record<WhatsappEjecucionEstado, { etiqueta: string; tono: TonoBadge }> = {
  pendiente: { etiqueta: "Pendiente", tono: "info" },
  generando: { etiqueta: "Preparando", tono: "info" },
  enviando: { etiqueta: "Enviando", tono: "info" },
  completada: { etiqueta: "Enviado", tono: "success" },
  // Design §7: «Sin novedades» es la etiqueta de pantalla del estado `vacia` (R31/R42).
  vacia: { etiqueta: "Sin novedades", tono: "secondary" },
  sin_destinatarios: { etiqueta: "Sin destinatarios", tono: "warning" },
  omitida: { etiqueta: "No se envió (llegó tarde)", tono: "warning" },
  error: { etiqueta: "Error", tono: "danger" },
};

export const ESTADO_ENTREGA: Record<WhatsappEntregaEstado, { etiqueta: string; tono: TonoBadge }> = {
  pendiente: { etiqueta: "Pendiente", tono: "info" },
  // R37: una entrega que se quedó en curso sin desenlace NO se reenvía, y se dice así.
  en_curso: { etiqueta: "Resultado desconocido", tono: "warning" },
  aceptada: { etiqueta: "Aceptado por WhatsApp", tono: "info" },
  enviada: { etiqueta: "Enviado", tono: "info" },
  recibida: { etiqueta: "Entregado", tono: "success" },
  leida: { etiqueta: "Leído", tono: "success" },
  rechazo_permanente: { etiqueta: "Rechazado", tono: "danger" },
  fallida: { etiqueta: "Falló", tono: "danger" },
  telefono_invalido: { etiqueta: "Teléfono inválido", tono: "danger" },
};

export const ORIGEN_EJECUCION: Record<WhatsappEnvioOrigen, string> = {
  programado: "A hora fija",
  evento: "Por un aviso",
  prueba: "Prueba",
};

const ENTREGA_EN_CONTEO: Record<WhatsappEntregaEstado, [string, string]> = {
  pendiente: ["pendiente", "pendientes"],
  en_curso: ["con resultado desconocido", "con resultado desconocido"],
  aceptada: ["aceptado por WhatsApp", "aceptados por WhatsApp"],
  enviada: ["enviado", "enviados"],
  recibida: ["entregado", "entregados"],
  leida: ["leído", "leídos"],
  rechazo_permanente: ["rechazado", "rechazados"],
  fallida: ["fallido", "fallidos"],
  telefono_invalido: ["con teléfono inválido", "con teléfono inválido"],
};

/** «3 entregados · 1 rechazado», en el orden de `ESTADO_ENTREGA`, sin ceros. */
export function resumenConteos(conteos: Partial<Record<WhatsappEntregaEstado, number>>): string {
  return (Object.keys(ESTADO_ENTREGA) as WhatsappEntregaEstado[])
    .filter((e) => (conteos[e] ?? 0) > 0)
    .map((e) => {
      const n = conteos[e] as number;
      return `${n} ${ENTREGA_EN_CONTEO[e][n === 1 ? 0 : 1]}`;
    })
    .join(" · ");
}
