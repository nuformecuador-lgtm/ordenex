# Feature 200 — Tanda 1: rediseño de presentación de la cabecera de `/wallet`

Rama: `feature/200-wallet-ui-presentacion`. Alcance: **solo presentación**. No se tocó ninguna
server action, DTO, `lib/`, test ni ningún otro componente de wallet (tandas 2 y 3).

## Archivos tocados (3, ninguno más)

1. `app/(app)/wallet/_components/CajaResumenCard.tsx` — reescrito (presentación).
2. `app/(app)/wallet/_components/wallet-labels.ts` — se AÑADEN dos rótulos (`movimientos`,
   `movimientosPista`) a `CAJA_RESUMEN_LABEL`. Nada existente se reescribió.
3. `app/(app)/wallet/_components/WalletModule.tsx` — solo el layout de la sección de arriba y
   el `gap-8` → `gap-6` del contenedor.

## Qué cambia visualmente

- De **una tarjeta monolítica** con las dos cifras a una **grilla de tiles hermanos**
  (`grid grid-cols-1 gap-4 md:grid-cols-3`, o `md:grid-cols-2` si no llega el conteo).
  DESIGN.md: «Cards: hermanas, nunca anidadas» — por eso los tiles son `Card` sueltos y la raíz
  del componente es un `div`, no una `Card` que los contuviera.
- Cada tile: rótulo + `Badge` de signo a la izquierda, icono lucide en caja
  `rounded-md bg-muted p-2` arriba a la derecha, monto grande
  (`text-3xl font-semibold tracking-tight tabular-nums`) con su color semántico, pista
  `text-xs text-muted-foreground` y, abajo del todo (`mt-auto`), el sub-desglose en
  `grid grid-cols-2 gap-4 border-t pt-3`.
- Debajo de la grilla: nota de diferencia + (condicional) aviso de periodo, y el bloque de
  terceros como **banda a lo ancho** (`border-warning/30 bg-warning-soft dark:bg-warning/15`,
  icono `TriangleAlert`, monto en `text-warning-strong`, aviso y enlace).
- `WalletModule`: barra de acciones arriba a la derecha (`Egreso administrativo` outline +
  `Registrar movimiento` primario, en ese orden) y la cabecera a ancho completo. La
  `DesgloseEgresosCard` sigue donde estaba (se reubica en la tanda 2).

## Las restricciones duras del test, y cómo se respetan

`tests/components/CajaResumenCard.test.tsx` **no se tocó**. Lo que impone y dónde vive:

- **Cero `<button>`**: los iconos son SVG decorativos con `aria-hidden="true"` dentro de un
  `<span>`; el badge de signo es un `<span>`; el único interactivo del componente es el `Link`
  a `/wallet/tiendas`.
- **Tres `role="region"`** con los nombres exactos de `CAJA_RESUMEN_LABEL` (`enCaja` /
  `enCajaPeriodo`, `ganancia`, `deTerceros`), como `<section aria-label={...}>`.
- **`section.parentElement` contiene el sub-desglose**: dentro de cada tile, la `<section>` de
  la cifra y el `<div>` del desglose son **hermanos** dentro del mismo `CardContent`. El
  desglose se pasa como prop `desglose` a `TileCifra` precisamente para no anidarlo.
- **El monto grande va dentro de su `<section>`**.
- **El bloque de terceros sigue renderizándose en este componente** (aunque visualmente sea una
  banda aparte): moverlo a `WalletModule` rompería el test y separaría la advertencia de las
  cifras que explica.
- **Money-safe**: ni `Number(`, ni `parseFloat(`, ni `parseInt(`, ni `.toFixed(`. Los importes
  se pintan tal cual con `money()`; el conteo entero se pinta tal cual (`{cantidad}`), sin
  `toLocaleString`.
- **Sin estado ni lectura del entorno**: no hay `useState`/`useEffect`/`useSearchParams`, ni la
  palabra que el test prohíbe en el código, ni `window.location`, ni acceso al árbol del
  navegador. El rótulo condicional sale de `resumen.periodoFiltrado`.
