import { LogoutButton } from "@/app/_components/LogoutButton";
import { InstalarPwaButton } from "@/components/shared/InstalarPwaButton";
import { NotificationsBell } from "@/components/shared/NotificationsBell";
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
 * contraste del título ni de los controles, que siguen en navy.
 *
 * El rol no se resuelve aquí (este componente es de presentación pura y lo usan páginas
 * server y client): lo pone el layout del portal como `data-rol` sobre el contenedor
 * `group/app`, y cada variante se elige por CSS. Un rol sin variante (o sin sesión) se
 * queda con el fondo transparente de antes.
 */
const FONDO_POR_ROL = [
  "group-data-[rol=maestro]/app:bg-navy/5",
  "group-data-[rol=admin]/app:bg-brand/10",
  "group-data-[rol=adminSatelite]/app:bg-info/10",
  "group-data-[rol=adminTienda]/app:bg-warning/10",
  "group-data-[rol=mensajero]/app:bg-success/10",
].join(" ");

/**
 * Encabezado de página estandarizado (fondo navy, texto blanco). Uso:
 * `<PageHeader title="..." description="..." actions={<Button />}>`.
 * Componente de presentación puro, server-compatible.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: Readonly<PageHeaderProps>) {

  const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <header className={`flex flex-row gap-3 px-5 py-4 text-navy border-b border-navy/20 justify-between ${FONDO_POR_ROL}`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-navy/70">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        {/* Pedido humano: por debajo de ~535px la fecha aprieta al título y a los dos
            controles de la derecha, así que se oculta hasta el siguiente breakpoint de
            Tailwind (`sm`, 640px). Es un dato de contexto, no una acción: se puede perder
            en pantallas estrechas sin dejar al usuario sin nada. */}
        <span className="hidden items-center gap-1.5 rounded-full border border-navy/20 bg-navy/5 px-2.5 py-1 text-xs font-medium text-navy sm:inline-flex">
          <Calendar className="size-3.5" aria-hidden="true" />
          {today}
        </span>
        {/* Feature 164: solo aparece cuando el navegador ofrece instalar; en cuanto la app
            está instalada (o el navegador no lo soporta) no ocupa espacio. En pantallas
            estrechas se queda en icono, que es donde el hueco escasea. */}
        <InstalarPwaButton soloIcono className="sm:hidden" />
        <InstalarPwaButton className="hidden sm:inline-flex" />
        <NotificationsBell />
        <LogoutButton />
      </div>
      {children}
    </header>
  );
}
