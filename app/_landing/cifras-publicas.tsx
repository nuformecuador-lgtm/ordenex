import { KpiValorAnimado } from "@/components/shared/KpiValorAnimado";
import { obtenerConteosPublicos } from "@/lib/actions/conteos-publicos";
import type { ConteosPublicos } from "@/lib/types/conteos-publicos";
import { aproximarADecenas } from "@/lib/utils/cifra-aproximada";

// Feature 198 — la pieza que comparten el HERO y la BANDA para pintar los conteos publicos.
//
// Sustituye a `LandingConteos`, que era una franja propia con las tres cifras. Estas ya no
// viven en un bloque aparte: se meten en los huecos que el hero y la banda YA tenian ocupados
// por numeros escritos a mano («GAM + 3», «100+», «9.9K+»). Ese es el cambio de fondo — la
// landing deja de anunciar cifras inventadas y pasa a anunciar las de la base.
//
// Las tres decisiones que este archivo sostiene, y que no hay que deshacer por descuido:
//
//   1. NO BLOQUEA EL RENDER. Cada seccion envuelve su `<dl>` en `<Suspense>` con un fallback
//      que pinta la MISMA rejilla en 0. Si se quitara, una lectura lenta retrasaria el hero,
//      que es lo primero que ve alguien que no nos conoce.
//   2. NO BLOQUEA ANTE UN FALLO. `leerConteosPublicos` devuelve `null` si la lectura revienta
//      y las cifras numericas simplemente NO se pintan. Se prefirio omitirlas a pintarlas en
//      cero: un «0 con cobertura» en la portada dice algo falso y peor que el silencio. El
//      cero solo es legitimo como estado de CARGA, que dura menos de un parpadeo.
//   3. Los numeros van APROXIMADOS A LA BAJA (`aproximarADecenas`), no exactos. El porque
//      esta escrito en `lib/utils/cifra-aproximada.ts`.

/** Formato compartido de las tres cifras: valor aproximado + su etiqueta. */
export interface CifraLanding {
  valor: number;
  etiqueta: string;
}

/**
 * Los conteos, o `null` si la lectura falla.
 *
 * El `catch` es deliberadamente mudo, igual que lo era en `LandingConteos`: no hay nada
 * accionable que decirle a un visitante sobre el estado de nuestra base, y menos en la unica
 * pantalla que ve alguien de fuera.
 */
export async function leerConteosPublicos(): Promise<ConteosPublicos | null> {
  try {
    // Sin argumentos, y no por comodidad: la accion es publica y su firma vacia es la defensa
    // contra convertirla en un oraculo por inquilino (ver `lib/types/conteos-publicos.ts`).
    return await obtenerConteosPublicos();
  } catch {
    return null;
  }
}

/**
 * Un numero animado de 0 hasta su valor, con el `+` de la aproximacion.
 *
 * `animarAlSerVisible` existe para la banda: esta por debajo del pliegue, asi que su cuenta
 * espera a que el bloque entre en pantalla en vez de gastarse mientras nadie mira. El hero no
 * lo usa —nace visible— y animar al montar es justo lo que se quiere ahi.
 */
export function CifraAnimada({
  valor,
  className,
  animarAlSerVisible = false,
}: Readonly<{ valor: number; className?: string; animarAlSerVisible?: boolean }>) {
  const { valor: aproximado, prefijo } = aproximarADecenas(valor);

  return (
    <KpiValorAnimado
      value={aproximado}
      prefijo={prefijo}
      animarAlSerVisible={animarAlSerVisible}
      arrancarEnCero
      className={className}
    />
  );
}

/**
 * Las cifras de conteo en el orden en que se anuncian, ya con su redaccion.
 *
 * Vive aqui y no duplicada en cada seccion para que hero y banda no puedan discrepar en el
 * texto ni en el orden. `null` (fallo de lectura) da lista vacia: la seccion pinta lo que le
 * quede propio —la banda conserva sus «dias de entrega»— y el hueco numerico desaparece.
 */
export function cifrasDeConteo(conteos: ConteosPublicos | null): CifraLanding[] {
  if (conteos === null) return [];

  return [
    { valor: conteos.distritosConCobertura, etiqueta: "Con cobertura" },
    { valor: conteos.ordenesGestionadas, etiqueta: "Órdenes efectivas" },
    { valor: conteos.ordenesSinGestionar, etiqueta: "Usuarios que nos esperan" },
  ];
}

/** La misma lista en 0: es lo que se pinta MIENTRAS carga (fallback de `<Suspense>`). */
export const CIFRAS_EN_CERO: ConteosPublicos = {
  distritosConCobertura: 0,
  ordenesGestionadas: 0,
  ordenesSinGestionar: 0,
};
