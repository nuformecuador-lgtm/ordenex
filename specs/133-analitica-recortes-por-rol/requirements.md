# 133 — analítica: recortes por rol · requirements

> Zona `frontend`. Rama `feature/133-analitica-recortes-por-rol` (de `origin/dev` @ `35940b0d`).
> Depende de la **131** (`done`) y la **132** (`done`).

## 0. Qué es y qué NO es esta feature

Esta feature decide **qué se PINTA para cada rol** sobre las dos superficies ya entregadas
(el tablero operativo de la 131 y el financiero de la 132) y **abre la ruta `/analitica`** a
`adminTienda`, `adminSatelite` y `mensajero`.

**Es un recorte de PRESENTACIÓN. NO sustituye al recorte de DATOS.** El de datos lo garantiza
la **122** (`lib/analytics/alcance.ts`, `lib/analytics/alcance-columnas.ts`) y se aplica en el
servidor, en el borde, **antes** de tocar la base. Cita literal del aviso que la 122 dirige a
esta feature (`specs/122-analitica-alcance-por-rol/design.md:466-468`):

> **→ 133 (recortes por rol).** El recorte de **presentación** consulta `listarMetricas({ rol })`;
> el de **datos** es este. **Un panel que no se pinta no es un dato que no se filtra: no
> sustituyas uno por el otro.**

Ese aviso no es contexto: es **R20**, **R21** y **R27** de este documento, con test.

**Dentro:** el conjunto de roles con acceso a la ruta y al ítem de menú; qué regiones y qué
paneles se ofrecen a cada rol; qué facetas de filtro se ofrecen; el rótulo de alcance; el E2E
por rol que la 132 dejó heredado (`specs/132-…/requirements.md:248`).

**Fuera, con su razón:**

- **Abrir cualquier métrica financiera a un rol nuevo** — lo prohíbe D7 de la 135 y lo vigila
  `tests/unit/analytics/financiera-alcance.guardia.test.ts:35-64`. No hay tablero financiero
  para tienda ni para mensajero.
- **Tocar `lib/analytics/metrics.ts`** — el catálogo es de la 135 y su última corrección es de
  la **175** (⟨D11⟩, `progress/decision_175.md`). Esta feature no escribe una línea ahí.
- **Cerrar el oráculo residual contra R39 de la 122** — es un problema de **datos**, no de
  presentación. Ver §4.
- **Export CSV** — es la **134**.
- **Ampliar los servicios de catálogo de filtros** (`FiltrosOrdenesService`,
  `UsuariosPorRolService`) a `adminSatelite`/`mensajero` — es backend. Ver **Q4**.

---

## 1. Hechos verificados en el código (no supuestos)

Lo que sigue está leído, con archivo y línea, en el árbol de esta rama. La spec se apoya en
esto y no en memoria.

