# 65-lestura-de-qr — design.md

Diseño técnico de la página de lectura QR (feature 65). Traza contra
`requirements.md`. No introduce tablas, RLS, migraciones, `app/api/`, Server
Actions ni cambios de schema. No hay backend.

## Decisión principal: patrón de cámara prestado de EscanerRecepcion

**Decisión:** reutilizar el mismo patrón de `html5-qrcode` que ya funciona en
`app/(app)/recepcion-satelite/_components/EscanerRecepcion.tsx` (feature 33):

- **Import dinámico** para evitar SSR: `const { Html5Qrcode } = await import("html5-qrcode")`
- **Ciclo de vida en `useEffect`** gateado por un booleano `camaraAbierta`
- **Instancia única** controlada por un `useRef` y limpiada en el cleanup del
  efecto
- **Configuración de cámara:** `{ facingMode: "environment" }` (cámara trasera),
  `{ fps: 10, qrbox: 250 }`
- **`useId()`** para generar un id único de región del visor, sanitizado con
  `.replace(/:/g, "_")`

### Alternativa descartada: `@yudiel/react-qr-scanner` o `react-qr-reader`

Estas librerías ofrecen componentes React declarativos para el escáner QR.

**Descartadas porque:**
1. `html5-qrcode` ya está instalado (v2.3.8 en `package.json`), probado en
   producción y con un patrón de uso estable en el proyecto. Añadir otra
   librería para la misma funcionalidad viola el principio de "dependencia
   innecesaria" (`docs/architecture.md`).
2. `@yudiel/react-qr-scanner` y `react-qr-reader` son wrappers de librerías
   subyacentes que añaden una capa extra de abstracción y posibles
   incompatibilidades con Next.js 16 + Turbopack.
3. Mantener una sola librería de escaneo QR reduce la superficie de bugs y
   facilita actualizaciones futuras.

## Arquitectura de archivos

### Archivos que se tocan

| Archivo | Cambio | Descripción |
| --- | --- | --- |
| `lib/auth/menu-visibility.ts` | Modificar | Añadir `"qrCode"` al tipo `IconKey`, añadir ítem "QR" a `SIDEBAR_ITEMS` |
| `app/(app)/_components/Sidebar.tsx` | Modificar | Importar `QrCode` de lucide-react, añadir entrada en `ICON_BY_KEY` |
| `app/(app)/qr/page.tsx` | Crear | Página del escáner QR (client component) |

**Total: 1 archivo creado, 2 modificados.** Ninguno toca rutas de API, Server
Actions, hooks ni providers existentes.

### Árbol de componentes (nueva página)

```
app/(app)/qr/page.tsx  (client, "use client")
├── <PageHeader />              (ya existe, se reutiliza)
├── Botón "Escanear con cámara" (toggles camaraAbierta)
├── Visor de cámara             (solo si camaraAbierta)
│   └── <div id={regionId}>    (Html5Qrcode monta aquí)
├── Indicador de carga          (mientras procesando)
└── Mensaje de error            (si hay error)
```

## Flujo de redirección

```
1. Usuario abre /qr
2. Pulsa "Escanear con cámara"
3. useEffect carga Html5Qrcode dinámicamente
4. Cámara se abre en el <div id={regionId}>
5. Html5Qrcode decodifica un QR → callback (decodedText: string)
6. setCamaraAbierta(false) + setProcesando(true)
7. Validar ruta:
   a. Parsear decodedText como URL (new URL)
   b. Si no es URL válida → error "El código QR no contiene una ruta válida"
   c. Si el origin NO coincide con el de la app → error
   d. Extraer pathname + search
   e. router.push(pathname + search)
8. Si error en paso 7 → toast.error, setProcesando(false), habilitar botón
```

### Estrategia de validación de ruta

La URL de la app se resuelve de `NEXT_PUBLIC_APP_URL` (misma variable que usa
`resolveAppOrigin()` en `lib/utils/paquete-url.ts`). Se compara el `origin` del
QR decodificado con este valor. Esto evita redirigir a URLs maliciosas de
dominios externos.

```typescript
const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
const qrUrl = new URL(decodedText);
if (qrUrl.origin !== appOrigin) {
  // error: ruta externa
}
router.push(qrUrl.pathname + qrUrl.search);
```

**No se restringe a `/paquete/*`**: aunque hoy los QR solo codifican rutas
`/paquete/<ordenId>`, validar por origen es más flexible y no requiere
modificaciones si en el futuro se codifican otras rutas.

## Icono del menú

El icono `QrCode` de `lucide-react` ya está disponible en la versión instalada.
Se añade a:

1. El `IconKey` union type en `menu-visibility.ts`: `| "qrCode"`
2. Los imports de lucide en `Sidebar.tsx`: se añade `QrCode` a la lista
3. El mapa `ICON_BY_KEY` en `Sidebar.tsx`: `qrCode: QrCode`

## Página `/qr` — Server Component wrapper

La página es un Client Component (`"use client"`) porque la cámara requiere APIs
del navegador. El layout `app/(app)/layout.tsx` ya provee el `SidebarProvider`,
`ToastProvider` y el guard de sesión (`resolveActorFromSession`).

**No se necesita guard de rol** porque la página es accesible para todos los
roles autenticados. El `middleware.ts` ya rechaza peticiones sin cookie de
sesión, redirigiendo a `/login`.

## Contratos I/O

- **Página** `app/(app)/qr/page.tsx`: Client Component, sin props. Usa
  `useRouter` de `next/navigation` para la redirección y `useToast` de
  `@/hooks/useToast` para feedback de errores.
- **No hay Server Actions, API routes ni props de servidor.** El componente
  vive enteramente en el cliente salvo el layout que lo envuelve.

## Datos / migraciones / RLS

Ninguna. No se crean tablas ni columnas ni archivos en `db/migrations/`. No se
tocan repositorios, servicios ni acciones de servidor.

## Riesgos y mitigaciones

### Riesgo 1: Cámara no disponible en desktop

**Mitigación:** el `catch` del `scanner.start()` captura el error y muestra un
toast con instrucciones. El botón de escaneo sigue visible para reintentar (por
si el usuario conecta una cámara o cambia los permisos).

### Riesgo 2: Doble escaneo por QR leído dos veces

**Mitigación:** al decodificar un QR, `setCamaraAbierta(false)` se ejecuta
**antes** de procesar la ruta, lo que dispara el cleanup del `useEffect` y
detiene el escáner. Además, un flag `procesando` bloquea llamadas duplicadas
a `procesar()`.

### Riesgo 3: Memory leak si el usuario navega sin cerrar la cámara

**Mitigación:** el cleanup del `useEffect` (`return () => { ... }`) detiene y
limpia la instancia de `Html5Qrcode` cuando el componente se desmonta o cuando
`camaraAbierta` pasa a `false`. Esto cubre tanto el cierre manual como la
navegación a otra ruta.

### Riesgo 4: QR con URL de la app en otro protocolo (http vs https)

**Mitigación:** `NEXT_PUBLIC_APP_URL` define el `origin` canónico. Si el QR
codifica `http://...` pero la app corre en `https://...`, la validación de
origen rechazará el QR. Esto es deliberado: el QR debe codificar la URL
exacta de la app. Si se requiere flexibilidad, se puede relajar la validación
para comparar solo `hostname` + `port`, pero por ahora el contrato es estricto.

## Fuera de alcance

- Escaneo desde archivo/imagen (solo cámara en vivo).
- Historial de QR escaneados.
- Generación de QR (ya existe en `EtiquetaGuia.tsx`, feature 32).
- Lector de código de barras (solo QR).
- Subir archivo con QR para escanear.
