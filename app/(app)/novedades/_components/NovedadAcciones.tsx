"use client";

import { MessagesSquare, Power, RotateCcw, Undo2 } from "lucide-react";

import { ContactoButtons } from "@/components/shared/ContactoButtons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { grupoDeEstatus } from "@/lib/types/novedad-grupo";
import type { NovedadDTO } from "@/lib/types/novedad";

import { IntentoContactoAccion } from "./IntentoContactoAccion";
import {
  ACCIONES_POR_GRUPO,
  ACCIONES_SIN_GRUPO,
  type AccionNovedad,
} from "./novedad-acciones-catalogo";

// 2026-08-12 (pedido humano) — LAS ACCIONES de una novedad, extraídas para viajar como un
// solo nodo en la prop `acciones` de la card POS: `acciones={<NovedadAcciones … />}`.
//
// Siguen siendo exclusivas de esta pantalla: la card no las conoce, sólo les hace sitio al pie. Ése
// es el reparto que permite reutilizar la card sin que las órdenes del mensajero hereden botones
// que allí no van (su contacto vive en el panel de gestión).
//
// La card las aloja dentro de su `<article>` y su gate de selección ignora los clicks que
// nacen en un control (`pos-seleccion`), así que ninguno de estos botones puede seleccionar
// la orden de rebote — hoy da igual, porque la card de novedades no es seleccionable, y
// mañana no habrá que acordarse.
//
// =================================================================================================
// ⚠️ FEATURE 236 (T5.2, design §6 — R18/R19/R21) — QUÉ SE OFRECE YA NO SE DECIDE AQUÍ.
// =================================================================================================
//
// Hasta el 2026-08-19 este componente lo decidía con CONDICIONES SUELTAS (`esDevuelta`, `esAyuda`,
// `puedeHabilitar = esDevuelta || esAyuda`, tres `...(cond ? [x] : [])` y un `{esAyuda ? … : null}`
// al final). Ese diseño **ya produjo un defecto** —«Habilitar» aparece justo en las cards que vienen
// de un cierre, al revés de lo que el pedido decía— y lo produjo porque nada obligaba a la sexta
// condición: se añadía una acción y ningún sitio reclamaba la decisión para el otro grupo.
//
// Ahora el juego sale de `ACCIONES_POR_GRUPO`, indexada por el MISMO `GrupoNovedad` que el servidor
// usa para decidir qué lista. Lo que queda aquí es cómo se PINTA cada acción, no cuál se ofrece.
// (El defecto del punto 12 se conserva **tal cual**, ahora como una celda de esa tabla: su dueño es
// la ficha 240. Ver el comentario de la tabla.)
//
// =================================================================================================
// ⚠️ FEATURE 236 (T6.1/T6.7, R27) — LA TIENDA VUELVE A LEER EL HILO, Y AQUÍ ESTÁ LA PUERTA.
// =================================================================================================
//
// **Lo que decía este archivo hasta el 2026-08-19, y ya no es cierto:** «desde `/novedades` la
// tienda YA NO LEE NI RESPONDE el hilo. Eso incluye el MOTIVO de una solicitud de ayuda». Era la
// consecuencia de que el 2026-08-18 se retirara el botón «Notas» (pedido humano) y con él el único
// montaje de `HiloNotasNovedadModal`.
//
// **Qué cambió y por qué se cuenta en vez de borrarlo:** la 235 hizo la nota del mensajero
// OBLIGATORIA al pedir ayuda, así que a partir de ella el motivo se escribía y nadie podía leerlo.
// Esta ficha repone la superficie con la acción «Conversación» —el MISMO gesto y el mismo montaje
// que el lado mensajero (`HiloNotasAyudaModal` desde su card, feature 235/R35)— y con eso los dos
// roles con ventana de escritura sobre `ayuda_tienda` tienen dónde ejercerla (R36). No se escribió
// ningún hilo nuevo: el modal estaba entero en disco, sin montar.
//
// **No es un botón «Notas» de vuelta en las cards de devolución**: la conversación sale de la tabla
// y hoy la tabla sólo se la da al grupo de ayuda.

export interface NovedadAccionesProps {
  novedad: NovedadDTO;
  /** Abre el modal de reprogramación para esta orden (feature 100/T3.1). */
  onReprogramar: (novedad: NovedadDTO) => void;
  /** Abre el modal de «Habilitar» (nota obligatoria) que dispara el rescate de la 235. */
  onHabilitar: (novedad: NovedadDTO) => void;
  /** MAQUETA: «Rechazar» todavía no tiene transición detrás; avisa por toast (ficha 240). */
  onDevolver: (novedad: NovedadDTO) => void;
  /** Feature 236 (R27): abre el HILO de notas de esta orden. */
  onConversacion: (novedad: NovedadDTO) => void;
}

