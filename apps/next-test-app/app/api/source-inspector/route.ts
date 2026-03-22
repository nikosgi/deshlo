import { NextResponse } from "next/server";

interface NextRouteRequestPayload {
  sourceLoc: string;
  tagName: string;
  selectedText: string;
  proposedText: string;
}

interface NextRouteResponsePayload {
  ok: boolean;
  message: string;
  links?: Array<{ label: string; url: string }>;
}

function isValidPayload(value: unknown): value is NextRouteRequestPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<NextRouteRequestPayload>;

  return (
    typeof payload.sourceLoc === "string" &&
    typeof payload.tagName === "string" &&
    typeof payload.selectedText === "string" &&
    typeof payload.proposedText === "string"
  );
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json<NextRouteResponsePayload>(
      {
        ok: false,
        message: "PROVIDER_ERROR: Invalid JSON payload.",
      },
      { status: 400 }
    );
  }

  if (!isValidPayload(payload)) {
    return NextResponse.json<NextRouteResponsePayload>(
      {
        ok: false,
        message: "PROVIDER_ERROR: Invalid submit payload shape.",
      },
      { status: 400 }
    );
  }

  const message = `Route received change request for <${payload.tagName}> at ${payload.sourceLoc}.`;

  return NextResponse.json<NextRouteResponsePayload>({
    ok: true,
    message,
    links: [
      {
        label: "Next Route Handler Docs",
        url: "https://nextjs.org/docs/app/building-your-application/routing/route-handlers",
      },
    ],
  });
}
