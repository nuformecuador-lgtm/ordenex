# Estado — sesión del 2026-09-10

## Cuatro fichas cerradas y en `dev`, SIN desplegar

`dev` en `8a449e37`. Ninguna ficha `in_progress`.

| Ficha | PR | Qué cierra |
|---|---|---|
| **404** | #770 | el mensajero de la orden viaja en el webhook, el listado y el detalle |
| **405** | #771 | el detalle expone el historial de gestiones (`gestiones[]`) |
| **406** | #772 | el enlace de evidencias del webhook deja de dar 404 garantizado |
| **407** | #773 | el operador puede autorizar la asignación de una orden que no se pudo ubicar |

Las cuatro con reviewer APROBADO y gate completo en verde **en su rama**. La 405 fue RECHAZADA
en ronda 1 y aprobada en ronda 2.

## ⚠️ LO PRIMERO QUE HAY QUE MIRAR

**Tres puertas de release, ninguna de código:**

1. **Mandar el aviso a los integradores.** El CHANGELOG **es** el aviso, y las tres fichas de API
   (404, 405, 406) lo tocan. Sin enviarlo, un integrador que valide esquema en estricto se entera
   por su lado. Hay un mensaje redactado para Daniel Marin en el chat de esta sesión.
2. **Nadie ha visto la pantalla de la 407 en un navegador.** Todo medido en jsdom. Sin cubrir: el
   panel con un lote grande y el contraste en los dos temas. Es la misma deuda que arrastra la 400
   desde anoche con su toast de 176 caracteres.
3. **La excepción de privacidad de la 404** quedó con la decisión por defecto (aplica a los dos
   modelos de propiedad). Antes de gastar decisión en acotarla, **medir cuántas keys con cuenta
   dedicada existen**: si son cero, la discusión sobra.

## El caso que originó la 407

**Guía 76068276** (ÓSCAR ELIZONDO SOLIS, Quesada / San Carlos): dirección de referencias, cinco días
parada con `geocode_status = ZERO_RESULTS`. Son **2 las órdenes así en toda la base** (la otra en
Palmira, Carrillo). **Se desatasca hoy sin esperar al despliegue** editando la dirección para que
empiece por un nombre propio que el mapa reconozca: al guardar se re-geocodifica sola en menos de
un minuto.

Hallazgo que abarató la ficha, verificado en el código: `OptimizacionRutaService` (R37/R28) **ya
excluye** las órdenes sin coordenadas del cálculo sin abortar y las pinta al final. El único punto
de toda la cadena que se plantaba era el gate de asignación.

## Deuda y hallazgos abiertos

- ⚠️ **Otro localizador por fecha, latente**: `tests/unit/api/openapi-374-nodo-retirado.test.ts:118-127`
  ata su aserción a `2026-09-06`. El día que alguien añada una entrada con esa fecha, rojo ajeno sin
  relación con su cambio. El gemelo de este ya explotó hoy en `openapi-405-gestiones.test.ts` y se
  arregló anclándolo al título.
- **Q4 de la 406 sin medir**: no se consultó el `max(length(num_remision))` real de producción.
- **Q5 de la 406** se midió contra `next dev`, no contra un build de producción.
- **La colisión heredada de la 177** (orden sin guía + remisión numérica que coincide con la guía de
  otra) queda reducida a un subconjunto estricto, no cerrada.
- **~40 worktrees huérfanos** en `.claude/worktrees/`, de sesiones anteriores. Ocupan disco.
- **270** sigue `pending` y sigue importando: `geocode_precision` no lo lee nadie.

## Lecciones de esta sesión, medidas

- **El `INIT_EXIT` dentro del log no es paranoia.** Un gate ROJO llegó como «exit code 0» porque el
  `echo` posterior tapa el código real. Se repitió hoy tal cual.
- **Dos agentes contra la misma base local se pisan.** Un gate post-merge salió rojo por un
  `40P01` (deadlock) en un archivo ajeno, con **0 tests fallidos** — esa es la firma. Se distingue
  re-corriendo el archivo aislado; ninguno de los agentes lo apuntó como deuda, que es lo correcto.
- **Un escenario imposible no prueba nada.** En la 405, una `devuelta` SIN foto describía un estado
  que no puede existir desde la feature 75, y por eso una mutación del filtro sobrevivía a **9.446
  tests en verde**. Se arregló el escenario, no el aserto.
- **Un requisito puede ser inalcanzable por construcción.** R19 de la 405 pedía «el mismo número de
  consultas» y no se puede devolver `gestiones[]` sin leerlas: lo falso era la premisa del design,
  no la implementación. Se aceptó 6 -> 9 y se congeló el número con un test que dice CUÁL sobra.
- **Ver el rojo antes del arreglo.** El cierre de lazo de la 406 daba 404 en sus 4 casos antes del
  fix, y el reviewer lo reprodujo revirtiéndolo: 22 rojos en 4 archivos.