| # | Hecho | Dónde |
|---|---|---|
| H1 | El gate de la ruta es `notFound()` contra `ROLES_ACCESO_ANALITICA` = `["maestro","admin"]` | `app/(app)/analitica/page.tsx:58-66`, `lib/auth/menu-visibility.ts:78` |
| H2 | El ítem de menú "Analítica" declara `roles: ROLES_ACCESO_ANALITICA` — **la misma constante**, no una copia | `lib/auth/menu-visibility.ts:107-111` |
| H3 | Ampliar el acceso es **editar UNA constante**; tocar sólo uno de los dos sitios pone rojo R10 de la 129 | `tests/unit/auth/menu-visibility.test.ts:399-410` |
| H4 | La región financiera se ofrece **si y sólo si** `esAccesoTotal(rol)`; si no, la prop `financiero` **no se pasa** y el shell no renderiza sección alguna | `app/(app)/analitica/page.tsx:71-84`, `AnaliticaShell.tsx:80-87` |
| H5 | Ese criterio es deliberado: "una región financiera visible y vacía es peor que no tenerla" | `AnaliticaShell.tsx:38-50` |
| H6 | Los paneles operativos reales son **SEIS**: `ordenes-creadas`, `ordenes-por-estado`, `resultado-gestiones` (entregas + devoluciones + rechazos + **incidentes**), `sin-gestionar`, `tasa-entrega`, `tiempo-ciclo` | `_components/operativo/catalogo-paneles.ts:63-108` |
| H7 | Las ocho métricas financieras servidas: `cod_recaudado` (dos vistas), `ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva`, `egresos`, `cuenta_por_pagar_tienda`, `cuenta_por_pagar_mensajero`, `conciliacion_cierres` | `lib/types/analitica-financiera.ts:225-234` |
| H8 | Las 15 operativas son `acotado` para los tres roles nuevos → `listarMetricas({rol})` devuelve **las 15** para los cinco roles. **Ningún panel operativo se cae por rol** | `lib/analytics/metrics.ts:50-56, 612-624` |
| H9 | Las 8 financieras son `prohibido` para los tres → `listarMetricas({dominio:"financiera", rol})` devuelve **cero** | `lib/analytics/metrics.ts:63-69` |
| H10 | Tras la 175 ⟨D11⟩ **ninguna** métrica del catálogo es `declarada`; `incidentes` y `sin_gestionar` son `producida` | `lib/analytics/metrics.ts:226-230, 250-254` |
| H11 | La lista de paneles es **declarativa** y tiene prohibido leer `estadoProduccion` o `listarMetricas` | `catalogo-paneles.ts:1-30`, `tests/unit/analytics/tablero-catalogo-paneles.test.ts:131-142` |
| H12 | La barra de filtros ofrece cuatro facetas: Rango (+ fechas si `personalizado`), Zona, Tienda, Mensajero | `_components/operativo/FiltrosOperativos.tsx:152-203` |
| H13 | `FiltrosOrdenesService` (zonas/tiendas) autoriza sólo `maestro`/`admin`/`adminTienda` | `lib/services/FiltrosOrdenesService.ts:28,41` |
| H14 | `UsuariosPorRolService` autoriza `adminTienda`/`maestro`/`admin` → **un `adminTienda` recibe el directorio de mensajeros con nombre real y uuid** | `lib/services/UsuariosPorRolService.ts:15,24` |
| H15 | Un catálogo que responde distinto de `ok` deja su selector **deshabilitado** + nota de degradado | `FiltrosOperativos.tsx:124-136, 198-202` |
| H16 | El alcance por rol vive en `resolverAlcance` y produce `global` / `zona` / `tienda` / `mensajero`; falla cerrado y no tiene rama `default` que conceda | `lib/analytics/alcance.ts:149-226` |
| H17 | `adminTienda` + grano `mensajero` ⇒ identidad **seudónima** (`Mensajero 1..N`), **no estable entre consultas** | `specs/122-…/design.md:253-259`, R38/R39 |
| H18 | `/dashboard` redirige a `primerDestino(itemsVisibles(...))`: el **primer ítem visible del sidebar** de cada rol | `app/(app)/dashboard/page.tsx:29-35`, `menu-visibility.ts:275-279` |
| H19 | "Analítica" está en la **posición 2** de `SIDEBAR_ITEMS`, antes de "Órdenes", "Entregas" y todo lo demás | `menu-visibility.ts:101-111`, `tests/unit/auth/menu-visibility.test.ts:373-383` |
| H20 | `PanelOperativo` ya distingue CINCO estados (`forbidden`, `validation_error`, `unauthenticated`, `error`, `ok`): un denegado **no** cae en el vacío de la gráfica | `_components/operativo/PanelOperativo.tsx:12-16, 99-120` |

**Consecuencia directa de H8+H9, y es el corazón de esta feature:** el recorte de presentación
por rol **no quita ni un panel operativo**; lo que quita es la **región financiera entera** y
las **facetas de filtro** que el propio alcance del actor ya tiene fijadas.

---

## 2. Requisitos (EARS)

### Acceso a la ruta y al menú

**R1.** El sistema DEBE conceder acceso a `/analitica` exactamente a los cinco roles lectores de
analítica (`ROLES_ANALITICA`: `maestro`, `admin`, `adminSatelite`, `adminTienda`, `mensajero`) y
DEBE seguir denegándolo —con `notFound()`— a `apiKey` y a la sesión ausente o inválida.

**R2.** MIENTRAS existan las dos capas de autorización (el `roles` del ítem de menú y el gate de
la página), el sistema DEBE declarar **un solo** conjunto de roles consumido por ambas; los dos
conjuntos DEBEN ser idénticos y una divergencia DEBE poner un test en rojo.

