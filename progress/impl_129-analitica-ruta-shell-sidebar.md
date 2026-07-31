# Bitácora de implementación — Feature 129 (Analítica: ruta, shell y sidebar)

> Rama: `feature/129-analitica-ruta-shell-sidebar` (cortada de `origin/dev` en `72b75954`).
> Spec APROBADO por el humano; puerta **T0 CERRADA** (D1–D8 en `requirements.md`).
> Zona: frontend. Complejidad: low. `depends_on: null`.
> Esta bitácora la escribe el IMPLEMENTER. **No es una auto-aprobación**: el
> veredicto lo da el reviewer.

## 1. Alcance ejecutado

Cuatro archivos de producción y cuatro de test. **Cero backend, cero migración,
cero dependencia nueva, cero gráfica, cero dato de métrica**, tal y como exige el
`design.md`.

### Archivos de producción

| Archivo | Acción | Requisitos |
| --- | --- | --- |
| `lib/auth/menu-visibility.ts` | editado: clave `chartColumn` en `IconKey`, `ROLES_ANALITICA` exportada, ítem "Analítica" como 2º elemento de `SIDEBAR_ITEMS` | R7–R11, R15–R17 |
| `app/(app)/_components/Sidebar.tsx` | editado: import `ChartColumn` + entrada `chartColumn: ChartColumn` en `ICON_BY_KEY` | R12, R13 |
| `app/(app)/analitica/page.tsx` | **nuevo** — Server Component `async` con gate `notFound()` | R1–R6, R10, R24 |
| `app/(app)/analitica/_components/AnaliticaShell.tsx` | **nuevo** — presentación pura, dos slots, dos regiones | R18–R23 |

### Archivos de test

| Archivo | Acción |
| --- | --- |
| `tests/unit/auth/menu-visibility.test.ts` | extendido (bloque "Feature 129" + actualización de las dos listas de labels por igualdad) |
| `tests/components/Sidebar.test.tsx` | extendido (bloque "Feature 129") |
| `tests/components/AnaliticaPage.test.tsx` | **nuevo** |
| `tests/components/AnaliticaShell.test.tsx` | **nuevo** |

### Archivos NO tocados, a propósito

- `app/(app)/layout.tsx`: ya filtra con `itemsVisibles(SIDEBAR_ITEMS, actor)`; el
  ítem nuevo aparece sin cambiarlo.
- `feature_list.json`, `progress/current.md`: los lleva el leader.
- **Todo lo que cuelga de `app/(app)/ranking/` y sus tests**: hay otra sesión
  trabajando ahí en vivo en este mismo checkout. Sus cambios sin commitear
  (`RankingModule.tsx`, `ranking-labels.ts`, `page.tsx`, `RankingPodio.tsx`,
  y los tres tests de ranking) **no son de esta feature**.
- `package.json` / `pnpm-lock.yaml`: diff vacío (ver R25 abajo).

## 2. Decisiones de la puerta T0 aplicadas (D1–D8)

- **D1** — El ítem y la página son SOLO para `maestro` y `admin`; la ampliación a
  los otros tres roles es alcance de la **133**.
- **D2** — El gate de la PÁGINA y la visibilidad del ÍTEM declaran el mismo par de
  roles, vía la constante única `ROLES_ANALITICA`, y cada capa lleva su test.
- **D3** — Etiqueta visible "Analítica" (con tilde).
- **D4** — Clave de icono nueva `chartColumn` → export `ChartColumn` de
  `lucide-react`. Verificado en el paquete instalado:
  `node_modules/lucide-react/dist/lucide-react.d.ts:4138` lo declara y `:24763` lo
  exporta con ese nombre exacto.
- **D5** — Pila vertical de regiones con slots nombrados, no pestañas.
- **D6** — Región "financiero" NO declarada; sólo el punto de extensión en el JSDoc.
- **D7** — El ítem va como SEGUNDO elemento de `SIDEBAR_ITEMS`, tras "Inicio" y
  antes de "Órdenes".
- **D8** — Desfase de numeración en `feature_list.json`, no cambio de alcance. No
  se tocó el registro.

## 3. Mapa `R<n> → test` REAL (no el previsto)

Los 25 requisitos quedan cubiertos. `M` = `tests/unit/auth/menu-visibility.test.ts`,
`S` = `tests/components/Sidebar.test.tsx`, `P` = `tests/components/AnaliticaPage.test.tsx`,
`SH` = `tests/components/AnaliticaShell.test.tsx`.

