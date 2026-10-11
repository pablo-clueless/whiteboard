import React from "react";

interface Props {
  children: React.ReactNode;
}

export const AuthGate = ({ children }: Props) => {
  return children;
};
