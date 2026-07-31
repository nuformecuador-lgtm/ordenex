# Revisión — Feature 129 (Analítica: ruta, shell y sidebar)

> Reviewer. Rama `feature/129-analitica-ruta-shell-sidebar` (4 commits sobre
> `origin/dev` @ `72b75954`: `cd4a7bf0`, `61b73126`, `2111ea8b`, `f10b0189`).
> Fecha: 2026-07-30. **Veredicto: APROBADO-CON-NOTAS (0 bloqueantes, 7 menores).**
> Todo lo de abajo está medido en este checkout, no leído de la bitácora.

## 1. Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `requirements.md` con R1-R25 en EARS numerados. T0 CERRADA (D1-D8).
- [x] `design.md` con alternativas descartadas y su porqué (A1-A7, siete, no una).
- [x] `tasks.md` con todas las tasks `[x]` **salvo T5.2** (`./init.sh` en verde), sin
      marcar a propósito y con su justificación escrita. Ver §4.

### Trazabilidad
- [x] Cada `R<n>` mapea a un test concreto **y no vacuo**: 24/25 con test automático
      que discrimina (verificado por mutación, §3). R25 ("sin dependencias nuevas")
      no tiene test: se verifica por diff -- comprobado por mí, `package.json` y
      `pnpm-lock.yaml` no aparecen en `git diff --name-only origin/dev...HEAD`.
      Hallazgo menor M-7.
- [x] `progress/impl_129-...md` contiene el mapa `R<n> -> test` real. Lo recorrí test
      por test contra los archivos: el mapa **no miente** en ninguna fila.

### Calidad de código (medido por mí)
- [x] `pnpm run typecheck` -> 0 errores.
- [x] `pnpm run lint` -> 0 errores, 21 warnings, todos preexistentes y ajenos
      (`_args`, `_origenes`... en tests de repos/servicios). El único warning en un
      archivo de la feature es `Sidebar.tsx:254` (`img`), preexistente y fuera del diff.
- [x] `pnpm test` -> **20 rojos, todos HEREDADOS de `origin/dev`**. Confirmado, no
      aceptado de palabra: los 5 archivos rojos (`MisAsignacionesModule` x16,
      `MisAsignacionesPage`, `MarcarLuegoToggle`, `ManifiestoFlujos`,
      `EscanerRecepcion`) reproducen en aislado (20/125), ninguno referencia
      `analitica`/`menu-visibility`/`Sidebar`/`ROLES_ANALITICA` (grep = 0 en los
      cinco) y ninguno está en el diff de la rama ni en los cambios sin commitear
      (que son solo `ranking/`, de otra sesión). **Delta propio = 0**; los 4 archivos
      de la feature dan 57/57 verdes.
- [x] E2E: **inaplicable**, bien declarado (`design.md` A7). Ver §5.

### Datos y seguridad
- [x] Sin tablas nuevas, sin migraciones, sin RLS que aplicar (no hay objeto de datos).
- [x] Sin secretos: el diff no introduce credenciales ni `process.env`.
- [x] Sin webhooks.

### Patrón de capas
- [x] La página (único "controller") no ejecuta queries ni lógica: su única lectura es
      `resolveActorFromSession()`. Verificado además por test de código fuente.
- [x] No toca `lib/services/`, `lib/repositories/`, `lib/interfaces/`, `lib/actions/`.

### Permisos
- [x] La página valida en el servidor: `resolveActorFromSession()` -> `cookies()`
      (`lib/auth/resolve-actor.ts:1,16`) + `notFound()`.
- [x] El shell no fetchea nada; recibe todo por props.
- [x] Sin Server Actions ni fetch a API routes.
- [x] `middleware.ts` deja `/analitica` privada por defecto (no está en `PUBLIC_ROUTES`
      ni en `SELF_AUTH_ROUTES`): sin cookie no se llega.

### Multi-país
- [x] Nada de país, moneda ni cuenta.

### Verificación final
- [ ] `./init.sh` **NO** termina en verde: pasa node/dependencias/typecheck/lint y
      corta en el gate de tests por los 20 rojos heredados. Ejecutado por mí dos
      veces. No atribuible a la 129 (§4).
- [x] `progress/review_129.md` (este archivo).
- [ ] Entrada en `progress/history.md`: **no existe todavía**. Tarea del leader al
      cerrar. Hallazgo menor M-6.

## 2. Verificación de los 25 requisitos

Recorrí cada R hasta el cuerpo del test citado, comprobando que asserta la conducta y
no la forma. Resumen por requisito (detalle de mutaciones en §3):

