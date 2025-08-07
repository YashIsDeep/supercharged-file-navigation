export const retryWithBackoff = async <T>(
  fn: () => Thenable<T>,
  retries: number = 5,
  backoff: number = 1000
): Promise<T> => {
  let attempt = 0;
  while (attempt < retries) {
    try {
      const result = await fn();
      if (
        !result ||
        (typeof result === "object" && Object.keys(result).length === 0) ||
        (Array.isArray(result) && result.length === 0)
      ) {
        throw new Error("Empty results, retrying...");
      }
      return result;
    } catch (error) {
      attempt++;
      if (attempt >= retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, backoff * attempt));
    }
  }

  throw new Error("no projects found after maximum retries");
};
