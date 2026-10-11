import { Maybe } from "./app";

type UserStatus = "active" | "deleted" | "inactive" | "pending" | "suspended";

export interface User {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Maybe<Date>;
}