| R | Archivo | Test concreto (nombre real) |
| --- | --- | --- |
| R1 | P | `Feature 129 (R1, R2) — maestro y admin ven el shell > el rol %s ve el encabezado y las dos regiones del tablero` |
| R2 | P | idem R1 (`it.each` sobre `maestro`/`admin`) |
| R3 | P | `Feature 129 (R3) — el resto de roles recibe notFound > el rol %s recibe notFound y no se pinta nada` (`mensajero`, `adminTienda`, `adminSatelite`, `apiKey`) |
| R4 | P | `Feature 129 (R4) — sin sesión > actor nulo recibe notFound y no se pinta nada` |
| R5 | P | `Feature 129 (R5) — el rol sale SOLO del mock de sesión > AnaliticaPage no declara parámetros`, `pasarle un objeto con un rol autorizado como si fuera prop/searchParam no cambia nada...`, `lo mismo sin sesión...` |
| R6 | P | `Feature 129 (R6) — el gate corre ANTES de renderizar > con rol no autorizado, la promesa rechaza y ninguna región llega a pintarse` |
| R7 | M | `R7: existe exactamente UN ítem con href '/analitica' y su label es 'Analítica'` |
| R8 | M | `R8: puedeVer e itemsVisibles incluyen el ítem para maestro y admin` |
| R9 | M | `R9: puedeVer e itemsVisibles lo excluyen para el resto de roles y sin actor` |
| **R10** | M | **`R10: el 'roles' del ítem de analítica es el mismo CONJUNTO que ROLES_ANALITICA (usada por el guard de la página)`** (T4.5) |
| R11 | M | `R11: su iconKey es 'chartColumn' y ningún otro ítem de SIDEBAR_ITEMS usa esa clave` |
| R12 | S | `R12: toda clave de IconKey resuelve a un componente de icono` **+ garantía de compilador** (`ICON_BY_KEY: Record<IconKey, SidebarIcon>`), verificada en vivo — ver §4.1 |
| R13 | S | `R13: el ítem de analítica renderiza un enlace a /analitica con su etiqueta y su icono` |
| R14 | S | `R14: con la ruta activa /analitica el enlace queda marcado como página actual` |
| R15 | M | `R15: el ítem de analítica no declara subítems (children)` |
| R16 | M | `R16: el ítem de analítica va justo después de 'Inicio' y antes del primer 'Órdenes'` (índices calculados, no hardcodeados) |
| R17 | M | `maestro ve Inicio, Analítica, ... en orden real` y `admin ve Inicio, Analítica, ...` (comparación por IGUALDAD de la lista completa), más los casos de `adminTienda`, `mensajero`, `adminSatelite` y "sin actor", que quedan **sin cambio alguno** |
| R18 | SH | `Feature 129 (R18, R19) — el shell es un componente propio con props tipadas` (con y sin props) |
| R19 | SH | idem R18 (`heading` con nombre "Analítica", vía `AppPage`) |
| R20 | SH | `expone EXACTAMENTE dos regiones, con nombres accesibles 'Filtros' y 'Tablero operativo' en ese orden` + `no existe ninguna región financiera (la añade la 132)` |
| R21 | SH | `filtros se renderiza dentro de la región 'Filtros' y operativo dentro de 'Tablero operativo', no cruzados` (`within` en ambos sentidos) |
| R22 | SH | `cada región muestra su estado vacío cuando no recibe contenido` + `el texto de las regiones del shell no contiene NINGÚN dígito` |
| R23 | SH | `Feature 129 (R23) — el shell no fetchea > no llama a fetch al renderizar sin datos` (espía sobre `globalThis.fetch`) |
| R24 | P | `renderiza con SOLO resolve-actor mockeado...` + `el código fuente de la página no importa lib/actions, lib/services ni lib/repositories` (lectura del archivo con `readFileSync`) |
| R25 | — | T4.6: `git diff --stat package.json pnpm-lock.yaml` → **vacío**. Ver §4.4 |

### Desviación consciente en la aserción de R22

