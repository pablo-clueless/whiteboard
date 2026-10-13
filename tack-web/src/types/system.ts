// Matches `SystemConfiguration` from GET /api/admin/settings (`tack/src/settings.rs`).

export interface PlatformProps {
  allowedOrigins: string[];
  /** Seconds an empty room stays open. */
  idleTimeout: number;
  maintenanceMode: boolean;
  /** Largest board, in MB. */
  sizeLimit: number;
}

export type PasswordPolicy = "basic" | "strong";

export interface SecurityProps {
  allowNewUsers: boolean;
  maxLoginAttempts: number;
  passwordPolicy: PasswordPolicy;
  retentionPolicy: {
    automaticDeletion: boolean;
    /** Days. */
    retentionPeriod: number;
  };
  /** Minutes. */
  sessionTimeout: number;
  twoFactorAuthentication: boolean;
}

export interface BoardProps {
  newBoardCreation: boolean;
  imageUploads: boolean;
  diagramImport: boolean;
  readOnlySwitch: boolean;
}

export interface FeatureFlagsProps {
  featureFlags: {
    id: string;
    name: string;
    enabled: boolean;
    description?: string | null;
  }[];
}

export interface SystemHealthProps {
  storage: {
    used: string;
    available: string;
  };
}

export interface SystemConfiguration {
  platform: PlatformProps;
  security: SecurityProps;
  board: BoardProps;
  featureFlags: FeatureFlagsProps;
  systemHealth: SystemHealthProps;
}

/** GET /api/config: what the web client needs to hide or disable features. */
export interface PublicConfig {
  maintenanceMode: boolean;
  allowNewUsers: boolean;
  passwordPolicy: PasswordPolicy;
  /** Admins must use two-factor sign-in. */
  twoFactorRequired: boolean;
  board: BoardProps;
  featureFlags: Record<string, boolean>;
}
