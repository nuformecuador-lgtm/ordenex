# 335 — Tasks

Convención: `[P]` = paralelizable con las demás `[P]` del mismo bloque.
Cada task lleva su criterio de **hecho**, y el criterio es un **assert ejecutable**, nunca
un `grep` sobre un comentario.

**Bloqueante previo:** las cinco preguntas de «Preguntas abiertas» de `requirements.md`
deben estar ratificadas por el humano. T1 codifica A1, A2 y A3; T5 codifica A5; T2 y T4
codifican A4. Empezar antes es escribir el códec dos veces.

---

## Bloque 0 — Preparación

### [x] T0.1 Verificar el punto de partida
Confirmar que `components/shared/BuscadorFiltros.tsx` y `components/shared/FilterComponent.tsx`
siguen idénticos a `origin/dev` (la 326 está `in_progress` en la misma zona) y medir el
baseline de tests **antes** de tocar nada.
**Hecho:** el baseline de rojos preexistentes queda anotado en `progress/impl_335.md`.
**Depende de:** —

---

## Bloque 1 — El códec puro (sin React)

### [x] T1.1 Crear `lib/utils/filtros-url.ts`
Interfaz `LectorParams`, constantes `PARAM_TERMINO_DEFAULT` y `SEPARADOR_VALORES`, y las
funciones `valoresDeParam`, `valoresValidos`, `seleccionDesdeUrl`, `activosDesdeUrl`,
`terminoDesdeUrl`, `queryTrasLimpiar` (design §2). Sin importar React ni `next/*`.
**Hecho:** el archivo compila con `pnpm typecheck` y no importa nada de `react` ni de
`next` (assert en el test de T1.2, no una inspección visual).
**Depende de:** T0.1

### [x] T1.2 [P] Tests del formato de valores — R4, R8, R9
`tests/unit/utils/filtros-url.test.ts`: coma simple, coma con espacios, partes vacías
descartadas, param repetido concatenado en orden, param ausente → `[]`, y que el nombre
del param es exactamente `FilterDef.key` sin transformación.
**Hecho:** los seis casos en verde.
**Depende de:** T1.1

### [x] T1.3 [P] Tests de validación por `kind` — R10-R14, R16
Mismo archivo o `filtros-url-kinds.test.ts`: `multi` descarta lo que no está en
`options`; `single` toma el primer válido; `boolean` solo acepta `"true"`; `text` respeta
`minChars`; `dateRange` acepta atajo válido, acepta rango `YYYY-MM-DD`, rechaza fecha mal
formada, rechaza atajo inexistente, rechaza rango invertido; `kind` no soportado se
descarta; y un filtro sin ningún valor válido **no aparece** en la selección.
**Hecho:** los once casos en verde.
**Depende de:** T1.1

### [x] T1.4 [P] Tests del borrado — R15, R19, R20, R21
`queryTrasLimpiar` quita el término y las claves propias, **conserva** `cierre=abc` y
cualquier otro ajeno con su valor y su orden, y devuelve `""` cuando no queda nada.
**Hecho:** los cuatro casos en verde, incluido uno que reproduce literalmente la URL de
`cierres-admin` (`?cierre=<id>&mensajero=<id>`).
**Depende de:** T1.1

---

## Bloque 2 — El hook

### [x] T2.1 Crear `hooks/useFiltrosUrl.ts`
Envuelve `useSearchParams`/`useRouter`/`usePathname`; devuelve `{ params, borrarParams }`;
`params` vacío cuando `activo === false` o cuando `useSearchParams()` devuelve `null`;
`borrarParams` hace `router.replace(..., { scroll: false })` reconstruyendo la query.
**Hecho:** `pnpm typecheck` y `pnpm lint` en verde sobre el archivo; en particular, cero
avisos de la regla que prohíbe `setState` en efecto (R25).
**Depende de:** T1.1

### [x] T2.2 Tests del hook — R21, R22, R24
`tests/unit/hooks/filtros-url-hook.test.tsx` con `next/navigation` simulado: sin fuente de
params no lanza y se comporta como URL vacía; `borrarParams` llama a `replace` con
`{ scroll: false }`; sin params restantes, la ruta va sin `?`.
**Hecho:** los tres casos en verde y el espía sobre `replace` afirma el argumento exacto.
**Depende de:** T2.1

---

## Bloque 3 — `BuscadorFiltros`

### [x] T3.1 Props `leerDeUrl` y `terminoKey` + siembra del término — R1, R6, R7, R23
Inicializador perezoso del `useState` del texto e inicialización de `emitido.current`.
**Hecho:** test de render — con `?q=guia123` el campo aparece con `guia123`; sin params el
campo aparece vacío; con `leerDeUrl={false}` y `?q=…` el campo aparece vacío; cambiar los
params después del montaje **no** cambia el campo.
**Depende de:** T2.1

