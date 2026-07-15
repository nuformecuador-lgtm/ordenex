# 65-lestura-de-qr — tasks.md

Checklist de implementación de la feature 65 (lectura de QR). Cada task tiene
criterio de "hecho" y mapea a requisitos `R<n>`. Las verificaciones de cámara se
hacen manualmente en navegador con cámara real o modo dispositivo (Chrome DevTools >
Sensors > emular cámara).

Convención: `[P]` = paralelizable con sus hermanas una vez cumplida su
dependencia.

---

## T1 — Añadir item "QR" al menú lateral

- En `lib/auth/menu-visibility.ts`:
  - Añadir `"qrCode"` al tipo `IconKey` (unión de strings, línea 11).
  - Añadir un nuevo ítem al arreglo `SIDEBAR_ITEMS`:
    ```typescript
    {
      label: "QR",
      href: "/qr",
      iconKey: "qrCode",
      roles: ROLES_SEED,
    }
    ```
    Colocarlo en una posición lógica (sugerido: después de "Órdenes" y antes de
    "Configuración", o al final antes de "Perfil"). Los ítems visibles para todos
    los roles (como "Perfil") usan `ROLES_SEED` importado de `@/lib/types/roles`.
- En `app/(app)/_components/Sidebar.tsx`:
  - Añadir `QrCode` al import de `lucide-react` (línea ~7-15).
  - Añadir `qrCode: QrCode` al mapa `ICON_BY_KEY` (línea ~132-138).

- **Hecho:** `pnpm typecheck` pasa. El ítem "QR" con icono `QrCode` aparece en
  el menú lateral para cualquier rol autenticado. Al hacer clic navega a `/qr`
  (aunque la página aún no existe, devolverá 404 hasta T2).
- **Cubre:** R1, R2, R3.
- **Depende de:** —

---

## T2 — Crear página base `/qr` con layout y guard de sesión

- Crear `app/(app)/qr/page.tsx` como Client Component (`"use client"`):
  - Importar `useState`, `useEffect`, `useId`, `useCallback` de React.
  - Importar `useRouter` de `next/navigation`.
  - Importar `useToast` de `@/hooks/useToast`.
  - Importar `Button` de `@/components/ui/button`.
  - Importar `PageHeader` de `@/components/shared/PageHeader` (para consistencia
    visual con el resto de páginas autenticadas; el header muestra título
    "Escanear QR").
  - Estado: `camaraAbierta` (boolean, inicial `false`), `procesando` (boolean,
    inicial `false`), `error` (string | null).
  - Renderizar:
    ```
    <PageHeader titulo="Escanear QR" />
    <div class="flex flex-1 flex-col items-center justify-center gap-4 px-4">
      <p>Usa la cámara para escanear un código QR y acceder a la ruta que contiene.</p>
      <button>Escanear con cámara</button>
      {/* visor de cámara (condicional) */}
      {/* indicador de carga */}
      {/* mensaje de error */}
    </div>
    ```
  - El botón "Escanear con cámara" tiene `onClick` que hace
    `setCamaraAbierta(true)`.
  - Cuando `camaraAbierta` es `true`, el botón cambia a "Cerrar cámara" con
    `variant="outline"` y `onClick` que hace `setCamaraAbierta(false)`.

- **Hecho:** la página `/qr` carga sin errores, muestra el header "Escanear QR"
  y un botón "Escanear con cámara". `pnpm typecheck` pasa. El `middleware.ts`
  redirige a `/login` si no hay sesión (R5).
- **Cubre:** R4, R5, R6, R10, R13, R14.
- **Depende de:** T1 (sin el ítem del menú no hay forma de navegar, pero la
  página puede probarse directamente en `/qr`).

---

## T3 — Integrar cámara con `html5-qrcode` (patrón EscanerRecepcion)

