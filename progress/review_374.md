# Ficha 374 — Administrar el catálogo geográfico desde la app · REVISIÓN

> **Veredicto: RECHAZADO.** Tres bloqueantes, y ninguno es un defecto de código: la evidencia que
> la propia ficha exige está incompleta. El código revisado está, en lo esencial, bien hecho.
>
> Revisor: reviewer · 2026-09-05 · rama `feat/374-catalogo-geografico-admin`
> (16 commits sobre `origin/dev`, `f6e884af` en la punta al empezar la revisión).
> Herramienta: el MCP `codebase-memory` **estaba disponible** y se usó; todo hallazgo se confirmó
> además leyendo el archivo real, y los barridos exhaustivos (`updateMany` sobre las tres tablas,
> consumidores de `d.zonaId`) se hicieron con `grep` porque son preguntas de texto, no de grafo.

---

## 1. Checklist de `CHECKPOINTS.md`

### Especificación

- [x] `specs/374-catalogo-geografico-admin/requirements.md` con 63 requisitos EARS numerados R1-R63.
- [x] `design.md` con alternativas descartadas y su porqué (§9: A1 materializar la cascada, A2
      catálogo aparte, A4 vetar la desactivación, A6 seis acciones en vez de una).
- [ ] **`tasks.md` con todas las tasks `[x]`. NO: cero de 53.** Ver BLOQUEANTE 1.

### Trazabilidad

- [x] Cada `R<n>` mapea a al menos un test concreto. **Verificado uno a uno, no por la matriz.**
      El 100 % de los archivos citados en `requirements.md §3` y en `progress/impl_374.md §3`
      existen en disco (comprobado por script) y los leí para confirmar que **afirman** lo que
      dicen afirmar. Detalle en §3.
- [x] `progress/impl_374.md` contiene el mapa `R<n> -> test`, con las 63 filas.

### Calidad de código

- [x] `pnpm run typecheck` sin errores.
- [x] `pnpm run lint` sin errores (154 warnings, **todos preexistentes**: ninguno cae en archivos
      de esta ficha).
- [x] `pnpm test` pasa. Ver §2.
- [x] Flujos críticos + E2E: **inaplicable**. Este repo no tiene arnés E2E vivo; los specs
      existentes dicen `NOT EXECUTED`. El riesgo se cubre por otra vía, pero esa vía es J4, que
      está sin hacer (BLOQUEANTE 3).

### Datos y seguridad (Supabase)

- [x] RLS: **no hay tabla nueva**. `provincia`, `canton` y `distrito` ya tienen RLS habilitada
      desde `20260709130000_ordenes_catalogos_geografia:71-73`; una columna añadida no cambia una
      política. La migración lo declara en su cabecera en vez de dejarlo suponer.
- [x] Migraciones versionadas y reversibles: las **dos** nuevas traen su `down.sql`, y el de
      `20260906120000` está **ejercitado contra Postgres** (esquema desechable, up, retirar un
      nodo, down, mismos conteos y mismos nombres fila a fila, e idempotente al correrlo dos
      veces). El warning de `init.sh` sobre migraciones sin `down.sql` nombra tres de agosto,
      ninguna de esta ficha.
- [x] Sin secretos hardcodeados.
- [x] Webhooks: no aplica, la ficha no añade ninguno.

### Patrón de capas

- [x] Controller (Server Action) sin queries ni lógica: `lib/actions/geografia.ts` solo resuelve
      actor, valida con zod y delega. La única excepción es `actualizarDistritosEspeciales`, que ya
      iba contra Prisma directo antes de esta ficha y queda **declarada** fuera de alcance en el
      propio archivo y en `requirements.md §4`.
- [x] Service sin HTTP: `GeografiaService` recibe dos repositorios por constructor.
- [x] Repository solo Prisma: `GeoRepository` no valida permisos ni decide nada.
- [x] Interfaces en `lib/interfaces/repositories/IGeoRepository.ts` y
      `lib/interfaces/services/IGeografiaService.ts`.

### Permisos

