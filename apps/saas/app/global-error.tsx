"use client";
// Top-level error boundary. Next renders this when an error escapes
// every other boundary in the app, including its own layout. We
// capture to Sentry here so render-time crashes show up alongside
// server-side ones.
import NextError from "next/error";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