La comprobación "cero dígitos" se afirma sobre **las dos `region` del shell**, no
sobre `document.body`: el `PageHeader` compartido pinta de fábrica la fecha del día
("30/07/2026"), que es *chrome* de la aplicación y no contenido del tablero. Dentro
de las regiones, en cambio, cualquier cifra suelta se leería como dato real de
negocio, que es justo lo que R22 prohíbe. La mutación (i) de §5 demuestra que la
aserción sigue atrapando un "0" de placeholder.

## 4. Verificación ejecutada (medida, no supuesta)

### 4.1 R12: la rotura intermedia de typecheck es real

Entre T1.1 y T1.3 el typecheck queda ROJO **a propósito**. No se dio por supuesto:
se ejecutó con el `IconKey` ya ampliado y el `ICON_BY_KEY` todavía sin la entrada.

```
> tsc --noEmit
app/(app)/_components/Sidebar.tsx(138,7): error TS2741: Property 'chartColumn' is
missing in type '{ home: ForwardRefExoticComponent<...>; ... 8 more ...;
shieldAlert: ForwardRefExoticComponent<...>; }' but required in type
'Record<IconKey, SidebarIcon>'.
 ELIFECYCLE  Command failed with exit code 2.
```

Esa falla ES la garantía de compilador de R12. T1.3 la cierra.

### 4.2 Typecheck y lint (estado final)

```
> pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)
```

```
> pnpm run lint
✖ 21 problems (0 errors, 21 warnings)
```

Los 21 warnings son **preexistentes** y viven en archivos ajenos a esta feature
(variables `_args`, `_origenes`, `_historial`... en tests de repositorios y
servicios). **Ninguno** cae en los ocho archivos de la 129.

### 4.3 Tests

Los cuatro archivos de la feature, aislados:

```
Test Files  4 passed (4)
     Tests  57 passed (57)
```

Suite completa (`pnpm test`, y de nuevo dentro de `./init.sh`; dos corridas
independientes, resultado idéntico):

```
Test Files  5 failed | 644 passed (649)
     Tests  20 failed | 7647 passed (7667)
   Duration  234.45s
```

### 4.4 R25 — sin dependencias nuevas

```
$ git diff --stat package.json pnpm-lock.yaml
(vacío)
```

### 4.5 `./init.sh`

`./init.sh` recorre: herramientas → dependencias → regla max-2-por-zona → specs
presentes → **typecheck / lint / test** → migraciones → `.env`. Resultado:

```
✓ node v22.13.1
✓ dependencias presentes
✓ typecheck paso
✓ lint paso
✗ 'pnpm run test' fallo      <- por los 20 rojos HEREDADOS descritos abajo
```

**`init.sh` NO termina en verde**, y hay que decirlo tal cual: corta en el gate de
tests. Pero corta por 20 fallos que **ya venían en la base**, no por esta feature.
La demostración está en §4.6.

### 4.6 Los 20 rojos son HEREDADOS de `origin/dev`: prueba

El leader entregó un baseline de **635 archivos / 7385 tests / 2 rojos** (los 2,
saturación de workers de vitest). **Ese baseline estaba caduco**: la base real hoy
es de 649 archivos / 7667 tests, y los rojos no son los mismos ni son de workers.
Cadena de evidencia:

1. **Los 20 fallos reproducen en aislado**, fuera de la suite completa: no son
   `Failed to start forks worker` ni timeouts de saturación, son aserciones de
   contenido (`Unable to find an accessible element with the role "region" and name
   "Detalle de la orden"`, `Found multiple elements with the text... Parada N de M`,
   `Unable to find an accessible element with the role "combobox" and name
   "Filtrar por cantón"`...). Son el rastro del rediseño de UI del mensajero.
2. **Reparto por archivo** (5 archivos, ninguno de esta feature ni de ranking):
   `MisAsignacionesModule.test.tsx` (16), `MisAsignacionesPage.test.tsx` (1),
   `MarcarLuegoToggle.test.tsx` (1), `ManifiestoFlujos.test.tsx` (1),
   `EscanerRecepcion.test.tsx` (1).
3. **Ninguno de esos cinco archivos referencia nada de esta feature**:
   `grep -cE "menu-visibility|Sidebar|analitica|ROLES_ANALITICA"` devuelve `0` en
   los cinco. Tampoco dependen de `ranking` (el WIP de la otra sesión).
4. **El único commit de esta rama sobre `origin/dev` es documentación**:
   `cd4a7bf0 docs(129): spec de analitica...`. No hay ni una línea de código
   commiteada por encima de `origin/dev`.
