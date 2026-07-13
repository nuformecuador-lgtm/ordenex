import type { ReactNode } from "react";
import { LogoutButton } from "@/app/_components/LogoutButton";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * Encabezado de página estandarizado (fondo navy, texto blanco). Uso:
 * `<PageHeader title="..." description="..." actions={<Button />}>`.
 * Server component: en la zona superior derecha monta el control de logout
 * "Salir" (feature 57), un client component, presente en toda página
 * autenticada (el `PageHeader` solo se usa bajo el shell `app/(app)`). Las
 * `actions` específicas de cada página se colocan a la izquierda del logout.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 rounded-lg bg-navy px-5 py-4 text-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-white/70">{description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {actions}
          <LogoutButton />
        </div>
      </div>
      {children}
    </header>
  );
}
