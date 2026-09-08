# Ficha 379 — bitácora de implementación (FRONTEND)

**Alcance de esta bitácora:** la MITAD DE PANTALLA. **T9** (`UsuarioForm.cambioPendiente`),
**T11** (`UsuariosModule`: el diálogo y los dos puntos de llamada) y **T13** (verlo funcionando
en la app). La mitad de servidor entró antes por el PR #736 y su bitácora es
`progress/impl_379.md`; aquí no se ha tocado ningún servicio, repositorio, tipo ni schema.

**Migración: NO.** Esta ficha no lleva ninguna y no se ha tocado la base con ninguna migración.
Lo único que se escribió en la base LOCAL fue el atrezzo de T13, y está detallado abajo con lo
que quedó y lo que se borró.

**Nada bloquea al maestro (R14).** Es la decisión del humano del 2026-09-08 —«no, no quiero
daños»— y la pantalla la respeta por los tres caminos: con impacto se avisa y se puede
continuar; sin impacto no aparece nada; y si la consulta previa falla, se dice y también se
puede continuar. No hay una sola rama en la que el maestro se quede sin poder hacer el cambio
que pidió.

---

## Lo que entró

### T9 — `UsuarioForm` expone el cambio pendiente

`UsuarioFormHandle` gana `cambioPendiente(): CambioUsuarioEvaluable | null`. Devuelve el
`{ rolId, zonaId }` que el formulario está a punto de enviar, **sacado del mismo `validate()`
que arma el payload del submit**, no de una segunda lectura del estado. Para no necesitar un
cast, `validate()` devuelve además `edicion` —**el mismo objeto** que `input`, ya tipado— solo
en la rama de edición: así lo evaluado y lo enviado son literalmente el mismo valor, y no dos
lecturas equivalentes que se separan a la primera. Eso es justo el defecto que esta ficha vino
a cerrar (la zona y el vehículo, campos hermanos con dos reglas).

`null` en modo crear (el usuario todavía no existe: no puede dejar ninguna zona sin nadie) y
cuando la validación de cliente falla (se pintan los errores de campo, igual que hace `submit`,
y no hay cambio que evaluar porque tampoco lo va a haber que aplicar).

### T11 — `UsuariosModule` pregunta antes de escribir

Un solo embudo, `evaluarYAplicar(id, cambio, zonaNombreFila, aplicar)`, por el que pasan las dos
puertas de la pantalla:

- **guardar la edición** → `cambioPendiente()` → consulta → ¿impacto? sí: aviso; no: guardar.
- **activar/inactivar la fila** → consulta con `{ estado: destino }` → igual.

Se pregunta **siempre** y decide el servidor (AS5). Sus tres salidas:

| salida | qué hace la pantalla | R |
| --- | --- | --- |
| `ok` + `impacto: null` | aplica directo, **sin diálogo**: los mismos clics de hoy | R15 |
| `ok` + impacto | abre el aviso con la zona, el número de cierres y el importe | R10 |
| error del borde **o la llamada revienta** | abre el aviso diciendo que no se pudo comprobar, y deja continuar | R20 |

El diálogo es el `Modal` compartido, con el texto en `description` para que cuelgue de
`aria-describedby` (medido en la app: `base-ui-_r_2_`); botones `Continuar` / `Cancelar`, y el
de confirmar **no** es `destructive`: no se destruye nada, se avisa. Confirmar ejecuta la acción
diferida (R12); cancelar/Escape/clic fuera la tiran con el estado (R13).

La anotación **`@sin-superficie` de `consultarImpactoCambioUsuario` se BORRÓ**: caducó en cuanto
la pantalla la llamó, y la guardia de superficie de uso lo exige. Verificado en el gate:
`superficie-de-uso.guardia.test.ts` (18 tests) verde con la anotación fuera.

### T13 — visto en la app, no solo en jsdom

Ver más abajo, con el texto exacto que salió en pantalla.

---

## Archivos

### Creados
- `tests/unit/components/usuarios-aviso-zona.test.tsx` — R9/R10/R11/R12/R13/R15/R19/R20/R21/R23.

