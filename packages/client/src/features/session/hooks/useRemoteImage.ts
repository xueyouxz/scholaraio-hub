import { useFetchedImage } from "./useFetchedImage";

export { useFetchedImage };

export function useRemoteImage(apiPath: string | null) {
  return useFetchedImage(apiPath);
}

export async function preloadRemoteImage(apiPath: string): Promise<string> {
  return apiPath;
}
