"use client";

import { AppPage } from "@/components/shared/AppPage";
import { QrScanner } from "@/components/shared/QrScanner";
import { useQrNavigate } from "@/hooks/useQrNavigate";

export default function QrPage() {
  const { onDecoded, procesando } = useQrNavigate();

  return (
    <AppPage title="Escanear QR" contentClassName="items-center justify-center">
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
    </AppPage>
  );
}