**R3.** CUANDO el conjunto de acceso pase a coincidir con el del dominio de analítica, el sistema
DEBE **derivar** el primero del segundo (una única declaración) y el guard de no-convergencia
DEBE **reexpresarse** en el mismo PR para vigilar esa derivación. El guard **NO DEBE** eliminarse
ni relajarse (instrucción escrita en `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts:34-38`).

**R4.** SI aparece un `RolValue` nuevo en el esquema, ENTONCES el sistema **NO DEBE** concederle
acceso a `/analitica` por defecto: el conjunto es una whitelist y un rol no enumerado queda fuera.

**R5.** El sistema **NO DEBE** cambiar el destino post-login de ningún rol: el `primerDestino`
de `maestro`, `admin`, `adminTienda`, `adminSatelite` y `mensajero` DEBE seguir siendo el mismo
que antes de esta feature, aunque el ítem "Analítica" pase a ser visible para tres roles más y
ocupe la posición 2 del sidebar (H18, H19).

### La región financiera es PROHIBIDA, no vacía

**R6.** MIENTRAS el rol del actor no satisfaga `esAccesoTotal(rol)`, el sistema **NO DEBE**
renderizar la región «Tablero financiero»: ni la sección, ni su encabezado, ni un estado vacío,
ni un mensaje de permiso, ni un esqueleto de carga en su lugar.

**R7.** MIENTRAS el rol no satisfaga `esAccesoTotal(rol)`, el documento renderizado **NO DEBE**
contener ninguna etiqueta de métrica financiera, ninguna cifra de dinero, ni la palabra que
nombra la región. Un test DEBE afirmarlo sobre **todo** el cuerpo del documento, no sobre un
subárbol elegido, y con un doble de datos que SÍ traiga etiqueta y cifras reconocibles.

**R8.** MIENTRAS el rol no satisfaga `esAccesoTotal(rol)`, el sistema **NO DEBE** invocar el
cargador financiero ni una sola vez: el dinero no se consulta para quien no puede verlo.

**R9.** El sistema DEBE derivar quién ve la región financiera de `esAccesoTotal(rol)` —el mismo
criterio que ya aplica la 132 (H4)— y **NO DEBE** declarar una lista de roles nueva para ello.
Un test DEBE comprobar, para los cinco roles, la equivalencia: «se ofrece la región financiera»
⟺ `listarMetricas({ dominio: "financiera", rol }).length > 0`.

**R10.** El sistema **NO DEBE** ofrecer a un rol prohibido ninguna pestaña, enlace, botón, ancla
ni entrada de navegación que anuncie la existencia de la región financiera.

### Paneles operativos

**R11.** MIENTRAS el actor tenga acceso a la ruta, el sistema DEBE renderizar los **seis** paneles
operativos declarados (H6) para los cinco roles: ningún panel operativo se retira por rol.

**R12.** El sistema **NO DEBE** decidir qué paneles pinta leyendo `estadoProduccion`, ni en el
catálogo declarativo ni en ningún módulo nuevo de esta feature. Un test DEBE matar esa mutación
**sin afirmar ningún valor concreto** de ese campo (H10, H11).

**R13.** El sistema **NO DEBE** derivar la lista de paneles operativos de `listarMetricas()`; el
uso autorizado de esa función en esta feature es el de **R9** (dominio financiero) y el de la
comprobación de equivalencia, no la composición de la rejilla.

### Facetas de filtro