### Modificados — producción
- `app/(app)/configuracion/_components/UsuarioForm.tsx` — `cambioPendiente()` en el handle y el
  campo `edicion` de `validate()`.
- `app/(app)/configuracion/_components/UsuariosModule.tsx` — estado del aviso, `evaluarYAplicar`,
  `confirmarAviso`, `guardarFormulario`/`aplicarCambioEstado` extraídos, el `Modal` del aviso y
  las tres funciones puras del texto (`tituloAvisoZona`, `textoAvisoZona`, `cierresAprobados`).
- `lib/actions/usuarios.ts` — **solo** se retira la anotación `@sin-superficie` caducada y se
  deja escrito por qué. Ni una línea de comportamiento.

### Modificados — tests
- `tests/unit/components/usuario-form.test.tsx` — los cuatro casos de T9.
- `tests/unit/components/usuarios-module.test.tsx` — el doble de la consulta previa (el fixture
  es un `mensajero`: `impacto: null`, sin diálogo).
- `tests/unit/components/usuarios-restablecer.test.tsx` — el mismo doble; sin él el módulo no se
  puede montar.
- `tests/components/descarga/ConfiguracionDescarga.test.tsx` y
  `tests/components/descarga/ControlDescargaTransversal.test.tsx` — el mismo doble, por la misma
  razón: montan `UsuariosModule`.

---

## Las tres decisiones que tomé YO, y no el humano

**D1 — El copy de los roles sale de `ROL_LABELS`, también para `maestro` y `admin`.**
`design.md` §4.6 escribía «ni el maestro ni un **admin** pueden hacerlo desde otra zona».
`admin` **es** el valor del enum `RolValue`, y R23 prohíbe el identificador técnico. Medido en
el árbol: las dos únicas frases de cara al usuario que mencionan ese rol dicen «un
administrador» (`ExportarVistaFinanciera.tsx:92`, `cierre-confirmacion-fisica.tsx:66`); todos
los «el maestro» que hay en `app/` están en comentarios. La frase queda **«ni el Maestro ni un
Administrador pueden hacerlo desde otra zona»**, con los tres roles tomados de `ROL_LABELS`.
**Vuelta atrás:** escribir los literales en las tres constantes. Coste: tres líneas y tres
mutaciones que se ponen rojas.

**D2 — El título de la rama R20 no afirma lo que no se sabe.**
`design.md` §4.6 da un solo título («La zona X se queda sin Admin satélite»). Cuando la consulta
falla, la pantalla **no sabe** si la zona se queda sin nadie, así que ese título sería una
afirmación inventada. En esa rama el título es **«No se pudo comprobar el impacto de este
cambio»**. **Vuelta atrás:** reusar el mismo título, a costa de afirmar el dato que falta.

**D3 — En la rama R20 la zona se nombra con lo que la FILA pinta, no con el servidor.**
El cuerpo del §4.6 para R20 lleva `<Zona>`, pero cuando la consulta falla el servidor no llega a
decir cuál es. La fila del listado sí trae `zonaNombre`, y en la puerta del formulario se guarda
al abrir el editor (`UsuarioPublico` trae `zonaId` pero no el nombre). Si la fila no tiene zona,
el texto dice «la zona de este usuario». Las dos fuentes **no pueden contradecirse**: son ramas
excluyentes —con impacto manda siempre el nombre del servidor—. **Vuelta atrás:** no nombrar la
zona en esa rama.

---

## Mapa R → test

Solo la mitad de pantalla; R1-R8 y R16-R18 los cubre `progress/impl_379.md` y aquí no se han
tocado.