5. **Y el código implicado es byte-idéntico a `origin/dev`**:
   `git diff origin/dev --stat -- app/(app)/mis-asignaciones components/ <los 5 tests>`
   devuelve **vacío**.

De (4)+(5) se sigue que esos 20 fallos existen en `origin/dev` tal cual. **El delta
de rojos atribuible a la feature 129 es 0**, que es lo que exigía T5.1. Los 2 rojos
de saturación del baseline anterior no aparecieron en ninguna de las dos corridas.

> Nota para el leader: conviene re-medir el baseline de `dev` y registrar estos 20
> rojos heredados donde corresponda. No se tocan desde aquí: arreglar el rediseño
> del módulo del mensajero no es alcance de la 129, y hacerlo mezclaría dos
> features en la misma rama.

## 5. Mutaciones aplicadas (9 aplicadas, 9 discriminaron)

Cada mutación se aplicó al código de producción **ya escrito**, se corrieron los
tests relevantes y después se revirtió. Ninguna sobrevivió.

| # | Mutación | Archivo | Resultado | Qué se puso rojo |
| --- | --- | --- | --- | --- |
| a | Ampliar `ROLES_ANALITICA` con `"mensajero"` | `menu-visibility.ts` | **MUERTA** — 4 rojos | R9, las listas de labels de R17 y el `notFound` de R3 para `mensajero` |
| b | Quitar el `notFound()` del guard (dejando el `if` vacío) | `analitica/page.tsx` | **MUERTA** — 8 rojos | R3 (x4 roles), R4, R5 (x2), R6 |
| c | Mover el ítem de la 2ª posición a después de "Órdenes" | `menu-visibility.ts` | **MUERTA** — 3 rojos | R16 y las dos listas ordenadas de R17 |
| d | Cambiar el `aria-label` de una región ("Filtros" -> "Filtrado") | `AnaliticaShell.tsx` | **MUERTA** — 5 rojos | R20, R21, R22 y los casos R1/R2 de la página |
| e | Declarar la región financiera (`aria-label="Tablero financiero"` + placeholder) | `AnaliticaShell.tsx` | **MUERTA** — 2 rojos | "exactamente dos regiones" y "no existe ninguna región financiera" (R20) |
| f | Desalinear el ítem respecto del guard: `roles: ["maestro","admin","adminSatelite"]` literal, `ROLES_ANALITICA` intacta | `menu-visibility.ts` | **MUERTA** — 3 rojos, **incluido T4.5 por nombre** | `R10: el 'roles' del ítem ... es el mismo CONJUNTO que ROLES_ANALITICA`, R9 y la lista de `adminSatelite` |
| g | La divergencia INVERSA (el error que la 133 puede cometer): ampliar sólo `ROLES_ANALITICA` con `adminSatelite` y dejar el ítem con su literal | `menu-visibility.ts` | **MUERTA** — 2 rojos, **incluido T4.5** | `R10 ...` y el `notFound` de R3 para `adminSatelite` |
| h | Cruzar los slots: la región operativa renderiza `filtros` | `AnaliticaShell.tsx` | **MUERTA** — 1 rojo | R21 (`...no cruzados`) |
| i | Meter una métrica falsa en el placeholder: `title="Órdenes entregadas hoy: 0"` | `AnaliticaShell.tsx` | **MUERTA** — 2 rojos | los dos casos de R22, incluida la aserción "ningún dígito" |
| j | Quitar la entrada `chartColumn` de `ICON_BY_KEY` | `Sidebar.tsx` | **MUERTA** — en DOS capas | `error TS2741` en typecheck **y** 14 tests de `Sidebar.test.tsx` |

Las mutaciones (f) y (g) son las importantes: **T4.5 mata la divergencia en las dos
direcciones**, que es exactamente el riesgo R-2 del `design.md` y la trampa que la
feature 133 tiene delante.

**Reversión verificada, no prometida.** Los cuatro archivos de producción se
copiaron antes de empezar y al terminar se compararon con `diff` contra esa copia:

```
IDENTICO al pre-mutacion: lib/auth/menu-visibility.ts
IDENTICO al pre-mutacion: app/(app)/_components/Sidebar.tsx
IDENTICO al pre-mutacion: app/(app)/analitica/page.tsx
IDENTICO al pre-mutacion: app/(app)/analitica/_components/AnaliticaShell.tsx
```

