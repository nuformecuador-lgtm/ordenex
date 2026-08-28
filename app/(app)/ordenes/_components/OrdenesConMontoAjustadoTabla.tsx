"use client";

import { DataTable, type Column } from "@/components/shared/DataTable";
import { montoExacto } from "@/components/shared/DesglosePagoField";
import type { OrdenMontoAjustado } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";

export interface OrdenesConMontoAjustadoTablaProps {
  /** Filas creadas cuyo monto entró redondeado (feature 299). */
  ajustadas: OrdenMontoAjustado[];
  /**
   * Qué le pasó (o le va a pasar) a estas filas. Llega por prop y no vive aquí porque el
   * tiempo verbal cambia entre los dos pasos que montan esta tabla: en la revisión previa
   * nada se ha guardado todavía, y en el resultado ya está guardado. El resto del texto es
   * el mismo en los dos sitios.
   */
  descripcion: string;
}

/**
 * FEATURE 304 — LAS FILAS QUE ENTRARON CON EL MONTO REDONDEADO, EN PANTALLA.
 *
 * La 299 redondea al colón más cercano un monto con céntimos —con céntimos la orden no se
 * puede entregar nunca— y lo informa fila a fila. El integrador recibe ese aviso en el JSON;
 * la tienda que sube por pantalla no lo veía por ningún lado, así que se encontraba un monto
 * distinto del de su archivo sin ninguna explicación.
 *
 * NO ES UN ERROR y por eso NO se pinta como tal: la orden sí se creó. Sigue el patrón de
 * `OrdenesExistentesTabla` (sección + encabezado en texto plano + tabla de solo lectura), no
 * el de `OrdenesConErrorTabla`, que va dentro de un `Alert` destructivo.
 *
 * LOS DOS MONTOS SE PINTAN CON `montoExacto`, el formateador de la 300, y no con el general:
 * el general redondea al pintar (feature 230), así que `11898.81` y `11899` saldrían con la
 * MISMA cadena y la tabla diría «se ajustó de ₡11.899 a ₡11.899». Esa es justo la pantalla
 * que se contradice a sí misma que la 300 vino a matar. `montoExacto` ya existe para este
 * caso —es la excepción declarada a «el dinero se pinta sin céntimos»— y sobre un monto sin
 * cola decimal (la columna «aplicado», siempre entera) devuelve exactamente lo mismo que el
 * formateador de siempre.
 */
export function OrdenesConMontoAjustadoTabla({
  ajustadas,
  descripcion,
}: OrdenesConMontoAjustadoTablaProps) {
  const columns: Column<OrdenMontoAjustado>[] = [
    {
      id: "fila",
      value: "Fila",
      // Es la línea del archivo ORIGINAL (el cliente la remapea al trocear), que es lo que
      // deja a la tienda encontrar el dato en su hoja.
      render: (row) => (row.fila != null ? String(row.fila) : "—"),
    },
    {
      id: "numRemision",
      value: "Nº Remisión",
      render: (row) => row.numRemision || "—",
      minWidth: "120px",
    },
    {
      id: "original",
      value: "Monto del archivo",
      render: (row) => montoExacto(row.original),
      align: "right",
    },
    {
      id: "aplicado",
      value: "Monto aplicado",
      render: (row) => montoExacto(row.aplicado),
      align: "right",
    },
  ];

  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="ordenes-monto-ajustado-heading"
    >
      <h3 id="ordenes-monto-ajustado-heading" className="text-sm font-medium">
        Órdenes con el monto redondeado
      </h3>
      <p className="text-sm text-muted-foreground">{descripcion}</p>
      <DataTable<OrdenMontoAjustado>
        columns={columns}
        data={ajustadas}
        rowKey={(row) => `${row.fila}-${row.numRemision}`}
        ariaLabel="Órdenes con el monto redondeado"
      />
    </section>
  );
}
