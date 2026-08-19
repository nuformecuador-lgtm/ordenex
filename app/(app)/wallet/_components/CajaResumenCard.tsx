"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Landmark, TriangleAlert } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  CajaResumenDTO,
  ModoComposicionCaja,
  WalletBalanceSigno,
} from "@/lib/types/wallet";
import { cn } from "@/lib/utils";

import { BarraComposicionCaja } from "./BarraComposicionCaja";
import {
  CAJA_COMPOSICION_LABEL,
  CAJA_COMPOSICION_MENSAJE,
  CAJA_RESUMEN_AVISO_PERIODO,
  CAJA_RESUMEN_AVISO_TERCEROS,
  CAJA_RESUMEN_LABEL,
  CAJA_RESUMEN_NOTA_DIFERENCIA,
  CAJA_TIENDAS_HREF,
  money,
} from "./wallet-labels";

// Feature 173 (T G.1, design §8) — la tarjeta de la caja. Sustituye a la tarjeta de una sola
// cifra de la 42, y el renombrado del archivo es parte del encargo: mientras el archivo llevara
// esa palabra en el nombre, alguien volveria a ponerla en pantalla. Aqui no aparece: ni en un
// rotulo, ni en un `aria-label`, ni en un comentario.
//
// Lo que cambia respecto de la 42 no es como se pinta un numero: son DOS numeros donde habia uno,
// y se ven A LA VEZ (R58). Nada de pestanas ni de desplegables — el punto entero de la feature es
// que nadie confunda el dinero que pasa por la caja con lo que Ordenex gana.
//
// Money-safe (R64 de la 173 / R12 de la 231): los importes llegan ya derivados y serializados por
// el SERVIDOR y se pintan TAL CUAL con `money`. Aqui no se suma, no se resta y no se convierte a
// numero; los dos signos tambien los da el servidor. El rotulo condicional `[P7]` se decide con
// la bandera `periodoFiltrado` del DTO, no deduciendo nada en el cliente.
//
// ── Feature 231 (T4.3, design §4.1) — LA CAJA PARTIDA EN DOS BOLSILLOS ──
//
// La grilla de tiles hermanos de la 200 se refunde en UNA tarjeta con tres bloques seguidos,
// porque lo que se venia a contar no era «tres numeros» sino UNA cifra y de quien es cada trozo:
//
//   1. la cifra grande de la caja, con «Entro», «Salio» y el conteo como datos SECUNDARIOS
//      debajo (R6: ninguno desaparece de la pantalla);
//   2. la barra de composicion, inmediatamente debajo (R2);
//   3. los DOS bolsillos, hermanos: el de las tiendas —que conserva entero el aviso y el enlace
//      de la 173— y el de Ordenex (R3/R4).
//
// Tres detalles del arbol que NO son esteticos y que sostienen las aserciones vivas de la 173:
//
//  - las dos regiones son DISJUNTAS: la de «Dinero en caja» no envuelve a la de «Ganancia de
//    Ordenex», asi que ningun importe puede leerse bajo el rotulo del vecino;
//  - cada region tiene un PADRE ACOTADO que contiene su propio desglose y no el del otro (el
//    caso de la 173 busca por `parentElement` con `getByText`, que revienta con dos
//    coincidencias — y en su conjunto de prueba «Salio» y «Gastos de Ordenex» valen lo mismo);
//  - CERO elementos interactivos (R8): ni un `<button>`, ni `details/summary`, ni tooltip. La
//    barra es `role="img"`, no un `Progress` de Radix.

/**
 * Feature 200 (tanda 2) — las insignias de signo usan las variantes SEMANTICAS de la
 * primitiva. «Positivo» venia con `default`, que es el naranja de marca, y DESIGN.md lo
 * reserva para accion primaria y seleccion: un estado pintado con el color de la accion
 * compite con los botones de la pantalla y deja de leerse como estado.
 */
const SIGNO_BADGE: Record<
  WalletBalanceSigno,
  { variant: "success" | "danger" | "secondary"; label: string }
> = {
  positivo: { variant: "success", label: "Positivo" },
  negativo: { variant: "danger", label: "Negativo" },
  cero: { variant: "secondary", label: "En cero" },
};

/** Color de una cifra segun su signo (verde/rojo/neutro), en el tono `-strong` de texto. */
const SIGNO_COLOR: Record<WalletBalanceSigno, string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
  cero: "text-muted-foreground",
};

/** Superficie de cada bolsillo. Base comun; el color lo decide el caso. */
const BOLSILLO = "flex flex-col gap-2 rounded-xl border p-4";

/**
 * R5/R16 — de que color va el bloque de ORDENEX en cada modo. `Record` TOTAL sobre los cuatro:
 * un modo nuevo rompe el build en vez de heredar en silencio el color de otro caso.
 *
 * Neutro salvo en el caso limite. `DESIGN.md` reserva el acento para accion y estado: una
 * ganancia normal no es ninguna de las dos cosas, y pintarla de color la convertiria en una
 * alarma permanente. Cuando el modo es `solo_tiendas` SI hay un estado que avisar —Ordenex esta
 * en perdida y ese saldo lo cubre dinero ajeno—, y ahi entra `danger` con sus tres roles: la
 * base en el borde, `-soft` de fondo y `dark:bg-danger/15` para que el token que gira (el texto)
 * no se quede sobre una superficie fija.
 */
