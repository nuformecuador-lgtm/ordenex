# Feature 264 — bitácora del bloque FRONTEND (F1–F6 + M4, M5, M9, M10, M11)

> Rama `feat/264-cierre-sin-gestionar-frontend`, desde `origin/dev` (`534f64e1`), que ya
> incluye el backend (PR #450, merge `650c9027`).
> **Alcance: solo F1–F6 y sus cinco mutaciones.** Ni `lib/`, ni `db/`, ni `app/api/` aparecen
> en el diff: `git diff --stat origin/dev` lo demuestra.

---

## 1. Qué se ve ahora, y por qué no estaba

El detalle de un cierre se construye **entero** sobre las gestiones, y sus pestañas son los
cinco valores del enum `gestion_resultado`. Una orden que el corte del día barrió a
`sin_gestionar` **no tiene gestión**, así que no podía aparecer ahí *por construcción* — y el
cierre `vencido` se crea precisamente por ellas. La pantalla escondía justo lo que la motivó.

El backend (B1–B9) creó la tabla, el DTO y las dos lecturas. Este bloque las pinta: una
**sección hermana** de las pestañas, después de ellas y antes del pie, en **las dos** pantallas
que renderizan el comprobante.

---

## 2. Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `tests/components/CierreFacturaSinGestionar.test.tsx` | F3 — 20 casos (R13–R21, R28, R31, R32, R34) |
| `tests/unit/guards/cierre-detalle-superficies.guardia.test.ts` | F5 — 4 casos (R30) |

### Modificados

| Archivo | Qué cambia |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | F1: `SeccionSinGestion` + `FilaSinGestion` + sus rótulos + `SIN_GESTION_GRID_COLS` + las dos props. F6: el KPI pasa a rotularse «Gestiones» |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | F2: `DetalleAbierto` gana los dos campos; `abrirDetalle` los guarda; la hoja los recibe |
| `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | F2: `detalleGrupos` pasa a ser `detallePasado` (los tres datos de UNA lectura); la hoja recibe las mismas dos props |
| `tests/unit/guards/factura-contraste.guardia.test.ts` | F4: los pares de la sección, anclados; el censo no cromático actualizado; un describe nuevo que cierra por SECCIÓN |
| `tests/unit/guards/impresion-flujo.guardia.test.ts` | Las dos piezas nuevas con `break-inside-avoid`, y la sección en la lista de lo que NO puede llevarlo |

**Ni un archivo de `lib/`, `db/` o `app/api/`.** Lo que faltaba del backend, si faltaba algo,
está en §7.

---

## 3. Las tres decisiones del spec que hubo que confrontar con la realidad

### 3.1 `design.md §6` sitúa el DTO donde rompería el bundle — se importa de donde vive

El backend ya lo dejó escrito (`impl_264_backend.md §3`) y aquí sólo se respeta:
`CierreOrdenSinGestion` se importa de `ICierreDiaService.ts`, que es donde se **declara**;
`ICierresAdminService.ts` lo re-exporta. La hoja ya importaba de ese archivo (`CierreGrupos`,
`CierreResultado`…), así que **no se añadió ninguna arista nueva al grafo** y
`pagos-captura.guardia.test.ts` sigue verde (31/31 dentro del gate completo).

### 3.2 F4 pedía «dar de alta los pares de la sección nueva». No hay ninguno nuevo.

Confrontado con el inventario: las **cuatro** utilidades de color de la sección
—`text-foreground` (P1), `text-muted-foreground` (P5), `text-warning-strong` sobre
`bg-warning/15` (P10) y `border-border` (P18)— **ya estaban medidas**, y sobre las mismas
superficies. Clonar un par con la misma tinta y el mismo fondo no es una medición nueva: es el
mismo número escrito dos veces. Lo que se hizo en su lugar:

1. **Anclar** las ocurrencias nuevas en P1, P5, P10 y P18 (su campo `anclas` nombra ahora la
   sección). El propio inventario dice que «al mover una pieza de sitio hay que releer el
   inventario»; esto es esa relectura, por escrito.
2. **Cerrar por SECCIÓN**, que es la mitad que el CIERRE global declara no cubrir. El cierre
   global cierra **por utilidad**: un `text-brand` dentro de la sección le parecería bien
   —está declarado, como exento, para un wordmark—. El describe nuevo extrae del fuente el
   bloque de la sección, exige que su conjunto de utilidades de color sea exactamente el
   declarado, y que toda la que pinte **tinta** caiga en un par **medible** que cumpla 4,5:1
   en los dos temas.

**Autocomprobado que sabe ponerse rojo** (mutación fuera del bloque M): cambiar el
`text-muted-foreground` de la columna Tienda por `text-brand` →

```
 FAIL  … > feature 264 — la sección de órdenes sin gestionar no pinta con nada sin medir (F4)
       > sus utilidades de color son EXACTAMENTE las declaradas: ni una nueva, ni una menos
AssertionError: la paleta de la sección de órdenes sin gestionar cambió. …
  [
    "bg-warning/15",
    "border-border",
+   "text-brand",
    "text-foreground",
    "text-muted-foreground",
    "text-warning-strong",
  ]
```

Y el dato que justifica el caso: **el CIERRE global NO se puso rojo con esa misma mutación**
(`1 failed | 49 passed`). Revertida → `50 passed`.

### 3.3 La sección necesita SU plantilla de rejilla, y no es duplicar la de la 263

`FILA_GRID_COLS` (263) tiene **cinco** tracks: guía, destinatario, **Cobrado**, **Ingreso
total** y la celda del chevron. Esta sección tiene **tres** columnas (R18) y ninguna es de
dinero: reusar la plantilla de cinco pintaría dos columnas de dinero vacías, que es
exactamente lo que R18 prohíbe («una columna con `—` en el 100 % de las filas sugiere *este
dato falta* cuando lo cierto es *este dato no existe*»), y una celda de chevron que no
despliega nada (R31).

Se declara `SIN_GESTION_GRID_COLS` con los **dos primeros tracks idénticos, carácter a
carácter**, a los de `FILA_GRID_COLS`, y se reusa `FILA_GUIA_CELDA` sin tocarla: la guía
hereda su piso y su prohibición de recortarse. Medido en el navegador (§6): las columnas Guía y
Destinatario de las dos secciones quedan alineadas a la vista.

---

## 4. Los dos guardias que se pusieron rojos, y por qué eso está bien

Ninguno se relajó: los dos son **fotos cerradas** cuyo rojo es el momento de revisión que su
propio requisito pide.

| Guardia | Por qué se puso roja | Qué se hizo |
| --- | --- | --- |
| `impresion-flujo.guardia.test.ts` (223/R19) | La lista de piezas con `break-inside-avoid` era de **cinco** y ahora hay **siete** | Se dan de alta las dos, con su criterio escrito: la **fila** (gemela de la pieza 1: se repite N veces y decide los cortes) y el **encabezado** (gemelo de la pieza 4: partido, la primera página deja una lista de órdenes sin decir qué son). La **sección entera** se añade además a la lista de R20 —lo que NO puede llevarlo— porque con 60 filas (R34) supera el alto de una página |
| `factura-contraste.guardia.test.ts` (217/R5) | El censo congelado de utilidades **no cromáticas** no conocía `pb-2` | Se añade `pb-2` con la nota de que la hoja ganó una sección. Es la única utilidad de layout nueva: todo lo demás reusa lo que ya había |

---

## 5. Mapa `R<n> → test` (solo los del bloque FRONTEND)

| R | Test | Archivo |
| --- | --- | --- |
| R13 | «pinta una sección propia con su nombre accesible, FUERA del grupo de pestañas» | `CierreFacturaSinGestionar.test.tsx` |
| R14 | «el tablist sigue teniendo EXACTAMENTE cinco pestañas» | `CierreFacturaSinGestionar.test.tsx` |
| R15 | «registrado y sin ninguna orden ⇒ la sección NO está en el DOM» | `CierreFacturaSinGestionar.test.tsx` |
| R16 | «la sección dice cuántas órdenes contiene» (conteo visible + filas que lo respaldan) | `CierreFacturaSinGestionar.test.tsx` |
| R17 | «lleva la nota que explica que el corte las cerró sin gestión…» (texto literal) | `CierreFacturaSinGestionar.test.tsx` |
| R18 | «tres columnas —Guía, Destinatario, Tienda— y NINGUNA de dinero» (+ ni un `₡`) | `CierreFacturaSinGestionar.test.tsx` |
| R19 | «el pie sigue diciendo el mismo total recaudado y las MISMAS entregas» + «las píldoras de las cinco pestañas siguen contando SOLO gestiones» | `CierreFacturaSinGestionar.test.tsx` |
| R20 | «los KPI y los renglones de dinero valen exactamente lo mismo» (11 literales) | `CierreFacturaSinGestionar.test.tsx` |
| R21 | «el KPI de conteo dice 1 —no 4— y se rotula «Gestiones»» | `CierreFacturaSinGestionar.test.tsx` |
| R28 | «NO registrado ⇒ aparece el aviso, con su texto literal» + «el aviso NO se acompaña de nada que sugiera «no hubo ninguna»» + «el DOM del cierre NO REGISTRADO y el del cierre SIN ÓRDENES son distintos» + «con la marca en `false` manda el AVISO, aunque llegaran órdenes» | `CierreFacturaSinGestionar.test.tsx` |
| R31 | «ni un botón, ni un enlace, ni un desplegable dentro de la sección» | `CierreFacturaSinGestionar.test.tsx` |
| R32 | «el estado de origen se pinta traducido cuando consta» + «sin estado de origen la pieza se OMITE — la fila no pinta un guion en su lugar» | `CierreFacturaSinGestionar.test.tsx` |
| R34 | «con 60 órdenes sembradas se pintan 60 filas y el conteo dice 60» | `CierreFacturaSinGestionar.test.tsx` |
| R30 (pantalla) | los 4 casos de la guardia de superficies | `cierre-detalle-superficies.guardia.test.ts` |

**R1–R12, R22–R27, R29 y R33** los cubre el bloque BACKEND (`progress/impl_264_backend.md §5`).

### Las dos trampas que este archivo tiene prohibidas, y cómo se evitaron

- **«Con la lista vacía los totales no cambian» NO se escribió.** Es verde por construcción
  (`design.md §8.3`). Los tres casos de dinero se pintan **siempre con las tres órdenes
  sembradas**, y los importes se comparan contra literales tecleados a mano (`₡8.000`,
  `1 entregas`, `-₡400`…), nunca contra `cierre.totales.*` ni contra `money(...)`.
- **Ningún rótulo se compara contra la constante que lo emite.** Todos los textos son literales
  visibles: `"Gestiones"`, `"El corte del día las cerró sin gestión. No tienen dinero
  asociado."`, `"Este cierre es anterior al registro…"`.

---

## 6. Verificación en el NAVEGADOR — lo que la suite no puede ver

Servidor `next dev` propio del worktree en `:3100` (el del árbol principal no tiene esta rama),
Playwright headless, 1440×1100, contra la base local.

**Estado «no registrado» (R28), que es el que la base local SÍ tiene** (sus 6 cierres están en
`aprobado`, luego el backfill los dejó en `sin_gestion_registrado = false`):

```
SECCION SIN GESTIONAR (count): 1
TEXTO SECCION: Órdenes sin gestionarEste cierre es anterior al registro de órdenes sin
               gestionar: no se conserva la lista.
KPI GESTIONES presente: 1
```

Se ve entre las pestañas y el pie, con su título en versalitas y el aviso debajo, **sin**
píldora de conteo y **sin** lista. Comprobado en tema **claro** y en tema **oscuro** (con el
interruptor real del `PageHeader`, no forzando una clase).

**Estado «con lista» (R13/R16/R32), con fixtures REVERSIBLES.** La base local no tiene ninguna
orden `sin_gestionar`, así que se sembraron 3 filas de `cierre_sin_gestion` marcadas
`F264-VISUAL-*` en un cierre local, se miró, y **se borraron**. Comprobación posterior:

```
filas cierre_sin_gestion: 0
marca por cierre: [{"_count":6,"sinGestionRegistrado":false}]
```

— exactamente el estado que describe `impl_264_backend.md §4`. Lo que se vio con datos:

```
Órdenes sin gestionar 3
El corte del día las cerró sin gestión. No tienen dinero asociado.
Guía        Destinatario                                          Tienda
990101      Fernanda Villalobos Quesada                           Tienda de Electrónica del Oeste
            F264-VISUAL-0001 · Reloj inteligente… · En reparto
990102      Bo Li                                                 Tienda Z
            F264-VISUAL-0002 · Bolso · Ayuda de la tienda
—           Carlos Alberto Rodríguez Montenegro de la Trinidad    Comercializadora Internacional…
            F264-VISUAL-0003 · Lámpara de escritorio articulada con brazo de aluminio
```

Se sembró **a propósito** con los casos que rompen layouts: nombre de tienda de 52 caracteres,
destinatario de 49, producto de 52, guía ausente y origen ausente. Ninguno desborda ni tapa a su
vecino; la fila sin origen **no pinta guion** y la fila sin guía **sí** (que es lo correcto: ese
dato existe y está vacío). Las columnas Guía y Destinatario quedan alineadas con las de la
sección de gestiones de arriba.

**R30 en la app, no sólo en la guardia:** con las mismas filas sembradas, la sección aparece
**idéntica** en la pantalla del admin (`/cierres-admin`) y en la del propio mensajero
(`/cierre-dia`), que es donde el KPI se lee ya como `GESTIONES 4`.

---

## 7. Mutaciones — **ejecutadas**, con la salida roja pegada

Protocolo: aplicar → correr **solo** el test indicado → pegar el rojo → `git checkout --` →
confirmar verde. Las seis del bloque BACKEND (M1, M2, M3, M6, M7, M8) **no** se repitieron:
mutan `lib/` y `db/`, que no toco, y ya están en `impl_264_backend.md §6`.

### M4 — sumar las órdenes sin gestionar al pie · **DOS variantes, las dos ROJAS**

El spec da la mutación con un «**o**»; se hicieron las dos, porque protegen cosas distintas.

**M4a — `… + ordenesSinGestion.length` en el conteo del pie:**

```
 ❯ tests/components/CierreFacturaSinGestionar.test.tsx (20 tests | 1 failed)
     × R19: el pie sigue diciendo el mismo total recaudado y las MISMAS entregas

AssertionError: el pie es una lectura de DINERO y de ENTREGAS. Una orden sin gestionar no
recaudó nada y no se entregó: no puede mover ninguno de los dos números:
expected 'Cierre del díaVencidoBodega central ·…' to contain 'Total recaudado ₡8.000 · 1 entregas'
Expected: "Total recaudado ₡8.000 · 1 entregas"
Received: "… Total recaudado ₡8.000 · 4 entregas"
```

Revertida → `20 passed (20)`.

**M4b — concatenarlas a `grupos.entregada`:**

```
 Tests  3 failed | 17 passed (20)

     × R19: el pie sigue diciendo el mismo total recaudado y las MISMAS entregas
     × R21: el KPI de conteo dice 1 —no 4— y se rotula «Gestiones»
     × R19/R20: las píldoras de las cinco pestañas siguen contando SOLO gestiones

AssertionError: expected '4' to be '1' // Object.is equality
AssertionError: expected [ 'Entregadas4', …(4) ] to deeply equal [ 'Entregadas1', …(4) ]
```

Revertida → `20 passed (20)`. **El dinero no se movió con ninguna de las dos** —los importes
son STRING del snapshot— y por eso R19/R20 no se afirman sólo con montos: se afirman con el
**conteo** al lado del monto, que es lo que esta variante mueve.

### M5 — sumar `ordenesSinGestion.length` al KPI → **F3 ROJO** (R21)

```
 ❯ tests/components/CierreFacturaSinGestionar.test.tsx (20 tests | 1 failed)
     × R21: el KPI de conteo dice 1 —no 4— y se rotula «Gestiones»

AssertionError: expected '4' to be '1' // Object.is equality
Expected: "1"
Received: "4"
```

Revertida → `20 passed (20)`.

### M9 — ignorar `sinGestionRegistrado` y tratar `false` como «no hay órdenes» → **F3 ROJO** (R28)

Es la mutación de Q3: si no pone rojo, el silencio ambiguo volvió.

```
 Tests  3 failed | 17 passed (20)

     × R28: NO registrado ⇒ aparece el aviso, con su texto literal
     × R28: el aviso NO se acompaña de nada que sugiera «no hubo ninguna»
     × R28: el DOM del cierre NO REGISTRADO y el del cierre SIN ÓRDENES son distintos

TestingLibraryElementError: Unable to find an accessible element with the role "region"
and name "Órdenes sin gestionar"
```

Revertida → `20 passed (20)`.

### M10 — quitar las dos props del `<CierreFacturaDetalle>` del módulo del mensajero → **F5 ROJA** (R30)

Primero, **el typecheck con la mutación puesta**, que es la razón de existir de la guardia:

```
$ pnpm run typecheck
> tsc --noEmit
TSC_EXIT=0        ← VERDE. El compilador no dice ni una palabra: las props son opcionales.
```

Y la guardia:

```
 Tests  2 failed | 2 passed (4)

     × app/(app)/cierre-dia/_components/CierreDiaModule.tsx pasa las DOS props de la sección…
     × ninguna superficie inventa el valor: las dos props salen del detalle del servidor

AssertionError: app/(app)/cierre-dia/_components/CierreDiaModule.tsx monta el comprobante
detallado SIN pasarle `ordenesSinGestion`. Las dos props son opcionales en el tipo por los
dobles de test, así que el typecheck no caza este olvido: la hoja pintaría la sección en una
pantalla y la callaría en la otra, que es el arreglo a medias que se corrigió en la 263 (R30).
```

Revertida → `4 passed (4)`.

### M11 — `ordenesSinGestion.slice(0, 10)` antes de pintar → **F3 ROJO** (R34)

```
 ❯ tests/components/CierreFacturaSinGestionar.test.tsx (20 tests | 1 failed)
     × con 60 órdenes sembradas se pintan 60 filas y el conteo dice 60

AssertionError: una lista truncada en silencio se lee como una lista completa:
expected [ …(10) ] to have a length of 60 but got 10
```

Revertida → `20 passed (20)`.

### Extra (fuera del bloque M) — el detector de F4 sabe ponerse rojo

Ver §3.2. Se incluye porque una guardia de contraste nueva que nadie mató es indistinguible de
una decorativa, y en este repo eso ya ha pasado.

---

## 8. Salidas reales

```
$ pnpm run typecheck
> tsc --noEmit
TSC_EXIT=0        (sin salida: 0 errores)

$ pnpm run lint
✖ 99 problems (0 errors, 99 warnings)
```

Las 99 son `no-unused-vars` sobre parámetros `_`-prefijados de dobles de test
**preexistentes**; son exactamente las mismas 99 que reportó el bloque BACKEND y ninguna cae en
un archivo de esta feature.

### El gate rápido SE NIEGA SOLO, tal como predijo `tasks.md`

```
$ ./init.sh --rapido
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    app/(app)/cierre-dia/_components/CierreDiaModule.tsx
    app/(app)/cierres-admin/_components/CierresAdminModule.tsx
    app/(app)/cierres-admin/_components/cierre-factura.tsx
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

(El diff de este bloque **no** toca `db/migrations/**` ni `db/schema.prisma`; lo que lo manda al
completo es la tercera razón del `design.md §9`: los tres archivos llevan `cierre` en el nombre.)

### `./init.sh` COMPLETO

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso

 Test Files  1304 passed (1304)
      Tests  17400 passed | 26 skipped (17426)
   Duration  375.15s

✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

El aviso de los tres `down.sql` es **preexistente** (feature 92) y no se tocó. Los 26 `skipped`
son los mismos que reportó el bloque BACKEND: ninguno es de esta feature.

---

## 9. Lo que NO se pudo verificar, dicho por delante

1. **El estado «con lista» con datos NATURALES.** La base local no tiene ninguna orden en
   `sin_gestionar` ni ningún cierre `vencido` (sus 6 cierres están `aprobado`), así que el
   único camino era sembrar y borrar (§6). Lo que se vio es la **pantalla** con datos reales de
   la tabla, no el **corte diario** produciéndolos: ese camino lo cubre B3 con dobles y B7
   contra Postgres.
2. **Que la sección se imprima bien.** No hay motor de impresión en el gate. Lo verificado es
   estructural: las dos piezas nuevas llevan `break-inside-avoid` y la sección **no** lo lleva,
   con el criterio escrito junto a cada una.
3. **Contraste «visto», no calculado.** El inventario mide aritmética sobre tokens; ninguna
   pieza del gate compone una cascada. Las capturas del navegador (claro y oscuro) muestran que
   la sección se lee, pero eso es un ojo humano mirando un PNG, no una medición.
4. **E2E.** `design.md §8.4` los declara opcionales y **sin valor como evidencia** (la suite del
   gate no los ejecuta). No se ampliaron. Se comprobó que **ningún** test ni E2E localizaba el
   rótulo viejo del KPI («Órdenes»), así que F6 no dejó ningún localizador muerto.

### Un efecto colateral en la base LOCAL que hay que saber

Para poder entrar a la app se corrió `scripts/seed-usuarios-qa.ts`, que es **idempotente por
email** pero **rota el hash de contraseña** de las cuatro cuentas QA
(`admin.qa@ordenex.test`, `mensajero.qa@ordenex.test`, `tienda.qa@ordenex.test`,
`satelite.qa@ordenex.test`). Su contraseña local es ahora `Ordenex264Local!`. No se tocó el
maestro, ni ningún cierre, ni ninguna orden. Las credenciales que usan los E2E
(`maestro@example.com` / `correct-password`) **ya no existían** en esta base antes de tocar
nada: el login con ellas devolvía «Correo o contraseña inválidos».

---

## Veredicto

Bloque FRONTEND completo (F1–F6) con el gate COMPLETO en verde (`INIT_EXIT=0`, 17 400 tests) y
las cinco mutaciones que le tocaban muertas con su rojo pegado —M4 en sus dos variantes—; dos
guardias de foto cerrada se pusieron rojas por hacer su trabajo y se actualizaron con su
criterio escrito, y la única decisión del spec que no era implementable tal cual —F4 pedía dar
de alta pares que ya existían— se resolvió cerrando por sección en vez de clonando mediciones.