- [x] `app/(app)/configuracion/geografia/page.tsx:17-27` niega **antes** de leer: con rol ajeno no
      se llama a `listarArbolGeografico`. Lo afirma `geografia-admin-page.test.tsx` con
      `expect(listarArbolGeograficoMock).not.toHaveBeenCalled()` para cinco roles y para «sin
      sesión».
- [x] El módulo cliente recibe el árbol por props desde el Server Component.
- [x] Mutaciones por Server Actions, no por rutas API.

### Multi-país / configuración

- [x] Nada de país, moneda ni cuenta hardcodeado. Los nombres de la DTA que aparecen en tests son
      datos de prueba.

### Verificación final

- [x] `./init.sh` termina en verde. **Corrido por mí**, no leído de la bitácora. Ver §2.
- [ ] `progress/review_374.md` con veredicto OK: **este archivo, y el veredicto es RECHAZADO.**
- [ ] Entrada en `progress/history.md`: **no existe** (`grep 374 progress/history.md` = 0).

---

## 2. Verificación ejecutable, corrida por el reviewer

`./init.sh` **completo** (el modo rápido se niega solo: el diff toca `db/migrations/**`,
`db/schema.prisma` y `lib/types/**`). Exit code escrito **dentro** del log, no leído del shell:

```
✓ typecheck paso
✓ lint paso                     (154 problems, 0 errors, 154 warnings)
✓ DATABASE_URL resuelta: los 125 archivos de tests contra Postgres SI se ejecutan
 Test Files  1756 passed (1756)
      Tests  25010 passed | 26 skipped (25036)
   Duration  539.99s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1756 ejecutado(s))
! migraciones sin down.sql: 20260814120000_... 20260814140000_... 20260814160000_...
✓ .env presente
== init OK ==
INIT_EXIT=0
```

Antes de correrlo: `pnpm exec prisma migrate status` dice **178 migrations, «Database schema is up
to date!»** contra `localhost:5432/ordenex`. Las dos migraciones de la ficha están aplicadas y no
hay drift.

**Los `skipped`, mirados y no dados por buenos (26):** 17 de
`tests/components/AnaliticaPage.test.tsx` y 9 de `tests/components/AnaliticaShell.test.tsx`, los dos
preexistentes y ajenos a la ficha. **Cero saltados por falta de base**: el gate confirma en su
propia línea que los 125 archivos contra Postgres se ejecutaron, y comprobé nominalmente que los 10
archivos nuevos de `tests/integration/db/**` de esta ficha aparecen con marca de verde en el log,
incluido `zona-guardado-conserva-inactivos.test.ts`. Sin `.env` el veredicto no valdría; con él,
vale.

Los tres warnings de `down.sql` son de agosto y no de esta ficha.

**El flake conocido de `dev`** (`CrearTiendaForm` / `GenerarApiKeyForm`, «role option») **no salió
en esta corrida**: 0 rojos.

---

## 3. Trazabilidad: los 63, verificados en el test y no en la matriz

Leí los 29 archivos de test nuevos. Resumen de lo que **sí** afirman, agrupado por lo que había que
comprobar de verdad:

**La cascada se evalúa y no se materializa (R7-R11).**
`GeoRepository.cambiarActivacion` (`:332-366`) hace exactamente una escritura:
`tx.<nivel>.update({ where: { id }, data: { activo } })`. Barrido propio sobre `lib/`, `app/` y
`scripts/` con `(provincia|canton|distrito).(update|updateMany|upsert|delete|deleteMany|createMany)`:
las **únicas** cinco coincidencias son esos tres `update` y los dos `updateMany` de `zonaEspecial`
que ya existían. **Ningún `updateMany` sobre descendientes, en ninguna capa.**

**Reactivar NO resucita lo que estaba inactivo por su cuenta (R9), el requisito del humano.**
`tests/integration/db/geografia-cascada-reversible.test.ts:197-212`, contra Postgres, con un cantón
de tres distritos donde `d2` nace `activo: false` **por su cuenta**. Se fotografían los flags, se
desactiva el cantón, se reactiva, y se exige `toEqual` sobre el mapa entero **más** tres aserciones
nominales (`d2` sigue `false`, `d1` y `d3` siguen `true`). Tiene anti-vacuidad propia («el corpus se
sembró», «el cantón SÍ cambió») y la mutación M5 de la bitácora, el `updateMany` a los hijos, lo
deja rojo. **Cubierto y no vacío.**

