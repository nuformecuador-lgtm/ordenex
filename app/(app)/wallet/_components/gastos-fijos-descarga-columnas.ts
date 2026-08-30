/**
 * Feature 170 (T D.3, design §3/§7) — columnas de EXPORT de las plantillas de gasto fijo.
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las columnas del panel, cuyo `render`
 * devuelve un `Badge` y dos botones (R7).
 *
 * MONEY-SAFE: el monto se emite como el STRING que devolvió el servidor, TAL CUAL, sin
 * `parseFloat`/`Number` y sin el símbolo de colón de `money` (presentación).
 *
 * Lo que NO sale: `id` (uuid interno, R23), `createdAt` y `updatedAt`: el DTO los trae, pero la
 * TABLA no los muestra, y R24 de la 170 prohíbe emitir lo que el listado no enseña.
 *
 * Feature 85 (T F.5, design §4.5) — entran «Periodicidad» y «Próximo cobro», porque desde esta
 * ficha la TABLA las enseña, y el criterio del módulo es justamente que el archivo refleje lo
 * que la tabla enseña. Dejar «Próximo cobro» fuera obligaría a explicar por qué falta en el
 * Excel justo la columna por la que se abre el panel. `periodicidadUnidad` y
 * `periodicidadCantidad` siguen sin salir como campos crudos: salen ya compuestos en la
 * etiqueta legible, que es lo que se lee en pantalla.
 *
 * FICHA 333 (G4) — entra «Cobro», el INTERRUPTOR, por ese mismo criterio y no por simetría: desde
 * esta ficha la tabla lo enseña, y es la diferencia entre «el sistema lo cobra por su cuenta» y
 * «el dinero espera una decisión». Un archivo de plantillas que no lo dijera obligaría a abrir la
 * pantalla para saber cuáles cobran solas, que es justo lo que el archivo existe para evitar.
 *
 * La etiqueta sale del MISMO módulo puro que pinta el `Badge` de la tabla
 * (`interruptorPlantillaGastoFijo`). Escribirla aquí como literal dejaría el texto declarado en
 * dos sitios, y el día que uno cambie —«Requiere autorización», por ejemplo— la tabla y el Excel
 * dirían cosas distintas de la misma fila sin que nada fallara.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import { proximoCobro } from "@/lib/utils/periodicidad";

import {
  estadoPlantillaGastoFijo,
  interruptorPlantillaGastoFijo,
} from "./gasto-fijo-estado-label";
import { PROXIMO_COBRO_INACTIVA, periodicidadLegible } from "./wallet-labels";

/**
 * Columnas del archivo: las SEIS de datos del panel («Acciones» no entra, son botones: no es un
 * dato).
 *
 * Las cinco primeras van en el orden de la pantalla. «Cobro» va AL FINAL y no en el quinto puesto
 * —que es donde la tabla lo pinta, entre «Próximo cobro» y «Estado»—, y la diferencia se declara
 * aquí en vez de dejarla adivinar: añadir una columna al final no mueve de sitio a ninguna de las
 * que ya salían, así que una hoja guardada, una fórmula o un filtro hechos sobre un archivo
 * anterior siguen apuntando a la misma columna. Insertarla en medio se los llevaría por delante
 * sin que nada avisara.
 */
export const COLUMNAS_DESCARGA_GASTOS_FIJOS: DescargaColumna[] = [
  { clave: "concepto", encabezado: "Concepto" },
  { clave: "monto", encabezado: "Monto" },
  { clave: "periodicidad", encabezado: "Periodicidad" },
  { clave: "proximoCobro", encabezado: "Próximo cobro" },
  { clave: "estado", encabezado: "Estado" },
  { clave: "cobro", encabezado: "Cobro" },
];

/**
 * Proyecta una plantilla de gasto fijo a una fila de export con valores CRUDOS (R7). El
 * estado sale como la MISMA etiqueta legible que pinta el badge (R8), no como `true`/`false`,
 * y la periodicidad como la MISMA etiqueta que pinta la tabla.
 *
 * `ahora` es un SEGUNDO PARÁMETRO y no una fábrica: el punto de llamada del panel cierra sobre
 * el mismo instante con el que pinta la tabla, así que archivo y pantalla no pueden discrepar
 * de fecha. El instante se resuelve en el servidor y baja por props (R23): aquí no se lee
 * ningún reloj.
 *
 * `proximoCobro` sale como `YYYY-MM-DD` y no en palabras: en una hoja de cálculo esa forma es
 * la que ORDENA y la que se puede filtrar, que es para lo que se descarga el archivo. Es el
 * mismo día que la tabla muestra como «14 de septiembre de 2026». En las inactivas dice «No se
 * cobra», igual que la celda.
 *
 * `activa === true` y no `activa` a secas: bajo la guardia de datos sensibles el DTO es una
 * sonda (siempre truthy), y la comparación estricta deja el `false` a la vista en el test de
 * columnas en vez de depender de la veracidad del proxy.
 */
export function filaDescargaGastoFijo(
  plantilla: GastoFijoPlantillaDTO,
  ahora: Date,
): DescargaFila {
  return {
    concepto: plantilla.concepto,
    monto: plantilla.monto, // STRING tal cual (money-safe): sin parseo, sin símbolo
    periodicidad: periodicidadLegible(
      plantilla.periodicidadUnidad,
      plantilla.periodicidadCantidad,
    ),
    proximoCobro:
      plantilla.activa === true
        ? proximoCobro(plantilla, ahora)
        : PROXIMO_COBRO_INACTIVA,
    estado: estadoPlantillaGastoFijo(plantilla.activa === true),
    // Ficha 333 (G4): el interruptor, con la MISMA etiqueta que pinta la tabla. `=== true` por el
    // mismo motivo que `activa` justo arriba: bajo la guardia de datos sensibles el DTO es una
    // sonda (un Proxy siempre truthy), y la comparación estricta deja el `false` a la vista en el
    // test de columnas en vez de depender de la veracidad del proxy.
    cobro: interruptorPlantillaGastoFijo(plantilla.requiereAprobacion === true),
  };
}
