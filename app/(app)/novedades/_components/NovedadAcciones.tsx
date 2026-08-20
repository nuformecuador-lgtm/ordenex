"use client";

import { MessagesSquare, Power, RotateCcw, Undo2 } from "lucide-react";

import { ContactoButtons } from "@/components/shared/ContactoButtons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { grupoDeEstatus } from "@/lib/types/novedad-grupo";
import type { NovedadDTO } from "@/lib/types/novedad";

import type { ModoGestionDesdeAyuda } from "./GestionarDesdeAyudaModal";
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
//
// ⚠️ **FEATURE 240 (T5.1, R33 — 2026-08-20): el punto 12 ya no está aquí.** Hasta hoy esta nota
// terminaba diciendo «el defecto del punto 12 se conserva **tal cual**, ahora como una celda de esa
// tabla: su dueño es la ficha 240». La 240 borró esa celda: «Habilitar» sale del grupo de devolución
// y queda sólo en el de ayuda. Que corregirlo haya sido borrar UNA PALABRA de una tabla —y no
// desenredar cinco condiciones sueltas repartidas por este archivo— es exactamente lo que la 236
// compró al centralizarlo.
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
//
// =================================================================================================
// ⚠️ FEATURE 237 (T7.1, R1) — LA FILA DE AYUDA PASA DE «AVISAR» A «RESOLVER», Y ESO CUESTA DINERO.
// =================================================================================================
//
// Hasta el 2026-08-20 la tienda podía leer el problema, responder en el hilo y devolverle la orden
// al mensajero, pero no RESOLVERLA. Esta ficha añade sus dos desenlaces —«Reprogramar» y
// «Rechazar»— y hay que decir aquí lo que un clic dispara: la gestión que crean se atribuye al
// MENSAJERO, entra en su cierre del día, suma un intento de entrega y mueve el mismo dinero (los
// hasta ₡1.000 de un rechazo —`cobroRechazado`— NO se le cobran a la tienda: son **ingreso de
// bodega** y caen en el cierre DEL MENSAJERO, medido. A la tienda un rechazo **sí** le cuesta, pero
// por otra vía: el **flete de devolución** más IVA). El precio se dice con palabras en la ventana
// (`GestionarDesdeAyudaModal`, aviso fijo de D7), no en este panel: aquí sólo se abre la puerta.
//
// Las dos acciones cuelgan de `ACCIONES_POR_GRUPO` como CELDAS, no de una condición suelta. Es la
// misma regla de arriba y no una repetición ociosa: `reprogramar`/`rechazar` (del grupo de
// devolución) llaman a OTRO servicio, así que reutilizar sus claves obligaría a ramificar por grupo
// dentro de este componente — la decisión fuera de la tabla que la guardia de la 236 caza.

export interface NovedadAccionesProps {
  novedad: NovedadDTO;
  /** Abre el modal de reprogramación para esta orden (feature 100/T3.1). */
  onReprogramar: (novedad: NovedadDTO) => void;
  /** Abre el modal de «Habilitar» (nota obligatoria) que dispara el rescate de la 235. */
  onHabilitar: (novedad: NovedadDTO) => void;
  /**
   * 💰 Feature 240 (T5.3/R27): abre la ventana con la que la tienda RECHAZA una orden de la
   * devolución anclada (`RechazarNovedadModal`).
   *
   * ⚠️ **Hasta el 2026-08-20 esta prop se llamaba `onDevolver` y su JSDoc decía «MAQUETA:
   * «Rechazar» todavía no tiene transición detrás; avisa por toast (ficha 240)».** Las dos cosas
   * dejaron de ser ciertas a la vez: la transición existe (`devuelta → rechazada` decidida por la
   * tienda) y el nombre viejo nombraba la transición que faltaba decidir. Ya está decidida, así que
   * el nombre pasa a decir la verdad.
   */
  onRechazar: (novedad: NovedadDTO) => void;
  /** Feature 236 (R27): abre el HILO de notas de esta orden. */
  onConversacion: (novedad: NovedadDTO) => void;
  /**
   * Feature 237 (T7.1/T7.3): abre `GestionarDesdeAyudaModal` sobre esta orden en el modo pedido.
   *
   * **UN solo handler para las dos acciones, con el modo como parámetro**, y no dos props: las dos
   * abren la MISMA ventana y sólo cambian el rótulo y el campo de fecha. Dos props obligarían al
   * padre a mantener dos estados que nunca pueden estar abiertos a la vez.
   */
  onGestionarDesdeAyuda: (novedad: NovedadDTO, modo: ModoGestionDesdeAyuda) => void;
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
  // accesible); antes decía «Devolver».
  //
  // ⚠️ **FEATURE 240 (T5.3/T5.4, 2026-08-20).** Aquí decía: «El prop conserva su nombre porque
  // nombra la transición que falta decidir, no el rótulo del control». Esa transición ya está
  // decidida y declarada (`devuelta → rechazada`, familia propia, decidida por la tienda dueña), así
  // que el prop pasa a llamarse `onRechazar` y el rótulo y el nombre coinciden. El RÓTULO, el
  // tooltip, el icono y el nombre accesible no cambian: lo que cambia es que ahora hay algo detrás.
  rechazar: {
    etiqueta: "Rechazar",
    Icono: Undo2,
    nombreAccesible: (destinatario) => `Rechazar la orden de ${destinatario}`,
    onClick: (novedad, props) => props.onRechazar(novedad),
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
  // ===============================================================================================
  // FEATURE 237 (T7.1, D7 firmada) — LOS DOS DESENLACES QUE LA TIENDA PUEDE REGISTRAR DESDE AYUDA.
  // ===============================================================================================
  //
  // Los RÓTULOS son «Reprogramar» y «Rechazar», sin la palabra «entrega» detrás y sin el verbo
  // «gestionar»: 236/D6 firmó «gestionar» como VERBO DEL MENSAJERO, y aquí ese verbo describe el
  // efecto —que se dice en el aviso de la ventana—, no la acción del botón.
  //
  // Los ICONOS son los MISMOS que las acciones homónimas del grupo de devolución, y eso es
  // deliberado: `RotateCcw` y `Undo2` son los que el panel de gestión del mensajero usa para
  // «Reprogramar» y «Devolver», así que las tres pantallas dicen lo mismo con el mismo dibujo. Las
  // dos parejas NUNCA coinciden en una fila —cada una vive en un grupo— así que no hay ambigüedad
  // que resolver con un icono distinto sólo por distinguir.
  reprogramarDesdeAyuda: {
    etiqueta: "Reprogramar",
    Icono: RotateCcw,
    nombreAccesible: (destinatario) => `Reprogramar la orden de ${destinatario}`,
    onClick: (novedad, props) => props.onGestionarDesdeAyuda(novedad, "reprogramar"),
  },
  rechazarDesdeAyuda: {
    etiqueta: "Rechazar",
    Icono: Undo2,
    nombreAccesible: (destinatario) => `Rechazar la orden de ${destinatario}`,
    onClick: (novedad, props) => props.onGestionarDesdeAyuda(novedad, "rechazar"),
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