**Sin borrado físico (R5), con contraprueba sobre cuerpo mutado.**
`geografia-sin-borrado-fisico.guardia.test.ts` prueba el detector en las dos direcciones: control
positivo sobre un cuerpo sano, tres contrapruebas que **sí** detectan (`distrito.delete`,
`provincia.deleteMany`, `canton.delete`) y una que **no** debe detectar (`zonaDistrito.deleteMany`,
legítimo). Anti-vacuidad: `lib/` tiene más de 200 fuentes, ninguna se lee vacía, y el barrido
alcanza `GeoRepository.ts` (control positivo sobre el árbol real). **Le quitas la protección y
falla.**

**`appendAccion` dentro de la misma transacción (R51/R55).**
Leído en `GeoRepository.ts:338-365`: la llamada está dentro del callback de `$transaction`, después
del `update` y de `resolverActorCongelado`. Lo vigilan dos cosas independientes: la entrada nueva
del censo cerrado en `historial-accion-escrituras-cubiertas.guardia.test.ts` (forma `abre_tx`,
mutación `tx.(provincia|canton|distrito).update(`) y el test de integración de R55, que usa un
cliente con el registro roto de verdad y **contraprueba con el registro sano**. La mutación M2 de la
bitácora deja los dos rojos.

**El predicado en un solo sitio (R11).**
`lib/repositories/_shared/geografia-activa.ts` es la única fuente, y la guardia prohíbe el literal
`activo: true|false` en todo `lib/` fuera de ese archivo, con contraprueba sobre un `where` escrito
a mano y controles negativos (`activo: boolean`, `activa: true`, mapeo de DTO). Anti-vacuidad: la
fuente única contiene al menos 8 literales de verdad. `OrdenRepository`,
`ConteosPublicosRepository` y los dos módulos de `app/` importan de ahí.

**El riesgo caro: el selector de Tarifas (R47/R48).**
`GeografiaSelector` **no filtra por estado**: el `useMemo` pasa `estado: "todos"` fijo y lo deja
escrito con su porqué. El distintivo va **fuera** del `label` para que marcar no pueda cambiar la
casilla. `geografia-selector-inactivos.test.tsx` afirma las tres mitades: se pintan (con el
distintivo propio y el heredado distinguidos), van **marcados** si venían en `initialSelected`, la
casilla responde al clic en los dos sentidos, `onSelectedChange` reporta los **tres** ids al montar,
y el árbol renderizado lista las seis casillas por su `aria-label` exacto.
`zona-guardado-conserva-inactivos.test.ts` cierra el círculo **contra Postgres** y **no escribe
`distritoIds` a mano**: lo obtiene montando el selector real y leyendo lo que reporta, y lleva
contraprueba (con la lista corta, la fila **sí** desaparece de verdad).

**Y lo comprobé yo, no por lectura:** ver BLOQUEANTE 2. Corrí la mutación que faltaba y muere.

**Los sitios de lectura, en las dos direcciones (R28-R35).** Verificados uno a uno contra la tabla
de `design.md §4`:

| Sitio | Decisión del spec | Lo que hace el código |
| --- | --- | --- |
| `GeografiaService.listarArbol` | no oculta | `listArbol` sin `where`. OK |
| `GeoRepository.list*Lite` | no oculta, proyecta | los tres `findMany` sin `where`, con `disponible` compuesto. OK |
| Desplegables de la corrección | **sí** oculta, en cliente | `CorregirDatosClienteModal.hijosDe` filtra por `o.disponible`, y las provincias también. OK |
| `CorregirDatosClienteService` | **sí**, como rechazo | `:264-276`, con motivo propio. OK |
| `findDistritosByCantonIds` / `findDistritoParaCorreccion` | no recortan | ni un `where` nuevo; solo `select`. OK |
| `resolveGeo` | **sí**, rechazo con mensaje propio | tres rechazos, cada uno detrás de su `lookup`. OK |
| `ConteosPublicosRepository.contar` | **sí** recorta | `...WHERE_DISTRITO_DISPONIBLE`. OK |
| `OrdenRepository.list` y sus filtros | **jamás** | intacto; `grep disponible` en `app/` no devuelve ni un uso fuera de la pantalla nueva y del selector. OK |

