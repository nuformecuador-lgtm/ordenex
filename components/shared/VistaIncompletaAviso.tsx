"use client";

import { Modal } from "@/components/shared/Modal";
import type { PartePerdida } from "@/lib/utils/vista-filtro-aplicabilidad";

// FICHA 453 (design §8.2, T4.3) — EL AVISO DE LA VISTA QUE NO SE PUEDE APLICAR ENTERA.
//
// ⚠️ ES UN AVISO **ANTES**, NO UN AVISO **DESPUÉS**, y esa es toda la ficha en una decisión.
// Aplicar lo que se puede y contarlo a la vez deja el listado ya cambiado mientras la persona
// lee: quien mire para otro lado dos segundos se queda filtrando otra cosa sin saberlo. Exigir un
// clic convierte la pérdida en RECONOCIDA en vez de ANUNCIADA (R25, R30), y es un clic de más en
// un caso que por construcción es raro.
//
// Y tampoco se niega del todo: una vista con un mensajero dado de baja y cinco distritos vivos
// sigue valiendo para los cinco distritos. Negarse entera tiraría trabajo bueno.
//
// EXACTAMENTE DOS SALIDAS (R26): aplicar el resto, o cancelar sin tocar nada. No hay una tercera
// —«quitar de la vista lo que ya no existe»— a propósito: convertiría una aplicación en una
// ESCRITURA, y entonces un catálogo caído podría destruir vistas buenas (R16).

const TXT = {
  titulo: (nombre: string) => `«${nombre}» no se puede aplicar entera`,
  entrada: "Desde que la guardaste, esto ya no está disponible:",
  aplicarSinEso: "Aplicar sin eso",
  cancelar: "Cancelar",
  pie: "Si aplicas sin eso, la vista guardada no cambia: seguirá apareciendo incompleta hasta que la guardes de nuevo o la borres.",
} as const;

export interface VistaIncompletaAvisoProps {
  open: boolean;
  /** El nombre de la vista, para que el aviso diga de cuál habla. */
  nombre: string;
  /**
   * Lo perdido, YA redactado por el módulo de aplicabilidad: cada parte trae su etiqueta
   * visible y su motivo. Aquí no se compone ningún texto con identificadores, porque no llega
   * ninguno: un valor que ya no está en el catálogo no tiene etiqueta que enseñar, así que lo
   * que viaja es cuántos son (R25, R39).
   */
  perdidas: PartePerdida[];
  onAplicarSinEso: () => void;
  onCancelar: () => void;
}

export function VistaIncompletaAviso({
  open,
  nombre,
  perdidas,
  onAplicarSinEso,
  onCancelar,
}: Readonly<VistaIncompletaAvisoProps>) {
  return (
    <Modal
      open={open}
      // Cerrar por «Cancelar», por Escape o por el fondo es lo mismo: no se toca el filtro.
      onOpenChange={(siguiente) => (siguiente ? undefined : onCancelar())}
      title={TXT.titulo(nombre)}
      description={TXT.entrada}
      confirmLabel={TXT.aplicarSinEso}
      cancelLabel={TXT.cancelar}
      // Cierra quien aplica: así el estado del aviso y el de la pantalla se mueven juntos.
      closeOnConfirm={false}
      size="sm"
      onConfirm={onAplicarSinEso}
    >
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        {perdidas.map((parte) => (
          <li key={parte.clave}>{parte.detalle}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{TXT.pie}</p>
    </Modal>
  );
}
