# impl 433 — el módulo de ayuda dentro de la app

> Rama `feat/433-modulo-de-ayuda`. La ficha es **`sdd: false`**: no tiene carpeta `specs/`, así
> que **la especificación es el `status_note` de `feature_list.json`** y este archivo es el que
> pone número a cada promesa suya. Los tests ya numeraban R1…R15 sin que ningún documento
> definiera esos R (hallazgo m6 de `progress/review_433.md`); aquí quedan definidos, y R16…R20
> son los que la revisión obligó a añadir.
>
> El porqué técnico de leer los `.md` con `fs` vive en `progress/decision_433_lectura_de_los_md.md`.
> La revisión, en `progress/review_433.md`.

## Los requisitos, y de dónde sale cada uno

Cada `R` traduce una frase de la ficha. Los que no salen de la ficha se marcan con su origen.

| # | Requisito | Origen |
|---|---|---|
| R1 | Cada rol ve **sólo** los documentos que su `roles:` declara. Un mensajero no se tropieza con la ayuda de Wallet | ficha |
| R2 | Y eso vale para los cinco roles de persona, no sólo para el mensajero | ficha |
| R3 | Una ruta con DOS documentos (`/ordenes`: oficina y tienda) le da a cada rol el suyo, sin desempates inventados | ficha |
| R4 | El ítem «Ayuda» va **al final** del menú lateral y lo ven las cinco cuentas de persona; `apiKey` no | ficha |
| R5 | **Ningún aterrizaje post-login cambia** por culpa de ese ítem (la trampa que mordió en la 429) | ficha |
| R6 | El renderizador pinta los bloques de Markdown que los 31 documentos usan de verdad | derivado: sin esto no hay módulo |
| R7 | El texto de un documento **no puede convertirse en marcado**: nada de `dangerouslySetInnerHTML` | seguridad |
| R8 | Los 31 documentos reales se renderizan enteros, sin reventar | derivado |
| R9 | El frontmatter se lee **tal como lo declara** `docs/ayuda/README.md`, y `fuentes` nunca se muestra | ficha + README de la carpeta |
| R10 | El «?» del encabezado se monta **donde hay documento** y abre el de esa pantalla | ficha (acceso 2) |
| R11 | Y **no se pinta** donde no lo hay: nunca un «?» que lleve a un vacío | ficha |
| R12 | El «?» respeta el ROL, no sólo la ruta | ficha |
| R13 | Sin proveedor no se pinta nada y no revienta (el encabezado se monta suelto en una veintena de tests) | derivado |
| R14 | El índice del módulo pinta los documentos del rol, agrupados por carpeta | ficha (acceso 1) |
| R15 | El buscador filtra lo que se VE, dentro del módulo | ficha (acceso 3) |
| **R16** | **El acotamiento por rol de la URL**: escribir `/ayuda/<slug>` de un documento ajeno da 404, igual que uno inexistente. Y quien SÍ puede, lo lee | **revisión B1** |
| **R17** | **La puerta de `/ayuda`**: sólo las cinco cuentas de persona (`ROLES_AYUDA`); sin sesión y `apiKey`, 404 | **revisión B1** |
| **R18** | **El «?» está MONTADO en `PageHeader`**, no sólo importado | **revisión B1** |
| **R19** | Los `.md` **viajan al servidor de producción**: `outputFileTracingIncludes` cubre `docs/ayuda` para todas las páginas | **revisión m1** |
| **R20** | **La ayuda puede fallar; el portal no.** Un catálogo ilegible degrada a «sin «?»» y no tumba la aplicación, y el fallo no se memoriza | **revisión m4** |

## Mapa R → test

