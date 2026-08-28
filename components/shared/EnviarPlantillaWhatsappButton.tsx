"use client";

import { useMemo, useState } from "react";
import { MessageCircle, MessageSquarePlus, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/useToast";
import {
  listarPlantillasParaEnvio,
  listarPlantillasParaEnvioTienda,
} from "@/lib/actions/whatsapp-envio";
import { renderPlantilla } from "@/lib/utils/plantilla-mensaje";
import { datosPlantillaDesdeAsignacion } from "@/lib/utils/whatsapp-envio-valores";
import { resolverValoresPlantilla, type DatosPlantilla } from "@/lib/types/plantilla-datos";
import { normalizarTelefonoCR } from "@/lib/utils/telefono-cr";
import type { PlantillaTextoDTO } from "@/lib/types/whatsapp-envio";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Integracion WhatsApp — boton que abre un bottom sheet con las plantillas disponibles
// (vigentes, no desactivadas), RENDERIZA cada una con los datos de la orden y, al elegir una,
// abre WhatsApp (wa.me) con el mensaje ya escrito hacia el telefono del destinatario. Quien
// contacta revisa y envia desde su propio WhatsApp. Movil-first (sheet inferior), a juego con
// `ContactoButtons`.
//
// PROMOVIDO a `components/shared/` el 2026-08-27, al aparecer el SEGUNDO consumidor en otro
// modulo (`/novedades`). Nacio en `mis-asignaciones/_components/` cuando solo lo usaba el panel
// del mensajero; la regla del repo es promover cuando hay evidencia de reuso, y aqui la hay.
// Ver el mismo razonamiento escrito en `FormSheet`.

export interface EnviarPlantillaWhatsappButtonProps {
  /** Orden en gestion: define el destino (telefono) y los valores de las variables. */
  orden: MiAsignacionDTO;
  /** `lg` = burbuja grande (size-14), a juego con ContactoButtons en el panel. */
  size?: "sm" | "lg";
  /**
   * Feature 120: cuando se provee, al elegir una plantilla NO se abre wa.me. En su lugar se
   * "pega" el mensaje ya renderizado en el input del chat (lo hace el padre con el callback)
   * para enviarlo desde el propio panel. Sin este prop se conserva el comportamiento wa.me
   * de la feature 87 (abrir WhatsApp del mensajero con el texto listo).
   */
  onElegirPlantilla?: (plantilla: { id: string; textoRenderizado: string }) => void;
  /**
   * Feature 120 (pedido humano): deshabilita el boton (y no abre el sheet). Lo usa la burbuja
   * del chat para no reenviar otra plantilla mientras se espera la respuesta del cliente.
   */
  disabled?: boolean;
  /**
   * Como se PRESENTA el disparador. Solo aplica al modo wa.me (con `onElegirPlantilla` manda
   * el modo chat, que tiene su propio icono).
   *
   * - `plantilla` (default): avion de papel. Es un boton de mas junto a «Llamar»/«WhatsApp»,
   *   y su icono tiene que decir que lo suyo son las plantillas.
   * - `whatsapp`: globo + tooltip «WhatsApp». OCUPA EL SITIO del enlace wa.me directo (que
   *   abria un chat vacio) en `/novedades`, asi que hereda su icono, su tooltip y su
   *   `aria-label` PALABRA POR PALABRA: para quien mira la pantalla el boton no se ha movido
   *   ni ha cambiado de nombre, solo hace mejor lo que ya prometia.
   */
  disparador?: "plantilla" | "whatsapp";
  /**
   * `true` SOLO en `/novedades`: anade a la lista las PLANTILLAS DE TIENDA, que es la unica
   * superficie donde se pueden usar (no se envian a Meta y no son del mensajero).
   *
   * Elige entre dos Server Actions distintas en vez de mandar un booleano al servidor: quien
   * decide el alcance es la pantalla, y asi el panel del mensajero no tiene forma de pedirlas
   * ni por error ni a mano.
   */
  incluirPlantillasDeTienda?: boolean;
}

export function EnviarPlantillaWhatsappButton({
  orden,
  size = "lg",
  onElegirPlantilla,
  disabled = false,
  disparador = "plantilla",
  incluirPlantillasDeTienda = false,
}: Readonly<EnviarPlantillaWhatsappButtonProps>) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [items, setItems] = useState<PlantillaTextoDTO[] | null>(null);

  const iconButtonClass = size === "lg" ? "size-14 shrink-0" : "shrink-0";
  const iconClass = size === "lg" ? "size-5" : "size-4";

  // Feature 120: modo "pegar en el chat" cuando el padre pasa el callback; si no, modo wa.me.
  const modoChat = Boolean(onElegirPlantilla);

  // Iconos y etiquetas DISTINTOS por modo (pedido humano): en wa.me el globo "envia fuera"
  // (abre WhatsApp); en el chat "redacta/pega" el mensaje en el propio input del panel.
  const comoWhatsapp = !modoChat && disparador === "whatsapp";
  const Icono = modoChat ? MessageSquarePlus : comoWhatsapp ? MessageCircle : Send;
  const ariaLabel = modoChat
    ? `Usar plantilla en el chat con ${orden.destinatario}`
    : comoWhatsapp
      ? `WhatsApp a ${orden.destinatario}`
      : `Enviar plantilla por WhatsApp a ${orden.destinatario}`;

  // Datos de la orden usados para resolver las variables de cada plantilla. El adaptador
  // declara que campos NO puede aportar esta superficie (el DTO de la asignacion no trae ni
  // fechas ni nada del mensajero): quedan vacios aqui y el envio real los resuelve en el
  // servidor. Ver `datosPlantillaDesdeAsignacion`.
  const datos = useMemo<DatosPlantilla>(() => datosPlantillaDesdeAsignacion(orden), [orden]);

  /** Renderiza el cuerpo de una plantilla con los valores de la orden. */
  function renderizar(plantilla: PlantillaTextoDTO): string {
    return renderPlantilla(plantilla.cuerpo, resolverValoresPlantilla(plantilla.variables, datos));
  }

  // Carga perezosa al abrir (se cachea en memoria): no se pide el catalogo hasta que hace falta.
  async function cargarSiHaceFalta() {
    if (items !== null || cargando) return;
    setCargando(true);
    try {
      const r = await (incluirPlantillasDeTienda
        ? listarPlantillasParaEnvioTienda()
        : listarPlantillasParaEnvio());
      if (r.status === "ok") {
        setItems(r.items);
      } else {
        setItems([]);
        toast.error("Tu sesión expiró. Vuelve a entrar.");
      }
    } finally {
      setCargando(false);
    }
  }

  function handleAbrir() {
    // Deshabilitado (p. ej. esperando la respuesta del cliente): no abre el sheet.
    if (disabled) return;
    setAbierto(true);
    void cargarSiHaceFalta();
  }

  /**
   * Feature 120: si hay callback, "pega" el mensaje renderizado en el input del chat (con su
   * plantillaId) y cierra el sheet; el envio ocurre desde el panel. Si no, conserva el flujo
   * wa.me de la feature 87: abre WhatsApp con el mensaje hacia el telefono del destinatario.
   */
  function handleElegir(plantilla: PlantillaTextoDTO) {
    const texto = renderizar(plantilla);
    if (onElegirPlantilla) {
      onElegirPlantilla({ id: plantilla.id, textoRenderizado: texto });
      setAbierto(false);
      return;
    }
    const url = `https://wa.me/${normalizarTelefonoCR(orden.telefonoDest)}?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank");
    setAbierto(false);
  }

  const boton = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={iconButtonClass}
      onClick={handleAbrir}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <Icono className={iconClass} aria-hidden="true" />
    </Button>
  );

  return (
    <>
      {/* El tooltip SOLO en el modo `whatsapp`, porque alli este boton sustituye a uno que ya
          lo tenia (`ContactoButtons`) y quitarselo seria una perdida. EL TOOLTIP NO ES EL
          NOMBRE DEL BOTON: el `aria-label` sigue puesto y nombra al destinatario concreto,
          porque un tooltip solo aparece con hover o foco. Mismo razonamiento, palabra por
          palabra, que la cabecera de `ContactoButtons`. */}
      {comoWhatsapp ? (
        <Tooltip>
          <TooltipTrigger render={boton} />
          <TooltipContent>WhatsApp</TooltipContent>
        </Tooltip>
      ) : (
        boton
      )}
      <Sheet open={abierto} onOpenChange={setAbierto}>
        {/* X propia (showCloseButton={false} desactiva la del componente compartido): la
            posicionamos absolute a 30px del borde derecho, siempre visible sobre el header. */}
        {/* El sheet DEBE caber en el viewport: si el contenido lo ensancha (>100vw), el borde
            derecho -y con el la X- se sale de pantalla. w-full + max-w-[100vw] + overflow-x-hidden
            lo clavan al ancho del dispositivo. */}
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[75vh] w-full max-w-[100vw] overflow-x-hidden"
        >
          <SheetClose
            aria-label="Cerrar"
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-3 right-3 z-10"
              />
            }
          >
            <X className="size-4" aria-hidden="true" />
          </SheetClose>
          {/* pr-12: deja hueco para el boton X. */}
          <SheetHeader className="pr-12">
            <SheetTitle>Plantillas de WhatsApp</SheetTitle>
            <SheetDescription>
              {modoChat
                ? `Elige una para pegar el mensaje en el chat, listo para enviar a ${orden.destinatario}.`
                : `Elige una para abrir WhatsApp con el mensaje listo para ${orden.destinatario}.`}
            </SheetDescription>
          </SheetHeader>

          {/* El scroll vive aqui, NO en el SheetContent: asi el boton X (que se posiciona
              respecto al SheetContent) queda fijo y visible aunque la lista sea larga. */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
            {cargando ? (
              <p className="text-sm text-muted-foreground">Cargando plantillas…</p>
            ) : items && items.length > 0 ? (
              items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleElegir(p)}
                  className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{p.nombre}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                      <Send className="size-3.5" aria-hidden="true" />
                      {modoChat ? "Usar" : "Abrir"}
                    </span>
                  </div>
                  {/* Vista previa. break-words: un texto largo sin espacios no ensancha el sheet. */}
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {renderizar(p)}
                  </p>
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No hay plantillas disponibles.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