Es decir: **las cinco que no filtran no filtran, y las tres que filtran filtran**, cada una donde
toca. La decisión de no ocultar en el catálogo de filtros, la que protege las órdenes históricas de
un distrito retirado, está afirmada por dos tests distintos con contraprueba de mutación.

**Composition root (R60).** `geografia.composition-root.test.ts` llama a la acción **real** sin
`deps.geografiaService`, de modo que se construye por el root de verdad, y exige `ordenCount`
llamado **una vez** con `{ cantonId, deletedAt: null }`. No comprueba que el módulo importe:
comprueba que alguien **pasa**. Además cubre el primer argumento del constructor por la otra acción.
Es exactamente el remedio a los notificadores muertos con la suite verde.

**Búsqueda activa de tests que pasan sin comprobar nada.** Barrí los 71 archivos de test tocados por
la rama buscando early-returns que salten aserciones. Los `if (r.status !== "ok") return;` que
aparecen viven todos en archivos preexistentes que la ficha solo tocó para añadir `disponible` a
fixtures, y van precedidos de su `expect`. En los archivos **nuevos** el único `return` temprano es
`if (boton === undefined) return;` dentro del helper `expandirTodo`
(`geografia-admin.ui.test.tsx:157`), que es la condición de salida de un bucle, no un salto de
aserción, y el helper **lanza** si no converge. Los cinco archivos de integración que necesitan
corpus **lanzan con mensaje** en vez de devolver (`geografia-historico-intacto`,
`geografia-ordenes-sin-entregar`, `geografia-alta`, `zona-guardado-conserva-inactivos`,
`geografia-registro-migration`). **Cero `if (!fks) return;`.**

**Aserciones contra su propia fuente.** Miradas de una en una:

- `geografia-admin.ui.test.tsx` escribe **todos** los textos literales y lo declara en su cabecera:
  no importa del módulo que los produce. Correcto.
- `geografia-activa.test.ts` compara los `WHERE_*`/`SELECT_*` contra objetos literales escritos a
  mano, y la tabla de verdad de R7 está escrita entera, no derivada.
- `openapi-374-nodo-retirado.test.ts` **sí** importa los mensajes de `geo-resolucion.ts`, pero los
  compara contra **otros dos artefactos** (el objeto TS y el yaml). Esa dirección es la correcta: lo
  que mide es que el contrato publicado coincide con lo que el código emite.
- `menu-visibility.test.ts:305-318`: el `toEqual` literal de los `href` **se actualizó a mano**
  añadiendo el sexto al final. Es el contrato y sigue siéndolo. OK.
- Ver hallazgo **menor 5** por el único `toEqual` que sí quedó debilitado.

**`WHERE` medidos con dobles.** Ninguno. Todo lo que es un `WHERE` de esta ficha vive en
`tests/integration/db/**` contra Postgres: `list*Lite`, el árbol, las cuatro lecturas geográficas de
`OrdenRepository`, los conteos públicos, el conteo de órdenes sin entregar, la unicidad, la cascada
y el registro. El único archivo con dobles sobre el repositorio
(`geo-repository.escrituras.test.ts`) declara en su cabecera qué **no** puede afirmar y por qué, y
se limita al orden y al número de llamadas.

---

## 4. BLOQUEANTES

### BLOQUEANTE 1 - `tasks.md` no tiene ni una sola tarea marcada

`specs/374-catalogo-geografico-admin/tasks.md`: **0 de 53** tareas en `[x]`; las 53 siguen en `[ ]`.
`CHECKPOINTS.md` lo pide con todas las letras: «Existe `specs/<feature>/tasks.md` y todas las tasks
estan marcadas `[x]`».

