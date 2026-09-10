# Ficha 411 — Bitácora de implementación · FRONTEND (B7)

> Hermana de `progress/impl_411_backend.md`, que cubre B1–B6. Aquí sólo la superficie: **R31–R35
> y R39**. Los otros 33 requisitos ya estaban cubiertos y no se rehacen.

## 0 — De dónde parte esto

| | |
| --- | --- |
| Rama | `feat/411-analitica-cohorte-de-carga-frontend` |
| Rama BASE | `origin/feat/411-analitica-cohorte-de-carga` (el backend completo) |
| SHA base | `7513b4a6` — «docs(411): bitacora del backend, con los dos rojos pegados y el gate medido» |
| Commits propios | `602c782d` (la tabla y su montaje), `91bd7b5a` (los tests), `d3eeadba` (el caso del mutante superviviente), y este mismo (la bitacora) |

No sale de `dev`: el frontend va **encima** del backend, que es el patrón de ramas que este repo
usa para las fichas `fullstack`. El PR de la ficha lleva las dos mitades juntas.

---

## 1 — Qué se ve ahora en `/analitica`

Sección propia **«Detalle - Cohorte de carga»**, hermana de «Detalle - Productos» y **dentro de
`FiltroEntregasProvider`**. Siete columnas:

| Fecha de carga | Cargadas | Entregadas | Devueltas | Incidentes | **Vivas** | Días hasta entregar |
| --- | --- | --- | --- | --- | --- | --- |

Encima de la tabla, tres líneas de resumen (sólo con respuesta): la advertencia del filtro de
mensajero cuando lo hay, «Cargadas en el periodo: N órdenes», «Entregadas X % (N órdenes)» y el
sello de frescura.

### Las cinco reglas cerradas del backend, y dónde se cumple cada una

1. **`porDia` llega DESCENDENTE y no se reordena.** `filasDeCohorte` no tiene ni un `sort`, y hay
   un caso dedicado que le pasa un orden NO cronológico y exige que salga tal cual — que es lo que
   mata un `.sort()` añadido mañana. Con sólo el caso descendente no se distingue «no reordena» de
   «reordena igual que ya venía».
2. **Los cubos con `n = 0` no viajan y la pantalla los rellena con CERO.** `Vivas` es columna
   obligatoria también cuando vale 0 (R32).
3. **`sin_rango` es una invitación, no un error** (R39). Se pinta **en lugar de** la tabla: ni
   cabeceras, ni ceros, ni esqueleto.
4. **Los segundos llegan crudos y el promedio se escribe con su `n`** vía `base-del-kpi.ts`. El
   único porcentaje lleva su base y su denominador son las **cargadas** (R33).
5. **La faceta de mensajero no recorta**, y la pantalla lo advierte junto al título (R24).

### Y la higiene: el `@sin-superficie` está retirado

En el **mismo commit** que monta la tabla (`602c782d`), como pedía su propia anotación. No es una
cortesía: `superficie-de-uso.guardia` exige que la anotación caduque en cuanto lo anotado vuelve a
ser alcanzable, y está **medido** (mutación M13 más abajo).

---

## 2 — Cuatro decisiones que no estaban escritas en el spec

Ninguna contradice el diseño; las cuatro son huecos que había que rellenar y se dejan dichas.

**(a) Las columnas de desenlace se DERIVAN del dominio.** `CUBOS = [...ESTADOS_TERMINALES, "viva"]`
y `ETIQUETA_CUBO: Record<CohorteDesenlace, string>`. Un cuarto estado terminal añade su columna
sola **y no compila** hasta que alguien escriba su rótulo. La alternativa —cuatro columnas escritas
a mano— dejaría ese cubo fuera de la tabla en silencio, y entonces «Cargadas» dejaría de ser la
suma de sus columnas sin que nada se pusiera rojo. Es el modo de fallo de esta ficha, girado de
lado.

