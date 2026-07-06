export interface CapacitorRESTPlugin {
  echo(options: { value: string }): Promise<{ value: string }>;
}