/** Cómo se pinta una acción de icono: su etiqueta visible, su icono y cómo se nombra a sí misma. */
interface AccionIcono {
  /** Texto del tooltip. Es la ayuda VISUAL de quien ve el icono y no lo reconoce. */
  etiqueta: string;
  Icono: typeof RotateCcw;
  /**
   * Nombre accesible del control. NO es el tooltip: un tooltip aparece al pasar el puntero o al
   * enfocar, y quien navega con lector de pantalla necesita el nombre en el propio control —igual
   * que quien usa la pantalla táctil de un móvil, donde no hay hover que lo revele—. Es más largo a
   * propósito porque nombra la orden concreta de la fila, que es lo que distingue un «Reprogramar»
   * de los diez de la lista.
   */
  nombreAccesible: (destinatario: string) => string;
  onClick: (novedad: NovedadDTO, props: NovedadAccionesProps) => void;
}

/**
 * Los iconos NO se eligieron por parecerse a la palabra: `RotateCcw` y `Undo2` son los MISMOS que
 * el panel de gestión del mensajero usa para «Reprogramar» y «Devolver» (`GestionarOrdenPanel`),
 * así que las dos pantallas dicen lo mismo con el mismo dibujo. `Power` es propio de «Habilitar»
 * —no lo usa nadie más en el repo— porque esa acción no tiene gemela en ninguna otra superficie, y
 * `MessagesSquare` es propio de «Conversación» por el mismo motivo: dos globos son dos personas
 * hablando, que es exactamente lo que el hilo de la orden es.
 */
const ICONO_POR_ACCION: Record<
  Exclude<AccionNovedad, "contacto" | "intentoContacto">,
  AccionIcono
> = {
  reprogramar: {
    etiqueta: "Reprogramar",
    Icono: RotateCcw,
    nombreAccesible: (destinatario) => `Reprogramar la orden de ${destinatario}`,
    onClick: (novedad, props) => props.onReprogramar(novedad),
  },
  habilitar: {
    etiqueta: "Habilitar",
    Icono: Power,
    nombreAccesible: (destinatario) => `Habilitar la orden de ${destinatario}`,
    onClick: (novedad, props) => props.onHabilitar(novedad),
  },
  // Pedido humano 2026-08-19 — el botón se LLAMA «Rechazar» (etiqueta visible, tooltip y nombre
  // accesible); antes decía «Devolver». El prop conserva su nombre porque nombra la transición que
  // falta decidir, no el rótulo del control.
  rechazar: {
    etiqueta: "Rechazar",
    Icono: Undo2,
    nombreAccesible: (destinatario) => `Rechazar la orden de ${destinatario}`,
    onClick: (novedad, props) => props.onDevolver(novedad),
  },
  // Feature 236 (R27). El rótulo es «Conversación», el MISMO que el lado mensajero (`RepartoModule`
  // › `AYUDA_ACCION_HILO`): las dos pantallas nombran igual el mismo hilo. El nombre accesible se
  // aparta de la gramática «<Verbo> la orden de X» porque aquí el verbo no es la palabra visible;
  // «Conversación la orden de Ana» no es español.
  conversacion: {
    etiqueta: "Conversación",
    Icono: MessagesSquare,
    nombreAccesible: (destinatario) =>
      `Abrir la conversación de la orden de ${destinatario}`,
    onClick: (novedad, props) => props.onConversacion(novedad),
  },
};

export function NovedadAcciones(props: NovedadAccionesProps) {
  const { novedad } = props;

  // R21 — FALLO CERRADO. El grupo sale del estado por `grupoDeEstatus`, que se deriva del MISMO
  // mapa que el predicado del servidor. `null` (un estado que no pertenece a ningún grupo) deja la
  // fila con lo que no resuelve nada: el contacto y nada más.
  const grupo = grupoDeEstatus(novedad.estatusValue);
  const acciones: readonly AccionNovedad[] = grupo
    ? ACCIONES_POR_GRUPO[grupo]
    : ACCIONES_SIN_GRUPO;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {acciones.map((accion) => {
        if (accion === "contacto") {
          return (
            <ContactoButtons
              key={accion}
              telefono={novedad.telefonoDest}
              nombre={novedad.destinatario}
            />
          );
        }
        // «+1 intento de contacto» no comparte la forma de las de icono: lleva estado propio, llama
        // a su Server Action y arrastra un contador al lado. Y no resuelve la orden —deja constancia
        // de que se intentó—, por eso la tabla la pone al final y no entre las otras.
        if (accion === "intentoContacto") {
          return <IntentoContactoAccion key={accion} novedad={novedad} />;
        }
        const { etiqueta, Icono, nombreAccesible, onClick } = ICONO_POR_ACCION[accion];
        return (
          <Tooltip key={accion}>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  // `icon` (size-8) y no `icon-sm`: es el mismo cuadrado que ya tienen
                  // «Llamar» y «WhatsApp» a su izquierda (`ContactoButtons` en tamaño `sm`),
                  // y varios botones en fila con dos tamaños distintos se leen como dos
                  // grupos de acciones que aquí no existen.
                  size="icon"
                  className="shrink-0"
                  onClick={() => onClick(novedad, props)}
                  aria-label={nombreAccesible(novedad.destinatario)}
                >
                  <Icono className="size-4" aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>{etiqueta}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
