// Feature 132 (T4.3) — el panel de `conciliacion_cierres`. SERVIDOR.
//
// Es el unico DTO financiero que no trae importes por cubo sino conteos por
// `(nivel, estado)` mas un cuadre, y por eso tiene componente propio en vez de
// una rama dentro del tablero.
//
// Tres decisiones que este archivo materializa:
//
//  1. LOS DOS NIVELES DE CIERRE VAN POR SEPARADO. `cierre_dia` y `cierre_bodega`
//     miden tramos distintos del mismo dinero: fundirlos en una sola fila lo
//     contaria dos veces. La categoria de cada fila combina nivel y estado, y
//     ninguna fila se agrega con otra.
//
//  2. NUNCA LANZA (R19). Un descuadre historico se REPORTA; un tablero que se
//     cae por un descuadre es un tablero que alguien apaga, y con el se pierde la
//     comprobacion que se queria ganar. El aviso es visible y dice CUANTOS cierres
//     estan descuadrados: "no cuadra" sin cantidad no se puede priorizar.
//
//  3. NINGUNA CIFRA SE DERIVA AQUI (R14). Los conteos, los cuatro totales por
//     metodo y las tres cifras del cuadre salen literales del DTO; no hay fila de
//     totales calculada (ver la desviacion declarada en `TableroFinanciero.tsx`).
//
// El aviso se muestra a los DOS roles con acceso total (Q6): `maestro` y `admin`
// son equivalentes en todo el repo y partirlos aqui crearia una tercera categoria
// de rol que nadie mas conoce.

import { TablaResumen } from "@/components/private/analytics/TablaResumen";
import { formatearValor } from "@/components/private/analytics/formato";
import type { ColumnaResumen, FilaResumen } from "@/components/private/analytics/tipos";
import type {
  ClaveTotalCierre,
  ResultadoFinancieroConciliacion,
} from "@/lib/types/analitica-financiera";

import { aNumero } from "./adaptar";

const TEXTOS = {
  etiquetaRango: "Rango",
  categoria: "Nivel y estado",
  // Prefijado con la etiqueta del panel: el `<caption>` de la tabla no debe
  // repetir el nombre accesible de la seccion que la contiene.
  detalle: "Detalle por nivel y estado",
  cantidad: "Cierres",
  efectivo: "Efectivo",
  simpe: "SIMPE",
  transferencia: "Transferencia",
  general: "General",
  totalSnapshot: "Total declarado en los cierres",
  totalLedger: "Total registrado en el libro",
  diferencia: "Diferencia",
  descuadre: "Los cierres no cuadran con el libro. Cierres descuadrados:",
  vacioTitulo: "Sin cierres en el rango",
  vacioDescripcion: "La consulta no devolvió ningún cierre para este rango.",
} as const;

/**
 * Las cinco columnas del DTO de conciliacion.
 *
 * `cantidad` es unidad `conteo` y NO `moneda`: es el unico `number` del contrato
 * de la 127 y no es dinero (`analitica-financiera.ts:127`). Formatearla como
 * importe la convertiria en una cifra de plata inventada.
 */
const COLUMNAS_CONCILIACION: readonly ColumnaResumen[] = [
  { id: "cantidad", etiqueta: TEXTOS.cantidad, unidad: "conteo" },
  { id: "efectivo", etiqueta: TEXTOS.efectivo, unidad: "moneda" },
  { id: "simpe", etiqueta: TEXTOS.simpe, unidad: "moneda" },
  { id: "transferencia", etiqueta: TEXTOS.transferencia, unidad: "moneda" },
  { id: "general", etiqueta: TEXTOS.general, unidad: "moneda" },
];

/** Las cuatro claves de moneda del DTO, declaradas una vez y en el orden de la tabla. */
const CLAVES_TOTAL: readonly ClaveTotalCierre[] = [
  "efectivo",
  "simpe",
  "transferencia",
  "general",
];

export interface PanelConciliacionProps {
  readonly datos: ResultadoFinancieroConciliacion;
}

function filasDeConciliacion(datos: ResultadoFinancieroConciliacion): readonly FilaResumen[] {
  return datos.conciliacion.porEstado.map((fila) => {
    const valores: Record<string, number | null> = { cantidad: fila.cantidad };
    for (const clave of CLAVES_TOTAL) {
      valores[clave] = aNumero(fila.totales[clave]);
    }
    return {
      // Nivel y estado, juntos en la etiqueta y separados como dato: la fila del
      // cierre de bodega nunca se funde con la del cierre de dia.
      id: `${fila.nivel}__${fila.estado}`,
      categoria: `${fila.nivel} · ${fila.estado}`,
      valores,
    };
  });
}

export function PanelConciliacion({ datos }: PanelConciliacionProps) {
  const { cuadre } = datos.conciliacion;
  const cifrasDelCuadre = [
    { id: "snapshot", etiqueta: TEXTOS.totalSnapshot, importe: cuadre.totalSnapshot },
    { id: "ledger", etiqueta: TEXTOS.totalLedger, importe: cuadre.totalLedger },
    { id: "diferencia", etiqueta: TEXTOS.diferencia, importe: cuadre.diferencia },
  ];

  return (
    <section aria-label={datos.etiqueta} className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-foreground">{datos.etiqueta}</h3>
      {/* R22: fechas del propio DTO, sin recalcular. */}
      <p className="text-xs text-muted-foreground">
        {`${TEXTOS.etiquetaRango}: ${datos.rango.desdeFecha} — ${datos.rango.hastaFecha}`}
      </p>

      {/* El aviso va ARRIBA de la tabla y no la sustituye: el resto del panel se
          renderiza igual, porque el detalle es lo que permite investigar. */}
      {cuadre.cuadra ? null : (
        <p role="alert" className="text-sm font-medium text-danger-strong">
          {`${TEXTOS.descuadre} ${formatearValor(cuadre.cierresDescuadrados.length, "conteo")}`}
        </p>
      )}

      <TablaResumen
        titulo={`${datos.etiqueta} · ${TEXTOS.detalle}`}
        encabezadoCategoria={TEXTOS.categoria}
        columnas={COLUMNAS_CONCILIACION}
        filas={filasDeConciliacion(datos)}
        vacio={{ titulo: TEXTOS.vacioTitulo, descripcion: TEXTOS.vacioDescripcion }}
      />

      <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
        {cifrasDelCuadre.map((cifra) => (
          <div key={cifra.id} className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{cifra.etiqueta}</dt>
            <dd className="tabular-nums text-foreground">
              {formatearValor(aNumero(cifra.importe), datos.unidad)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
