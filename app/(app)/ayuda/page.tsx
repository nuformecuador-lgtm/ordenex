import { BookOpen } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";

/**
 * ⭑ FICHA 433 — `/ayuda`: el panel de la derecha cuando todavía no se eligió documento.
 *
 * ⚠️ SE ESCONDE EN EL TELÉFONO (`hidden lg:flex`), y no es un descuido de diseño. A 390px el
 * índice ocupa el ancho entero y ESTA pantalla ya es la lista: un cartel de «elegí uno»
 * encima o debajo de la lista que hay que elegir no aporta nada y empuja el primer enlace
 * fuera de la pantalla. En escritorio, en cambio, la columna derecha estaría vacía y sí hay
 * algo que decir.
 */
export default function AyudaPage() {
  return (
    <EmptyState
      icon={BookOpen}
      title="Elegí un tema del índice"
      description="Cada documento explica una pantalla: qué ves, qué podés hacer y qué no. También llegás a la ayuda de la pantalla en la que estés con el botón «?» del encabezado."
      className="hidden lg:flex"
    />
  );
}