- En el componente de T2, añadir la lógica de cámara:
  - `regionId = useId().replace(/:/g, "_") + "-camara"`.
  - `useEffect` gateado por `camaraAbierta`:
    - Si `!camaraAbierta` → return.
    - `let cancelado = false`.
    - IIFE async:
      - `const { Html5Qrcode } = await import("html5-qrcode")`.
      - Si `cancelado` → return.
      - `const scanner = new Html5Qrcode(regionId)`.
      - `await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (decodedText) => { setCamaraAbierta(false); void procesar(decodedText); }, undefined)`.
    - Catch: si `!cancelado`, `toast.error("No se pudo acceder a la cámara...")`, `setCamaraAbierta(false)`.
    - Cleanup: `cancelado = true`, si la instancia tiene `stop` y `clear`, llamarlos.
  - La función `procesar(decodedText: string)` se implementa en T4.
  - Renderizar condicionalmente el visor:
    ```tsx
    {camaraAbierta && (
      <div id={regionId} role="region" aria-label="Visor de cámara QR"
           className="w-full max-w-sm overflow-hidden rounded-lg border" />
    )}
    ```

- **Hecho:** al pulsar "Escanear con cámara", el navegador solicita permiso de
  cámara. Si se concede, el visor se muestra y la cámara trasera escanea. Al
  pulsar "Cerrar cámara", el visor se oculta y la cámara se detiene. Si el
  permiso se deniega, aparece un toast de error y el botón vuelve a estar
  accionable.
- **Cubre:** R6, R9, R10.
- **Depende de:** T2.

---

## T4 — Validación de ruta y redirección

- Implementar la función `procesar(decodedText: string)`:
  1. Si `procesando` → return (anti doble escaneo).
  2. `setProcesando(true)`, limpiar `error`.
  3. Validar el texto decodificado:
     ```typescript
     const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
     try {
       const qrUrl = new URL(decodedText);
       if (qrUrl.origin !== appOrigin) {
         throw new Error("El código QR pertenece a otro sitio.");
       }
       const destino = qrUrl.pathname + qrUrl.search + qrUrl.hash;
       setCamaraAbierta(false);
       router.push(destino);
     } catch {
       if (!decodedText.startsWith("/")) {
         toast.error("El código QR no contiene una ruta válida de la app.");
         setProcesando(false);
         return;
       }
       // Si empieza con /, es una ruta relativa: redirigir directamente.
       setCamaraAbierta(false);
       router.push(decodedText);
     }
     ```
  4. En el `finally` no se pone `setProcesando(false)` porque si la ruta es
     válida se navega fuera y el componente se desmonta; si es inválida, el
     `return` ya lo restableció.

- **Hecho:** al escanear un QR con URL `http://localhost:3000/paquete/<uuid>`, el
  usuario es redirigido a `/paquete/<uuid>`. Al escanear un QR con una URL
  externa (`https://google.com`), se muestra un toast de error y el botón de
  escaneo queda accionable. Al escanear un QR con texto no-URL (ej. "hola"), se
  muestra toast de error.
- **Cubre:** R7, R8, R11, R12.
- **Depende de:** T3.

---

## T5 — Estados de carga y feedback visual

- Cuando `procesando` es `true`, mostrar:
  - Un spinner o texto "Procesando código QR…" en lugar del visor de cámara.
  - El botón de escaneo deshabilitado (no se puede iniciar otro escaneo mientras
    se procesa).
- El toast de error (T4) usa `toast.error()` de `@/hooks/useToast`.
- El layout debe centrar el contenido verticalmente: `flex flex-1 flex-col items-center justify-center`.
- Añadir padding y márgenes para que en móviles estrechos (320px+) el contenido
  no toque los bordes.

- **Hecho:** durante el procesamiento de un QR, se muestra feedback visual
  (spinner/texto) y no se puede iniciar otro escaneo. Si la ruta es inválida,
  aparece un toast de error y el flujo se restablece para otro intento.
- **Cubre:** R11, R13.
- **Depende de:** T3, T4.