- **Jerga**: no se introdujo ninguna palabra nueva en pantalla salvo el rótulo `Movimientos` y
  su pista; el resto de textos son los constantes que ya existían.

## El tercer tile

Prop **opcional** `movimientos?: number`. Ausente ⇒ no se pinta y la grilla queda de dos
columnas (que es como lo renderiza el test). `WalletModule` le pasa `movimientos={total}`: el
`total` del SERVIDOR que ya tiene en estado para la paginación, no el largo de la página
pintada — importa para la guardia `contadores-cabecera.guardia.test.ts`, que persigue
exactamente ese error (`({X.length})`).

## Decisiones tomadas sin instrucción explícita

1. **Los cuatro tokens existían con el nombre dado.** Verificado en `app/globals.css`:
   `--color-warning-soft`, `--color-warning`, `--color-warning-strong`, `--color-success-strong`
   y `--color-danger-strong`. No hizo falta ningún nombre alternativo ni un solo hex.
2. **Los cuatro iconos existían en `lucide-react@1.23.0`**: `Landmark`, `TrendingUp`,
   `ArrowLeftRight`, `TriangleAlert` (más el tipo `LucideIcon`).
3. **El tile de conteo NO es un `role="region"`.** Los otros dos sí lo son porque el test lo
   exige. Se dejó sin `<section aria-label>` a propósito: `WalletModule` ya tiene una región
   «Libro de movimientos», y una segunda llamada «Movimientos» a pocos nodos de distancia es
   ruido de landmarks para quien navega por regiones. El rótulo se lee igual en orden de
   documento.
4. **El texto del aviso de terceros va en `text-muted-foreground`, no en `text-warning-strong`.**
   `warning-strong` está medido a 4.51:1 sobre `warning-soft` (justo en el umbral) y un párrafo
   entero en ese tono grita; `muted-foreground` sobre `warning-soft` queda por encima de 6:1 en
   claro y en oscuro. El rótulo, el monto y el enlace sí van en `warning-strong` (regla de
   DESIGN.md: texto sobre `-soft` usa `-strong`).
5. **Se añadió foco visible al enlace de terceros** (`focus-visible:ring-3 ring-ring/50`, que es
   el estándar de DESIGN.md). No lo tenía; es una mejora de accesibilidad dentro del alcance de
   presentación.
6. **Sin `shadow-*`** en ningún tile: el borde es el `ring-1 ring-foreground/10` que ya trae la
   primitiva `Card`. La única transición es el `hover` del enlace, a 200 ms.
7. **Las clases de la grilla van completas en cada rama del ternario** (no concatenadas), porque
   Tailwind lee el fuente y no evalúa expresiones.

## Incidencia del entorno (no es un cambio de código)

Al arrancar, `node_modules` estaba **corrupto**: los directorios de los paquetes existían pero
vacíos (`vitest`, `react`, `lucide-react`…), y `pnpm install --frozen-lockfile` fallaba con
`ENOENT` sobre `esbuild/package.json`. Se reparó con `pnpm install --force` (30,8 s, lockfile
intacto, sin cambios en `package.json` ni en `pnpm-lock.yaml`). Sin eso no corría ningún test.

## Verificación

```
pnpm exec vitest run tests/components/CajaResumenCard.test.tsx tests/integration/wallet-page.test.tsx
  → Test Files 2 passed (2) · Tests 28 passed (28)

pnpm exec tsc --noEmit
  → sin salida (verde)
```

Suites vecinas que tocan lo mismo, corridas de más para no dejar un rojo detrás:

```
pnpm exec vitest run tests/components/descarga/WalletDescarga.test.tsx \
  tests/unit/guards/caja-173-alcance.guardia.test.ts \
  tests/unit/descarga/contadores-cabecera.guardia.test.ts \
  tests/unit/components/wallet-indemnizacion-libro.test.tsx \
  tests/unit/guards/liquidacion-money-safe.test.ts \
  tests/unit/guards/incidente-exhaustividad.test.ts
  → Test Files 6 passed (6) · Tests 64 passed (64)

pnpm exec eslint <los 3 archivos> → limpio
```

**Falta el gate completo (`./init.sh`) antes de cualquier PR.**
