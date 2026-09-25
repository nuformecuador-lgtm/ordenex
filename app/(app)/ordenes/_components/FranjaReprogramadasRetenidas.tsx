import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type {
  CierreQueRetiene,
  ResumenRetenidas,
} from "@/lib/interfaces/services/IReprogramadasRetenidasService";
import { fechaLegible } from "@/lib/utils/dia-reparto-textos";
import {
  RUTA_CIERRES_ADMIN,
  hrefDetalleCierre,
} from "@/app/(app)/cierres-admin/_components/cierre-enlace";
import { ESTADO_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-labels";

// FICHA 462 (T3.4, S4, R32-R35, R38, R39) — LA FRANJA DE `/ordenes`: cuántos paquetes reprogramados
// para hoy NO se pueden asignar todavía, y POR QUÉ CIERRE.
//
// ── QUÉ ES, Y QUÉ NO
// Es un BLOQUE REMOVIBLE (R39): este archivo + la lectura `lib/actions/reprogramadas-retenidas.ts` +
// ~10 líneas de `page.tsx`. Quitarlo no toca el listado ni las otras tres superficies. Es un Server
// Component PURO (sin hooks, sin estado): recibe el resumen YA recortado al ámbito central por el
// servidor y lo pinta. El navegador no calcula fechas ni conteos (R38).
//
// ── DE DÓNDE SALEN LOS NÚMEROS (R7)
// Los tres salen del MISMO resumen que alimenta la campana y la marca de `/cierres-admin`:
//   N = `resumen.total`                         (paquetes retenidos del ámbito central)
//   M = `resumen.cierres.length`                (cierres sin aprobar que los retienen)
//   K = Σ `resumen.sinCierre[].cuantas`          (retenidos cuyo mensajero aún no envió cierre; NO cuentan en M)
// Aquí no hay otro cálculo: ni una fecha, ni un filtro por estado, ni una suma que no sea leer el DTO.
//
// ── EL VOCABULARIO (decisión del leader, 2026-09-25; prevalece sobre requirements R32/R34)
// Se habla del PAQUETE en masculino («paquetes reprogramados para hoy»). El plural femenino del
// estado retirado («reprogramadas») no aparece en ningún texto visible (455/R41). Tuteo («no puedes»),
// como el resto de avisos a la administración. Singulares y plurales EXPLÍCITOS; los literales se
// afirman A MANO en `tests/components/FranjaReprogramadasRetenidas.test.tsx`.
//
// ── NINGÚN IDENTIFICADOR INTERNO VISIBLE (R33/R52)
// Cada cierre enlaza a su detalle (`hrefDetalleCierre`): el uuid va SOLO en la dirección, nunca en el
// texto. El texto de la línea es nombre del mensajero, jornada en palabras (o «cierre del día» si no
// hay jornada fiable, 271/R60), estado en palabras (`ESTADO_LABEL`) y cuántos retiene.
//
// ── COLOR
// Solo tokens semánticos `warning` (DESIGN.md: `-soft` fondo, base borde, `-strong` texto; en oscuro
// `bg-warning/15`). Es trabajo atascado que se resuelve aprobando, no un error: no es `destructive`.

/** Nombre accesible de la región: lo que un lector de pantalla anuncia al llegar al bloque. */
export const FRANJA_RETENIDAS_ARIA_LABEL = "Paquetes reprogramados para hoy que esperan un cierre";
/** El atajo, mismo texto que el del aviso de la campana (R16). */
export const REVISAR_CIERRES_LABEL = "Revisar cierres";
/** Lo que se dice de un cierre sin jornada fiable (271/R60: no se inventa fecha). */
export const CIERRE_DEL_DIA_LABEL = "cierre del día";

const paquetes = (n: number) => (n === 1 ? "1 paquete reprogramado" : `${n} paquetes reprogramados`);
const cierres = (m: number) => (m === 1 ? "falta 1 cierre por aprobar" : `faltan ${m} cierres por aprobar`);

/**
 * La frase principal (R32/R34), con la cifra del ámbito central.
 *  - M > 0:            «Hay N paquete(s) reprogramado(s) para hoy que todavía no puedes asignar: falta(n) M cierre(s) por aprobar.»
 *  - M = 0 y K > 0:    «… : su(s) mensajero(s) todavía no envió/enviaron el cierre.»
 */
export function frasePrincipal(n: number, m: number, mensajerosSinCierre: number): string {
  const cabeza = `Hay ${paquetes(n)} para hoy que todavía no puedes asignar: `;
  if (m > 0) return `${cabeza}${cierres(m)}.`;
  return mensajerosSinCierre === 1
    ? `${cabeza}su mensajero todavía no envió el cierre.`
    : `${cabeza}sus mensajeros todavía no enviaron el cierre.`;
}

/** La frase de las K retenidas sin cierre cuando ADEMÁS hay cierres que aprobar (R34). Sin enlace. */
export function fraseSinCierre(k: number): string {
  return k === 1
    ? "1 de ellos es de un mensajero que todavía no envió su cierre."
    : `${k} de ellos son de mensajeros que todavía no enviaron su cierre.`;
}

/** Una línea de la lista de cierres (R33). El id NO entra en el texto. */
export function textoCierre(c: CierreQueRetiene): string {
  const jornada = c.jornadaCR ? fechaLegible(c.jornadaCR) : CIERRE_DEL_DIA_LABEL;
  const retiene = c.cuantas === 1 ? "retiene 1 paquete" : `retiene ${c.cuantas} paquetes`;
  return `${c.mensajeroNombre} · ${jornada} · ${ESTADO_LABEL[c.estado]} · ${retiene}`;
}

export interface FranjaReprogramadasRetenidasProps {
  /** El resumen YA recortado al ámbito central por el servidor, o `null` si no se pudo leer (R37). */
  resumen: ResumenRetenidas | null;
}

export function FranjaReprogramadasRetenidas({ resumen }: Readonly<FranjaReprogramadasRetenidasProps>) {
  // R35/R37: sin retenidas, o sin lectura, no hay franja. Nada más de esta ficha en la página.
  if (resumen === null || resumen.total <= 0) return null;

  const n = resumen.total;
  const m = resumen.cierres.length;
  const k = resumen.sinCierre.reduce((acc, s) => acc + s.cuantas, 0);

  return (
    // `role="region"` con nombre y no el `role="alert"` por defecto de la primitiva: esto no es un
    // suceso que interrumpir, es un bloque que está en la página al cargarla.
    <Alert
      role="region"
      aria-label={FRANJA_RETENIDAS_ARIA_LABEL}
      className="border-warning bg-warning-soft text-foreground dark:bg-warning/15"
    >
      <CalendarClock aria-hidden="true" />
      <AlertTitle className="text-warning-strong">
        {frasePrincipal(n, m, resumen.sinCierre.length)}
      </AlertTitle>
      <AlertDescription className="text-foreground">
        {m > 0 && k > 0 ? <p>{fraseSinCierre(k)}</p> : null}
        {m > 0 ? (
          <ul className="flex flex-col gap-1">
            {resumen.cierres.map((c) => (
              <li key={c.cierreId}>
                <Link href={hrefDetalleCierre(c.cierreId)}>{textoCierre(c)}</Link>
              </li>
            ))}
          </ul>
        ) : null}
        <p>
          <Link href={RUTA_CIERRES_ADMIN} className="font-medium">
            {REVISAR_CIERRES_LABEL}
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}
