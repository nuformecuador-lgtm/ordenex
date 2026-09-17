"use client";

// FICHA 441 — LA TARJETA HEROE: el porcentaje de entrega, con su madurez dentro.
//
// ─── QUE PROBLEMA RESUELVE, MEDIDO ──────────────────────────────────────────────────────
//
// En `/analitica` a 1440 px, el 2026-09-17: cinco tarjetas con el MISMO peso visual, de modo
// que «17,4 % de efectividad» se leia igual que «En proceso 37». Y una vez arreglada la ventana
// —el KPI ya cuenta las ordenes CARGADAS en el periodo y no las que se movieron ese dia— aparece
// la trampa de la direccion contraria: una cohorte joven lee mal POR JOVEN, no por ir mal
// (medido: 14,7 % a un dia, 43,9 % a tres, 56,1 % a catorce). Un numero grande y solo, con esa
// ventana, diria manana que el negocio se hundio.
//
// Por eso esta tarjeta no ensena un numero: ensena un numero CON SU MADUREZ. Tres piezas, y las
// tres vienen del diseno aprobado por el humano (`design-analitica/Main.dc.html`,
// `Telefono.dc.html`):
//
//   1. la cifra a 68 px, con el borde de marca — es EL numero de la pantalla y se tiene que
//      distinguir de los cuatro de apoyo, que bajan de rango a proposito;
//   2. la BARRA DE MADUREZ: entregadas / otro desenlace / todavia vivas, con su leyenda y sus
//      cifras. Es lo que convierte «53,7 %» en «53,7 % y aun quedan 265 en la calle»;
//   3. debajo, el porcentaje sobre las que YA TIENEN DESENLACE, que es el que dice si se esta
//      entregando bien HOY porque no castiga a la cohorte por ser joven.
//
// ─── LO QUE ESTE COMPONENTE NO HACE ─────────────────────────────────────────────────────
//
// **No pide datos.** Recibe la madurez YA evaluada por props, de su padre (`KpisEfectividad`),
// que es quien tiene la clave de SWR compartida con el desglose por status. Asi esta tarjeta se
// prueba en sus cinco estados sin montar SWR ni mockear una accion.
//
// **No decide si un porcentaje se puede afirmar.** Esa regla vive en
// `lib/analytics/madurez-cohorte.ts` y su redaccion en `./madurez-textos.ts`. Aqui solo se pinta
// lo que aquellos dicen — y por eso un `null` NUNCA llega como guion: llega como frase.
//
// **No fija su ancho.** Que ocupe dos columnas lo pone la rejilla de `page.tsx`, el unico nivel
// que sabe cuantas tarjetas hay en la fila.

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CLASES_CIFRA, CLASES_ROTULO, CLASES_TARJETA } from "@/components/private/analytics/jerarquia";
import { formatearValor } from "@/components/private/analytics/formato";
import { KpiValor } from "@/components/private/analytics/KpiValor";
import type { MadurezDeCohorte } from "@/lib/analytics/madurez-cohorte";
import { cn } from "@/lib/utils";

import { fraseSobreCerradas, TEXTO_HEROE, titularDelHeroe } from "./madurez-textos";

/**
 * Los tres tramos de la barra, con su color y su rotulo EN UN SOLO SITIO.
 *
 * La leyenda y la barra se dibujan del MISMO arreglo a proposito: son la misma particion vista
 * dos veces, y con dos listas separadas el dia que alguien cambie un color la leyenda deja de
 * describir la barra sin que nada se ponga rojo.
 *
 * Colores: `brand` es el token de marca —el mismo naranja del diseno— y los otros dos giran con
 * el modo oscuro (`foreground`, `muted-foreground`) en vez de ser un hexadecimal fijo que
 * desapareceria sobre fondo oscuro.
 */
const TRAMOS = [
  { id: "entregadas", rotulo: TEXTO_HEROE.leyenda.entregadas, color: "bg-brand" },
  { id: "otroDesenlace", rotulo: TEXTO_HEROE.leyenda.otroDesenlace, color: "bg-foreground/80" },
  { id: "vivas", rotulo: TEXTO_HEROE.leyenda.vivas, color: "bg-muted-foreground/30" },
] as const;

export interface EfectividadHeroeProps {
  /** La madurez ya evaluada. `null` mientras no hay respuesta util (en vuelo o con aviso). */
  readonly madurez: MadurezDeCohorte | null;
  readonly cargando?: boolean;
  /** Mensaje YA resuelto por el padre. `null` = no hay aviso. */
  readonly error?: string | null;
}