Y el typecheck, el lint y los 57 tests de la feature se re-corrieron **después** de
revertir todo (§4.2, §4.3).

## 6. Notas de T5.4 — para que el reviewer no las lea como omisiones

### (a) E2E: declarado INAPLICABLE, no omitido

No se escribió ningún test E2E. Razones, en este orden:

1. **Decisión vigente del humano (2026-07-30): "no más e2e, pruebas básicas nada
   más".** Ya estaba declarada en `design.md` A7 antes de implementar.
2. La casilla de `CHECKPOINTS.md` que pide E2E aplica a **flujos críticos** (auth,
   pagos, recaudo, ingesta de órdenes, webhooks). Un shell vacío sin datos no es
   ninguno de ellos, aunque su gate de rol roce auth.

**Cobertura sustitutiva del riesgo.** El único riesgo real de la feature es que un
rol no autorizado vea la página, y queda cubierto por dos capas con test propio:
`AnaliticaPage.test.tsx` ejercita el `notFound()` con render real del Server
Component —el mismo mecanismo que `tests/components/IncidentesPage.test.tsx`— para
los cuatro roles no autorizados y para la sesión ausente; y
`menu-visibility.test.ts` cubre la capa cosmética del menú. La mutación (b) de §5
confirma que si alguien borra el `notFound()`, 8 tests se ponen rojos.

### (b) Desviación deliberada respecto de la ficha, en cuanto a roles

La descripción de la 129 en `feature_list.json` dice *"item de sidebar visible por
rol (maestro/admin/adminSatelite/adminTienda/mensajero)"*. **Esta implementación
publica el ítem SOLO para `maestro` y `admin`**, siguiendo D1 (`design.md` §7).

Razón: la 129 no trae ninguna métrica. Hasta que la 131 cablee datos la página está
vacía; dar la entrada a `mensajero`, `adminTienda` y `adminSatelite` sería publicar
un control que no lleva a ninguna parte, justo para los tres roles cuyos recortes de
presentación son alcance de la 133.

**Quién lo cierra: la feature 133** ("analítica: recortes por rol"), que debe tocar
los **dos** sitios de la "Nota de traspaso" de `requirements.md`:

1. `lib/auth/menu-visibility.ts` -> el `roles` del ítem con `href: "/analitica"`.
2. La constante `ROLES_ANALITICA` del mismo archivo, que usa el guard de
   `app/(app)/analitica/page.tsx`.

Hoy ambos son **la misma constante**, así que la 133 sólo tiene que cambiar
`ROLES_ANALITICA`. Si en su lugar alguien "desengancha" el ítem y escribe los roles
a mano en uno solo de los dos sitios, el test R10 se pone rojo — demostrado con las
mutaciones (f) y (g). La letra de la ficha queda cumplida al final de la cadena
129 -> 131/132 -> 133, no en la 129.

No se modificó `feature_list.json` desde esta feature.

## 7. Estado de las tasks

T0 ya venía cerrada. **T1.1–T1.4, T2.1–T2.2, T3.1–T3.4 y T4.1–T4.6: hechas y
marcadas `[x]`** en `tasks.md`. T5.1, T5.3 y T5.4: hechas (este documento).

**T5.2 queda SIN marcar**: `./init.sh` corta en el gate de tests por los 20 rojos
heredados de `origin/dev` documentados en §4.6. No se marca `[x]` algo que no está
verde, aunque la causa sea ajena a la feature: el delta propio es 0, pero el gate
del arnés lo deciden el leader y el reviewer, no el implementer.

## 8. Cosas que el implementer NO hizo (por instrucción)

- No se hizo `git commit` ni `git push`: el árbol de trabajo queda con los cambios
  para que los commitee el leader.
- No se tocó `feature_list.json` ni `progress/current.md`.
- No se ejecutó ningún `git` que mueva HEAD (ni `checkout`, ni `switch`, ni `stash`,
  ni `reset`). La reversión de las mutaciones se hizo con copias de respaldo y
  `diff`, precisamente para no necesitar `git checkout`.
- No se tocó nada bajo `app/(app)/ranking/` ni sus tests.

---

# Ronda 2 — cierre de los hallazgos del reviewer (2026-07-30)