| R | Test | Estado |
| --- | --- | --- |
| R9 | `unit/components/usuarios-aviso-zona.test.tsx` «R9/R21: inactivar consulta el impacto antes…» y «…guardar la edición consulta el impacto antes…» (**aserción de ORDEN** con `invocationCallOrder`, en las DOS puertas) | ✅ |
| R10 | mismo archivo: la zona, «4 cierres aprobados sin consolidar», el importe formateado, la razón, el singular, la rama de cero (AS1) y el `aria-describedby` — 5 casos | ✅ |
| R11 | mismo archivo: «abrir el aviso … no llama a `cambiarEstadoUsuario`» y su gemelo del formulario con `actualizarUsuario` | ✅ |
| R12 | mismo archivo: los argumentos de la escritura son **los mismos** con aviso y sin aviso (se corre el flujo dos veces y se comparan), y el payload del formulario tras confirmar | ✅ |
| R13 | mismo archivo: Cancelar y Escape → el diálogo se cierra, **cero** escrituras, y el botón de la fila vuelve a estar disponible | ✅ |
| R14 | `unit/guards/379-maestro-sin-bloqueo.guardia.test.ts` (backend, ya existía) + aquí: **ninguna rama de la pantalla impide nada**, y el caso «R20/R14: confirmar tras el fallo APLICA el cambio» lo afirma por el camino más peligroso | ✅ |
| R15 | `usuarios-aviso-zona`: con `impacto: null` el cambio de estado y la edición se aplican **sin diálogo**; y `usuarios-module.test.tsx` entero corre con ese doble (los mismos clics de hoy) | ✅ |
| R19 | `usuarios-aviso-zona`: el importe se pinta `₡9.999.999.999,99` desde el STRING —diez dígitos y céntimos— con `formatMontoString`; **y visto en la app** con dinero real (`₡1.236.567,99`) | ✅ |
| R20 | `usuarios-aviso-zona`: 3 casos — rama de error del borde (`unauthenticated`), confirmar tras el fallo aplica el cambio (`not_found`), y la llamada que **revienta** también abre el aviso | ✅ |
| R21 | `usuarios-aviso-zona`: las dos aserciones de orden de R9, que son la forma testeable de «no aplicar sin haber evaluado» | ✅ |
| R23 | `usuarios-aviso-zona`: dice «Admin satélite», «Maestro» y «Administrador», y **no** contiene `adminSatelite`, ni `\badmin\b`, ni `\bmaestro\b` | ✅ |
| T9 | `unit/components/usuario-form.test.tsx`: 4 casos, cada uno con el literal **y** la cruz contra el payload real que sale hacia `actualizarUsuario` | ✅ |

**R22 no se toca aquí**: es del servidor (guard de rol y ausencia de PII) y está cubierto en
`progress/impl_379.md`. La pantalla no puede debilitarlo: solo pinta lo que le devuelven.

---

## Mutaciones — 16 aplicadas, 16 rojas

El arnés **aborta** la mutación si el texto no aparece exactamente una vez, restaura el archivo
en un `finally` y lo **relee** para comprobar que quedó byte a byte igual (si no, se detiene
entero). Y antes de medir nada corre **sin mutar** y exige verde: esa autocomprobación ya sirvió
—la primera vuelta salió `vitest_ejecuto=False` por un `--silent` mal pasado, y el arnés se negó
a reportar 13 supervivientes—.

Autocomprobación de la tanda grande: `exit=0`, `Test Files 3 passed`, `Tests 69 passed`.

| # | Mutación (sobre el árbol real) | Rojo en |
| --- | --- | --- |
| M1 | aplicar el cambio **antes** de abrir el diálogo | R11 (6 casos) |
| M2 | entrar en la rama de aplicar aunque haya impacto | R10/R11/R12 (13 casos) |
| M3 | tragarse el fallo de la consulta y aplicar | R20 (3 casos) |
| M4 | abrir el diálogo siempre (`if (false)`) | R15 (5 casos, incluido `usuarios-module`) |
| M5 | `ETIQUETA_ADMIN_SATELITE` como literal `"adminSatelite"` | R23 |
| M6 | pintar el importe sin `formatMontoString` | R10/R19 (2 casos) |
| M7 | confirmar cierra el diálogo pero **no** aplica | R12 (6 casos) |
| M8 | descartar (Escape/Cancelar) aplica igual | R13 (2 casos) |
| M9 | en la fila, escribir **antes** de consultar | R9/R21 (5 casos) |
| M10 | en el formulario, no consultar nunca | R9/R21 (3 casos) |
| M11 | el texto va al cuerpo en vez de a `description` | el `aria-describedby` |
| M12 | `cambioPendiente()` devuelve `{rolId}` sin `zonaId` | T9 + R9/R21 del formulario |
| M13 | `cambioPendiente()` lee el estado del formulario en vez del payload | T9 (el caso del rol sin zona) |
| M14 | `ETIQUETA_ADMIN` como literal `"admin"` | R23 (2 casos) |
| M15 | `ETIQUETA_MAESTRO` como literal `"maestro"` | R23 (2 casos) |

