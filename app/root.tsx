import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const title = status === 404 ? "Page not found" : "Something went wrong";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
      </head>
      <body>
        <main
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            margin: "4rem auto",
            maxWidth: "36rem",
            padding: "0 1.5rem",
          }}
        >
          <h1>{title}</h1>
          <p>
            Lens Search could not load this page. Please return to Shopify admin
            or try again in a moment.
          </p>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
