# Feature 200 — Tanda 2: desglose de egresos, panel de gastos fijos y la fila de dos columnas

Rama: `feature/200-wallet-ui-presentacion`. Alcance: **solo presentación**. No se tocó ninguna
server action, DTO, `lib/`, test, ni `WalletLedger` / `WalletFiltros` / `DataTable` (tanda 3).

## Archivos tocados (4, ninguno más)

1. `app/(app)/wallet/_components/DesgloseEgresosCard.tsx` — reescrito (presentación).
2. `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx` — cabecera y pie de la card.
3. `app/(app)/wallet/_components/WalletModule.tsx` — solo la fila de dos columnas.
4. `app/(app)/wallet/_components/CajaResumenCard.tsx` — SOLO el mapa `SIGNO_BADGE` (punto D).

## A) `DesgloseEgresosCard` — lista jerarquizada con cierre fuerte

- `CardHeader` con el `CardTitle`/`CardDescription` de siempre (los textos NO se reescriben) y
  un `TrendingDown` decorativo en el slot `CardAction` (`rounded-md bg-muted p-2`, `aria-hidden`).
- Cada fila: icono lucide pequeño + rótulo a la izquierda, importe a la derecha en
  `tabular-nums text-danger-strong`, y superficie propia al pasar el ratón
  (`rounded-md hover:bg-muted/50`, `transition-colors duration-200`).
- El total sale del cuerpo y pasa al **`CardFooter`**: la primitiva ya trae
  `border-t bg-muted/50 rounded-b-xl` y el `Card` le quita el `pb` (`has-data-[slot=card-footer]`),
  así que el cierre no se dibuja a mano.
- **Lo prohibido, ausente**: ni barras, ni porcentajes, ni orden por magnitud, ni `Number(` /
  `parseFloat(` / `parseInt(` / `.toFixed(`. El orden de `FILAS` es el escrito.

### La decisión estructural: dónde vive la `<dl>`

El test exige que `within(getByRole("group", { name: "Desglose de egresos" }))` encuentre **las
cuatro filas Y el total**. Con el total en el pie, la `<dl>` tiene que abarcar cuerpo y pie: si
se partiera en dos listas, el total dejaría de estar en el grupo (y dejaría de ser el `<dt>/<dd>`
que cierra la lista, que es lo que semánticamente es).

Se descartaron dos formas de conseguirlo:

- envolver `CardContent` + `CardFooter` en una `<dl className="contents">`: `display:contents`
  arrastra un historial de elementos que desaparecen del árbol de accesibilidad, y además deja
  los `<dt>/<dd>` a DOS niveles de la `<dl>` (el modelo de contenido de `dl` admite un `div`
  por grupo, no un `div` dentro de otro);
- mover el `role="group"` al `Card`: cambia el nombre accesible del grupo y mete título y
  descripción dentro de él.

Lo implementado: **la `<dl>` ES el cuerpo de la tarjeta** —hija directa del `Card`, sin
`CardContent`— con las filas y el `CardFooter` como hijos directos suyos. Cada `<dt>/<dd>`
cuelga de su fila y cada fila de la lista: un solo nivel, que es justo lo que el modelo de
contenido de `<dl>` permite. Como `CardContent` sólo aportaba `px-(--card-spacing)`, ese padding
se reparte entre la fila (`mx-2` + `px-2` = 1rem, alineado con la cabecera) y el pie (que así
llega a los bordes sin ningún margen negativo).

## B) `GastosFijosPlantillasPanel`

- Fuera el `flex justify-between` armado a mano: título y descripción son los del `CardHeader`,
  y «Nueva plantilla» (con `Plus` decorativo) va en el slot `CardAction`. El nombre accesible del
  botón sigue siendo exactamente `Nueva plantilla` (el icono es `aria-hidden`).
- La `<Pagination>` baja al **`CardFooter`**; la tabla se queda donde estaba, dentro de
  `CardContent`. **La `<DataTable>` no se movió ni se convirtió en tarjetas**: está censada POR
  RUTA en `tests/unit/descarga/censo-tablas.ts`.
- `PAGINACION_PLANTILLAS_LABEL`, `ariaLabel` y `emptyMessage`: intactos.

## C) `WalletModule`

El desglose sale de la sección de la caja (no es una de sus cifras) y comparte fila con los
gastos fijos: `grid grid-cols-1 items-start gap-6 lg:grid-cols-3`, desglose en `lg:col-span-1` y
gastos fijos en `lg:col-span-2` — la inversión deliberada del mockup, porque el desglose son
cuatro filas y los gastos fijos una tabla paginada con descarga. Se conserva el
`aria-label="Gastos fijos"` de su sección; `recargar`, `buildInput`, `buildInputCompleto`,
`manejarError` y las llamadas a actions, sin tocar.

## D) `CajaResumenCard` — el badge de signo

`SIGNO_BADGE` pasa de `default` (naranja de marca: acción primaria/selección según `DESIGN.md`) a
las variantes semánticas de la primitiva: positivo → `success`, negativo → `danger`, cero →
`secondary`. El `Record` se re-tipa a `"success" | "danger" | "secondary"`. Los textos
(«Positivo»/«Negativo»/«En cero») no se tocan. Nada más de ese archivo cambió.

## Decisiones tomadas sin instrucción explícita