**R14.** MIENTRAS la dimensión de una faceta esté fijada por el alcance del actor, el sistema
**NO DEBE** ofrecer el selector de esa dimensión: `adminTienda` no ve el selector «Tienda`,
`adminSatelite` no ve «Zona», `mensajero` no ve «Mensajero».

**R15.** El sistema **NO DEBE** ofrecer el selector «Mensajero» a un `adminTienda`. Motivo
verificado (H14): ese catálogo le devuelve el **nombre real y el uuid** de cada mensajero, que es
exactamente lo que R38/R39 de la 122 (identidad seudónima) existen para impedir.

**R16.** SI un selector no se ofrece, ENTONCES el sistema **NO DEBE** mostrarlo deshabilitado,
vacío, ni acompañado del texto de degradado en su lugar: no ofrecer es no dibujar.

**R17.** El sistema DEBE seguir ofreciendo el selector de rango (y el par de fechas cuando el
rango sea `personalizado`) a los cinco roles con acceso.

**R18.** El sistema DEBE derivar el conjunto de facetas ofrecidas del **alcance resuelto por la
122** y **NO DEBE** declarar una segunda tabla rol → dimensión (prohibición heredada de R8 y R37
de la 122). Un test DEBE comprobar la correspondencia para los cinco roles.

**R19.** CUANDO la URL traiga el parámetro de una dimensión que no se ofrece, el sistema **NO
DEBE** romperse ni ocultar la respuesta: lo que se pinte DEBE ser exactamente lo que devuelva el
borde para esa consulta, nunca un dato ajeno ni un vacío que lo simule.

### Presentación ≠ datos (la regla que esta feature no puede confundir)

**R20.** El sistema **NO DEBE** aplicar recorte de datos en el cliente: ningún archivo de
`app/(app)/analitica/` DEBE importar `lib/analytics/alcance*`, `lib/analytics/identidad`, ni
invocar `resolverAlcance` o cualquier función de seudonimización. Un guardia que censa el árbol
DEBE hacerlo cumplir.

**R21.** El sistema DEBE poder demostrar que el recorte de presentación **no es** lo que protege
el dato: un test DEBE comprobar que, para un mismo actor y un mismo filtro, **retirar el recorte
de presentación no cambia ni un argumento de la consulta al borde ni una fila de la respuesta**.
Si ese test pasara sólo gracias a la UI, el recorte de datos no existiría.

**R22.** CUANDO el borde responda `forbidden`, el sistema **NO DEBE** presentarlo como «sin
datos»: un permiso denegado y una métrica sin actividad DEBEN ser dos estados visualmente
distintos (comportamiento ya existente, H20; esta feature DEBE conservarlo para los tres roles
nuevos).

**R23.** MIENTRAS el alcance del actor sea acotado, el sistema **NO DEBE** mostrar ninguna
etiqueta, nombre propio, identificador ni cifra correspondiente a una tienda, zona o persona
fuera de su alcance.

### Rótulo de alcance

**R24.** MIENTRAS el alcance resuelto del actor no sea global, el sistema DEBE mostrar **una**
indicación textual, única para todo el tablero, de sobre qué universo están calculadas las
cifras (su tienda / su zona / sus propias órdenes), para que un total acotado no se lea como el
total del negocio.

**R25.** Esa indicación **NO DEBE** contener ningún identificador (uuid), ni el nombre de la
tienda, la zona o la persona: es una frase sobre el alcance, no un dato.

### Identidad seudónima del mensajero

**R26.** El sistema **NO DEBE** prometer estabilidad a las etiquetas `Mensajero 1..N`: no DEBE
ofrecer guardar, fijar, marcar como favorito ni compartir un filtro expresado con esas etiquetas,
y DONDE aparezcan en una leyenda, el sistema DEBE advertir que no son estables entre consultas
(H17).

**R27.** DONDE el sistema oculte el selector «Mensajero» a un `adminTienda` (R15), esa ocultación
**NO DEBE** presentarse ni documentarse como cierre del oráculo residual contra R39 de la 122: la
prohibición efectiva sigue siendo del **borde**. Un test DEBE comprobar que ocultar el selector
**no altera** la respuesta del borde ante un `mensajero_id` enviado por otra vía — es decir, que
la UI no es la que decide.

### Verificación

**R28.** El sistema DEBE tener un recorrido **E2E** que, por cada rol, entre a `/analitica` y
afirme qué ve y qué **no** ve (deber heredado de la 132, Q5: «el E2E se hace una sola vez en la
133»).

**R29.** La feature **NO DEBE** relajar ningún guard vigente. Todo caso que se ponga rojo por
diseño DEBE **reexpresarse** conservando la mutación que mataba, en el PR de esta feature, y
DEBE quedar enumerado en `progress/impl_133-analitica-recortes-por-rol.md` con su archivo,
su línea y el motivo.

**Cobertura: 29/29.** El mapa `R<n> → test` va en `design.md §7` y lo repite el implementer en
`progress/impl_133-analitica-recortes-por-rol.md`.

---

## 3. Lo que esta feature hereda y no puede contradecir

1. **`listarMetricas({ rol })` devuelve CERO financieras** para `adminTienda`, `adminSatelite` y
   `mensajero` (H9). Para ellos el dominio financiero es **prohibido**, no vacío
   (`specs/135-…/design.md:380-384`).
2. **La 132 ya resolvió cómo no ofrecer una región sin contenido**: no se renderiza si la prop no
   llega (H4/H5). Esta feature **reusa ese criterio**, no inventa otro.
3. **Las etiquetas `Mensajero 1..N` no son estables entre consultas** (H17).
4. **El recorte de datos es de la 122 y ocurre en el servidor.** Ver §0 y R20/R21/R27.

---

## 4. Deuda heredada: el oráculo residual contra R39 de la 122

> ### ⚠️ CORRECCIÓN DEL LEADER (2026-08-04) — LEER ANTES QUE EL RESTO DE LA SECCIÓN
>
> **M-4 ya NO está abierto: lo cerró la feature 126, y ni el review de la 122 ni esta spec lo
> sabían.** Verificado en el código, no deducido: `lib/actions/analitica-operativa.ts:117-128`
> invoca `sondeaIdentidadDeMensajero` —helper único en `lib/analytics/oraculo-mensajero.ts`— y
> responde `forbidden` con auditoría y motivo `filtro_fuera_de_alcance`. Es **exactamente** el
> enfoque candidato que esta sección proponía. Su test
> `tests/unit/analytics/operativa-oraculo.test.ts` cubre el caso del `adminTienda` y además mata la
> mutación fina (responder `forbidden` pero quitarle de paso la desagregación seudónima que D5 de la
> 122 le concedió). El dominio financiero no necesita guard equivalente: para `adminTienda` es
> **prohibido entero**, así que no hay consulta desde la que sondear.
>
> **Consecuencia:** la ficha propuesta al final de esta sección se registró como **184** y quedó
> **CANCELADA sin implementar**. **R15 y R27 siguen siendo válidos y no cambian**: ocultarle el
> selector sigue siendo correcto, y seguir prohibiendo que esa ocultación se presente como cierre
> también — lo que cierra el agujero es el guard del borde, no la UI.
>
> **La lección no es del registro, es del método:** una deuda heredada se comprueba **en el código**
> antes de convertirla en ficha. Entre que se anota y que se lee, puede haberla saldado otra feature.
>
> El texto original se conserva íntegro debajo: era cierto cuando se escribió, y es el razonamiento
> que sostiene R15 y R27.

`progress/review_122.md` (2026-08-01), hallazgo **M-4**, **ABIERTO**:

> `recortarFiltro` solo interseca la dimensión del alcance; un `adminTienda` puede enviar
> `mensajero_id: [<uuid>]` y, por el conteo devuelto, confirmar si ese mensajero trabajó para él
> pese a la seudonimización. Requiere conocer un uuid v4 de antemano → riesgo bajo.

**DECISIÓN: (b) queda FUERA de esta feature, con ficha propia propuesta.** Y no por comodidad:

- Es un problema de **DATOS**, no de presentación. Vive en el borde/`recortarFiltro` de
  `lib/analytics/`, zona **backend**. Esta feature es `frontend` y cerrarlo aquí sería
  exactamente el pecado que la 122 nos avisó de no cometer: tapar con la UI un canal del dato.
- **Ocultar el selector (R15) NO lo cierra.** El filtro viaja por la URL y por el argumento de la
  Server Action; quitar el control quita la comodidad, no el canal. R27 obliga a decirlo en voz
  alta en vez de absorberlo en silencio.
- Lo que esta feature **sí** aporta: (i) la mitigación de superficie (R15), (ii) el requisito que
  impide venderla como cierre (R27), (iii) la ficha propuesta de abajo.

**Ficha propuesta** (a registrar por el leader en `feature_list.json`; ver **Q7**):

```
name:        "analitica: cerrar el oraculo de conteo del filtro mensajero (R39 de la 122)"
zone:        backend
complexity:  medium
depends_on:  122
sdd:         true
description: Un actor con politica de identidad SEUDONIMA (adminTienda + grano mensajero) puede
             confirmar por el CONTEO si un mensajero concreto trabajo para el, enviando su uuid
             en `mensajero_id`. Enfoque candidato: para ese actor, `mensajero_id` en el filtro se
             RECHAZA con `filtro_fuera_de_alcance` (403) en vez de intersecarse — un id que no
             puede nombrar tampoco puede preguntar por el. Alternativa a evaluar: ruido/umbral
             minimo de celda. Hallazgo M-4 de progress/review_122.md; aviso dirigido desde
             specs/133-analitica-recortes-por-rol/requirements.md §4.
