"use client";

import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Control SEGMENTADO: dos o más opciones excluyentes en un solo bloque, con la activa
 * resaltada. Es el conmutador que la rama ux estrenó en el portal del mensajero para alternar
 * entre la vista «mosaico» y la «detalle» de sus órdenes.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO (pedido humano del 2026-08-16): la pantalla de cierres pidió
 * «tabs bodega/mensajero con el que se usa en órdenes del mensajero». La forma barata de
 * cumplirlo era copiar `VistaCardsToggle` y cambiarle las etiquetas; la forma que no se
 * despega es esta: el control se extrae aquí SIN dominio y las dos pantallas lo montan. Un
 * copiado habría tenido el mismo aspecto el primer día y otro distinto al primer retoque, que
 * es justo lo que «el mismo que usa el mensajero» pide que no pase.
 *
 * LO QUE NO CAMBIA respecto al original, y por eso este archivo no es una reescritura: el DOM
 * es el mismo (`ButtonGroup` + un `Button` por opción), y la selección se anuncia con
 * `aria-pressed` en vez de con un `radiogroup` porque detrás no hay formulario. Los tests de
 * las pantallas del mensajero localizan el control por `role="group"` y su nombre accesible, y
 * siguen encontrándolo igual.
 *
 * ES ESTADO DE UI PURO: no filtra, no reordena y no toca la ruta. Quien lo monta decide qué
 * significa cada opción.
 */
export interface SegmentedOption<T extends string> {
  valor: T;
  etiqueta: string;
  /**
   * Icono opcional a la izquierda de la etiqueta.
   *
   * Deja de ser opcional EN LA PRÁCTICA para quien monte el control con `soloIcono`: ahí es lo
   * único que se pinta. Sin él la opción cae al botón de texto de siempre, que al lado de tres
   * botones cuadrados se ve raro pero se LEE; un botón vacío no.
   */
  Icono?: LucideIcon;
  /**
   * Contador que acompaña a la etiqueta («Pendientes 12»). Es un dato, no un adorno: en un
   * conmutador que ESCONDE la opción no elegida, sin él la pestaña que no se está mirando no
   * dice si tiene trabajo esperando. Se omite cuando no hay número que dar.
   */
  conteo?: number;
}

export interface SegmentedToggleProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  valor: T;
  onChange: (valor: T) => void;
  /** Nombre accesible del grupo. Obligatorio: una pantalla puede montar más de uno. */
  ariaLabel: string;
  /**
   * FICHA 428 — pinta cada opción como un botón CUADRADO con solo su `Icono`, sin la etiqueta
   * escrita, y con la etiqueta dentro de un tooltip.
   *
   * ES OPT-IN Y NACE EN `false` A PROPÓSITO. Lo pide UNA sola pantalla —la barra de
   * `/ordenes`, donde los dos conmutadores de orden ocupaban ~800 px de los ~1480 de la fila y
   * empujaban el botón «Filtros» a una tercera línea— y los otros ocho consumidores (cierres
   * ×4, geografía, histórico/acciones, mis-asignaciones y monitoreo) no cambian ni un píxel.
   * Volverlo global habría costado lo mismo y habría encogido pestañas que nadie pidió
   * encoger, empezando por las de cierres, que son pestañas y no un conmutador de orden.
   *
   * LA ETIQUETA NO DESAPARECE, SE MUDA: viaja al `aria-label` del botón y al tooltip. Es el
   * NOMBRE ACCESIBLE del control, no un adorno — lo que anuncia un lector de pantalla y lo que
   * usan los tests de las pantallas para localizarlo
   * (`getByRole("button", { name: "Más antiguas" })`). Quien toque esto: quitar el `aria-label`
   * «porque ya está el tooltip» deja los botones sin nombre y rompe pantallas que no son esta.
   *
   * LIMITACIÓN CONOCIDA Y ACEPTADA: con `soloIcono` el `conteo` NO se pinta. No cabe en un
   * botón cuadrado sin convertirlo en un badge encima del icono, que ya es otro control. Hoy
   * ningún consumidor con `soloIcono` declara `conteo` —quien lo usa son las pestañas de
   * cierres, y esas van con texto—, así que no hay ningún número perdido; el día que alguien
   * quiera las dos cosas, esto es lo que hay que resolver antes.
   *
   * COSTE ASUMIDO, dicho donde se ve: en móvil no hay hover, así que el tooltip no se abre y
   * el icono se queda mudo. El humano lo aceptó explícitamente el 2026-09-15 a cambio del
   * espacio. Con teclado sí hay ayuda: el tooltip abre también al enfocar.
   */
  soloIcono?: boolean;
  className?: string;
}

export function SegmentedToggle<T extends string>({
  options,
  valor,
  onChange,
  ariaLabel,
  soloIcono = false,
  className,
}: Readonly<SegmentedToggleProps<T>>) {
  return (
    <ButtonGroup aria-label={ariaLabel} className={className}>
      {options.map(({ valor: opcion, etiqueta, Icono, conteo }) => {
        const activa = valor === opcion;
        const variante = activa ? "default" : "outline";

        // El solo-icono EXIGE icono, y la condición es media funcionalidad: sin `Icono` el
        // botón saldría vacío —sin texto, sin dibujo y sin nada visible que pulsar— y nadie se
        // enteraría, porque el nombre accesible seguiría estando y los tests seguirían verdes.
        // Cae al botón de texto de abajo, que es lo que pinta el resto de la app.
        if (soloIcono && Icono) {
          return (
            // El patrón es el de la casa (`plantillas-columns.tsx`): el disparador ES el
            // botón, no un `<span>` envolvente, así que el nodo enfocable y el hijo directo
            // del `ButtonGroup` siguen siendo el mismo `<button>` de siempre. `Tooltip` no
            // pinta DOM y el contenido va a un portal, así que el redondeo de los extremos del
            // grupo —que el CSS resuelve por hijo directo— no se entera de que hay un tooltip.
            <Tooltip key={opcion}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={variante}
                    size="icon"
                    // El nombre accesible de la opción. NO es opcional: es lo único que queda
                    // de la etiqueta cuando deja de estar escrita.
                    aria-label={etiqueta}
                    aria-pressed={activa}
                    onClick={() => onChange(opcion)}
                  >
                    <Icono aria-hidden="true" />
                  </Button>
                }
              />
              <TooltipContent>{etiqueta}</TooltipContent>
            </Tooltip>
          );
        }

        return (
          <Button
            key={opcion}
            type="button"
            variant={variante}
            aria-pressed={activa}
            onClick={() => onChange(opcion)}
          >
            {Icono ? <Icono aria-hidden="true" /> : null}
            {etiqueta}
            {conteo === undefined ? null : (
              // El conteo va DENTRO del botón y no en un badge aparte: forma parte del nombre
              // accesible de la opción, así que un lector de pantalla anuncia «Pendientes (12)»
              // en vez de dejar el número suelto al lado.
              //
              // Entre PARÉNTESIS, y no a secas: es el mismo idioma con el que esta app escribe
              // los contadores de listado desde la feature 170 («Histórico (60)»), y sin ellos
              // el número queda pegado a la etiqueta —«Pendientes12»— tanto en el nombre
              // accesible como para quien lee la pestaña de un vistazo.
              <span className="tabular-nums opacity-70">({conteo})</span>
            )}
          </Button>
        );
      })}
    </ButtonGroup>
  );
}