1. **`sticky={false}` en la paginación del pie.** `Pagination` es `sticky` por defecto y en ese
   modo devuelve un fragmento de DOS elementos (envoltorio pegajoso + centinela de 1px); dentro
   de un `CardFooter`, que es `display:flex` en fila, se colocarían como dos columnas y el
   centinela `w-full` empujaría la barra. Además el `Card` tiene `overflow-hidden`, o sea que ya
   era el contenedor contra el que se pegaba: flotar sobre el viewport nunca ocurrió aquí. Es el
   mismo patrón —y el mismo motivo— que en `DetalleMensajeroPanel` y `DesglosePagosMensajero`.
   Se le pasa `className="w-full justify-between gap-3 py-0"` para que ocupe el pie y no sume su
   `py-2` al padding de la banda.
2. **`items-start` en la fila de dos columnas.** Sin él las dos columnas se estiran a la altura de
   la más alta (la tabla) y el pie del desglose —una banda apoyada en el borde inferior de la
   tarjeta— quedaría a media altura con el hueco debajo.
3. **Iconos de las filas del desglose**: `CalendarClock` (gastos fijos), `Receipt` (variables),
   `Users` (sueldos), `ShieldAlert` (indemnizaciones), y `TrendingDown` en la cabecera. Verificado
   que los cinco existen en `lucide-react@1.23.0`. Se eligió icono en lugar de punto de color
   (las dos opciones que daba el encargo) porque un punto de color por concepto habría necesitado
   cinco tonos sin significado semántico, y `DESIGN.md` reserva el color para estado.
4. **El `<dt>` del total NO lleva icono ni color de rótulo**: el pie ya es la fila destacada; un
   quinto icono lo habría igualado a las cuatro filas que resume.
5. **El comentario que citaba `<DataTable>` se reescribió.** `cobertura-tablas.guardia` cuenta
   instancias sobre el fuente CRUDO (no quita comentarios): nombrar la etiqueta en un comentario
   hacía que el archivo declarase DOS tablas y la guardia se puso roja. Queda anotado ahí mismo.
6. **`GastoFijoPlantillaDialog` se queda donde estaba** (último hijo del `Card`): `Modal` monta
   `Dialog.Root` + `Dialog.Portal`, que no renderizan ninguna caja en flujo, así que no rompe ni
   el `flex` del `Card` ni el apoyo del pie en el borde inferior. Moverlo habría sido ruido.

## Verificación

```
pnpm exec vitest run tests/unit/components/wallet-desglose-egresos-card.test.tsx \
  tests/unit/components/wallet-gastos-fijos-panel.test.tsx \
  tests/components/CajaResumenCard.test.tsx tests/integration/wallet-page.test.tsx
  → Test Files 4 passed (4) · Tests 40 passed (40)

pnpm exec vitest run tests/unit/descarga
  → Test Files 26 passed (26) · Tests 140 passed (140)   (censo de tablas incluido)

pnpm exec tsc --noEmit
  → sin salida (verde)
```

De más, para no dejar un rojo detrás:

```
pnpm exec vitest run tests/components/paginacion \
  tests/components/descarga/WalletPropsDescarga.test.tsx \
  tests/components/descarga/WalletDescarga.test.tsx \
  tests/unit/config/paginacion-dominios.test.ts \
  tests/unit/components/wallet-indemnizacion-libro.test.tsx \
  tests/unit/guards/caja-173-alcance.guardia.test.ts
  → Test Files 11 passed (11) · Tests 110 passed (110)

pnpm exec vitest run tests/unit/guards → Test Files 25 passed (25) · Tests 274 passed (274)
pnpm exec eslint <los 4 archivos>     → limpio
```

Ningún test se tocó. **Falta el gate completo (`./init.sh`) antes de cualquier PR.**

---

## Corrección posterior — el tile del icono era `display: inline`

Encontrada **mirando la app con Playwright, no por un test**. En la cabecera de
`DesgloseEgresosCard`, el `<span>` del `CardAction` computaba `display: inline` y medía
**16 × 72 px** en vez de 32 × 32: al ser inline, el `p-2` no genera caja, el `bg-muted` se
pintaba como una tira estrecha estirada a la altura de la línea y el icono se salía por arriba
y por abajo. En pantalla, una raya vertical con un garabato pegada al borde de la tarjeta, en
claro y en oscuro.

El mismo patrón sí se veía bien en `CajaResumenCard` porque allí el `IconoTile` es hijo de un
contenedor `flex`, que lo blockifica (`display: block`, 32 × 32). En el `CardAction` es un
**grid item**, y el hijo se queda inline. O sea: los tiles funcionaban **por accidente del
contenedor**, no por diseño propio.

Arreglo — caja explícita en el span, en los dos sitios:

- `app/(app)/wallet/_components/DesgloseEgresosCard.tsx` → el span del `CardAction` suma
  `inline-flex items-center justify-center`.
- `app/(app)/wallet/_components/CajaResumenCard.tsx` → misma corrección **preventiva** en
  `IconoTile`, para que no dependa de que su padre sea flex. Nada más de ese archivo se tocó
  (sigue sin `<button>` y con su barrido money-safe intacto: la guardia de alcance pasa).

Con `inline-flex` el span deja de ser inline, `p-2` (8 px) sí genera caja y el contenido es el
icono de `size-4` (16 px): **8 + 16 + 8 = 32 × 32**, alto y ancho, en cualquier contenedor.

```
pnpm exec vitest run tests/unit/components/wallet-desglose-egresos-card.test.tsx \
  tests/components/CajaResumenCard.test.tsx tests/integration/wallet-page.test.tsx
  → Test Files 3 passed (3) · Tests 34 passed (34)

pnpm exec tsc --noEmit                                    → sin salida (verde)
pnpm exec vitest run tests/unit/guards/caja-173-alcance.guardia.test.ts
  → Test Files 1 passed (1) · Tests 28 passed (28)
```

Ningún test, action ni otro archivo se tocó. Sigue faltando el gate completo antes del PR.
