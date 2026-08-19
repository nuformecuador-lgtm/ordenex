// Las SEIS tarjetas de la sección financiera: ingresos, egresos, dinero en caja, ganancia,
// por pagar a tiendas y por pagar a mensajeros.
//
// Componente de SERVIDOR y sin estado: no hay `use client`, no hay SWR y no hay reloj. Estos
// KPIs no reciben filtros (decisión del 2026-08-18), así que no hay nada que re-consultar en el
// navegador — el árbol se pinta una vez con lo que trajo `cargarKpisFinancieros` y ya está.
//
// ⚠ EL DINERO NO PASA POR `number` EN NINGÚN PUNTO DE ESTE ARCHIVO. Los importes llegan como
// STRING desde los ledgers y se formatean con `formatMontoString`, que es la variante del
// formateador de dinero de la casa que trabaja SOBRE STRING (su hermana `formatMonto` recibe
// `number`, así que aquí no vale: convertir para formatear es convertir). Por eso NO se usa `KpiCard` de `components/private/analytics`,
// que sería lo primero que uno mira: aquella recibe `valor: number` y formatea con
// `formatearValor`, así que montarla aquí obligaría a un `Number(monto)` — exactamente el paso
// que toda la capa de dinero de este repo está escrita para impedir. Se reusa `Card`, que es la
// pieza compartida de verdad, y se compone la tarjeta aquí.
//
// Las tarjetas que NO trajeron cifra no se pintan en cero: un cero es una cifra medida, y «no
// puedes verlo» o «se rompió» no lo son. Mismo criterio que los paneles del tablero financiero.

import { Card } from "@/components/ui/card";
import { formatMontoString } from "@/lib/config/moneda";

import type { KpiFinanciero } from "./cargar-kpis";

/** Texto de la tarjeta denegada. No dice POR QUÉ: el motivo permitiría enumerar permisos. */
const TEXTO_DENEGADO = "No tienes acceso a esta cifra.";

export interface KpisFinancierosProps {
  readonly kpis: readonly KpiFinanciero[];
}

function TarjetaKpi({ kpi }: { readonly kpi: KpiFinanciero }) {
  return (
    // `h-full` como en `KpiCard`: la tarjeta ocupa TODO el alto de su celda y no el de su
    // contenido. Aquí importa más que en ninguna otra fila: de las seis, unas traen `pista` y
    // otras no, y unas están en estado «no tienes acceso» con un texto de dos líneas — sin
    // esto, los bordes inferiores quedan a seis alturas distintas.
    //
    // NO es un alto FIJO: el alto lo decide la fila (manda la celda más alta) y las demás la
    // igualan, así que la tarjeta sigue creciendo si su contenido crece.
    <Card className="h-full w-full gap-1 p-4">
      <p className="text-sm text-muted-foreground">{kpi.etiqueta}</p>

      {kpi.estado === "ok" ? (
        <>
          {/* `tabular-nums` para que seis importes en una fila alineen sus decimales: sin él,
              las cifras bailan y una fila de dinero deja de poder compararse de un vistazo. */}
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {formatMontoString(kpi.monto)}
          </p>
          {kpi.pista ? <p className="text-sm text-muted-foreground">{kpi.pista}</p> : null}
        </>
      ) : kpi.estado === "denegado" ? (
        // Sin `role="alert"`: que no te toque ver una cifra no es un fallo que anunciar, es el
        // estado normal de esa tarjeta para ese rol.
        <p className="text-sm text-muted-foreground">{TEXTO_DENEGADO}</p>
      ) : (
        <p role="alert" className="text-sm text-danger-strong">
          {kpi.mensaje}
        </p>
      )}
    </Card>
  );
}

/**
 * @sin-superficie la seccion de finanzas de `/analitica` se comento entera el 2026-08-18 por
 * decision humana, y con ella se fue el unico sitio que montaba esto. El codigo se conserva
 * —esta hecho y probado— y volver a encenderlo es descomentar el bloque de `page.tsx` y sus
 * imports. La anotacion CADUCA: en cuanto la seccion vuelva hay que retirarla, y la guardia lo
 * exige.
 */
export function KpisFinancieros({ kpis }: KpisFinancierosProps) {
  return (
    // Tres columnas en escritorio y dos en tableta: son seis tarjetas, así que 3×2 y 2×3 caen
    // en rejillas completas y ninguna queda huérfana en su fila. En móvil, una por fila — un
    // importe con su rótulo no se lee a media pantalla.
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {kpis.map((kpi) => (
        <TarjetaKpi key={kpi.id} kpi={kpi} />
      ))}
    </div>
  );
}