**(b) Los días NO se formatean con `formatearValor(_, "segundos")`.** Ese formateador —el común de
la analítica— tiene la HORA como magnitud máxima: una cohorte de dos días saldría **«48 h»** bajo
una columna que dice «Días». Se formatea con `Intl` (`style: "unit"`, `unit: "day"`) y el locale de
`monedaConfig`, o sea sin literal de idioma, que es la regla que `formato.ts` lleva escrita. Lo que
se gana de paso: la concordancia sale sola («1 día» / «2 días»).

**(c) La pantalla NO cortocircuita `sin_rango`.** Aunque el filtro venga vacío, pregunta igual a la
Server Action. Decidirlo aquí convertiría la invitación en una **sonda de permisos**: un `mensajero`
—que no puede leer esta sección— vería «elige un periodo» y averiguaría por el texto que la sección
existe y que sólo le falta un filtro. La denegación precede a la invitación, y eso se decide en el
borde. Tiene su caso.

**(d) La tabla nace `fuera` del censo de descargas, con motivo escrito.** ⟨P5⟩ del spec decidió que
la descarga no entra. El motivo es el **tercero distinto** de ese censo: no es un recorte de algo
que ya se descarga (ficha 343) ni le falta la puerta para servirlo entero (ficha 347 — aquí el
borde devuelve el DTO completo en una consulta, así que cablearla sería barato). Es que se preguntó
y se decidió que no.

---

## 3 — Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `app/(app)/analitica/_components/entregas/CohorteCargaTabla.tsx` | La tabla. Cliente + SWR con clave `[CLAVE_TABLERO, "cohorte-carga", filtroSerializado]` |
| `tests/components/CohorteCargaTabla.test.tsx` | 28 casos: R32, R33, R34, R39 (+ R24 en pantalla) |
| `tests/unit/analytics/cohorte-frontera.guardia.test.ts` | 12 casos: R35, con sus fixtures discriminantes |

### Modificados

