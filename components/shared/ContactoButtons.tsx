"use client";

import { MessageCircle, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { normalizarTelefonoCR } from "@/lib/utils/telefono-cr";

// Feature 87 (T10, design §3.3) — compuesto reutilizable de botones de CONTACTO al cliente:
// "Llamar" (`tel:`, R16) y "WhatsApp" (`wa.me/<normalizado>`, R12/R15). Extraido de los
// botones inline de `GestionarOrdenPanel` (deduplicacion, R17) y corrige de paso el bug
// heredado del enlace `wa.me` sin prefijo `506` (R15) usando `normalizarTelefonoCR`. Se usa
// en `/novedades` (lista, tamano `sm`) y en el panel del mensajero (tamano `lg` = size-14).
//
// 2026-08-12 (pedido humano) — LOS DOS BOTONES LLEVAN TOOLTIP. El arreglo vive AQUÍ y no en
// `/novedades` envolviendo el componente desde fuera: estos botones son SOLO-ICONO en todos
// sus consumidores (`NovedadAcciones`, `GestionarOrdenPanel`, `EnviarPlantillaWhatsappButton`
// y `RecoleccionModule`), así que la falta de ayuda visual era del componente, no de una
// pantalla. Envolverlo desde una sola pantalla habría dejado a las otras tres con el mismo
// icono mudo y con dos formas distintas de decir lo mismo.
//
// EL TOOLTIP NO ES EL NOMBRE DEL BOTÓN — mismo razonamiento que ya está escrito en la
// cabecera de `NovedadAcciones`. Por eso los `aria-label` se conservan PALABRA POR PALABRA
// («Llamar a <nombre>», «WhatsApp a <nombre>»): un tooltip sólo aparece al pasar el puntero
// o al enfocar, así que quien usa lector de pantalla necesita el nombre en el propio
// control, y quien va en una pantalla táctil no tiene hover con el que descubrirlo. El
// texto corto del tooltip es la ayuda VISUAL de quien ve el icono y no lo reconoce; el
// `aria-label`, más largo a propósito, nombra al destinatario concreto de esa fila.
//
// El disparador es EL BOTÓN (`TooltipTrigger render={<Button …/>}`, el patrón que ya usan
// `NovedadAcciones`, `EtiquetaOrdenAccion` y `ReportarIncidenteAccion`) y no un `<span>`
// envolvente, que añadiría un nodo extra al recorrido de teclado sin ser accionable.

export interface ContactoButtonsProps {
  /** Telefono del destinatario (crudo, tal cual viene de la orden). */
  telefono: string;
  /** Nombre del destinatario, para los aria-label accesibles. */
  nombre: string;
  /** `lg` = botones grandes (size-14, panel del mensajero); `sm`/default = compacto (lista). */
  size?: "sm" | "lg";
  /**
   * Muestra el boton de WhatsApp (wa.me directo). `true` por defecto. En el panel del mensajero
   * se pone `false` porque alli el WhatsApp lo cubre el selector de plantillas (una sola burbuja,
   * sin ambiguedad con el enlace directo).
   */
  mostrarWhatsapp?: boolean;
}

/** Botones "Llamar" + "WhatsApp" accesibles, con el telefono normalizado en el enlace wa.me. */
export function ContactoButtons({
  telefono,
  nombre,
  size = "sm",
  mostrarWhatsapp = true,
}: ContactoButtonsProps) {
  const iconButtonClass = size === "lg" ? "size-14 shrink-0" : "shrink-0";
  const iconClass = size === "lg" ? "size-5" : "size-4";

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={iconButtonClass}
              onClick={() => window.open(`tel:${telefono}`, "_self")}
              aria-label={`Llamar a ${nombre}`}
            >
              <Phone className={iconClass} aria-hidden="true" />
            </Button>
          }
        />
        <TooltipContent>Llamar</TooltipContent>
      </Tooltip>
      {mostrarWhatsapp ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={iconButtonClass}
                onClick={() =>
                  window.open(
                    `https://wa.me/${normalizarTelefonoCR(telefono)}`,
                    "_blank",
                  )
                }
                aria-label={`WhatsApp a ${nombre}`}
              >
                <MessageCircle className={iconClass} aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent>WhatsApp</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
