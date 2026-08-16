"use client";

import { MessageSquareText, Power, RotateCcw, Undo2 } from "lucide-react";

import { ContactoButtons } from "@/components/shared/ContactoButtons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NovedadDTO } from "@/lib/types/novedad";

// 2026-08-12 (pedido humano) — LAS ACCIONES de una novedad, extraídas para viajar como un
// solo nodo en la prop `acciones` de la card POS: `acciones={<NovedadAcciones … />}`.
//
// Son las de la fila de `/novedades` —WhatsApp y Llamar (`ContactoButtons`, feature
// 87/R12/R15/R16) y "Reprogramar" (feature 100/R1)— y siguen siendo exclusivas de esta
// pantalla: la card no las conoce, sólo les hace sitio al pie. Ése es el reparto que
// permite reutilizar la card sin que las órdenes del mensajero hereden botones que allí no
// van (su contacto vive en el panel de gestión).
//
// ⚠️ MAQUETA DECLARADA (2026-08-12, decisión del humano) — "Habilitar" y "Devolver" son
// DOS BOTONES SIN TRANSICIÓN DETRÁS. Su semántica todavía no está decidida y NO existe en
// el repo: no hay Server Action, ni service, ni cambio de estatus para ninguno de los dos
// (se buscó: "Habilitar" no aparece en ningún sitio, y los dos "Devolver" que existen son
// otra cosa — el desenlace de gestión del mensajero, que marca la orden `devuelta`, y
// `devolverATienda` de la feature 48, que la devuelve DESDE bodega y no aplica a una orden
// ya devuelta).
//
// Lo que SÍ es real y está probado: "Habilitar" abre su modal y ese modal EXIGE una nota
// para poder confirmar (`HabilitarNovedadModal`). Lo que falta es qué pasa al confirmar.
//
// Qué falta para que dejen de ser maqueta, y por qué no se resolvió aquí: cada uno es una
// transición de estado con consecuencias fuera de esta pantalla —el plazo de la feature
// 102 corre desde la devolución, así que "habilitar" una orden decide si el SLA se
// reinicia, se congela o sigue— y eso se decide en un spec, no en un `onClick`.
//
// Mientras tanto los dos avisan por toast que no están disponibles. Es deliberado: un
// botón que no hace NADA al pulsarlo se lee como un bug de la app, y uno deshabilitado sin
// explicación se lee como "no tenés permiso". El día que se cableen, lo único que cambia
// es el cuerpo de los dos handlers que el módulo pasa.
//
// La card las aloja dentro de su `<article>` y su gate de selección ignora los clicks que
// nacen en un control (`pos-seleccion`), así que ninguno de estos botones puede seleccionar
// la orden de rebote — hoy da igual, porque la card de novedades no es seleccionable, y
// mañana no habrá que acordarse.

export interface NovedadAccionesProps {
  novedad: NovedadDTO;
  /** Abre el modal de reprogramación para esta orden (feature 100/T3.1). */
  onReprogramar: (novedad: NovedadDTO) => void;
  /** MAQUETA: sin comportamiento decidido (ver la cabecera de este archivo). */
  onHabilitar: (novedad: NovedadDTO) => void;
  /** MAQUETA: sin comportamiento decidido (ver la cabecera de este archivo). */
  onDevolver: (novedad: NovedadDTO) => void;
  /**
   * Feature 227 (T3.3): abre el HILO de notas de esta orden. Es la puerta —y la única— por
   * la que se pide el hilo: la card no lo trae, la lista no lo pide (design §4/A6).
   */
  onNotas: (novedad: NovedadDTO) => void;
}

export function NovedadAcciones({
  novedad,
  onReprogramar,
  onHabilitar,
  onDevolver,
  onNotas,
}: NovedadAccionesProps) {
  // Los tres botones de acción comparten forma (outline · icono) y patrón de `aria-label`
  // («<Verbo> la orden de <destinatario>»), que es lo que los distingue entre sí cuando la
  // lista trae varias filas y el icono de todos los "Reprogramar" es el mismo.
  //
  // 2026-08-12 (pedido humano): pasan de TEXTO a ICONO + TOOLTIP, con el patrón que ya usa
  // el repo (`EtiquetaOrdenAccion`, `ReportarIncidenteAccion`): `TooltipTrigger render={…}`
  // envolviendo el `Button`, para que el disparador SEA el botón y no un `<span>` extra que
  // rompa el foco de teclado.
  //
  // EL TOOLTIP NO ES EL NOMBRE DEL BOTÓN, y por eso el `aria-label` se conserva palabra por
  // palabra. Un tooltip aparece al pasar el puntero o al enfocar; quien navega con lector
  // de pantalla necesita el nombre en el propio control, y quien usa la pantalla táctil de
  // un móvil no tiene hover con el que descubrirlo. El texto corto del tooltip es la ayuda
  // VISUAL de quien ve el icono y no lo reconoce; el `aria-label` es el nombre accesible,
  // más largo a propósito porque nombra la orden concreta de la fila.
  //
  // Los iconos NO se eligieron por parecerse a la palabra: `RotateCcw` y `Undo2` son los
  // MISMOS que el panel de gestión del mensajero ya usa para "Reprogramar" y "Devolver"
  // (`GestionarOrdenPanel`), así que las dos pantallas dicen lo mismo con el mismo dibujo.
  // `Power` es propio de "Habilitar" —no lo usa nadie más en el repo— porque esa acción no
  // tiene gemela en ninguna otra superficie.
  const acciones: {
    etiqueta: string;
    Icono: typeof RotateCcw;
    onClick: () => void;
  }[] = [
    {
      etiqueta: "Reprogramar",
      Icono: RotateCcw,
      onClick: () => onReprogramar(novedad),
    },
    { etiqueta: "Habilitar", Icono: Power, onClick: () => onHabilitar(novedad) },
    { etiqueta: "Devolver", Icono: Undo2, onClick: () => onDevolver(novedad) },
    // Feature 227 (T3.3): "Notas" NO es maqueta —abre el hilo real y lo carga en ese
    // momento—. Va con los demás y con el mismo patrón de `aria-label` porque es una acción
    // más de la fila; el icono es propio (`MessageSquareText`) para no chocar con el
    // `MessageCircle` que el panel del mensajero usa para el CHAT con el cliente, que es
    // otra conversación y otro canal.
    //
    // ⚠️ D3: esto es lo ÚNICO que se añade a la pantalla. NO hay badge, punto ni contador de
    // "hay notas" en ninguna card: esta feature acaba de RETIRAR los de la nota privada de
    // esas mismas cards (R21) y no se retiran unos para poner otros. La señal llega con la
    // ficha 228; hasta entonces, el hilo se descubre abriéndolo.
    { etiqueta: "Notas", Icono: MessageSquareText, onClick: () => onNotas(novedad) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ContactoButtons
        telefono={novedad.telefonoDest}
        nombre={novedad.destinatario}
      />
      {acciones.map(({ etiqueta, Icono, onClick }) => (
        <Tooltip key={etiqueta}>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                // `icon` (size-8) y no `icon-sm`: es el mismo cuadrado que ya tienen
                // "Llamar" y "WhatsApp" a su izquierda (`ContactoButtons` en tamaño `sm`),
                // y cinco botones en fila con dos tamaños distintos se leen como dos
                // grupos de acciones que aquí no existen.
                size="icon"
                className="shrink-0"
                onClick={onClick}
                aria-label={`${etiqueta} la orden de ${novedad.destinatario}`}
              >
                <Icono className="size-4" aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent>{etiqueta}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