| Archivo | Qué cambia |
| --- | --- |
| `app/(app)/analitica/page.tsx` | La sección, dentro del proveedor. Título, descripción e import |
| `lib/actions/cohorte-carga.ts` | **Se retira el `@sin-superficie`** y se escribe dónde vive ahora su superficie |
| `tests/components/AnaliticaPage.test.tsx` | El mock de la acción + el bloque de R31 (3 casos) |
| `tests/unit/descarga/censo-tablas.ts` | La entrada de la tabla, `fuera` con motivo |
| `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | Los cuatro totales: 34→35 archivos e instancias, 11→12 exclusiones de `DataTable`, 35→36 censo total, 12→13 `fuera` |

**Lo que NO se tocó:** ni el backend (B1–B6), ni `lib/types/`, ni el servicio, ni el repositorio, ni
ninguna migración. **No se encontró ningún defecto en la parte del backend.**

---

## 4 — Mapa `R<n>` → test

Con el **nombre exacto** del caso, no sólo el archivo.

| R | Test |
| --- | --- |
| **R31** | `AnaliticaPage.test.tsx` › FICHA 411 (R31)… › «el componente está entre la apertura y el cierre del proveedor de filtro» · › «es una sección PROPIA y hermana de la de productos, no un bloque dentro de otra» · › «el rol `%s` ve la sección de cohorte de carga» (×4 roles) |
| **R32** | `CohorteCargaTabla.test.tsx` › «las cabeceras son estas siete y en este orden» · › «la columna `Vivas` se pinta tambien cuando vale 0» · › «cada cubo cae en SU columna» · › «los cubos que no vienen valen CERO, no la cifra de al lado» |
| **R33** | `CohorteCargaTabla.test.tsx` › «los dias hasta entregar llevan su `n` al lado» · › «el sustantivo concuerda con su cifra» · › «sin ninguna entregada el promedio es un guion, no un cero, y conserva su base» · › «el porcentaje se escribe sobre la cohorte ENTERA y con su base» · › «el universo del periodo se escribe con el modulo unico de base» |
| **R34** | `CohorteCargaTabla.test.tsx` › «`%s` se presenta como aviso, sin filas y sin estado vacio» (`forbidden`, `unauthenticated`) · › ««validation_error» se presenta como aviso, no como vacio» · › «un fallo de red se presenta como aviso, no como vacio» · › «con error no se escribe el universo ni el sello» · › «un periodo elegido y sin ninguna carga SI cae al estado vacio» |
| **R35** | `cohorte-frontera.guardia.test.ts` › «no importa ninguna capa de datos» · › «no abre ninguna puerta HTTP propia» · › «SI importa `consultarCohorteCarga`» · › «`@/lib/actions/cohorte-carga` es la UNICA accion que importa» (+ 6 de autocomprobación) |
| **R39** | `CohorteCargaTabla.test.tsx` › «invita a elegir un periodo» · › «NO pinta la tabla» · › «NO pinta ningun cero, ni un universo, ni un sello» · › «NO se presenta como un error» · › «`sin_rango` NO tiene mensaje de error: no es un fallo del filtro» |

Y dos que refuerzan requisitos del backend desde la pantalla:

| R | Test |
| --- | --- |
| R24 (mitad de pantalla) | `CohorteCargaTabla.test.tsx` › «con un mensajero seleccionado, la pantalla avisa de que no recorta» · › «sin mensajero no hay advertencia que dar» |
| R6 (mitad de pantalla) | `CohorteCargaTabla.test.tsx` › «la primera fila es la cohorte mas reciente» · › «no reordena: un orden distinto al cronologico sale TAL CUAL llego» |

**Todos los esperados van escritos A MANO** —«40%», «2 días», «1 día», «(4 órdenes cerradas)»,
«- (0 órdenes cerradas)», las siete cabeceras— y ninguno se deriva de la función que lo produce.
Un esperado calculado con la misma función que se prueba está verde haga lo que haga, y este repo
ya pagó esa factura dos veces (`aserción-contra-su-propia-fuente`, `literal-contrato-vs-polizón`).

---

## 5 — Mutaciones: 14 aplicadas, 14 muertas (una a la segunda)

El arnés está en un script de un solo uso y **se autocomprueba tres veces**, porque en este repo ya
hubo uno que reportó 9/9 supervivientes sin haber ejecutado un test:

1. si el texto a mutar no aparece **exactamente una vez**, aborta (no reporta superviviente);
2. si la salida de `vitest` no trae la línea `Test Files`, aborta (no se ejecutó nada);
3. restaura con `git checkout --` y **verifica que el archivo volvió al original** antes de seguir.

| # | Mutación | Veredicto | Medida |
| --- | --- | --- | --- |
| M1 | quita la columna `Vivas` (`CUBOS` sin el cubo sin cerrar) | **MUERTA** | 4 failed / 23 passed |
| M2 | rellena el cubo ausente con las cargadas en vez de con 0 | **MUERTA** | 2 failed / 25 passed |
| M3 | la pantalla reordena `porDia` por su cuenta | **MUERTA** | 1 failed / 26 passed |
| M4 | el promedio de días pierde su denominador | **MUERTA** | 3 failed / 24 passed |
| M5 | el promedio ausente se escribe como CERO días | **MUERTA** | 1 failed / 26 passed |
| M6 | el porcentaje se calcula sobre las CERRADAS | **MUERTA** | 1 failed / 26 passed |
| M7 | `sin_rango` se degrada a «filtro inválido» | **SOBREVIVIÓ** → ver abajo | 27 passed |
| M8 | `sin_rango` pinta la tabla vacía en vez de invitar | **MUERTA** | 4 failed / 23 passed |
| M9 | «prohibido» se degrada al estado vacío | **MUERTA** | 2 failed / 25 passed |
| M10 | la advertencia del mensajero no se pinta nunca | **MUERTA** | 1 failed / 26 passed |
| M11 | el componente importa el SERVICIO | **MUERTA** | 1 failed / 11 passed (guardia) |
| M12 | la sección se monta FUERA del proveedor | **MUERTA** | 1 failed / 46 passed (ver nota) |
| M13 | vuelve el `@sin-superficie` a la acción, ya con superficie | **MUERTA** | 1 failed / 17 passed (guardia de superficie) |

### 5.1 M7 sobrevivió, y de ahí sale un caso nuevo

Mapear `sin_rango` a «El filtro no es valido» dentro de `mensajeDe` dejaba los 27 casos **en
verde**. El motivo: hoy `esInvitacion` gana el reparto y la tabla —con su mensaje de error dentro—
ni siquiera se monta, así que el texto equivocado quedaría escrito y **latente**. El día que
alguien reordene el render para que el error preceda a la invitación, la pantalla acusaría al
usuario de una equivocación que no cometió.

Se añadió un caso anclado en la **función** —que es donde vive la decisión— y no en el DOM, que hoy
no puede distinguir las dos ramas, con su contraste (`forbidden` y `validation_error` **sí** tienen
texto) para que no pase por «esta función devuelve `null` a todo». Re-medido con la mutación puesta:
**1 failed / 27 passed. MUERTA.** Commit `d3eeadba`.

### 5.2 M12 se rehízo, porque la primera versión medía otra cosa

La primera versión dejaba el JSX **desbalanceado**, y `vitest` reportaba «no tests»: el archivo ni
siquiera se transformaba. Eso es un rojo, pero no el rojo que se quería — habría estado igual de
rojo con una aserción borrada. Se rehízo moviendo la sección fuera del proveedor **con el JSX
balanceado** (envolviendo en un fragmento), y entonces el rojo lo produce la aserción de R31:
`el componente está entre la apertura y el cierre del proveedor de filtro`.

---

## 6 — Verificación

### 6.1 Comandos sueltos (los del subagente, no el gate)

```
pnpm exec tsc --noEmit                          → verde (sin salida)
pnpm exec eslint <los 6 archivos tocados>       → verde
pnpm exec vitest run tests/components/CohorteCargaTabla.test.tsx     → 28 passed
pnpm exec vitest run tests/unit/analytics/cohorte-frontera.guardia…  → 12 passed
pnpm exec vitest run tests/components/AnaliticaPage.test.tsx         → 47 passed | 17 skipped
pnpm exec vitest run guard                       → 205 archivos, 3.058 passed
```

⚠ **`vitest run guard` encontró TRES rojos que eran míos**, y los tres se arreglaron antes de
commitear. Se dejan escritos porque ninguno era obvio:

1. `catalogo-produccion.guardia` — mi objeto de textos tenía una clave `universo`, y ese censo
   busca en todo `app/` quién **lee** `DefinicionMetrica.universo`. El detector no puede distinguir
   un campo del catálogo de una clave homónima. Renombrada a `cargadasDelPeriodo`.
2. `modulo-puro.guardia` — afirma que en `tests/unit/analytics` hay **un solo** guardia de pureza, y
   lo detecta buscando tres identificadores suyos en el **texto crudo** de los demás archivos. Mi
   guardia usaba uno de ellos como nombre de constante… y luego, al renombrarla, **seguía rojo**
   porque el comentario que explicaba el renombre los nombraba a los tres. Ahora no aparecen ni en
   prosa. No se relajó aquel guardia: se movió éste.
3. `cobertura-tablas.guardia` — toda `<DataTable>` nueva o declara descarga o figura como exclusión
   con motivo. Se vio ROJA primero («hay tablas sin registrar:
   `…CohorteCargaTabla.tsx #1`») **antes** de tocar los totales, que es la convención escrita en ese
   propio archivo.

