"use client";

import { RadioGroup } from "@/components/ui/radio-group";
import { DIA_REPARTO } from "@/lib/types/dia-reparto";
import type { DiaReparto } from "@/lib/types/dia-reparto";
import {
  etiquetaDiaReparto,
  SELECTOR_DIA_AYUDA,
  SELECTOR_DIA_TITULO,
  type FechasDiaReparto,
} from "@/lib/utils/dia-reparto-textos";

/**
 * Feature 246 (T4.1, R1/R2/R27/R29) — elegir si el lote es para el reparto de HOY o el del DÍA
 * SIGUIENTE, al asignar.
 *
 * VIVE EN `components/shared/` PORQUE SE USA EN DOS SITIOS: `AsignarBodegaModal` (bodega central)
 * y `AsignarSateliteModal` (bodega satélite). La decisión D4 se firmó así por una razón operativa:
 * si sólo una de las dos superficies ofreciera la elección, la regla del sistema dependería de
 * DESDE QUÉ BODEGA te asignaron, y eso no se le puede explicar a quien opera. Dos consumidores es
 * exactamente el umbral que `docs/architecture.md` fija para promover un compuesto.
 *
 * SOBRE LA PRIMITIVA `RadioGroup` DE `components/ui/`, no un control propio: dos opciones
 * excluyentes dentro de un formulario son un `radiogroup`, y la primitiva ya aporta el rol, el
 * `aria-checked` por opción, la navegación con flechas y un solo tab-stop. (Ojo con el atajo
 * mental: este repo NO usa Radix — sus primitivas van sobre Base UI, así que `npx shadcn add
 * radio-group` sería la instrucción equivocada aquí; la primitiva ya existe y se reusa.)
 *
 * ⚠️ NO LEE EL RELOJ DEL NAVEGADOR (R29). Las dos fechas llegan por props, resueltas en el
 * servidor con el día de Costa Rica. No hay `new Date()` en este archivo ni en el módulo de
 * textos que consume, y no debe haberlo: «hoy» sólo significa algo con un huso, y el del portátil
 * de quien asigna no es el del negocio.
 *
 * ⚠️ EL FORMULARIO A CABALLO DE LA MEDIANOCHE — CASO CONOCIDO, NOMBRADO Y NO IMPLEMENTADO
 * (decisión D6, `design.md` §4.4). Las fechas de estas etiquetas se resuelven cuando la PÁGINA se
 * renderiza; el día al que va el lote lo resuelve el servidor cuando se ENVÍA. Si el modal se
 * abre a las 23:58 y se confirma a las 00:01, «Mañana» significará un día más allá de lo que el
 * operador leyó. El fallo es benigno —la orden queda protegida una noche de más, nunca se
 * pierde— y está medido: M1 dice que la asignación más tardía de los últimos 30 días es a las
 * 20:00 y que no hay masa entre las 23:00 y la 01:00. El escape existe diseñado (mandar la fecha
 * base a la vista y que el servidor rechace si cambió) y se decidió NO construirlo. Queda escrito
 * aquí para que sea decisión y no descubrimiento: si esa masa aparece, el escape está en §4.4.
 */
export interface SelectorDiaRepartoProps {
  /** Opción elegida. El padre es la fuente de verdad (mismo contrato que `Select`). */
  valor: DiaReparto;
  /** Emite la nueva opción. */
  onValorChange: (valor: DiaReparto) => void;
  /**
   * Fechas calendario de las dos opciones, `YYYY-MM-DD`, RESUELTAS EN EL SERVIDOR (R29). Son
   * obligatorias para que montar el selector sin decidir de dónde salen sea imposible; una
   * cadena vacía es una decisión válida y explícita («no hay fecha que mostrar»), y entonces la
   * opción se lee sólo con su nombre. Lo que nunca ocurre es que aparezca una fecha inventada.
   */
  fechas: FechasDiaReparto;
}

// SIN prop `disabled`, aunque la primitiva la tenga: hoy no hay ninguna superficie que quiera
// apagar el selector —el `Modal` ya bloquea su propio confirmar mientras la acción está en
// vuelo—, y una prop que nadie ejerce es API que nadie prueba. Se añade el día que haga falta.
export function SelectorDiaReparto({
  valor,
  onValorChange,
  fechas,
}: Readonly<SelectorDiaRepartoProps>) {
  const options = DIA_REPARTO.map((dia) => ({
    value: dia,
    label: etiquetaDiaReparto(dia, fechas),
  }));

  return (
    <div className="flex flex-col gap-1.5">
      {/* El título es prosa visible y el grupo lleva el MISMO texto como nombre accesible: la
          primitiva `RadioGroup` sólo expone `aria-label`, y hacer que coincidan es lo que evita
          que quien oye el control y quien lo lee estén oyendo dos nombres distintos. */}
      <p className="text-sm font-medium">{SELECTOR_DIA_TITULO}</p>
      <p className="text-sm text-muted-foreground">{SELECTOR_DIA_AYUDA}</p>
      <RadioGroup
        aria-label={SELECTOR_DIA_TITULO}
        value={valor}
        // El valor sólo puede ser una de las dos opciones del grupo, que son las del enum: el
        // `RadioGroup` emite `""` únicamente al LIMPIAR la selección, y aquí no hay forma de
        // limpiarla. Se ignora ese caso en vez de reinterpretarlo, para que «sin elegir» nunca
        // pueda convertirse en un día por accidente (R27: el defecto lo pone el padre, y es HOY).
        onValueChange={(next) => {
          if (next === "hoy" || next === "manana") onValorChange(next);
        }}
        options={options}
        // Las dos opciones se apilan en móvil y comparten fila desde `sm`, a mitades: son
        // excluyentes y del mismo peso, así que ninguna debe parecer la principal por tamaño.
        className="sm:flex-row sm:gap-3 sm:[&>label]:flex-1"
      />
    </div>
  );
}
