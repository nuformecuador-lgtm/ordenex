import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LiberadaHoyRow } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";

// Feature 46 (T15, R15/R16) — aviso DERIVADO "Liberadas hoy (reprogramacion)" de la
// bodega responsable. Componente PRIVADO: recibe por props las ordenes ya resueltas
// server-side (el Server Component padre valido el rol/zona via `listarLiberadasHoy`);
// NO fetchea datos sensibles por si mismo. Se monta en las DOS vistas de bodega:
// maestro central (`en_bodega`) y adminSatelite (`en_bodega_satelite`). Si no hay
// ordenes liberadas hoy, NO renderiza la seccion (aviso solo cuando hay algo que
// avisar). Textos como children/literales, listos para i18n futuro.

export interface BodegaLiberadasHoyProps {
  /** Ordenes liberadas HOY (CR) por el cron, ya scoped a la bodega del actor. */
  liberadas: LiberadaHoyRow[];
}

/** Referencia legible de la orden: numero de guia si existe, si no la remision. */
function referenciaOrden(orden: LiberadaHoyRow): string {
  return orden.numGuia !== null ? `Guía ${orden.numGuia}` : orden.numRemision;
}

export function BodegaLiberadasHoy({ liberadas }: BodegaLiberadasHoyProps) {
  // R15: sin liberaciones hoy no hay aviso que mostrar.
  if (liberadas.length === 0) return null;

  return (
    <section
      aria-label="Liberadas hoy (reprogramación)"
      className="flex flex-col gap-3 border-t pt-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Liberadas hoy (reprogramación)</h2>
        <Badge variant="secondary" aria-label={`${liberadas.length} liberadas hoy`}>
          {liberadas.length}
        </Badge>
      </div>
      <ul className="flex flex-col gap-3">
        {liberadas.map((orden) => (
          <li key={orden.id}>
            <Card>
              <CardHeader>
                <CardTitle>
                  {referenciaOrden(orden)} · {orden.destinatario}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Remisión {orden.numRemision}
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