---

## T6 — Verificación de no regresiones

- Ejecutar `pnpm typecheck` y verificar que pase sin errores (R15).
- Ejecutar `pnpm lint` y verificar que pase sin errores.
- Ejecutar `pnpm test` y verificar que todos los tests existentes pasen sin
  regresiones (R17).
- Ejecutar `pnpm build` y verificar que compile sin errores (R16).
- **Hecho:** los 4 comandos terminan en verde. No hay fallos nuevos introducidos
  por los cambios.
- **Cubre:** R15, R16, R17.
- **Depende de:** T1–T5.

---

## T7 — Trazabilidad y documentación

- Escribir `progress/impl_65-lestura-de-qr.md` con:
  - Lista de archivos creados/modificados.
  - Mapa `R<n> → verificación` (ver tabla abajo, R1–R17).
  - Salida de los comandos `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm build`.
- **Hecho:** el archivo existe y cubre todos los `R<n>` con su verificación
  concreta.
- **Depende de:** T6.

---

## Mapa R → verificación

| R | Verificación |
| --- | --- |
| R1 | `SIDEBAR_ITEMS` incluye ítem "QR" con `roles: ROLES_SEED` (todos los roles) |
| R2 | El ítem "QR" con icono `QrCode` y href `/qr` aparece en el sidebar para cualquier rol autenticado |
| R3 | En `/login` (sin sesión), el ítem "QR" no aparece en el sidebar (el sidebar no se monta en rutas públicas) |
| R4 | Existe `app/(app)/qr/page.tsx`; al navegar a `/qr` carga sin errores |
| R5 | Sin sesión, `/qr` redirige a `/login` (vía `middleware.ts`) |
| R6 | La página muestra un botón "Escanear con cámara"; la cámara no se activa sola |
| R7 | Al escanear QR con ruta interna válida, se redirige a esa ruta y la cámara se cierra |
| R8 | Al escanear QR con ruta inválida/externa, se muestra error y se permite reintentar |
| R9 | Al denegar permiso de cámara, se muestra toast de error y el botón sigue accionable |
| R10 | Con cámara activa: se muestra el visor y el botón cambia a "Cerrar cámara" |
| R11 | Mientras procesa: se muestra indicador de carga y no se permite otro escaneo |
| R12 | Tras escaneo exitoso: la cámara se cierra antes de la redirección |
| R13 | La página está centrada con `max-w-sm`, legible en 320px+ |
| R14 | El botón es un `<button>` operable por teclado; el visor tiene `aria-label` |
| R15 | `pnpm typecheck` pasa sin errores |
| R16 | `pnpm build` compila sin errores |
| R17 | `pnpm test` pasa sin regresiones |

---

## Notas de implementación

- La función `procesar()` NO debe usar `extractOrdenIdFromScan` de
  `lib/utils/paquete-url.ts` porque esta feature no recibe órdenes: el QR
  codifica una ruta arbitraria y el trabajo es redirigir, no procesar un
  `ordenId`.
- El `origin` de la app se resuelve de `NEXT_PUBLIC_APP_URL` (variable de
  entorno inlineada por Next.js). En desarrollo local, si esta variable no está
  definida, se usa `window.location.origin` como fallback.
- La verificación de cámara (R6, R7, R8, R9, R10, R11, R12, R13, R14) es
  **manual** porque requiere hardware de cámara o emulación en DevTools. No se
  puede automatizar en tests unitarios/de integración sin mock complejo de
  `html5-qrcode`.
- El `PageHeader` se usa para consistencia visual con el resto de páginas del
  grupo `(app)`. El título "Escanear QR" aparece en la barra superior.
- Si `NEXT_PUBLIC_APP_URL` no está configurada en `.env` local, la validación de
  origen usará `window.location.origin`, que en desarrollo es
  `http://localhost:3000`. Los QR de prueba deben codificar URLs con ese mismo
  origen.