El reviewer aprobó la 129 **sin bloqueantes** (`progress/review_129.md`): 24/25 R con
test no vacuo, 20 mutaciones propias, 17 letales. Quedaban **3 mutaciones
supervivientes** (M-1, M-2, M-3) y **un defecto real de documentación** (M-5). Se
cierran las cuatro. Todo lo de abajo está medido, no supuesto.

## M-5 — el defecto real: la nota de traspaso inducía el bug que R10 vigila

**Qué estaba mal.** La "Nota de traspaso a la feature 133" mandaba ampliar **DOS**
sitios: el `roles` del ítem y la constante `ROLES_ANALITICA`. Hoy **son el mismo
sitio** (el ítem escribe `roles: ROLES_ANALITICA`). Un implementer que siguiera la
nota al pie desengancharía el ítem escribiendo un literal — exactamente el
anti-patrón que R10 existe para vigilar. La nota inducía el bug que la feature
previene. Que la bitácora lo aclarase no bastaba: **la 133 va a leer el spec, no la
bitácora**.

**Qué dice ahora.** Reescrita en `requirements.md`, con la corrección fechada y
firmada como hallazgo M-5:

1. **Ampliar es editar UNA sola constante**, `ROLES_ANALITICA` en
   `lib/auth/menu-visibility.ts`, con el snippet exacto. Y nada más: esa constante
   alimenta ya las dos capas (visibilidad del ítem y guard `notFound()`).
2. **Qué NO hacer**, explícito: no escribir un literal de roles ni en el `roles` del
   ítem ni en el guard, con las dos formas concretas de romper R10 (sólo menú → 404
   para los roles nuevos; sólo guard → entran por URL sin entrada de menú) y qué test
   mata cada una.
3. **Qué se pondrá rojo AL AMPLIAR, y que es correcto**: R9 (roles excluidos), las
   listas de labels por rol de R17, y R3 en `AnaliticaPage.test.tsx`. Con la regla de
   oro escrita: **se mueve el rol de una lista a la otra, nunca se relaja el guard ni
   se borra el caso**; si para poner verde un test hay que eliminar una aserción de
   exclusión en vez de moverla, el cambio está mal hecho. Y el aviso de que `apiKey`
   y el actor nulo **siguen excluidos siempre**.
4. **Cuándo**: después de que 131/132 cableen contenido.

**Duplicados corregidos, para que no queden dos versiones de la verdad:**

- `design.md` §7: decía "tocando los DOS sitios"; ahora dice "editando UNA sola
  constante" y por qué no hay un segundo sitio.
- `design.md` §9, riesgo **R-2**: reescrita la mitigación para nombrar las dos
  variantes de desenganche y qué test mata cada una.
- `tasks.md` T4.5: el criterio de HECHO decía "falla si se edita uno solo de los dos
  sitios"; ahora distingue **dos capas** (que es lo cierto) de **dos sitios que
  editar** (que es falso), con puntero a la nota.

## M-3 (R11/D4) — el icono propio ahora se asserta

**Hueco.** Se afirmaba que la CLAVE `chartColumn` era única, no que el COMPONENTE de
icono lo fuera: mapear `chartColumn: Home` pasaba los 57 tests. Justo lo que la
alternativa **A2** del `design.md` quería impedir.

**Cierre.** Nuevo caso en `tests/components/Sidebar.test.tsx`:
`R11/D4/A2: el icono de Analítica es propio — no coincide con el de Inicio ni con el
de ningún otro item`. Compara la clase del `svg` del enlace `/analitica`
(`lucide-chart-column`) contra la de `/dashboard` y contra la de todos los demás
ítems del menú, exigiendo desigualdad.

**Verificado por mutación (por el implementer, no delegado):** `chartColumn: Home` en
`ICON_BY_KEY` produce:

```
FAIL tests/components/Sidebar.test.tsx > ... > R11/D4/A2: el icono de Analitica es propio ...
AssertionError: expected "lucide lucide-house" to match /lucide-chart-column/
Tests  1 failed | 16 passed (17)
```

## M-1 (R19) — el envoltorio AppPage ahora se asserta

**Hueco.** R19 exige el encabezado "usando el envoltorio único de página del repo
(`AppPage`)", pero sustituirlo por un `div`+`h1` a pelo pasaba los 57 tests,
perdiendo `PageHeader` y `Container` sin que nada lo notara.