No es burocracia: sin marcar, no hay forma de distinguir «T0.3 no se hizo en preview» (que es
verdad, y está escrito solo en la bitácora) de «T0.3 se hizo y se olvidó marcar». El estado de la
ficha vive en disco, y hoy el disco dice que no se empezó.

**Qué falta:** marcar las tareas realmente hechas y **dejar sin marcar** las que no lo están (la
mitad de preview de T0.3, J2, J4), que es justo lo que hace útil el archivo.

### BLOQUEANTE 2 - J2 incompleta: la septima mutacion nunca se ejecuto, y es la del riesgo mas caro

`tasks.md` J2 declara **siete** mutaciones. `progress/impl_374.md §4` documenta seis con su mensaje
literal (M2-M7, más M1 que es un extra fuera de la lista) y cierra con:

> «La séptima mutación declarada en `tasks.md` J2 -"el filtro de `initialSelected` en el selector de
> Tarifas"- **no se ejecutó porque su código no existe todavía**: es el bloque H3/H4.»

Eso era cierto cuando lo escribió `backend_dev`. Dejó de serlo con los commits `a78f1f26` y
`ceb7ed56`. El bloque H se completó, la bitácora **no** se actualizó, y la mutación que falta es
precisamente la que vigila lo que `design.md §8` llama *el riesgo más caro*: si el selector filtrase
`initialSelected`, el siguiente guardado de la zona borraría filas de `zona_distrito` en silencio.

**La corrí yo.** Apliqué el filtro por disponibilidad sobre `initialSelected` en
`GeografiaSelector.tsx` y ejecuté las dos suites que lo vigilan. **Muere, con 4 rojos en 2
archivos:**

```
FAIL tests/integration/db/zona-guardado-conserva-inactivos.test.ts >
  374/R48 ... > las filas de `zona_distrito` son EXACTAMENTE las mismas antes y despues del guardado

FAIL tests/unit/components/geografia-selector-inactivos.test.tsx >
  374/R47 ... > van MARCADOS si venian en `initialSelected`

FAIL tests/unit/components/geografia-selector-inactivos.test.tsx >
  374/R47 ... > su casilla RESPONDE al clic, en los dos sentidos

FAIL tests/unit/components/geografia-selector-inactivos.test.tsx >
  374/R47 ... > LO QUE SE MANDA AL GUARDAR conserva los retirados que llegaron en `initialSelected`
AssertionError: expected "vi.fn()" to be called with arguments: [ [ 'd-cab', 'd-vol', 'd-cortes' ] ]
Received: [ [ "d-cab" ] ]
```

Mutación revertida (`git checkout --`), residuo comprobado a cero (`grep -c` = 0), las dos suites
verdes otra vez (8 passed) y el árbol limpio salvo el `design-etiquetas/` sin trackear que ya
estaba.

**Por qué sigue siendo bloqueante aunque el resultado sea el bueno:** J2 exige que quede «anotado en
`progress/impl_374.md` qué test cayó en cada caso». Hoy la bitácora dice lo contrario, que no se
podía ejecutar, y la próxima persona que la lea creerá que ese flanco está sin medir.
**Qué falta:** sustituir esa nota por el resultado de arriba en `progress/impl_374.md §4` (puede
copiarse literal de este informe).

### BLOQUEANTE 3 - J4: nadie ha visto la pantalla

744 líneas de UI nueva (`GeografiaAdminModule.tsx` 701 + `page.tsx` 43), más los cambios en
`GeografiaSelector` y `CorregirDatosClienteModal`, verificadas **únicamente** contra dobles: las
cuatro Server Actions están mockeadas y el toast también. Eso es correcto para lo que esos tests
miden -el cableado- y no sustituye a levantar la app.

Este repo tiene el coste medido: «ver la app encuentra lo que la suite no» (7 textos rotos que
12.000 tests daban por buenos) y «el backend sin pantalla no es entrega». Y aquí hay superficie
nueva de sobra donde eso muerde: una relectura tras cada operación, un modal con un conteo asíncrono
que habilita el botón, un `SegmentedToggle` sobre 494 distritos, y la frontera Server Action a
cliente de cuatro acciones que **nunca se han ejecutado contra Postgres desde el navegador**.

