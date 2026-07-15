# impl_65-lestura-de-qr.md

## Archivos creados/modificados

| Archivo | Acción |
| --- | --- |
| `lib/auth/menu-visibility.ts` | Modificado — añadido `"qrCode"` a `IconKey`; añadido ítem "QR" a `SIDEBAR_ITEMS` con `roles: ROLES_SEED` |
| `app/(app)/_components/Sidebar.tsx` | Modificado — importado `QrCode` de lucide-react; añadido `qrCode: QrCode` a `ICON_BY_KEY` |
| `app/(app)/qr/page.tsx` | Creado — página Client Component con escáner QR vía `html5-qrcode` |

## Mapa R → verificación

| R | Verificación |
| --- | --- |
| R1 | `SIDEBAR_ITEMS` incluye ítem "QR" con `roles: ROLES_SEED` en `menu-visibility.ts:83-87` |
| R2 | El ítem "QR" con icono `QrCode` y href `/qr` aparece en el sidebar (resuelto vía `ICON_BY_KEY` en `Sidebar.tsx:138`) |
| R3 | Sin sesión, el sidebar no se monta (middleware redirige a `/login`); `puedeVer()` retorna `false` si `actor===null` |
| R4 | Existe `app/(app)/qr/page.tsx` — página con `PageHeader` y lector QR |
| R5 | Sin sesión, `middleware.ts` redirige a `/login` (previo, no modificado) |
| R6 | Botón "Escanear con cámara" visible al cargar; cámara no se activa sola (`camaraAbierta` inicial `false`) |
| R7 | `procesar()` valida origen con `process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin` y redirige con `router.push()` |
| R8 | QR con URL externa o texto no-URL → `toast.error()` y `setProcesando(false)` para reintentar |
| R9 | Denegar cámara → catch en useEffect → `toast.error()` y `setCamaraAbierta(false)` |
| R10 | Cámara activa: visor renderizado condicionalmente (`#regionId`) y botón "Cerrar cámara" |
| R11 | Mientras procesa: botón deshabilitado + texto "Procesando código QR…" |
| R12 | `setCamaraAbierta(false)` antes de `router.push()` |
| R13 | Layout centrado con `flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8`, `max-w-sm` en visor |
| R14 | Botón es `<button>` nativo, visor con `role="region"` y `aria-label` |
| R15 | `pnpm typecheck`: solo 2 errores pre-existentes (TarifaVigentePorZonaRepository + seed-zonas) |
| R16 | `pnpm build`: compila OK pero falla typecheck por el mismo error pre-existente (no causado por esta feature) |
| R17 | `pnpm test` Sidebar: 13/13 pasan en aislamiento; suite completa: fallos pre-existentes (timeout de suite) |

## Salida de comandos de verificación

### Sidebar test (aislado)
```
✓ tests/components/Sidebar.test.tsx (13 tests) 5403ms
  13 passed
```

### typecheck
```
lib/repositories/TarifaVigentePorZonaRepository.ts(22,16): error TS2353  PRE-EXISTENTE
scripts/seed-zonas.ts(257,71): error TS2353  PRE-EXISTENTE
```

### lint
```
0 errors, 273 warnings (solo .claude/skills/ y pre-existentes)
```

### build
```
✓ Compiled successfully
Failed to type check — mismo error pre-existente
```

### Regresiones
**0 nuevos fallos.** Todos los errores/failures son pre-existentes en `origin/dev`.
