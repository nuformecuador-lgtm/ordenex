import type { Metadata } from "next";
import Script from "next/script";
import { Poppins, JetBrains_Mono } from "next/font/google";
import { RESCATE_INLINE } from "@/lib/pwa/rescate-inline";
import "./globals.css";

const sans = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ordenex",
  description: "Plataforma de logística y entregas Ordenex",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Feature 284 (R1): `lang="es"`. La app es integramente en español y hasta hoy el documento
  // se declaraba en ingles: el lector de pantalla pronunciaba el castellano con fonetica
  // inglesa, el corrector del navegador subrayaba media pantalla y el traductor automatico se
  // ofrecia a traducir a su propio idioma.
  return (
    <html
      lang="es"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0d2444" />
        {/* Feature 284 (R18): la moderna y la de Apple, LAS DOS. `mobile-web-app-capable` es
            la estandar; retirar la de Apple dejaria fuera a los iPhone que solo leen aquella. */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Ordenex" />
        {/* Feature 284 (R19): iOS pide 180x180 y aplica EL SOLO su mascara redondeada, asi que
            este PNG va a sangre (esquinas cuadradas). Apuntar al de 192 -que ya viene con las
            esquinas recortadas- daba el doble redondeo que se veia en la pantalla de inicio. */}
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png" />
        {/* Feature 284 — camino de rescate. Va INLINE y en el `<head>` a proposito: es lo que
            tiene que seguir en pie cuando lo roto son los chunks de JavaScript. Ver
            `lib/pwa/rescate-inline.ts`. */}
        <script dangerouslySetInnerHTML={{ __html: RESCATE_INLINE }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        {/* PWA (feature 64): el service worker SOLO se registra en produccion. En
            desarrollo cachea los chunks de Next y, como sus hashes cambian en cada
            recompilacion, provoca fallos de carga de chunk -> recarga infinita. Ademas,
            en dev DES-registra cualquier SW previo y limpia sus caches, para que un
            navegador que ya lo tenia registrado se limpie solo sin pasos manuales. */}
        <Script id="sw-register" strategy="afterInteractive">
          {process.env.NODE_ENV === "production"
            ? `if ('serviceWorker' in navigator) {
                 window.addEventListener('load', () => {
                   navigator.serviceWorker.register('/sw.js').catch(() => {});
                 });
               }`
            : `if ('serviceWorker' in navigator) {
                 navigator.serviceWorker.getRegistrations()
                   .then((rs) => { for (const r of rs) r.unregister(); })
                   .catch(() => {});
                 if (window.caches) {
                   caches.keys().then((ks) => { for (const k of ks) caches.delete(k); }).catch(() => {});
                 }
               }`}
        </Script>
      </body>
    </html>
  );
}