| R | Cubierto | Comentario |
| --- | --- | --- |
| R1 | sí (parcial) | El módulo debe existir en la ruta y renderizar; la cláusula "Server Component" no la mide ningún test (menor M-2). |
| R2 | sí | `it.each(maestro, admin)` con heading + las dos regiones; muere al estrechar el guard. |
| R3 | sí | Los cuatro roles enumerados uno a uno; muere al ensanchar el guard. |
| R4 | sí | Actor nulo; muere al quitar el `!actor ||`. |
| R5 | sí | `AnaliticaPage.length === 0` + dos casos que le meten `rol`/`searchParams` a la fuerza; muere al añadir un parámetro que autorice. |
| R6 | sí | La promesa rechaza y ninguna región llega al DOM. |
| R7 | sí | Unicidad por `href` + label exacto; muere con el label sin tilde. |
| R8 | sí | `puedeVer` + `itemsVisibles` para los dos roles. |
| R9 | sí | Cuatro roles + actor nulo; muere al ensanchar `ROLES_ANALITICA`. |
| R10 | **sí, en las dos direcciones** | Ver §2.1: es el punto que más verifiqué. |
| R11 | sí (parcial) | La CLAVE es única; que el COMPONENTE de icono sea propio no se mide (menor M-3). |
| R12 | sí | Garantía de compilador real (`Record<IconKey, SidebarIcon>`) + un `Exclude<>` en el propio test + red de runtime. Añadir una clave sin icono rompe el typecheck en DOS puntos. |
| R13 | sí | Enlace a `/analitica`, nombre accesible y `svg`. |
| R14 | sí | `aria-current="page"`; muere al excluir `/analitica` del cálculo de activo. |
| R15 | sí | Muere al añadir `children`. |
| R16 | sí | Índices calculados, no hardcodeados; muere al mover el ítem. |
| R17 | sí | Listas de labels por rol comparadas por IGUALDAD; muere incluso al tocar un ítem ajeno (Ranking). |
| R18 | sí | El shell es módulo propio importable con props; inlinearlo rompe el import. |
| R19 | sí (parcial) | El heading con el título sí; "usando `AppPage`" NO (menor M-1). |
| R20 | sí | Exactamente dos regiones, en orden, y ninguna financiera; muere al añadir una tercera. |
| R21 | sí | `within` en los dos sentidos; muere al sacar el slot de su región. |
| R22 | sí | Estado vacío por región + "ningún dígito" dentro de las regiones; muere al quitar el `EmptyState`. |
| R23 | sí | Espía sobre `globalThis.fetch`; muere al añadir un `fetch`. |
| R24 | sí | Render con solo `resolve-actor` mockeado + lectura del código fuente; muere al importar `lib/actions`. |
| R25 | por evidencia | Sin test; verificado por diff (menor M-7). |

### 2.1 R10 -- el requisito que sostiene la feature

`ROLES_ANALITICA` está declarada una sola vez (`lib/auth/menu-visibility.ts`), la usa
el `roles` del ítem y la importa el guard de `app/(app)/analitica/page.tsx`. Verifiqué
la divergencia **en las dos direcciones, editando y mirando el rojo**:

- **Lado menú** (`roles: ["maestro"]` literal, constante intacta) -> **3 rojos**,
  incluido el test de R10 **por nombre**, más R8 y la lista de labels del admin.
- **Lado guard, ensanchando** (el guard deja de usar la constante y escribe
  `["maestro","admin","mensajero"]`) -> **2 rojos** en `AnaliticaPage.test.tsx`
  (R3 `mensajero`, R5). **El test de R10 NO se pone rojo aquí**: compara el ítem
  contra la constante, y el guard desenganchado le queda fuera de vista. Lo atrapa la
  otra capa, que enumera los seis roles uno a uno.
- **Lado guard, estrechando** (`["maestro"]`) -> **1 rojo**: R2 para `admin`.
- **Constante compartida ensanchada** (el camino natural de la 133) -> **3 rojos**:
  R9, R3 `adminSatelite` y la lista de labels de `adminSatelite`.

Conclusión: **no hay forma de desalinear las dos capas sin poner rojo el suite**. El
mérito no es solo del test de R10 (que cubre la dirección menú->constante); es de la
combinación con los tests de página, que enumeran los seis roles del enum en vez de
asertar la forma del gate -- lo contrario del patrón que ya mordió en este repo
(asertar el shape de un `where`). La asimetría queda como menor M-4, no como
bloqueante: el hueco del test de R10 está tapado por conducta real, no por otro test
de forma.

## 3. Mutaciones propias