J4 ya tiene los ocho puntos escritos (alta, conflicto con acentos, herencia, reactivación, Tarifas,
corrección, confirmación + toggle, `/historico/acciones`). Ninguno está anotado.

**Qué falta:** una sesión con la app levantada y sesión `maestro`, y los ocho puntos anotados en
`progress/impl_374.md` **con lo que se vio**, no con lo que se esperaba. Es barato y es lo único que
puede desmentir a la suite.

---

## 5. Debe arreglarse antes de desplegar (no bloquea la revision del codigo)

### D1 - Los tres `GROUP BY` de duplicados, sin medir en preview

T0.3 lo pedía en local **y** en preview. Local: 0/0/0 (7/84/494 filas). Producción: 0/0/0, medido
por el spec_author. **Preview: sin medir**, y la bitácora lo dice sin esconderlo.

Si preview tiene un duplicado, `CREATE UNIQUE INDEX` revienta y `prisma migrate deploy` falla. Es un
fallo **ruidoso**, no una pérdida silenciosa, así que no cambia el veredicto del código, pero
bloquea la release hasta medirlo. El obstáculo está documentado y es real: el MCP de Supabase está
fijado al ref de producción.

### D2 - `d.zonaId` cambio de semantica y tiene un SEGUNDO consumidor que el design niega

`design.md §4.2` afirma:

> «El único consumidor actual de ese campo es el texto "(zona: X)" del selector
> (`GeografiaSelector.tsx:309-313`), que con esto pasa a decir la verdad.»

**Es falso.** Hay un segundo consumidor, y es el peor posible:
`app/(app)/configuracion/tarifas/_components/ZonasTarifasModule.tsx:106-110` -código que ya estaba
en `origin/dev`- construye así la lista que alimenta el guardado de la zona:

```ts
const distritoIds: string[] = [];
for (const p of provincias)
  for (const c of p.cantones)
    for (const d of c.distritos)
      if (d.zonaId === full.id) distritoIds.push(d.id);
```

Ese `distritoIds` viaja a `formInitial`, luego a `CrearZonaForm`, luego a `initialSelected`, y de
ahí al `deleteMany` + `createMany` de `ZonaRepository.update`. Es exactamente la cadena que
`design.md §8` llama *el riesgo más caro*.

Con el colapso 1/0/>1 que introduce R27, un distrito en **dos** zonas pasa de `zonaId = la primera`
a `zonaId = null`. Consecuencia:

- **antes:** al guardar la zona «primera» se conservaba su fila; al guardar la otra, se perdía;
- **ahora:** al guardar **cualquiera** de las dos, se pierde.

Es un ensanchamiento de una pérdida silenciosa preexistente, no una regresión con víctimas hoy:
producción tiene **0 distritos con más de una zona** (medido el 2026-09-05) y el caso **retirado**
-que es lo que R47/R48 protegen- no se ve afectado (un distrito retirado con una zona sigue llegando
preseleccionado, y eso lo afirma el test de integración).

Lo que sí es una debilidad real de la evidencia: el test de R48 construye `initialSelected` desde
`zona_distrito` (`antes.map((f) => f.distritoId)`), **no** desde `d.zonaId`, que es lo que hace
producción. Así que ese test es ciego a esta ruta.

**Qué falta:** corregir la afirmación de `design.md §4.2`, y elegir una de dos: derivar
`distritoIds` en `abrirEditar` de la N:M en vez de `d.zonaId`, o dejar el caso escrito con su
medición y su fecha. Cualquiera cierra el hueco; lo que no vale es dejar el design diciendo algo que
el árbol desmiente.

### D3 - Estado de la ficha sin actualizar

- `feature_list.json` sigue con `"status": "pending"` para la 374, con la rama entera implementada.
- `progress/history.md` no tiene entrada de la 374 (`CHECKPOINTS.md` la exige).

Los escribe el leader, no el implementer: se anotan aquí para que la ficha no se cierre así.

---

## 6. Menores / deuda anotada

