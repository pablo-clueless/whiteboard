import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const {} = request.nextUrl;

  return NextResponse.next();
}
