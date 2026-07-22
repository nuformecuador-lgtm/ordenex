// Feature 106 — Swagger UI publico del canal integrador. Renderiza Swagger UI desde CDN (unpkg),
// SIN agregar dependencias npm, apuntando al spec JSON de `/api/docs/openapi`. Es una pagina de
// documentacion publica: NO exige sesion. Como `/api-docs` NO cae bajo la rama `/api/*` del
// middleware, se agrego a PUBLIC_ROUTES para que no quede detras del login (ver middleware.ts).
const SWAGGER_VERSION = "5.17.14";

const HTML = `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ordenex — API de integración por API key</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css"
    />
    <style>
      body { margin: 0; background: #fafafa; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.addEventListener("load", function () {
        window.ui = SwaggerUIBundle({
          url: "/api/docs/openapi",
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
        });
      });
    </script>
  </body>
</html>`;

export function GET(): Response {
  return new Response(HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
