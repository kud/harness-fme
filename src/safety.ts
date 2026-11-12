export const PRODUCTION_ENVIRONMENT_PATTERN = /prod/i

export const isProductionEnvironment = (name: string): boolean =>
  PRODUCTION_ENVIRONMENT_PATTERN.test(name)

export type WriteGuardInput = {
  // The environment's real name, as the API reports it.
  environmentName: string
  // What the caller literally typed for the environment.
  environmentArg: string
  // The explicit go-ahead. Without it nothing is written.
  go: boolean
}

export type WriteGate =
  { mode: "plan" } | { mode: "write" } | { mode: "refused"; reason: string }

// Every write is a plan until `go` is given. An environment that looks like
// production adds a second condition: the caller must have typed that
// environment's exact name, so an id, an alias or a differently cased guess
// can never reach it by accident.
export const evaluateWriteGate = ({
  environmentName,
  environmentArg,
  go,
}: WriteGuardInput): WriteGate => {
  if (!go) return { mode: "plan" }
  if (
    isProductionEnvironment(environmentName) &&
    environmentArg !== environmentName
  )
    return {
      mode: "refused",
      reason: `${environmentName} looks like production: refusing to write unless you pass --env ${environmentName} --go explicitly`,
    }
  return { mode: "write" }
}