**Cierre.** Nuevo caso en `tests/components/AnaliticaShell.test.tsx`:
`R19: el encabezado llega por el envoltorio único de página (AppPage -> PageHeader),
no por un header improvisado`. Se apoya en **dos rasgos que sólo aporta el
envoltorio**, no en clases de Tailwind arbitrarias:

- el landmark `banner` (el `<header>` de `PageHeader`, que un `<div>` no produce), y
- el `LogoutButton` que `PageHeader` monta siempre en su topbar, ajeno al contenido
  del shell.

Es una aserción semántica (roles ARIA), no acoplada a detalles internos: **no se tapó
el hueco con una aserción vacua**, que era el riesgo que el leader marcó
explícitamente.

**Verificado por mutación (por el implementer):** `AppPage` sustituido por
`div` + `h1` conservando las dos `section`:

```
FAIL tests/components/AnaliticaShell.test.tsx > ... > R19: el encabezado llega por el envoltorio unico ...
TestingLibraryElementError: Unable to find an accessible element with the role "banner"
Tests  1 failed | 8 passed (9)
```

## M-2 (R1) — la garantía es el BUILD, no la suite

**Hueco.** Poner `"use client"` en `app/(app)/analitica/page.tsx` pasaba los 57 tests.
En producción revienta, pero **`init.sh` no corre `next build`**, así que el arnés no
lo atrapaba.

**Decisión: no se inventó un test frágil.** Un test de vitest que intentara distinguir
Server de Client Component tendría que inspeccionar la directiva del archivo como
texto — una aserción de forma, del tipo que este repo ya sabe que envejece mal. **La
garantía correcta de R1 es el build de Next**, que es quien de verdad conoce la
frontera RSC. Se ejecutó de verdad.

**Nota operativa:** se corrió `pnpm exec next build`, **no `pnpm build`**. El script
`build` del `package.json` es
`prisma generate && tsx scripts/migrate-deploy.ts && next build`, y su paso intermedio
aplica migraciones contra una base real. Para verificar la frontera RSC sólo hace
falta el `next build`.

### Build en verde con el código entregado

```
✓ Compiled successfully in 19.9s
✓ Generating static pages using 11 workers (39/39) in 550ms
├ ƒ /analitica
EXIT_CODE=0
```

`/analitica` aparece en el listado de rutas y en el manifiesto emitido
(`.next/app-path-routes-manifest.json` contiene la entrada `/analitica`). La marca
**`ƒ`** es `(Dynamic) server-rendered on demand`: confirma por partida doble que la
ruta es un Server Component dinámico, tal como exige R1 (dinámica de facto porque
`resolveActorFromSession()` llama a `cookies()`).

Repetido tras revertir todas las mutaciones: `Compiled successfully in 14.8s`,
`├ ƒ /analitica`, `EXIT_CODE=0`.

### Y el build en rojo con la mutación

Con `"use client"` en la página, `next build` **falla con exit 1**, y la traza señala
el archivo por su nombre:

```
Import trace:
  Client Component Browser:
    ./node_modules/.pnpm/pg@8.22.0/.../pg/lib/index.js [Client Component Browser]
    ./node_modules/.pnpm/@prisma+adapter-pg@7.8.0/.../index.mjs [Client Component Browser]
    ./lib/db/prisma-client.ts [Client Component Browser]
    ./lib/auth/resolve-actor.ts [Client Component Browser]
    ./app/(app)/analitica/page.tsx [Client Component Browser]
    ./app/(app)/analitica/page.tsx [Server Component]
EXIT_CODE=1
```

Marcar la página como cliente arrastra Prisma y el driver `pg` al bundle del
navegador y el build se cae. **M-2 muere en el build.**

> **Límite del arnés, declarado:** la garantía de R1 —y de la frontera
> servidor/cliente en general— es `next build`, **no** la suite de vitest. `init.sh`
> hoy **no** corre el build, así que esta clase de regresión no la atrapa el gate
> automático. Recomendación para el leader: añadir `next build` a `init.sh` o al
> pipeline de CI si se quiere cobertura permanente. No se toca `init.sh` desde esta
> feature: es infraestructura del arnés, no alcance de la 129.

## Re-verificación de las tres mutaciones

Aplicadas de nuevo **por el implementer**, no dadas por buenas del subagente:

