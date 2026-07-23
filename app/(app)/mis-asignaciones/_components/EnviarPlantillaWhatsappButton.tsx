"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/useToast";
import { listarPlantillasParaEnvio } from "@/lib/actions/whatsapp-envio";
import { renderPlantilla } from "@/lib/utils/plantilla-mensaje";
import { resolverValoresOrden } from "@/lib/utils/whatsapp-envio-valores";
import { normalizarTelefonoCR } from "@/lib/utils/telefono-cr";
import type { PlantillaTextoDTO, OrdenEnvioData } from "@/lib/types/whatsapp-envio";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Integracion WhatsApp — boton "burbuja" junto a los botones de contacto del panel del
// mensajero. Abre un bottom sheet con las plantillas disponibles (vigentes, no desactivadas),
// RENDERIZA cada una con los datos de la orden y, al elegir una, abre WhatsApp (wa.me) con el
// mensaje ya escrito hacia el telefono del destinatario. El mensajero revisa y envia desde su
// propio WhatsApp. Movil-first (sheet inferior), a juego con `ContactoButtons`.

export interface EnviarPlantillaWhatsappButtonProps {
  /** Orden en gestion: define el destino (telefono) y los valores de las variables. */
  orden: MiAsignacionDTO;
  /** `lg` = burbuja grande (size-14), a juego con ContactoButtons en el panel. */
  size?: "sm" | "lg";
}

export function EnviarPlantillaWhatsappButton({
  orden,
  size = "lg",
}: Readonly<EnviarPlantillaWhatsappButtonProps>) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [items, setItems] = useState<PlantillaTextoDTO[] | null>(null);

  const iconButtonClass = size === "lg" ? "size-14 shrink-0" : "shrink-0";
  const iconClass = size === "lg" ? "size-5" : "size-4";

  // Datos de la orden usados para resolver las variables de cada plantilla.
  const ordenEnvio = useMemo<OrdenEnvioData>(
    () => ({
      destinatario: orden.destinatario,
      telefonoDest: orden.telefonoDest,
      numGuia: orden.numGuia,
      numRemision: orden.numRemision,
      producto: orden.producto,
      direccion: orden.direccion,
      montoCobrar: orden.montoCobrar,
    }),
    [orden],
  );

  /** Renderiza el cuerpo de una plantilla con los valores de la orden. */
  function renderizar(plantilla: PlantillaTextoDTO): string {
    return renderPlantilla(plantilla.cuerpo, resolverValoresOrden(plantilla.variables, ordenEnvio));
  }

  // Carga perezosa al abrir (se cachea en memoria): no se pide el catalogo hasta que hace falta.
  async function cargarSiHaceFalta() {
    if (items !== null || cargando) return;
    setCargando(true);
    try {
      const r = await listarPlantillasParaEnvio();
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
    setAbierto(true);
    void cargarSiHaceFalta();
  }

  /** Abre WhatsApp con el mensaje renderizado hacia el telefono del destinatario. */
  function handleElegir(plantilla: PlantillaTextoDTO) {
    const texto = renderizar(plantilla);
    const url = `https://wa.me/${normalizarTelefonoCR(orden.telefonoDest)}?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank");
    setAbierto(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={iconButtonClass}
        onClick={handleAbrir}
        aria-label={`Enviar plantilla de WhatsApp a ${orden.destinatario}`}
      >
        <MessageCircle className={iconClass} aria-hidden="true" />
      </Button>
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
              Elige una para abrir WhatsApp con el mensaje listo para {orden.destinatario}.
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
                      Abrir
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
