interface SetupAuthOptions {
  password: string;
}

interface SetupRemoteAccessOptions {
  username: string;
  password: string;
  relayUrl?: string;
}

export async function setupAuth(_options: SetupAuthOptions): Promise<void> {
  throw new Error("CLI auth setup is not implemented in this workspace build.");
}

export async function setupRemoteAccess(_options: SetupRemoteAccessOptions): Promise<void> {
  throw new Error("CLI remote access setup is not implemented in this workspace build.");
}
