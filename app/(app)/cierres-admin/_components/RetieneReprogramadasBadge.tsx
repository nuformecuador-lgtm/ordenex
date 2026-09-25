"use client";

import { Badge } from "@/components/ui/badge";

import { notaRetieneReprogramadas, retieneReprogramadas } from "./cierre-labels";

// FICHA 462 (T3.2, S3, R27/R28) — LA MARCA «Retiene N paquetes reprogramados para hoy» DE UN CIERRE.
//
// La pintan las tres superficies de `/cierres-admin` que enseñan un cierre —la cola de pendientes, el
// histórico y la cabecera del detalle— y por eso vive en su propio archivo: la retención tiene que
// leerse igual en las tres. Vive junto a la página (un solo uso por pantalla) y no en `shared/`.
//
// LA CIFRA SE PINTA, NO SE CALCULA (R7/R38). Llega del servidor en `CierreAdminResumen.reprogramadasRetenidasHoy`,
// resuelta con UNA lectura por página (`contarPorCierre`), el MISMO conteo que alimenta la campana y
// la franja de `/ordenes`. Aquí no hay fecha, ni «hoy», ni predicado: solo un número.
//
// `null`/`undefined`/`0` → NADA (R27: «con 0 no deben mostrar nada de esta ficha»). Un cierre
// `aprobado` llega siempre con 0 por construcción (R28), así que no hace falta una rama por estado.
// MUTACIÓN OBLIGATORIA (una por superficie): pintarla con 0 pone rojo su test.
//
// `warning` y no `destructive`: es trabajo atascado que se resuelve aprobando, no un error.
// Tokens semánticos de `DESIGN.md` vía la primitiva `Badge`; sin hex.

export interface RetieneReprogramadasBadgeProps {
  /** `CierreAdminResumen.reprogramadasRetenidasHoy`, tal cual llega. */
  cuantas: number | null | undefined;
}

export function RetieneReprogramadasBadge({ cuantas }: Readonly<RetieneReprogramadasBadgeProps>) {
  if (cuantas === null || cuantas === undefined || cuantas <= 0) return null;
  const texto = retieneReprogramadas(cuantas);
  const nota = notaRetieneReprogramadas(cuantas);
  return (
    <Badge variant="warning" title={nota} aria-label={`${texto}. ${nota}`}>
      {texto}
    </Badge>
  );
}