1. **`esDisponible` es un export muerto.**
   `app/(app)/configuracion/_shared/geografia-estado-label.ts:60` no lo importa nadie (`grep` en
   `app/`, `lib/` y `tests/`: una sola línea, su declaración). Además es una segunda definición de
   «disponible» viviendo en `app/`, donde la guardia de R11 **no barre** (y lo declara). Ningún test
   ata `estadoGeografico(...).tipo === "activo"` a `estaDisponible(...)` sobre las 8 combinaciones;
   hoy coinciden y las dos suites de pantalla usan el mismo árbol de prueba, así que una divergencia
   probablemente rompería algo, pero no está afirmado.
2. **La guardia de R5 barre solo `lib/`.** `app/(app)/layout.tsx:12,40` demuestra que
   `getPrismaClient()` es alcanzable desde `app/`. Comprobé por `grep` que hoy no hay ni un borrado
   de las tres tablas en `app/` ni en `scripts/`, pero el barrido no lo cubriría si apareciera.
3. **`crearNodoGeografico` traduce CUALQUIER excepción a `conflict`**
   (`lib/actions/geografia.ts:132-139`). Es el precedente literal de `crearVehiculo`
   (`lib/actions/vehiculos.ts:74-81`), así que no es deuda nueva, pero una base caída se le presenta
   al maestro como «ya existe un nodo con ese nombre bajo el mismo padre».
4. **`confirmarRetirada` no lleva `try/catch`** (`GeografiaAdminModule.tsx:279-293`), a diferencia
   de `activar` y `guardarAlta`, que sí. Una excepción de red al confirmar la retirada se queda sin
   toast y sin relectura.
5. **Un `toEqual` que dejó de afirmar.** `api-key-eliminada-migration.test.ts:153` pasó de
   `toHaveLength(45)` a `toHaveLength(HISTORIAL_ACCION_TIPOS.length)`. La línea inmediatamente
   anterior ya compara los dos conjuntos ordenados, así que esa aserción es ahora redundante. **La
   cobertura no se pierde**: el número duro (47) vive en
   `historial-accion-escrituras-cubiertas.guardia.test.ts`, que además obliga a censar el productor
   del tipo nuevo. El cambio está razonado en la bitácora y lo acepto; se anota para que nadie crea
   que ese `toHaveLength` sigue vigilando algo.
6. **`lib/repositories/_shared/geografia-activa.ts` lo importan dos módulos de `app/`.** El módulo
   es puro y no toca `@prisma/client` (está escrito y lo verifiqué), pero vivir bajo
   `lib/repositories/` hace que la UI importe nominalmente de la capa de datos. `lib/types/` o
   `lib/utils/` encajaría mejor con `docs/architecture.md`.
7. **R45 tiene un caso tautológico**: «los seis mensajes son SEIS textos distintos» opera sobre un
   array literal escrito en el propio test. No resta: cada uno de los seis mensajes está afirmado
   por separado en su caso real.

---

## 7. Lo que esta bien y no repito

El diseño de la cascada (evaluar, no materializar), el predicado único con su guardia, el registro
de acciones dentro de la transacción con savepoint real y contraprueba, la corrección del `take: 1`
que mentía, el rechazo con mensaje propio en `resolveGeo` con precedencia declarada, los dos
artefactos del contrato público con su entrada fechada de changelog, el `down.sql` que aborta
ruidosamente en vez de borrar el rastro, y el blindaje del selector de Tarifas. Todo eso lo revisé y
lo doy por bueno.

---

## 8. Veredicto

**RECHAZADO.**

Tres bloqueantes, y ninguno es un defecto del código:

1. `tasks.md` con 0 de 53 tareas marcadas: incumple `CHECKPOINTS.md` directamente.
2. J2 incompleta: la séptima mutación, la del riesgo más caro, nunca se ejecutó y la bitácora afirma
   que no se podía. La ejecuté yo y **muere con 4 rojos**; falta anotarlo donde J2 lo exige.
3. J4 sin hacer: nadie ha abierto la pantalla con sesión `maestro`.

Los tres se cierran sin tocar una línea de producción. Cerrados esos, más D1 (medir preview) y D2
(el segundo consumidor de `d.zonaId`, que sí pide una decisión), esta ficha pasa.

Vuelve al implementer.
