# Review 114 — Mensajero: buscador de guias asignadas

> Reviewer del arne SDD. Rama feature/114-buscador-guias-mensajero (sincronizada con dev).
> Diff base dev...HEAD. NO se edito codigo; solo verificacion y veredicto.

## Veredicto: APROBADO

No hay hallazgos bloqueantes. init.sh verde y suite completa verde por verificacion propia.

## Checklist del arne

- [x] Trazabilidad R1-R9 -> test real. Cada requisito tiene >=1 test con asserts reales (tabla abajo).
- [x] Helper puro. mis-asignaciones-buscador.ts filtra por numGuia/numRemision/destinatario, match
      parcial insensible a mayusculas/acentos reutilizando normalizeName (NO duplica normalizacion);
      query vacio/solo-espacios -> lista sin filtrar (misma referencia). Sin DOM, sin any. Test unit propio.
- [x] Sin backend. Solo 2 archivos de produccion tocados (modulo + helper). Sin migracion, .sql,
      route.ts, ni Server Action nueva. Filtrado 100% cliente sobre MiAsignacionDTO.
- [x] Decision del gate F1.4 (R8/R9). paradasMapa, porGestionarVisual (grilla) y detalleOrden derivan
      de porGestionarFiltrado (no de porGestionar crudo) -> mapa y panel reflejan el filtro (R8).
      Salvaguarda R9: (o.id === ordenEnGestionId || coincideBusqueda(...)) mantiene la orden en gestion
      visible en lista y mapa aunque no coincida. La busqueda no toca ordenEnGestionId ni KPIs.
- [x] Preservacion 113/115. El buscador vive solo en la VISTA COMPLETA (en modo foco NO se renderiza,
      test 114/R1). modoFoco sigue derivando de ordenEnGestionId + detalleOrden. El sort de 115
      (porGestionarVisual) y el toggle/badge MarcarLuegoToggle intactos; ahora ordenan sobre el
      subconjunto filtrado. Los tests previos de 113/115/111/97 siguen verdes (solo se anadieron tests al final).
- [x] Verificacion ejecutable (numeros propios). init.sh: typecheck OK, lint OK (0 errores, 143 warnings
      todos preexistentes), test OK -> 466 archivos, 4657 tests, todos verdes. init OK.
      Focalizado (helper + modulo): 67 tests verdes.
- [x] Calidad + tasks. Sin console.log ni any en el diff de la feature. Textos en espanol claro
      (constantes BUSCADOR_*, SIN_RESULTADOS_*); nada de "SLA". Todas las tasks T1-T8 en tasks.md [x].

## Tabla R -> test (archivo:linea)

| Req | Test | Archivo:linea |
| --- | --- | --- |
| R1 | 114/R1 renderiza searchbox sobre ambos grupos + 114/R1 en modo foco NO se renderiza | tests/components/MisAsignacionesModule.test.tsx:1347, :1365 |
| R2 | 114/R2 teclear texto filtra AMBOS grupos por guia/remision/destinatario | tests/components/MisAsignacionesModule.test.tsx:1374 |
| R3 | R3 coincidencia PARCIAL insensible a mayusculas y acentos + R3 conserva solo coincidentes y respeta orden | tests/unit/components/mis-asignaciones-buscador.test.ts:42, :60 |
| R4 | R4 numGuia null NO coincide por guia pero si por remision/destinatario + R4 numGuia numerico como TEXTO 10 en 1001 | tests/unit/components/mis-asignaciones-buscador.test.ts:72, :89 |
| R5 | R5 query vacio/solo-espacios devuelve lista completa (unit) + 114/R5 limpiar restaura TODAS las guias (componente) | tests/unit/components/mis-asignaciones-buscador.test.ts:98 . tests/components/MisAsignacionesModule.test.tsx:1403 |
| R6 | 114/R6 sin coincidencias muestra sin resultados por grupo, distinto del vacio | tests/components/MisAsignacionesModule.test.tsx:1439 |
| R7 | 114/R7 el filtro aplica por grupo, no cruza al otro | tests/components/MisAsignacionesModule.test.tsx:1473 |
| R8 | 114/R8 filtrar excluye la parada de la grilla Y del mapa (RutaMapa recibe solo la coincidente) | tests/components/MisAsignacionesModule.test.tsx:1504 |
| R9 | 114/R9 la orden EN GESTION permanece en lista y mapa aunque no coincida (control g3 si se filtra) | tests/components/MisAsignacionesModule.test.tsx:1540 |

## Hallazgos

Ninguno bloqueante.

Menores (no bloquean, no requieren accion):

- (menor) buscando = query.trim() !== "" decide el texto sin resultados mientras el filtro real usa
  normalizeName(query) (que tambien colapsa). Divergen solo con entradas que trim() no vacia pero
  normalizeName si (p.ej. una marca combinante suelta): se mostraria el estado con busqueda con todo
  visible. Caso irreal de teclear; sin impacto practico. Nota, no correccion.
- (menor) La cobertura del gate se apoya en tests de componente con el mock rutaMapaMock; no hay E2E.
  Correcto segun CHECKPOINTS: la 114 es un filtro puro de cliente, no un flujo critico (auth/pagos/recaudo/
  ingesta/webhooks), asi que no exige Playwright.

## Notas CHECKPOINTS

- Especificacion: requirements (EARS R1-R9), design (con alternativa B descartada y su porque), tasks (T1-T8 [x]). OK.
- Datos/seguridad (RLS, migraciones, secretos, webhooks): N/A, feature sin backend, verificado por diff. OK.
- Patron de capas / permisos / multi-pais: N/A, frontend puro sobre props, sin hardcode. OK.
- Pendientes del leader (fuera del alcance del reviewer): entrada en progress/history.md y transicion de estado.
