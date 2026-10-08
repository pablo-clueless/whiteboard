import React from "react";

interface Props {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: Props) {
  return children;
}