### 6.2 El gate: `--rapido` se niega solo, y está medido

`progress/gate_411_frontend_rapido.log`, con el `INIT_EXIT` **dentro** del log:

```
== Arnes SDD :: init (modo: rapido) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (408 fichas), cupo por zona respetado (in_progress=2) y specs en su sitio
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    lib/types/cohorte-carga.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

**Mi diff propio NO toca `lib/types/**`** —sólo `app/`, `lib/actions/` y `tests/`—, pero el gate
clasifica contra `git merge-base origin/dev HEAD`, o sea contra la rama ENTERA: el DTO que trajo el
backend está ahí dentro. Es lo correcto para el PR de la ficha, que lleva las dos mitades. Así que
el gate de esta tanda es el **COMPLETO**, igual que anunciaba `tasks.md`.

### 6.3 Gate COMPLETO

`progress/gate_411_frontend.log`, con el `INIT_EXIT` **dentro** del log y **sin canalizar por
`tail`** (canalizar un proceso largo trunca el fichero en origen y el rojo se queda sin nombre).

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (408 fichas), cupo por zona respetado (in_progress=2) y specs en su sitio
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 155 archivos de tests contra Postgres SI se ejecutan
...
 Test Files  5 failed | 1871 passed (1876)
      Tests  7 failed | 27251 passed | 26 skipped (27284)
   Duration  707.47s

ROJOS NUEVOS (5 archivo(s) que no estan en el baseline):
  - tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts
  - tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts
  - tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts
  - tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts
  - tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts
✗ hay rojos NUEVOS respecto del baseline (el detalle esta justo arriba)
INIT_EXIT=1
```

#### Los `integration/db` SÍ corrieron — la cifra, no la suposición

Me copié el `.env` del checkout principal **tras comprobar que su `DATABASE_URL` activa apunta a
`localhost:5432/ordenex`** (la de Supabase es la línea 29 y está comentada; se leyó con `grep`
enmascarando la credencial, sin volcar el archivo). `prisma migrate status` confirmó
`Database schema is up to date!` contra `localhost:5432`. Contado sobre `.vitest/rojos.json`:

| | |
| --- | --- |
| archivos de `tests/integration/db` en el reporte | **240** |
| con al menos un caso EJECUTADO | **240** |
| enteramente saltados | **0** |
| casos | 2.793 (2.786 verdes, **0 saltados**, 7 rojos) |

Los 26 `skipped` de la corrida entera son de otros sitios, no de la capa de datos.

#### Los 15 archivos de la ficha, todos verdes

```
CohorteCargaTabla.test.tsx            28/28      cohorte-carga-action.test.ts       20/20
cohorte-frontera.guardia.test.ts      12/12      cohorte-carga-servicio.test.ts     21/21
cohorte-carga-alcance.int.test.ts       5/5      cohorte-carga-sql.test.ts          10/10
cohorte-carga-desenlaces.int.test.ts    5/5      cohorte-consulta-unica.test.ts       8/8
cohorte-carga-equivalencia.int.test.ts  3/3      cohorte-terminales.guardia.test.ts   8/8
cohorte-carga-fechas.int.test.ts        4/4      cohorte-carga-indices.int.test.ts    6/6
cohorte-carga-reloj.int.test.ts         4/4      cohorte-carga-ultima-terminal…      2/2
cohorte-carga-ventana.int.test.ts       2/2      AnaliticaPage.test.tsx            47/64 (17 `describe.skip` previos)
```

#### Los 5 rojos NO son míos, y está MEDIDO — no supuesto

Son **cinco**, no los dos que anticipaba el encargo: se han sumado
`webhook-suscripcion`, `dia-reparto-corregido` y `postulacion-recurso`. **La causa es la misma en
los cinco** y no cambia el veredicto: la base local **compartida** tiene dos valores de más en cada
uno de los dos enums de notificaciones.

```
AssertionError: expected [ 'orden_rechazada', …(12) ] to deeply equal [ 'orden_rechazada', …(10) ]
+   "novedades_sin_gestionar",
+   "devoluciones_represadas",
```

Las cinco medidas que lo cierran:

1. **La migración que los mete está aplicada en la BASE y no existe en ninguna rama.** Consultado
   `_prisma_migrations` contra `db/migrations/`: **190 aplicadas, 189 en disco**, y la única
   aplicada que no está en el árbol es `20260911120000_notificacion_evento_avisos_agregados`. Los
   valores vivos, leídos de `pg_enum`: `notificacion_evento` tiene **13** (los 11 del árbol +
   `novedades_sin_gestionar` + `devoluciones_represadas`) y `notificacion_entidad_tipo` **11**
   (los 9 + `novedades_sin_gestionar_dia` + `devoluciones_represadas_dia`).
2. **Ni esa migración ni esos valores están en `origin/dev`.** Es de otro agente, trabajando otra
   ficha contra la misma base local.
3. **Mi diff no toca `db/`.** Los ocho archivos de `git diff --name-only 7513b4a6..HEAD` son
   `app/(app)/analitica/**` (2), `lib/actions/cohorte-carga.ts` y cinco de `tests/`. Ni una
   migración, ni `db/schema.prisma`, ni un enum.
4. **Esos cinco archivos no importan nada mío**: sólo `vitest`, `fs`, `path`, `node:crypto`,
   `@prisma/client`, `./_postgres-real`, `NotificacionRepository` y `lib/notificaciones/emitir`.
5. **Corridos AISLADOS fallan igual** (`5 failed | 7 failed / 91 passed`, **1,45 s**): no es un
   flake de saturación, que es lo primero que el propio gate manda descartar. Y **no hay ni un
   `40P01`** en las 12.765 líneas del log: no es contención entre worktrees.

**NO se añaden a `tests/baseline-rojos.json`, y es deliberado.** Esa lista es para deuda del repo,
medida y fechada; esto es el estado transitorio de una base local compartida entre worktrees.
Meterlos ahí enmascararía una regresión de verdad el día que llegue y le mentiría a `dev`. La
decisión sobre la corrida es del leader; la evidencia está arriba.

---

## 7 — Lo que queda abierto

### T8.2 — «Ver la app» NO se hizo, y es lo único de B7 que falta

La tarea pide entrar como maestro, `adminTienda` y `adminSatelite`, dejar la barra sin rango,
poner una semana, poner un mensajero y mirar a 390 px. **No se pudo hacer desde aquí**: esta
sesión no tiene herramientas de navegador, y levantar un segundo `dev server` está desaconsejado
en este repo (comparten `.next` y se tumban aunque el puerto sea otro).

**Por qué importa que quede dicho y no dado por hecho:** la suite no ve un texto roto, una tabla
que se sale de la pantalla ni una cohorte que diga «1 órdenes cerradas». Lo que sí está cubierto
por test, y por eso el riesgo es menor de lo que suele:

- la concordancia del singular tiene su caso («1 día (1 orden cerrada)»);
- los siete rótulos de cabecera están afirmados a mano, con sus tildes;
- las siete columnas declaran `minWidth`, así que a 390 px la tabla desborda y aparece el scroll
  horizontal de `DataTable` **en vez de estrujar las celdas** — y la sección declara
  `overflow-visible`, que es la corrección medida en la ficha 348 para que la flecha de scroll
  acompañe la ventana en lugar de viajar con la tabla.

Lo que NADIE ha visto todavía: la tabla con datos reales en un navegador real.

### Dos cosas menores, dichas para que no se descubran a mano

1. **El `.env` se copió al worktree** (está en `.gitignore`, no viaja en ningún commit).
   `init.sh` recomienda exportar `DATABASE_URL` en vez de copiar el archivo; se copió porque el
   encargo lo pedía explícitamente y tras comprobar que la línea activa es `localhost`. Si se
   prefiere lo otro, es cambiar un paso del arranque del worktree, no del código.
2. **El worktree no traía `node_modules`** y no se pudo enlazar por junction desde esta sesión, así
   que se hizo `pnpm install --frozen-lockfile` + `prisma generate` propios. Efecto lateral bueno:
   el cliente de Prisma de este worktree no se pisa con el de los demás.

### Lo que NO queda abierto

- **No se encontró ningún defecto en el backend.** Se leyó su bitácora entera y se consumió la
  acción tal cual la dejó; no se tocó ni un archivo suyo.
- **R37 no aplica**: no hubo migración (la decidió B6 con los números delante).
- Los 33 requisitos que no son míos (R1–R30, R36–R38) siguen cubiertos por los tests del backend,
  que corrieron enteros en este mismo gate — los 15 archivos de la ficha están arriba, todos
  verdes.
