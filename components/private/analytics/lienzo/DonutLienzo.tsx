"use client";

// Lienzo de donut (ver la nota de `BarrasLienzo.tsx`: recharts directo, Q1).
//
// En un donut el color NO distingue series sino SEGMENTOS, asi que el techo de
// `MAX_SERIES` se aplica a los segmentos: cinco tokens, cinco porciones, ninguna
// repetida. Lo hace `GraficaDonut` antes de llegar aqui; el lienzo solo colorea
// por posicion.
//
// Los radios y el texto del centro son OPCIONALES y conservan los valores con los que
// nacio el donut (`55%`/`85%`, sin centro): ninguna grafica ya montada cambia de forma
// por que existan. Con `innerRadius="80%"` el mismo componente dibuja un anillo fino, y
// con `centro` escribe una cifra en el hueco.

import { Cell, Label, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { varDeSerie } from "../paleta";
import { cifraConPeso } from "../porcentajes";
import type { AnilloProps, DonutLienzoProps, LienzoProps } from "./tipos-lienzo";

/** Los valores con los que el donut lleva dibujandose desde la 130. */
const RADIO_INTERIOR_DEFAULT = "55%";
const RADIO_EXTERIOR_DEFAULT = "85%";

/* -------------------------------------------------------------------------- */
/* La animacion al CAMBIAR los datos                                           */
/* -------------------------------------------------------------------------- */

/**
 * Duracion del barrido de las porciones, en ms. Es la animacion de entrada del propio
 * recharts; no hay CSS de por medio.
 */
const ANIMACION_MS = 600;

/**
 * ⚠ POR QUE EL `Pie` LLEVA UNA `key` DERIVADA DE LOS DATOS (2026-08-18).
 *
 * Sintoma: al cambiar el filtro, las porciones saltaban a su tamano nuevo de golpe. La
 * animacion se veia en el PRIMER pintado y nunca mas.
 *
 * Causa: recharts 3 anima el `Pie` en su MONTAJE. Cuando solo cambia el `data` —mismo numero
 * de segmentos, mismos `name`, mismos `Cell` reusados por React— el componente no se vuelve
 * a montar y los sectores se redibujan sin transicion. `isAnimationActive` no lo arregla: ya
 * estaba activo por defecto, y activarlo mas no provoca un montaje.
 *
 * Arreglo: una `key` que cambia cuando cambian las cifras. React desmonta el `Pie` viejo y
 * monta uno nuevo, asi que la animacion de entrada vuelve a correr en CADA cambio de datos.
 * Se firma sobre `name` y `value` —lo que se ve— y no sobre el objeto entero: un render que
 * no cambia ninguna cifra conserva la key y NO reanima, que es justo lo que hay que evitar
 * (reanimar en cada render haria parpadear el anillo con solo mover el raton por encima).
 *
 * ⚠ SOBRE `prefers-reduced-motion`: NO se consulta aqui, y no es un olvido. Este paquete es
 * de componentes PUROS de presentacion, y `tests/unit/components/analytics-paquete-guard.test.ts`
 * lo atornilla con todas las letras: prohibe `window`, `matchMedia`, `useState` y `useEffect`
 * en cualquier archivo de `components/private/analytics/`. La animacion de recharts es
 * JavaScript, asi que la regla `@media (prefers-reduced-motion: reduce)` de `globals.css`
 * tampoco la alcanza. Si algun dia hay que respetarla, la deteccion vive en el consumidor
 * (capa `app/`) y baja como PROP —no como una lectura del DOM colada en el lienzo—.
 */
export function firmaDeSegmentos(segmentos: readonly { name: string; value: number | null }[]): string {
  return segmentos.map((s) => `${s.name}:${s.value}`).join("|");
}

/* -------------------------------------------------------------------------- */
/* La leyenda LATERAL con su conteo                                            */
/* -------------------------------------------------------------------------- */

/**
 * El texto de una entrada de leyenda: `«Entregadas: 20»`.
 *
 * El valor se formatea con `formatear`, que la grafica ya resolvio POR UNIDAD
 * (`formato.ts`). No se concatena el numero a pelo: en un donut de dinero esa misma leyenda
 * tiene que decir un monto, y escribir `${valor}` aqui lo dejaria en crudo. El lienzo dibuja,
 * no interpreta — por eso `formatear` llega hecho desde arriba.
 *
 * Sin dato (`null`) se escribe SOLO el nombre. Un `«Entregadas: —»` en una leyenda ocupa el
 * sitio de una cifra que no existe; el hueco se ve mejor vacio que relleno con un guion.
 */
export function etiquetaDeLeyenda(
  nombre: string,
  valor: number | null,
  formatear: (valor: number | null) => string,
  peso?: string,
): string {
  if (valor === null) return nombre;
  return `${nombre}: ${cifraConPeso(formatear(valor), peso)}`;
}

/** Anchura de la columna de la leyenda lateral. */
const ANCHO_LEYENDA = 160;

export function DonutLienzo({
  series,
  formatear,
  innerRadius = RADIO_INTERIOR_DEFAULT,
  outerRadius = RADIO_EXTERIOR_DEFAULT,
  centro,
  leyenda = "abajo",
  mostrarValores = false,
  pesos,
}: LienzoProps & AnilloProps & DonutLienzoProps) {
  const segmentos = (series[0]?.puntos ?? []).map((punto) => ({
    name: punto.categoria,
    value: punto.valor,
  }));

  const lateral = leyenda === "lateral";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          // Cambia con las cifras => el `Pie` se remonta => la animacion de entrada corre otra
          // vez. Ver `firmaDeSegmentos`.
          key={firmaDeSegmentos(segmentos)}
          data={segmentos}
          dataKey="value"
          nameKey="name"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          isAnimationActive={true}
          animationDuration={ANIMACION_MS}
          animationEasing="ease-out"
          // El valor SOBRE el anillo, para leerlo sin pasar el raton por encima. Va
          // formateado por unidad —no el numero crudo— por lo mismo que la leyenda: un donut
          // de dinero tiene que escribir un monto aqui. `false` deja el anillo desnudo, que
          // es como lleva dibujandose desde la 130.
          label={
            mostrarValores
              ? ({ value, index }: { value?: number | null; index?: number }) =>
                  cifraConPeso(
                    formatear(typeof value === "number" ? value : null),
                    // `index` es la POSICION del sector, la misma con la que se calcularon los
                    // pesos y con la que se colorea. Recharts la pasa siempre; el `undefined`
                    // solo deja la cifra sin peso, nunca el peso de otra porcion.
                    typeof index === "number" ? pesos?.[index] : undefined,
                  )
              : false
          }
          labelLine={mostrarValores}
        >
          {segmentos.map((segmento, indice) => (
            <Cell key={segmento.name} fill={varDeSerie(indice)} />
          ))}
          {/* El texto va DENTRO del `Pie`, que es quien conoce el centro del hueco. El
              color sale del token del tema (`fill-foreground`) y no de un hex: un gris
              fijo se pierde en tema oscuro. `aria-hidden` porque la cifra ya viaja en la
              alternativa textual de la grafica, y anunciarla dos veces la duplica. */}
          {centro !== undefined ? (
            <Label
              position="center"
              value={centro}
              className="fill-foreground text-2xl font-semibold"
              aria-hidden
            />
          ) : null}
        </Pie>
        <Tooltip formatter={(valor) => formatear(typeof valor === "number" ? valor : null)} />
        {/* La leyenda LATERAL va en columna a la derecha y lleva el conteo pegado al nombre
            («Entregadas: 20» / «No entregadas: 80»), que es lo que permite leer las dos
            cifras sin tocar el grafico.

            El `payload` se construye AQUI en vez de dejar que recharts lo derive: su entrada
            por defecto solo trae el nombre, y un `formatter` que devolviera el texto completo
            tendria que volver a buscar el valor en el datum. Componiendolo se ve de un
            vistazo que el color, el nombre y la cifra salen todos del MISMO segmento y en el
            MISMO orden que las porciones — que es justo lo que una leyenda promete. */}
        <Legend
          {...(lateral
            ? {
                layout: "vertical" as const,
                align: "right" as const,
                verticalAlign: "middle" as const,
                width: ANCHO_LEYENDA,
                payload: segmentos.map((segmento, indice) => ({
                  id: segmento.name,
                  value: etiquetaDeLeyenda(
                    segmento.name,
                    segmento.value,
                    formatear,
                    pesos?.[indice],
                  ),
                  type: "square" as const,
                  color: varDeSerie(indice),
                })),
              }
            : {})}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export default DonutLienzo;
