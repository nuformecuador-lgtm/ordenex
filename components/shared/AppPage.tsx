import type { ReactNode } from "react";

import { Container } from "@/components/shared/Container";
import { PageHeader } from "@/components/shared/PageHeader";

interface AppPageProps {
  /** Título de la página (encabezado nivel 1 del `PageHeader`). */
  title: string;
  /** Subtítulo opcional bajo el título. */
  description?: string;
  /** Acciones específicas de la página (botones, etc.) en el topbar. */
  actions?: ReactNode;
  /** Contenido de la página; se apila dentro del `Container` (`p-6`, `gap-6`). */
  children?: ReactNode;
  /** Clases extra para el `Container` del contenido (casos puntuales). */
  contentClassName?: string;
}

/**
 * Shell único de página: `PageHeader` full-bleed (su `border-b` llega a los
 * bordes, sin padding lateral alrededor) seguido del contenido dentro del
 * `Container` (`p-6`, `gap-6`). Es el ÚNICO envoltorio de página — ninguna
 * página arma su propio `<section p-6>` ni envuelve el header en padding.
 * El ritmo vertical (header↔contenido y entre secciones) lo maneja el
 * `Container`; por eso el `PageHeader` NO trae `mb`.
 */
export function AppPage({
  title,
  description,
  actions,
  children,
  contentClassName,
}: Readonly<AppPageProps>) {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={title} description={description} actions={actions} />
      <Container className={contentClassName}>{children}</Container>
    </div>
  );
}