const SUPERFICIE_NEUTRA = "border-border bg-muted/40";

/**
 * El TONO del mensaje del modo. Va emparejado con la superficie por la misma razon:
 * `solo_tiendas` es el unico de los tres modos con mensaje que describe un ESTADO —Ordenex en
 * perdida, con dinero ajeno cubriendo el saldo—; los otros dos solo EXPLICAN por que la barra
 * no se parte. Pintarlos tambien en rojo gasta la senal: un rojo que sale en un estado normal
 * deja de leerse como alarma el dia que la alarma existe (`DESIGN.md`, «restrained»).
 */
const TONO_INFORMATIVO = "text-muted-foreground";
const TONO_PELIGRO = "font-medium text-danger-strong";

const BOLSILLO_ORDENEX: Record<
  ModoComposicionCaja,
  { superficie: "neutra" | "peligro"; clase: string; tonoMensaje: string }
> = {
  dos_bolsillos: {
    superficie: "neutra",
    clase: SUPERFICIE_NEUTRA,
    // Sin mensaje que pintar; el tono va igualmente para que el `Record` sea TOTAL.
    tonoMensaje: TONO_INFORMATIVO,
  },
  solo_ordenex: {
    superficie: "neutra",
    clase: SUPERFICIE_NEUTRA,
    tonoMensaje: TONO_INFORMATIVO,
  },
  sin_reparto: {
    superficie: "neutra",
    clase: SUPERFICIE_NEUTRA,
    tonoMensaje: TONO_INFORMATIVO,
  },
  solo_tiendas: {
    superficie: "peligro",
    clase: "border-danger/30 bg-danger-soft dark:bg-danger/15",
    tonoMensaje: TONO_PELIGRO,
  },
};

/** Tipografia de la cifra grande de la caja. */
const CIFRA_GRANDE = "text-3xl font-semibold tracking-tight tabular-nums";

/** Tipografia de la cifra de cada bolsillo: mismo peso para las dos, ninguna manda. */
const CIFRA_BOLSILLO = "text-2xl font-semibold tracking-tight tabular-nums";

/**
 * Un dato SECUNDARIO de la cifra grande (R6): rotulo pequeno, valor en rejilla y —si la tiene—
 * su pista. Sirve para dinero y para el conteo, que no es dinero y por eso llega ya convertido
 * en texto por quien lo pinta.
 */
function DatoSecundario({
  rotulo,
  valor,
  pista,
  className,
}: {
  rotulo: string;
  valor: ReactNode;
  pista?: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <span className={cn("text-lg font-medium tabular-nums", className)}>{valor}</span>
      {pista ? <span className="text-xs text-muted-foreground">{pista}</span> : null}
    </div>
  );
}

export interface CajaResumenCardProps {
  /** Las dos cifras (y el reparto) ya derivadas en el servidor, montos STRING. */
  resumen: CajaResumenDTO;
  /**
   * Feature 200: cuantos registros tiene el conjunto que se esta mirando. Es el `total` del
   * servidor, no el largo de la pagina pintada. Opcional: sin el, la fila queda de dos datos.
   */
  movimientos?: number;
}