| # | Mutación | Antes (reviewer) | Ahora | Qué salta |
| --- | --- | --- | --- | --- |
| M-1 | `AppPage` → `div`+`h1` a pelo | SOBREVIVÍA | **MUERE** — 1 rojo | `R19: el encabezado llega por el envoltorio único...` (falta `role="banner"`) |
| M-2 | `"use client"` en `page.tsx` | SOBREVIVÍA | **MUERE en `next build`** — exit 1 | `Module not found`, con traza a `page.tsx [Client Component Browser]` |
| M-3 | `chartColumn: Home` en `ICON_BY_KEY` | SOBREVIVÍA | **MUERE** — 1 rojo | `R11/D4/A2: el icono de Analítica es propio...` |

**Reversión verificada con copia de respaldo propia, nunca con `git checkout`.** Los
cuatro archivos de producción se compararon con `diff` contra la copia previa:

```
IDENTICO: lib/auth/menu-visibility.ts
IDENTICO: app/(app)/_components/Sidebar.tsx
IDENTICO: app/(app)/analitica/page.tsx
IDENTICO: app/(app)/analitica/_components/AnaliticaShell.tsx
```

Y además idénticos a la copia de la ronda 1: **el subagente que añadió las dos
aserciones no tocó producción**, comprobado antes de empezar a mutar.

## Estado tras la ronda 2

- `pnpm run typecheck` → **0 errores**.
- `pnpm run lint` → **0 errores**, 21 warnings preexistentes y ajenos.
- Los 4 archivos de test de la feature → **59/59 verdes** (eran 57; +2 por M-1 y M-3).
- `pnpm exec next build` → **exit 0**, con `/analitica` como ruta dinámica.
- Suite completa: sin cambios respecto de la ronda 1 — los 20 rojos heredados de
  `origin/dev` siguen ahí y siguen sin ser de esta feature (§4.6). **T5.2 sigue sin
  marcar** por eso.

### Mapa `R → test`: filas actualizadas

| R | Cobertura tras la ronda 2 |
| --- | --- |
| R1 | `AnaliticaPage.test.tsx` (la ruta renderiza) **+ `next build` exit 0 con `/analitica` como `ƒ` dinámica**, que es la garantía real de la frontera RSC |
| R11 | `R11: su iconKey es 'chartColumn'...` (unicidad de la CLAVE) **+ `R11/D4/A2: el icono de Analítica es propio...`** (unicidad del COMPONENTE) |
| R19 | `Feature 129 (R18, R19) — ...` **+ `R19: el encabezado llega por el envoltorio único de página (AppPage -> PageHeader)...`** |

### Lo que NO se cerró, y por qué

- **M-4** (asimetría de trazabilidad de R10: el test compara ítem↔constante, no
  guard↔constante). El reviewer lo dejó como deuda anotada, no como defecto: la
  divergencia del lado del guard **sí** muere, pero por los tests de página, que
  enumeran los seis roles del enum. La conducta está cubierta; lo asimétrico es a qué
  R se le atribuye el mérito. No se toca: cerrarlo bien pide un test que importe la
  lista efectiva del guard y la compare con la constante, y el guard no la exporta.
  Queda para la 133, que es quien va a tocar esa constante.
- **M-6** (entrada en `progress/history.md`) y **M-7** (R25 sin test, verificado por
  diff): son del leader y de criterio de proceso, no del implementer.
- **T5.2** (`init.sh` en verde): bloqueada por los 20 rojos heredados de `dev`.

### Archivos tocados en la ronda 2

- `specs/129-analitica-ruta-shell-sidebar/requirements.md` (nota de traspaso reescrita)
- `specs/129-analitica-ruta-shell-sidebar/design.md` (§7 y riesgo R-2)
- `specs/129-analitica-ruta-shell-sidebar/tasks.md` (criterio de HECHO de T4.5)
- `tests/components/Sidebar.test.tsx` (+1 caso, M-3)
- `tests/components/AnaliticaShell.test.tsx` (+1 caso, M-1)
- `progress/impl_129-analitica-ruta-shell-sidebar.md` (esta sección)

**Cero cambios en código de producción en la ronda 2**, verificado por `diff`.
Sin `git commit`, sin `git push`, sin `git` que mueva HEAD, y sin tocar
`app/(app)/ranking/` ni sus tests.