**20 aplicadas, 17 discriminaron, 3 sobrevivieron.** Ninguna reutiliza las 9 del
implementer. Todas se aplicaron al código ya escrito, se midieron y se revirtieron con
copia de respaldo propia (nunca `git checkout`). Verificación de reversión: `cmp` de
los 4 archivos de producción contra la copia previa -> **IDÉNTICOS**; `git status`
sigue mostrando solo el WIP de `ranking/` de la otra sesión; typecheck 0 errores y
57/57 tests verdes después de revertir.

| # | Mutación | Resultado |
| --- | --- | --- |
| 1 | Cambiar `AppPage` por un `div` + `h1` a pelo | **SOBREVIVE** (M-1) |
| 2 | `roles: ["maestro"]` literal en el ítem, constante intacta | muerta (R10, R8, R17) |
| 3 | Guard con `["maestro","admin","mensajero"]` literal | muerta (R3, R5) |
| 4 | Guard con `["maestro"]` literal | muerta (R2) |
| 5 | `chartColumn: Home` en `ICON_BY_KEY` (icono compartido con "Inicio") | **SOBREVIVE** (M-3) |
| 6 | Label `"Analitica"` sin tilde | muerta (R13 + el fichero de menú revienta al importar) |
| 7 | `isActive` que excluye `/analitica` | muerta (R14) |
| 8 | Añadir `children` al ítem | muerta (R15) |
| 9 | Mover el ítem al primer lugar (antes de "Inicio") | muerta (R16 + 2 listas de R17) |
| 10 | Tocar los `roles` de un ítem AJENO ("Ranking") | muerta (4 rojos: R17 es real) |
| 11 | Añadir una tercera región al shell | muerta (R20) |
| 12 | Pintar `filtros` fuera de su `section` | muerta (R21) |
| 13 | `fetch()` dentro del shell | muerta (R23) |
| 14 | La página importa `@/lib/actions/auth` | muerta (R24) |
| 15 | La página acepta `searchParams.rol` y autoriza por él | muerta (10 rojos, R5 el primero) |
| 16 | Nueva clave en `IconKey` sin entrada en `ICON_BY_KEY` | muerta en **typecheck**, en dos puntos (runtime verde, tal como el test documenta) |
| 17 | Quitar el `EmptyState` de la región "Filtros" | muerta (R22) |
| 18 | El guard deja pasar al actor nulo | muerta (R4) |
| 19 | `"use client"` en `app/(app)/analitica/page.tsx` | **SOBREVIVE** (M-2) |
| 20 | Ensanchar `ROLES_ANALITICA` (las dos capas a la vez) | muerta (R9, R3, R17) |

## 4. `./init.sh` y T5.2

