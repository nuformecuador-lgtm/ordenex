"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { useToast } from "@/hooks/useToast";

export default function QrPage() {
  const router = useRouter();
  const toast = useToast();

  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const [procesando, setProcesando] = useState(false);

  const regionId = useId().replace(/:/g, "_") + "-camara";

  const procesar = useCallback(
    async (decodedText: string) => {
      if (procesando) return;
      setProcesando(true);

      const appOrigin =
        process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;

      try {
        const qrUrl = new URL(decodedText);
        if (qrUrl.origin !== appOrigin) {
          toast.error("El código QR pertenece a otro sitio.");
          setProcesando(false);
          return;
        }
        const destino = qrUrl.pathname + qrUrl.search + qrUrl.hash;
        setCamaraAbierta(false);
        router.push(destino);
        return;
      } catch {
        if (!decodedText.startsWith("/")) {
          toast.error("El código QR no contiene una ruta válida de la app.");
          setProcesando(false);
          return;
        }
        setCamaraAbierta(false);
        router.push(decodedText);
      }
    },
    [procesando, router, toast],
  );

  useEffect(() => {
    if (!camaraAbierta) return;
    let cancelado = false;
    let instancia: {
      stop: () => Promise<void>;
      clear: () => void;
    } | null = null;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelado) return;
        const scanner = new Html5Qrcode(regionId);
        instancia = scanner as unknown as typeof instancia;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decodedText: string) => {
            setCamaraAbierta(false);
            void procesar(decodedText);
          },
          undefined,
        );
      } catch {
        if (!cancelado) {
          toast.error("No se pudo acceder a la cámara. Verifica los permisos del navegador.");
          setCamaraAbierta(false);
        }
      }
    })();

    return () => {
      cancelado = true;
      const s = instancia;
      if (s && typeof s.stop === "function") {
        Promise.resolve(s.stop())
          .then(() => {
            if (typeof s.clear === "function") s.clear();
          })
          .catch(() => {});
      }
    };
  }, [camaraAbierta, regionId, procesar, toast]);

  return (
    <>
      <PageHeader title="Escanear QR" />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
        <p className="text-center text-muted-foreground max-w-sm">
          Usa la cámara para escanear un código QR y acceder a la ruta que
          contiene.
        </p>

        <Button
          type="button"
          variant={camaraAbierta ? "outline" : "default"}
          aria-pressed={camaraAbierta}
          disabled={procesando}
          onClick={() => setCamaraAbierta((a) => !a)}
        >
          {camaraAbierta ? "Cerrar cámara" : "Escanear con cámara"}
        </Button>

        {camaraAbierta && !procesando ? (
          <div
            id={regionId}
            role="region"
            aria-label="Visor de cámara QR"
            className="w-full max-w-sm overflow-hidden rounded-lg border"
          />
        ) : null}

        {procesando ? (
          <p className="text-sm text-muted-foreground">
            Procesando código QR…
          </p>
        ) : null}
      </div>
    </>
  );
}
