"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { useMapaAyuda, type MapaAyuda } from "@/providers/AyudaProvider";
import { cn } from "@/lib/utils";

/**
 * ⭑ FICHA 433 — EL «?» DEL ENCABEZADO: la ayuda DE LA PANTALLA EN LA QUE ESTÁS.
 *
 * ES EL ACCESO QUE HACE QUE EL MÓDULO SE USE. Nadie abre «Ayuda» a leer documentación: la
 * necesita donde está atascado. Pesa sobre todo para los mensajeros —18 de los 37 usuarios,
 * en la calle— que además tienen el menú lateral como un cajón que hay que abrir.
 *
 * ⚠️ SI LA PANTALLA NO TIENE DOCUMENTO, ESTE COMPONENTE NO PINTA NADA. Nunca un «?» que
 * lleve a un vacío: un botón de ayuda que abre un 404 es peor que no tener botón, porque se
 * paga el clic y la decepción justo cuando alguien estaba perdido. Hoy hay seis rutas del
 * portal sin documento (`/`, `/configuracion/sinpe`, `/mi-bodega`, `/mis-asignaciones`,
 * `/ranking/historico`, `/recepcion-satelite`) y en las seis el encabezado queda como estaba.
 *
 * ⚠️ EL MAPA YA VIENE ACOTADO POR ROL desde el servidor (`app/(app)/layout.tsx`), así que
 * este componente no decide acceso: sólo pregunta si la ruta actual tiene documento PARA
 * QUIEN ESTÁ MIRANDO. Es lo que resuelve `/ordenes`, la única ruta con dos documentos —el de
 * oficina y el de tienda—: cada rol recibe el suyo y aquí no hay ninguna preferencia escrita.
 *
 * La comparación es EXACTA contra el `pantalla:` del frontmatter, sin caer al padre de la
 * ruta. Un «?» en `/configuracion/sinpe` que abriera la ayuda de `/configuracion` sería una
 * respuesta a una pregunta que nadie hizo, y el usuario no tendría cómo saber que le
 * contestaron de otra pantalla.
 */
export function AyudaBoton() {
  const mapa = useMapaAyuda();

  // ⚠️ SALIDA TEMPRANA, ANTES DE PREGUNTAR LA RUTA. Sin mapa no hay ningún documento que
  // ofrecer, así que da igual en qué pantalla estemos: no se pinta nada.
  //
  // Y tiene una segunda consecuencia BUSCADA, que es la misma que `useTema` deja escrita en
  // su propio comentario: `PageHeader` es presentación pura y hoy se monta suelto en una
  // veintena de archivos de test que mockean `next/navigation` con lo justo que usaban. Si
  // este componente llamara a `usePathname` incondicionalmente, montar un encabezado pasaría
  // a EXIGIR ese mock en los doce que hoy no lo tienen — o sea, un detalle de presentación
  // convertido en requisito de tests de otras features. Con el corte aquí, quien no instala
  // el proveedor no paga nada. El `?` de verdad se cubre en `AyudaBoton.test.tsx`, que sí
  // monta el proveedor y sí fija la ruta.
  if (Object.keys(mapa).length === 0) return null;

  return <AyudaDeLaRuta mapa={mapa} />;
}

/** La mitad que sí necesita saber dónde estás. Se monta sólo cuando hay mapa. */
function AyudaDeLaRuta({ mapa }: Readonly<{ mapa: MapaAyuda }>) {
  const pathname = usePathname();
  const slug = pathname === null ? undefined : mapa[pathname];

  if (slug === undefined) return null;

  return (
    <Link
      href={`/ayuda/${slug}`}
      // Mismo par de color que `TemaToggle` y «Salir», sus vecinos: `text-foreground` sobre el
      // tinte por rol del encabezado, que la feature 208 midió en 11,94–13,76:1 en los cinco
      // portales y en los dos temas. El anillo de foco es el OPACO de `DESIGN.md` —lo trae ya
      // la clase base de `buttonVariants`—, que es lo que se le pide a una pieza nueva.
      className={cn(
        buttonVariants({ variant: "outline" }),
        "bg-transparent text-foreground hover:bg-foreground/10 hover:text-foreground",
      )}
      // El nombre accesible dice QUÉ ayuda se abre, no «ayuda» a secas: quien navega por
      // lista de enlaces necesita distinguirlo del ítem «Ayuda» del menú, que lleva al índice.
      aria-label="Ayuda de esta pantalla"
      data-ayuda-slug={slug}
    >
      <CircleHelp aria-hidden="true" />
      {/* Por debajo de `sm` el encabezado va justo de sitio —ahí ya se esconden la fecha y la
          etiqueta del tema—, así que queda sólo el icono. Sigue teniendo su nombre accesible,
          y el área de toque es la del botón entero. */}
      <span className="hidden sm:inline">Ayuda</span>
    </Link>
  );
}