export function EfectividadHeroe({
  madurez,
  cargando = false,
  error = null,
}: EfectividadHeroeProps) {
  return (
    <Card
      // CUANTAS COLUMNAS TIENE LA FILA lo decide `page.tsx`; CUANTAS OCUPA EL HEROE viaja con el
      // heroe, porque `KpisEfectividad` devuelve un fragmento y la pagina no tiene ningun
      // elemento suyo al que ponerle la clase. Dos celdas —«el doble de ancho»— es el diseno
      // aprobado, y dos filas de alto para que la barra de madurez y la segunda cifra quepan sin
      // estirar las tarjetas de apoyo de al lado.
      className={cn("h-full w-full gap-3 p-6 sm:col-span-2 lg:row-span-2", CLASES_TARJETA.heroe)}
      // El nombre accesible de la tarjeta entera: quien navega por regiones oye «Efectividad de
      // entrega» y no «grupo».
      role="group"
      aria-label={TEXTO_HEROE.rotulo}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={CLASES_ROTULO.heroe}>{TEXTO_HEROE.rotulo}</p>
        {/* FICHA 360 — el universo va PEGADO al rotulo, y solo cuando se conoce: con la consulta
            en vuelo o con un aviso en pantalla, un «de 0 órdenes cargadas» seria una afirmacion
            de negocio que nadie ha hecho. Con `cargadas = 0` SI se escribe, porque es justo lo
            que explica la frase de al lado. */}
        {madurez === null ? null : (
          <p className="text-sm text-muted-foreground">{TEXTO_HEROE.baseCargadas(madurez.cargadas)}</p>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger-strong">
          {error}
        </p>
      ) : cargando || madurez === null ? (
        <>
          <span role="status" className="sr-only">
            {TEXTO_HEROE.rotulo}
          </span>
          <Skeleton aria-hidden="true" className="h-16 w-48" />
          <Skeleton aria-hidden="true" className="h-3 w-full" />
        </>
      ) : (
        <Contenido madurez={madurez} />
      )}
    </Card>
  );
}

/** El cuerpo con datos. Aparte para que el componente de arriba se lea de un vistazo. */
function Contenido({ madurez }: { readonly madurez: MadurezDeCohorte }) {
  const titular = titularDelHeroe(madurez);
  const sobreCerradas = fraseSobreCerradas(madurez.sobreCerradas, madurez.cargadas);
  const cantidades: Record<(typeof TRAMOS)[number]["id"], number> = {
    entregadas: madurez.entregadas,
    otroDesenlace: madurez.otroDesenlace,
    vivas: madurez.vivas,
  };

  return (
    <>
      {titular.porcentaje === null ? (
        // ⚠ AQUI NO HAY GUION NI «0 %». Los dos estados en que la cifra no se puede afirmar
        // —cero desenlaces y base demasiado chica— se dicen con PALABRAS, porque un «0,0 %»
        // sobre la zona Puntarenas (0 de 27, medido) le dice al encargado que lo hace todo mal
        // cuando lo que pasa es que no se ha movido nada.
        <div className="flex flex-col gap-1">
          <p className="text-xl font-semibold text-foreground">{titular.titular}</p>
          {titular.detalle === null ? null : (
            <p className="text-sm text-muted-foreground">{titular.detalle}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <p className={cn(CLASES_CIFRA.heroe, "tabular-nums text-foreground")}>
            <KpiValor valor={titular.porcentaje} unidad="porcentaje" />
          </p>
          <div className="pb-2">
            <p className="text-sm font-medium tabular-nums text-foreground">{titular.titular}</p>
            {titular.detalle === null ? null : (
              <p className="text-sm text-muted-foreground">{titular.detalle}</p>
            )}
          </div>
        </div>
      )}

      {madurez.cargadas === 0 ? null : (
        <BarraDeMadurez cargadas={madurez.cargadas} cantidades={cantidades} />
      )}

      {/* LA SEGUNDA CIFRA, la que no castiga a la cohorte por ser joven. Va DEBAJO y en cuerpo
          pequeno, nunca en lugar de la de arriba: sola, esconde que medio lote sigue en la
          calle. Y cuando no se puede afirmar, aqui tambien hay frase — nunca un guion. */}
      {sobreCerradas === null ? null : (
        <p className="border-t pt-3 text-sm font-medium tabular-nums text-foreground">
          {sobreCerradas}
        </p>
      )}
    </>
  );
}

/**
 * La barra y su leyenda.
 *
 * La BARRA es decorativa (`aria-hidden`): no aporta ni un dato que la leyenda de debajo no diga
 * con numeros. Poner ahi un `role="img"` con una descripcion obligaria a mantener dos redacciones
 * del mismo hecho; la leyenda ya es texto y la lee cualquier tecnologia de apoyo.
 */
function BarraDeMadurez({
  cargadas,
  cantidades,
}: {
  readonly cargadas: number;
  readonly cantidades: Record<(typeof TRAMOS)[number]["id"], number>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        aria-hidden="true"
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        {TRAMOS.map((tramo) => (
          <span
            key={tramo.id}
            className={tramo.color}
            style={{ width: `${(cantidades[tramo.id] / cargadas) * 100}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {TRAMOS.map((tramo) => (
          <li key={tramo.id} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden="true" className={cn("size-2 rounded-xs", tramo.color)} />
            <span>{tramo.rotulo}</span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatearValor(cantidades[tramo.id], "conteo")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
