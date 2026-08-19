"use client";

import { Power, RotateCcw, Undo2 } from "lucide-react";

import { ContactoButtons } from "@/components/shared/ContactoButtons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NovedadDTO } from "@/lib/types/novedad";

import { IntentoContactoAccion } from "./IntentoContactoAccion";

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
//
// ⚠️ RETIRADO 2026-08-18 (pedido humano): el botón «Notas», que era la puerta —y la ÚNICA— por la
// que esta pantalla abría el HILO de la orden (feature 227/T3.3). Con él se fue el montaje de
// `HiloNotasNovedadModal` en `NovedadesModule`.
//
// CONSECUENCIA, escrita aquí para que nadie la redescubra depurando: desde `/novedades` la tienda
// YA NO LEE NI RESPONDE el hilo. Eso incluye el MOTIVO de una solicitud de ayuda, que el mensajero
// publica precisamente como una nota de ese hilo — la tienda ve que la orden pidió ayuda (el badge)
// y puede registrar intentos de contacto, pero no lee lo que el mensajero escribió.
//
// Lo que NO se tocó: el hilo sigue vivo entero (tabla, service, Server Actions) y el mensajero lo
// sigue leyendo y escribiendo desde su panel. `HiloNotasNovedadModal.tsx` se conserva en disco sin
// montar: está en la lista firmada de la guardia `orden-nota-frontera`, así que borrarlo es una
// decisión aparte y no la consecuencia de quitar un botón.

export interface NovedadAccionesProps {
  novedad: NovedadDTO;
  /** Abre el modal de reprogramación para esta orden (feature 100/T3.1). */
  onReprogramar: (novedad: NovedadDTO) => void;
  /** MAQUETA: sin comportamiento decidido (ver la cabecera de este archivo). */
  onHabilitar: (novedad: NovedadDTO) => void;
  /** MAQUETA: sin comportamiento decidido (ver la cabecera de este archivo). */
  onDevolver: (novedad: NovedadDTO) => void;
}

export function NovedadAcciones({
  novedad,
  onReprogramar,
  onHabilitar,
  onDevolver,
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
  //
  // ⚠️ Pedido humano 2026-08-18 — ESTA PANTALLA LISTA TAMBIÉN ÓRDENES QUE NO ESTÁN DEVUELTAS: las
  // que tienen una solicitud de ayuda viva (`OrdenRepository.novedadWhere`), que siguen en reparto.
  // «Reprogramar» y «Devolver» presuponen una devolución, así que sobre una de ésas no se ofrecen.
  //
  // Y no es cosmética: `ReprogramacionTiendaService` ya rechaza con `conflict` toda orden que no
  // esté en `devuelta` (comprobado, es la guarda real). Ofrecer el botón igual sólo consigue que
  // la tienda descubra el límite pulsándolo. Los otros dos son maqueta, así que ahí lo único que
  // se evita es un aviso sobre una acción que además no aplicaba.
  //
  // Lo que SÍ se conserva siempre: el contacto (llamar/WhatsApp) y, sobre una orden con ayuda
  // pedida, «+1 intento de contacto».
  const esDevuelta = novedad.estatusValue === "devuelta";
  // «HABILITAR» ES LA EXCEPCIÓN (pedido humano 2026-08-18): también se ofrece cuando hay una
  // SOLICITUD DE AYUDA viva. Es el desenlace de esa solicitud del lado de la tienda — su modal
  // exige una nota, y al confirmar RESCATA la orden (`ayuda_tienda → en_reparto`, por el punto
  // único de la 235) y con eso sale de esta pantalla. Las otras dos siguen atadas a `devuelta`
  // porque presuponen una devolución que sobre una orden con ayuda no existe.
  //
  // FEATURE 235 (T5.4) — TRADUCCION LITERAL, NO ARREGLO. Era `novedad.ayuda === true` y pasa a ser
  // la igualdad de estado equivalente. El comportamiento visible es EXACTAMENTE el mismo.
  //
  // ⚠️ Que «Habilitar» aparezca justo en las cards que vienen de un cierre -el punto 12 del pedido
  // humano, AL REVES de lo que pedia- sigue aqui y se corrige en la FICHA 240. Adelantarlo en esta
  // ficha seria tocar la card que la 236 esta reescribiendo, y la puerta humana del 2026-08-19
  // asigno cada cosa a su ficha.
  const esAyuda = novedad.estatusValue === "ayuda_tienda";
  const puedeHabilitar = esDevuelta || esAyuda;
  const acciones: {
    etiqueta: string;
    Icono: typeof RotateCcw;
    onClick: () => void;
  }[] = [
    ...(esDevuelta
      ? [
          {
            etiqueta: "Reprogramar",
            Icono: RotateCcw,
            onClick: () => onReprogramar(novedad),
          },
        ]
      : []),
    ...(puedeHabilitar
      ? [{ etiqueta: "Habilitar", Icono: Power, onClick: () => onHabilitar(novedad) }]
      : []),
    // Pedido humano 2026-08-19 — el botón se LLAMA «Rechazar» (etiqueta visible, tooltip y
    // `aria-label`); antes decía «Devolver». Sólo cambia el nombre: sigue siendo la misma maqueta
    // con el mismo handler `onDevolver` y el mismo icono, que es el que el panel del mensajero usa
    // para su desenlace. El prop conserva su nombre porque nombra la transición que falta decidir,
    // no el rótulo del control.
    ...(esDevuelta
      ? [{ etiqueta: "Rechazar", Icono: Undo2, onClick: () => onDevolver(novedad) }]
      : []),
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
      {/* Pedido humano 2026-08-18 — «+1 intento de contacto» y su contador, SOLO sobre una orden
          con ayuda pedida. Va al final de la fila y no entre las otras: las de arriba resuelven
          la orden (la reprograman, la habilitan, la devuelven) y ésta no resuelve nada — deja
          constancia de que se intentó. Mezclarla con ellas sugeriría que también cambia algo.

          No entra en el arreglo `acciones` de arriba porque no comparte su forma: lleva estado
          propio, llama a su Server Action y arrastra un contador al lado. Meterla ahí habría
          obligado a que aquella lista supiera de todo eso para una sola de sus entradas. */}
      {esAyuda ? <IntentoContactoAccion novedad={novedad} /> : null}
    </div>
  );
}