| # | Test | Qué lo mata |
|---|---|---|
| R1 | `tests/unit/ayuda/acotamiento-por-rol.test.ts:27` | slugs escritos a mano, no derivados del catálogo |
| R2 | `tests/unit/ayuda/acotamiento-por-rol.test.ts:76` | ídem, rol por rol |
| R3 | `tests/unit/ayuda/acotamiento-por-rol.test.ts:106` + `tests/components/AyudaBoton.test.tsx:86` | cada rol recibe SU documento de `/ordenes` |
| R4 | `tests/unit/auth/menu-ayuda.test.ts:27` | índice literal del último ítem; `roles` comparado por identidad (`toBe(ROLES_AYUDA)`) |
| R5 | `tests/unit/auth/menu-ayuda.test.ts:69` + `tests/unit/auth/destino-post-login.test.ts` **intacto** | los cinco aterrizajes escritos a mano |
| R6 | `tests/unit/ayuda/markdown.test.tsx:13` | bloque por bloque |
| R7 | `tests/unit/ayuda/markdown.test.tsx:93` | un `<script>` escrito en un `.md` se pinta como letras |
| R8 | `tests/unit/ayuda/markdown.test.tsx:101` | los 31 documentos REALES |
| R9 | `tests/unit/ayuda/markdown.test.tsx:126` + `tests/unit/guards/ayuda-render-sin-filtracion.guardia.test.ts:53` | `fuentes` no está ni en el tipo |
| R10 | `tests/components/AyudaBoton.test.tsx:39` | `href` contra los `.md` reales |
| R11 | `tests/components/AyudaBoton.test.tsx:60` | las 3 pantallas sin documento + las 2 redirecciones + la landing |
| R12 | `tests/components/AyudaBoton.test.tsx:86` | `/wallet` da ayuda al maestro y NADA al mensajero |
| R13 | `tests/components/AyudaBoton.test.tsx:106` | montado suelto, sin proveedor |
| R14 | `tests/components/AyudaIndice.test.tsx:35` | monta de verdad y cuenta enlaces |
| R15 | `tests/components/AyudaIndice.test.tsx:74` | teclea y cuenta |
| **R16** | `tests/components/AyudaDocumentoPage.test.tsx:65` (negativa) y `:133` (positiva) | 3 roles no-oficina + `apiKey` + sin sesión + slug inexistente + travesía; y el maestro, el admin y el mensajero SÍ leen la suya |
| **R17** | `tests/components/AyudaLayout.test.tsx:75` (negativa) y `:99` (positiva) | `apiKey` y sin sesión dan 404; los cinco roles entran y cada uno ve SU índice (22/21/9/8/7) |
| **R18** | `tests/components/PageHeader.test.tsx:101` | el encabezado se renderiza ENTERO dentro de `AyudaProvider` y se busca el enlace «Ayuda de esta pantalla» |
| **R19** | `tests/unit/guards/ayuda-md-viajan-a-produccion.guardia.test.ts:72` | lee el `next.config.ts` de verdad: existe, cubre `/**` y el patrón apunta a la carpeta que lee `catalogo.ts`, con `**` |
| **R20** | `tests/components/AppLayout.test.tsx:511` + `tests/unit/ayuda/catalogo-memoria.test.ts:62` y `:90` | el catálogo falla y el portal se pinta igual; y `node:fs/promises` doblado para que la primera lectura reviente |

Guardias transversales de la ficha, sin `R` propio porque vigilan la **forma** y no una promesa concreta:

- `tests/unit/guards/ayuda-pantalla-ruta-existe.guardia.test.ts` — toda `pantalla:` apunta a una
  ruta que existe; ningún documento huérfano; ninguna carpeta sin etiqueta; **ningún choque de
  ruta para el mismo rol** (desde esta tanda pregunta con `documentoVisiblePara`, el predicado
  de verdad, en vez de re-implementar la regla — hallazgo m3).
- `tests/unit/guards/ayuda-render-sin-filtracion.guardia.test.ts` — `fuentes` no se pinta nunca.
- `tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts` — los cinco contadores del manifiesto
  suben a 22/14/8/7/5 y `/ayuda` NO se publica como atajo.

## Lo que esta tanda añadió (cierre de la revisión)

**El bloqueante: tres mutaciones que sobrevivían a la suite entera.** Las tres tocaban el
CABLEADO, que es lo que ningún test miraba: el `notFound()` del servidor, el gate del layout y el
montaje del «?». Cada una tiene ahora su test, y cada test se comprobó **poniendo la mutación y
viéndolo rojo** (tabla en la entrega de la sesión).

**Lo que se arregló en el código, no sólo en los tests** (m4, que la revisión dejó como decisión):

1. `lib/ayuda/catalogo.ts` — **el fallo ya no se memoriza**. Se guardaba una PROMESA: una
   rechazada habría sido permanente, y como el layout del portal lee este catálogo en TODAS las
   páginas, el radio de daño era «la aplicación no abre», no «la ayuda no abre». Ahora el rechazo
   limpia la caché y se relanza.
2. `app/(app)/layout.tsx` — **`try/catch` alrededor de la lectura** (`mapaAyudaDelActor`). Si el
   catálogo no se puede leer, el mapa va vacío: se pierde el «?» y nada más. Es la condición que
   el humano puso a las cuatro de SF-001 —no dañar lo que ya funciona— aplicada al único punto
   donde esta ficha podía dañar algo ajeno.

**Menores cerrados:** m1 (guardia de `outputFileTracingIncludes`), m2 (el recuento del comentario
de `AyudaBoton`, vuelto a medir: 34 rutas, 2 redirecciones puras, 32 con encabezado, **3 sin «?»**),
m3 (la guardia importa el predicado), m5 (el comentario caduco de la 282), m6 (este archivo),
m7 (`progress/history.md`).

## Lo que NO entra, y por qué

- **El encabezado a 390px.** `PageHeader` es `justify-between` sin `flex-wrap` y sus botones traen
  `shrink-0`: toda la compresión la absorbe el título. Es **deuda pre-existente** que el «?»
  agrava en grado —no daño nuevo—, toca un componente compartido por toda la app y va en ficha
  aparte con medición antes/después. Aquí sólo se le añadieron tests.
- **Que el maestro no pueda leer la ayuda del mensajero, la tienda ni el satélite.** Viene de los
  DATOS (`roles:` significa «quién ve esa pantalla», contrato escrito en el README de la carpeta),
  no del módulo. Ensancharlo es una decisión de producto **del humano**. Si se toma: predicado
  NUEVO de lectura usado sólo por el gate de la página y el índice, dejando `documentoVisiblePara`
  estricto para `mapaRutaDocumento` —si no, el maestro pasa a tener dos candidatos para `/ordenes`—.
- **`tests/unit/auth/destino-post-login.test.ts`.** Su `toEqual` literal ES el contrato. Intacto.