```

---

## 5. Preguntas abiertas

> Ninguna se resuelve inventando. Las marcadas **BLOQUEANTE** deben responderse en la puerta
> F1.4, antes de escribir código; el resto puede cerrarse con la recomendación escrita.

**Q1 — BLOQUEANTE. ¿Entran los tres roles, y qué se hace con las dos constantes de rol?**
Si `ROLES_ACCESO_ANALITICA` pasa a ser los cinco, **iguala** a `ROLES_ANALITICA` y el caso (b) de
`tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts:54-63` se pone **rojo por diseño**.
Ese guard trae escrita su propia salida: «la respuesta NO es borrar el guard: es fundir las dos
constantes en una sola» (líneas 34-38).
*Recomendación:* **sí, los tres**, y **fundir derivando**: `ROLES_ACCESO_ANALITICA` pasa a
derivarse de `ROLES_ANALITICA` (una sola declaración, R2/R3), y el caso (b) se **reexpresa** para
vigilar que la derivación siga existiendo (que nadie vuelva a escribir la lista a mano) en vez de
exigir desigualdad. El caso (a) —acceso ⊆ dominio— se conserva intacto.

**Q2 — BLOQUEANTE. ¿Dónde aterrizan `mensajero` y `adminSatelite` tras el login?**
Hoy `/dashboard` los redirige al **primer ítem visible** de su sidebar (H18): hoy
`/mis-asignaciones/reparto` y `/recepcion-satelite`. Como "Analítica" ocupa la **posición 2** de
`SIDEBAR_ITEMS` (H19), en cuanto se les haga visible pasarán a aterrizar en `/analitica`. Es un
cambio de comportamiento **silencioso**: el test que lo cubre (`HomePageMaestro.test.tsx:150`)
deriva el esperado de la misma función, así que **no se pondría rojo**.
*Recomendación:* **conservar el aterrizaje actual** (R5). Un tablero de indicadores no es donde
empieza el turno de nadie. Vía mínima: excluir `/analitica` del cálculo de `primerDestino`, con
un test que enumere los cinco roles y afirme su destino **por valor**, no por derivación.
*Alternativa descartable por el humano:* mover el ítem del sidebar, que rompería R16 de la 129.

**Q3 — no bloqueante. La faceta fijada por el alcance: ¿se oculta o se muestra fija?**
*Recomendación:* **ocultar** (R14/R16). Un selector con un único valor obligatorio no es
información, es ruido; y mostrarlo relleno con «tu tienda» invita a creer que se puede cambiar.

**Q4 — no bloqueante. `mensajero` y `adminSatelite` frente a los selectores Zona/Tienda.**
Sus catálogos les responden `forbidden` (H13), así que hoy verían dos selectores apagados más la
nota de degradado — que es justo el «control muerto» que R16 prohíbe.
*Recomendación:* **no ofrecerlos** mientras el catálogo no los autorice, y dejar **aviso dirigido**
a la ficha que amplíe esos servicios (backend, fuera de aquí). Nota para el implementer: esto
NO recorta datos, sólo controles; el borde sigue aceptando e interseccionando lo que llegue.

**Q5 — no bloqueante. Texto del rótulo de alcance (R24).**
*Recomendación:* una frase por **tipo de alcance** (no por rol), en `textos.ts` del subárbol
operativo, sin identificadores (R25). P. ej. «Estás viendo únicamente las órdenes de tu tienda».

**Q6 — no bloqueante. Alcance del E2E (R28).**
*Recomendación:* **un recorrido con cuatro roles**: los tres nuevos (cada uno afirma que ve el
tablero operativo y que NO existe rastro de la región financiera) más `maestro` (afirma que sí la
ve). Cubrir los seis roles en E2E duplicaría lo que ya cubren los tests de página.

**Q7 — no bloqueante. ¿Se registra ya la ficha del oráculo (§4)?**
*Recomendación:* **sí**, en el mismo acto de aprobación de este spec, para que la deuda no viva
sólo en un `status_note`. La registra el **leader** (`feature_list.json` no lo toca el
spec_author).