### [x] T3.2 Activación de claves y emisión inicial — R2, R5
Efecto de montaje con guarda de una sola pasada: `onActivosChange(activosDesdeUrl(...))`
y `onChange(termino)`.
**Hecho:** test de render — con `?mensajero_id=A` y ese filtro ofrecido, `onActivosChange`
recibe `["mensajero_id"]` **una sola vez**; con `?q=abc`, `onChange` recibe `"abc"` una
sola vez; sin params, ninguno de los dos se llama; el orden de las claves activadas es el
de la lista ofrecida, no el de la URL.
**Depende de:** T3.1, T1.1

### [x] T3.3 «Limpiar todo» borra los params propios — R18, R19, R20
`limpiarTodo()` llama a `borrarParams([terminoKey, ...claves ofrecidas])`.
**Hecho:** test de render — teclear, marcar y pedir filtros **no** produce ninguna llamada
a `replace` (R18); pulsar «Limpiar todo» produce exactamente una, con la URL resultante
sin `q` ni claves de filtro y **con** `cierre=abc` intacto.
**Depende de:** T3.1, T2.1

---

## Bloque 4 — `FilterComponent`

### [x] T4.1 Prop `leerDeUrl` + siembra inicial de la selección — R3, R6, R23
Inicializador perezoso de `seleccion` con `seleccionDesdeUrl(params, montados)`.
**Hecho:** test de render — con `?zona=A,B` y el filtro `zona` declarado, el control
aparece con A y B marcados y `onChange` recibe `{ zona: ["A","B"] }`; sin params recibe
`{}`; con `leerDeUrl={false}` recibe `{}` pese a los params.
**Depende de:** T1.1

### [x] T4.2 Siembra por clave, una sola vez, y cierre tras el primer gesto — R7, R16
Set de claves ya sembradas en `useRef`; siembra de claves nuevas al crecer `filters`;
cierre definitivo tras el primer cambio del usuario.
**Hecho:** test de render — declarar `zona` después del montaje siembra su valor de la
URL; **quitar** ese valor a mano y volver a declarar el filtro **no** lo resucita; un
filtro cuyo valor de URL es inválido no aparece en la selección ni monta valor.
**Depende de:** T4.1

### [x] T4.3 La precarga sobrevive a la poda — R17
**Hecho:** test de render que monta con `?zona=A` y afirma que, tras el ciclo completo de
efectos (incluido el de poda de las líneas 387-398), `onChange` NO ha recibido una
emisión posterior que borre `zona`.
**Depende de:** T4.2

---

## Bloque 5 — Integración con los consumidores (sin editar `app/`)

### [x] T5.1 Prueba de herencia sobre un consumidor real
Test de render de una pantalla que ya monta los dos canónicos (candidata:
`NovedadesFiltrosBarra`, que es puro presentación y su estado vive en un hook aparte)
entrando con params en la URL.
**Hecho:** el control se monta y el listado queda acotado **sin haber tocado ningún
archivo bajo `app/`**; el diff de la ficha lo confirma.
**Depende de:** T3.2, T4.1

### [x] T5.2 Guardia de no-escritura — R18
Test que recorre un ciclo de uso completo (teclear, abrir el selector, marcar dos
opciones, retirar un filtro) y afirma **cero** llamadas a `router.replace`/`push`.
**Hecho:** el assert de conteo a cero está en verde y falla si alguien añade una escritura
de URL al filtrar.
**Depende de:** T3.3

---

## Bloque 6 — Cierre

### [x] T6.1 Riesgo de `Suspense` / prerender (design §4)
Correr `pnpm exec next build` (**nunca** `pnpm build`: encadena `migrate deploy` contra
una base real) y revisar que ninguna ruta se queje por `useSearchParams`.
**Hecho:** el build termina sin errores; si alguna ruta protesta, queda anotada en
`progress/impl_335.md` con su salida (`leerDeUrl={false}` o `Suspense` local).
**Depende de:** T3.3, T4.3

### T6.2 Mapa de trazabilidad R→test
Escribir en `progress/impl_335.md` la tabla completa R1..R25 → archivo::nombre del test.
**Hecho:** los 25 requisitos tienen un test nombrado; ninguno dice «cubierto
indirectamente».
**Depende de:** todo el bloque 1-5

### T6.3 Gate
`./init.sh --rapido`.
**Hecho:** verde, y el delta de rojos contra el baseline de T0.1 es **0**.
**Depende de:** T6.2