*(M14/M15 se midieron aparte, después del cambio de copy de D1, con el mismo arnés y la misma
autocomprobación: `exit=0` sin mutar, las dos rojas, restauración comprobada por relectura.)*

---

## T13 — lo que se VIO en la app (no lo que se esperaba)

Dev server propio en el worktree (`--port 3379`, `.next` propio; el de otro agente en el 3000 no
se tocó), maestro dedicado y Chromium conducido con Playwright. **Los textos de abajo son el
`innerText` real del diálogo**, copiado tal cual.

**(a) Inactivar al único Admin satélite de Quepos → sale el aviso.** Cancelar lo cierra y la
fila sigue «Activo | Quepos». Segunda vuelta, ya con dinero pendiente sembrado, y esta vez
**confirmando**:

```
La zona Quepos se queda sin Admin satélite
Es el único Admin satélite activo de la zona Quepos. Si continúas, esa zona se queda sin nadie
que pueda consolidar sus cierres: ni el Maestro ni un Administrador pueden hacerlo desde otra
zona. Ahora mismo hay 2 cierres aprobados sin consolidar, por ₡1.236.567,99.
Cancelar   Continuar
```

Tras «Continuar»: aviso de éxito «Usuario inactivado» y la fila pasa a «Inactivo». El diálogo
llevaba `aria-describedby="base-ui-_r_2_"`. El importe es la suma exacta de los dos cierres
sembrados (`1234567.89 + 2000.10 = 1236567.99`), con separador de miles y coma decimal.

**(b) Cambiar el rol** y **(c) cambiar la zona** desde el formulario: el mismo diálogo, palabra
por palabra, encima del editor (que se queda abierto detrás, para que cancelar no se lleve por
delante lo que el maestro estaba editando).

**Sin cierres pendientes** —el estado normal de la base local— el mismo diálogo dice la frase de
cero, que es AS1 funcionando: *«Ahora mismo no hay cierres pendientes, pero los que entren
después quedarán retenidos hasta que la zona vuelva a tener un Admin satélite.»*

**(d) La zona con DOS Admin satélite: no aparece nada.** Se creó un segundo Admin satélite en
Quepos **desde la pantalla** (el alta no preguntó nada, que es lo correcto: crear no puede dejar
a nadie sin nadie) y después:

| acción | ¿aviso? | resultado |
| --- | --- | --- |
| inactivar al primero, con el segundo activo | **no** | fila → «Inactivo» directamente |
| volver a activarlo | **no** | fila → «Activo» (activar nunca avisa) |
| inactivar al segundo, con el primero activo | **no** | fila → «Inactivo» |

**Con los ojos:** acentos correctos («satélite», «continúas», «después», «Limón»), el singular
resuelto («1 cierre aprobado» en jsdom; «2 cierres aprobados» en pantalla), el importe con su
símbolo `₡`, y **ni una sigla ni un identificador de enum** en el diálogo.

### Un hallazgo que NO es de esta ficha, y no se tocó

El **select de Rol del formulario de usuario pinta los valores crudos del enum**:
`["maestro","admin","mensajero","adminTienda","adminSatelite"]`. Sale de `UsuarioForm.tsx:133`
(`label: r.value`) y es **anterior a esta ficha** —viene de la feature 24/29—; R23 habla del
aviso, y el aviso sí usa `ROL_LABELS`. Se anota porque es exactamente la clase de texto que
`ver-la-app` encuentra y la suite no, pero arreglarlo es otra ficha: cambia una pantalla que
esta tanda no tiene encargo de tocar.

