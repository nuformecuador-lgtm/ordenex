import { LogoutButton } from "@/app/_components/LogoutButton";
import { AyudaBoton } from "@/components/shared/AyudaBoton";
import { InstalarPwaButton } from "@/components/shared/InstalarPwaButton";
import { NotificationsBell } from "@/components/shared/NotificationsBell";
import { TemaToggle } from "@/components/shared/TemaToggle";
import { Calendar } from "lucide-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * Pedido humano: el encabezado se tiñe SEGÚN EL ROL de quien está dentro, con un tinte
 * CLARO —lo justo para que se note de un vistazo en qué portal estás, sin tocar el
 * contraste del título ni de los controles, que van con el color de texto del tema.
 *
 * El rol no se resuelve aquí (este componente es de presentación pura y lo usan páginas
 * server y client): lo pone el layout del portal como `data-rol` sobre el contenedor
 * `group/app`, y cada variante se elige por CSS. Un rol sin variante (o sin sesión) se
 * queda con el fondo transparente de antes.
 *
 * Feature 202 — los cuatro tintes semánticos (brand/info/warning/success) se dejaron
 * como estaban: medidos en el navegador, en modo oscuro siguen separándose del fondo
 * de página (distancia RGB 19–27, la misma escala que en claro). El de `maestro` sí
 * cambió: `bg-navy/5` es un azul casi negro sobre un fondo casi negro y en oscuro daba
 * distancia 1.8, o sea NINGÚN tinte. `foreground/5` gira con el tema —en claro compone
 * el mismo #ebedf3 de antes y en oscuro aclara— así que el maestro vuelve a tener pista
 * de portal en los dos temas.
 */
const FONDO_POR_ROL = [
  "group-data-[rol=maestro]/app:bg-foreground/5",
  "group-data-[rol=admin]/app:bg-brand/10",
  "group-data-[rol=adminSatelite]/app:bg-info/10",
  "group-data-[rol=adminTienda]/app:bg-warning/10",
  "group-data-[rol=mensajero]/app:bg-success/10",
].join(" ");

