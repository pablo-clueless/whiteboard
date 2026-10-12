import crypto from "crypto";

const INITIALIZATION_VECTOR = process.env.INITIALIZATION_VECTOR || "";
const SECRET_KEY = process.env.SECRET_KEY || "";

export class AESCipher {
  readonly initializationVector: string = "";
  readonly secretKey: string = "";

  constructor() {
    this.initializationVector = INITIALIZATION_VECTOR;
    this.secretKey = SECRET_KEY;
  }

  static encrypt<T>(data: T): string {
    const key = Buffer.from(SECRET_KEY, "utf-8");
    const iv = Buffer.from(INITIALIZATION_VECTOR, "utf-8");
    const plaintext = JSON.stringify(data);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(plaintext, "utf-8", "hex");
    encrypted += cipher.final("hex");

    return encrypted;
  }

  static decrypt<T>(data: string): T {
    const key = Buffer.from(SECRET_KEY, "utf-8");
    const iv = Buffer.from(INITIALIZATION_VECTOR, "utf-8");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(data, "hex", "utf-8");
    decrypted += decipher.final("utf-8");
    return JSON.parse(decrypted) as T;
  }
}
