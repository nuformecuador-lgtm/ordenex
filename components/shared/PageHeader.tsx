import { LogoutButton } from "@/app/_components/LogoutButton";
import { Bell, Calendar } from "lucide-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

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
  return (
    <header className="flex flex-col gap-3 px-5 py-4 text-navy border-b border-navy/20 mb-6">
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

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Calendar />
          <p></p>
        </div>
        <Bell />
        <LogoutButton />
      </div>
      {children}
    </header>
  );
}