export function CajaResumenCard({ resumen, movimientos }: CajaResumenCardProps) {
  // `[P7]`: el HECHO lo da el servidor; aqui solo se elige el rotulo que no miente.
  const rotuloEnCaja = resumen.periodoFiltrado
    ? CAJA_RESUMEN_LABEL.enCajaPeriodo
    : CAJA_RESUMEN_LABEL.enCaja;

  const badgeEnCaja = SIGNO_BADGE[resumen.signoEnCaja];
  const badgeGanancia = SIGNO_BADGE[resumen.signoGanancia];
  const ordenex = BOLSILLO_ORDENEX[resumen.modoComposicion];
  // R16/R17/R18: lo que hay que decir cuando la barra no se puede partir. En el caso normal no
  // hay nada que anadir y el bloque se explica con su importe y su pista.
  const mensajeModo = CAJA_COMPOSICION_MENSAJE[resumen.modoComposicion];

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        {/* 1 — la cifra grande y, HERMANOS suyos, sus datos secundarios (R6). */}
        <div className="flex flex-col gap-3">
          <section aria-label={rotuloEnCaja} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center justify-center rounded-md bg-muted p-2 text-muted-foreground">
                <Landmark className="size-4" aria-hidden="true" />
              </span>
              <span className="text-sm font-medium text-muted-foreground">{rotuloEnCaja}</span>
              <Badge variant={badgeEnCaja.variant}>{badgeEnCaja.label}</Badge>
            </div>
            <span className={cn(CIFRA_GRANDE, SIGNO_COLOR[resumen.signoEnCaja])}>
              {money(resumen.enCaja)}
            </span>
            <span className="text-xs text-muted-foreground">
              {CAJA_RESUMEN_LABEL.enCajaPista}
            </span>
          </section>

          <div className="grid grid-cols-2 gap-4 border-t pt-3 sm:grid-cols-3">
            <DatoSecundario
              rotulo={CAJA_RESUMEN_LABEL.entradas}
              valor={money(resumen.entradas)}
              className="text-success-strong"
            />
            <DatoSecundario
              rotulo={CAJA_RESUMEN_LABEL.salidas}
              valor={money(resumen.salidas)}
              className="text-danger-strong"
            />
            {/* El conteo NO es dinero: color neutro, sin insignia de signo y sin desglose. */}
            {movimientos === undefined ? null : (
              <DatoSecundario
                rotulo={CAJA_RESUMEN_LABEL.movimientos}
                valor={movimientos}
                pista={CAJA_RESUMEN_LABEL.movimientosPista}
                className="text-foreground"
              />
            )}
          </div>
        </div>

        {/* 2 — la barra (R2), inmediatamente debajo de la cifra que reparte. */}
        <BarraComposicionCaja resumen={resumen} />

        {/* 3 — los DOS bolsillos, hermanos y a la vez (R3). */}
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
          {/* R4: la advertencia y el enlace no son decorado, son la unica defensa contra leer
              esta cifra como la deuda con las tiendas. */}
          <section
            aria-label={CAJA_RESUMEN_LABEL.deTerceros}
            data-bolsillo="tiendas"
            className={cn(BOLSILLO, "border-warning/30 bg-warning-soft dark:bg-warning/15")}
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center rounded-md bg-warning/15 p-2 text-warning-strong">
                <TriangleAlert className="size-4" aria-hidden="true" />
              </span>
              <span className="text-sm font-medium text-warning-strong">
                {CAJA_COMPOSICION_LABEL.tiendas}
              </span>
            </div>
            {/* Feature 208/210 — LA CIFRA va en `text-foreground`, no en el color de aviso: el
                aviso lo dan el icono, el rotulo, el borde y el fondo, y el numero es dinero,
                que necesita margen de contraste y no el aprobado justo (14.22:1 en claro). */}
            <span className={cn(CIFRA_BOLSILLO, "text-foreground")}>
              {money(resumen.deTerceros)}
            </span>
            <span className="text-sm font-medium text-warning-strong">
              {CAJA_RESUMEN_LABEL.deTerceros}
            </span>
            <p role="note" className="text-xs text-muted-foreground">
              {CAJA_RESUMEN_AVISO_TERCEROS}
            </p>
            <Link
              href={CAJA_TIENDAS_HREF}
              className="w-fit rounded-sm text-xs font-medium text-warning-strong underline underline-offset-2 transition-colors duration-200 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {CAJA_RESUMEN_LABEL.deTercerosEnlace}
            </Link>
          </section>

          {/* El bolsillo de Ordenex: la region de la ganancia y su desglose, hermanos dentro de
              un padre ACOTADO que no contiene ni un importe de la columna de al lado. */}
          <div
            data-bolsillo="ordenex"
            data-superficie={ordenex.superficie}
            className={cn(BOLSILLO, ordenex.clase)}
          >
            <section aria-label={CAJA_RESUMEN_LABEL.ganancia} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  {CAJA_COMPOSICION_LABEL.ordenex}
                </span>
                <Badge variant={badgeGanancia.variant}>{badgeGanancia.label}</Badge>
              </div>
              <span className={cn(CIFRA_BOLSILLO, SIGNO_COLOR[resumen.signoGanancia])}>
                {money(resumen.ganancia)}
              </span>
              <span className="text-sm font-medium text-foreground">
                {CAJA_RESUMEN_LABEL.ganancia}
              </span>
              <span className="text-xs text-muted-foreground">
                {CAJA_RESUMEN_LABEL.gananciaPista}
              </span>
            </section>

            <div className="grid grid-cols-2 gap-4 border-t pt-3">
              <DatoSecundario
                rotulo={CAJA_RESUMEN_LABEL.ingresosPropios}
                valor={money(resumen.ingresosPropios)}
                className="text-success-strong"
              />
              <DatoSecundario
                rotulo={CAJA_RESUMEN_LABEL.egresosPropios}
                valor={money(resumen.egresosPropios)}
                className="text-danger-strong"
              />
            </div>

            {mensajeModo === null ? null : (
              <p role="note" className={cn("text-xs", ordenex.tonoMensaje)}>
                {mensajeModo}
              </p>
            )}
          </div>
        </div>

        {/* R60: en que se diferencian, junto a las dos cifras y no en otra pantalla. */}
        <div className="flex flex-col gap-2">
          <p role="note" className="text-xs text-muted-foreground">
            {CAJA_RESUMEN_NOTA_DIFERENCIA}
          </p>

          {/* `[P7]`: solo cuando hay un periodo elegido, que es cuando el nombre de siempre
              mentiria. */}
          {resumen.periodoFiltrado ? (
            <p role="note" className="text-xs text-muted-foreground">
              {CAJA_RESUMEN_AVISO_PERIODO}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
