"use client";

import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { useMapaAyuda, type MapaAyuda } from "@/providers/AyudaProvider";
import { useAsistente } from "@/providers/AsistenteProvider";
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
 * paga el clic y la decepción justo cuando alguien estaba perdido.
 *
 * EL RECUENTO, medido sobre `app/(app)` el 2026-09-16 y CORREGIDO el 2026-09-17: 34 rutas, de
 * las que 2 (`/mis-asignaciones`, `/recepcion-satelite`) son redirecciones puras y no pintan
 * encabezado. De las 32 que sí lo pintan, **ninguna se queda sin «?» para todo el mundo**.
 *
 * ⚠️ AQUÍ DECÍA QUE TRES SE QUEDABAN SIN «?» (`/configuracion/sinpe`, `/mi-bodega`,
 * `/ranking/historico`) Y ERA FALSO DESDE LA FICHA 434, que les escribió documento. Su propio
 * test ya lo decía (`tests/components/AyudaBoton.test.tsx`: «YA NO QUEDA NINGUNA PANTALLA DEL
 * PORTAL EN ESTA LISTA») y el comentario se quedó atrás. Se corrige en la 436 porque no es
 * cosmético: quien lo leyera para montar el asistente creería que nace con tres agujeros de
 * acceso que no existen — y el «?» es ahora la ÚNICA puerta al asistente (Q3, opción A).
 *
 * Lo que sí queda son **pares (pantalla, rol)**, que es otra cosa: `/configuracion/sinpe` no
 * tiene «?» para `adminSatelite` (deliberado, Q4: ese rol ve una fila y el documento describe
 * las ocho) y `/mi-bodega` no lo tiene para `maestro`. Las 2 rutas sin «?» para nadie son las
 * del propio módulo (`/ayuda` y `/ayuda/[...slug]`), donde no hace falta porque ya estás dentro.
 * (La landing `/` no cuenta: vive fuera de `app/(app)`, no monta este encabezado y no tiene
 * proveedor, así que ahí no había «?» que perder.)
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

/**
 * La mitad que sí necesita saber dónde estás. Se monta sólo cuando hay mapa.
 *
 * ⭑ FICHA 436 (T17 — R26, Q3 opción A) — **ESTE CONTROL YA NO ES UN ENLACE: ABRE EL ASISTENTE**,
 * sin salir de la pantalla, y le pasa el slug de este documento como contexto de partida.
 *
 * ⚠️ NO SE PIERDE NADA DE LA 433. La ayuda escrita sigue a un toque: la **primera acción visible
 * dentro del panel** es «Leer la ayuda de esta pantalla», apuntando a este mismo `/ayuda/<slug>`.
 * Lo que se gana es que la misma puerta sirva para preguntar.
 *
 * ⚠️ Y POR QUÉ NO SE AÑADIÓ UN SEGUNDO BOTÓN. El humano cerró la **opción A** el 2026-09-17: el
 * mensajero NO lleva burbuja flotante. La esquina de abajo a la derecha ya es del chat con el
 * cliente (`ChatFlotante`, 56 px a 20 px de los bordes), y dos círculos del mismo tamaño en la
 * misma esquina, con el teléfono al sol y una mano ocupada, se distinguirían sólo por el color.
 * El coste aceptado es que el asistente se descubra menos; vive donde uno ya va a buscar ayuda.
 *
 * ⚠️ SIN `AsistenteProvider` ESTO NO REVIENTA, PERO TAMPOCO ABRE NADA. `useAsistente` devuelve un
 * contexto inerte, igual que `useMapaAyuda` devuelve un mapa vacío y por el mismo motivo
 * (`PageHeader` se monta suelto en una veintena de tests ajenos). En la aplicación los dos
 * proveedores salen del MISMO layout, así que están o no están a la vez — y que sigan estándolo
 * lo vigila `asistente-panel-hermano.guardia.test.ts`, no la buena memoria de nadie.
 */
function AyudaDeLaRuta({ mapa }: Readonly<{ mapa: MapaAyuda }>) {
  const pathname = usePathname();
  const { abrir } = useAsistente();
  const slug = pathname === null ? undefined : mapa[pathname];

  if (slug === undefined) return null;

  return (
    <button
      type="button"
      onClick={() => abrir({ slug, ruta: pathname })}
      // Mismo par de color que `TemaToggle` y «Salir», sus vecinos: `text-foreground` sobre el
      // tinte por rol del encabezado, que la feature 208 midió en 11,94–13,76:1 en los cinco
      // portales y en los dos temas. El anillo de foco es el OPACO de `DESIGN.md` —lo trae ya
      // la clase base de `buttonVariants`—, que es lo que se le pide a una pieza nueva.
      className={cn(
        buttonVariants({ variant: "outline" }),
        "bg-transparent text-foreground hover:bg-foreground/10 hover:text-foreground",
      )}
      // El nombre accesible dice QUÉ ayuda se abre, no «ayuda» a secas: quien navega por
      // lista de controles necesita distinguirlo del ítem «Ayuda» del menú, que lleva al índice.
      aria-label="Ayuda de esta pantalla"
      // El slug sigue estando AQUÍ, en el DOM, y no sólo dentro del `onClick`: es lo que permite
      // afirmar en un test —y comprobar en el navegador— que ESTA pantalla ofrece ESE documento,
      // sin tener que abrir el panel para verlo.
      data-ayuda-slug={slug}
    >
      <CircleHelp aria-hidden="true" />
      {/* Por debajo de `sm` el encabezado va justo de sitio —ahí ya se esconden la fecha y la
          etiqueta del tema—, así que queda sólo el icono. Sigue teniendo su nombre accesible,
          y el área de toque es la del botón entero. */}
      <span className="hidden sm:inline">Ayuda</span>
    </button>
  );
}
