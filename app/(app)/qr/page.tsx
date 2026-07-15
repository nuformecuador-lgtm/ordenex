"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { QrScanner } from "@/components/shared/QrScanner";
import { useQrNavigate } from "@/hooks/useQrNavigate";

export default function QrPage() {
  const { onDecoded, procesando } = useQrNavigate();

  return (
    <>
      <PageHeader title="Escanear QR" />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
        <p className="text-center text-muted-foreground max-w-sm">
          Usa la cámara para escanear un código QR y acceder a la ruta que
          contiene.
        </p>

        <QrScanner onDecoded={onDecoded} disabled={procesando} />

        {procesando ? (
          <p className="text-sm text-muted-foreground">
            Procesando código QR…
          </p>
        ) : null}
      </div>
    </>
  );
}