### Lo que la base LOCAL tiene de más, y por qué

Todo lo escrito para T13 se hizo contra la base **local** (`localhost:5432/ordenex`), nunca
contra producción ni preview.

- **Borrado, y comprobado:** los dos `cierre_dia` de atrezzo (`id` con prefijo `T13-379-`,
  destino bodega satélite de Quepos, aprobados y sin consolidar). Se sembraron dos veces y se
  borraron las dos; la última comprobación devuelve `quedan: []` y el recuento global vuelve a
  ser el de antes (6 cierres, todos `bodega_central`).
- **Queda:** `maestro.379f@ordenex.test` (maestro activo, creado con `db:seed:maestro` **con un
  email nuevo** para no rotarle la contraseña a ningún maestro que otro agente estuviera usando)
  y `satelite2.379@ordenex.test` (Admin satélite de Quepos, **inactivo**). Los dos son
  inofensivos —el segundo no cuenta en ningún recuento de «activos»— y se pueden borrar cuando
  se quiera; se dejan porque borrarlos arrastra historial y sesiones que sí tienen FK.

---

## Verificación

Salidas reales sobre el árbol final.

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 161 problems (0 errors, 161 warnings)
```

Las 161 advertencias son **ajenas**: ninguna línea del informe de eslint nombra ninguno de los
ocho archivos de esta tanda (comprobado grepeando el informe por los ocho nombres: cero
coincidencias).

**`./init.sh` COMPLETO** — no se midió si el rápido se habría negado con ESTE diff (no toca
`lib/types/` ni nombres de dinero); se corrió el completo porque es lo que pide cerrar la ficha.
Log propio, con `INIT_EXIT=$?` escrito **dentro** y sin canalizar por `tail`:

```
== Arnes SDD :: init (modo: completo) ==
Test Files  1781 passed (1781)
     Tests  25494 passed | 26 skipped (25520)
  Duration  628.72s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1781 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado …   ← deuda ajena, preexistente
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped` no esconden nada.** Los 26 son 17 + 9 de `AnaliticaPage.test.tsx` y
`AnaliticaShell.test.tsx`, condicionales preexistentes. **No** aparece el aviso «sin
DATABASE_URL: … archivos … NO se van a ejecutar»: se copió el `.env` de la raíz al worktree
antes de correr y **los ~78 archivos de `integration/db` se ejecutaron**. Confirmado archivo a
archivo en el log:

```
✓ tests/unit/components/usuarios-aviso-zona.test.tsx (18 tests) 5069ms
✓ tests/unit/components/usuario-form.test.tsx (29 tests) 20347ms
✓ tests/unit/components/usuarios-module.test.tsx (22 tests) 13510ms
✓ tests/unit/components/usuarios-restablecer.test.tsx (24 tests) 7150ms
✓ tests/unit/guards/superficie-de-uso.guardia.test.ts (18 tests) 81ms
✓ tests/integration/db/historial-accion-atomicidad.test.ts (22 tests) 1089ms
✓ tests/integration/db/cierre-bodega-resumen-pendientes.test.ts (6 tests) 431ms
✓ tests/integration/db/usuario-contar-adminsatelites.test.ts (2 tests) 515ms
✓ tests/unit/services/usuario-impacto-zona.test.ts (16 tests) 45ms
✓ tests/unit/guards/379-maestro-sin-bloqueo.guardia.test.ts (11 tests) 20ms
✓ tests/unit/actions/usuarios-composition.test.ts (2 tests) 511ms
```

**Ni un rojo, ni propio ni ajeno.** No hizo falta diagnosticar ningún flake: las dos corridas
completas de esta tanda (la de antes del cambio de copy y la definitiva) terminaron las dos en
`INIT_EXIT=0` con los 1781 archivos en verde. El `.env` copiado se borró al terminar.

## Veredicto

La mitad de pantalla de la 379 entera: el aviso se ve, dice el número y el importe con el
lenguaje de la casa, y **por ningún camino le impide al maestro el cambio que pidió**.