Corrido dos veces por mí. Verde en node, dependencias, typecheck y lint; corta en el
gate de tests por los 20 rojos heredados descritos arriba. **Juicio: T5.2 sin marcar
está BIEN.** Es la conducta correcta: no se marca verde lo que está rojo, aunque la
causa sea ajena. No es defecto de la 129 y no bloquea esta revisión, pero **sí bloquea
el paso a `done` por la letra de `CHECKPOINTS.md`**: esa casilla la cierra el leader
cuando se sanee `dev` (los 20 rojos vienen del PR #212, rediseño del mensajero).

Nota aparte: en este checkout `jq` no está instalado, así que `init.sh` **omite** el
gate de max-2-por-zona y el de "specs presentes". Los verifiqué a mano: una sola
feature `in_progress` (`{"frontend":[129]}`) y su `spec_path` existe con
`requirements.md`. Ambos gates habrían pasado.

## 5. E2E declarado inaplicable -- qué riesgo queda vivo

Acepto la declaración (`design.md` A7 + decisión del humano del 2026-07-30) y no la
dispenso gratis. `CHECKPOINTS.md` pide E2E para flujos críticos (auth, pagos, recaudo,
ingesta, webhooks); un shell vacío no es ninguno, aunque su gate roce auth.
`docs/verification.md` es más exigente ("features con UI: un E2E que ejercita el camino
completo"), así que el hueco existe y hay que nombrarlo.

**Riesgo residual concreto:** ningún test recorre la cadena real de Next para
`/analitica` (middleware -> layout `(app)` -> RSC -> cliente). Queda sin cubrir:

1. **La frontera servidor/cliente de la página** -- lo demostró la mutación 19: un
   `"use client"` en `page.tsx` pasa los 57 tests. En producción reventaría en
   `next build` (async client component) o al ejecutar `cookies()` en el cliente, pero
   **`init.sh` no corre `next build`**, así que el arnés no lo atraparía.
2. **La integración con el layout**: que el ítem aparezca de verdad en el menú servido.
   Cubierto por composición (`itemsVisibles` + Sidebar), no de punta a punta.

Lo que **sí** queda cubierto por otra vía y no debe contarse como hueco: el acceso no
autorizado (los seis roles del enum + sesión ausente, con render real del Server
Component y `notFound()` real) y el bloqueo sin cookie (middleware privado por defecto,
verificado leyendo `middleware.ts`). El único riesgo de negocio de la feature -- que un
rol no autorizado vea el panel -- está cerrado.

## 6. Desviación respecto de la ficha (roles) -- juicio

**Bien declarada, en cuatro sitios coherentes:** `requirements.md` D1 + nota de
traspaso, `design.md` §7 y A4, `feature_list.json` `status_note`, y el comentario del
propio ítem en `menu-visibility.ts`. No es incumplimiento y no lo trato como tal.

**Pero la nota de traspaso a la 133 no dice lo suficiente y en un punto induce al error
que pretende evitar** (menor M-5): manda "tocar DOS sitios: el `roles` del ítem y la
constante `ROLES_ANALITICA`". Hoy **son el mismo sitio** -- el ítem escribe
`roles: ROLES_ANALITICA` --, así que la 133 solo debe editar la constante. Un
implementer que siga la nota al pie puede desenganchar el ítem escribiendo un literal,
que es justo el anti-patrón que R10 vigila. La bitácora del implementer sí lo aclara
(§6b), pero la 133 leerá el spec, no la bitácora. Además la nota no avisa de que al
ampliar se pondrán rojos -- y hay que actualizarlos -- los tests de R9 y las listas de
labels por rol de R17.

## 7. Hallazgos

- **`menor` M-1 (R19).** Ningún test verifica la cláusula "usando el envoltorio único de
  página del repo (`AppPage`)". Sustituir `AppPage` por un `div`+`h1` a pelo pasa los 57
  tests (mutación 1), perdiendo `PageHeader` y `Container`. El código actual **sí** usa
  `AppPage` (verificado leyéndolo); lo que falta es la red. Arreglo barato: asertar
  dentro del shell algo que solo aporte `AppPage`/`PageHeader`.
- **`menor` M-2 (R1).** Ningún test distingue Server Component de Client Component:
  `"use client"` en `page.tsx` pasa los 57 tests (mutación 19). Ver §5.
- **`menor` M-3 (R11/D4).** Se testea que la CLAVE `chartColumn` sea única, no que el
  COMPONENTE de icono lo sea: mapear `chartColumn: Home` (el icono de "Inicio") pasa
  (mutación 5), que es justo lo que A2 quería impedir.
- **`menor` M-4 (R10).** El test de R10 compara el ítem contra la constante, no el guard
  contra la constante: la divergencia del lado del guard la matan los tests de página,
  no R10. Cubierto en conducta, asimétrico en trazabilidad.
- **`menor` M-5 (traspaso a la 133).** La nota de `requirements.md` habla de "dos sitios"
  que hoy son uno, y no avisa de los tests que habrá que actualizar. Ver §6.
- **`menor` M-6 (proceso).** Falta la entrada en `progress/history.md`. Es del leader.
- **`menor` M-7 (R25).** Sin test; se verifica por diff. Correcto como evidencia y yo lo
  reproduje, pero incumple la letra de "cada R mapea a al menos un test". El repo ya
  tiene precedente de testear metadatos (`tests/unit/pwa/manifest.test.ts`).

**Nota no atribuible (no cuenta como hallazgo de la 129):** el commit `cd4a7bf0` mete en
esta rama, además del spec, bookkeeping ajeno a la feature (161, 163 y 164 a `done`). Es
reconciliación del registro declarada en el mensaje del commit, pero viaja en el PR de
la 129; que el leader lo asuma conscientemente.

## 8. Veredicto

**APROBADO-CON-NOTAS. 0 bloqueantes, 7 menores.**

Los 25 requisitos tienen cobertura real: 24 con test automático que muere cuando se
rompe la conducta (verificado con 20 mutaciones propias, 17 letales) y R25 por evidencia
de diff. R10 -- el requisito que sostiene la feature -- resiste la desalineación en las
dos direcciones. Los tres huecos que encontré son cláusulas estructurales (envoltorio
`AppPage`, frontera RSC, identidad del icono), no agujeros en el camino de autorización,
y ninguno describe un defecto del código entregado: describen una red que falta bajo un
código que hoy está bien. Nada vuelve al implementer.

Condiciones para que el leader pase la feature a `done`:
1. Sanear (o registrar formalmente como deuda de `dev`) los 20 rojos heredados y cerrar
   T5.2 con `./init.sh` en verde.
2. Añadir la entrada en `progress/history.md`.
3. Trasladar M-5 a la ficha/spec de la 133 antes de que alguien la implemente.

M-1, M-2, M-3, M-4 y M-7 pueden entrar como deuda anotada; no justifican devolver la
rama.