/**
 * Encabezado de página estandarizado. Uso:
 * `<PageHeader title="..." description="..." actions={<Button />}>`.
 * Componente de presentación puro, server-compatible.
 *
 * Color: SOLO tokens semánticos (`foreground`, `muted-foreground`, `border`), que giran
 * con el tema. Antes usaba `navy` fijo y el `<h1>` de toda página quedaba en 1.03:1 de
 * contraste en modo oscuro (feature 202).
 *
 * ⭑ FICHA 437 — LA FILA SE APILA POR DEBAJO DE `lg`, Y NO ES COSMÉTICO: ERA «SALIR» FUERA
 * DE LA PANTALLA. Reportado con captura desde un teléfono. Medido en `/mis-asignaciones/reparto`
 * a 390×844 con sesión de mensajero: el botón «Salir» empezaba en x=352 y terminaba en 427, con
 * el viewport en 390 y `documentElement.scrollWidth - clientWidth = 0`. Sin scroll horizontal, o
 * sea INALCANZABLE: no se podía cerrar sesión desde un teléfono. El título pagaba toda la
 * compresión —93 px de caja, con la descripción partida en 3 líneas—, y en otras pantallas peor:
 * `/monitoreo` 8 líneas en 118 px, `/cierres-admin` 8 en 83 px.
 *
 * La causa era esta misma fila: `flex-row` + `justify-between` SIN posibilidad de envolver, con
 * los controles en `shrink-0` por la base de `buttonVariants`. Nada podía ceder salvo el título,
 * y cuando el título llegaba a su `min-content` el resto se salía por la derecha.
 *
 * POR QUÉ `lg` Y NO `sm` NI `md`, con los números. En una sola línea la fila necesita
 * 20 (px-5) + mín. del título + 12 (gap) + los controles + 20. A partir de `sm` los controles
 * miden 521 px (fecha 110 · «?» 90 · tema 82 · campana 116 · salir 75, con 4 huecos de 12), y el
 * mínimo del título medido va de 83 px (`/cierres-admin`) a 118 px (`/monitoreo`): hacen falta
 * **entre 666 y 691 px DE ENCABEZADO**. Y el encabezado no mide lo que el viewport: desde `md`
 * aparece el sidebar (`SIDEBAR_WIDTH` = 16rem = 256 px, `md:flex` en `components/ui/sidebar.tsx`),
 * así que a 768 px de viewport al encabezado le quedan 512 — medido, con «Salir» terminando en
 * 927 contra un límite de 748. `lg` (1024) es el primer breakpoint que deja 1024−256 = **768 px**,
 * por encima de los 691 que pide el caso peor.
 *
 * `max-lg:flex-wrap` en la fila de controles es el seguro del caso estrecho: apilados ocupan
 * 303 px y en un teléfono de 390 sobran, pero a 320 px (medido) o con `InstalarPwaButton`
 * visible no caben, y entonces envuelven en vez de salirse. Va como `max-lg:` y no como
 * `lg:flex-nowrap` porque esto último NO funciona aquí: medido en el navegador, un
 * `flex-wrap lg:flex-nowrap` computa `flex-wrap: wrap` a 1440.
 *
 * ⚠️ DE `lg` PARA ARRIBA ESTO NO CAMBIA NADA, y está medido caja por caja: a 1440, en las tres
 * pantallas, el `h1`, la descripción, la fecha y los cuatro controles caen en las MISMAS
 * coordenadas que antes del cambio (p. ej. «Salir» x=1345 w=75 en las dos corridas). Lo que hay
 * arriba de `lg` es exactamente el `flex-row justify-between` de siempre.
 *
 * Lo vigila `tests/unit/guards/encabezado-acciones-dentro-del-ancho.guardia.test.ts`, que sabe
 * estos números: si alguien baja el breakpoint a `sm`/`md`, vuelve a poner la fila en `flex-row`
 * fija o le quita el envoltorio a los controles, se pone rojo.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: Readonly<PageHeaderProps>) {

  const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <header className={`flex flex-col gap-3 px-5 py-4 text-foreground border-b border-border lg:flex-row lg:justify-between ${FONDO_POR_ROL}`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="flex items-center gap-3 max-lg:flex-wrap">
        {/* Pedido humano: por debajo de ~535px la fecha aprieta al título y a los dos
            controles de la derecha, así que se oculta hasta el siguiente breakpoint de
            Tailwind (`sm`, 640px). Es un dato de contexto, no una acción: se puede perder
            en pantallas estrechas sin dejar al usuario sin nada. */}
        <span className="hidden items-center gap-1.5 rounded-full border border-border bg-foreground/5 px-2.5 py-1 text-xs font-medium text-foreground sm:inline-flex">
          <Calendar className="size-3.5" aria-hidden="true" />
          {today}
        </span>
        {/* Feature 164: solo aparece cuando el navegador ofrece instalar; en cuanto la app
            está instalada (o el navegador no lo soporta) no ocupa espacio. En pantallas
            estrechas se queda en icono, que es donde el hueco escasea. */}
        <InstalarPwaButton soloIcono className="sm:hidden" />
        <InstalarPwaButton className="hidden sm:inline-flex" />
        {/* ⭑ Ficha 433: el «?» de la ayuda DE ESTA PANTALLA. Vive aquí, junto al interruptor
            de tema, por la misma razón que él: es el único sitio presente en TODA página
            autenticada. UN solo montaje cubre las 29 pantallas, porque las 29 pasan por
            `AppPage` -> `PageHeader`; una tabla de botones pantalla a pantalla habría dejado
            sin ayuda a la primera que alguien olvidara.
            SE PINTA SOLO SI ESA PANTALLA TIENE DOCUMENTO — el componente devuelve `null`
            cuando no lo hay, así que este montaje no promete un «?» en todas partes.
            Va ANTES del tema y no después: el orden de lectura del encabezado es
            contexto (fecha) → instalar → ayuda → preferencia → salir, de lo que sirve para la
            tarea a lo que cierra la sesión. */}
        <AyudaBoton />
        {/* Feature 211: el interruptor de tema. Vive aquí —y no en el sidebar ni en un
            menú de preferencias— porque es el único sitio presente en TODA página
            autenticada, que es donde el tema se nota. Estampa la clase a través del
            `TemaProvider` del layout del portal. */}
        <TemaToggle />
        <NotificationsBell />
        <LogoutButton />
      </div>
      {children}
    </header>
  );
}
