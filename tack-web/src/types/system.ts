export interface PlatformProps {
  allowedOrigins: string[];
  idleTimeout: number;
  maintenanceMode: boolean;
  sizeLimit: number;
}

export interface SecurityProps {
  allowNewUsers: boolean;
  maxLoginAttempts: number;
  passwordPolicy: string;
  retentionPolicy: {
    automaticDeletion: boolean;
    retentionPeriod: number;
  };
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
    description?: string;
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
