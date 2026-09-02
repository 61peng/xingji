const DATA_DIRECTORY = "Application Support/io.github.peng61.xingji";
const DATA_FILE = `${DATA_DIRECTORY}/journeys-v1.json`;

type DataEnvelope<T> = {
  version: 1;
  updatedAt: string;
  journeys: T;
};

type DesktopStorageHandler = {
  postMessage: (message: unknown) => Promise<unknown>;
};

type DesktopWindow = Window & {
  webkit?: {
    messageHandlers?: {
      xingjiStorage?: DesktopStorageHandler;
    };
  };
};

type CapacitorWindow = Window & {
  Capacitor?: {
    isNativePlatform?: () => boolean;
  };
};

export type DeviceStorageResult<T> = {
  native: boolean;
  data: T | null;
};

async function nativeFilesystem() {
  if (typeof window === "undefined") return null;
  const capacitor = (window as CapacitorWindow).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  const { Directory, Encoding, Filesystem } = await import("@capacitor/filesystem");
  return { Directory, Encoding, Filesystem };
}

function desktopStorage() {
  if (typeof window === "undefined") return null;
  return (window as DesktopWindow).webkit?.messageHandlers?.xingjiStorage ?? null;
}

function unwrapJourneys<T>(payload: DataEnvelope<T> | T) {
  if (payload && typeof payload === "object" && "journeys" in payload) {
    return (payload as DataEnvelope<T>).journeys;
  }
  return payload as T;
}

export async function readDeviceJourneys<T>(): Promise<DeviceStorageResult<T>> {
  const desktop = desktopStorage();
  if (desktop) {
    try {
      const result = await desktop.postMessage({ action: "read" });
      if (result == null) return { native: true, data: null };
      const parsed = (typeof result === "string" ? JSON.parse(result) : result) as
        | DataEnvelope<T>
        | T;
      return { native: true, data: unwrapJourneys(parsed) };
    } catch {
      return { native: true, data: null };
    }
  }

  const native = await nativeFilesystem();
  if (!native) return { native: false, data: null };

  try {
    const result = await native.Filesystem.readFile({
      path: DATA_FILE,
      directory: native.Directory.Library,
      encoding: native.Encoding.UTF8,
    });
    const parsed = JSON.parse(String(result.data)) as DataEnvelope<T> | T;
    return { native: true, data: unwrapJourneys(parsed) };
  } catch {
    return { native: true, data: null };
  }
}

export async function writeDeviceJourneys<T>(journeys: T) {
  const envelope: DataEnvelope<T> = {
    version: 1,
    updatedAt: new Date().toISOString(),
    journeys,
  };

  const desktop = desktopStorage();
  if (desktop) {
    await desktop.postMessage({ action: "write", data: envelope });
    return true;
  }

  const native = await nativeFilesystem();
  if (!native) return false;

  await native.Filesystem.mkdir({
    path: DATA_DIRECTORY,
    directory: native.Directory.Library,
    recursive: true,
  }).catch(() => undefined);

  await native.Filesystem.writeFile({
    path: DATA_FILE,
    directory: native.Directory.Library,
    encoding: native.Encoding.UTF8,
    data: JSON.stringify(envelope, null, 2),
    recursive: true,
  });
  return true;
}

export async function exportDesktopJourneys<T>(
  journeys: T,
  filename: string,
): Promise<{ handled: boolean; saved: boolean }> {
  const desktop = desktopStorage();
  if (!desktop) return { handled: false, saved: false };

  const envelope: DataEnvelope<T> & { app: string } = {
    app: "行迹",
    version: 1,
    updatedAt: new Date().toISOString(),
    journeys,
  };
  const result = await desktop.postMessage({
    action: "export",
    filename,
    data: envelope,
  });
  return { handled: true, saved: result === true };
}

export async function importDesktopJourneys<T>(): Promise<{
  handled: boolean;
  data: T | null;
}> {
  const desktop = desktopStorage();
  if (!desktop) return { handled: false, data: null };

  const result = await desktop.postMessage({ action: "import" });
  return { handled: true, data: result == null ? null : result as T };
}
